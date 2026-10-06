import api, { envoyerPhotoApi } from './api';
import { contenuPhotoDataUrl } from './photoContenu';
import type {
  DescenteTerrainDTO, DescenteTerrainRequest, DossierSearchResult, Page,
} from '../types/descenteTerrain';

export interface StatistiquesDescente {
  total?: number;
  parStatut?: Record<string, number>;
  parValidation?: Record<string, number>;
  [k: string]: unknown;
}

export const descenteTerrainApi = {
  // ── Liste / détail ──
  lister: (page = 0, size = 20) =>
    api.get<Page<DescenteTerrainDTO>>('/descentes-terrain', { params: { page, size } }).then((r) => r.data),
  rechercher: (q?: string, page = 0, size = 20) =>
    api.get<Page<DescenteTerrainDTO>>('/descentes-terrain/search', { params: { q, page, size } }).then((r) => r.data),
  trouver: (id: string) => api.get<DescenteTerrainDTO>(`/descentes-terrain/${id}`).then((r) => r.data),
  statistiques: () => api.get<StatistiquesDescente>('/descentes-terrain/stats').then((r) => r.data),

  // ── CRUD ──
  creer: (r: DescenteTerrainRequest) =>
    api.post<DescenteTerrainDTO>('/descentes-terrain', r).then((resp) => resp.data),
  mettreAJour: (id: string, r: DescenteTerrainRequest) =>
    api.put<DescenteTerrainDTO>(`/descentes-terrain/${id}`, r).then((resp) => resp.data),
  supprimer: (id: string) => api.delete(`/descentes-terrain/${id}`),

  // ── Recherche de dossiers (autocomplete en ligne) ──
  // NB : la route backend est /descentes-terrain/dossiers/search (et non /dossiers/search).
  rechercherDossiers: (q: string) =>
    api.get<DossierSearchResult[]>('/descentes-terrain/dossiers/search', { params: { q } }).then((r) => r.data),

  // ── Photos ──
  photos: (entiteId: string) =>
    api.get('/photos', { params: { entiteType: 'descente_terrain', entiteId } }).then((r) => r.data),
  ajouterPhoto: (form: FormData) =>
    // fetch (et non axios) : le pont natif CapacitorHttp ne transmet pas le
    // corps multipart via le patch XMLHttpRequest (voir envoyerPhotoApi dans
    // api.ts). Timeout 120 s : les photos d'appareil (1–4 Mo) dépassent le
    // timeout global de 8 s sur une connexion terrain.
    envoyerPhotoApi<unknown>('/photos', form, 120_000),
  contenuPhoto: async (idPhoto: number) => {
    return await contenuPhotoDataUrl(api, idPhoto);
  },
};

export default descenteTerrainApi;
