import type { ComponentType, ReactNode } from 'react';
import { lazyWithRetry } from './lazyWithRetry';
import { isPathTvExcluded } from './tvScope';
import { SEASONAL_DECOR_SCOPES, type SeasonalDecorScope } from './seasonalScope';
import { isTvPlatform } from '../utils/tvPlatform';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';
import CatalogSkeleton from '../components/skeletons/CatalogSkeleton';

export type RouteEntry = {
  path: string;
  loader: (opts?: { silent?: boolean; routeKey?: string }) => Promise<{ default: ComponentType<unknown> }>;
  fallback?: ReactNode;
  guard?: 'private';
  getComponentKey?: (pathname: string) => string;
  /**
   * Hors périmètre V1 sur TV : la route n'est pas montée quand
   * `isTvPlatform()` est vrai (voir le filtrage dans App.tsx). Un lien profond
   * vers une route exclue tombe sur <NotFound />, ce qui suffit en V1.
   */
  tvExcluded?: boolean;
  /**
   * Périmètre décoratif saisonnier. La politique effective est consommée par
   * `seasonalScope.ts` avant React : une route non déclarée est `suppress`.
   */
  seasonalDecor?: SeasonalDecorScope;
};

const lz = <P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) =>
  (opts?: { silent?: boolean; routeKey?: string }) => lazyWithRetry(loader, opts) as Promise<{ default: ComponentType<unknown> }>;

export const getProviderCatalogScope = (pathname: string): string | null => {
  const match = pathname.match(/^\/provider\/([^/]+)\/(?:movies|tv)(?:\/[^/]+)?\/?$/);
  return match ? `/provider/${match[1]}` : null;
};

