import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { creerCoucheHorsLigne, OfflineTileLayer, BUNDLED_MAX_ZOOM } from '../services/offlineMap';

export interface PointGeo {
  lat: number;
  lng: number;
}

interface Props {
  /** Position initiale / centrage. */
  center?: PointGeo;
  zoom?: number;
  /** Position du marqueur (contrôlée). */
  marker?: PointGeo | null;
  /** true → clic sur la carte = déplacer le marqueur. */
  interactif?: boolean;
  /** Style du marqueur (couleur). */
  markerColor?: string;
  onPick?: (p: PointGeo) => void;
  /** Donne accès à l'instance (ex: pour télécharger la zone). */
  onMapReady?: (map: L.Map, couche: OfflineTileLayer) => void;
  /** Hauteur du conteneur (px). */
  height?: number;
  /** Force le mode hors-ligne (pas de téléchargement réseau). */
  forceOffline?: boolean;
  /** Affiche une recherche de lieu au-dessus de la carte. */
  searchable?: boolean;
}

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

/** Icône en forme de goutte — évite les assets Leaflet par défaut (fragiles en bundle). */
function pinIcon(color = '#1a56db') {
  return L.divIcon({
    className: '',
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    html: `<div style="position:relative;width:34px;height:44px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">
      <svg viewBox="0 0 24 24" width="34" height="44" style="display:block">
        <path d="M12 0C7 0 3 4 3 9c0 6.2 9 15 9 15s9-8.8 9-15c0-5-4-9-9-9z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="12" cy="9" r="4" fill="#ffffff"/>
      </svg>
    </div>`,
  });
}

