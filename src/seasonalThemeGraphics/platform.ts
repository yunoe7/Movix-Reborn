import type { SeasonalMotionMode } from './registry';

/** Détection de contexte d'exécution, sans aucune préférence utilisateur. */

export type SeasonalPlatform = 'desktop' | 'mobile' | 'tablet' | 'tv';

export interface SeasonalPlatformInput {
  viewportWidth?: number;
  userAgent?: string;
  tv?: boolean;
  reducedMotion?: boolean;
}

export function detectPlatform(input: SeasonalPlatformInput = {}): SeasonalPlatform {
  if (input.tv) return 'tv';
  const userAgent = input.userAgent ?? '';
  if (/iphone|ipod|android.*mobile|mobile.*android/i.test(userAgent)) return 'mobile';
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  const width = typeof input.viewportWidth === 'number' ? input.viewportWidth : 1440;
  if (width <= 767) return 'mobile';
  if (width <= 1023) return 'tablet';
  return 'desktop';
}

export function motionPolicy(platform: SeasonalPlatform, reducedMotion: boolean): SeasonalMotionMode {
  if (platform === 'tv') return 'static';
  if (reducedMotion) return 'reduced';
  return 'full';
}
