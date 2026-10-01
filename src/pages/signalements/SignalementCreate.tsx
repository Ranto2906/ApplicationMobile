import { useCallback, useEffect, useRef, useState } from 'react';
import { isNativePlatform } from '../../platform';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent,
  IonItem, IonLabel, IonInput, IonSelect, IonSelectOption, IonTextarea,
  IonSpinner, IonToast, IonText, IonIcon,
} from '@ionic/react';
import { chevronBack, locateOutline, cameraOutline, imagesOutline, cloudUploadOutline, downloadOutline } from 'ionicons/icons';
import { useHistory, useParams } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import type { GeolocationPosition } from '@capacitor/geolocation';
import L from 'leaflet';
import LeafletOfflineMap, { type PointGeo } from '../../components/LeafletOfflineMap';
import { signalementApi } from '../../services/signalementService';
import type { ProprieteSimple } from '../../types/signalement';
import { db, type PendingOperation } from '../../services/db';
import localApi from '../../services/localApi';
import { synchroniserSignalements, refilerPhotosEchouees } from '../../services/syncService';
import { telechargerZone, type OfflineTileLayer } from '../../services/offlineMap';
import { useOnline } from '../../hooks/useOnline';
import { TYPES_SIGNALEMENT_DEFAUT, VILLES_DEFAUT } from '../../services/referentielsDefauts';
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

  // ── Mode édition : /tab/signalements/modifier/:id ──
  const { id: idModification } = useParams<{ id?: string }>();
  const modeEdition = !!idModification;
  const [chargementEdition, setChargementEdition] = useState(modeEdition);
  /** Vrai si l'id désigne un brouillon local (CREATE en file, jamais synchronisé). */
  const [brouillonLocal, setBrouillonLocal] = useState(false);
  /** Photos déjà présentes sur le serveur (affichage seul — seules les nouvelles sont envoyées). */
  const [photosServeur, setPhotosServeur] = useState<string[]>([]);
  /** Propriété rattachée au signalement (à résoudre dans le référentiel chargé). */
  const [idProprieteSignalee, setIdProprieteSignalee] = useState<number | null>(null);

  // Capacité locale : sur le mobile (natif) elle est toujours vraie ; sur le
  // web elle dépend de jeep-sqlite (<jeep-sqlite> défini + base ouverte).
  const sqliteOk =
    isNativePlatform() || !!(window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__;

  // Référentiels
  const [types, setTypes] = useState<TypeSignalement[]>([]);
  const [villes, setVilles] = useState<VilleSimple[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [refsFromCache, setRefsFromCache] = useState(false);

  // Propriété concernée (recherche en ligne, choix du cache hors-ligne, saisie manuelle)
  const [proprietesCache, setProprietesCache] = useState<ProprieteSimple[]>([]);
  const [propRecherche, setPropRecherche] = useState('');
  const [propResultats, setPropResultats] = useState<ProprieteSimple[]>([]);
  const [propRechercheEnCours, setPropRechercheEnCours] = useState(false);
  const [proprieteChoisie, setProprieteChoisie] = useState<ProprieteSimple | null>(null);
  const [proprieteManuelle, setProprieteManuelle] = useState('');
  const [modeSaisiePropriete, setModeSaisiePropriete] = useState<'recherche' | 'manuelle'>('recherche');

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
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

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
      // Repli hors-ligne : cache SQLite d'abord, puis référentiels embarqués
      // (TYPES_SIGNALEMENT_DEFAUT / VILLES_DEFAUT). Chaque étape est protégée :
      // sur le terrain (rechargement hors-ligne, base pas encore initialisée)
      // une exception SQLite ne doit pas laisser le formulaire bloqué avec des
      // listes « Type » et « Ville » vides.
      // NB : un timeout est indispensable — le bug connu « rechargement de page
      // → initWebStore jamais résolu » fait HANGUER (et non échouer) les
      // lectures SQLite ; sans lui, le formulaire resterait bloqué en chargement.
      const avecTimeout = <T,>(p: Promise<T>, ms: number, repli: T): Promise<T> =>
        Promise.race([
          p,
          new Promise<T>((resolve) => setTimeout(() => resolve(repli), ms)),
        ]);
      const chargerDepuisCache = async () => {
        let t: TypeSignalement[] = [];
        let v: VilleSimple[] = [];
        try {
          if (sqliteOk) {
            const [ct, cv] = await Promise.all([
              avecTimeout(db.lireReferentiel('types_signalement'), 3000, null),
              avecTimeout(db.lireReferentiel('villes'), 3000, null),
            ]);
            t = ct ? (JSON.parse(ct) as TypeSignalement[]) : [];
            v = cv ? (JSON.parse(cv) as VilleSimple[]) : [];
          }
        } catch (e) {
          console.warn('[SEIMAD:Refs] cache référentiels illisible, repli embarqué', e);
        }
        if (t.length === 0) t = TYPES_SIGNALEMENT_DEFAUT;
        if (v.length === 0) v = VILLES_DEFAUT;
        if (!actif) return;
        if (t.length > 0) setTypes(t);
        if (v.length > 0) setVilles(v);
        setRefsFromCache(true);
      };
      if (!online) {
        await chargerDepuisCache();
        if (actif) setLoadingRefs(false);
        return;
      }
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
  }, [sqliteOk, online]);

  // ── Propriétés + géométries (référentiel du formulaire, caché pour l'hors-ligne) ──
  useEffect(() => {
    let actif = true;
    (async () => {
      const chargerCache = async () => {
        if (!sqliteOk) return;
        const brut = await db.lireReferentiel('proprietes_geometries');
        if (brut && actif) setProprietesCache(JSON.parse(brut) as ProprieteSimple[]);
      };
      if (!online) {
        await chargerCache();
        return;
      }
      try {
        // 1) Toutes les propriétés (volume raisonnable).
        const props = await signalementApi.proprietes();
        if (!actif) return;
        // 2) Leurs géométries, en parallèle (une requête par propriété localisée
        //    renvoie [] si absente — on ne garde que celles qui existent).
        const avecGeo = await Promise.all(
          props.map(async (p) => {
            try {
              const geos = await signalementApi.geometriePropriete(p.idPropriete);
              if (geos.length === 0 || !geos[0].geojson) return p;
              return {
                ...p,
                geojson: geos[0].geojson,
                typeGeometrie: geos[0].typegeometrie || 'Point',
                sourceGeometrie: geos[0].source || undefined,
              } as ProprieteSimple;
            } catch {
              return p; // géométrie indisponible : la propriété reste utilisable
            }
          }),
        );
        if (!actif) return;
        setProprietesCache(avecGeo);
        if (actif && sqliteOk) {
          await db.sauverReferentiel('proprietes_geometries', JSON.stringify(avecGeo))
            .catch(() => undefined);
        }
      } catch {
        if (actif) await chargerCache();
      }
    })();
    return () => { actif = false; };
  }, [sqliteOk, online]);

  // Recherche de propriété : en ligne sur l'API, hors-ligne dans le cache.
  useEffect(() => {
    const q = propRecherche.trim().toLowerCase();
    if (q.length < 2) {
      setPropResultats([]);
      return;
    }
    let actif = true;
    setPropRechercheEnCours(true);
    const timer = setTimeout(async () => {
      try {
        if (online) {
          const res = await signalementApi.rechercherProprietes(propRecherche.trim());
          // L'API /search ne renvoie pas la géométrie : on la complète depuis le
          // cache embarqué (rempli au chargement du formulaire) pour afficher
          // « 📍 localisée » et pré-remplir la position depuis la propriété.
          const enrichis = res.map((r) => {
            const c = proprietesCache.find((x) => x.idPropriete === r.idPropriete);
            return c?.geojson && !r.geojson
              ? { ...r, geojson: c.geojson, typeGeometrie: c.typeGeometrie, sourceGeometrie: c.sourceGeometrie }
              : r;
          });
          if (actif) setPropResultats(enrichis);
        } else {
          // Hors-ligne : filtre local (cache embarquant les géométries).
          const res = proprietesCache.filter((p) =>
            [p.nom, p.numero, p.zone, p.localisation, p.libelleLieu, p.nomVille]
              .some((champ) => (champ || '').toLowerCase().includes(q)));
          if (actif) setPropResultats(res.slice(0, 10));
        }
      } catch {
        if (actif) setPropResultats([]);
      } finally {
        if (actif) setPropRechercheEnCours(false);
      }
    }, 350);
    return () => { actif = false; clearTimeout(timer); };
  }, [propRecherche, online, proprietesCache]);

  // ── Édition : pré-remplissage du formulaire ──
  /** Applique une géométrie GeoJSON Point sur la carte du formulaire. */
  const appliquerGeometrie = useCallback((g?: { geojson?: string; precisionM?: number; source?: string }) => {
    if (!g?.geojson) return;
    try {
      const parsed = JSON.parse(g.geojson) as { type?: string; coordinates?: number[] };
      if (parsed?.type !== 'Point' || !Array.isArray(parsed.coordinates) || parsed.coordinates.length < 2) return;
      const [lng, lat] = parsed.coordinates;
      setPosition({ lat, lng });
      setPrecisionM(g.precisionM ?? null);
      setOriginePosition((g.source || '').toLowerCase().includes('gps') ? 'gps' : 'carte');
      setLocalisationMsg(g.source ? `Position ${g.source}` : '');
    } catch {
      // GeoJSON illisible : on garde la carte vide plutôt que de planter.
    }
  }, []);

  /** Pré-remplit le formulaire à partir d'un payload (brouillon ou UPDATE en file). */
  const appliquerPayloadEdition = useCallback((payload: SignalementRequest) => {
    setTypeId(payload.idTypeSignalement);
    setVilleId(payload.idVille);
    if (payload.dateSignalement) setDate(payload.dateSignalement.slice(0, 10));
    // La propriété en saisie manuelle est stockée en préfixe de la description.
    const desc = payload.description || '';
    const m = /^\[Propriété : (.+?)\]\s*/.exec(desc);
    if (m) {
      setModeSaisiePropriete('manuelle');
      setProprieteManuelle(m[1]);
      setDescription(desc.slice(m[0].length));
    } else {
      setDescription(desc);
    }
    if (payload.idPropriete) setIdProprieteSignalee(payload.idPropriete);
    appliquerGeometrie(payload.geometrie);
  }, [appliquerGeometrie]);

  // Chargement de l'entité à éditer : file locale d'abord (brouillon / modif en
  // attente), puis serveur (avec sa géométrie et ses photos déjà jointes).
  // `editionChargeeRef` évite de RE-charger (et d'écraser les saisies de
  // l'utilisateur) quand le réseau bascule en ligne/hors-ligne pendant l'édition.
  const editionChargeeRef = useRef(false);
  useEffect(() => {
    if (!idModification || editionChargeeRef.current) return;
    let actif = true;
    (async () => {
      setChargementEdition(true);
      try {
        let op: PendingOperation | null = null;
        try {
          op = await db.trouverOperationPending(idModification);
        } catch (e) {
          console.warn('[SEIMAD:Edit] base locale indisponible', e);
        }
        if (!actif) return;
        if (op && op.entiteType === 'signalement') {
          const payload = JSON.parse(op.payload) as SignalementRequest;
          appliquerPayloadEdition(payload);
          setBrouillonLocal(op.action === 'CREATE');
          // Ancien format : position {lat,lng} hors payload géométrie.
          if (!payload.geometrie?.geojson) {
            try {
              const pos = JSON.parse(op.position || 'null') as PointGeo | null;
              if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
                setPosition(pos);
                setOriginePosition('carte');
              }
            } catch { /* pas de position */ }
          }
          try {
            setPhotos((JSON.parse(op.photos || '[]') as Array<{ dataUrl: string; nom?: string; typePhoto?: string; datePrise?: string }>)
              .map((p, i) => ({ ...p, nom: p.nom || `photo_${i}.jpg` })));
          } catch { /* photos illisibles */ }
          editionChargeeRef.current = true;
          return;
        }

        if (!online) {
          setToast("Hors-ligne : ce signalement n'est pas disponible sur cet appareil");
          setToastColor('danger');
          return;
        }

        const sig = await signalementApi.trouver(idModification);
        if (!actif) return;
        setTypeId(sig.idTypeSignalement);
        setVilleId(sig.idVille);
        if (sig.dateSignalement) setDate(sig.dateSignalement.slice(0, 10));
        setDescription(sig.description || '');
        if (sig.idPropriete) setIdProprieteSignalee(sig.idPropriete);

        const geos = await signalementApi.geometrieSignalement(idModification).catch(() => []);
        if (actif) appliquerGeometrie(geos[0]);

        const ph = await signalementApi.photos(idModification).catch(() => []);
        const urls = await Promise.all(
          ph.filter((p) => p.idPhoto != null)
            .map((p) => signalementApi.contenuPhoto(p.idPhoto!).catch(() => null)),
        );
        if (actif) setPhotosServeur(urls.filter((u): u is string => !!u));
        editionChargeeRef.current = true;
      } catch {
        if (actif) {
          setToast('Signalement introuvable');
          setToastColor('danger');
        }
      } finally {
        if (actif) setChargementEdition(false);
      }
    })();
    return () => { actif = false; };
  }, [idModification, online, appliquerPayloadEdition, appliquerGeometrie]);

  // Propriété rattachée (id dans le DTO) → carte de propriété dans le formulaire.
  useEffect(() => {
    if (!idProprieteSignalee || proprieteChoisie?.idPropriete === idProprieteSignalee) return;
    const connue = proprietesCache.find((p) => p.idPropriete === idProprieteSignalee);
    if (connue) {
      setProprieteChoisie(connue);
      return;
    }
    if (!online) return;
    let actif = true;
    signalementApi.proprietes()
      .then((liste) => {
        const trouvee = liste.find((p) => p.idPropriete === idProprieteSignalee);
        if (actif && trouvee) setProprieteChoisie(trouvee);
      })
      .catch(() => undefined);
    return () => { actif = false; };
  }, [idProprieteSignalee, proprietesCache, proprieteChoisie, online]);

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

  // ── Propriété concernée ──
  /** Sélection d'une propriété : la carte recentre sur sa géométrie si elle en a une. */
  const choisirPropriete = useCallback((p: ProprieteSimple) => {
    const appliquer = (prop: ProprieteSimple) => {
      setProprieteChoisie(prop);
      setPropRecherche('');
      setPropResultats([]);
      setModeSaisiePropriete('recherche');
      // La géométrie de la propriété pré-positionne le point du constat (source carte).
      if (prop.geojson) {
        try {
          const g = JSON.parse(prop.geojson) as { type: string; coordinates: number[] | number[][] };
          if (g.type === 'Point' && Array.isArray(g.coordinates)) {
            const [lng, lat] = g.coordinates as number[];
            setPosition({ lat, lng });
            setPrecisionM(null);
            setOriginePosition('carte');
            setLocalisationMsg(`Position reprise de la géométrie de la propriété ${prop.numero || prop.nom || ''}`);
          }
        } catch { /* geojson corrompu : on ne pré-positionne pas */ }
      }
    };

    // L'API /search ne renvoie pas la géométrie : on la complète depuis le cache.
    const c = proprietesCache.find((x) => x.idPropriete === p.idPropriete);
    const cible: ProprieteSimple = c?.geojson && !p.geojson
      ? { ...p, geojson: c.geojson, typeGeometrie: c.typeGeometrie, sourceGeometrie: c.sourceGeometrie }
      : p;
    appliquer(cible);

    // Cache pas encore rempli (chargement initial en cours) ou propriété absente
    // du cache : on récupère sa géométrie à la volée pour l'embarquer quand même.
    if (!cible.geojson && online) {
      signalementApi.geometriePropriete(cible.idPropriete)
        .then((geos) => {
          if (!geos[0]?.geojson) return; // non localisée : on garde le choix tel quel
          appliquer({
            ...cible,
            geojson: geos[0].geojson,
            typeGeometrie: geos[0].typegeometrie || 'Point',
            sourceGeometrie: geos[0].source,
          });
        })
        .catch(() => undefined); // géométrie indisponible : la propriété reste utilisable
    }
  }, [proprietesCache, online]);

  const retirerPropriete = useCallback(() => {
    setProprieteChoisie(null);
    setProprieteManuelle('');
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
    if (!position && !modeEdition) {
      setToast('Veuillez indiquer la position sur la carte (bouton GPS ou clic)');
      setToastColor('danger');
      return;
    }
    setSaving(true);
    try {
      // La propriété choisie manuellement est tracée dans la description
      // (aucun idPropriete n'existe côté serveur pour une saisie libre).
      const descriptionFinale = modeSaisiePropriete === 'manuelle' && proprieteManuelle.trim()
        ? `[Propriété : ${proprieteManuelle.trim()}] ${description.trim()}`
        : description.trim();

      // Position GPS → géométrie GeoJSON (table `geometrie` côté serveur, table
      // `geometrie_locale` côté mobile). Ordre GeoJSON : [longitude, latitude].
      // En édition sans position : aucune géométrie envoyée → le serveur conserve
      // celle qui existe déjà (upsert uniquement si `geometrie` est fournie).
      const geojsonPoint = position
        ? JSON.stringify({ type: 'Point', coordinates: [position.lng, position.lat] })
        : '';
      const source = originePosition === 'gps' ? 'Import GPS' : 'Point carte';
      const request: SignalementRequest = {
        reference: undefined, // généré par le backend : SIG-AAAA-NNNN
        dateSignalement: new Date(date).toISOString(),
        idTypeSignalement: typeId,
        idVille: villeId,
        description: descriptionFinale,
        // Propriété concernée : ID exact en mode recherche (en ligne, ou choisie
        // dans le cache hors-ligne), rien en saisie manuelle (texte dans la
        // description du signalement).
        idPropriete: modeSaisiePropriete === 'recherche' && proprieteChoisie
          ? proprieteChoisie.idPropriete
          : undefined,
        // Géométrie du constat : la position relevée a priorité ; sans position,
        // la géométrie de la propriété choisie est embarquée à sa place ; sans
        // aucune des deux (édition d'un signalement non positionné), rien.
        geometrie: position && geojsonPoint
          ? {
              typeGeometrie: 'Point',
              geojson: geojsonPoint,
              precisionM: precisionM ?? undefined,
              source,
            }
          : proprieteChoisie?.geojson
            ? {
                typeGeometrie: proprieteChoisie.typeGeometrie || 'Point',
                geojson: proprieteChoisie.geojson,
                source: `Géométrie propriété (${proprieteChoisie.sourceGeometrie || 'serveur'})`,
              }
            : undefined,
      };
      // Miroir local : géométrie conservée sur l'appareil (affichage hors-ligne
      // et statut de synchronisation), même schéma que `geometrie` du serveur.
      const geometrieLocale = {
        entiteType: 'signalement',
        typeGeometrie: 'Point',
        geojson: geojsonPoint,
        precisionM,
        source,
      };

      const photoMetas: Array<{ dataUrl: string; typePhoto?: string; datePrise?: string; observation?: string }> =
        photos.map((p) => ({ dataUrl: p.dataUrl, typePhoto: p.typePhoto, datePrise: p.datePrise }));

      // ── Mode édition ───────────────────────────────────────────────
      // Opération en file pour cette entité (brouillon CREATE ou UPDATE en attente).
      const opEdition = modeEdition && idModification
        ? await db.trouverOperationPending(idModification).catch(() => null)
        : null;
      // Cas limite : le brouillon vient d'être synchronisé (sync auto) pendant
      // l'édition → il n'a plus d'id local, on repasse sur la création classique.
      if (modeEdition && idModification && !(brouillonLocal && !opEdition)) {
        const id = idModification;
        const opExistante = opEdition;

        // a) Brouillon local (créé hors-ligne, jamais synchronisé) : on réécrit
        //    la MÊME ligne de la file (idLocal = id local) — pas de PUT possible,
        //    l'entité n'existe pas encore côté serveur.
        if (brouillonLocal && opExistante) {
          await db.ajouterOperationPending({
            ...opExistante,
            payload: JSON.stringify(request),
            photos: JSON.stringify(photoMetas),
            position: JSON.stringify(position ?? {}),
          });
          if (sqliteOk && geojsonPoint) {
            await db.sauverGeometrieLocale({
              entiteType: 'signalement',
              entiteId: id,
              typeGeometrie: 'Point',
              geojson: geojsonPoint,
              precisionM,
              source,
              synchronise: 0,
            }).catch(() => undefined);
          }
          setToast('Brouillon modifié — pris en compte à la prochaine synchronisation');
          setToastColor('success');
          setTimeout(() => history.replace(`/tab/signalements/${id}`), 1500);
          return;
        }

        // b) En ligne → PUT immédiat.
        if (online) {
          try {
            await signalementApi.mettreAJour(id, request);
            // Une modification précédemment en file devient obsolète (remplacée par ce PUT).
            if (opExistante?.action === 'UPDATE') {
              await db.supprimerOperationPending(opExistante.idLocal).catch(() => undefined);
            }
            if (sqliteOk && geojsonPoint) {
              await db.sauverGeometrieLocale({
                ...geometrieLocale,
                entiteId: id,
                synchronise: 1, // envoyée dans le payload du PUT
              }).catch(() => undefined);
            }
            // Nouvelles photos (les anciennes restent sur le serveur).
            let photosEnvoyees = 0;
            const echouees: typeof photoMetas = [];
            for (const p of photoMetas) {
              try {
                const form = new FormData();
                const blob = dataUrlVersBlob(p.dataUrl);
                form.append('fichier', blob, `signalement_${Date.now()}.png`);
                form.append('entiteType', 'signalement');
                form.append('entiteId', id);
                form.append('typePhoto', p.typePhoto || 'constat');
                if (p.datePrise) form.append('datePrise', p.datePrise);
                await signalementApi.ajouterPhoto(form);
                photosEnvoyees += 1;
              } catch (e) {
                echouees.push(p);
                console.warn('Photo non envoyée au serveur', e);
              }
            }
            // Photos en échec → re-file locale : renvoyées à la prochaine synchro.
            if (echouees.length > 0) {
              await refilerPhotosEchouees('signalement', id, request, echouees).catch(() => undefined);
            }
            setToast(
              'Signalement modifié ✔' +
              (echouees.length > 0
                ? ` — ${echouees.length}/${photoMetas.length} photo(s) en attente de renvoi`
                : photosEnvoyees > 0 ? ` — ${photosEnvoyees} photo(s) envoyée(s)` : '')
            );
            setToastColor(echouees.length > 0 ? 'warning' : 'success');
            setTimeout(() => history.replace(`/tab/signalements/${id}`), 1800);
            return;
          } catch (e) {
            // Échec réseau/API → on bascule sur la file locale (PUT rejoué à la synchro).
            console.warn('Échec API, repli file locale', e);
          }
        }

        // c) Hors-ligne (ou échec API) → file locale.
        if (!sqliteOk) {
          setToast(
            online
              ? 'Impossible d’enregistrer : le stockage local n’est pas disponible sur ce navigateur. Réessayez en ligne.'
              : 'Impossible d’enregistrer : hors-ligne et stockage local non disponible. Connectez-vous puis réessayez.'
          );
          setToastColor('danger');
          return;
        }
        // INSERT OR REPLACE sur idLocal = id serveur : on conserve les photos
        // déjà en file pour cette entité (sinon elles seraient perdues).
        const photosEnFile = (() => {
          const anciennes = (() => {
            try {
              return opExistante?.action === 'UPDATE'
                ? (JSON.parse(opExistante.photos || '[]') as typeof photoMetas)
                : [];
            } catch { return []; }
          })();
          const vus = new Set(anciennes.map((p) => p.dataUrl));
          return [...anciennes, ...photoMetas.filter((p) => !vus.has(p.dataUrl))];
        })();
        await localApi.put(`/signalements/${id}`, {
          ...request,
          photos: photosEnFile,
          position,
        });
        setToast('Modification enregistrée localement — synchronisation au retour du réseau');
        setToastColor('success');
        setTimeout(() => history.replace(`/tab/signalements/${id}`), 1500);
        return;
      }

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
          const echouees: typeof photoMetas = [];
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
              // Une photo en échec ne bloque pas la création : elle est re-filée
              // (renvoyée à la prochaine synchro au lieu d'être perdue).
              echouees.push(p);
              console.warn('Photo non envoyée au serveur', e);
            }
          }
          if (echouees.length > 0) {
            await refilerPhotosEchouees('signalement', cree.idSignalement, request, echouees).catch(() => undefined);
          }
          setToast(
            `Signalement ${cree.reference || ''} créé ✔` +
            (echouees.length > 0
              ? ` — ${echouees.length}/${photoMetas.length} photo(s) en attente de renvoi`
              : photosEnvoyees > 0 ? ` — ${photosEnvoyees} photo(s) envoyée(s)` : '')
          );
          setToastColor(echouees.length > 0 ? 'warning' : 'success');
          setTimeout(() => history.replace('/tab/signalements'), 2600);
          return;
        } catch (e) {
          // Échec réseau/API pendant l'appel en ligne → repli file locale.
          console.warn('Échec API, repli local', e);
        }
      }

      // File locale (SQLite) : mode hors-ligne ou repli après échec API.
      // L'écriture passe par l'API LOCALE de l'application (localApi → SQLite),
      // comme un appel HTTP : mise en file (pending_operations) + miroir
      // géométrie (geometrie_locale) gérés centralisés côté localApi.
      if (!sqliteOk) {
        setToast(
          online
            ? 'Impossible d’enregistrer : le stockage local n’est pas disponible sur ce navigateur. Réessayez en ligne.'
            : 'Impossible d’enregistrer : hors-ligne et stockage local non disponible. Connectez-vous puis réessayez.'
        );
        setToastColor('danger');
        return;
      }

      const rep = await localApi.post<{ idLocal: string; enAttente: boolean }>('/signalements', {
        ...request,
        photos: photoMetas,
        position,
      });
      idLocal = rep.idLocal;
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
  }, [typeId, position, precisionM, originePosition, description, date, villeId, photos, online, history,
      modeSaisiePropriete, proprieteChoisie, proprieteManuelle,
      modeEdition, idModification, brouillonLocal, sqliteOk]);

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

  const annuler = () => history.replace(
    modeEdition && idModification ? `/tab/signalements/${idModification}` : '/tab/signalements'
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#0d435d', '--color': 'white' }}>
          <IonButtons slot="start">
            <IonButton onClick={annuler}>
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>{modeEdition ? 'Modifier le signalement' : 'Nouveau signalement'}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={telechargerZoneVisible} style={{ color: downloadState === 'en cours' ? '#fbbf24' : 'white' }}>
              <IonIcon icon={downloadOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {modeEdition && chargementEdition && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '18px 0', color: '#6b7280', fontSize: 13 }}>
            <IonSpinner name="dots" style={{ width: 18, height: 18 }} />
            Chargement du signalement…
          </div>
        )}
        {modeEdition && !chargementEdition && (
          <div style={{
            background: '#eef2f7', border: '1px solid #cbd5e1', color: '#334155',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14,
          }}>
            ✏️ <b>Mode modification</b> — modifiez puis enregistrez. Les photos déjà jointes
            restent sur le serveur ; seules les nouvelles photos ajoutées ici seront envoyées.
          </div>
        )}
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
          center={position ?? CENTRE_MADAGASCAR}
          marker={position}
          interactif
          markerColor="#c53030"
          onPick={onCartePick}
          onMapReady={onMapReady}
          forceOffline={forceOffline}
          searchable
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

        {/* 2 · Propriété concernée */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          2 · Propriété concernée
        </div>

        {proprieteChoisie && modeSaisiePropriete === 'recherche' ? (
          /* Carte de la propriété sélectionnée */
          <div style={{
            background: '#eef7f2', border: '1px solid #bfe3d2', borderRadius: 10,
            padding: '10px 12px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1b4332' }}>
                  {proprieteChoisie.numero || proprieteChoisie.nom || `Propriété #${proprieteChoisie.idPropriete}`}
                </div>
                <div style={{ fontSize: 12, color: '#40614f', marginTop: 2 }}>
                  {[proprieteChoisie.nom, proprieteChoisie.localisation || proprieteChoisie.libelleLieu, proprieteChoisie.nomVille]
                    .filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {proprieteChoisie.geojson ? (
                    <span style={{ fontSize: 10.5, background: '#d8f3e3', color: '#1b6e46', borderRadius: 999, padding: '2px 8px' }}>
                      📍 géométrie embarquée ({proprieteChoisie.typeGeometrie === 'Polygon' ? 'polygone' : 'point'})
                    </span>
                  ) : (
                    <span style={{ fontSize: 10.5, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 8px' }}>
                      sans géométrie — position GPS/carte uniquement
                    </span>
                  )}
                  {proprieteChoisie.superficieTotale != null && (
                    <span style={{ fontSize: 10.5, background: '#e0e7ff', color: '#3730a3', borderRadius: 999, padding: '2px 8px' }}>
                      {Number(proprieteChoisie.superficieTotale).toLocaleString('fr-FR')} m²
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={retirerPropriete}
                style={{
                  background: 'rgba(0,0,0,.08)', color: '#1b4332', border: 'none', borderRadius: 999,
                  width: 24, height: 24, fontSize: 12, cursor: 'pointer', lineHeight: '24px', padding: 0,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ) : modeSaisiePropriete === 'recherche' ? (
          /* Recherche (en ligne : API, hors-ligne : cache SQLite embarqué) */
          <>
            <IonItem lines="inset" style={{ '--background': 'transparent' }}>
              <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>
                Rechercher une propriété {online ? '' : '(cache hors-ligne)'}
              </IonLabel>
              <IonInput
                value={propRecherche}
                placeholder="Nom, n°, zone, lieu, ville… (min. 2 caractères)"
                onIonInput={(e) => setPropRecherche(String(e.detail.value || ''))}
              />
              {propRechercheEnCours && <IonSpinner name="dots" style={{ width: 18, height: 18 }} />}
            </IonItem>
            {propResultats.length > 0 && (
              <div style={{
                background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
                margin: '4px 0 10px', overflow: 'hidden',
              }}>
                {propResultats.slice(0, 8).map((p) => (
                  <button
                    key={p.idPropriete}
                    onClick={() => choisirPropriete(p)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', background: 'white',
                      border: 'none', borderBottom: '1px solid #f1f5f9', padding: '10px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#1f2937' }}>
                      {p.numero || p.nom || `#${p.idPropriete}`}
                      {p.nom && p.numero ? ` · ${p.nom}` : ''}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                      {[p.localisation || p.libelleLieu, p.nomVille]
                        .filter(Boolean).join(' · ')}
                      {p.geojson ? ' · 📍 localisée' : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {propRecherche.trim().length >= 2 && !propRechercheEnCours && propResultats.length === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af', margin: '2px 2px 10px' }}>
                Aucune propriété trouvée {online ? '' : 'dans le cache — essayez la saisie manuelle'}.
              </div>
            )}
            <IonButton
              expand="block"
              fill="clear"
              size="small"
              onClick={() => { setModeSaisiePropriete('manuelle'); setPropResultats([]); setPropRecherche(''); }}
              style={{ marginBottom: 14 }}
            >
              ✍️ Pas dans la liste ? Saisir manuellement
            </IonButton>
          </>
        ) : (
          /* Saisie manuelle (hors-ligne sans cache, propriété non référencée…) */
          <>
            <IonItem lines="inset" style={{ '--background': 'transparent' }}>
              <IonLabel position="stacked" style={{ fontSize: 12, color: '#6b7280' }}>
                Propriété concernée (saisie manuelle)
              </IonLabel>
              <IonInput
                value={proprieteManuelle}
                placeholder="Ex. : PC 486-2 — Ambatoroka, Antananarivo"
                onIonInput={(e) => setProprieteManuelle(String(e.detail.value || ''))}
              />
            </IonItem>
            <div style={{ fontSize: 11, color: '#6b7280', margin: '4px 2px 8px' }}>
              La propriété saisie sera mentionnée dans la description du signalement
              (rattachement exact possible plus tard depuis le web).
            </div>
            <IonButton
              expand="block"
              fill="clear"
              size="small"
              onClick={() => { setModeSaisiePropriete('recherche'); setProprieteManuelle(''); }}
              style={{ marginBottom: 14 }}
            >
              🔍 Rechercher dans le référentiel plutôt
            </IonButton>
          </>
        )}

        {/* 3 · Détails */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          3 · Détails du signalement
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

        {/* 4 · Photos */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          4 · Photos (constat) — {photosServeur.length + photos.length}
        </div>
        {photosServeur.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 6 }}>
              Déjà jointes au signalement ({photosServeur.length}) — conservées telles quelles
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {photosServeur.map((src, i) => (
                <img key={`srv-${i}`} src={src} alt="photo existante"
                  style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
              ))}
            </div>
          </div>
        )}
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

        {/* 5 · Observation */}
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 8px' }}>
          5 · Observation
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
                background: '#176b87', height: '100%', transition: 'width .3s',
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
          disabled={saving || chargementEdition}
          onClick={enregistrer}
          style={{ '--border-radius': 12, height: 50, fontWeight: 700, marginBottom: 30, '--background': '#176b87' }}
        >
          {saving
            ? <IonSpinner name="crescent" />
            : modeEdition ? '💾 Enregistrer les modifications' : '💾 Enregistrer le signalement'}
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
