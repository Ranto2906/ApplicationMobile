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
import { Capacitor } from '@capacitor/core';
import L from 'leaflet';
import { db } from './db';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BUNDLED_TILE_URL = '/assets/map-tiles/{z}/{x}/{y}.png';
/** Dernier niveau de zoom couvert par les tuiles embarquées (public/assets/map-tiles). */
export const BUNDLED_MAX_ZOOM = 14;
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Petit PNG gris (1×1) pour les tuiles non disponibles hors-ligne. */
const TUILE_ABSENTE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Layer de tuiles avec cache SQLite.
 * - online + non cachée  → téléchargée puis sauvegardée
 * - hors-ligne + cachée  → servie depuis SQLite
 * - hors-ligne + absente → tuile grise
 *
 * Note : si la base SQLite web est indisponible (<jeep-sqlite> non défini),
 * le cache est ignoré et la couche agit comme une tuile OSM classique (en ligne)
 * ou une tuile grise (hors-ligne).
 */
export class OfflineTileLayer extends L.TileLayer {
  /** true quand on force le mode hors-ligne (désactive le téléchargement réseau). */
  forceOffline: boolean;

  constructor(urlTemplate: string, options?: L.TileLayerOptions) {
    super(urlTemplate, { maxZoom: 19, ...options });
    this.forceOffline = false;
  }

