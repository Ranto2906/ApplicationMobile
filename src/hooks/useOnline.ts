import { useEffect, useState } from 'react';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativePlatform } from '../platform';

/**
 * État de connexion réseau, réactif.
 * Sur natif on utilise le plugin Capacitor Network ; sur web navigator.onLine.
 *
 * ⚠️ Sur Android, `connected` du plugin (comme `navigator.onLine` du WebView)
 * exige un réseau "validé" : Android sonde un serveur Google pour vérifier
 * l'accès Internet. Sur un réseau LOCAL sans Internet — le cas SEIMAD, où le
 * serveur tourne sur le même WiFi (ex. http://192.168.0.46:8093) — le WiFi est
 * actif mais marqué « non validé », et l'app croit à tort être hors-ligne.
 * En natif, la présence d'une interface réseau (connectionType ≠ 'none')
 * suffit donc à considérer l'appareil comme en ligne : c'est le serveur du
 * réseau local qui fait foi, pas l'accès Internet.
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

    const majDepuisStatut = (s: { connected: boolean; connectionType?: string }) => {
      if (isNativePlatform()) {
        // Interface réseau présente (wifi/cellular/unknown) → en ligne,
        // même si Android n'a pas validé l'accès Internet (réseau local).
        maj(s.connected === true || (s.connectionType ?? 'none') !== 'none');
      } else {
        maj(s.connected === true);
      }
    };

    if (isNativePlatform()) {
      // Natif : le plugin Capacitor fait foi. On ignore volontairement les
      // événements window online/offline : le WebView Android souffre de la
      // même mauvaise détection (réseau local non validé → "offline").
      Network.getStatus()
        .then((s) => majDepuisStatut(s))
        .catch(() => undefined);
      Network.addListener('networkStatusChange', (s) => majDepuisStatut(s))
        .then((h) => { handle = h; })
        .catch(() => undefined);
    } else {
      // Web : les événements du navigateur sont fiables.
      const goOnline = () => maj(true);
      const goOffline = () => maj(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      Network.getStatus()
        .then((s) => majDepuisStatut(s))
        .catch(() => undefined);
      Network.addListener('networkStatusChange', (s) => majDepuisStatut(s))
        .then((h) => { handle = h; })
        .catch(() => undefined);

      return () => {
        actif = false;
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
        handle?.remove();
      };
    }

    return () => {
      actif = false;
      handle?.remove();
    };
  }, []);

  return online;
}
