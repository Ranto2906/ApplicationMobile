// ══════════════════════════════════════════════════════════════
// API locale — communication avec la base SQLite du mobile
//
// Même principe que le `api.js` Express (better-sqlite3) du poste de
// supervision : un routeur déclaratif (méthode + chemin), des requêtes
// SQL paramétrées, des réponses JSON « mappées » (snake_case → camelCase),
// et des routes de diagnostic (`/sqlite/tables`, `/sqlite/tables/reset`).
//
// Sur le mobile il n'y a pas de serveur HTTP : `localApi.requete(...)`
// exécute la route correspondante DIRECTEMENT sur la base SQLite.
// Les écritures hors-ligne sont mises en file (`pending_operations`) puis
// poussées vers Spring Boot par le bouton « Synchroniser ».
// ══════════════════════════════════════════════════════════════
import { db } from './db';
import type { PendingOperation } from './db';
import type { SignalementRequest } from '../types/signalement';

// ── Types de la « réponse HTTP » locale ──
export interface ReponseLocale {
  status: number;
  data: unknown;
}

export interface ContexteRequete {
  params: Record<string, string>;
  query: Record<string, string>;
  corps: any;
}

interface RouteLocale {
  methode: string;
  patron: RegExp;
  cles: string[];
  gestionnaire: (ctx: ContexteRequete) => Promise<unknown>;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function patron(chemin: string): { regex: RegExp; cles: string[] } {
  const cles: string[] = [];
  const regex = new RegExp(
    '^' +
      chemin
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\:(\w+)/g, (_, c: string) => { cles.push(c); return '([^/]+)'; }) +
      '$'
  );
  return { regex, cles };
}

// ══════════════════════════════════════════════════════════════
// Routeur — le pendant du `router.get/post/put/delete` d'Express
// ══════════════════════════════════════════════════════════════
const ROUTES: RouteLocale[] = [];

function route(methode: string, chemin: string, gestionnaire: (ctx: ContexteRequete) => Promise<unknown>): void {
  const { regex, cles } = patron(chemin);
  ROUTES.push({ methode, patron: regex, cles, gestionnaire });
}

// ── Signalements (écritures hors-ligne uniquement — pas de pull) ──
route('POST', '/signalements', async (ctx) => {
  // Écriture hors-ligne : mise en file, poussée vers Spring Boot à la synchro.
  const { photos, position, ...request } = ctx.corps ?? {};
  const op: PendingOperation = {
    idLocal: uuid(),
    entiteType: 'signalement',
    action: 'CREATE',
    payload: JSON.stringify(request),
    photos: JSON.stringify(photos ?? []),
    position: JSON.stringify(position ?? {}),
    createdAt: new Date().toISOString(),
  };
  await db.ajouterOperationPending(op);
  // Miroir local de la géométrie (géometrie_locale) : comme le faisait
  // SignalementCreate directement, mais centralisé ici pour que TOUTES les
  // écritures hors-ligne passent par « l'API locale » de l'application.
  const req = request as SignalementRequest;
  if (req?.geometrie?.geojson) {
    await db.sauverGeometrieLocale({
      entiteType: 'signalement',
      entiteId: op.idLocal,
      typeGeometrie: req.geometrie.typeGeometrie || 'Point',
      geojson: req.geometrie.geojson,
      precisionM: req.geometrie.precisionM ?? null,
      source: req.geometrie.source ?? null,
      synchronise: 0,
    }).catch(() => undefined); // non bloquant : le signalement reste en file
  }
  return { idLocal: op.idLocal, enAttente: true, message: 'Enregistré dans la base locale — à synchroniser' };
});
route('PUT', '/signalements/:id', async (ctx) => {
  const { photos, position, ...request } = ctx.corps ?? {};
  const op: PendingOperation = {
    idLocal: uuid(),
    entiteType: 'signalement',
    action: 'UPDATE',
    payload: JSON.stringify({ ...request, idSignalement: ctx.params.id }),
    photos: JSON.stringify(photos ?? []),
    position: JSON.stringify(position ?? {}),
    createdAt: new Date().toISOString(),
  };
  await db.ajouterOperationPending(op);
  return { idLocal: op.idLocal, enAttente: true, message: 'Modification enregistrée localement — à synchroniser' };
});

// ── Descente Terrain (écritures hors-ligne) ──
route('POST', '/descente-terrain', async (ctx) => {
  const { photos, position, ...request } = ctx.corps ?? {};
  const op: PendingOperation = {
    idLocal: uuid(),
    entiteType: 'descente_terrain',
    action: 'CREATE',
    payload: JSON.stringify(request),
    photos: JSON.stringify(photos ?? []),
    position: JSON.stringify(position ?? {}),
    createdAt: new Date().toISOString(),
  };
  await db.ajouterOperationPending(op);
  return { idLocal: op.idLocal, enAttente: true, message: 'Descente enregistrée localement — à synchroniser' };
});
route('PUT', '/descente-terrain/:id', async (ctx) => {
  const { photos, position, ...request } = ctx.corps ?? {};
  const op: PendingOperation = {
    idLocal: uuid(),
    entiteType: 'descente_terrain',
    action: 'UPDATE',
    payload: JSON.stringify({ ...request, idDescente: ctx.params.id }),
    photos: JSON.stringify(photos ?? []),
    position: JSON.stringify(position ?? {}),
    createdAt: new Date().toISOString(),
  };
  await db.ajouterOperationPending(op);
  return { idLocal: op.idLocal, enAttente: true, message: 'Modification enregistrée localement — à synchroniser' };
});

