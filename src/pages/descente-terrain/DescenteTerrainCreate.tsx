import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonLabel, IonInput, IonSelect, IonSelectOption, IonTextarea,
  IonSpinner, IonToast, IonIcon, IonSegment, IonSegmentButton, IonList,
} from '@ionic/react';
import { chevronBack, cameraOutline, imagesOutline, addOutline, closeCircleOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { descenteTerrainApi } from '../../services/descenteTerrainService';
import { db } from '../../services/db';
import localApi from '../../services/localApi';
import { synchroniserSignalements } from '../../services/syncService';
import { useOnline } from '../../hooks/useOnline';
import type {
  DossierSearchResult, StatutConstat, DescenteTerrainRequest, ParcelleSnapshot,
} from '../../types/descenteTerrain';

const STATUTS_CONSTAT: StatutConstat[] = [
  'Conforme', 'Non conforme', 'En attente', 'Occupation illicite', 'Construction illegale',
];

/** Une parcelle saisie/attachée dans le formulaire (texte libre en hors-ligne). */
interface ParcelleForm {
  numeroLot: string;
  superficieM2: string;
}

export default function DescenteTerrainCreate() {
  const history = useHistory();
  const online = useOnline();

  // Mode online/offline
  const [mode, setMode] = useState<'online' | 'offline'>(online ? 'online' : 'offline');

  // Recherche dossier (online)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DossierSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dossierSelected, setDossierSelected] = useState<DossierSearchResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Formulaire
  const [dateDescente, setDateDescente] = useState(() => new Date().toISOString().slice(0, 10));
  const [statutConstat, setStatutConstat] = useState<StatutConstat>('En attente');
  const [observation, setObservation] = useState('');
  const [photos, setPhotos] = useState<Array<{ dataUrl: string; nom: string; typePhoto?: string; datePrise?: string }>>([]);

  // Informations du dossier (snapshots — saisie libre hors-ligne, préremplies en ligne)
  const [dossierNumero, setDossierNumero] = useState('');
  const [demandeurNom, setDemandeurNom] = useState('');
  const [demandeurContact, setDemandeurContact] = useState('');
  const [dossierSuperficie, setDossierSuperficie] = useState('');
  const [dossierPropriete, setDossierPropriete] = useState('');
  // Une ou plusieurs parcelles liées à cette propriété
  const [parcelles, setParcelles] = useState<ParcelleForm[]>([]);
  const [dossierVille, setDossierVille] = useState('');

  // Sauvegarde
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger'>('success');

  // Sync auto
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
        setToast(`${res.reussis}/${res.total} opération(s) synchronisée(s)`);
        setToastColor(res.echecs === 0 ? 'success' : 'danger');
      } finally {
        setSyncing(false);
        db.nombreOperationsPending().then(setPendingCount).catch(() => undefined);
      }
    })();
  }, [online, syncing]);

  // ── Recherche de dossiers (online) ──
  const rechercherDossiers = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await descenteTerrainApi.rechercherDossiers(q.trim());
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => rechercherDossiers(searchQuery), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, rechercherDossiers]);

  const selectionnerDossier = useCallback((d: DossierSearchResult) => {
    setDossierSelected(d);
    // Les informations du dossier sont embarquées automatiquement (mode en ligne) :
    // snapshots préremplis + idDossierParcelle envoyé au backend.
    setDossierNumero(d.numeroDossier || '');
    setDemandeurNom(d.demandeurNom || '');
    setDemandeurContact(d.demandeurContact || '');
    setDossierSuperficie(d.superficie != null ? String(d.superficie) : '');
    setDossierPropriete(d.propriete || '');
    setParcelles(d.parcelle ? [{ numeroLot: d.parcelle, superficieM2: d.superficie != null ? String(d.superficie) : '' }] : []);
    setDossierVille(d.ville || '');
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const retirerDossier = useCallback(() => {
    setDossierSelected(null);
    setDossierNumero('');
    setDemandeurNom('');
    setDemandeurContact('');
    setDossierSuperficie('');
    setDossierPropriete('');
    setParcelles([]);
    setDossierVille('');
  }, []);

  // ── Parcelles multiples liées à la propriété ──
  const ajouterParcelle = useCallback(() => {
    setParcelles((prev) => [...prev, { numeroLot: '', superficieM2: '' }]);
  }, []);

  const retirerParcelle = useCallback((i: number) => {
    setParcelles((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const majParcelle = useCallback((i: number, champ: keyof ParcelleForm, valeur: string) => {
    setParcelles((prev) => prev.map((p, idx) => (idx === i ? { ...p, [champ]: valeur } : p)));
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
    } catch { /* annulé */ }
  }, []);

  const retirerPhoto = useCallback((i: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  // ── Sauvegarde ──
  const enregistrer = useCallback(async () => {
    if (!dateDescente) {
      setToast('Veuillez saisir la date de la descente');
      setToastColor('danger');
      return;
    }
    if (mode === 'online' && !dossierSelected && !dossierNumero) {
      setToast('Veuillez rechercher et sélectionner un dossier');
      setToastColor('danger');
      return;
    }
    if (!demandeurNom.trim()) {
      setToast('Veuillez saisir le nom du demandeur');
      setToastColor('danger');
      return;
    }
    // Parcelles : on ignore les lignes vides, mais une ligne commencée doit être complétée.
    const parcellesPropres = parcelles.filter((p) => p.numeroLot.trim() || p.superficieM2.trim());
    if (parcellesPropres.some((p) => !p.numeroLot.trim())) {
      setToast('Veuillez indiquer le n° de lot de chaque parcelle');
      setToastColor('danger');
      return;
    }
    setSaving(true);
    try {
      // Snapshots embarqués dans le payload : utilisables tels quels hors-ligne,
      // et persistés par le backend à la synchronisation (mode online également).
      const parcelleSnapshots: ParcelleSnapshot[] = parcellesPropres.map((p) => ({
        numeroLot: p.numeroLot.trim(),
        superficieM2: p.superficieM2.trim() ? Number(p.superficieM2) : undefined,
      }));

      const request: DescenteTerrainRequest = {
        dateDescente: new Date(dateDescente).toISOString(),
        statutConstat,
        observation: observation.trim(),
        mode,
        dossierNumero: dossierNumero || undefined,
        demandeurNom: demandeurNom.trim() || undefined,
        demandeurContact: demandeurContact || undefined,
        dossierSuperficie: dossierSuperficie ? Number(dossierSuperficie) : undefined,
        dossierPropriete: dossierPropriete.trim() || undefined,
        dossierParcelles: parcelleSnapshots.length > 0 ? parcelleSnapshots : undefined,
        dossierVille: dossierVille || undefined,
        // Mode en ligne : le dossier sélectionné est embarqué dans le payload
        // (rattachement serveur exact via la ligne dossier_parcelle).
        idDossierParcelle: dossierSelected?.idDossierParcelle || undefined,
      };

      const photoMetas = photos.map((p) => ({
        dataUrl: p.dataUrl,
        typePhoto: p.typePhoto,
        datePrise: p.datePrise,
      }));

      if (online) {
        try {
          const cree = await descenteTerrainApi.creer(request);
          let photosEnvoyees = 0;
          let photosEnEchec = 0;
          for (const p of photoMetas) {
            try {
              const form = new FormData();
              const blob = dataUrlVersBlob(p.dataUrl);
              form.append('fichier', blob, `descente_${Date.now()}.png`);
              form.append('entiteType', 'descente_terrain');
              form.append('entiteId', cree.idDescente);
              if (p.typePhoto) form.append('typePhoto', p.typePhoto);
              if (p.datePrise) form.append('datePrise', p.datePrise);
              await descenteTerrainApi.ajouterPhoto(form);
              photosEnvoyees += 1;
            } catch {
              photosEnEchec += 1;
            }
          }
          setToast(
            `Descente ${cree.reference || ''} créée ✔` +
            (photosEnEchec > 0
              ? ` — ${photosEnEchec}/${photoMetas.length} photo(s) non envoyée(s)`
              : photosEnvoyees > 0 ? ` — ${photosEnvoyees} photo(s) envoyée(s)` : '')
          );
          setToastColor(photosEnEchec > 0 ? 'danger' : 'success');
          setTimeout(() => history.replace('/tab/descente-terrain'), 2600);
          return;
        } catch (e) {
          console.warn('Échec API, repli local', e);
        }
      }

      // File locale (SQLite via l'API locale de l'application) : mode hors-ligne
      // ou repli après échec API. La synchronisation poussera ce même payload.
      if (!(window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__ && !/capacitor|ionic/i.test(navigator.userAgent)) {
        setToast('Impossible d’enregistrer : stockage local indisponible. Connectez-vous puis réessayez.');
        setToastColor('danger');
        return;
      }
      await localApi.post('/descente-terrain', { ...request, photos: photoMetas });
      setToast('Enregistré localement — synchronisation au retour du réseau');
      setToastColor('success');
      setTimeout(() => history.replace('/tab/descente-terrain'), 1500);
    } catch (e) {
      console.error(e);
      setToast('Erreur pendant l\'enregistrement');
      setToastColor('danger');
    } finally {
      setSaving(false);
    }
  }, [mode, dateDescente, statutConstat, observation, dossierNumero, demandeurNom,
      demandeurContact, dossierSuperficie, dossierPropriete, parcelles, dossierVille,
      dossierSelected, photos, online, history]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#0d435d', '--color': 'white' }}>
          <IonButtons slot="start">
            <IonButton onClick={() => history.replace('/tab/descente-terrain')}>
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>Nouvelle descente</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {!online && (
          <div style={{
            background: '#fff8e1', border: '1px solid #f0e0a8', color: '#8a6d1d',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14,
          }}>
            📴 <b>Mode hors-ligne</b> — la descente sera enregistrée dans SQLite puis synchronisée
            automatiquement au retour du réseau.
          </div>
        )}

        {/* 1 · Mode de fonctionnement */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          1 · Mode de fonctionnement
        </div>
        <IonSegment value={mode} onIonChange={(e) => setMode(e.detail.value as 'online' | 'offline')}>
          <IonSegmentButton value="online" disabled={!online}>
            <IonLabel>🌐 En ligne</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="offline">
            <IonLabel>📴 Hors ligne</IonLabel>
          </IonSegmentButton>
        </IonSegment>

        {/* 2 · Recherche dossier (online uniquement) */}
        {mode === 'online' && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
              2 · Recherche du dossier
            </div>
            <IonItem lines="inset" style={{ '--background': 'transparent' }}>
              <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>
                Rechercher un dossier (n°, demandeur, propriété…)
              </IonLabel>
              <IonInput
                value={searchQuery}
                onIonInput={(e) => setSearchQuery(String(e.detail.value || ''))}
                placeholder="Tapez au moins 2 caractères…"
              />
            </IonItem>
            {searching && (
              <div style={{ textAlign: 'center', padding: 10 }}>
                <IonSpinner name="dots" />
              </div>
            )}
            {searchResults.length > 0 && (
              <IonList style={{ border: '1px solid #e2e8f0', borderRadius: 10, maxHeight: 200, overflow: 'auto' }}>
                {searchResults.map((d) => (
                  <IonItem
                    key={d.numeroDossier}
                    button
                    onClick={() => selectionnerDossier(d)}
                    lines="inset"
                    style={{ '--min-height': '48px' }}
                  >
                    <IonLabel>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.numeroDossier}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {d.demandeurNom}{d.ville ? ` · ${d.ville}` : ''}{d.propriete ? ` · ${d.propriete}` : ''}
                      </div>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonList>
            )}
            {dossierSelected && (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10,
                padding: '10px 12px', fontSize: 12, lineHeight: 1.5, marginBottom: 10, marginTop: 8,
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8,
              }}>
                <div>
                  ✔ Dossier sélectionné : <b>{dossierSelected.numeroDossier}</b>
                  <div style={{ color: '#374151', marginTop: 4 }}>
                    Les informations ci-dessous ont été embarquées automatiquement.
                  </div>
                </div>
                <button
                  onClick={retirerDossier}
                  style={{
                    background: 'transparent', border: 'none', color: '#dc2626',
                    fontSize: 18, cursor: 'pointer', padding: 0, lineHeight: 1,
                  }}
                  aria-label="Retirer le dossier"
                >
                  <IonIcon icon={closeCircleOutline} />
                </button>
              </div>
            )}
          </>
        )}

        {/* 2b · Informations du dossier (saisie libre, préremplies en ligne) */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          {mode === 'online' ? '3' : '2'} · Informations du dossier
        </div>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Numéro dossier</IonLabel>
          <IonInput value={dossierNumero} onIonInput={(e) => setDossierNumero(String(e.detail.value || ''))} placeholder="Ex: DOS-2026-0001" />
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Nom du demandeur *</IonLabel>
          <IonInput value={demandeurNom} onIonInput={(e) => setDemandeurNom(String(e.detail.value || ''))} placeholder="Nom complet" />
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Contact</IonLabel>
          <IonInput value={demandeurContact} onIonInput={(e) => setDemandeurContact(String(e.detail.value || ''))} placeholder="Téléphone / email" />
        </IonItem>

        {/* Propriété + parcelles liées */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          Propriété et parcelles
        </div>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Propriété</IonLabel>
          <IonInput value={dossierPropriete} onIonInput={(e) => setDossierPropriete(String(e.detail.value || ''))} placeholder="N° / nom de la propriété" />
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Superficie totale (m²)</IonLabel>
          <IonInput type="number" inputmode="decimal" value={dossierSuperficie} onIonInput={(e) => setDossierSuperficie(String(e.detail.value || ''))} placeholder="0" />
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Ville</IonLabel>
          <IonInput value={dossierVille} onIonInput={(e) => setDossierVille(String(e.detail.value || ''))} placeholder="Nom de la ville" />
        </IonItem>

        {parcelles.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {parcelles.map((p, i) => (
              <div key={i} style={{
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
                padding: '10px 12px', marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <b style={{ fontSize: 12, color: '#374151' }}>Parcelle {i + 1}</b>
                  <button
                    onClick={() => retirerParcelle(i)}
                    style={{ background: 'transparent', border: 'none', color: '#dc2626', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}
                    aria-label="Retirer la parcelle"
                  >
                    <IonIcon icon={closeCircleOutline} />
                  </button>
                </div>
                <IonItem lines="none" style={{ '--background': 'transparent', '--padding-start': 0 }}>
                  <IonLabel position="stacked" style={{ fontSize: 11, color: '#6b7280' }}>N° de lot *</IonLabel>
                  <IonInput
                    value={p.numeroLot}
                    onIonInput={(e) => majParcelle(i, 'numeroLot', String(e.detail.value || ''))}
                    placeholder="Ex: Lot 12A"
                  />
                </IonItem>
                <IonItem lines="none" style={{ '--background': 'transparent', '--padding-start': 0 }}>
                  <IonLabel position="stacked" style={{ fontSize: 11, color: '#6b7280' }}>Superficie (m²)</IonLabel>
                  <IonInput
                    type="number"
                    inputmode="decimal"
                    value={p.superficieM2}
                    onIonInput={(e) => majParcelle(i, 'superficieM2', String(e.detail.value || ''))}
                    placeholder="0"
                  />
                </IonItem>
              </div>
            ))}
          </div>
        )}
        <IonButton expand="block" fill="outline" onClick={ajouterParcelle} style={{ '--border-radius': 10 }}>
          <IonIcon icon={addOutline} slot="start" />
          Ajouter une parcelle liée à cette propriété
        </IonButton>

        {/* 3/4 · Détails de la descente */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 8px' }}>
          {mode === 'online' ? '4' : '3'} · Détails de la descente
        </div>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Date de la descente *</IonLabel>
          <IonInput type="date" value={dateDescente} onIonInput={(e) => setDateDescente(String(e.detail.value || ''))} />
        </IonItem>
        <IonItem lines="inset" style={{ '--background': 'transparent' }}>
          <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>Statut du constat</IonLabel>
          <IonSelect
            value={statutConstat}
            onIonChange={(e) => setStatutConstat(e.detail.value as StatutConstat)}
          >
            {STATUTS_CONSTAT.map((s) => (
              <IonSelectOption key={s} value={s}>{s}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>

        {/* 4/5 · Observation */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          {mode === 'online' ? '5' : '4'} · Observation
        </div>
        <IonTextarea
          rows={4}
          placeholder="Décrivez les constatations faites sur le terrain…"
          value={observation}
          onIonInput={(e) => setObservation(String(e.detail.value || ''))}
          style={{ background: 'white', borderRadius: 10, border: '1px solid #e2e8f0', padding: '6px 8px' }}
        />

        {/* 5/6 · Photos */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          {mode === 'online' ? '6' : '5'} · Photos du constat — {photos.length}
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
                >✕</button>
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

        {/* Sauvegarde */}
        <IonButton
          expand="block"
          disabled={saving}
          onClick={enregistrer}
          style={{ '--border-radius': 12, height: 50, fontWeight: 700, marginTop: 24, marginBottom: 30, '--background': '#176b87' }}
        >
          {saving ? <IonSpinner name="crescent" /> : '💾 Enregistrer la descente'}
        </IonButton>

        {pendingCount > 0 && (
          <div style={{ textAlign: 'center', fontSize: 11.5, color: '#8a6d1d', paddingBottom: 20 }}>
            {pendingCount} opération(s) en attente de synchronisation
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

function dataUrlVersBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