  /**
   * Disponibilité SQLite vérifiée À LA DEMANDE (plus une seule fois au
   * constructeur) : sur web, jeep-sqlite termine souvent de se charger APRÈS
   * la création de la carte. Une décision figée au constructeur désactivait
   * définitivement le cache de tuiles → carte grise hors-ligne même avec un
   * cache rempli. Natif : toujours disponible.
   */
  private estSqliteDisponible(): boolean {
    if (typeof Capacitor !== 'undefined' && Capacitor.getPlatform() !== 'web') {
      return true;
    }
    return !!(window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__;
  }

  setForceOffline(v: boolean) {
    this.forceOffline = v;
    // Recharge les tuiles visibles pour appliquer le nouveau mode.
    this.redraw();
  }

  /**
   * URL de tuile garantie valide. Leaflet construit le « z » de l'URL avec
   * `_getZoomForUrl()` → `this._tileZoom`, qui vaut `undefined` quand la
   * couche est retirée (démontage StrictMode) ou avant la première vue :
   * l'URL deviendrait « NaN/…/….png » (OSM répond 400). On régénère alors
   * l'URL depuis les coordonnées de la tuile ; sinon tuile grise locale.
   */
  override getTileUrl(coords: L.Coords): string {
    const tileZoom = (this as any)._tileZoom as unknown;
    if (Number.isFinite(tileZoom as number)) {
      return super.getTileUrl(coords);
    }
    const z = coords.z;
    const x = coords.x;
    const y = coords.y;
    const monde = Number.isInteger(z) && z >= 0 ? 2 ** z : 0;
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)
      || z < 0 || x < 0 || y < 0 || x >= monde || y >= monde) {
      return TUILE_ABSENTE;
    }
    return OSM_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  /**
   * Recherche une « tuile ancêtre » disponible (cache SQLite, puis assets
   * embarqués) et l'affiche à la place de la tuile demandée — Leaflet l'étire
   * automatiquement sur la zone. Utilisé hors-ligne : sans lui, toute vue
   * au-delà du zoom 14 (les tuiles embarquées s'arrêtent là) montrait des
   * tuiles grises même dans une zone précédemment téléchargée.
   * Renvoie true si une tuile ancêtre a été trouvée et appliquée.
   */
  private async afficherTuileAncetre(coords: L.Coords, tile: HTMLImageElement): Promise<boolean> {
    const z = coords.z;
    const disponible = this.estSqliteDisponible();
    for (let az = z - 1; az >= 3; az -= 1) {
      const div = 2 ** (z - az);
      const ax = Math.floor(coords.x / div);
      const ay = Math.floor(coords.y / div);
      // 1) Cache SQLite (zone éventuellement téléchargée, tous niveaux).
      if (disponible) {
        try {
          // Garde-fou : si la base n'est pas initialisée (initWebStore suspendu
          // après un rechargement hors-ligne), on n'attend pas indéfiniment.
          const dataUrl = await Promise.race([
            db.getTuile(az, ax, ay),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
          ]);
          if (dataUrl) {
            tile.src = dataUrl;
            return true;
          }
        } catch { /* base non prête : on remonte d'un niveau */ }
      }
      // 2) Assets embarqués (pays entier jusqu'au zoom 14).
      if (az <= BUNDLED_MAX_ZOOM) {
        const url = BUNDLED_TILE_URL
          .replace('{z}', String(az)).replace('{x}', String(ax)).replace('{y}', String(ay));
        const ok = await new Promise<boolean>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve(true);
          probe.onerror = () => resolve(false);
          probe.src = url;
        });
        if (ok) {
          tile.src = url;
          return true;
        }
      }
    }
    return false;
  }

  override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    const z = coords.z;
    const x = coords.x;
    const y = coords.y;
    const terminer = (el: HTMLElement) => done(null!, el);

    // Sécurité : coordonnées invalides (NaN/Infini — ex. carte encore en cours
    // d'initialisation ou état corrompu) ou hors monde → tuile grise, jamais de
    // requête réseau (OSM répondrait 400 à « NaN/20708/18134.png »).
    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || z < 0 || x < 0 || y < 0) {
      tile.src = TUILE_ABSENTE;
      terminer(tile);
      return tile;
    }

    const bundledUrl = BUNDLED_TILE_URL
      .replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    const useBundledTile = () => new Promise<boolean>((resolve) => {
      if (z > BUNDLED_MAX_ZOOM) {
        resolve(false);
        return;
      }
      const image = new Image();
      image.onload = () => {
        tile.src = bundledUrl;
        terminer(tile);
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = bundledUrl;
    });

    if (!this.estSqliteDisponible()) {
      // Pas de cache local possible (encore) : tuile OSM en ligne ou tuile grise.
      useBundledTile().then(async (bundled) => {
        if (bundled) return;
        if (this.forceOffline || !navigator.onLine) {
          // Hors-ligne : dernier recours = tuile ancêtre (assets embarqués),
          // plutôt qu'une carte entièrement grise.
          const trouvee = await this.afficherTuileAncetre(coords, tile);
          if (trouvee) {
            terminer(tile);
          } else {
            tile.src = TUILE_ABSENTE;
            terminer(tile);
          }
          return;
        }
        const url = this.getTileUrl(coords as any);
        if (url === TUILE_ABSENTE) {
          tile.src = TUILE_ABSENTE;
          terminer(tile);
          return;
        }
        const img = new Image();
        img.onload = () => { tile.src = img.src; terminer(tile); };
        img.onerror = () => { tile.src = TUILE_ABSENTE; terminer(tile); };
        img.src = url;
      });
      return tile;
    }

    useBundledTile()
      .then(async (bundled) => bundled ? 'bundled' : db.getTuile(z, x, y))
      .then(async (dataUrl) => {
        if (dataUrl === 'bundled') return;
        if (!dataUrl) {
          if (this.forceOffline || !navigator.onLine) {
            // Hors-ligne : tuile absente du cache → tuile ancêtre (SQLite ou
            // assets embarqués) au lieu d'une tuile grise.
            const trouvee = await this.afficherTuileAncetre(coords, tile);
            if (trouvee) {
              terminer(tile);
            } else {
              tile.src = TUILE_ABSENTE;
              terminer(tile);
            }
            return;
          }
          const url = this.getTileUrl(coords as any);
          if (url === TUILE_ABSENTE) {
            tile.src = TUILE_ABSENTE;
            terminer(tile);
            return;
          }
          const img = new Image();
          img.onload = () => {
            tile.src = img.src;
            terminer(tile);
          };
          img.onerror = () => { tile.src = TUILE_ABSENTE; terminer(tile); };
          img.src = url;
          return;
        }
        if (dataUrl) {
          tile.src = dataUrl;
          terminer(tile);
          return;
        }
        if (this.forceOffline || !navigator.onLine) {
          tile.src = TUILE_ABSENTE;
          terminer(tile);
          return;
        }
        // Tuile absente + en ligne → téléchargement puis mise en cache.
        const url = this.getTileUrl(coords as any);
        if (url === TUILE_ABSENTE) {
          // Zoom interne indisponible → tuile grise, aucune requête réseau.
          tile.src = TUILE_ABSENTE;
          terminer(tile);
          return;
        }
        const img = new Image();
        img.onload = () => {
          tile.src = img.src;
          terminer(tile);
        };
        img.onerror = () => {
          tile.src = TUILE_ABSENTE;
          terminer(tile);
        };
        img.src = url;
      })
      .catch(async () => {
        // Erreur SQLite (pas encore initialisée, couche retirée…) → repli
        // réseau, mais jamais avec un zoom invalide (NaN). Hors-ligne, on
        // tente d'abord une tuile ancêtre plutôt qu'une tuile grise.
        if (this.forceOffline || !navigator.onLine) {
          const trouvee = await this.afficherTuileAncetre(coords, tile);
          if (trouvee) {
            terminer(tile);
            return;
          }
          tile.src = TUILE_ABSENTE;
          terminer(tile);
          return;
        }
        const url = this.getTileUrl(coords as any);
        if (url === TUILE_ABSENTE) {
          tile.src = TUILE_ABSENTE;
        } else {
          tile.src = url;
        }
        terminer(tile);
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
  /** Zone explicite à télécharger ; par défaut, la vue actuelle. */
  bounds?: [L.LatLngExpression, L.LatLngExpression];
  /** Limite par niveau, plus haute uniquement pour une zone nationale. */
  maxTilesParNiveau?: number;
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
  const minZoom = Math.max(5, opts.minZoom);
  const maxZoom = Math.min(19, opts.maxZoom);

  const zone = opts.bounds ? L.latLngBounds(opts.bounds) : map.getBounds();
  const nord = zone.getNorth();
  const sud = zone.getSouth();
  const est = zone.getEast();
  const ouest = zone.getWest();
  const maxTilesParNiveau = opts.maxTilesParNiveau ?? 150;

  // Liste (z,x,y) à télécharger.
  const liste: Array<{ z: number; x: number; y: number }> = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const tNW = latLngToTile(nord, ouest, z);
    const tSE = latLngToTile(sud, est, z);
    const xMin = Math.max(0, Math.min(tNW.x, tSE.x));
    const xMax = Math.max(tNW.x, tSE.x);
    const yMin = Math.max(0, Math.min(tNW.y, tSE.y));
    const yMax = Math.max(tNW.y, tSE.y);
    // Limite de sécurité pour éviter un téléchargement accidentel massif.
    if ((xMax - xMin + 1) * (yMax - yMin + 1) > maxTilesParNiveau) {
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
