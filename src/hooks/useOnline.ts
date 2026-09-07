import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * État de connexion réseau, réactif.
 * Sur natif on utilise le plugin Capacitor Network ; sur web navigator.onLine.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    let actif = true;
    let handle: PluginListenerHandle | null = null;

    const maj = (v: boolean) => {
      if (actif) setOnline(v);
    };
    const goOnline = () => maj(true);
    const goOffline = () => maj(false);

    // Web
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Natif (Capacitor)
    Network.getStatus()
      .then((s) => maj(s.connected))
      .catch(() => undefined);
    Network.addListener('networkStatusChange', (s) => maj(s.connected))
      .then((h) => { handle = h; })
      .catch(() => undefined);

    return () => {
      actif = false;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      handle?.remove();
    };
  }, []);

  return online;
}
