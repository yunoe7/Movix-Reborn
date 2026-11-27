/**
 * URL d'embed sûre pour un `<iframe src>` : rend l'URL telle quelle si elle
 * est absolue et en http(s), une chaîne vide sinon.
 *
 * React 18 ne bloque pas `javascript:` dans `src` : un lien communautaire ou
 * scrapé de cette forme s'exécuterait sur l'origine du site, avec accès à la
 * session du visiteur. Le parseur sans base refuse aussi les URL relatives et
 * `//hôte`, qui chargeraient une iframe sur l'origine de Movix ou contourneraient
 * une éventuelle liste d'hôtes autorisés. Les caractères de contrôle sont
 * rejetés avant analyse : WHATWG les supprime silencieusement et peut ainsi
 * transformer un hôte en un autre.
 */
export const safeEmbedUrl = (rawUrl: string | null | undefined): string => {
  if (!rawUrl) return '';
  if (/[\u0000-\u0020\u007f]/.test(rawUrl)) return '';
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:' ? rawUrl : '';
  } catch {
    return '';
  }
};
