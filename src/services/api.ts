import axios from 'axios';
import { config } from '../config';
import type {
  LoginRequest, LoginResponse, TokenRefreshRequest,
  UtilisateurDTO, CreateUtilisateurRequest, UpdateUtilisateurRequest,
  RoleDTO, CreateRoleRequest, RoleWithPermissionsDTO, PermissionDTO,
  JournalConnexionDTO, SessionDTO, AuditDTO, PageResponse,
  ModuleRBAC, EntiteRBAC, ActionRBAC,
} from '../types';

const api = axios.create({
  baseURL: config.getApiBase(),
  headers: { 'Content-Type': 'application/json' },
});

function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}
function getRefreshToken(): string | null {
  return localStorage.getItem('refreshToken');
}
function setTokens(access: string, refresh: string) {
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
}
function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (r?: unknown) => void }> = [];

function processQueue(error: unknown) {
  failedQueue.forEach((p) => { error ? p.reject(error) : p.resolve(undefined); });
  failedQueue = [];
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const orig = error.config;
    if (error.response?.status === 401 && !orig._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => { failedQueue.push({ resolve, reject }); }).then(() => api(orig));
      }
      orig._retry = true;
      isRefreshing = true;
      const rt = getRefreshToken();
      if (!rt) { clearTokens(); window.location.href = '/login'; return Promise.reject(error); }
      try {
        const { data } = await axios.post<LoginResponse>(`${config.getApiBase()}/auth/refresh`, { refreshToken: rt } as TokenRefreshRequest);
        setTokens(data.accessToken, data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.utilisateur));
        processQueue(null);
        return api(orig);
      } catch (e) { clearTokens(); window.location.href = '/login'; processQueue(e); return Promise.reject(e); }
      finally { isRefreshing = false; }
    }
    return Promise.reject(error);
  }
);

// ── Auth API ──
export const authApi = {
  login: (r: LoginRequest) => api.post<LoginResponse>('/auth/login', r).then((r) => r.data),
  logout: (rt: string | null) => api.post('/auth/logout', rt ? { refreshToken: rt } : null),
  refreshToken: (rt: string) => api.post<LoginResponse>('/auth/refresh', { refreshToken: rt }).then((r) => r.data),
  getMe: () => api.get<UtilisateurDTO>('/auth/me').then((r) => r.data),
  changePassword: (request: { ancienMotDePasse: string; nouveauMotDePasse: string }) =>
    api.put('/auth/change-password', request),
};

// ── Utilisateurs API ──
export const utilisateurApi = {
  lister: (search?: string, page = 0, size = 20) =>
    api.get<PageResponse<UtilisateurDTO>>('/utilisateurs', { params: { search, page, size } }).then((r) => r.data),
  trouverParId: (id: number) => api.get<UtilisateurDTO>(`/utilisateurs/${id}`).then((r) => r.data),
  creer: (r: CreateUtilisateurRequest) => api.post<UtilisateurDTO>('/utilisateurs', r).then((r) => r.data),
  mettreAJour: (id: number, r: UpdateUtilisateurRequest) => api.put<UtilisateurDTO>(`/utilisateurs/${id}`, r).then((r) => r.data),
  activerDesactiver: (id: number, actif: boolean) => api.patch<UtilisateurDTO>(`/utilisateurs/${id}/activer`, { actif }).then((r) => r.data),
  reinitialiserMotDePasse: (id: number, motDePasse: string) => api.post(`/utilisateurs/${id}/reinitialiser-mot-de-passe`, { motDePasse }),
  supprimer: (id: number) => api.delete(`/utilisateurs/${id}`),
  listerRoles: (id: number) => api.get<RoleDTO[]>(`/utilisateurs/${id}/roles`).then((r) => r.data),
  attribuerRole: (id: number, idRole: number) => api.post(`/utilisateurs/${id}/roles`, { idRole }),
  retirerRole: (id: number, roleId: number) => api.delete(`/utilisateurs/${id}/roles/${roleId}`),
};

// ── Rôles API ──
export const roleApi = {
  lister: () => api.get<RoleDTO[]>('/roles').then((r) => r.data),
  trouverParId: (id: number) => api.get<RoleDTO>(`/roles/${id}`).then((r) => r.data),
  creer: (r: CreateRoleRequest) => api.post<RoleDTO>('/roles', r).then((r) => r.data),
  mettreAJour: (id: number, r: CreateRoleRequest) => api.put<RoleDTO>(`/roles/${id}`, r).then((r) => r.data),
  supprimer: (id: number) => api.delete(`/roles/${id}`),
  listerPermissions: () => api.get<PermissionDTO[]>('/roles/permissions').then((r) => r.data),
  trouverAvecPermissions: (id: number) => api.get<RoleWithPermissionsDTO>(`/roles/${id}/permissions`).then((r) => r.data),
  attribuerPermission: (idRole: number, idPermission: number) => api.post(`/roles/${idRole}/permissions`, { idPermission }),
  retirerPermission: (idRole: number, idPermission: number) => api.delete(`/roles/${idRole}/permissions/${idPermission}`),
  listerModules: () => api.get<ModuleRBAC[]>('/roles/modules').then((r) => r.data),
  listerEntites: () => api.get<EntiteRBAC[]>('/roles/entites').then((r) => r.data),
  listerActions: () => api.get<ActionRBAC[]>('/roles/actions').then((r) => r.data),
};

// ── Admin API ──
export const adminApi = {
  journal: (page = 0, size = 20) =>
    api.get<PageResponse<JournalConnexionDTO>>('/admin/journal', { params: { page, size } }).then((r) => r.data),
  journalUtilisateur: (id: number) =>
    api.get<JournalConnexionDTO[]>(`/admin/journal/${id}`).then((r) => r.data),
  listerSessions: (page = 0, size = 20) =>
    api.get<PageResponse<SessionDTO>>('/admin/sessions', { params: { page, size } }).then((r) => r.data),
  sessionsUtilisateur: (id: number) =>
    api.get<SessionDTO[]>(`/admin/sessions/${id}`).then((r) => r.data),
  revoquerSessions: (id: number) => api.post(`/admin/sessions/${id}/revoquer`),
  nettoyerSessionsExpirees: () => api.delete('/admin/sessions/expirees'),
  audit: (page = 0, size = 20) =>
    api.get<PageResponse<AuditDTO>>('/admin/audit', { params: { page, size } }).then((r) => r.data),
  auditRechercher: (entiteType?: string, action?: string, search?: string, page = 0, size = 20) =>
    api.get<PageResponse<AuditDTO>>('/admin/audit', { params: { entiteType, action, search, page, size } }).then((r) => r.data),
};

export { api, setTokens, clearTokens, getAccessToken, getRefreshToken };
export default api;
