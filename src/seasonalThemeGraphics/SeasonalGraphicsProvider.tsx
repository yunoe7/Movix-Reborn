import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useLightMode } from '../context/LightModeContext';
import { resolveSeasonalTheme } from '../services/seasonalThemeAdminService';
import type { SeasonalResolver } from './loader';
import { SeasonalGraphicsEngine, type SeasonalGraphicsState } from './engine';
import { detectPlatform } from './platform';
import { resolveSeasonalRouteMode } from './routes';
import { IDLE_GRAPHICS_STATE, SeasonalGraphicsContext } from './context';
import './seasonalGraphics.css';

/**
 * Point de montage unique du moteur. Sur une route exclue, ni le calque ni le
 * canvas ne sont rendus : aucun listener, aucun appel réseau, aucun asset.
 */

export interface SeasonalGraphicsContextValue {
  state: SeasonalGraphicsState;
  /** Une publication ou une urgence prend l'autorité sur les anciens thèmes. */
  suppressLegacy: boolean;
}

const IDLE_STATE = IDLE_GRAPHICS_STATE;

function sameState(a: SeasonalGraphicsState, b: SeasonalGraphicsState): boolean {
  return a.ready === b.ready && a.active === b.active && a.override === b.override
    && a.reason === b.reason && a.revision === b.revision && a.emergency === b.emergency
    && a.particles === b.particles && a.families.join(',') === b.families.join(',')
    && a.decorations.join(',') === b.decorations.join(',');
}

export interface SeasonalGraphicsProviderProps {
  children: ReactNode;
  /** Surcharge injectée par les harnais ; l'application utilise le resolver public. */
  resolve?: SeasonalResolver;
}

export const SeasonalGraphicsProvider = ({ children, resolve = resolveSeasonalTheme }: SeasonalGraphicsProviderProps) => {
  const { pathname } = useLocation();
  const { effectivePrefs, systemReducedMotion } = useLightMode();
  const mode = useMemo(() => resolveSeasonalRouteMode(pathname), [pathname]);
  const [state, setState] = useState<SeasonalGraphicsState>(IDLE_STATE);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onState = useCallback((next: SeasonalGraphicsState) => {
    setState((previous) => sameState(previous, next) ? previous : next);
  }, []);

  useEffect(() => {
    if (mode === 'none') {
      setState(IDLE_STATE);
      return;
    }
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const reduced = systemReducedMotion || effectivePrefs.transitions === false
      || effectivePrefs.bgAnimations === false;
    const engine = new SeasonalGraphicsEngine({
      root,
      canvas,
      resolve,
      platform: detectPlatform({
        viewportWidth: window.innerWidth,
        tv: document.documentElement.classList.contains('tv-mode'),
      }),
      reducedMotion: reduced,
      mode,
      onState,
    });
    engine.start();
    return () => engine.destroy();
  }, [mode, resolve, systemReducedMotion, effectivePrefs.transitions, effectivePrefs.bgAnimations, onState]);

  const value = useMemo<SeasonalGraphicsContextValue>(() => ({
    state,
    suppressLegacy: mode !== 'none' && (state.active || state.emergency),
  }), [state, mode]);

  return (
    <SeasonalGraphicsContext.Provider value={value}>
      {children}
      {mode !== 'none' && (
        <div ref={rootRef} className="sg-root" data-seasonal-graphics-layer aria-hidden="true">
          <canvas ref={canvasRef} className="sg-particles" aria-hidden="true" />
        </div>
      )}
    </SeasonalGraphicsContext.Provider>
  );
};
