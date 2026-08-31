import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mg.seimad.patrimoine',
  appName: 'SEIMAD',
  webDir: 'dist',
  server: {
    // Pour le dev : décommentez la ligne suivante pour-pointer vers le backend local
    // url: 'http://192.168.1.100:5174',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
};

export default config;