export const ROUTES: RouteEntry[] = [
  // Les fallbacks partagent le chargement de leur page. Les autres routes
  // gardent RouteProgressBar pendant l'import, sans fausse grille d'affiches.
  // Catalog pages
  { path: '/movies',                  loader: lz(() => import('../pages/Movies')),                  fallback: <CatalogSkeleton variant="movies" />, seasonalDecor: SEASONAL_DECOR_SCOPES['/movies'] },
  { path: '/anime',                   loader: lz(() => import('../pages/AnimeRedirect')),            fallback: <CatalogSkeleton variant="tv" />, seasonalDecor: SEASONAL_DECOR_SCOPES['/anime'] },
  { path: '/tv-shows',                loader: lz(() => import('../pages/TVShows')),                 fallback: <CatalogSkeleton variant="tv" />, seasonalDecor: SEASONAL_DECOR_SCOPES['/tv-shows'] },
  { path: '/vip/invoices',            loader: lz(() => import('../pages/VipInvoicesPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/vip/invoices'] },

  // Provider catalogs
  { path: '/provider/:providerId',    loader: lz(() => import('../pages/ProviderContent')), seasonalDecor: SEASONAL_DECOR_SCOPES['/provider/:providerId'] },
  {
    path: '/provider/:providerId/:type/:genreId?',
    loader: lz(() => import('../pages/ProviderCatalogPage')),
    getComponentKey: (pathname) => getProviderCatalogScope(pathname) ?? pathname,
    seasonalDecor: SEASONAL_DECOR_SCOPES['/provider/:providerId/:type/:genreId?'],
  },

  // Details pages
  { path: '/movie/:id',               loader: lz(() => import('../pages/MovieDetails')),            fallback: <DetailsSkeleton />, seasonalDecor: SEASONAL_DECOR_SCOPES['/movie/:id'] },
  { path: '/tv/:id',                  loader: lz(() => import('../pages/TVDetails')),               fallback: <DetailsSkeleton mediaType="tv" />, seasonalDecor: SEASONAL_DECOR_SCOPES['/tv/:id'] },
  { path: '/person/:id',              loader: lz(() => import('../pages/PersonDetails')), seasonalDecor: SEASONAL_DECOR_SCOPES['/person/:id'] },

  // Genre
  { path: '/genre/:mediaType/:genreId', loader: lz(() => import('../pages/GenrePage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/genre/:mediaType/:genreId'] },

  // Search
  { path: '/search',                  loader: lz(() => import('../pages/Search')), seasonalDecor: SEASONAL_DECOR_SCOPES['/search'] },

  // Watch routes (no skeleton — RouteProgressBar fallback)
  { path: '/watch/movie/:tmdbid',     loader: lz(() => import('../pages/Watch/WatchMovie')), seasonalDecor: SEASONAL_DECOR_SCOPES['/watch/movie/:tmdbid'] },
  // Version alternative (ex. Encore) : chemin distinct pour remonter le lecteur.
  { path: '/watch/movie/:tmdbid/version/:version', loader: lz(() => import('../pages/Watch/WatchMovie')), seasonalDecor: SEASONAL_DECOR_SCOPES['/watch/movie/:tmdbid/version/:version'] },
  { path: '/watch/tv/:tmdbid/s/:season/e/:episode', loader: lz(() => import('../pages/Watch/WatchTv')), seasonalDecor: SEASONAL_DECOR_SCOPES['/watch/tv/:tmdbid/s/:season/e/:episode'] },

  // Watch party
  { path: '/watchparty',              loader: lz(() => import('../pages/WatchPartyPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/watchparty'] },
  { path: '/watchparty/join/:code',   loader: lz(() => import('../pages/WatchPartyPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/watchparty/join/:code'] },
  { path: '/watchparty/room/:roomId', loader: lz(() => import('../pages/WatchPartyPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/watchparty/room/:roomId'] },

  // Auth & profile
  { path: '/auth',                    loader: lz(() => import('../components/DiscordAuth')), seasonalDecor: SEASONAL_DECOR_SCOPES['/auth'] },
  { path: '/auth/google',             loader: lz(() => import('../components/GoogleAuth')), seasonalDecor: SEASONAL_DECOR_SCOPES['/auth/google'] },
  { path: '/oauth/authorize',         loader: lz(() => import('../pages/OAuthAuthorizePage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/oauth/authorize'] },
  // Lien du QR de l'appli télé (/tv?code=K7P2Q) : redirige vers /app-tv#relier
  // en gardant le code. Un seul segment : React Router la sépare de /tv/:id.
  { path: '/tv',                      loader: lz(() => import('../pages/TvLinkRedirect')), seasonalDecor: SEASONAL_DECOR_SCOPES['/tv'] },
  { path: '/profile',                 loader: lz(() => import('../pages/Profile')), guard: 'private', seasonalDecor: SEASONAL_DECOR_SCOPES['/profile'] },
  { path: '/nouveautes',              loader: lz(() => import('../pages/WhatsNewPage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/nouveautes'] },
  { path: '/profile-management',      loader: lz(() => import('../pages/ProfileManagement')), seasonalDecor: SEASONAL_DECOR_SCOPES['/profile-management'] },
  { path: '/alerts',                  loader: lz(() => import('../pages/AlertsPage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/alerts'] },

  // Greenlight

  // VIP
  { path: '/vip',                     loader: lz(() => import('../pages/VipPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/vip'] },
  { path: '/vip/don',                 loader: lz(() => import('../pages/VipDonatePage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/vip/don'] },
  { path: '/vip/invoice/:publicId',   loader: lz(() => import('../pages/VipInvoicePage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/vip/invoice/:publicId'] },
  { path: '/vip/cadeau/:giftToken',   loader: lz(() => import('../pages/VipGiftPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/vip/cadeau/:giftToken'] },

  // Other
  { path: '/about',                   loader: lz(() => import('../pages/WhatIsMovixPage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/about'] },
  { path: '/privacy',                 loader: lz(() => import('../pages/Privacy')), seasonalDecor: SEASONAL_DECOR_SCOPES['/privacy'] },
  { path: '/terms-of-service',        loader: lz(() => import('../pages/TermsOfService')), seasonalDecor: SEASONAL_DECOR_SCOPES['/terms-of-service'] },
  { path: '/wrapped',                 loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/wrapped'] },
  { path: '/wrapped/:year',           loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/wrapped/:year'] },
  { path: '/frais',                   loader: lz(() => import('../pages/CostsPage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/frais'] },
  { path: '/admin',                   loader: lz(() => import('../pages/AdminPage')), tvExcluded: true, seasonalDecor: SEASONAL_DECOR_SCOPES['/admin'] },
  { path: '/download/:type/:id',      loader: lz(() => import('../pages/DownloadPage')), seasonalDecor: SEASONAL_DECOR_SCOPES['/download/:type/:id'] },
];

// Routes montées directement dans App.tsx (donc absentes de ROUTES) mais qui
// ne doivent pas être proposées sur TV. Le centre de contrôle April Fools est
// une parodie : il ne fait pas partie de la console administrative auditable.
const AUXILIARY_TV_EXCLUDED_PATHS = ['/admin-control-center'] as const;

/**
 * Vrai sur TV si `href` pointe vers une route hors périmètre V1 : sert à
 * masquer les entrées de menu qui mèneraient sinon à <NotFound />.
 */
export function isHiddenOnTv(href: string): boolean {
  if (!isTvPlatform()) return false;
  const pathname = href.split(/[?#]/)[0];
  return isPathTvExcluded(ROUTES, href)
    || AUXILIARY_TV_EXCLUDED_PATHS.some((path) => pathname === path);
}