export default function LeafletOfflineMap({
  center, zoom = 15, marker, interactif = false, markerColor,
  onPick, onMapReady, height = 260, forceOffline = false, searchable = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const coucheRef = useRef<OfflineTileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const interactifRef = useRef(interactif);
  interactifRef.current = interactif;

  const rechercher = async (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) return;
    if (!navigator.onLine || forceOffline) {
      setSearchResults([]);
      setSearchMessage('Recherche indisponible hors-ligne.');
      return;
    }
    setSearching(true);
    setSearchMessage('');
    try {
      const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '5',
        'accept-language': 'fr',
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!response.ok) throw new Error('Recherche impossible');
      const results = await response.json() as SearchResult[];
      setSearchResults(results);
      if (results.length === 0) setSearchMessage('Aucun lieu trouvé.');
    } catch {
      setSearchResults([]);
      setSearchMessage('Recherche indisponible. Vérifiez la connexion.');
    } finally {
      setSearching(false);
    }
  };

  const choisirResultat = (result: SearchResult) => {
    const point = { lat: Number(result.lat), lng: Number(result.lon) };
    mapRef.current?.setView([point.lat, point.lng], Math.max(mapRef.current.getZoom(), 15));
    onPickRef.current?.(point);
    setSearchText(result.display_name);
    setSearchResults([]);
    setSearchMessage('');
  };

  // Création de la carte (une seule fois).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const el = containerRef.current;
    // Hors-ligne, on borne le zoom initial au dernier niveau couvert par les
    // tuiles embarquées (pays entier jusqu'au zoom 14) : ouvrir directement à
    // z15+ montrait une carte entièrement grise sur le terrain.
    const horsLigne = forceOffline || !navigator.onLine;
    const zoomInitial = horsLigne ? Math.min(zoom, BUNDLED_MAX_ZOOM) : zoom;
    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      center: center ? [center.lat, center.lng] : [-18.8792, 47.5079],
      zoom: zoomInitial,
      // Bornes des niveaux OSM (0..19) : au-delà, tile.openstreetmap.org
      // répond 400/404.
      minZoom: 3,
      maxZoom: 19,
    });
    const couche = creerCoucheHorsLigne({ noWrap: true });
    couche.setForceOffline(forceOffline || !navigator.onLine);
    couche.addTo(map);
    mapRef.current = map;
    coucheRef.current = couche;

    // Clic pour placer le point.
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!interactifRef.current) return;
      const p = { lat: e.latlng.lat, lng: e.latlng.lng };
      onPickRef.current?.(p);
    });

    onMapReadyRef.current?.(map, couche);

    // Garde la carte bien dimensionnée (rotation, onglets Ionic…).
    // Utilise le délai de transition Ionic (300ms) pour éviter les clignotements.
    let vivant = true;
    const invalider = () => {
      if (!vivant || mapRef.current !== map || !el.isConnected) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      try {
        map.invalidateSize(false); // false = pas de déclenchement de zoom
      } catch {
        // carte en cours de retrait — ignoré
      }
    };
    const ro = new ResizeObserver((entries) => {
      // Ne s'exécute que si la taille a réellement changé
      if (entries.length > 0 && entries[0].contentRect.width > 0) {
        invalider();
      }
    });
    ro.observe(el);
    // Déclenche après le rendu initial avec un délai adapté aux transitions Ionic
    const t = setTimeout(invalider, 350);

    return () => {
      vivant = false;
      ro.disconnect();
      clearTimeout(t);
      try { map.remove(); } catch { /* carte déjà retirée */ }
      mapRef.current = null;
      coucheRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marqueur contrôlé.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (marker) {
      if (!markerRef.current) {
        markerRef.current = L.marker([marker.lat, marker.lng], {
          icon: pinIcon(markerColor),
          draggable: interactif,
        }).addTo(map);
        if (interactif) {
          markerRef.current.on('dragend', () => {
            const ll = markerRef.current?.getLatLng();
            if (ll) onPickRef.current?.({ lat: ll.lat, lng: ll.lng });
          });
        }
      } else {
        markerRef.current.setLatLng([marker.lat, marker.lng]);
      }
    } else if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker?.lat, marker?.lng, !!marker, interactif]);

  // Recentrage quand la position arrive APRÈS le montage (écran de détail ou
  // d'édition chargé depuis le serveur). Le seuil ~1 km évite de recentrer à
  // chaque clic sur la carte (la vue contient déjà le point cliqué).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;
    try {
      const c = map.getCenter();
      if (Math.abs(c.lat - center.lat) < 0.01 && Math.abs(c.lng - center.lng) < 0.01) return;
      map.setView([center.lat, center.lng], map.getZoom(), { animate: false });
    } catch { /* carte en cours de destruction */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng]);

  // Mode hors-ligne.
  useEffect(() => {
    coucheRef.current?.setForceOffline(forceOffline);
    // Bascule hors-ligne au-delà du zoom embarqué : on dézoome au dernier
    // niveau couvert (les tuiles plus précises n'existent que dans le cache
    // SQLite — le layer affichera sinon des tuiles grises ou ancêtres).
    if (forceOffline) {
      const map = mapRef.current;
      try {
        if (map && map.getZoom() > BUNDLED_MAX_ZOOM) map.setZoom(BUNDLED_MAX_ZOOM);
      } catch { /* carte en cours de destruction */ }
    }
  }, [forceOffline]);

  return (
    <div
      style={{ position: 'relative', width: '100%', height }}
    >
      {searchable && (
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute', top: 10, left: 10, right: 10, zIndex: 1000,
            maxWidth: 460, margin: '0 auto',
          }}
        >
          <form onSubmit={rechercher} style={{ display: 'flex', gap: 6 }}>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Rechercher un lieu ou une adresse"
              aria-label="Rechercher un lieu ou une adresse"
              style={{
                minWidth: 0, flex: 1, height: 40, padding: '0 12px', border: '1px solid #cbd5e1',
                borderRadius: 9, background: 'white', boxShadow: '0 2px 8px rgba(15, 23, 42, .2)',
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              disabled={searching || !searchText.trim()}
              style={{
                height: 40, border: 0, borderRadius: 9, padding: '0 13px', color: 'white',
                background: '#176b87', fontWeight: 700, cursor: 'pointer',
              }}
            >
              {searching ? '…' : 'Rechercher'}
            </button>
          </form>
          {(searchMessage || searchResults.length > 0) && (
            <div style={{ marginTop: 5, borderRadius: 9, overflow: 'hidden', background: 'white', boxShadow: '0 2px 8px rgba(15, 23, 42, .2)' }}>
              {searchMessage && <div style={{ padding: '9px 12px', color: '#64748b', fontSize: 12 }}>{searchMessage}</div>}
              {searchResults.map((result) => (
                <button
                  type="button"
                  key={`${result.lat}-${result.lon}-${result.display_name}`}
                  onClick={() => choisirResultat(result)}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', border: 0, borderBottom: '1px solid #e2e8f0', background: 'white', textAlign: 'left', color: '#102a43', cursor: 'pointer', fontSize: 12 }}
                >
                  {result.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        zIndex: 0,
        overflow: 'hidden',
      }}
      />
    </div>
  );
}
