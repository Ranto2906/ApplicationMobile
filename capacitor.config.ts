import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mg.seimad.patrimoine',
  appName: 'SEIMAD',
  webDir: 'dist',
  server: {
    // Pour le dev : décommentez la ligne suivante pour-pointer vers le backend local
    // url: 'http://192.168.1.100:5174',
    cleartext: true,
    // Capacitor 6 utilise https://localhost par défaut → mixed content bloqué
    // when backend est en http. Forcer le scheme http pour éviter ça.
    androidScheme: 'http',
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  plugins: {
    // Force le HTTP natif Android pour toutes les requêtes fetch/XMLHttpRequest
    // Contourne les restrictions du WebView (cleartext, CORS, mixed content)
    CapacitorHttp: {
      enabled: true,
    },
    // @capacitor-community/sqlite : DÉSACTIVE le chiffrement (défaut du plugin =
    // true !). Sur certains appareils, l'init Android Keystore/MasterKey du plugin
    // échoue au démarrage (NPE) → « CapacitorSQLitePlugin: null » renvoyé pour
    // TOUS les appels SQLite : aucune écriture locale possible (création
    // signalement/descente hors-ligne impossible). Nos bases sont créées en
    // 'no-encryption' : ce flag n'affecte aucune donnée existante.
    CapacitorSQLite: {
      androidIsEncryption: false,
      iosIsEncryption: false,
      electronIsEncryption: false,
    },
  },
};

export default config;
