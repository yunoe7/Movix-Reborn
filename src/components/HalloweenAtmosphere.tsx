import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { useLightMode } from '@/context/LightModeContext';
import { resolveSeasonalRouteMode } from '@/seasonalThemeGraphics/routes';
import { HALLOWEEN_ENABLED_ATTR, HALLOWEEN_THEME_CLASS, useHalloweenTheme } from '@/hooks/useHalloweenTheme';
import { loadHalloweenTheme } from '@/utils/halloweenThemeAssets';
import type { HalloweenPageKind } from './halloween/HalloweenDecor';

const NoDecor = (_props: { pageKind: HalloweenPageKind }) => null;

// Décor téléchargé à la demande : rien ne part tant que le thème est coupé.
// Un échec réseau laisse simplement le site sans décor, sans faire tomber
// l'application.
const HalloweenDecor = lazy<ComponentType<{ pageKind: HalloweenPageKind }>>(async () => {
  try {
    return await import('./halloween/HalloweenDecor');
  } catch {
    return { default: NoDecor };
  }
});

/** Famille de couleurs de la brume selon la page. */
const pageKind = (path: string): HalloweenPageKind => {
  if (/^\/(movie|tv)\//.test(path)) return 'details';
  if (path === '/' || ['/movies', '/tv-shows', '/anime'].includes(path) || path.startsWith('/provider/')) return 'home';
  return 'other';
};

/**
 * Thème Halloween : pose la classe qui recolore la palette, charge
 * l'habillage de l'interface et monte le décor plein écran. `suspended`
 * coupe tout sur les lecteurs et le Wrapped. Reste volontairement léger :
 * ce composant est chargé pour tout le monde, thème actif ou non.
 */
export const HalloweenAtmosphere = ({ suspended }: { suspended: boolean }) => {
  const enabled = useHalloweenTheme();
  const { isLightMode } = useLightMode();
  const { pathname } = useLocation();
  const active = enabled && !suspended;
  // Les exclusions LOT 4A s'appliquent aussi à l'ambiance historique : un
  // thème Halloween activé globalement ne doit pas charger Creepster sur une
  // route exclue (auth, paiement, admin, lecteur, profil…).
  const routeAllowed = resolveSeasonalRouteMode(pathname) !== 'none';

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle(HALLOWEEN_THEME_CLASS, active);
    // Réglage activé, même sur les lecteurs : la popup pub s'y habille aussi.
    if (enabled) root.setAttribute(HALLOWEEN_ENABLED_ATTR, '');
    else root.removeAttribute(HALLOWEEN_ENABLED_ATTR);
  }, [active, enabled]);

  useEffect(() => {
    // La police n'est chargée que si l'ambiance est réellement affichée :
    // jamais sur une route exclue ni quand une publication LOT 4 prend l'autorité.
    if (active && routeAllowed) loadHalloweenTheme();
  }, [active, routeAllowed]);

  // Le mode léger garde les couleurs et l'habillage, mais pas le décor :
  // plusieurs couches plein écran coûtent trop cher aux petits appareils.
  if (!active || isLightMode) return null;

  return (
    <Suspense fallback={null}>
      <HalloweenDecor pageKind={pageKind(pathname)} />
    </Suspense>
  );
};
