// ══════════════════════════════════════════════════════════════
// Lecture du contenu binaire d'une photo avec gestion du pont natif.
//
// Avec `CapacitorHttp: { enabled: true }` (capacitor.config.ts), axios passe
// par le pont natif Android qui renvoie les réponses binaires (BLOB) en
// chaîne base64 (voir HttpRequestHandler.readData → readStreamAsBase64) et
// non en objet Blob comme sur le web. Le FileReader d'un Blob échoue
// silencieusement → les vignettes restaient vides sur le mobile.
//
// On normalise donc les deux cas vers un data-url affichable dans <img> :
//  - Blob (web) → FileReader.readAsDataURL
//  - string base64 (natif) → data-url reconstruit avec le Content-Type
// ══════════════════════════════════════════════════════════════
import type { AxiosInstance } from 'axios';

const MIME_DEFAUT = 'image/jpeg';

/** Normalise une réponse binaire (Blob OU chaîne base64 native) en data-url. */
async function versDataUrl(donnees: unknown, contentType?: string): Promise<string> {
  // Cas natif CapacitorHttp : le pont renvoie la base64 du binaire en string
  // (et non un Blob). On construit le data-url directement.
  if (typeof donnees === 'string') {
    const brut = donnees.trim();
    if (brut.startsWith('data:')) return brut; // déjà un data-url
    // Tolère un éventuel préfixe d'URL de données : data:image/jpeg;base64,XXXX
    const mime = contentType && contentType.startsWith('image/')
      ? contentType.split(';')[0]
      : MIME_DEFAUT;
    return `data:${mime};base64,${brut.replace(/\s/g, '')}`;
  }

  // Cas web : Blob → FileReader.readAsDataURL.
  if (donnees instanceof Blob) {
    if (donnees.size === 0) throw new Error('Contenu photo vide');
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(donnees);
    });
  }

  throw new Error(`Type de contenu photo non géré : ${typeof donnees}`);
}

/**
 * Récupère le contenu d'une photo (avec JWT) et le renvoie en data-url,
 * quel que soit le runtime (web ou pont natif CapacitorHttp).
 */
export async function contenuPhotoDataUrl(
  api: AxiosInstance,
  idPhoto: number | string
): Promise<string> {
  const r = await api.get(`/photos/${idPhoto}/contenu`, { responseType: 'blob' });
  const type = String(r.headers?.['content-type'] || '');
  return await versDataUrl(r.data, type);
}
