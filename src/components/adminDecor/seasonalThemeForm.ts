import {
  SEASONAL_THEME_CATALOG,
  SEASONAL_THEME_CAPABILITIES,
  SEASONAL_THEME_EFFECTS,
  SEASONAL_THEME_FAMILIES,
  SEASONAL_THEME_FONTS,
  SEASONAL_THEME_PLATFORMS,
  SEASONAL_THEME_TYPOGRAPHY_CATEGORIES,
  type SeasonalThemeConfig,
  type SeasonalThemeStatus,
  type SeasonalThemeTypographySetting,
} from '../../services/seasonalThemeAdminService';

/* Outils de l'éditeur Décoratif. Le serveur valide de nouveau toute valeur :
 * ces contrôles évitent seulement d'envoyer un patch invalide ou de prétendre
 * qu'une modification locale est déjà publiée. */

export interface SeasonalThemeIssue {
  code: string;
  path: string;
  message: string;
}

export interface SeasonalThemeSummary {
  themesConfigured: number;
  themesPublished: number;
  themesActive: number;
  decorationsEnabled: number;
  revision: number;
  lastPublication: string | null;
  lastModification: string | null;
  emergency: boolean;
  syncState: 'ok' | 'warning' | 'error' | 'unknown';
  upcomingWindows: Array<{ themeId: string; start: string; end: string; timezone: string }>;
}

export interface SeasonalThemePreview {
  source: 'draft';
  published: false;
  platform: string;
  capabilities: string[];
  at: string;
  themes: SeasonalThemeConfig['themes'];
  typography: SeasonalThemeConfig['typography'];
  sample: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ROOT_READ_ONLY = new Set(['version', 'revision', 'updatedAt', 'updatedBy', 'emergencyDisable']);

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = stable(value[key]);
  return sorted;
}

export function seasonalThemeFingerprint(value: unknown): string {
  return JSON.stringify(stable(value));
}

export function sameSeasonalThemeConfig(a: unknown, b: unknown): boolean {
  return seasonalThemeFingerprint(a) === seasonalThemeFingerprint(b);
}

export function cloneSeasonalThemeConfig(config: SeasonalThemeConfig): SeasonalThemeConfig {
  return clone(config);
}

function changed(a: unknown, b: unknown): boolean {
  return seasonalThemeFingerprint(a) !== seasonalThemeFingerprint(b);
}

function diffByIdArray(
  base: unknown[],
  draft: unknown[],
): unknown[] | undefined {
  const before = new Map<string, Record<string, unknown>>();
  for (const item of base) {
    if (isPlainObject(item) && typeof item.id === 'string') before.set(item.id, item);
  }
  const result: Record<string, unknown>[] = [];
  for (const item of draft) {
    if (!isPlainObject(item) || typeof item.id !== 'string') {
      result.push(clone(item) as Record<string, unknown>);
      continue;
    }
    const original = before.get(item.id);
    if (!original) {
      result.push(clone(item));
      continue;
    }
    const patch = diffPlain(original, item, new Set(['id']));
    if (patch && Object.keys(patch).length > 0) result.push({ id: item.id, ...patch });
  }
  return result.length > 0 ? result : undefined;
}

