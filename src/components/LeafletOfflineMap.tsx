import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { creerCoucheHorsLigne, OfflineTileLayer } from '../services/offlineMap';

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
  onPick, onMapReady, height = 260, forceOffline = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const coucheRef = useRef<OfflineTileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const interactifRef = useRef(interactif);
  interactifRef.current = interactif;

  // Création de la carte (une seule fois).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const el = containerRef.current;
    const map = L.map(el, {
      zoomControl: true,
      attributionControl: true,
      center: center ? [center.lat, center.lng] : [-18.8792, 47.5079],
      zoom,
      // Bornes des niveaux OSM (0..19) : au-delà, tile.openstreetmap.org
      // répond 400/404.
      minZoom: 3,
      maxZoom: 19,
    });
    const couche = creerCoucheHorsLigne();
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

  // Mode hors-ligne.
  useEffect(() => {
    coucheRef.current?.setForceOffline(forceOffline);
  }, [forceOffline]);

  return (
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
  );
}
