/**
 * Propriété saisie manuellement (mobile, hors-ligne).
 *
 * Le backend n'a pas de champ « propriété libre » : SignalementRequest
 * n'accepte que `idPropriete` (FK vers une propriété existante). Le mobile
 * trace donc la saisie libre en PRÉFIXE de la description du signalement :
 *
 *   `[Propriété : <texte>] <description>`
 *
 * Ce module centralise l'écriture et la lecture de ce préfixe afin que toutes
 * les vues (mobile + web) l'affichent comme un encart dédié, séparé de
 * l'observation.
 * (Miroir web : frontend-react/src/utils/proprieteManuelle.ts)
 */

export const REGEX_PREFIXE_PROPRIETE_MANUELLE = /^\[Propriété : (.+?)\]\s*/;

/** Découpe une description : renvoie la propriété manuelle ('' si absente) et la description sans le préfixe. */
export function extraireProprieteManuelle(description?: string | null): {
  proprieteManuelle: string;
  description: string;
} {
  const desc = description ?? '';
  const m = REGEX_PREFIXE_PROPRIETE_MANUELLE.exec(desc);
  if (!m) return { proprieteManuelle: '', description: desc };
  return { proprieteManuelle: m[1], description: desc.slice(m[0].length) };
}

/** Recompose la description avec le préfixe (à l'enregistrement). Sans préfixe si la propriété est vide. */
export function composerDescriptionAvecProprieteManuelle(proprieteManuelle: string, description: string): string {
  const p = (proprieteManuelle || '').trim();
  const d = (description || '').trim();
  return p ? `[Propriété : ${p}] ${d}` : d;
}
