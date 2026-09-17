import api from './api';
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
    api.get<Page<DescenteTerrainDTO>>('/descente-terrain', { params: { page, size } }).then((r) => r.data),
  rechercher: (q?: string, page = 0, size = 20) =>
    api.get<Page<DescenteTerrainDTO>>('/descente-terrain/search', { params: { q, page, size } }).then((r) => r.data),
  trouver: (id: string) => api.get<DescenteTerrainDTO>(`/descente-terrain/${id}`).then((r) => r.data),
  statistiques: () => api.get<StatistiquesDescente>('/descente-terrain/stats').then((r) => r.data),

  // ── CRUD ──
  creer: (r: DescenteTerrainRequest) =>
    api.post<DescenteTerrainDTO>('/descente-terrain', r).then((resp) => resp.data),
  mettreAJour: (id: string, r: DescenteTerrainRequest) =>
    api.put<DescenteTerrainDTO>(`/descente-terrain/${id}`, r).then((resp) => resp.data),
  supprimer: (id: string) => api.delete(`/descente-terrain/${id}`),

  // ── Recherche de dossiers (autocomplete en ligne) ──
  // NB : la route backend est /descente-terrain/dossiers/search (et non /dossiers/search).
  rechercherDossiers: (q: string) =>
    api.get<DossierSearchResult[]>('/descente-terrain/dossiers/search', { params: { q } }).then((r) => r.data),

  // ── Photos ──
  photos: (entiteId: string) =>
    api.get('/photos', { params: { entiteType: 'descente_terrain', entiteId } }).then((r) => r.data),
  ajouterPhoto: (form: FormData) =>
    api.post('/photos', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),
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

export default descenteTerrainApi;
