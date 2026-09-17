// ── Descente Terrain (mobile terrain) — miroir du DTO Spring Boot ──
import type { Page } from './signalement';

export type StatutConstat =
  | 'Conforme'
  | 'Non conforme'
  | 'En attente'
  | 'Occupation illicite'
  | 'Construction illegale';

export type StatutValidation =
  | 'En attente'
  | 'Valide'
  | 'Rejete'
  | 'Complement demande';

export type ModeDescente = 'online' | 'offline';

export interface DescenteTerrainDTO {
  idDescente: string;
  reference?: string;
  dateDescente?: string;
  statutConstat: StatutConstat;
  observation?: string;
  mode: ModeDescente;
  validation: StatutValidation;
  dateValidation?: string;
  idUtilisateurCreation?: string;
  idUtilisateurValidation?: string;
  nomUtilisateurCreation?: string;
  nomUtilisateurValidation?: string;
  synchronise: number;
  dateCreation?: string;
  dateModification?: string;

  /** Rattachement serveur (dossier lié en mode online). */
  idPersonne?: number;
  nomPersonne?: string;
  contactPersonne?: string;
  idDossierParcelle?: string;
  idDossier?: number;
  numeroDossier?: string;
  idPropriete?: number;
  numeroPropriete?: string;
  idParcelle?: string;
  numeroLot?: string;
  superficieM2?: number;
  idVille?: number;
  nomVille?: string;

  /** Snapshots dénormalisés pour le mode hors-ligne (persistés côté backend). */
  demandeurNom?: string;
  demandeurContact?: string;
  dossierNumero?: string;
  dossierSuperficie?: number;
  dossierPropriete?: string;
  /** JSON texte : [{ numeroLot, superficieM2 }, …] — une ou plusieurs parcelles. */
  dossierParcelles?: string;
  dossierVille?: string;
}

export interface ParcelleSnapshot {
  idParcelle?: string;
  numeroLot?: string;
  superficieM2?: number;
}

export interface DescenteTerrainRequest {
  dateDescente: string;
  statutConstat: StatutConstat;
  observation?: string;
  mode: ModeDescente;
  dossierNumero?: string;
  demandeurNom?: string;
  demandeurContact?: string;
  dossierSuperficie?: number;
  /** Propriété (une seule) — snapshot texte du mobile. */
  dossierPropriete?: string;
  /** Une ou plusieurs parcelles liées à cette propriété. */
  dossierParcelles?: ParcelleSnapshot[];
  dossierVille?: string;
  /** Dossier lié (mode online) — embarqué dans le payload. */
  idPersonne?: number;
  idDossierParcelle?: string;
}

/** Résultat de recherche de dossier (autocomplete en ligne). */
export interface DossierSearchResult {
  /** Ligne dossier_parcelle exacte — embarquée dans le payload en mode online. */
  idDossierParcelle?: string;
  numeroDossier: string;
  demandeurNom: string;
  demandeurContact?: string;
  superficie?: number;
  parcelle?: string;
  ville?: string;
  propriete?: string;
  titreFoncier?: string;
}

export type { Page };
