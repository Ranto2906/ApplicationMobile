import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { UtilisateurDTO, LoginRequest } from '../types';
import { authApi, setTokens, clearTokens } from '../services/api';
import {
  enregistrerSessionLocale,
  restaurerSessionLocale,
  effacerSessionLocale,
  verifierIdentifiantsLocaux,
} from '../services/offlineAuth';

interface AuthContextType {
  user: UtilisateurDTO | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Connexion en ligne (avec repli automatique vers la vérification locale si le serveur est injoignable). */
  login: (request: LoginRequest) => Promise<void>;
  /** Connexion 100 % hors-ligne : vérifie les identifiants contre la session SQLite. */
  loginHorsLigne: (request: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function depuisDébut(): string {
  return `${(performance.now() - (window as any).__SEIMAD_DÉMARAGE__ || 0).toFixed(0)}ms`;
}

function log(...args: any[]) {
  console.log(`[SEIMAD:Auth:${depuisDébut()}]`, ...args);
}
function logErr(err: unknown, label = 'erreur') {
  if (err && typeof err === 'object' && 'stack' in err && typeof (err as any).message === 'string') {
    console.error(`[SEIMAD:Auth:${depuisDébut()}]`, label, (err as any).message, (err as any).stack);
  } else {
    console.error(`[SEIMAD:Auth:${depuisDébut()}]`, label, err);
  }
}

/** Une erreur réseau = pas de réponse HTTP (serveur injoignable / hors-ligne). */
function estErreurReseau(err: unknown): boolean {
  return !(err as { response?: unknown })?.response;
}

/** Erreur dédiée à l'authentification hors-ligne (affichage Login). */
function erreurHorsLigne(message: string): Error {
  const e = new Error(message);
  (e as { code?: string }).code = 'OFFLINE_AUTH';
  return e;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UtilisateurDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    log('loadUser → démarrage (verification session)');
    // Le démarrage ne dépend jamais du serveur. Une requête /auth/me ici
    // provoquait un clignotement et pouvait bloquer le WebView sans réseau.
    const stored = localStorage.getItem('user');
    let localUser: UtilisateurDTO | null = null;
    if (stored) {
      try { localUser = JSON.parse(stored) as UtilisateurDTO; } catch { localUser = null; }
    }
    if (!localUser) {
      localUser = await restaurerSessionLocale().catch((e) => {
        logErr(e, 'loadUser · restauration locale échouée');
        return null;
      });
    } else {
      // Réapplique aussi les tokens de secours si le stockage des tokens a été vidé.
      await restaurerSessionLocale().catch(() => null);
    }
    setUser(localUser);
    setIsLoading(false);
    log('loadUser → démarrage local terminé | user:', !!localUser);
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (request: LoginRequest) => {
    try {
      const response = await authApi.login(request);
      setTokens(response.accessToken, response.refreshToken);
      setUser(response.utilisateur);
      localStorage.setItem('user', JSON.stringify(response.utilisateur));
      // Prépare la session locale pour les prochaines utilisations hors-ligne.
      await enregistrerSessionLocale(response, request.motDePasse).catch(() => undefined);
    } catch (err) {
      if (estErreurReseau(err)) {
        // Repli hors-ligne : vérification locale des identifiants.
        const sessionUser = await verifierIdentifiantsLocaux(request.nomUtilisateur, request.motDePasse);
        if (sessionUser) {
          await restaurerSessionLocale().catch(() => null);
          setUser(sessionUser);
          localStorage.setItem('user', JSON.stringify(sessionUser));
          return;
        }
        throw erreurHorsLigne(
          'Identifiants incorrects (vérification hors-ligne). Connectez-vous une première fois en ligne.'
        );
      }
      throw err;
    }
  };

  const loginHorsLigne = async (request: LoginRequest) => {
    const sessionUser = await verifierIdentifiantsLocaux(request.nomUtilisateur, request.motDePasse);
    if (!sessionUser) {
      throw erreurHorsLigne(
        'Connexion hors-ligne impossible : aucun compte enregistré sur cet appareil. Connectez-vous une première fois en ligne.'
      );
    }
    await restaurerSessionLocale().catch(() => null);
    setUser(sessionUser);
    localStorage.setItem('user', JSON.stringify(sessionUser));
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    try { await authApi.logout(refreshToken); } catch { /* ignore */ }
    clearTokens();
    // Supprime la session locale : une reconnexion exigera le réseau.
    await effacerSessionLocale().catch(() => undefined);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, loginHorsLigne, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
