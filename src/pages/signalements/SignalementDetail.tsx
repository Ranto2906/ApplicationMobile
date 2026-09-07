import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent,
  IonSpinner, IonToast, IonBadge, IonAlert,
} from '@ionic/react';
import { chevronBack, trashOutline, syncOutline, downloadOutline } from 'ionicons/icons';
import { useHistory, useParams } from 'react-router-dom';
import type L from 'leaflet';
import LeafletOfflineMap, { type PointGeo } from '../../components/LeafletOfflineMap';
import { signalementApi } from '../../services/signalementService';
import { db, type PendingOperation } from '../../services/db';
import { synchroniserSignalements } from '../../services/syncService';
import { telechargerZone, type OfflineTileLayer } from '../../services/offlineMap';
import { useOnline } from '../../hooks/useOnline';
import type { SignalementDTO, PhotoSignalementDTO } from '../../types/signalement';

interface RouteParams { id: string }

const CENTRE_MADAGASCAR: PointGeo = { lat: -18.8792, lng: 47.5079 };

export default function SignalementDetail() {
  const { id } = useParams<RouteParams>();
  const history = useHistory();
  const online = useOnline();

  const [sig, setSig] = useState<SignalementDTO | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [position, setPosition] = useState<PointGeo | null>(null);
  const [photos, setPhotos] = useState<PhotoSignalementDTO[]>([]);
  const [historique, setHistorique] = useState<Array<{ action?: string; dateAction?: string; nomUtilisateur?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Carte hors-ligne
  const mapRef = useRef<L.Map | null>(null);
  const coucheRef = useRef<OfflineTileLayer | null>(null);
  const [dlState, setDlState] = useState('');
  const [dlProgress, setDlProgress] = useState<{ fait: number; total: number } | null>(null);
  const annulerDl = useMemo(() => ({ value: false }), []);

  // Dédoublonnage : évite les recharges inutiles quand id/online ne changent pas
  const lastLoadedRef = useRef<{ id: string; online: boolean } | null>(null);

  const charger = useCallback(async () => {
    if (lastLoadedRef.current?.id === id && lastLoadedRef.current?.online === online) {
      return; // Déjà chargé avec les mêmes paramètres
    }
    lastLoadedRef.current = { id, online };

    setLoading(true);
    try {
      // 1) Brouillon local (créé hors-ligne, pas encore sur le serveur) ?
      //    NB : base locale indisponible (ex. jeep-sqlite encore en chargement
      //    sur le web) → on ignore et on laisse la suite (serveur) fonctionner.
      let p: PendingOperation | null = null;
      try {
        p = await db.trouverOperationPending(id);
      } catch (e) {
        console.warn('[SEIMAD:Detail] base locale indisponible — brouillon ignoré', e);
      }
      setPending(p);
      if (p) {
        const payload = JSON.parse(p.payload) as SignalementDTO;
        setSig({
          idSignalement: p.idLocal,
          reference: 'Brouillon local',
          description: payload.description,
          dateSignalement: p.createdAt,
          libelleStatut: 'En attente de synchronisation',
          codeStatut: 'en_attente',
          libelleType: 'Signalement local',
        });
        // Position : géométrie locale (GeoJSON), sinon ancien format {lat,lng}.
        setPosition(await lirePositionGeometrie(p.idLocal));
        setPhotos([]);
        setHistorique([]);
        return;
      }

      // 2) Signalement du serveur (détail complet : photos + historique).
      //    Aucun pull : hors-ligne, seuls les brouillons locaux sont consultables.
      if (online) {
        try {
          const s = await signalementApi.trouver(id);
          setSig(s);
          // Position : cache local SQLite (la géométrie n'est pas rapatriée —
          // le mobile ne fait que pousser ; seuls les signalements créés sur
          // cet appareil ont une ligne `geometrie_locale`).
          setPosition(await lirePositionGeometrie(id));
          const [ph, h] = await Promise.all([
            signalementApi.photos(id).catch(() => []),
            signalementApi.historique(id).catch(() => []),
          ]);
          setPhotos(ph);
          setHistorique(h);
          return;
        } catch {
          // Erreur réseau temporaire — on garde l'état précédent si existant
          return;
        }
      }

      // Hors-ligne sans brouillon local connu
      setSig(null);
    } catch {
      setSig(null);
    } finally {
      setLoading(false);
    }
  }, [id, online]);

  useEffect(() => { charger(); }, [charger]);

  // Rechargement différé quand on passe en ligne (évite les rechargements immédiats)
  useEffect(() => {
    if (online && sig) {
      const t = setTimeout(() => charger(), 1500);
      return () => clearTimeout(t);
    }
  }, [online]);

  const onMapReady = useCallback((map: L.Map, couche: OfflineTileLayer) => {
    mapRef.current = map;
    coucheRef.current = couche;
  }, []);

  const telechargerZoneVisible = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    setDlState('en cours');
    setDlProgress({ fait: 0, total: 0 });
    annulerDl.value = false;
    try {
      const res = await telechargerZone(map, {
        minZoom: 12,
        maxZoom: 17,
        annuler: annulerDl,
        onProgress: (fait, total) => setDlProgress({ fait, total }),
      });
      setDlState(res.echecs > 0 && res.reussies === 0 ? 'erreur' : 'fait');
    } catch {
      setDlState('erreur');
    }
  }, [annulerDl]);

  const synchroniserUn = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await synchroniserSignalements();
      if (res.reussis > 0) {
        setToast('Signalement synchronisé ✔');
        setToastColor('success');
        if (pending) {
          // L'id local disparaît (le serveur génère le sien) → retour à la liste.
          setTimeout(() => history.replace('/tab/signalements'), 900);
        } else {
          await charger();
        }
      } else {
        setToast(res.echecs > 0 ? 'Échec de la synchronisation' : 'Rien à synchroniser');
        setToastColor(res.echecs > 0 ? 'danger' : 'success');
      }
    } finally {
      setSyncing(false);
    }
  }, [charger, pending, history]);

  const supprimer = useCallback(async () => {
    try {
      if (pending) {
        await db.supprimerOperationPending(pending.idLocal);
        await db.supprimerGeometrieLocale('signalement', pending.idLocal).catch(() => undefined);
      } else {
        await signalementApi.supprimer(id);
        await db.supprimerGeometrieLocale('signalement', id).catch(() => undefined);
      }
      setToast('Signalement supprimé');
      setTimeout(() => history.replace('/tab/signalements'), 800);
    } catch {
      setToast('Suppression impossible');
      setToastColor('danger');
    }
  }, [id, pending, history]);

  const estLocal = !!pending;
  const statutCouleur = useMemo(
    () => (estLocal ? '#b7791f' : (sig?.couleurStatutHex || '#1a56db')),
    [estLocal, sig?.couleurStatutHex]
  );

  const formaterDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  const photosLocales = useMemo(() => {
    if (!pending) return [];
    try {
      return JSON.parse(pending.photos || '[]') as Array<{ dataUrl: string }>;
    } catch {
      return [];
    }
  }, [pending]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonButtons slot="start">
            <IonButton onClick={() => history.replace('/tab/signalements')}>
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Détail signalement</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setConfirmDelete(true)} style={{ color: '#fca5a5' }}>
              <IonIcon icon={trashOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <IonSpinner name="crescent" />
          </div>
        ) : !sig ? (
          <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af' }}>
            <p>Signalement introuvable.</p>
            {!online && <p style={{ fontSize: 12 }}>Hors-ligne : ce signalement n'est pas dans la base locale. Faites une synchronisation quand le réseau revient.</p>}
            <IonButton onClick={() => history.replace('/tab/signalements')}>Retour</IonButton>
          </div>
        ) : (
          <>
            {/* En-tête */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 14, marginBottom: 14,
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{sig.reference || sig.idSignalement.slice(0, 8)}</h2>
                <IonBadge style={{ background: statutCouleur, color: '#fff', fontSize: 10.5 }}>
                  {sig.libelleStatut || 'Nouveau'}
                </IonBadge>
              </div>

              {/* Type + ville + rattachements (badges colorés) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                <span style={{
                  background: sig.couleurType || '#1a56db', color: '#fff', borderRadius: 999,
                  padding: '3px 10px', fontSize: 11.5, fontWeight: 600,
                }}>
                  {sig.libelleType || 'Signalement'}
                  {sig.codeType ? ` · ${sig.codeType}` : ''}
                </span>
                {sig.nomVille && (
                  <span style={{ background: '#eef2f7', color: '#334155', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 600 }}>
                    🏙️ {sig.nomVille}
                  </span>
                )}
                {sig.numeroTitre && (
                  <span style={{ background: '#f0fdf4', color: '#166534', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 600 }}>
                    📄 TF {sig.numeroTitre}
                  </span>
                )}
                {sig.numeroLot && (
                  <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 600 }}>
                    Lot n° {sig.numeroLot}
                  </span>
                )}
              </div>

              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#9ca3af' }}>
                {sig.nomUtilisateurCreation ? `🧑‍💼 ${sig.nomUtilisateurCreation} · ` : ''}
                Créé le {formaterDate(sig.dateSignalement)}
                {sig.dateModification ? ` · modifié le ${formaterDate(sig.dateModification)}` : ''}
              </p>
            </div>

            {/* Carte */}
            <LeafletOfflineMap
              center={position ?? CENTRE_MADAGASCAR}
              zoom={15}
              marker={position}
              markerColor="#c53030"
              onMapReady={onMapReady}
              height={240}
            />
            <div style={{ marginTop: 8, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <IonButton size="small" fill="outline" onClick={telechargerZoneVisible} disabled={dlState === 'en cours' || !online}>
                <IonIcon icon={downloadOutline} slot="start" />
                {dlState === 'en cours' ? 'Téléchargement…' : 'Zone hors-ligne'}
              </IonButton>
              {dlState === 'fait' && <span style={{ alignSelf: 'center', fontSize: 12, color: '#059669' }}>✔ en cache</span>}
            </div>
            {dlProgress && dlState === 'en cours' && (
              <div style={{ fontSize: 11.5, marginBottom: 10 }}>
                Tuiles {dlProgress.fait}/{dlProgress.total}
                <div style={{ background: '#e2e8f0', borderRadius: 6, height: 5, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{
                    width: dlProgress.total ? `${Math.round((dlProgress.fait / dlProgress.total) * 100)}%` : '0%',
                    background: '#1a56db', height: '100%',
                  }} />
                </div>
              </div>
            )}

            {/* Localisation / position */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📍 Position sur le terrain</b>
              {position ? (
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <div style={{ flex: 1, background: '#f8fafc', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Latitude</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13.5, color: '#0f172a' }}>{position.lat.toFixed(6)}</div>
                  </div>
                  <div style={{ flex: 1, background: '#f8fafc', borderRadius: 10, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>Longitude</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 13.5, color: '#0f172a' }}>{position.lng.toFixed(6)}</div>
                  </div>
                </div>
              ) : (
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#9ca3af' }}>
                  Aucune coordonnée GPS pour ce signalement
                  {estLocal ? '' : ' (créé sans positionnement, ou sur un autre appareil)'}.
                </p>
              )}
            </div>

            {/* Observation / description */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📝 Observation</b>
              <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: '#374151', whiteSpace: 'pre-wrap' }}>
                {sig.description || '—'}
              </p>
            </div>

            {/* Traitement (si renseigné côté web) */}
            {(sig.commentaireTraitement || sig.dateTraitement) && (
              <div style={{
                background: '#f0fdf4', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #bbf7d0',
              }}>
                <b style={{ fontSize: 13 }}>✅ Traitement</b>
                {sig.dateTraitement && (
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#166534' }}>
                    Traité le {formaterDate(sig.dateTraitement)}
                    {sig.nomUtilisateurTraitement ? ` par ${sig.nomUtilisateurTraitement}` : ''}
                  </p>
                )}
                {sig.commentaireTraitement && (
                  <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.5, color: '#14532d', whiteSpace: 'pre-wrap' }}>
                    {sig.commentaireTraitement}
                  </p>
                )}
              </div>
            )}

            {/* Photos du constat — section TOUJOURS affichée */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📷 Photos du constat ({estLocal ? photosLocales.length : photos.length})</b>
              {estLocal && photosLocales.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {photosLocales.map((p, i) => (
                    <img key={i} src={p.dataUrl} alt="constat local" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                  ))}
                </div>
              ) : photos.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {photos.map((p) => (
                    <PhotoChargée key={p.idPhoto} idPhoto={p.idPhoto} />
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 8, background: '#f8fafc', border: '1px dashed #d1d5db', borderRadius: 10, padding: '14px 10px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                  Aucune photo jointe à ce signalement.
                </div>
              )}
            </div>

            {/* Brouillon local → bouton sync */}
            {estLocal && (
              <IonButton expand="block" onClick={synchroniserUn} disabled={syncing || !online} style={{ '--border-radius': 12, marginBottom: 10 }}>
                <IonIcon icon={syncOutline} slot="start" />
                {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
              </IonButton>
            )}

            {/* Historique */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📜 Historique</b>
              {historique.length === 0 ? (
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#9ca3af' }}>
                  Aucun événement enregistré pour ce signalement.
                </p>
              ) : (
                historique.map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid #f3f4f6', marginTop: i === 0 ? 4 : 0, fontSize: 12.5 }}>
                    <IonBadge style={{
                      background: h.action === 'CREATE' ? '#059669' : h.action === 'UPDATE' ? '#1a56db' : h.action === 'DELETE' ? '#dc2626' : '#6b7280',
                      color: '#fff', fontSize: 9.5, minWidth: 60, textAlign: 'center',
                    }}>
                      {h.action || '—'}
                    </IonBadge>
                    <div style={{ color: '#374151' }}>
                      {h.nomUtilisateur || sig.nomUtilisateurCreation || '—'}{' '}
                      <span style={{ color: '#9ca3af' }}>
                        {h.dateAction ? new Date(h.dateAction).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </IonContent>

      <IonAlert
        isOpen={confirmDelete}
        header="Supprimer le signalement ?"
        message="Cette action est irréversible."
        buttons={[
          { text: 'Annuler', role: 'cancel' },
          { text: 'Supprimer', role: 'destructive', handler: () => { void supprimer(); } },
        ]}
        onDidDismiss={() => setConfirmDelete(false)}
      />

      <IonToast isOpen={!!toast} message={toast} duration={2500} color={toastColor} onDidDismiss={() => setToast('')} />
    </IonPage>
  );
}

/**
 * Position d'un signalement depuis la base locale : géométrie GeoJSON
 * (table `geometrie_locale`, clé = entite_id), sinon l'ancien format {lat,lng}
 * de l'opération en attente (signalements créés avant la version géométrie).
 */
async function lirePositionGeometrie(entiteId: string): Promise<PointGeo | null> {
  try {
    const geo = await db.lireGeometrieLocale('signalement', entiteId);
    if (geo?.geojson) {
      const parsed = JSON.parse(geo.geojson) as { type?: string; coordinates?: number[] };
      if (parsed?.type === 'Point' && Array.isArray(parsed.coordinates) && parsed.coordinates.length >= 2) {
        // GeoJSON : [lng, lat]
        return { lat: Number(parsed.coordinates[1]), lng: Number(parsed.coordinates[0]) };
      }
    }
  } catch {
    /* pas de géométrie locale */
  }
  // Repli ancien format : l'opération en attente porte position {lat,lng}.
  try {
    const p = await db.trouverOperationPending(entiteId);
    const pos = JSON.parse(p?.position || 'null') as PointGeo | null;
    return pos;
  } catch {
    return null;
  }
}

/** Miniature photo serveur : le contenu est chargé AVEC le JWT puis affiché en data-url. */
function PhotoChargée({ idPhoto }: { idPhoto?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    if (!idPhoto) return;
    signalementApi
      .contenuPhoto(idPhoto)
      .then((d) => { if (actif) setSrc(d); })
      .catch(() => undefined);
    return () => { actif = false; };
  }, [idPhoto]);

  return src ? (
    <img
      src={src}
      alt="constat"
      style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', background: '#f3f4f6' }}
    />
  ) : (
    <div style={{
      width: 84, height: 84, borderRadius: 10, border: '1px solid #e2e8f0',
      background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9ca3af',
    }}>
      …
    </div>
  );
}
