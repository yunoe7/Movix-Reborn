import { createContext, useContext } from 'react';
import type { SeasonalGraphicsState } from './engine';

/** État publié du moteur, consommé par App pour neutraliser les anciens thèmes. */

export interface SeasonalGraphicsContextValue {
  state: SeasonalGraphicsState;
  /** Une publication ou une urgence prend l'autorité sur les anciens thèmes. */
  suppressLegacy: boolean;
}

export const IDLE_GRAPHICS_STATE: SeasonalGraphicsState = {
  ready: false,
  active: false,
  override: false,
  reason: 'excluded',
  revision: null,
  emergency: false,
  decorations: [],
  families: [],
  particles: 0,
  frames: 0,
  platform: 'desktop',
};

export const SeasonalGraphicsContext = createContext<SeasonalGraphicsContextValue>({
  state: IDLE_GRAPHICS_STATE,
  suppressLegacy: false,
});

export const useSeasonalGraphics = (): SeasonalGraphicsContextValue => useContext(SeasonalGraphicsContext);
