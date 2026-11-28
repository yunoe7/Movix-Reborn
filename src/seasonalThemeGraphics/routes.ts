/**
 * Politique d'initialisation du moteur graphique par route.
 *
 * Les exclusions sont strictes : sur une route exclue, le moteur n'est pas
 * monté, ne charge aucune configuration et ne crée aucun canvas. Cette liste
 * ne remplace pas `src/routing/registry.tsx` : elle consomme son pathname et
 * ses métadonnées le cas échéant, avec une liste conservatrice pour les routes
 * sensibles qui ne sont pas encore déclarées dans le registre.
 */

export type SeasonalRouteMode = 'none' | 'minimal' | 'full';

export interface SeasonalRouteMetadata {
  allow?: boolean;
  minimal?: boolean;
  suppress?: boolean;
}

const EXCLUDED_PREFIXES = [
  // Lecteurs : VidRift/HLS/DASH, sous-titres, plein écran, PiP, extensions.
  '/watch',
  '/ftv/watch',
  // WatchParty : synchronisation et lecteur partagé.
  '/watchparty',
  // Administration et centre de contrôle parodique.
  '/admin',
  '/admin-control-center',
  // Authentification et consentement OAuth.
  '/auth',
  '/oauth',
  // Paiement, abonnement et facturation.
  '/vip',
  '/payment',
  '/checkout',
  // Pages sensibles / sécurité, récapitulatif personnel et liens de compte.
  '/settings/security',
  '/account/delete',
  '/wrapped',
  '/link-bip39',
  '/profile-selection',
] as const;

const EXCLUDED_EXACT = new Set([
  '/login',
  '/logout',
  '/register',
  '/password/reset',
  '/login-bip39',
  '/create-account',
]);

function pathnameOnly(path: string): string {
  const clean = path.split(/[?#]/)[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean || '/';
}

export function resolveSeasonalRouteMode(
  path: string,
  metadata: SeasonalRouteMetadata = {},
): SeasonalRouteMode {
  const pathname = pathnameOnly(path);

  // Les exclusions sont évaluées avant les métadonnées : `allow: true` ne peut
  // jamais réactiver le moteur sur un lecteur, une admin ou une page de paiement.
  if (EXCLUDED_EXACT.has(pathname)) return 'none';
  if (EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return 'none';
  }

  if (metadata.suppress === true || metadata.allow === false) return 'none';
  if (metadata.minimal === true) return 'minimal';
  return 'full';
}
