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
}

interface PhotoLocale {
  dataUrl: string;
  typePhoto?: string;
  datePrise?: string;
  observation?: string;
}

/** Rejoue une opération de la file vers le backend. */
async function pousserOperation(op: {
  idLocal: string; entiteType: string; action: string; payload: string;
  photos: string; position: string;
}): Promise<void> {
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

      // Photos du constat.
      const photos: PhotoLocale[] = JSON.parse(op.photos || '[]');
      for (const p of photos) {
        try {
          const form = new FormData();
          form.append('fichier', dataUrlToBlob(p.dataUrl), `signalement_${Date.now()}.png`);
          form.append('entiteType', 'signalement');
          form.append('entiteId', cree.idSignalement);
          if (p.typePhoto) form.append('typePhoto', p.typePhoto);
          if (p.datePrise) form.append('datePrise', p.datePrise);
          if (p.observation) form.append('observation', p.observation);
          await signalementApi.ajouterPhoto(form);
        } catch {
          // Une photo en échec ne bloque pas la synchronisation du signalement.
        }
      }
      return;
    }
    if (op.action === 'UPDATE') {
      const avecId = request as SignalementRequest & { idSignalement?: string };
      const id = avecId.idSignalement;
      if (!id) throw new Error('idSignalement manquant pour la mise à jour');
      await signalementApi.mettreAJour(id, request);
      return;
    }
    throw new Error(`Action inconnue : ${op.action}`);
  }
  if (op.entiteType === 'descente_terrain') {
    const request = JSON.parse(op.payload) as DescenteTerrainRequest;
    if (op.action === 'CREATE') {
      const cree = await descenteTerrainApi.creer(request);
      // Photos du constat.
      const photos: PhotoLocale[] = JSON.parse(op.photos || '[]');
      for (const p of photos) {
        try {
          const form = new FormData();
          form.append('fichier', dataUrlToBlob(p.dataUrl), `descente_${Date.now()}.png`);
          form.append('entiteType', 'descente_terrain');
          form.append('entiteId', cree.idDescente);
          if (p.typePhoto) form.append('typePhoto', p.typePhoto);
          if (p.datePrise) form.append('datePrise', p.datePrise);
          if (p.observation) form.append('observation', p.observation);
          await descenteTerrainApi.ajouterPhoto(form);
        } catch {
          // Une photo en échec ne bloque pas la synchronisation.
        }
      }
      return;
    }
    if (op.action === 'UPDATE') {
      const avecId = request as DescenteTerrainRequest & { idDescente?: string };
      const id = avecId.idDescente;
      if (!id) throw new Error('idDescente manquant pour la mise à jour');
      await descenteTerrainApi.mettreAJour(id, request);
      return;
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
      await pousserOperation(op);
      await db.supprimerOperationPending(op.idLocal);
      resultat.reussis += 1;
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