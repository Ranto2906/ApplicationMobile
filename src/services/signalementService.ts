import api from './api';
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
    // Multipart explicite : l'instance axios par défaut est en JSON et
    // sérialiserait le FormData en JSON (fichier perdu → 415 du backend).
    api.post<PhotoSignalementDTO>('/photos', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Les photos d'appareil (1–4 Mo) dépassent souvent le timeout global
      // de 8 s sur une connexion terrain → upload annulé avant la fin.
      timeout: 120000,
    }).then((r) => r.data),
  /** Récupère le contenu binaire AVEC le JWT (les <img> n'envoient pas l'en-tête). */
  contenuPhoto: async (idPhoto: number) => {
    const r = await api.get(`/photos/${idPhoto}/contenu`, { responseType: 'blob' });
    const blob = r.data as Blob;
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  },
};

export default signalementApi;
