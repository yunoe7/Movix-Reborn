/**
 * Registry fermé du moteur graphique LOT 4A.
 *
 * Les identifiants sont exactement ceux du catalogue backend LOT 2. Ce module
 * ne décide aucune priorité et ne publie rien : il associe une décoration
 * résolue à un rendu graphique et filtre uniquement ce que le contexte courant
 * ne peut pas afficher (TV statique, mouvement réduit, famille non implémentée).
 */

export type SeasonalGraphicsFamily =
  | 'screenDecor' | 'background' | 'components' | 'lights' | 'particles' | 'typography';

export type SeasonalMotionMode = 'full' | 'reduced' | 'static';

export interface SeasonalResolvedDecoration {
  id: string;
  family: string;
  enabled?: boolean;
  options?: Record<string, string | number>;
  typography?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SeasonalGraphicsDefinition {
  id: string;
  family: SeasonalGraphicsFamily;
  animated: boolean;
  staticFallback: boolean;
  particleKind?: 'snow' | 'leaves' | 'candy' | 'spiders' | 'glow';
  assets: readonly string[];
}

export interface SeasonalGraphicsSelection {
  id: string;
  definition: SeasonalGraphicsDefinition;
  decoration: SeasonalResolvedDecoration;
}

const definition = (
  id: string,
  family: SeasonalGraphicsFamily,
  options: Partial<SeasonalGraphicsDefinition> = {},
): SeasonalGraphicsDefinition => ({
  id,
  family,
  animated: false,
  staticFallback: true,
  assets: [],
  ...options,
});

export const SEASONAL_GRAPHICS_REGISTRY: Readonly<Record<string, SeasonalGraphicsDefinition>> = Object.freeze({
  'halloween.screenDecor': definition('halloween.screenDecor', 'screenDecor'),
  'halloween.background': definition('halloween.background', 'background'),
  'halloween.background.fog': definition('halloween.background.fog', 'background', {
    animated: true,
    particleKind: 'spiders',
  }),
  'halloween.components': definition('halloween.components', 'components'),
  'halloween.lights': definition('halloween.lights', 'lights', { animated: true }),
  'halloween.lights.candles': definition('halloween.lights.candles', 'lights', { animated: true }),
  'halloween.particles': definition('halloween.particles', 'particles', {
    animated: true,
    staticFallback: false,
    particleKind: 'spiders',
  }),
  // La famille typographique reste structurelle : le rendu visuel est LOT 4B.
  'halloween.typography': definition('halloween.typography', 'typography'),
  'christmas.screenDecor': definition('christmas.screenDecor', 'screenDecor'),
  'christmas.background': definition('christmas.background', 'background'),
  'christmas.background.snow': definition('christmas.background.snow', 'background', {
    animated: true,
    particleKind: 'snow',
  }),
  'christmas.components': definition('christmas.components', 'components'),
  'christmas.lights': definition('christmas.lights', 'lights', { animated: true }),
  'christmas.particles': definition('christmas.particles', 'particles', {
    animated: true,
    staticFallback: false,
    particleKind: 'snow',
  }),
  'christmas.typography': definition('christmas.typography', 'typography'),
});

export function getGraphicsDefinition(id: string): SeasonalGraphicsDefinition | null {
  return Object.prototype.hasOwnProperty.call(SEASONAL_GRAPHICS_REGISTRY, id)
    ? SEASONAL_GRAPHICS_REGISTRY[id]
    : null;
}

const ASSET_PATTERN = /^\/assets\/seasonal-theme\/[a-z0-9][a-z0-9._/-]{0,180}$/;

/**
 * Seules les images publiées et conformes à la politique d'assets du catalogue
 * peuvent être demandées. Une option absente ou invalide ne charge rien.
 */
export function isAllowedSeasonalAsset(path: unknown): string | null {
  if (typeof path !== 'string' || !ASSET_PATTERN.test(path)) return null;
  const segments = path.slice('/assets/seasonal-theme/'.length).split('/');
  // Le préfixe autorisé ne suffit pas : refuser aussi les traversées internes,
  // les segments vides et les séparateurs encodés ou alternatifs.
  if (segments.length === 0 || segments.some((segment) => (
    segment.length === 0 || segment === '.' || segment === '..'
  ))) return null;
  return path;
}

/**
 * Filtre le résultat du resolver sans le retrier. L'ordre reçu reste celui du
 * backend, qui a déjà appliqué priorités, conflits, dépendances et fenêtres.
 */
export function selectGraphicsDecorations(
  decorations: readonly SeasonalResolvedDecoration[],
  options: { motion: SeasonalMotionMode },
): SeasonalGraphicsSelection[] {
  const selected: SeasonalGraphicsSelection[] = [];
  const seen = new Set<string>();
  for (const decoration of decorations) {
    if (!decoration || typeof decoration !== 'object') continue;
    if (typeof decoration.id !== 'string' || decoration.enabled === false) continue;
    if (seen.has(decoration.id)) continue;
    const found = getGraphicsDefinition(decoration.id);
    if (!found) continue;
    if (options.motion !== 'full' && found.animated && !found.staticFallback) continue;
    seen.add(decoration.id);
    selected.push({ id: decoration.id, definition: found, decoration });
  }
  return selected;
}
