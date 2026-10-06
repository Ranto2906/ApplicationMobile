import api, { envoyerPhotoApi } from './api';
import { contenuPhotoDataUrl } from './photoContenu';
import type {
  SignalementDTO, SignalementRequest, TypeSignalement, StatutSignalement,
  PhotoSignalementDTO, AuditSignalement, VilleSimple, Page, ProprieteSimple,
} from '../types/signalement';

export interface StatistiquesSignalement {
  total?: number;
  parStatut?: Record<string, number>;
  parType?: Record<string, number>;
  [k: string]: unknown;
}

export const signalementApi = {
  // ── Référentiels ──
  types: () => api.get<TypeSignalement[]>('/signalements/types').then((r) => r.data),
  statuts: () => api.get<StatutSignalement[]>('/signalements/statuts').then((r) => r.data),
  villes: () => api.get<VilleSimple[]>('/villes/all').then((r) => r.data),

  // ── Propriétés (référentiel du formulaire de signalement) ──
  /** Toutes les propriétés (le volume est raisonnable : ~200 lignes). */
  proprietes: () => api.get<ProprieteSimple[]>('/proprietes/search?search=').then((r) => r.data),
  /** Détail complet d'une propriété (fiche rattachée au signalement). */
  proprieteParId: (idPropriete: number) =>
    api.get<ProprieteSimple>(`/proprietes/${idPropriete}`).then((r) => r.data),
  /** Recherche filtrée (nom, numéro, zone, lieu, ville). */
  rechercherProprietes: (search: string) =>
    api.get<ProprieteSimple[]>('/proprietes/search', { params: { search } }).then((r) => r.data),
  /** Géométrie du signalement (GeoJSON texte, tableau — [] si non positionné). */
  geometrieSignalement: (id: string) =>
    api.get<Array<{ geojson?: string; typeGeometrie?: string; precisionM?: number; source?: string }>>(
      `/signalements/${id}/geometrie`).then((r) => r.data),
  /** Géométrie PostGIS d'une propriété (GeoJSON texte, tableau — [] si non localisée). */
  geometriePropriete: (idPropriete: number) =>
    api.get<Array<{ geojson?: string; typegeometrie?: string; source?: string }>>(
      `/proprietes/${idPropriete}/geometrie`).then((r) => r.data),

  // ── Liste / détail ──
  lister: (page = 0, size = 20) =>
    api.get<Page<SignalementDTO>>('/signalements', { params: { page, size } }).then((r) => r.data),
  rechercher: (q?: string, page = 0, size = 20) =>
    api.get<Page<SignalementDTO>>('/signalements/search', { params: { q, page, size } }).then((r) => r.data),
  trouver: (id: string) => api.get<SignalementDTO>(`/signalements/${id}`).then((r) => r.data),
  statistiques: () => api.get<StatistiquesSignalement>('/signalements/stats').then((r) => r.data),

  // ── CRUD ──
  creer: (r: SignalementRequest) => api.post<SignalementDTO>('/signalements', r).then((resp) => resp.data),
  mettreAJour: (id: string, r: SignalementRequest) =>
    api.put<SignalementDTO>(`/signalements/${id}`, r).then((resp) => resp.data),
  traiter: (id: string, r: { idStatutSignalement: number; commentaireTraitement?: string }) =>
    api.post<SignalementDTO>(`/signalements/${id}/traitement`, r).then((resp) => resp.data),
  supprimer: (id: string) => api.delete(`/signalements/${id}`),

  // ── Historique ──
  historique: (id: string) => api.get<AuditSignalement[]>(`/signalements/${id}/historique`).then((r) => r.data),

  // ── Photos (rattachées à un signalement synchronisé) ──
  photos: (entiteId: string) =>
    api.get<PhotoSignalementDTO[]>('/photos', { params: { entiteType: 'signalement', entiteId } }).then((r) => r.data),
  ajouterPhoto: (form: FormData) =>
    // fetch (et non axios) : le pont natif CapacitorHttp ne transmet pas le
    // corps multipart via le patch XMLHttpRequest (voir envoyerPhotoApi dans
    // api.ts). Timeout 120 s : les photos d'appareil (1–4 Mo) dépassent le
    // timeout global de 8 s sur une connexion terrain.
    envoyerPhotoApi<PhotoSignalementDTO>('/photos', form, 120_000),
  /** Récupère le contenu binaire AVEC le JWT (les <img> n'envoient pas l'en-tête).
   *  Gère la réponse base64 du pont natif CapacitorHttp (voir photoContenu.ts). */
  contenuPhoto: (idPhoto: number) => contenuPhotoDataUrl(api, idPhoto),
};

export default signalementApi;
