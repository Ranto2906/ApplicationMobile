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
  timeout: 8000,
  headers: { 'Content-Type': 'application/json' },
});

function depuisDébut(): string {
  return `${(performance.now() - (window as any).__SEIMAD_DÉMARAGE__ || 0).toFixed(0)}ms`;
}
function log(...args: any[]) {
  console.log(`[SEIMAD:api:${depuisDébut()}]`, ...args);
}
function logErr(err: unknown, label = 'erreur') {
  if (err && typeof err === 'object' && 'stack' in err && typeof (err as any).message === 'string') {
    console.error(`[SEIMAD:api:${depuisDébut()}]`, label, (err as any).message, (err as any).stack);
  } else {
    console.error(`[SEIMAD:api:${depuisDébut()}]`, label, err);
  }
}

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
  log('request →', config.method?.toUpperCase(), config.url, '| Authorization:', token ? 'présent' : 'absent');
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: unknown) => void; reject: (r?: unknown) => void }> = [];

function processQueue(error: unknown) {
  failedQueue.forEach((p) => { error ? p.reject(error) : p.resolve(undefined); });
  failedQueue = [];
}

/**
 * ⚠️ Le `timeout: 8000` d'axios n'est pas honoré quand CapacitorHttp est actif
 * (capacitor.config.ts) : le XHR patché du pont natif (native-bridge.js) ne lit
 * jamais cette propriété. Un serveur injoignable alors que le réseau est actif
 * (backend éteint, mauvaise IP) faisait donc HANGUER les appels bien au-delà de
 * 8 s — spinner figé, aucune bascule vers le mode local.
 * Ce délai applicatif rejette l'appel après `delaiMs` quand la réponse ne vient
 * pas. Il ne touche que les ERREURS réseau : une réponse HTTP (même lente) n'est
 * jamais interrompue — l'upload de photos (timeout: 120000) reste garanti.
 */
const DÉLAI_RÉSEAU_MS = 10_000;
function avecDélai<T>(p: Promise<T>, delaiMs: number, url?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiration = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error(`Délai dépassé (${Math.round(delaiMs / 1000)} s) : serveur injoignable${url ? ` (${url})` : ''}`),
      { code: 'ECONNABORTED' }
    )), delaiMs);
  });
  return Promise.race([p, expiration]).finally(() => { if (timer) clearTimeout(timer); });
}

