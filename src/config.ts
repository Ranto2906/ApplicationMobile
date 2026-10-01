// ══════════════════════════════════════════════════════════════
// Config — URL du backend selon l'environnement
// ══════════════════════════════════════════════════════════════
//
// DEV WEB (vite dev)  → proxy /api → http://127.0.0.1:8093
// ANDROID ÉMULATEUR   → http://10.0.2.2:8093
// ANDROID TÉLÉPHONE   → http://<IP_LOCALE>:8093
//
// Modifiez BACKEND_URL selon votre cas.

import { isNativePlatform } from './platform';

// Pour un test sur téléphone : changez cette valeur par votre IP locale
// Trouvez-la avec : ipconfig (Windows) ou ifconfig (Mac/Linux)
const LOCAL_IP = '192.168.0.46'; // ← Votre IP locale (ipconfig)

export const config = {
  /** URL de base du backend */
  getApiBase(): string {
    // Sur le web (navigateur) on passe par le proxy Vite `/api` ;
    // en natif (Android/iOS) on vise directement le backend.
    if (import.meta.env.DEV && !isNativePlatform()) {
      return '/api';
    }
    return `http://${LOCAL_IP}:8091/api`;
  },

  /** URL complète du backend (sans /api) */
  getBackendUrl(): string {
    if (import.meta.env.DEV && !isNativePlatform()) {
      return '';
    }
    return `http://${LOCAL_IP}:8091`;
  },

  /** Mode natif (Capacitor) — évalué à la volée. */
  get isNative(): boolean {
    return isNativePlatform();
  },
};