function diffPlain(
  base: Record<string, unknown>,
  draft: Record<string, unknown>,
  skip: Set<string>,
): Record<string, unknown> | undefined {
  if (!changed(base, draft)) return undefined;
  const result: Record<string, unknown> = {};
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(draft)])).sort();
  for (const key of keys) {
    if (skip.has(key)) continue;
    const before = base[key];
    const after = draft[key];
    if (!changed(before, after)) continue;
    if ((key === 'themes' || key === 'decorations')
        && Array.isArray(before) && Array.isArray(after)) {
      const items = diffByIdArray(before, after);
      if (items) result[key] = items;
      continue;
    }
    if (isPlainObject(before) && isPlainObject(after)) {
      const nested = diffPlain(before, after, new Set());
      if (nested && Object.keys(nested).length > 0) result[key] = nested;
      continue;
    }
    result[key] = clone(after);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Patch partiel attendu par `mergeConfig` : aucune métadonnée serveur, aucune urgence. */
export function buildSeasonalThemePatch(
  base: SeasonalThemeConfig,
  draft: SeasonalThemeConfig,
): Record<string, unknown> {
  return diffPlain(base as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>, ROOT_READ_ONLY) ?? {};
}

function mergePlain(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = clone(current);
  for (const [key, value] of Object.entries(patch)) {
    if ((key === 'themes' || key === 'decorations') && Array.isArray(value)) {
      const target = Array.isArray(result[key]) ? result[key] as unknown[] : [];
      result[key] = mergeByIdArray(target, value);
      continue;
    }
    const before = result[key];
    if (isPlainObject(before) && isPlainObject(value)) {
      result[key] = mergePlain(before, value);
      continue;
    }
    result[key] = clone(value);
  }
  return result;
}

function mergeByIdArray(current: unknown[], patch: unknown[]): unknown[] {
  const result = current.map((item) => clone(item));
  const indexById = new Map<string, number>();
  result.forEach((item, index) => {
    if (isPlainObject(item) && typeof item.id === 'string') indexById.set(item.id, index);
  });
  for (const entry of patch) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') {
      result.push(clone(entry));
      continue;
    }
    const index = indexById.get(entry.id);
    if (index === undefined) {
      result.push(clone(entry));
      continue;
    }
    const target = result[index];
    result[index] = isPlainObject(target) ? mergePlain(target, entry) : clone(entry);
  }
  return result;
}

export function applySeasonalThemePatch(
  config: SeasonalThemeConfig,
  patch: Record<string, unknown>,
): SeasonalThemeConfig {
  return mergePlain(config as unknown as Record<string, unknown>, patch) as unknown as SeasonalThemeConfig;
}

/** Reprend la révision distante en conservant les modifications locales. */
export function mergeSeasonalThemeRemote(
  base: SeasonalThemeConfig,
  local: SeasonalThemeConfig,
  remote: SeasonalThemeConfig,
): SeasonalThemeConfig {
  const localPatch = buildSeasonalThemePatch(base, local);
  return applySeasonalThemePatch(remote, localPatch);
}

function validTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

function issue(code: string, path: string, message: string): SeasonalThemeIssue {
  return { code, path, message };
}

function validateFlagMap(
  value: Record<string, boolean>,
  allowed: readonly string[],
  path: string,
  issues: SeasonalThemeIssue[],
  unknownCode: 'UNKNOWN_PLATFORM' | 'UNKNOWN_CAPABILITY',
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      issues.push(issue(unknownCode, `${path}.${key}`, `Clé inconnue : ${key}`));
      continue;
    }
    if (typeof value[key] !== 'boolean') {
      issues.push(issue('INVALID_BOOLEAN', `${path}.${key}`, 'Valeur booléenne attendue'));
    }
  }
  for (const key of allowed) {
    if (typeof value[key] !== 'boolean') {
      issues.push(issue('MISSING_FLAG', `${path}.${key}`, `Drapeau requis : ${key}`));
    }
  }
}

function validateTypographySetting(
  value: SeasonalThemeTypographySetting,
  category: string,
  path: string,
  issues: SeasonalThemeIssue[],
): void {
  const font = SEASONAL_THEME_FONTS.find((item) => item.key === value.fontKey);
  if (!font) {
    issues.push(issue('UNKNOWN_FONT', `${path}.fontKey`, `Police inconnue : ${value.fontKey}`));
  } else if (!font.weights.includes(value.weight)) {
    issues.push(issue('INVALID_WEIGHT', `${path}.weight`, `Graisse indisponible pour ${font.family}`));
  }
  if (!SEASONAL_THEME_EFFECTS.includes(value.effect as never)) {
    issues.push(issue('UNKNOWN_EFFECT', `${path}.effect`, `Effet inconnu : ${value.effect}`));
  } else if (category === 'categoryTitle' && value.effect !== 'none') {
    issues.push(issue('EFFECT_SCOPE', `${path}.effect`, 'categoryTitle n’accepte que l’effet none'));
  }
}

