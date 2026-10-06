import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { isWebPlatform } from './platform';

/* Import Ionic CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Theme variables */
import './theme/variables.css';

/* Global styles */
import './App.css';

/* ── diagnostics de démarrage ──────────────────────────────────────────── */
const DEMARRAGE = performance.now();
function depuisDébut(): string {
  return `${(performance.now() - DEMARRAGE).toFixed(0)}ms`;
}

function log(...args: any[]) {
  console.log(`[SEIMAD:${depuisDébut()}]`, ...args);
}
function logErr(err: unknown, label = 'erreur') {
  if (err && typeof err === 'object' && 'stack' in err && typeof (err as any).message === 'string') {
    console.error(`[SEIMAD:${depuisDébut()}]`, label, (err as any).message, (err as any).stack);
  } else {
    console.error(`[SEIMAD:${depuisDébut()}]`, label, err);
  }
}

log('main · démarrage SEIMAD (plateforme web)');

// Horloge partagée utilisée par tous les modules de log (ms depuis le premier
// script exécuté). Utile pour corréler les traces entre db/Auth/api.
(window as any).__SEIMAD_DÉMARAGE__ = performance.now();

/* ── erreurs globales visibles (le téléphone n'a pas de DevTools) ─────────
   Sans cela, une erreur JS non gérée se traduit sur l'appareil par un écran
   blanc muet. On affiche un bandeau rouge dissimulable avec le message —
   photo-écranable par l'utilisateur pour le rapport de bug. */
function afficherErreurGlobale(message: string) {
  try {
    let bandeau = document.getElementById('seimad-erreurs') as HTMLDivElement | null;
    if (!bandeau) {
      bandeau = document.createElement('div');
      bandeau.id = 'seimad-erreurs';
      bandeau.setAttribute('role', 'alert');
      bandeau.style.cssText = [
        'position:fixed', 'left:8px', 'right:8px', 'bottom:8px', 'z-index:99999',
        'background:#7f1d1d', 'color:white', 'border-radius:10px',
        'padding:10px 12px', 'font:12px/1.5 monospace', 'max-height:45%',
        'overflow:auto', 'box-shadow:0 4px 16px rgba(0,0,0,.4)', 'white-space:pre-wrap',
      ].join(';');
      bandeau.textContent = '⚠️ Erreur application (toucher pour masquer)\n';
      bandeau.addEventListener('click', () => { bandeau?.remove(); });
      document.body?.appendChild(bandeau);
    }
    bandeau.textContent += message + '\n';
  } catch { /* DOM pas prêt : rien à faire */ }
}
window.addEventListener('error', (e) => {
  logErr(e.error ?? e.message, 'window.onerror');
  afficherErreurGlobale(`Erreur : ${(e as ErrorEvent).message || 'inconnue'}`);
});
window.addEventListener('unhandledrejection', (e) => {
  logErr((e as PromiseRejectionEvent).reason, 'unhandledrejection');
  const raison = (e as PromiseRejectionEvent).reason as { message?: string } | undefined;
  afficherErreurGlobale(`Promesse rejetée : ${raison?.message || String(raison ?? 'inconnue')}`);
});

/* jeep-sqlite : support navigateur du plugin SQLite (@capacitor-community/sqlite).
   Le fichier sql-wasm.wasm est servi depuis /assets (voir public/assets). */
import { defineCustomElements as jeepSqliteDefineCustomElements } from 'jeep-sqlite/loader';

/** État partagé : est-ce que le mode web SQLite est réellement disponible ? */
(window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__ = false;
/** Vrai pendant que le loader jeep-sqlite est en cours d'initialisation. */
(window as any).__SEIMAD_SQLITE_LOADING__ = false;

(async () => {
  if (typeof window === 'undefined') return;

  if (!isWebPlatform()) {
    // Natif Android/iOS : le SQLite natif est fourni par le plugin Capacitor,
    // le composant web jeep-sqlite n'est pas requis.
    log('main · plateforme NATIF — pas de loader jeep-sqlite requis');
    return;
  }

  // Navigateur web : on DOIT enregistrer le composant <jeep-sqlite>, sinon
  // aucune requête SQLite web ne peut aboutir (timeouts sur whenDefined…).
  log('main · plateforme WEB — chargement du loader jeep-sqlite…');
  (window as any).__SEIMAD_SQLITE_LOADING__ = true;
  const délaiDébut = performance.now();
  try {
    await jeepSqliteDefineCustomElements(window);
    log('main · jeep-sqlite loader défini après', `${(performance.now() - délaiDébut).toFixed(0)}ms`);
  } catch (e) {
    logErr(e, 'main · jeep-sqlite loader ÉCHEC');
  } finally {
    (window as any).__SEIMAD_SQLITE_LOADING__ = false;
  }

  // Vérification immédiate : le composant est-il vraiment défini ?
  // Sur web, si <jeep-sqlite> n'est pas défini, c'est que le loader Stencil
  // n'a pas fini de charger le bundle lazy (chunk / asset manquant).
  if (typeof customElements !== 'undefined') {
    const tag = customElements.get('jeep-sqlite');
    if (tag) {
      (window as any).__SEIMAD_WEB_SQLITE_AVAILABLE__ = true;
      log('main · <jeep-sqlite> EST défini → web SQLite activé');
    } else {
      log('main · <jeep-sqlite> NON défini après loader → web SQLite indisponible');
      console.warn(
        '[SEIMAD:main] web SQLite indisponible — vérifier que le loader jeep-sqlite a bien résolu le bundle lazy (chunk) et que /assets/sql-wasm.wasm est servi.'
      );

      // Diagnostic supplémentaire : est-ce que l'asset WASM est accessible ?
      fetch('/assets/sql-wasm.wasm', { method: 'HEAD', mode: 'no-cors' })
        .then((r) => {
          console.info(
            `[SEIMAD:main] vérification /assets/sql-wasm.wasm → réponse ${r.status || 'non-cost'} (no-cors).`
          );
        })
        .catch((e) => {
          console.warn('[SEIMAD:main] vérification /assets/sql-wasm.wasm → FETCH échoué', e?.message || e);
        });
    }
  } else {
    log('main · customElements indisponible → web SQLite indisponible');
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
