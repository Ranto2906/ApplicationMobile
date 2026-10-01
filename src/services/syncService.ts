// ══════════════════════════════════════════════════════════════
// Synchronisation — PUSH uniquement (bouton « Synchroniser »)
//
// Le mobile est un terminal de saisie terrain : il crée des signalements
// hors-ligne (file `pending_operations` dans SQLite) puis les envoie vers
// le backend Spring Boot. Aucun pull : le mobile ne télécharge pas les
// données du serveur.
// ══════════════════════════════════════════════════════════════
import { db, dataUrlToBlob } from './db';
import { signalementApi } from './signalementService';
import { descenteTerrainApi } from './descenteTerrainService';
import type { SignalementRequest } from '../types/signalement';
import type { DescenteTerrainRequest } from '../types/descenteTerrain';

export interface ResultatSync {
  total: number;
  reussis: number;
  echecs: number;
  /** Photos dont l'upload a échoué et qui ont été remises en file. */
  photosRefilees?: number;
}

interface PhotoLocale {
  dataUrl: string;
  typePhoto?: string;
  datePrise?: string;
  observation?: string;
}

/** UUID local pour les opérations de re-file. */
function nouvelIdLocal(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Forme FormData d'une photo (partagé par les 4 chemins d'envoi). */
function formDataPhoto(p: PhotoLocale, entiteType: string, entiteId: string, nom: string): FormData {
  const form = new FormData();
  form.append('fichier', dataUrlToBlob(p.dataUrl), nom);
  form.append('entiteType', entiteType);
  form.append('entiteId', entiteId);
  if (p.typePhoto) form.append('typePhoto', p.typePhoto);
  if (p.datePrise) form.append('datePrise', p.datePrise);
  if (p.observation) form.append('observation', p.observation);
  return form;
}

/**
 * Re-file les photos dont l'upload a échoué : une opération UPDATE (payload
 * complet + id serveur) est recréée pour que la prochaine synchronisation
 * les re-pousse. Sans cela, la photo serait perdue silencieusement.
 */
export async function refilerPhotosEchouees(
  entiteType: 'signalement' | 'descente_terrain',
  idServeur: string,
  request: SignalementRequest | DescenteTerrainRequest,
  echouees: PhotoLocale[],
): Promise<number> {
  if (echouees.length === 0) return 0;
  const champId = entiteType === 'signalement' ? 'idSignalement' : 'idDescente';
  await db.ajouterOperationPending({
    idLocal: nouvelIdLocal(),
    entiteType,
    action: 'UPDATE',
    payload: JSON.stringify({ ...request, [champId]: idServeur }),
    photos: JSON.stringify(echouees),
    position: '{}',
    createdAt: new Date().toISOString(),
  });
  return echouees.length;
}