export function validateSeasonalThemeDraft(config: SeasonalThemeConfig): SeasonalThemeIssue[] {
  const issues: SeasonalThemeIssue[] = [];
  const knownThemes = new Set(SEASONAL_THEME_CATALOG.themes.map((item) => item.id));
  const knownDecorations = new Map(SEASONAL_THEME_CATALOG.decorations.map((item) => [item.id, item]));

  for (const theme of config.themes) {
    const themePath = `themes.${theme.id}`;
    if (!knownThemes.has(theme.id)) {
      issues.push(issue('UNKNOWN_THEME', `${themePath}.id`, `Thème inconnu : ${theme.id}`));
    }
    if (!Number.isInteger(theme.priority)
        || theme.priority < SEASONAL_THEME_CATALOG.limits.priorityMin
        || theme.priority > SEASONAL_THEME_CATALOG.limits.priorityMax) {
      issues.push(issue('INVALID_PRIORITY', `${themePath}.priority`, 'Priorité hors limites'));
    }
    validateFlagMap(theme.platforms, SEASONAL_THEME_PLATFORMS, `${themePath}.platforms`, issues, 'UNKNOWN_PLATFORM');
    validateFlagMap(theme.capabilities, SEASONAL_THEME_CAPABILITIES, `${themePath}.capabilities`, issues, 'UNKNOWN_CAPABILITY');
    if (theme.windows.length > SEASONAL_THEME_CATALOG.limits.maxWindowsPerTheme) {
      issues.push(issue('TOO_MANY_WINDOWS', `${themePath}.windows`, 'Trop de fenêtres de programmation'));
    }
    for (const [index, window] of theme.windows.entries()) {
      const path = `${themePath}.windows[${index}]`;
      const validDates = DATE_PATTERN.test(window.start) && DATE_PATTERN.test(window.end)
        && !Number.isNaN(Date.parse(`${window.start}T00:00:00Z`))
        && !Number.isNaN(Date.parse(`${window.end}T00:00:00Z`));
      if (!validDates) {
        issues.push(issue('INVALID_DATE', path, 'Dates attendues au format AAAA-MM-JJ'));
      } else if (window.start >= window.end) {
        issues.push(issue('INVALID_RANGE', path, 'La date de début doit précéder la date de fin'));
      }
      if (!validTimezone(window.timezone)) {
        issues.push(issue('INVALID_TIMEZONE', `${path}.timezone`, 'Fuseau horaire explicite requis'));
      }
    }

    for (const decoration of theme.decorations) {
      const path = `${themePath}.decorations.${decoration.id}`;
      const known = knownDecorations.get(decoration.id);
      if (!known || known.themeId !== theme.id) {
        issues.push(issue('UNKNOWN_DECORATION', `${path}.id`, `Décoration inconnue : ${decoration.id}`));
      } else if (!SEASONAL_THEME_FAMILIES.includes(decoration.family as never) || decoration.family !== known.family) {
        issues.push(issue('UNKNOWN_FAMILY', `${path}.family`, 'Famille non autorisée pour cette décoration'));
      }
      if (!Number.isInteger(decoration.priority)
          || decoration.priority < SEASONAL_THEME_CATALOG.limits.priorityMin
          || decoration.priority > SEASONAL_THEME_CATALOG.limits.priorityMax) {
        issues.push(issue('INVALID_PRIORITY', `${path}.priority`, 'Priorité hors limites'));
      }
      for (const conflict of decoration.conflictsWith) {
        if (!known?.conflictsWith.includes(conflict)) {
          issues.push(issue('UNKNOWN_DECORATION', `${path}.conflictsWith`, `Conflit inconnu : ${conflict}`));
        }
      }
      for (const required of decoration.requires) {
        if (!knownDecorations.has(required) || required === decoration.id) {
          issues.push(issue('UNKNOWN_DECORATION', `${path}.requires`, `Dépendance inconnue : ${required}`));
        }
      }
      validateFlagMap(decoration.platforms, SEASONAL_THEME_PLATFORMS, `${path}.platforms`, issues, 'UNKNOWN_PLATFORM');
      validateFlagMap(decoration.capabilities, SEASONAL_THEME_CAPABILITIES, `${path}.capabilities`, issues, 'UNKNOWN_CAPABILITY');
      for (const platform of SEASONAL_THEME_PLATFORMS) {
        if (decoration.platforms[platform] && known && !known.allowedPlatforms.includes(platform)) {
          issues.push(issue('UNSUPPORTED_PLATFORM', `${path}.platforms.${platform}`, 'Plateforme non prise en charge'));
        }
      }
      for (const capability of SEASONAL_THEME_CAPABILITIES) {
        if (decoration.capabilities[capability] && known && !known.allowedCapabilities.includes(capability)) {
          issues.push(issue('UNSUPPORTED_CAPABILITY', `${path}.capabilities.${capability}`, 'Capacité non prise en charge'));
        }
      }
      for (const [key, value] of Object.entries(decoration.options)) {
        if (!known?.optionKeys.includes(key)) {
          issues.push(issue('UNKNOWN_OPTION', `${path}.options.${key}`, `Option inconnue : ${key}`));
          continue;
        }
        if (key === 'assetPath') {
          if (typeof value !== 'string' || !value.startsWith(SEASONAL_THEME_CATALOG.assetPrefix)) {
            issues.push(issue('EXTERNAL_ASSET_REJECTED', `${path}.options.${key}`, 'Chemin local attendu'));
          }
        } else if (typeof value !== 'number' || value < 0 || value > 1000) {
          issues.push(issue('INVALID_OPTION', `${path}.options.${key}`, 'Nombre attendu entre 0 et 1000'));
        }
      }
      if (known?.family !== 'typography' && Object.keys(decoration.typography).length > 0) {
        issues.push(issue('EFFECT_SCOPE', `${path}.typography`, 'Typographie réservée à la famille typography'));
      }
      for (const [category, setting] of Object.entries(decoration.typography)) {
        if (!SEASONAL_THEME_TYPOGRAPHY_CATEGORIES.includes(category as never)) {
          issues.push(issue('UNKNOWN_CATEGORY', `${path}.typography.${category}`, 'Catégorie inconnue'));
          continue;
        }
        validateTypographySetting(setting, category, `${path}.typography.${category}`, issues);
      }
    }
  }

  for (const [category, setting] of Object.entries(config.typography)) {
    if (!SEASONAL_THEME_TYPOGRAPHY_CATEGORIES.includes(category as never)) {
      issues.push(issue('UNKNOWN_CATEGORY', `typography.${category}`, 'Catégorie inconnue'));
      continue;
    }
    validateTypographySetting(setting, category, `typography.${category}`, issues);
  }

  return issues;
}

