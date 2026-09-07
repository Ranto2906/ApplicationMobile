// ══════════════════════════════════════════════════════════════
// SQLite — base locale (hors-ligne), cœur de l'application mobile
//  - `pending_operations`   : file générique d'écritures hors-ligne (créations/
//    modifications) à pousser vers le backend au moment de la synchronisation
//  - `geometrie_locale`     : géométries (GeoJSON texte) des signalements créés
//    depuis le mobile — « en attente de synchronisation » (synchronise=0) puis
//    marquées envoyées (synchronise=1) ; stockées côté serveur dans `geometrie`
//  - `map_tiles`            : tuiles Leaflet mises en cache (mode hors-ligne)
//  - `referentiels_cache`   : types/villes/statuts … pour les formulaires hors-ligne
//  - `meta`                 : clés/valeurs (schéma, session locale, dernière synchro…)
// ══════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { UtilisateurDTO } from '../types';

const DB_NAME = 'seimad_offline';
const DB_VERSION = 1;

/**
 * Session locale (mode hors-ligne).
 * - `user`            : profil utilisateur (dernière connexion en ligne)
 * - `sel` + `hash`    : empreinte SHA-256(sel + motDePasse) — jamais le mot de
 *   passe en clair — pour permettre une reconnexion hors-ligne sur l'appareil
 * - `accessToken`/`refreshToken` : copie de secours si le stockage web est vidé
 */
export interface SessionLocale {
  user: UtilisateurDTO | null;
  nomUtilisateur: string;
  sel: string;
  hash: string;
  accessToken?: string;
  refreshToken?: string;
  savedAt: string;
}

const CLE_SESSION = 'session_locale';

export interface PointGPS {
  lat: number;
  lng: number;
}

/**
 * Géométrie locale (SQLite) — miroir de la table `geometrie` du backend.
 * Le contenu est un GeoJSON texte (ex. {"type":"Point","coordinates":[47.507,-18.879]}).
 */
export interface GeometrieLocale {
  /** UUID généré côté client (texte, SQLite n'a pas de type UUID). */
  idGeometrie: string;
  entiteType: string;
  entiteId: string;
  /** 'Point' ou 'Polygon'. */
  typeGeometrie: string;
  geojson: string;
  precisionM?: number | null;
  source?: string | null;
  /** 0 = en attente d'envoi, 1 = synchronisée. */
  synchronise: number;
  dateCreation: string;
}

export interface PendingSignalement {
  /** id local (uuid v4 généré sur l'appareil) */
  idLocal: string;
  /** JSON du payload SignalementRequest accepté par le backend */
  payload: string;
  /** JSON array de { dataUrl, typePhoto?, datePrise? } */
  photos: string;
  /** JSON {lat,lng} */
  position: string;
  createdAt: string;
}

/**
 * Opération hors-ligne générique (même principe que `signalements_pending`,
 * mais pour n'importe quelle entité : signalement, notification, avertissement…).
 * C'est cette file que le bouton « Synchroniser » pousse vers le backend.
 */
export interface PendingOperation {
  /** id local (uuid v4 généré sur l'appareil) */
  idLocal: string;
  /** type d'entité : 'signalement' | 'notification' | 'avertissement' | … */
  entiteType: string;
  /** action à rejouer : création ou modification */
  action: 'CREATE' | 'UPDATE';
  /** JSON du payload (SignalementRequest / NotificationOccupationRequest / …) */
  payload: string;
  /** JSON array de { dataUrl, typePhoto?, datePrise?, observation? } */
  photos: string;
  /** JSON {lat,lng} */
  position: string;
  createdAt: string;
}

class DatabaseService {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;

  // jeep-sqlite (sql.js, web) ne sérialise PAS deux écritures concurrentes
  // sur la même connexion : deux `run` simultanés (ex. React StrictMode qui
  // monte deux fois un écran, Promise.all sur plusieurs sauvegardes, tile + op
  // pending…) peuvent faire échouer silencieusement une écriture. Toutes les
  // écritures passent donc par une file interne (FIFO). Les lectures restent
  // parallèles.
  private fileEcritures: Promise<unknown> = Promise.resolve();
  private enqueueEcriture<T>(op: () => Promise<T>): Promise<T> {
    const suivant = this.fileEcritures.then(op, op);
    this.fileEcritures = suivant.catch(() => undefined);
    return suivant;
  }

