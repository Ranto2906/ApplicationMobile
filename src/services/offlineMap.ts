// ══════════════════════════════════════════════════════════════
// Carte hors-ligne — Leaflet + cache de tuiles SQLite
//  - `OfflineTileLayer` : L.TileLayer qui sert d'abord les tuiles
//    stockées dans SQLite ; si absente et connecté, télécharge la
//    tuile OSM et la met en cache ; si absente et hors-ligne,
//    affiche une tuile grise.
//  - `telechargerZone(...)` : télécharge toutes les tuiles de la
//    zone visible (plusieurs niveaux de zoom) → carte consultable
//    hors-ligne.
// ══════════════════════════════════════════════════════════════
import L from 'leaflet';
import { db } from './db';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Petit PNG gris (1×1) pour les tuiles non disponibles hors-ligne. */
const TUILE_ABSENTE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Layer de tuiles avec cache SQLite.
 * - online + non cachée  → téléchargée puis sauvegardée
 * - hors-ligne + cachée  → servie depuis SQLite
 * - hors-ligne + absente → tuile grise
 */
export class OfflineTileLayer extends L.TileLayer {
  /** true quand on force le mode hors-ligne (désactive le téléchargement réseau). */
  forceOffline: boolean;

  constructor(urlTemplate: string, options?: L.TileLayerOptions) {
    super(urlTemplate, { maxZoom: 19, ...options });
    this.forceOffline = false;
  }

  setForceOffline(v: boolean) {
    this.forceOffline = v;
    // Recharge les tuiles visibles pour appliquer le nouveau mode.
    this.redraw();
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    const z = coords.z;
    const x = coords.x;
    const y = coords.y;
    const key = this._tileCoordsToKey ? `${z}/${x}/${y}` : `${z}/${x}/${y}`;

    // Sécurité : nombres négatifs (hors monde) → tuile transparente.
    if (x < 0 || y < 0) {
      tile.src = TUILE_ABSENTE;
      done(null, tile);
      return tile;
    }

    db.getTuile(z, x, y)
      .then((dataUrl) => {
        if (dataUrl) {
          tile.src = dataUrl;
          done(null, tile);
          return;
        }
        if (this.forceOffline || !navigator.onLine) {
          tile.src = TUILE_ABSENTE;
          done(null, tile);
          return;
        }
        // Tuile absente + en ligne → téléchargement puis mise en cache.
        const url = this.getTileUrl(coords as any);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tile.src = img.src;
          done(null, tile);
          // Sauvegarde silencieuse (best effort) dans SQLite.
          fetch(url, { mode: 'cors' })
            .then((r) => (r.ok ? r.blob() : null))
            .then((blob) => {
              if (!blob) return;
              const fr = new FileReader();
              fr.onload = () => db.sauverTuile(z, x, y, String(fr.result)).catch(() => undefined);
              fr.readAsDataURL(blob);
            })
            .catch(() => undefined);
        };
        img.onerror = () => {
          tile.src = TUILE_ABSENTE;
          done(null, tile);
        };
        img.src = url;
        void key;
      })
      .catch(() => {
        // Erreur SQLite (pas encore initialisée…) → comportement réseau normal.
        if (this.forceOffline || !navigator.onLine) {
          tile.src = TUILE_ABSENTE;
        } else {
          tile.src = this.getTileUrl(coords as any);
        }
        done(null, tile);
      });

    return tile;
  }
}

export function creerCoucheHorsLigne(options?: L.TileLayerOptions): OfflineTileLayer {
  return new OfflineTileLayer(OSM_TILE_URL, { attribution: TILE_ATTRIBUTION, ...options });
}

/** Géométrie tile (norme slippy-map) pour un point + zoom. */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

export interface OptionsTelechargement {
  /** Niveaux de zoom à télécharger (bornés 8..19 par sécurité). */
  minZoom: number;
  maxZoom: number;
  onProgress?: (fait: number, total: number, tuileCourante: string) => void;
  /** Permet d'annuler (set à true depuis l'extérieur). */
  annuler?: { value: boolean };
}

/**
 * Télécharge toutes les tuiles OSM couvrant la vue actuelle de `map`,
 * entre minZoom et maxZoom, puis les stocke dans SQLite.
 * Respecte la géométrie web-mercator et limite le nombre de tuiles.
 */
export async function telechargerZone(
  map: L.Map,
  opts: OptionsTelechargement
): Promise<{ tuiles: number; reussies: number; echecs: number }> {
  const bounds = map.getBounds();
  const minZoom = Math.max(8, opts.minZoom);
  const maxZoom = Math.min(19, opts.maxZoom);

  // Bornes géographiques de la vue.
  const nord = bounds.getNorth();
  const sud = bounds.getSouth();
  const est = bounds.getEast();
  const ouest = bounds.getWest();

  // Liste (z,x,y) à télécharger.
  const liste: Array<{ z: number; x: number; y: number }> = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const tNW = latLngToTile(nord, ouest, z);
    const tSE = latLngToTile(sud, est, z);
    const xMin = Math.max(0, Math.min(tNW.x, tSE.x));
    const xMax = Math.max(tNW.x, tSE.x);
    const yMin = Math.max(0, Math.min(tNW.y, tSE.y));
    const yMax = Math.max(tNW.y, tSE.y);
    // Limite de sécurité : 150 tuiles par niveau de zoom max.
    if ((xMax - xMin + 1) * (yMax - yMin + 1) > 150) {
      throw new Error(
        `La zone demandée est trop grande au zoom ${z} (${(xMax - xMin + 1) * (yMax - yMin + 1)} tuiles). Zoomez plus près ou réduisez les niveaux.`
      );
    }
    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        if (!(await db.tuileExiste(z, x, y))) liste.push({ z, x, y });
      }
    }
  }

  const total = liste.length;
  let fait = 0;
  let reussies = 0;
  let echecs = 0;

  const travailler = async (i: number) => {
    if (opts.annuler?.value) return;
    const { z, x, y } = liste[i];
    const url = OSM_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const dataUrl = await blobToDataUrlCompat(blob);
      await db.sauverTuile(z, x, y, dataUrl);
      reussies += 1;
    } catch {
      echecs += 1;
    } finally {
      fait += 1;
      opts.onProgress?.(fait, total, `${z}/${x}/${y}`);
    }
  };

  // 4 téléchargements en parallèle max (politesse vis-à-vis du serveur OSM).
  const concurrency = 4;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (cursor < total && !opts.annuler?.value) {
      const i = cursor;
      cursor += 1;
      await travailler(i);
    }
  });
  await Promise.all(workers);

  return { tuiles: total, reussies, echecs };
}

function blobToDataUrlCompat(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
