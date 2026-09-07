// ══════════════════════════════════════════════════════════════
// Authentification hors-ligne.
//
// À la première connexion EN LIGNE, la session (profil + tokens de
// secours + empreinte SHA-256 du mot de passe avec sel) est stockée.
// Elle permet ensuite :
//  - de rester connecté / se reconnecter sans réseau (session locale),
//  - de vérifier les identifiants localement sur la page de login.
// Le mot de passe n'est jamais stocké en clair.
//
// Deux couches de stockage :
//  1. localStorage (miroir)  → lecture synchrone, instantanée, disponible
//     même si SQLite web n'est pas prêt (jeep-sqlite encore en chargement
//     ou indisponible). Suffit pour la restauration/la vérification locale.
//  2. SQLite (base `seimad_offline`) → copie durable (natif + web).
// ══════════════════════════════════════════════════════════════
import { db, type SessionLocale } from './db';
import { setTokens, getAccessToken } from './api';
import { sha256Hex, randomHex } from './sha256';
import type { LoginResponse, UtilisateurDTO } from '../types';

const CLE_MIROIR = 'seimad_session_locale';

function depuisDébut(): string {
  return `${(performance.now() - (window as any).__SEIMAD_DÉMARAGE__ || 0).toFixed(0)}ms`;
}
function log(...args: any[]) {
  console.log(`[SEIMAD:offlineAuth:${depuisDébut()}]`, ...args);
}
function logErr(err: unknown, label = 'erreur') {
  if (err && typeof err === 'object' && 'stack' in err && typeof (err as any).message === 'string') {
    console.error(`[SEIMAD:offlineAuth:${depuisDébut()}]`, label, (err as any).message, (err as any).stack);
  } else {
    console.error(`[SEIMAD:offlineAuth:${depuisDébut()}]`, label, err);
  }
}

/** Écrit le miroir localStorage (synchrone, ne doit jamais lever). */
function écrireMiroir(session: SessionLocale | null): void {
  try {
    if (session) {
      localStorage.setItem(CLE_MIROIR, JSON.stringify(session));
    } else {
      localStorage.removeItem(CLE_MIROIR);
    }
  } catch (e) {
    // Stockage plein / indisponible : le SQLite (le cas échéant) reste la copie durable.
    logErr(e, 'écrireMiroir → localStorage indisponible');
  }
}

/** Lit le miroir localStorage (synchrone). */
function lireMiroir(): SessionLocale | null {
  try {
    const raw = localStorage.getItem(CLE_MIROIR);
    if (!raw) return null;
    return JSON.parse(raw) as SessionLocale;
  } catch {
    return null;
  }
}

/** Enregistre la session locale après une connexion réussie en ligne. */
export async function enregistrerSessionLocale(
  response: LoginResponse,
  motDePasse: string
): Promise<void> {
  log('enregistrerSessionLocale → début (utilisateur:', response.utilisateur?.nomUtilisateur, ')');
  const début = performance.now();
  try {
    const sel = randomHex(32);
    const session: SessionLocale = {
      user: response.utilisateur,
      nomUtilisateur: response.utilisateur.nomUtilisateur,
      sel,
      hash: sha256Hex(sel + motDePasse),
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      savedAt: new Date().toISOString(),
    };
    // Copie immédiate + fiable (web inclus, même si SQLite est en chargement).
    écrireMiroir(session);
    // Copie durable best-effort (SQLite natif/web).
    try {
      await db.sauverSessionLocale(session);
    } catch (e) {
      logErr(e, 'enregistrerSessionLocale → SQLite indisponible (miroir localStorage conservé)');
    }
    log('enregistrerSessionLocale → terminé après', `${(performance.now() - début).toFixed(0)}ms`);
  } catch (e) {
    logErr(e, 'enregistrerSessionLocale → échec (la session en ligne reste utilisable)');
    throw e;
  }
}

export async function lireSessionLocale(): Promise<SessionLocale | null> {
  // Miroir localStorage : synchrone et indépendant de SQLite.
  const miroir = lireMiroir();
  if (miroir) return miroir;
  // Repli : ancienne session éventuellement présente uniquement en SQLite.
  try {
    return await db.lireSessionLocale();
  } catch (e) {
    logErr(e, 'lireSessionLocale → repli SQLite indisponible');
    return null;
  }
}

export async function effacerSessionLocale(): Promise<void> {
  log('effacerSessionLocale → suppression');
  écrireMiroir(null);
  try {
    await db.supprimerSessionLocale();
  } catch (e) {
    logErr(e, 'effacerSessionLocale → SQLite indisponible (miroir déjà supprimé)');
  }
}

/**
 * Restaure la session locale (démarrage hors-ligne, tokens absents du
 * stockage web…). Ré-applique les tokens de secours seulement si aucun
 * token n'est déjà présent. Lecture depuis le miroir localStorage → ne
 * bloque jamais sur l'initialisation SQLite.
 */
export async function restaurerSessionLocale(): Promise<UtilisateurDTO | null> {
  const session = await lireSessionLocale();
  if (!session || !session.user) {
    log('restaurerSessionLocale → aucune session locale trouvée');
    return null;
  }
  log('restaurerSessionLocale → session trouvée (utilisateur:', session.user.nomUtilisateur, ')');
  if (!getAccessToken() && session.accessToken && session.refreshToken) {
    log('restaurerSessionLocale → réapplication des tokens de secours');
    setTokens(session.accessToken, session.refreshToken);
  } else {
    log('restaurerSessionLocale → tokens déjà présents ou session sans tokens de secours');
  }
  return session.user;
}

/**
 * Vérifie les identifiants localement (hors-ligne). Compare l'empreinte
 * SHA-256(sel + motDePasse) à celle enregistrée lors de la dernière
 * connexion en ligne. Retourne l'utilisateur si OK, sinon null.
 */
export async function verifierIdentifiantsLocaux(
  nomUtilisateur: string,
  motDePasse: string
): Promise<UtilisateurDTO | null> {
  log('verifierIdentifiantsLocaux → vérification pour', nomUtilisateur);
  const début = performance.now();
  const session = await lireSessionLocale();
  if (!session || !session.user) {
    log('verifierIdentifiantsLocaux → fin en', `${(performance.now() - début).toFixed(0)}ms`, '| aucune session');
    return null;
  }
  if ((session.nomUtilisateur || '').trim().toLowerCase() !== (nomUtilisateur || '').trim().toLowerCase()) {
    log('verifierIdentifiantsLocaux → fin | nom différent');
    return null;
  }
  const hash = sha256Hex(session.sel + (motDePasse ?? ''));
  if (hash !== session.hash) {
    log('verifierIdentifiantsLocaux → fin | hash invalide');
    return null;
  }
  log('verifierIdentifiantsLocaux → fin | OK après', `${(performance.now() - début).toFixed(0)}ms`);
  return session.user;
}