  // État observable pour les composants qui veulent afficher une progression.
  private état = 'not-ready' as 'not-ready' | 'in-flight' | 'ready' | 'error';
  private listeners = new Set<() => void>();

  constatÉtat(): 'not-ready' | 'in-flight' | 'ready' | 'error' {
    return this.état;
  }

  private notifier() {
    this.listeners.forEach((l) => l());
  }

  /** Enregistre un callback appelé à chaque changement d'état d'initialisation. */
  écouterÉtat(cb: () => void): () => void {
    this.listeners.add(cb);
    cb();
    return () => { this.listeners.delete(cb); };
  }/**
 * Initialise (une seule fois) : jeep-sqlite côté web + ouverture de la base.
 *
 * Sur web, le premier démarrage charge le WASM + IndexedDB : c'est normalement
 * lent. Si le composant custom `<jeep-sqlite>` n'est pas disponible, on ne
 * bloque pas l'application : le flag `__SEIMAD_WEB_SQLITE_AVAILABLE__` est déjà
 * positionné au démarrage et `doInit` échoue immédiatement avec un message clair.
 *
 * `initPromise` reste nullable après un échec pour permettre de réessayer plus
 * tard (ex. si le loader venait à définir le composant plus tard — rare en dev).
 */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.état = 'in-flight';
      this.notifier();
      console.log(`[SEIMAD:db] init → démarrage (premier appel)`);
      const début = performance.now();
      this.initPromise = this.doInit().then(() => {
        this.état = 'ready';
        this.notifier();
        console.log(`[SEIMAD:db] init → prête en ${(performance.now() - début).toFixed(0)}ms`);
      }).catch((e) => {
        this.état = 'error';
        this.notifier();
        console.error(`[SEIMAD:db] init → ÉCHEC`, e?.message || e, e?.stack || '');
        // Réessai plus tard possible si la cause était temporaire.
        this.initPromise = null;
        throw e;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const platform = Capacitor.getPlatform();
    console.log(`[SEIMAD:db] doInit → plateforme:`, platform);

    if (platform === 'web') {
      // Enregistrement du composant <jeep-sqlite> : fait par main.tsx au
      // démarrage. Trois cas possibles ici :
      //  1. le loader est encore en cours (__SEIMAD_SQLITE_LOADING__) → on
      //     attend ;
      //  2. le composant est déjà défini → on continue ;
      //  3. le loader a fini sans succès → échec immédiat et clair (pas de
      //     blocage de 10 s à chaque appel).
      const win = window as any;
      const chargementEnCours = !!win.__SEIMAD_SQLITE_LOADING__;
      const élémentDéfini =
        typeof customElements !== 'undefined' && !!customElements.get('jeep-sqlite');
      const flagDisponible = !!win.__SEIMAD_WEB_SQLITE_AVAILABLE__;

      if (!chargementEnCours && !élémentDéfini && !flagDisponible) {
        console.error(
          '[SEIMAD:db] doInit → ERREUR : <jeep-sqlite> non défini (web SQLite indisponible).',
          'Le loader jeep-sqlite n\'a pas résolu le bundle lazy ou /assets/sql-wasm.wasm n\'est pas servi.'
        );
        throw new Error('jeep-sqlite non défini (web SQLite indisponible)');
      }

      if (!élémentDéfini) {
        console.log(`[SEIMAD:db] doInit → attente jeep-sqlite (customElements.whenDefined)…`);
        const délaiDébut = performance.now();
        const timeout = 10_000; // 10s max : si le loader ne répond pas, on arrête d'attendre
        await Promise.race([
          customElements.whenDefined('jeep-sqlite'),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`customElements.whenDefined('jeep-sqlite') timeout (${timeout}ms)`)), timeout)
          ),
        ]);
        console.log(`[SEIMAD:db] doInit → jeep-sqlite défini après ${(performance.now() - délaiDébut).toFixed(0)}ms`);
      }

      console.log(`[SEIMAD:db] doInit → initWebStore…`);
      await this.sqlite.initWebStore();
      console.log(`[SEIMAD:db] doInit → initWebStore ok`);
    }

    console.log(`[SEIMAD:db] doInit → ouverture connexion`, DB_NAME);
    // NB : `isConnection` renvoie { result: boolean } (capSQLiteResult), pas un
    // booléen brut — tester l'objet directement aurait toujours pris la branche
    // « retrieveConnection » et échoué avec « Connection … does not exist ».
    const connexionExistante = (await this.sqlite.isConnection(DB_NAME, false)).result;
    if (!connexionExistante) {
      this.db = await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
      console.log(`[SEIMAD:db] doInit → connexion créée`);
    } else {
      this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
      console.log(`[SEIMAD:db] doInit → connexion récupérée (existante)`);
    }

    await this.db.open();
    console.log(`[SEIMAD:db] doInit → db.open ok`);
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS signalements_pending (
        id_local      TEXT PRIMARY KEY,
        payload       TEXT NOT NULL,
        photos        TEXT NOT NULL DEFAULT '[]',
        position      TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_operations (
        id_local    TEXT PRIMARY KEY,
        entite_type TEXT NOT NULL,
        action      TEXT NOT NULL DEFAULT 'CREATE',
        payload     TEXT NOT NULL,
        photos      TEXT NOT NULL DEFAULT '[]',
        position    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS geometrie_locale (
        id_geometrie   TEXT PRIMARY KEY,
        entite_type    TEXT NOT NULL,
        entite_id      TEXT NOT NULL,
        type_geometrie TEXT NOT NULL,
        geojson        TEXT NOT NULL,
        precision_m    REAL,
        source         TEXT,
        synchronise    INTEGER NOT NULL DEFAULT 0,
        date_creation  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_geometrie_locale_entite ON geometrie_locale(entite_type, entite_id);
      CREATE TABLE IF NOT EXISTS map_tiles (
        z        INTEGER NOT NULL,
        x        INTEGER NOT NULL,
        y        INTEGER NOT NULL,
        data_url TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        PRIMARY KEY (z, x, y)
      );
      CREATE TABLE IF NOT EXISTS referentiels_cache (
        cle      TEXT PRIMARY KEY,
        valeur   TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        cle  TEXT PRIMARY KEY,
        valeur TEXT NOT NULL
      );
    `);
    // Tables retirées du mobile (pas de pull : la synchronisation ne fait que
    // pousser vers le backend) : nettoyage des bases créées entre-temps.
    await this.db.execute(`
      DROP TABLE IF EXISTS signalements_miroir;
      DROP TABLE IF EXISTS photos_cache;
      DROP TABLE IF EXISTS notifications_miroir;
      DROP TABLE IF EXISTS avertissements_miroir;
      DROP TABLE IF EXISTS personnes_miroir;
    `);
    // Migration v1 → v2 : l'ancienne table `signalements_positions` (lat/lng
    // en cache local, jamais envoyés au serveur) est remplacée par
    // `geometrie_locale` (GeoJSON + drapeau de synchronisation).
    await this.migrerPositionsVersGeometrie();
    console.log(`[SEIMAD:db] doInit → création des tables métier ok`);
    console.log(`[SEIMAD:db] doInit → terminé (web SQLite OK)`);

    // Persister tôt pour éviter une perte en cas de fermeture entre-temps.
    console.log(`[SEIMAD:db] doInit → saveToStore…`);
    await this.saveToStore();
    console.log(`[SEIMAD:db] doInit → saveToStore ok`);
  }

  /**
   * Migre les positions GPS de l'ancienne version (table signalements_positions,
   * clé = id serveur du signalement) vers `geometrie_locale` en GeoJSON Point.
   * Ces signalements existent déjà côté serveur : la géométrie est conservée en
   * cache local (synchronise=1), l'ancienne table est ensuite supprimée.
   */
  private async migrerPositionsVersGeometrie(): Promise<void> {
    const db = this.db;
    if (!db) return;
    try {
      const existe = await db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='signalements_positions'"
      );
      if (!existe.values || existe.values.length === 0) return;
      const r = await db.query('SELECT id_entite, lat, lng, saved_at FROM signalements_positions');
      for (const v of (r.values ?? [])) {
        const idEntite = String((v as any).id_entite);
        const lat = Number((v as any).lat);
        const lng = Number((v as any).lng);
        if (!idEntite || Number.isNaN(lat) || Number.isNaN(lng)) continue;
        const geojson = JSON.stringify({ type: 'Point', coordinates: [lng, lat] });
        await db.run(
          `INSERT OR REPLACE INTO geometrie_locale
             (id_geometrie, entite_type, entite_id, type_geometrie, geojson, precision_m, source, synchronise, date_creation)
           VALUES (?, 'signalement', ?, 'Point', ?, NULL, 'Import GPS', 1, ?)`,
          [uuidV4(), idEntite, geojson, String((v as any).saved_at || new Date().toISOString())]
        );
      }
      await db.run('DROP TABLE IF EXISTS signalements_positions');
      console.log(`[SEIMAD:db] migration → ${(r.values ?? []).length} position(s) vers geometrie_locale`);
    } catch (e: any) {
      // Table absente (nouvelle installation) ou déjà migrée : rien à faire.
      console.log(`[SEIMAD:db] migration signalements_positions ignorée`, e?.message || e);
    }
  }

  /** Sur web : persiste la base (IndexedDB via jeep-sqlite). No-op sur natif. */
  private async saveToStore(): Promise<void> {
    await this.sqlite.saveToStore(DB_NAME);
  }

  private async getDb(): Promise<SQLiteDBConnection> {
    await this.init();
    if (!this.db) {
      console.error(`[SEIMAD:db] getDb → Base SQLite non initialisée`);
      throw new Error('Base SQLite non initialisée');
    }
    return this.db;
  }

  // ── Meta (avec repli best-effort — ne bloque pas le premier rendu) ──

  async getMeta(cle: string): Promise<string | null> {
    try {
      const db = await this.getDb();
      const r = await db.query('SELECT valeur FROM meta WHERE cle = ?', [cle]);
      return r.values && r.values.length > 0 ? String((r.values[0] as any).valeur) : null;
    } catch (e: any) {
      console.warn(`[SEIMAD:db] getMeta → repli (base non prête) pour cle=${cle}`, e?.message || e);
      return null;
    }
  }

  async setMeta(cle: string, valeur: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      try {
        const db = await this.getDb();
        await db.run(
          'INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur',
          [cle, valeur]
        );
        await this.saveToStore();
      } catch (e: any) {
        console.warn(`[SEIMAD:db] setMeta → écriture ignorée pour cle=${cle}`, e?.message || e);
      }
    });
  }

  // ── Signalements en attente de synchronisation ──
  async ajouterSignalementPending(sig: PendingSignalement): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(
        'INSERT OR REPLACE INTO signalements_pending (id_local, payload, photos, position, created_at) VALUES (?, ?, ?, ?, ?)',
        [sig.idLocal, sig.payload, sig.photos, sig.position, sig.createdAt]
      );
      await this.saveToStore();
    });
  }

  async listerSignalementsPending(): Promise<PendingSignalement[]> {
    const db = await this.getDb();
    const r = await db.query('SELECT * FROM signalements_pending ORDER BY created_at DESC');
    return (r.values ?? []).map((v: any) => ({
      idLocal: v.id_local,
      payload: v.payload,
      photos: v.photos,
      position: v.position,
      createdAt: v.created_at,
    }));
  }

  async trouverSignalementPending(idLocal: string): Promise<PendingSignalement | null> {
    const db = await this.getDb();
    const r = await db.query('SELECT * FROM signalements_pending WHERE id_local = ?', [idLocal]);
    if (!r.values || r.values.length === 0) return null;
    const v = r.values[0] as any;
    return {
      idLocal: v.id_local,
      payload: v.payload,
      photos: v.photos,
      position: v.position,
      createdAt: v.created_at,
    };
  }

  async supprimerSignalementPending(idLocal: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run('DELETE FROM signalements_pending WHERE id_local = ?', [idLocal]);
      await this.saveToStore();
    });
  }

  async nombreSignalementsPending(): Promise<number> {
    const db = await this.getDb();
    const r = await db.query('SELECT COUNT(*) AS n FROM signalements_pending');
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  // ── Géométries locales (signalements créés sur le mobile) ──
  // Une seule géométrie par (entite_type, entite_id) : l'écriture remplace
  // l'ancienne ligne de la même entité (INSERT OR REPLACE par clé primaire
  // id_geometrie après suppression de l'éventuelle ligne existante).
  async sauverGeometrieLocale(g: {
    entiteType: string;
    entiteId: string;
    typeGeometrie: string;
    geojson: string;
    precisionM?: number | null;
    source?: string | null;
    synchronise?: number;
  }): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      const idGeometrie = uuidV4();
      await db.run('DELETE FROM geometrie_locale WHERE entite_type = ? AND entite_id = ?', [g.entiteType, g.entiteId]);
      await db.run(
        `INSERT INTO geometrie_locale
           (id_geometrie, entite_type, entite_id, type_geometrie, geojson, precision_m, source, synchronise, date_creation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idGeometrie, g.entiteType, g.entiteId, g.typeGeometrie, g.geojson,
          g.precisionM ?? null, g.source ?? null, g.synchronise ?? 0,
          new Date().toISOString(),
        ]
      );
      await this.saveToStore();
    });
  }

  async lireGeometrieLocale(entiteType: string, entiteId: string): Promise<GeometrieLocale | null> {
    const db = await this.getDb();
    const r = await db.query(
      'SELECT id_geometrie, entite_type, entite_id, type_geometrie, geojson, precision_m, source, synchronise, date_creation FROM geometrie_locale WHERE entite_type = ? AND entite_id = ?',
      [entiteType, entiteId]
    );
    if (!r.values || r.values.length === 0) return null;
    const v = r.values[0] as any;
    return {
      idGeometrie: String(v.id_geometrie),
      entiteType: String(v.entite_type),
      entiteId: String(v.entite_id),
      typeGeometrie: String(v.type_geometrie),
      geojson: String(v.geojson),
      precisionM: v.precision_m != null ? Number(v.precision_m) : null,
      source: v.source != null ? String(v.source) : null,
      synchronise: Number(v.synchronise),
      dateCreation: String(v.date_creation),
    };
  }

  /** Marque une géométrie locale synchronisée (l'entite_id devient l'id serveur après création). */
  async marquerGeometrieSynchronisee(idGeometrie: string, nouvelEntiteId: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(
        'UPDATE geometrie_locale SET entite_id = ?, synchronise = 1 WHERE id_geometrie = ?',
        [nouvelEntiteId, idGeometrie]
      );
      await this.saveToStore();
    });
  }

  async supprimerGeometrieLocale(entiteType: string, entiteId: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run('DELETE FROM geometrie_locale WHERE entite_type = ? AND entite_id = ?', [entiteType, entiteId]);
      await this.saveToStore();
    });
  }

  async listerGeometriesNonSynchronisees(): Promise<GeometrieLocale[]> {
    const db = await this.getDb();
    const r = await db.query('SELECT id_geometrie, entite_type, entite_id, type_geometrie, geojson, precision_m, source, synchronise, date_creation FROM geometrie_locale WHERE synchronise = 0');
    return (r.values ?? []).map((v: any) => ({
      idGeometrie: String(v.id_geometrie),
      entiteType: String(v.entite_type),
      entiteId: String(v.entite_id),
      typeGeometrie: String(v.type_geometrie),
      geojson: String(v.geojson),
      precisionM: v.precision_m != null ? Number(v.precision_m) : null,
      source: v.source != null ? String(v.source) : null,
      synchronise: Number(v.synchronise),
      dateCreation: String(v.date_creation),
    }));
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
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(
        'INSERT OR REPLACE INTO map_tiles (z, x, y, data_url, saved_at) VALUES (?, ?, ?, ?, ?)',
        [z, x, y, dataUrl, new Date().toISOString()]
      );
      await this.saveToStore();
    });
  }

  async compterTuiles(): Promise<number> {
    const db = await this.getDb();
    const r = await db.query('SELECT COUNT(*) AS n FROM map_tiles');
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  async viderCacheTuiles(): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run('DELETE FROM map_tiles');
      await this.saveToStore();
    });
  }

  // ── Session locale (authentification hors-ligne) ──
  async sauverSessionLocale(session: SessionLocale): Promise<void> {
    await this.setMeta(CLE_SESSION, JSON.stringify(session));
  }

  async lireSessionLocale(): Promise<SessionLocale | null> {
    const raw = await this.getMeta(CLE_SESSION);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionLocale;
    } catch {
      return null;
    }
  }

  async supprimerSessionLocale(): Promise<void> {
    await this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run('DELETE FROM meta WHERE cle = ?', [CLE_SESSION]);
      await this.saveToStore();
      console.log(`[SEIMAD:db] supprimerSessionLocale → terminé`);
    });
  }

  // ── Cache de référentiels (types, villes … pour les formulaires hors-ligne) ──
  async sauverReferentiel(cle: string, valeurJson: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(
        'INSERT OR REPLACE INTO referentiels_cache (cle, valeur, saved_at) VALUES (?, ?, ?)',
        [cle, valeurJson, new Date().toISOString()]
      );
      await this.saveToStore();
    });
  }

  async lireReferentiel(cle: string): Promise<string | null> {
    const db = await this.getDb();
    const r = await db.query('SELECT valeur FROM referentiels_cache WHERE cle = ?', [cle]);
    return r.values && r.values.length > 0 ? String((r.values[0] as any).valeur) : null;
  }

  // ── File générique d'opérations hors-ligne (poussée à la synchro) ──
  async ajouterOperationPending(op: PendingOperation): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(
        'INSERT OR REPLACE INTO pending_operations (id_local, entite_type, action, payload, photos, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [op.idLocal, op.entiteType, op.action, op.payload, op.photos, op.position, op.createdAt]
      );
      await this.saveToStore();
    });
  }

  async listerOperationsPending(): Promise<PendingOperation[]> {
    const db = await this.getDb();
    const r = await db.query('SELECT * FROM pending_operations ORDER BY created_at ASC');
    return (r.values ?? []).map((v: any) => ({
      idLocal: v.id_local,
      entiteType: v.entite_type,
      action: v.action as 'CREATE' | 'UPDATE',
      payload: v.payload,
      photos: v.photos,
      position: v.position,
      createdAt: v.created_at,
    }));
  }

  async trouverOperationPending(idLocal: string): Promise<PendingOperation | null> {
    const db = await this.getDb();
    const r = await db.query('SELECT * FROM pending_operations WHERE id_local = ?', [idLocal]);
    if (!r.values || r.values.length === 0) return null;
    const v = r.values[0] as any;
    return {
      idLocal: v.id_local,
      entiteType: v.entite_type,
      action: v.action as 'CREATE' | 'UPDATE',
      payload: v.payload,
      photos: v.photos,
      position: v.position,
      createdAt: v.created_at,
    };
  }

  async supprimerOperationPending(idLocal: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run('DELETE FROM pending_operations WHERE id_local = ?', [idLocal]);
      await this.saveToStore();
    });
  }

  async nombreOperationsPending(): Promise<number> {
    const db = await this.getDb();
    const r = await db.query('SELECT COUNT(*) AS n FROM pending_operations');
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  /** Nombre de lignes d'une table. */
  async compterLignes(table: string): Promise<number> {
    const db = await this.getDb();
    const r = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
    return r.values && r.values.length > 0 ? Number((r.values[0] as any).n) : 0;
  }

  /** Vider une table (utilisé par POST /sqlite/tables/reset de l'API locale). */
  async viderTable(table: string): Promise<void> {
    return this.enqueueEcriture(async () => {
      const db = await this.getDb();
      await db.run(`DELETE FROM ${table}`);
      await this.saveToStore();
    });
  }

  /** Diagnostic : toutes les tables métier + leur nombre de lignes (miroir /sqlite/tables). */
  async listerTables(): Promise<Array<{ name: string; rowCount: number }>> {
    const noms = [
      'pending_operations', 'signalements_pending', 'geometrie_locale',
      'map_tiles', 'referentiels_cache',
    ];
    const result: Array<{ name: string; rowCount: number }> = [];
    for (const n of noms) {
      try {
        result.push({ name: n, rowCount: await this.compterLignes(n) });
      } catch {
        result.push({ name: n, rowCount: 0 });
      }
    }
    return result;
  }
}

export const db = new DatabaseService();

/** UUID v4 (texte) — utilisé pour id_geometrie côté client. */
function uuidV4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** data-url (base64) → Blob (pour les uploads multipart vers le backend). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mime = /data:(.*?);/.exec(header)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