// ── Upload multipart via fetch (pont natif CapacitorHttp) ───────────────
// POURQUOI fetch ET PAS axios POUR LES PHOTOS :
//  - Le patch XMLHttpRequest du pont natif n'initialise JAMAIS le Content-Type
//    quand axios le supprime pour laisser la plateforme le régénérer
//    (resolveConfig : headers.setContentType(undefined) si FormData) : côté Java
//    (CapacitorHttpUrlConnection.setRequestBody), contentType == null → le corps
//    de la requête n'est PAS écrit → le POST /photos arrive sans aucune part →
//    400 « fichier manquant » côté Spring.
//  - Avec un Content-Type multipart explicite SANS boundary, le patch XHR le
//    transmet tel quel et le code natif plante (contentType.split(";")[1] hors
//    bornes) — le patch fetch, lui, supprime ce header avant l'envoi.
//  - Le patch fetch reconstruit un Request standard : le Content-Type multipart
//    AVEC boundary est régénéré, et convertFormData transmet les fichiers
//    (instanceof File — d'où blobVersFichier) en base64 vers le natif, qui
//    réécrit un multipart conforme côté Java.
export async function envoyerPhotoApi<T = unknown>(
  chemin: string,
  form: FormData,
  timeoutMs = 120_000,
): Promise<T> {
  const url = `${config.getApiBase()}${chemin}`;
  const controleur = new AbortController();
  const timer = setTimeout(() => controleur.abort(), timeoutMs);
  const faire = async (): Promise<Response> => {
    // Reconstruit à chaque tentative : le token peut avoir été rafraîchi.
    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    // NB : AUCUN Content-Type ici — le navigateur/WebView génère
    // « multipart/form-data; boundary=… », requis par le pont natif.
    return fetch(url, { method: 'POST', headers, body: form, signal: controleur.signal });
  };
  try {
    let res = await faire();
    // Comportement préservé de l'intercepteur axios : un access token expiré
    // pendant la saisie (photo longue à préparer) ne doit pas tuer l'upload —
    // on rafraîchit UNE fois puis on retente.
    if (res.status === 401 && (await tenterRefresh())) {
      res = await faire();
    }
    const texte = await res.text();
    let data: unknown = undefined;
    try { data = texte ? JSON.parse(texte) : undefined; } catch { data = texte; }
    if (!res.ok) {
      const corps = data as { message?: string; erreur?: string } | undefined;
      const message = corps?.message || corps?.erreur || `Erreur ${res.status}`;
      throw Object.assign(new Error(String(message)), {
        response: { status: res.status, data },
      });
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Rafraîchit les tokens (une tentative). Retourne true si succès. */
async function tenterRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const { data } = await avecDélai(
      axios.post<LoginResponse>(`${config.getApiBase()}/auth/refresh`, { refreshToken: rt } as TokenRefreshRequest),
      DÉLAI_RÉSEAU_MS,
      '/auth/refresh',
    );
    setTokens(data.accessToken, data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.utilisateur));
    return true;
  } catch {
    return false;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const orig = error.config;
    const statut = (error as any)?.response?.status;
    const estReseau = !(error as { response?: unknown })?.response;
    // Un 401 sur /auth/login (mauvais mot de passe) ou /auth/refresh (refresh
    // invalide) ne doit PAS déclencher un nouveau refresh : on rejette tel quel.
    const urlAuth = orig?.url ?? '';
    const estAppelAuth = /\/auth\/(login|refresh|logout)/.test(urlAuth);
    if (error.response?.status === 401 && !orig._retry && !estAppelAuth) {
      log('response → 401 sur', orig.url, '(retry:', orig._retry, ')');
      if (isRefreshing) {
        log('response → refresh déjà en cours → mise en file');
        return new Promise((resolve, reject) => { failedQueue.push({ resolve, reject }); }).then(() => api(orig));
      }
      orig._retry = true;
      isRefreshing = true;
      log('response → refresh en cours…');
      const rt = getRefreshToken();
      if (!rt) {
        log('response → pas de refreshToken → déconnexion + redirect /login');
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }
      try {
        const début = performance.now();
        const { data } = await avecDélai(
          axios.post<LoginResponse>(`${config.getApiBase()}/auth/refresh`, { refreshToken: rt } as TokenRefreshRequest),
          DÉLAI_RÉSEAU_MS,
          '/auth/refresh',
        );
        log('response → refresh OK en', `${(performance.now() - début).toFixed(0)}ms`);
        setTokens(data.accessToken, data.refreshToken);
        localStorage.setItem('user', JSON.stringify(data.utilisateur));
        processQueue(null);
        return api(orig);
      } catch (e) {
        if (estReseau) {
          log('response → refresh injoignable (réseau hors-ligne) → on garde la session');
          processQueue(e);
          return Promise.reject(e);
        }
        logErr(e, 'response → refresh échoué → déconnexion');
        clearTokens();
        window.location.href = '/login';
        processQueue(e);
        return Promise.reject(e);
      }
      finally { isRefreshing = false; }
    }
    if (estReseau) {
      log('response → erreur réseau (pas de réponse HTTP) sur', orig?.url, '| statut:', statut);
      // Ne rejette qu'après le délai applicatif : en natif, un serveur qui ne
      // répond pas (SYN perdu, backend mort) ne produit parfois AUCUNE erreur
      // axios avant longtemps — on rend la main à l'UI.
      return avecDélai(Promise.reject(error), orig?.timeout ?? DÉLAI_RÉSEAU_MS, orig?.url);
    } else {
      log('response → erreur HTTP', statut, 'sur', orig?.url);
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
