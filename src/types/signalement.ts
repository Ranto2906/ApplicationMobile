// ── Signalements (mobile terrain) — miroir des DTO Spring Boot ──
export interface TypeSignalement {
  idTypeSignalement: number;
  code?: string;
  libelle: string;
  couleur?: string;
}

export interface StatutSignalement {
  idStatutSignalement: number;
  code?: string;
  libelle: string;
  couleurHex?: string;
  estFinal?: boolean;
  ordre?: number;
}

export interface SignalementDTO {
  idSignalement: string;
  reference?: string;
  description?: string;
  dateSignalement?: string;
  dateModification?: string;

  idTypeSignalement?: number;
  codeType?: string;
  libelleType?: string;
  couleurType?: string;

  idStatutSignalement?: number;
  codeStatut?: string;
  libelleStatut?: string;
  couleurStatutHex?: string;
  statutFinal?: boolean;

  idVille?: number;
  nomVille?: string;
  idTitreFoncier?: string;
  numeroTitre?: string;
  idParcelle?: string;
  numeroLot?: string;

  commentaireTraitement?: string;
  dateTraitement?: string;
  idUtilisateurTraitement?: number;
  nomUtilisateurTraitement?: string;

  idDossier?: number;
  numeroDossier?: string;
  idNotification?: string;
  idAvertissement?: string;

  idUtilisateurCreation?: number;
  nomUtilisateurCreation?: string;
}

export interface SignalementRequest {
  reference?: string;
  description?: string;
  dateSignalement?: string;
  idTypeSignalement: number;
  idStatutSignalement?: number;
  idVille?: number;
  idTitreFoncier?: string;
  idParcelle?: string;
  idDossier?: number;
  idNotification?: string;
  idAvertissement?: string;
}

export interface VilleSimple {
  idVille?: number;
  nomVille?: string;
}

export interface PhotoSignalementDTO {
  idPhoto?: number;
  entiteType?: string;
  entiteId?: string;
  typePhoto?: string;
  datePrise?: string;
  observation?: string;
  urlContenu?: string;
  nomFichier?: string;
  dateCreation?: string;
}

export interface AuditSignalement {
  idAudit?: number;
  entiteType?: string;
  entiteId?: string;
  action?: string;
  anciennesValeurs?: string;
  nouvellesValeurs?: string;
  dateAction?: string;
  ipAdresse?: string;
  idUtilisateur?: number;
  nomUtilisateur?: string;
}

export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first?: boolean;
  last?: boolean;
  empty?: boolean;
}
