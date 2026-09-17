import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent,
  IonSpinner, IonToast, IonBadge, IonAlert,
} from '@ionic/react';
import { chevronBack, trashOutline, syncOutline } from 'ionicons/icons';
import { useHistory, useParams } from 'react-router-dom';
import { descenteTerrainApi } from '../../services/descenteTerrainService';
import { db, type PendingOperation } from '../../services/db';
import { synchroniserSignalements } from '../../services/syncService';
import { useOnline } from '../../hooks/useOnline';
import type { DescenteTerrainDTO } from '../../types/descenteTerrain';

interface RouteParams { id: string }

const COULEURS_STATUT: Record<string, string> = {
  conforme: '#059669', 'non conforme': '#dc2626', 'en attente': '#b7791f',
  'occupation illicite': '#c53030', 'construction illegale': '#7c3aed',
};

const COULEURS_VALIDATION: Record<string, string> = {
  'en attente': '#b7791f', valide: '#059669', rejete: '#dc2626', 'complement demande': '#8b5cf6',
};

export default function DescenteTerrainDetail() {
  const { id } = useParams<RouteParams>();
  const history = useHistory();
  const online = useOnline();

  const [dt, setDt] = useState<DescenteTerrainDTO | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const [photos, setPhotos] = useState<Array<{ idPhoto?: number }>>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const lastLoadedRef = useRef<{ id: string; online: boolean } | null>(null);

  const charger = useCallback(async () => {
    if (lastLoadedRef.current?.id === id && lastLoadedRef.current?.online === online) {
      return;
    }
    lastLoadedRef.current = { id, online };

    setLoading(true);
    try {
      // 1) Brouillon local ?
      let p: PendingOperation | null = null;
      try {
        p = await db.trouverOperationPending(id);
      } catch (e) {
        console.warn('[SEIMAD:DescenteDetail] base locale indisponible', e);
      }
      setPending(p);
      if (p) {
        const payload = JSON.parse(p.payload) as DescenteTerrainDTO;
        setDt({
          idDescente: p.idLocal,
          reference: 'Brouillon local',
          dateDescente: payload.dateDescente,
          statutConstat: payload.statutConstat || 'En attente',
          observation: payload.observation,
          mode: payload.mode || 'offline',
          validation: 'En attente',
          demandeurNom: payload.demandeurNom,
          demandeurContact: payload.demandeurContact,
          dossierNumero: payload.dossierNumero,
          dossierSuperficie: payload.dossierSuperficie,
          dossierPropriete: payload.dossierPropriete,
          dossierParcelles: payload.dossierParcelles,
          dossierVille: payload.dossierVille,
          synchronise: 0,
        });
        setPhotos([]);
        return;
      }

      // 2) Serveur
      if (online) {
        try {
          const s = await descenteTerrainApi.trouver(id);
          setDt(s);
          const ph = await descenteTerrainApi.photos(id).catch(() => []);
          setPhotos(Array.isArray(ph) ? ph : []);
          return;
        } catch {
          return;
        }
      }

      setDt(null);
    } catch {
      setDt(null);
    } finally {
      setLoading(false);
    }
  }, [id, online]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (online && dt) {
      const t = setTimeout(() => charger(), 1500);
      return () => clearTimeout(t);
    }
  }, [online]);

  // Chargement des URLs des photos serveur
  useEffect(() => {
    if (!photos.length) return;
    let actif = true;
    (async () => {
      for (const p of photos) {
        if (!p.idPhoto || photoUrls[p.idPhoto]) continue;
        try {
          const url = await descenteTerrainApi.contenuPhoto(p.idPhoto);
          if (actif) setPhotoUrls((prev) => ({ ...prev, [p.idPhoto!]: url }));
        } catch { /* ignore */ }
      }
    })();
    return () => { actif = false; };
  }, [photos]);

  const synchroniserUn = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await synchroniserSignalements();
      if (res.reussis > 0) {
        setToast('Descente synchronisée ✔');
        setToastColor('success');
        if (pending) {
          setTimeout(() => history.replace('/tab/descente-terrain'), 900);
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
      } else {
        await descenteTerrainApi.supprimer(id);
      }
      setToast('Descente supprimée');
      setTimeout(() => history.replace('/tab/descente-terrain'), 800);
    } catch {
      setToast('Suppression impossible');
      setToastColor('danger');
    }
  }, [id, pending, history]);

  const estLocal = !!pending;

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
        <IonToolbar style={{ '--background': '#0d435d', '--color': 'white' }}>
          <IonButtons slot="start">
            <IonButton onClick={() => history.replace('/tab/descente-terrain')}>
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Détail descente</IonTitle>
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
        ) : !dt ? (
          <div style={{ textAlign: 'center', padding: 50, color: '#9ca3af' }}>
            <p>Descente introuvable.</p>
            {!online && <p style={{ fontSize: 12 }}>Hors-ligne : cette descente n'est pas dans la base locale.</p>}
            <IonButton onClick={() => history.replace('/tab/descente-terrain')}>Retour</IonButton>
          </div>
        ) : (
          <>
            {/* En-tête */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 14, marginBottom: 14,
              border: '1px solid #e2e8f0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{dt.reference || dt.idDescente.slice(0, 8)}</h2>
                <IonBadge style={{ background: COULEURS_STATUT[(dt.statutConstat || '').toLowerCase()] || '#6b7280', color: '#fff', fontSize: 10.5 }}>
                  {dt.statutConstat}
                </IonBadge>
                <IonBadge style={{ background: COULEURS_VALIDATION[(dt.validation || '').toLowerCase()] || '#6b7280', color: '#fff', fontSize: 10.5 }}>
                  {dt.validation}
                </IonBadge>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11.5, color: '#9ca3af' }}>
                {dt.mode === 'offline' ? '📴 Hors ligne' : '🌐 En ligne'} · {formaterDate(dt.dateDescente)}
              </p>
            </div>

            {/* Informations dossier */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📄 Informations du dossier</b>
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
                {dt.dossierNumero && <div><b>Numéro :</b> {dt.dossierNumero}</div>}
                {dt.demandeurNom && <div><b>Demandeur :</b> {dt.demandeurNom}</div>}
                {dt.demandeurContact && <div><b>Contact :</b> {dt.demandeurContact}</div>}
                {dt.dossierSuperficie != null && <div><b>Superficie :</b> {dt.dossierSuperficie} m²</div>}
                {dt.dossierVille && <div><b>Ville :</b> {dt.dossierVille}</div>}
                {!dt.dossierNumero && !dt.demandeurNom && (
                  <p style={{ color: '#9ca3af' }}>Aucune information dossier renseignée.</p>
                )}
              </div>
            </div>

            {/* Localisation */}
            {(dt.dossierPropriete || dt.dossierParcelles || dt.numeroPropriete || dt.numeroLot) && (
              <div style={{
                background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
              }}>
                <b style={{ fontSize: 13 }}>🗺 Propriété et parcelles</b>
                <div style={{ marginTop: 8, fontSize: 12.5, color: '#374151', lineHeight: 1.7 }}>
                  {(dt.dossierPropriete || dt.numeroPropriete) && (
                    <div><b>Propriété :</b> {dt.dossierPropriete || dt.numeroPropriete}</div>
                  )}
                  {parseParcelles(dt.dossierParcelles).map((par, i) => (
                    <div key={`${par.numeroLot}-${i}`} style={{
                      background: '#f8fafc', borderRadius: 8, padding: '6px 10px', marginTop: 4,
                      display: 'flex', justifyContent: 'space-between', gap: 8,
                    }}>
                      <span>📐 Lot <b>{par.numeroLot}</b></span>
                      {par.superficieM2 != null && <span style={{ color: '#6b7280' }}>{par.superficieM2} m²</span>}
                    </div>
                  ))}
                  {!dt.dossierParcelles && dt.numeroLot && (
                    <div>📐 Lot : <b>{dt.numeroLot}</b></div>
                  )}
                  {(dt.superficieM2 != null || dt.dossierSuperficie != null) && (
                    <div><b>Superficie :</b> {dt.superficieM2 ?? dt.dossierSuperficie} m²</div>
                  )}
                  {(dt.dossierVille || dt.nomVille) && <div><b>Ville :</b> {dt.dossierVille || dt.nomVille}</div>}
                </div>
              </div>
            )}

            {/* Observation */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📝 Observation</b>
              <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: '#374151', whiteSpace: 'pre-wrap' }}>
                {dt.observation || '—'}
              </p>
            </div>

            {/* Photos */}
            <div style={{
              background: 'white', borderRadius: 14, padding: 12, marginBottom: 14, border: '1px solid #e2e8f0',
            }}>
              <b style={{ fontSize: 13 }}>📷 Photos du constat ({estLocal ? photosLocales.length : photos.length})</b>
              {estLocal && photosLocales.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {photosLocales.map((p, i) => (
                    <img key={i} src={p.dataUrl} alt="constat local"
                      style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                  ))}
                </div>
              ) : photos.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {photos.map((p) => (
                    p.idPhoto ? (
                      photoUrls[p.idPhoto] ? (
                        <img key={p.idPhoto} src={photoUrls[p.idPhoto]} alt="constat"
                          style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                      ) : (
                        <div key={p.idPhoto} style={{
                          width: 84, height: 84, borderRadius: 10, border: '1px solid #e2e8f0',
                          background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <IonSpinner name="dots" />
                        </div>
                      )
                    ) : null
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 8, background: '#f8fafc', border: '1px dashed #d1d5db', borderRadius: 10, padding: '14px 10px', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
                  Aucune photo jointe.
                </div>
              )}
            </div>

            {/* Brouillon local → bouton sync */}
            {estLocal && (
              <IonButton expand="block" onClick={synchroniserUn} disabled={syncing || !online}
                style={{ '--border-radius': 12, marginBottom: 10 }}>
                <IonIcon icon={syncOutline} slot="start" />
                {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
              </IonButton>
            )}
          </>
        )}
      </IonContent>

      <IonAlert
        isOpen={confirmDelete}
        header="Supprimer la descente ?"
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

/** Parse le JSON des parcelles multiples (persisté côté backend). */
function parseParcelles(json?: string): Array<{ numeroLot?: string; superficieM2?: number }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<{ numeroLot?: string; superficieM2?: number }>;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
