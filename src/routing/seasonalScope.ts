/**
 * Politique d'exclusion déclarative du moteur décoratif saisonnier.
 *
 * Source unique pour le bootstrap, le provider LOT 4A/4B et les ambiances
 * historiques. Les décisions sont prises AVANT toute initialisation : sur une
 * route non déclarée, le défaut est `suppress`. La liste stricte existante
 * (`seasonalThemeGraphics/routes.ts`) prime toujours sur les métadonnées.
 *
 * Module pur : aucun import React, aucun import des loaders de page. Il peut
 * donc être utilisé dans `main.tsx` comme dans les harnais de test sans
 * entraîner le chargement du registre paresseux.
 */
import {
  resolveSeasonalRouteMode,
  type SeasonalRouteMetadata,
  type SeasonalRouteMode,
} from '../seasonalThemeGraphics/routes';

export type SeasonalDecorScope = 'full' | 'minimal' | 'suppress';

/**
 * Catalogue fermé des routes et de leur périmètre décoratif. Il recouvre le
 * registre `src/routing/registry.tsx` et les routes montées directement dans
 * `App.tsx`. Toute route absente est traitée comme sensible.
 */
export const SEASONAL_DECOR_SCOPES: Readonly<Record<string, SeasonalDecorScope>> = Object.freeze({
  '/': 'full',

  // Catalogue et fiches publiques.
  '/movies': 'full',
  '/anime': 'full',
  '/tv-shows': 'full',
  '/provider/:providerId': 'full',
  '/provider/:providerId/:type/:genreId?': 'full',
  '/movie/:id': 'full',
  '/tv/:id': 'full',
  '/person/:id': 'full',
  '/genre/:mediaType/:genreId': 'full',
  '/search': 'full',
  '/tv': 'full',
  '/nouveautes': 'full',
  '/profile-management': 'full',
  '/alerts': 'full',
  '/profile': 'full',
  '/about': 'full',
  '/privacy': 'full',
  '/terms': 'full',
  '/terms-of-service': 'full',
  '/frais': 'full',
  // Page utilitaire : cadre statique autorisé, sans particules.
  '/download/:type/:id': 'minimal',

  // Lecteurs, écrans de lecture alternatifs et synchronisation.
  '/watch/movie/:tmdbid': 'suppress',
  '/watch/movie/:tmdbid/version/:version': 'suppress',
  '/watch/tv/:tmdbid/s/:season/e/:episode': 'suppress',
  '/ftv/watch': 'suppress',
  '/watchparty': 'suppress',
  '/watchparty/join/:code': 'suppress',
  '/watchparty/room/:roomId': 'suppress',

  // Authentification, consentement et liens de compte.
  '/auth': 'suppress',
  '/auth/google': 'suppress',
  '/oauth/authorize': 'suppress',
  '/oauth/consent': 'suppress',
  '/login': 'suppress',
  '/logout': 'suppress',
  '/register': 'suppress',
  '/password/reset': 'suppress',
  '/login-bip39': 'suppress',
  '/create-account': 'suppress',
  '/link-bip39': 'suppress',
  '/link-bip39/create': 'suppress',
  '/profile-selection': 'suppress',
  '/settings/security': 'suppress',
  '/account/delete': 'suppress',

  // Paiement, facturation et administration (aperçu compris).
  '/vip': 'suppress',
  '/vip/don': 'suppress',
  '/vip/invoices': 'suppress',
  '/vip/invoice/:publicId': 'suppress',
  '/vip/cadeau/:giftToken': 'suppress',
  '/payment': 'suppress',
  '/payment/checkout': 'suppress',
  '/checkout': 'suppress',
  '/admin': 'suppress',
  '/admin-control-center': 'suppress',
  '/wrapped': 'suppress',
  '/wrapped/:year': 'suppress',
});

function pathnameOnly(path: string): string {
  const clean = path.split(/[?#]/)[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean || '/';
}

/**
 * Correspondance d'un motif déclaratif avec un chemin concret. Les segments
 * `:param` acceptent toute valeur ; un segment final `:param?` peut être absent.
 */
export function matchesDecorPattern(pattern: string, pathname: string): boolean {
  const pathParts = pathnameOnly(pathname).split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  const optional = patternParts.filter((part) => part.endsWith('?')).length;
  const required = patternParts.length - optional;
  if (pathParts.length < required || pathParts.length > patternParts.length) return false;

  return patternParts.every((part, index) => {
    const segment = part.endsWith('?') ? part.slice(0, -1) : part;
    if (index >= pathParts.length) return segment.startsWith(':');
    return segment.startsWith(':') || segment === pathParts[index];
  });
}

function decorScopeFor(pathname: string): SeasonalDecorScope | null {
  for (const [pattern, scope] of Object.entries(SEASONAL_DECOR_SCOPES)) {
    if (pattern === pathname || matchesDecorPattern(pattern, pathname)) return scope;
  }
  return null;
}

/** Métadonnées transmises à la politique stricte existante. */
export function seasonalRouteMetadata(path: string): SeasonalRouteMetadata {
  const scope = decorScopeFor(pathnameOnly(path));
  if (scope === 'minimal') return { minimal: true };
  if (scope === 'full') return {};
  return { suppress: true };
}

/**
 * Mode effectif du moteur pour une route. `none` signifie : ni moteur
 * graphique, ni typographie, ni configuration demandée, ni asset, ni effet
 * historique résiduel.
 */
export function resolveSeasonalDecorMode(path: string): SeasonalRouteMode {
  return resolveSeasonalRouteMode(path, seasonalRouteMetadata(path));
}