export function summarizeSeasonalThemeConfig(
  config: SeasonalThemeConfig,
  status: SeasonalThemeStatus,
  now: Date,
): SeasonalThemeSummary {
  const today = now.toISOString().slice(0, 10);
  const isActive = (windows: SeasonalThemeConfig['themes'][number]['windows']) => windows.length === 0
    || windows.some((window) => window.start <= today && today <= window.end);
  const upcomingWindows = config.themes
    .flatMap((theme) => theme.windows
      .filter((window) => window.end >= today)
      .map((window) => ({ themeId: theme.id, ...window })))
    .sort((a, b) => a.start.localeCompare(b.start) || a.themeId.localeCompare(b.themeId));
  const decorationsEnabled = config.themes.reduce(
    (total, theme) => total + theme.decorations.filter((decoration) => decoration.enabled).length,
    0,
  );
  const syncState: SeasonalThemeSummary['syncState'] = status.failClosed || status.emergency
    ? 'error'
    : status.subscribed && status.localRevision === config.revision
      ? 'ok'
      : 'unknown';

  return {
    themesConfigured: config.themes.length,
    themesPublished: config.revision > 0 ? config.themes.filter((theme) => theme.enabled).length : 0,
    themesActive: config.emergencyDisable
      ? 0
      : config.themes.filter((theme) => theme.enabled && isActive(theme.windows)).length,
    decorationsEnabled,
    revision: config.revision,
    lastPublication: config.updatedAt,
    lastModification: config.updatedAt,
    emergency: config.emergencyDisable || status.emergency,
    syncState,
    upcomingWindows,
  };
}

/** Aperçu structurel : copie du brouillon, sans appel réseau ni effet public. */
export function buildSeasonalThemePreview(
  draft: SeasonalThemeConfig,
  context: { platform: string; capabilities: string[]; at: string },
): SeasonalThemePreview {
  return {
    source: 'draft',
    published: false,
    platform: context.platform,
    capabilities: [...context.capabilities],
    at: context.at,
    themes: clone(draft.themes),
    typography: clone(draft.typography),
    sample: 'Titre de démonstration — contenu neutre',
  };
}
