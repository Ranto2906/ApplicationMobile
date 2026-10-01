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

  /** Propriété concernée (rattachement) — nécessaire pour pré-remplir l'édition. */
  idPropriete?: number;
  numeroPropriete?: string;

  commentaireTraitement?: string;
  dateTraitement?: string;
  idUtilisateurTraitement?: number;
  nomUtilisateurTraitement?: string;

  idDossier?: number;
  numeroDossier?: string;

  /** Assignations signalement <-> notification / avertissement (depuis le backend). */
  assignations?: AssignationDTO[];

  idUtilisateurCreation?: number;
  nomUtilisateurCreation?: string;
}

export interface AssignationDTO {
  idAssignation?: number;
  idSignalement?: string;
  referenceSignalement?: string;
  typeCible?: 'notification' | 'avertissement';
  idNotification?: string;
  dateNotification?: string;
  numeroTitreNotification?: string;
  idAvertissement?: string;
  dateAvertissement?: string;
  numeroTitreAvertissement?: string;
  dateAssignation?: string;
  idUtilisateur?: number;
  nomUtilisateur?: string;
}

/**
 * Géométrie du constat (ex. point GPS) — envoyée en GeoJSON texte.
 * Stockée côté serveur dans la table `geometrie` (entite_type='signalement').
 * Ex. geojson : {"type":"Point","coordinates":[47.507,-18.879]} (ordre GeoJSON lng,lat).
 */
export interface GeometrieRequest {
  /** 'Point' ou 'Polygon'. */
  typeGeometrie?: string;
  geojson?: string;
  precisionM?: number;
  source?: string;
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
  /** Propriété concernée par le signalement (mode en ligne : ID exact). */
  idPropriete?: number;
  /** Géométrie GPS du constat (optionnelle) — GeoJSON texte. */
  geometrie?: GeometrieRequest;
  /** NB : le rattachement notification/avertissement passe par l'assignation (endpoint dédié). */
}

/** Propriété (référentiel) — miroir de ProprieteDTO, avec sa géométrie si localisée. */
export interface ProprieteSimple {
  idPropriete: number;
  nom?: string;
  numero?: string;
  zone?: string;
  localisation?: string;
  superficieTotale?: number;
  libelleLieu?: string;
  idVille?: number;
  nomVille?: string;
  /** Géométrie embarquée (GeoJSON texte) — présente uniquement dans le cache hors-ligne. */
  geojson?: string;
  typeGeometrie?: string;
  sourceGeometrie?: string;
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
