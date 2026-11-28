import {
  isSeasonalFontKey,
  isSeasonalTypographyEffect,
  SEASONAL_FONT_REGISTRY,
  SEASONAL_TYPOGRAPHY_CATEGORIES,
  type SeasonalFontKey,
  type SeasonalTypographyCategory,
  type SeasonalTypographyEffect,
} from './registry';

/**
 * Projection du résultat du resolver LOT 2 vers les trois catégories autorisées.
 *
 * Aucune priorité, aucun conflit et aucune fenêtre ne sont réévalués ici : les
 * gagnants ont déjà été choisis par le backend. Cette couverture ne fait que
 * valider le catalogue fermé et refuser toute valeur incertaine (fail-closed).
 */

export interface SeasonalTypographySelection {
  fontKey: SeasonalFontKey;
  weight: number;
  effect: SeasonalTypographyEffect;
  decorationId: string | null;
  themeId?: string;
}

export type SeasonalTypographyMap = Record<SeasonalTypographyCategory, SeasonalTypographySelection | null>;

export function emptyTypographyMap(): SeasonalTypographyMap {
  return {
    pageTitle: null,
    sectionTitle: null,
    categoryTitle: null,
  };
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resolveEntry(raw: unknown, category: SeasonalTypographyCategory): SeasonalTypographySelection | null {
  const entry = asPlainObject(raw);
  if (!entry || entry.enabled !== true) return null;
  if (!isSeasonalFontKey(entry.fontKey)) return null;

  const weight = entry.weight;
  if (typeof weight !== 'number' || !Number.isInteger(weight)) return null;
  if (!SEASONAL_FONT_REGISTRY[entry.fontKey].weights.includes(weight)) return null;
  if (!isSeasonalTypographyEffect(entry.effect)) return null;
  if (category === 'categoryTitle' && entry.effect !== 'none') return null;

  return {
    fontKey: entry.fontKey,
    weight,
    effect: entry.effect,
    decorationId: typeof entry.decorationId === 'string' ? entry.decorationId : null,
    ...(typeof entry.themeId === 'string' ? { themeId: entry.themeId } : {}),
  };
}

export function resolveTypographySelections(raw: unknown): SeasonalTypographyMap {
  const source = asPlainObject(raw);
  const result = emptyTypographyMap();
  if (!source) return result;
  for (const category of SEASONAL_TYPOGRAPHY_CATEGORIES) {
    result[category] = resolveEntry(source[category], category);
  }
  return result;
}
