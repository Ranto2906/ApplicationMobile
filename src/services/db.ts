// ══════════════════════════════════════════════════════════════
// SQLite — stockage local (hors-ligne)
//  - `signalements_pending` : signalements créés hors-ligne, à synchroniser
//  - `map_tiles`            : tuiles Leaflet mises en cache (mode hors-ligne)
//  - `meta`                 : clés/valeurs (schéma, dernière synchro…)
// ══════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';

const DB_NAME = 'seimad_offline';
const DB_VERSION = 1;

export interface PendingSignalement {
  /** id local (uuid v4 généré sur l'appareil) */
  idLocal: string;
  /** JSON du payload SignalementRequest accepté par le backend */
  payload: string;
  /** JSON array de { dataUrl, typePhoto?, datePrise?, observation? } */
  photos: string;
  createdAt: string;
}

export interface CachedTile {
  z: number;
  x: number;
  y: number;
  dataUrl: string;
  savedAt: string;
}

class DatabaseService {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;

  /** Initialise (une seule fois) : jeep-sqlite côté web + ouverture de la base. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((e) => {
        this.initPromise = null; // permet de réessayer après un échec
        throw e;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const platform = Capacitor.getPlatform();
    if (platform === 'web') {
      await customElements.whenDefined('jeep-sqlite');
      await this.sqlite.initWebStore();
    }
    if (!(await this.sqlite.isConnection(DB_NAME, false))) {
      this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    } else {
      this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
    }
    await this.db.open();
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS signalements_pending (
        id_local      TEXT PRIMARY KEY,
        payload       TEXT NOT NULL,
        photos        TEXT NOT NULL DEFAULT '[]',
        created_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS map_tiles (
        z        INTEGER NOT NULL,
        x        INTEGER NOT NULL,
        y        INTEGER NOT NULL,
        data_url TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (z, x, y)
      );
      CREATE TABLE IF NOT EXISTS meta (
        cle  TEXT PRIMARY KEY,
        valeur TEXT NOT NULL
      );
    `);
    await this.saveToStore();
  }

  /** Sur web : persiste la base (IndexedDB via jeep-sqlite). No-op sur natif. */
  private async saveToStore(): Promise<void> {
    await this.sqlite.saveToStore(DB_NAME);
  }

  private async getDb(): Promise<SQLiteDBConnection> {
    await this.init();
    if (!this.db) throw new Error('Base SQLite non initialisée');
    return this.db;
  }

  // ── Meta ──
  async getMeta(cle: string): Promise<string | null> {
    const db = await this.getDb();
    const r = await db.query('SELECT valeur FROM meta WHERE cle = ?', [cle]);
    return r.values && r.values.length > 0 ? String((r.values[0] as any).valeur) : null;
  }

  async setMeta(cle: string, valeur: string): Promise<void> {
    const db = await this.getDb();
    await db.run(
      'INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
      [cle, valeur]
    );
    await this.saveToStore();
  }

  // ── Signalements en attente de synchronisation ──
  async ajouterSignalementPending(sig: PendingSignalement): Promise<void> {
    const db = await this.getDb();
    await db.run(
      'INSERT OR REPLACE INTO signalements_pending (id_local, payload, photos, created_at) VALUES (?, ?, ?, ?)',
      [sig.idLocal, sig.payload, sig.photos, sig.createdAt]
    );
    await this.saveToStore();
  }

  async listerSignalementsPending(): Promise<PendingSignalement[]> {
    const db = await this.getDb();
    const r = await db.query('SELECT * FROM signalements_pending ORDER BY created_at ASC');
    return (r.values ?? []).map((v: any) => ({
      idLocal: v.id_local,
      payload: v.payload,
      photos: v.photos,
      createdAt: v.created_at,
    }));
  }

  async supprimerSignalementPending(idLocal: string): Promise<void> {
    const db = await this.getDb();
    await db.run('DELETE FROM signalements_pending WHERE id_local = ?', [idLocal]);
    await this.saveToStore();
  }

  async nombreSignalementsPending(): Promise<number> {
    const db = await this.getDb();
    const r = await db.query('SELECT COUNT(*) AS n FROM signalements_pending');
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  // ── Cache de tuiles carte ──
  async getTuile(z: number, x: number, y: number): Promise<string | null> {
    const db = await this.getDb();
    const r = await db.query('SELECT data_url FROM map_tiles WHERE z = ? AND x = ? AND y = ?', [z, x, y]);
    return r.values && r.values.length > 0 ? String((r.values[0] as any).data_url) : null;
  }

  async tuileExiste(z: number, x: number, y: number): Promise<boolean> {
    return (await this.getTuile(z, x, y)) !== null;
  }

  async sauverTuile(z: number, x: number, y: number, dataUrl: string): Promise<void> {
    const db = await this.getDb();
    await db.run(
      'INSERT OR REPLACE INTO map_tiles (z, x, y, data_url, saved_at) VALUES (?, ?, ?, ?, ?)',
      [z, x, y, dataUrl, new Date().toISOString()]
    );
    await this.saveToStore();
  }

  async compterTuiles(): Promise<number> {
    const db = await this.getDb();
    const r = await db.query('SELECT COUNT(*) AS n FROM map_tiles');
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  async viderCacheTuiles(): Promise<void> {
    const db = await this.getDb();
    await db.run('DELETE FROM map_tiles');
    await this.saveToStore();
  }
}

export const db = new DatabaseService();

/** Découpage d'un blob/base64 en data-url compatible SQLite (base64). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
