/**
 * Registre fermé des polices typographiques autorisées par le catalogue LOT 2.
 *
 * Les familles, graisses et licences reproduisent exactement
 * `API/Mainapi/shared/seasonalThemeCatalog.json`. Aucune police arbitraire ne
 * peut entrer dans le moteur : le resolver est l'autorité, ce registre ne fait
 * que vérifier les valeurs reçues et résoudre un fichier local déjà vendored.
 */

export const SEASONAL_TYPOGRAPHY_CATEGORIES = ['pageTitle', 'sectionTitle', 'categoryTitle'] as const;
export type SeasonalTypographyCategory = typeof SEASONAL_TYPOGRAPHY_CATEGORIES[number];

export const SEASONAL_FONT_KEYS = ['inter', 'creepster', 'archivo-black'] as const;
export type SeasonalFontKey = typeof SEASONAL_FONT_KEYS[number];
export type SeasonalTypographyEffect = 'none' | 'glow' | 'frost';

export interface SeasonalFontSource {
  subset: 'latin';
  url: string;
  /** Couverture réelle du fichier, inspirée des feuilles Fontsource embarquées. */
  unicodeRange: string;
}

export interface SeasonalFontDefinition {
  key: SeasonalFontKey;
  family: string;
  weights: readonly number[];
  license: 'OFL-1.1';
  files: Readonly<Record<number, readonly SeasonalFontSource[]>>;
}

const LATIN_UNICODE_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,' +
  'U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

const BASE = '/fonts/seasonal-theme';

function source(fileName: string): readonly SeasonalFontSource[] {
  return [{ subset: 'latin', url: `${BASE}/${fileName}`, unicodeRange: LATIN_UNICODE_RANGE }];
}

function interFiles(weights: readonly number[]): Readonly<Record<number, readonly SeasonalFontSource[]>> {
  return Object.fromEntries(weights.map((weight) => [weight, source(`inter-latin-${weight}-normal.woff2`)]));
}

export const SEASONAL_FONT_REGISTRY: Readonly<Record<SeasonalFontKey, SeasonalFontDefinition>> = {
  inter: {
    key: 'inter',
    family: 'Inter',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL-1.1',
    files: interFiles([400, 500, 600, 700, 800, 900]),
  },
  creepster: {
    key: 'creepster',
    family: 'Creepster',
    weights: [400],
    license: 'OFL-1.1',
    // Creepster ne publie que le sous-ensemble latin. Les accents français
    // courants (U+00C0-00FF) et l'apostrophe typographique y sont inclus.
    files: { 400: source('creepster-latin-400-normal.woff2') },
  },
  'archivo-black': {
    key: 'archivo-black',
    family: 'Archivo Black',
    weights: [400],
    license: 'OFL-1.1',
    files: { 400: source('archivo-black-latin-400-normal.woff2') },
  },
};

export function isSeasonalFontKey(value: unknown): value is SeasonalFontKey {
  return typeof value === 'string'
    && (SEASONAL_FONT_KEYS as readonly string[]).includes(value);
}

export function isSeasonalTypographyCategory(value: unknown): value is SeasonalTypographyCategory {
  return typeof value === 'string'
    && (SEASONAL_TYPOGRAPHY_CATEGORIES as readonly string[]).includes(value);
}

export function isSeasonalTypographyEffect(value: unknown): value is SeasonalTypographyEffect {
  return value === 'none' || value === 'glow' || value === 'frost';
}

export function fontSourcesFor(key: SeasonalFontKey, weight: number): readonly SeasonalFontSource[] {
  return SEASONAL_FONT_REGISTRY[key]?.files[weight] ?? [];
}

export function fontSourceFor(
  key: string,
  weight: number,
  subset: SeasonalFontSource['subset'] = 'latin',
): string | null {
  if (!isSeasonalFontKey(key)) return null;
  return fontSourcesFor(key, weight).find((item) => item.subset === subset)?.url ?? null;
}

export function fontFamilyFor(key: SeasonalFontKey): string {
  return SEASONAL_FONT_REGISTRY[key].family;
}
