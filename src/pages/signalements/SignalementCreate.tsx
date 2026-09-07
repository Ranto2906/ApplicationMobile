import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativePlatform } from '../../platform';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonLabel, IonInput, IonSelect, IonSelectOption, IonTextarea,
  IonSpinner, IonToast, IonText, IonIcon,
} from '@ionic/react';
import { chevronBack, locateOutline, cameraOutline, imagesOutline, cloudUploadOutline, downloadOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import type { GeolocationPosition } from '@capacitor/geolocation';
import L from 'leaflet';
import LeafletOfflineMap, { type PointGeo } from '../../components/LeafletOfflineMap';
import { signalementApi } from '../../services/signalementService';
import { db } from '../../services/db';
import { synchroniserSignalements } from '../../services/syncService';
import { telechargerZone, type OfflineTileLayer } from '../../services/offlineMap';
import { useOnline } from '../../hooks/useOnline';
import type { TypeSignalement, VilleSimple, SignalementRequest } from '../../types/signalement';

interface PhotoAttachee {
  dataUrl: string;
  nom: string;
  typePhoto?: string;
  datePrise?: string;
}

const CENTRE_MADAGASCAR: PointGeo = { lat: -18.8792, lng: 47.5079 };

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function SignalementCreate() {
  const history = useHistory();
  const online = useOnline();

  // Capacité locale : sur le mobile (natif) elle est toujours vraie ; sur le
  // web elle dépend de jeep-sqlite (<jeep-sqlite> défini + base ouverte).
  const sqliteOk =
    isNativePlatform() || !!(window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__;

  // Référentiels
  const [types, setTypes] = useState<TypeSignalement[]>([]);
  const [villes, setVilles] = useState<VilleSimple[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [refsFromCache, setRefsFromCache] = useState(false);

  // Formulaire
  const [typeId, setTypeId] = useState<number | undefined>();
  const [villeId, setVilleId] = useState<number | undefined>();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<PhotoAttachee[]>([]);
  const [position, setPosition] = useState<PointGeo | null>(null);
  // Métadonnées du relevé (précision GPS, source) — stockées avec la géométrie.
  const [precisionM, setPrecisionM] = useState<number | null>(null);
  const [originePosition, setOriginePosition] = useState<'gps' | 'carte' | null>(null);
  const [localisationMsg, setLocalisationMsg] = useState('');

  // Sauvegarde
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');

  // Carte hors-ligne
  const [downloadState, setDownloadState] = useState<string>(''); // '' | en cours | fait | erreur
  const [downloadProgress, setDownloadProgress] = useState<{ fait: number; total: number } | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const coucheRef = useRef<OfflineTileLayer | null>(null);
  const annulerDownload = useRef({ value: false });
  const [forceOffline, setForceOffline] = useState(false);

  // Référentiels : réseau d'abord, puis cache SQLite (formulaire utilisable hors-ligne).
  useEffect(() => {
    let actif = true;
    (async () => {
      const chargerDepuisCache = async () => {
        if (!sqliteOk) return;
        const [t, v] = await Promise.all([
          db.lireReferentiel('types_signalement').then((s) => (s ? JSON.parse(s) : [])),
          db.lireReferentiel('villes').then((s) => (s ? JSON.parse(s) : [])),
        ]);
        if (!actif) return;
        if (t.length > 0) setTypes(t);
        if (v.length > 0) setVilles(v);
        setRefsFromCache(true);
      };
      try {
        const [t, v] = await Promise.all([signalementApi.types(), signalementApi.villes()]);
        if (!actif) return;
        setTypes(t);
        setVilles(v);
        setRefsFromCache(false);
        // Prépare le formulaire pour la prochaine utilisation hors-ligne.
        // NB : le garde `actif` est important — sous React StrictMode (dev) les
        // effets sont montés/démontés/re-montés, et deux écritures concurrentes
        // sur la même clé SQLite pouvaient se marcher dessus (villes non
        // persistées). Seule l'instance d'effet encore active écrit.
        if (actif && sqliteOk) {
          await Promise.all([
            db.sauverReferentiel('types_signalement', JSON.stringify(t)).catch(() => undefined),
            db.sauverReferentiel('villes', JSON.stringify(v)).catch(() => undefined),
          ]);
        }
      } catch {
        // Hors-ligne : types/villes depuis le cache local (dernier fetch en ligne).
        if (actif) await chargerDepuisCache();
      } finally {
        if (actif) setLoadingRefs(false);
      }
    })();
    return () => { actif = false; };
  }, [sqliteOk]);

  // Détection hors-ligne → la carte n'essaie plus de télécharger.
  useEffect(() => { setForceOffline(!online); }, [online]);

  const onMapReady = useCallback((map: L.Map, couche: OfflineTileLayer) => {
    mapRef.current = map;
    coucheRef.current = couche;
  }, []);

  const utiliserMaPosition = useCallback(async () => {
    setLocalisationMsg('Localisation GPS en cours…');
    try {
      if (isNativePlatform()) {
        await Geolocation.requestPermissions();
      }
      const pos: GeolocationPosition = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
      });
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPosition(p);
      setPrecisionM(pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null);
      setOriginePosition('gps');
      setLocalisationMsg(`Position GPS (précision ±${Math.round(pos.coords.accuracy ?? 0)} m)`);
    } catch {
      setLocalisationMsg('Position GPS indisponible. Tapez sur la carte pour placer le point.');
    }
  }, []);

  const onCartePick = useCallback((p: PointGeo) => {
    setPosition(p);
    setPrecisionM(null);
    setOriginePosition('carte');
    setLocalisationMsg('');
  }, []);

  // ── Photos ──
  const ajouterPhotos = useCallback(async (source: CameraSource) => {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source,
        promptLabelHeader: 'Joindre une photo',
        promptLabelPhoto: 'Galerie',
        promptLabelPicture: 'Appareil photo',
      });
      const dataUrl = photo.dataUrl;
      if (dataUrl) {
        setPhotos((prev) => [
          ...prev,
          {
            dataUrl,
            nom: `photo_${Date.now()}.jpg`,
            typePhoto: 'constat',
            datePrise: new Date().toISOString().slice(0, 10),
          },
        ]);
      }
    } catch {
      // Utilisateur a annulé ou pas d'appareil — silencieux.
    }
  }, []);

  const retirerPhoto = useCallback((i: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  // ── Téléchargement de la zone visible (mode hors-ligne) ──
  const telechargerZoneVisible = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    setDownloadState('en cours');
    setDownloadProgress({ fait: 0, total: 0 });
    annulerDownload.current.value = false;
    try {
      const res = await telechargerZone(map, {
        minZoom: 10,
        maxZoom: 17,
        annuler: annulerDownload.current,
        onProgress: (fait, total) => setDownloadProgress({ fait, total }),
      });
      if (annulerDownload.current.value) {
        setDownloadState('annulé');
      } else if (res.echecs > 0 && res.reussies === 0) {
        setDownloadState('erreur');
      } else {
        setDownloadState('fait');
      }
    } catch (e) {
      setDownloadState('erreur');
      console.error(e);
    }
  }, []);

  // ── Sauvegarde (en ligne → API ; hors-ligne → SQLite) ──
  const enregistrer = useCallback(async () => {
    if (!typeId) {
      setToast('Veuillez choisir un type de signalement');
      setToastColor('danger');
      return;
    }
    if (!position) {
      setToast('Veuillez indiquer la position sur la carte (bouton GPS ou clic)');
      setToastColor('danger');
      return;
    }
    setSaving(true);
    try {
      // Position GPS → géométrie GeoJSON (table `geometrie` côté serveur, table
      // `geometrie_locale` côté mobile). Ordre GeoJSON : [longitude, latitude].
      const geojson = JSON.stringify({ type: 'Point', coordinates: [position.lng, position.lat] });
      const source = originePosition === 'gps' ? 'Import GPS' : 'Point carte';
      const request: SignalementRequest = {
        reference: undefined, // généré par le backend : SIG-AAAA-NNNN
        description: description.trim(),
        dateSignalement: new Date(date).toISOString(),
        idTypeSignalement: typeId,
        idVille: villeId,
        geometrie: {
          typeGeometrie: 'Point',
          geojson,
          precisionM: precisionM ?? undefined,
          source,
        },
      };
      // Miroir local : géométrie conservée sur l'appareil (affichage hors-ligne
      // et statut de synchronisation), même schéma que `geometrie` du serveur.
      const geometrieLocale = {
        entiteType: 'signalement',
        typeGeometrie: 'Point',
        geojson,
        precisionM,
        source,
      };

      const photoMetas: Array<{ dataUrl: string; typePhoto?: string; datePrise?: string; observation?: string }> =
        photos.map((p) => ({ dataUrl: p.dataUrl, typePhoto: p.typePhoto, datePrise: p.datePrise }));

      let idLocal: string | null = null;

      if (online) {
        try {
          const cree = await signalementApi.creer(request);
          if (sqliteOk) {
            await db.sauverGeometrieLocale({
              ...geometrieLocale,
              entiteId: cree.idSignalement,
              synchronise: 1, // déjà envoyée au serveur (payload du create)
            }).catch(() => undefined);
          }
          // Photos après création (endpoint multipart).
          let photosEnvoyees = 0;
          let photosEnEchec = 0;
          for (const p of photoMetas) {
            try {
              const form = new FormData();
              const blob = dataUrlVersBlob(p.dataUrl);
              form.append('fichier', blob, `signalement_${Date.now()}.png`);
              form.append('entiteType', 'signalement');
              form.append('entiteId', cree.idSignalement);
              form.append('typePhoto', p.typePhoto || 'constat');
              if (p.datePrise) form.append('datePrise', p.datePrise);
              await signalementApi.ajouterPhoto(form);
              photosEnvoyees += 1;
            } catch (e) {
              // Une photo en échec ne bloque pas la création, MAIS on le signale
              // à l'utilisateur (sinon la photo disparaît silencieusement).
              photosEnEchec += 1;
              console.warn('Photo non envoyée au serveur', e);
            }
          }
          setToast(
            `Signalement ${cree.reference || ''} créé ✔` +
            (photosEnEchec > 0
              ? ` — ${photosEnEchec}/${photoMetas.length} photo(s) non envoyée(s) au serveur`
              : photosEnvoyees > 0 ? ` — ${photosEnvoyees} photo(s) envoyée(s)` : '')
          );
          setToastColor(photosEnEchec > 0 ? 'danger' : 'success');
          setTimeout(() => history.replace('/tab/signalements'), 2600);
          return;
        } catch (e) {
          // Échec réseau/API pendant l'appel en ligne → repli file locale.
          console.warn('Échec API, repli local', e);
        }
      }

      // File locale (SQLite) : mode hors-ligne ou repli après échec API.
      if (!sqliteOk) {
        setToast(
          online
            ? 'Impossible d’enregistrer : le stockage local n’est pas disponible sur ce navigateur. Réessayez en ligne.'
            : 'Impossible d’enregistrer : hors-ligne et stockage local non disponible. Connectez-vous puis réessayez.'
        );
        setToastColor('danger');
        return;
      }

      idLocal = uuid();
      await db.ajouterOperationPending({
        idLocal,
        entiteType: 'signalement',
        action: 'CREATE',
        payload: JSON.stringify(request),
        photos: JSON.stringify(photoMetas),
        position: JSON.stringify(position),
        createdAt: new Date().toISOString(),
      });
      // Géométrie locale en attente d'envoi (synchronise=0) : elle sera poussée
      // vers la table `geometrie` du serveur lors de la synchronisation.
      await db.sauverGeometrieLocale({
        ...geometrieLocale,
        entiteId: idLocal,
        synchronise: 0,
      }).catch(() => undefined);
      setToast('Enregistré localement — synchronisation automatique au retour du réseau');
      setToastColor('success');
      setTimeout(() => history.replace('/tab/signalements'), 1500);
      void idLocal;
    } catch (e) {
      console.error(e);
      setToast('Erreur pendant l’enregistrement');
      setToastColor('danger');
    } finally {
      setSaving(false);
    }
  }, [typeId, position, precisionM, originePosition, description, date, villeId, photos, online, history]);

  // Synchroniser la file si on vient de repasser en ligne.
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    db.nombreOperationsPending().then(setPendingCount).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!online || syncing) return;
    (async () => {
      const n = await db.nombreOperationsPending().catch(() => 0);
      if (n === 0) return;
      setSyncing(true);
      try {
        const res = await synchroniserSignalements();
        setToast(`${res.reussis}/${res.total} signalement(s) synchronisé(s)`);
        setToastColor(res.echecs === 0 ? 'success' : 'danger');
      } finally {
        setSyncing(false);
        db.nombreOperationsPending().then(setPendingCount).catch(() => undefined);
      }
    })();
  }, [online, syncing]);

  const annuler = () => history.replace('/tab/signalements');

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonButtons slot="start">
            <IonButton onClick={annuler}>
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Nouveau signalement</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={telechargerZoneVisible} style={{ color: downloadState === 'en cours' ? '#fbbf24' : 'white' }}>
              <IonIcon icon={downloadOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {!online && (
          <div style={{
            background: '#fff8e1', border: '1px solid #f0e0a8', color: '#8a6d1d',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14,
          }}>
            📴 <b>Mode hors-ligne</b> — le signalement sera enregistré dans SQLite puis synchronisé
            automatiquement au retour du réseau.
          </div>
        )}

        {/* 1 · Localisation */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          1 · Localisation de l'agent
        </div>
        <LeafletOfflineMap
          center={CENTRE_MADAGASCAR}
          marker={position}
          interactif
          markerColor="#c53030"
          onPick={onCartePick}
          onMapReady={onMapReady}
          forceOffline={forceOffline}
          height={300}
        />
        {localisationMsg && (
          <div style={{ fontSize: 11.5, color: '#8a6d1d', marginTop: 6, background: '#fff8e1', padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IonSpinner name="dots" style={{ width: 14, height: 14 }} />
            {localisationMsg}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', margin: '6px 2px 10px' }}>
          📍 Tapez sur la carte pour placer le point, ou utilisez le GPS.
        </div>

        <IonButton
          expand="block"
          fill="outline"
          onClick={utiliserMaPosition}
          style={{ '--border-radius': 10, marginBottom: 16 }}
        >
          <IonIcon icon={locateOutline} slot="start" />
          Utiliser ma position
        </IonButton>

        {/* Position lue */}
        <IonItem lines="inset" style={{ '--background': 'transparent', marginBottom: 4 }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Latitude</IonLabel>
          <IonInput value={position ? String(position.lat.toFixed(6)) : ''} readonly placeholder="—" />
        </IonItem>
        <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: 14 }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Longitude</IonLabel>
          <IonInput value={position ? String(position.lng.toFixed(6)) : ''} readonly placeholder="—" />
        </IonItem>

        {/* 2 · Détails */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          2 · Détails du signalement
        </div>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Type de signalement *</IonLabel>
          <IonSelect
            value={typeId}
            placeholder="— Choisir un type —"
            onIonChange={(e) => setTypeId(Number(e.detail.value))}
            disabled={loadingRefs}
          >
            {types.map((t) => (
              <IonSelectOption key={t.idTypeSignalement} value={t.idTypeSignalement}>
                {t.libelle}
              </IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Ville</IonLabel>
          <IonSelect
            value={villeId}
            placeholder="— Choisir une ville —"
            onIonChange={(e) => setVilleId(Number(e.detail.value))}
            disabled={loadingRefs}
          >
            {villes.map((v) => (
              <IonSelectOption key={v.idVille} value={v.idVille}>{v.nomVille}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Date du signalement</IonLabel>
          <IonInput type="date" value={date} onIonInput={(e) => setDate(String(e.detail.value || ''))} />
        </IonItem>

        {/* 3 · Photos */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          3 · Photos (constat) — {photos.length}
        </div>
        {photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {photos.map((p, i) => (
              <div key={`${p.nom}-${i}`} style={{ position: 'relative', width: 84, height: 84, borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <img src={p.dataUrl} alt={p.nom} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => retirerPhoto(i)}
                  style={{
                    position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: '50%',
                    background: 'rgba(0,0,0,.6)', color: 'white', border: 'none', fontSize: 12,
                    lineHeight: '20px', cursor: 'pointer', padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <IonButton expand="block" fill="outline" onClick={() => ajouterPhotos(CameraSource.Camera)}>
            <IonIcon icon={cameraOutline} slot="start" />
            Appareil
          </IonButton>
          <IonButton expand="block" fill="outline" onClick={() => ajouterPhotos(CameraSource.Photos)}>
            <IonIcon icon={imagesOutline} slot="start" />
            Galerie
          </IonButton>
        </div>

        {/* 4 · Observation */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          4 · Observation
        </div>
        <IonTextarea
          rows={4}
          placeholder="Décrivez la situation constatée sur le terrain…"
          value={description}
          onIonInput={(e) => setDescription(String(e.detail.value || ''))}
          style={{ background: 'white', borderRadius: 10, border: '1px solid #e2e8f0', padding: '6px 8px' }}
        />

        {/* Carte hors-ligne */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' }}>
          📥 Carte hors-ligne
        </div>
        <div style={{ background: '#eaf2f8', borderRadius: 10, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          Téléchargez la zone visible (zooms 10 → 17) pour consulter la carte sans connexion.
        </div>
        {downloadProgress && downloadState === 'en cours' && (
          <div style={{ marginBottom: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <IonText color="medium">Téléchargement des tuiles…</IonText>
              <b>{downloadProgress.fait}/{downloadProgress.total}</b>
            </div>
            <div style={{ background: '#e2e8f0', borderRadius: 6, height: 6, overflow: 'hidden' }}>
              <div style={{
                width: downloadProgress.total > 0 ? `${Math.round((downloadProgress.fait / downloadProgress.total) * 100)}%` : '0%',
                background: '#1a56db', height: '100%', transition: 'width .3s',
              }} />
            </div>
          </div>
        )}
        {downloadState === 'fait' && (
          <div style={{ color: '#059669', fontSize: 12, marginBottom: 8 }}>✔ Zone téléchargée — disponible hors-ligne.</div>
        )}
        {downloadState === 'erreur' && (
          <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>
            Téléchargement impossible (zone trop grande ? hors-ligne ?). Zoomez ou vérifiez la connexion.
          </div>
        )}
        <IonButton
          expand="block"
          color="tertiary"
          onClick={telechargerZoneVisible}
          disabled={downloadState === 'en cours' || !!forceOffline}
          style={{ '--border-radius': 10, marginBottom: 24 }}
        >
          <IonIcon icon={cloudUploadOutline} slot="start" />
          {downloadState === 'en cours' ? 'Téléchargement…' : 'Télécharger cette zone'}
        </IonButton>

        {/* Sauvegarde */}
        <IonButton
          expand="block"
          disabled={saving}
          onClick={enregistrer}
          style={{ '--border-radius': 12, height: 50, fontWeight: 700, marginBottom: 30, '--background': '#1a56db' }}
        >
          {saving ? <IonSpinner name="crescent" /> : '💾 Enregistrer le signalement'}
        </IonButton>

        {pendingCount > 0 && (
          <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8a6d1d', paddingBottom: 20 }}>
            {pendingCount} signalement(s) en attente de synchronisation
          </div>
        )}
      </IonContent>

      <IonToast
        isOpen={!!toast}
        message={toast}
        duration={2500}
        color={toastColor}
        onDidDismiss={() => setToast('')}
      />
    </IonPage>
  );
}

/** dataUrl → Blob pour l'upload multipart. */
function dataUrlVersBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
