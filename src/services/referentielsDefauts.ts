// ══════════════════════════════════════════════════════════════
// Référentiels embarqués (fallback hors-ligne).
// Généré depuis le backend le 2026-10-01 (GET /api/signalements/types et
// /api/villes/all). Utilisés par les formulaires quand ni le réseau ni le
// cache SQLite ne sont disponibles — pour que « Type de signalement » et
// « Ville » restent utilisables sur le terrain.
// NB : les identifiants DOIVENT correspondre au backend ; si un référentiel
// évolue, régénérer ce fichier et livrer une mise à jour de l'app.
// ══════════════════════════════════════════════════════════════

import type { TypeSignalement, VilleSimple } from '../types/signalement';

/** Types de signalement (copie embarquée au build). */
export const TYPES_SIGNALEMENT_DEFAUT: TypeSignalement[] = [{"idTypeSignalement":1,"code":"OCCUPATION","libelle":"Occupation","couleur":"#e67e22"},{"idTypeSignalement":2,"code":"CONSTRUCTION","libelle":"Construction","couleur":"#e74c3c"},{"idTypeSignalement":3,"code":"AUTRE","libelle":"Autre constat","couleur":"#3498db"}];

/** Villes (copie embarquée au build). */
export const VILLES_DEFAUT: VilleSimple[] = [{"idVille":1,"nomVille":"Antananarivo"},{"idVille":2,"nomVille":"Toamasina"},{"idVille":3,"nomVille":"Antsirabe"},{"idVille":4,"nomVille":"Fianarantsoa"},{"idVille":5,"nomVille":"Mahajanga"},{"idVille":6,"nomVille":"Toliara"},{"idVille":7,"nomVille":"Antsiranana"},{"idVille":8,"nomVille":"Nosy Be"},{"idVille":9,"nomVille":"Morondava"},{"idVille":10,"nomVille":"Manakara"},{"idVille":11,"nomVille":"Ambatolampy"},{"idVille":12,"nomVille":"Anosiala héritier"},{"idVille":13,"nomVille":"Anosiala cultivateur"},{"idVille":14,"nomVille":"Manazary Betsizaraina"},{"idVille":15,"nomVille":"Anosiala Construit"},{"idVille":16,"nomVille":"Juillet 2023 à Décembre 2023"},{"idVille":17,"nomVille":"Fin Aout 2024"},{"idVille":18,"nomVille":"Anosiala"},{"idVille":19,"nomVille":"Autre"},{"idVille":34,"nomVille":"Antananarivo Avaradrano"},{"idVille":35,"nomVille":"Antananarivo Renivohitra"},{"idVille":36,"nomVille":"Anosiala Ambohidratrimo"}];
