// ══════════════════════════════════════════════════════════════
// Détection fiable de la plateforme (web vs natif Capacitor)
//
// ⚠️  Dans @capacitor/core, `Capacitor.isNativePlatform` est une
// FONCTION (`isNativePlatform()`), pas un booléen. Une vérification
// du style `!!window.Capacitor?.isNativePlatform` est donc TOUJOURS
// vraie — même dans un navigateur web — ce qui faisait croire à
// l'app qu'elle tournait en natif (loader jeep-sqlite jamais chargé,
// URL backend natif utilisée sur le web…).
//
// Utilisez `isNativePlatform()` / `isWebPlatform()` ci-dessous.
// ══════════════════════════════════════════════════════════════
import { Capacitor } from '@capacitor/core';

function capaciteurGlobal(): any | undefined {
  return (typeof window !== 'undefined' && (window as any).Capacitor) || undefined;
}

/** True si on tourne réellement dans un runtime natif Capacitor (Android/iOS). */
export function isNativePlatform(): boolean {
  const cap = capaciteurGlobal();

  // @capacitor/core ≥ 5 : méthode à appeler.
  if (cap && typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform() === true;
    } catch {
      /* ignore */
    }
  }
  // Certains builds exposent aussi un booléen prêt à l'emploi.
  if (typeof cap?.isNative === 'boolean') return cap.isNative;
  // Repli via le module importé.
  if (typeof Capacitor?.getPlatform === 'function') {
    return Capacitor.getPlatform() !== 'web';
  }
  return false;
}

/** True si on tourne dans un navigateur web (dev vite, build statique, PWA…). */
export function isWebPlatform(): boolean {
  return !isNativePlatform();
}
