// ── Auth ──
export interface LoginRequest {
  nomUtilisateur: string;
  motDePasse: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  utilisateur: UtilisateurDTO;
}

export interface UtilisateurDTO {
  idUtilisateur: number;
  nomUtilisateur: string;
  nomComplet?: string;
  email?: string;
  actif: boolean;
  statutCompte: string;
  tentativesEchouees?: number;
  dateCreation?: string;
  derniereConnexion?: string;
  roles: RoleDTO[];
}

export interface CreateUtilisateurRequest {
  nomUtilisateur: string;
  nomComplet?: string;
  email?: string;
  motDePasse: string;
  actif?: boolean;
}

export interface UpdateUtilisateurRequest {
  nomUtilisateur?: string;
  nomComplet?: string;
  email?: string;
  motDePasse?: string;
  actif?: boolean;
  statutCompte?: string;
}

export interface TokenRefreshRequest {
  refreshToken: string;
}

// ── Roles & Permissions ──
export interface RoleDTO {
  idRole: number;
  nomRole: string;
  description?: string;
}

export interface CreateRoleRequest {
  nomRole: string;
  description?: string;
}

export interface PermissionDTO {
  idPermission: number;
  codeModule: string;
  libelleModule: string;
  codeEntite: string;
  libelleEntite: string;
  codeAction: string;
}

export interface RoleWithPermissionsDTO {
  idRole: number;
  nomRole: string;
  description?: string;
  permissions: PermissionDTO[];
}

// ── RBAC Referentiels ──
export interface ModuleRBAC {
  idModule: number;
  codeModule: string;
  libelle: string;
}

export interface EntiteRBAC {
  idEntite: number;
  codeEntite: string;
  libelle: string;
  codeModule: string;
}

export interface ActionRBAC {
  idAction: number;
  codeAction: string;
}

// ── Journal ──
export interface JournalConnexionDTO {
  idJournal: number;
  dateConnexion?: string;
  ipAdresse?: string;
  succes: boolean;
  idUtilisateur?: number;
  nomUtilisateur?: string;
}

// ── Sessions ──
export interface SessionDTO {
  idSession: number;
  userAgent?: string;
  ipAdresse?: string;
  dateCreation?: string;
  dateExpiration?: string;
  revoque: boolean;
  idUtilisateur?: number;
  nomUtilisateur?: string;
}

// ── Audit ──
export interface AuditDTO {
  idAudit: number;
  entiteType: string;
  entiteId: string;
  action?: string;
  anciennesValeurs?: string;
  nouvellesValeurs?: string;
  dateAction?: string;
  ipAdresse?: string;
  idUtilisateur?: number;
  nomUtilisateur?: string;
}

// ── Pagination ──
export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}