// ── Référentiels (types/statuts/villes …) ──
route('GET', '/referentiels/:cle', async (ctx) => {
  const raw = await db.lireReferentiel(ctx.params.cle);
  if (!raw) throw Object.assign(new Error('Référentiel non trouvé'), { statut: 404 });
  try { return JSON.parse(raw); } catch { return raw; }
});

// ── File d'opérations en attente de synchronisation ──
route('GET', '/pending', async () => {
  const ops = await db.listerOperationsPending();
  return ops.map((o) => ({
    idLocal: o.idLocal,
    entiteType: o.entiteType,
    action: o.action,
    payload: JSON.parse(o.payload || '{}'),
    createdAt: o.createdAt,
  }));
});

// ── Lectures hors-ligne (le mobile ne pull pas le serveur : ces routes
//    servent uniquement ce qui existe DÉJÀ dans la base SQLite locale) ──

/** Derniers signalements créés sur CET appareil et encore en attente (aperçu accueil). */
route('GET', '/signalements/offline', async () => {
  const ops = await db.listerOperationsPending();
  return ops
    .filter((o) => o.entiteType === 'signalement' && o.action === 'CREATE')
    .map((o) => {
      let pl: { description?: string; dateSignalement?: string } = {};
      try { pl = JSON.parse(o.payload) as { description?: string; dateSignalement?: string }; } catch { /* payload corrompu */ }
      return {
        idSignalement: o.idLocal,
        reference: pl.description?.slice(0, 40) || 'Brouillon local',
        description: pl.description,
        dateSignalement: o.createdAt,
        libelleType: 'Signalement local',
        libelleStatut: 'En attente de synchronisation',
        codeStatut: 'en_attente',
        couleurStatutHex: '#b7791f',
        nomVille: undefined as string | undefined,
        enAttente: true,
      };
    });
});

/** Statistiques du tableau de bord, calculées 100 % sur la base locale. */
route('GET', '/dashboard/stats', async () => {
  const [enAttente, photos, geometries] = await Promise.all([
    db.nombreOperationsPending(),
    db.nombrePhotosEnAttente(),
    db.listerGeometriesNonSynchronisees().catch(() => []),
  ]);
  return {
    enAttente,
    photos,
    geometriesNonSynchronisees: geometries.length,
    derniereSynchro: await db.getMeta('derniere_synchro'),
  };
});

// ── Diagnostic SQLite (miroir de api.js) ──
route('GET', '/sqlite/statut', async () => ({ message: 'SQLite is responding', base: 'seimad_offline' }));
route('GET', '/sqlite/tables', async () => db.listerTables());
route('POST', '/sqlite/tables/reset', async (ctx) => {
  const noms: string[] = Array.isArray(ctx.corps?.tableNames) ? ctx.corps.tableNames : [];
  let total = 0;
  for (const n of noms) {
    total += await db.compterLignes(n).catch(() => 0);
    await db.viderTable(n).catch(() => undefined);
  }
  return {
    success: true,
    message: `Tables ${noms.join(', ') || '(aucune)'} vidées avec succès.`,
    totalRowsDeleted: total,
    resetTables: noms,
  };
});

// ── Dispatcher (le « serveur HTTP » local) ──
export const localApi = {
  /**
   * Exécute une route locale sur SQLite.
   * Exemple : `await localApi.requete('GET', '/signalements', { params: { q, page, size } })`.
   * Retourne { status, data } ; lève une erreur { status } pour 404/500.
   */
  async requete(
    methode: string,
    chemin: string,
    options?: { params?: Record<string, string>; corps?: unknown }
  ): Promise<ReponseLocale> {
    try {
      for (const r of ROUTES) {
        if (r.methode !== methode.toUpperCase()) continue;
        const m = r.patron.exec(chemin);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.cles.forEach((c, i) => { params[c] = decodeURIComponent(m[i + 1]); });
        const data = await r.gestionnaire({
          params,
          query: options?.params ?? {},
          corps: options?.corps,
        });
        return { status: 200, data };
      }
      throw Object.assign(new Error(`Route locale non trouvée : ${methode} ${chemin}`), { statut: 404 });
    } catch (e: any) {
      if (e?.statut) throw e;
      throw Object.assign(new Error(e?.message || 'Erreur base locale'), { statut: 500 });
    }
  },

  /** Raccourci GET : renvoie directement la donnée. */
  async get<T = unknown>(chemin: string, params?: Record<string, string>): Promise<T> {
    const r = await this.requete('GET', chemin, { params });
    return r.data as T;
  },

  /** Raccourci POST : renvoie directement la donnée. */
  async post<T = unknown>(chemin: string, corps?: unknown): Promise<T> {
    const r = await this.requete('POST', chemin, { corps });
    return r.data as T;
  },

  /** Raccourci PUT : renvoie directement la donnée. */
  async put<T = unknown>(chemin: string, corps?: unknown): Promise<T> {
    const r = await this.requete('PUT', chemin, { corps });
    return r.data as T;
  },
};

export default localApi;