/** Rejoue une opération de la file vers le backend. Retourne le nb de photos re-filées. */
async function pousserOperation(op: {
  idLocal: string; entiteType: string; action: string; payload: string;
  photos: string; position: string;
}): Promise<number> {
  if (op.entiteType === 'signalement') {
    const request = JSON.parse(op.payload) as SignalementRequest;
    if (op.action === 'CREATE') {
      // Opérations créées AVANT la version « geometrie » : le payload ne portait
      // que position {lat,lng}. On fabrique la géométrie GeoJSON à la volée pour
      // que la synchronisation l'envoie aussi dans la table `geometrie`.
      if (!request.geometrie) {
        const pos = JSON.parse(op.position || 'null') as { lat: number; lng: number } | null;
        if (pos) {
          request.geometrie = {
            typeGeometrie: 'Point',
            geojson: JSON.stringify({ type: 'Point', coordinates: [pos.lng, pos.lat] }),
            precisionM: undefined,
            source: 'Point carte',
          };
        }
      }

      const cree = await signalementApi.creer(request);

      // Géométrie conservée localement : la ligne créée sous l'id local (hors-ligne)
      // est ré-affectée à l'id serveur et marquée synchronisée.
      if (request.geometrie?.geojson && cree.idSignalement) {
        const geoLocale = await db.lireGeometrieLocale('signalement', op.idLocal).catch(() => null);
        if (geoLocale) {
          await db.marquerGeometrieSynchronisee(geoLocale.idGeometrie, cree.idSignalement);
        } else {
          await db.sauverGeometrieLocale({
            entiteType: 'signalement',
            entiteId: cree.idSignalement,
            typeGeometrie: request.geometrie.typeGeometrie || 'Point',
            geojson: request.geometrie.geojson,
            precisionM: request.geometrie.precisionM ?? null,
            source: request.geometrie.source ?? null,
            synchronise: 1,
          });
        }
      }

      // Photos du constat — un échec est re-filé (jamais perdu).
      const photos: PhotoLocale[] = JSON.parse(op.photos || '[]');
      const echouees: PhotoLocale[] = [];
      for (const p of photos) {
        try {
          await signalementApi.ajouterPhoto(formDataPhoto(p, 'signalement', cree.idSignalement, `signalement_${Date.now()}.png`));
        } catch {
          echouees.push(p);
        }
      }
      const refilees = await refilerPhotosEchouees('signalement', cree.idSignalement, request, echouees).catch(() => 0);
      return refilees;
    }
    if (op.action === 'UPDATE') {
      const avecId = request as SignalementRequest & { idSignalement?: string };
      const id = avecId.idSignalement;
      if (!id) throw new Error('idSignalement manquant pour la mise à jour');
      // Géométrie absente du payload (opérations anciennes) → fabriquée à la
      // volée depuis la position stockée, comme en création.
      if (!request.geometrie) {
        const pos = JSON.parse(op.position || 'null') as { lat: number; lng: number } | null;
        if (pos) {
          request.geometrie = {
            typeGeometrie: 'Point',
            geojson: JSON.stringify({ type: 'Point', coordinates: [pos.lng, pos.lat] }),
            source: 'Point carte',
          };
        }
      }
      await signalementApi.mettreAJour(id, request);
      // Géométrie envoyée → miroir local marqué synchronisé (affichage hors-ligne).
      if (request.geometrie?.geojson) {
        await db.sauverGeometrieLocale({
          entiteType: 'signalement',
          entiteId: id,
          typeGeometrie: request.geometrie.typeGeometrie || 'Point',
          geojson: request.geometrie.geojson,
          precisionM: request.geometrie.precisionM ?? null,
          source: request.geometrie.source ?? null,
          synchronise: 1,
        }).catch(() => undefined);
      }
      // Photos ajoutées pendant la modification (les anciennes restent sur le serveur).
      const photosMaj: PhotoLocale[] = JSON.parse(op.photos || '[]');
      const echoueesMaj: PhotoLocale[] = [];
      for (const p of photosMaj) {
        try {
          await signalementApi.ajouterPhoto(formDataPhoto(p, 'signalement', id, `signalement_${Date.now()}.png`));
        } catch {
          echoueesMaj.push(p);
        }
      }
      const refileesMaj = await refilerPhotosEchouees('signalement', id, request, echoueesMaj).catch(() => 0);
      return refileesMaj;
    }
    throw new Error(`Action inconnue : ${op.action}`);
  }
  if (op.entiteType === 'descente_terrain') {
    const request = JSON.parse(op.payload) as DescenteTerrainRequest;
    if (op.action === 'CREATE') {
      const cree = await descenteTerrainApi.creer(request);
      // Photos du constat — un échec est re-filé (jamais perdu).
      const photos: PhotoLocale[] = JSON.parse(op.photos || '[]');
      const echouees: PhotoLocale[] = [];
      for (const p of photos) {
        try {
          await descenteTerrainApi.ajouterPhoto(formDataPhoto(p, 'descente_terrain', cree.idDescente, `descente_${Date.now()}.png`));
        } catch {
          echouees.push(p);
        }
      }
      const refileesDt = await refilerPhotosEchouees('descente_terrain', cree.idDescente, request, echouees).catch(() => 0);
      return refileesDt;
    }
    if (op.action === 'UPDATE') {
      const avecId = request as DescenteTerrainRequest & { idDescente?: string };
      const id = avecId.idDescente;
      if (!id) throw new Error('idDescente manquant pour la mise à jour');
      await descenteTerrainApi.mettreAJour(id, request);
      // Photos ajoutées pendant la modification — un échec est re-filé.
      const photosMaj: PhotoLocale[] = JSON.parse(op.photos || '[]');
      const echoueesMaj: PhotoLocale[] = [];
      for (const p of photosMaj) {
        try {
          await descenteTerrainApi.ajouterPhoto(formDataPhoto(p, 'descente_terrain', id, `descente_${Date.now()}.png`));
        } catch {
          echoueesMaj.push(p);
        }
      }
      const refileesDtMaj = await refilerPhotosEchouees('descente_terrain', id, request, echoueesMaj).catch(() => 0);
      return refileesDtMaj;
    }
    throw new Error(`Action inconnue : ${op.action}`);
  }
  // Le mobile ne crée que des signalements et des descentes : l'assignation avec les
  // notifications/avertissements se fait côté web.
  throw new Error(`Entité non synchronisable : ${op.entiteType}`);
}

/** Rejoue toutes les opérations en attente vers le backend. */
export async function pousserFileLocale(): Promise<ResultatSync> {
  const ops = await db.listerOperationsPending();
  const resultat: ResultatSync = { total: ops.length, reussis: 0, echecs: 0 };
  for (const op of ops) {
    try {
      const refilees = await pousserOperation(op);
      await db.supprimerOperationPending(op.idLocal);
      resultat.reussis += 1;
      resultat.photosRefilees = (resultat.photosRefilees ?? 0) + refilees;
    } catch {
      resultat.echecs += 1;
    }
  }
  return resultat;
}

// ── Le bouton « Synchroniser » ─────────────────────────────────

/**
 * Synchronisation complète : PUSH de la file locale vers Spring Boot.
 * (Aucun pull — le mobile ne reçoit pas les données du serveur.)
 */
export async function synchroniserTout(): Promise<ResultatSync> {
  const date = new Date().toISOString();
  const resultat = await pousserFileLocale();
  await db.setMeta('derniere_synchro', date).catch(() => undefined);
  await db.setMeta('sync_dernier_resultat', JSON.stringify(resultat)).catch(() => undefined);
  return resultat;
}

/** Alias : poussée seule de la file (appels existants). */
export async function synchroniserSignalements(): Promise<ResultatSync> {
  return pousserFileLocale();
}

export { dataUrlToBlob };