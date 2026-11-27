const normalizeBaseUrl = (value?: string): string => (value || '').trim().replace(/\/+$/, '');

export const SITE_URL = normalizeBaseUrl(import.meta.env.VITE_SITE_URL as string);

// Ne jamais retomber sur la Main API : elle ne sert aucune route
// /api/watchparty/* et produisait des 404 silencieux quand
// VITE_WATCHPARTY_API n'était pas renseigné en production.
export const WATCHPARTY_API = normalizeBaseUrl(import.meta.env.VITE_WATCHPARTY_API as string);

export const MAIN_API = normalizeBaseUrl(import.meta.env.VITE_MAIN_API as string);
export const PROXIES_EMBED_API = normalizeBaseUrl(import.meta.env.VITE_PROXIES_EMBED_API as string);
export const BESTDEBRID_API_BASE = 'https://bestdebrid.com/api/v1';

// Clé publique facultative du point d'accès translateHtml. Aucune valeur par
// défaut : sans configuration, le service de traduction utilise les autres
// points d'accès et n'envoie aucune clé codée en dur dans le bundle.
export const TRANSLATE_HTML_API_KEY = (import.meta.env.VITE_TRANSLATE_HTML_API_KEY as string || '').trim();

export const buildSiteUrl = (path: string): string => {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
};
