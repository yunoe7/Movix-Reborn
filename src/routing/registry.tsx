import type { ComponentType, ReactNode } from 'react';
import { lazyWithRetry } from './lazyWithRetry';
import { isPathTvExcluded } from './tvScope';
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
  { path: '/movies',                  loader: lz(() => import('../pages/Movies')),                  fallback: <CatalogSkeleton variant="movies" /> },
  { path: '/anime',                   loader: lz(() => import('../pages/Anime')),                   fallback: <CatalogSkeleton variant="anime" /> },
  { path: '/tv-shows',                loader: lz(() => import('../pages/TVShows')),                 fallback: <CatalogSkeleton variant="tv" /> },
  { path: '/vip/invoices',            loader: lz(() => import('../pages/VipInvoicesPage')), tvExcluded: true },

  // Provider catalogs
  { path: '/provider/:providerId',                          loader: lz(() => import('../pages/ProviderContent')) },
  {
    path: '/provider/:providerId/:type/:genreId?',
    loader: lz(() => import('../pages/ProviderCatalogPage')),
    getComponentKey: (pathname) => getProviderCatalogScope(pathname) ?? pathname,
  },

  // Details pages
  { path: '/movie/:id',               loader: lz(() => import('../pages/MovieDetails')),            fallback: <DetailsSkeleton /> },
  { path: '/tv/:id',                  loader: lz(() => import('../pages/TVDetails')),               fallback: <DetailsSkeleton mediaType="tv" /> },
  { path: '/person/:id',              loader: lz(() => import('../pages/PersonDetails')) },

  // Genre
  { path: '/genre/:mediaType/:genreId', loader: lz(() => import('../pages/GenrePage')) },

  // Search
  { path: '/search',                  loader: lz(() => import('../pages/Search')) },

  // Watch routes (no skeleton — RouteProgressBar fallback)
  { path: '/watch/movie/:tmdbid',                         loader: lz(() => import('../pages/Watch/WatchMovie')) },
  // Version alternative (ex. Encore) : chemin distinct pour remonter le lecteur.
  { path: '/watch/movie/:tmdbid/version/:version',        loader: lz(() => import('../pages/Watch/WatchMovie')) },
  { path: '/watch/tv/:tmdbid/s/:season/e/:episode',       loader: lz(() => import('../pages/Watch/WatchTv')) },
  { path: '/watch/anime/:id/season/:season/episode/:episode', loader: lz(() => import('../pages/Watch/WatchAnime')) },

  // Watch party

  // Auth & profile
  { path: '/auth',                    loader: lz(() => import('../components/DiscordAuth')) },
  { path: '/auth/google',             loader: lz(() => import('../components/GoogleAuth')) },
  { path: '/oauth/authorize',         loader: lz(() => import('../pages/OAuthAuthorizePage')) },
  // Lien du QR de l'appli télé (/tv?code=K7P2Q) : redirige vers /app-tv#relier
  // en gardant le code. Un seul segment : React Router la sépare de /tv/:id.
  { path: '/tv',                      loader: lz(() => import('../pages/TvLinkRedirect')) },
  { path: '/profile',                 loader: lz(() => import('../pages/Profile')), guard: 'private' },
  { path: '/profile-management',      loader: lz(() => import('../pages/ProfileManagement')) },
  { path: '/alerts',                  loader: lz(() => import('../pages/AlertsPage')) },

  // Greenlight

  // VIP
  { path: '/vip',                     loader: lz(() => import('../pages/VipPage')), tvExcluded: true },
  { path: '/vip/don',                 loader: lz(() => import('../pages/VipDonatePage')), tvExcluded: true },
  { path: '/vip/invoice/:publicId',   loader: lz(() => import('../pages/VipInvoicePage')), tvExcluded: true },
  { path: '/vip/cadeau/:giftToken',   loader: lz(() => import('../pages/VipGiftPage')), tvExcluded: true },

  // Other
  { path: '/about',                   loader: lz(() => import('../pages/WhatIsMovixPage')) },
  { path: '/privacy',                 loader: lz(() => import('../pages/Privacy')) },
  { path: '/terms-of-service',        loader: lz(() => import('../pages/TermsOfService')) },
  { path: '/wrapped',                 loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true },
  { path: '/wrapped/:year',           loader: lz(() => import('../pages/WrappedPage')), tvExcluded: true },
  { path: '/frais',                   loader: lz(() => import('../pages/CostsPage')) },
  { path: '/admin',                   loader: lz(() => import('../pages/AdminPage')), tvExcluded: true },
  { path: '/download/:type/:id',      loader: lz(() => import('../pages/DownloadPage')) },
];

/**
 * Vrai sur TV si `href` pointe vers une route hors périmètre V1 : sert à
 * masquer les entrées de menu qui mèneraient sinon à <NotFound />.
 */
export function isHiddenOnTv(href: string): boolean {
  return isTvPlatform() && isPathTvExcluded(ROUTES, href);
}
