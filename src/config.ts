// ══════════════════════════════════════════════════════════════
// Config — URL du backend selon l'environnement
// ══════════════════════════════════════════════════════════════
//
// DEV WEB (vite dev)  → proxy /api → http://127.0.0.1:8090
// ANDROID ÉMULATEUR   → http://10.0.2.2:8090
// ANDROID TÉLÉPHONE   → http://<IP_LOCALE>:8090
//
// Modifiez BACKEND_URL selon votre cas.

const isNative = !!(window as any).Capacitor?.isNativePlatform;

// Pour un test sur téléphone : changez cette valeur par votre IP locale
// Trouvez-la avec : ipconfig (Windows) ou ifconfig (Mac/Linux)
const LOCAL_IP = '192.168.137.247'; // ← Votre IP locale (ipconfig)

export const config = {
  /** URL de base du backend */
  getApiBase(): string {
    if (import.meta.env.DEV && !isNative) {
      return '/api';
    }
    return `http://${LOCAL_IP}:8090/api`;
  },

  /** URL complète du backend (sans /api) */
  getBackendUrl(): string {
    if (import.meta.env.DEV && !isNative) {
      return '';
    }
    return `http://${LOCAL_IP}:8090`;
  },

  /** Mode natif (Capacitor) */
  isNative,
};
