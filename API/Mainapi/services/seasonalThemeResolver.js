'use strict';

/**
 * Résolution déterministe de la configuration décorative publiée.
 *
 * Cette couche est pure : elle ne lit ni Redis ni MySQL. Elle transforme une
 * configuration administrative (source de vérité) en une vue effective pour
 * un contexte donné (plateforme, capacités, date). La résolution complète est
 * indépendante de l'ordre dans lequel les décorations sont reçues.
 */

const {
  SEASONAL_THEME_CATALOG,
  validateConfig,
} = require('./seasonalThemeConfig');

function compareDecorations(a, b) {
  if (b.themePriority !== a.themePriority) return b.themePriority - a.themePriority;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

function dateInTimeZone(now, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

function isThemeWindowActive(theme, now) {
  if (!Array.isArray(theme.windows) || theme.windows.length === 0) return true;
  return theme.windows.some((window) => {
    const day = dateInTimeZone(now, window.timezone);
    return Boolean(day) && day >= window.start && day < window.end;
  });
}

function collectCandidates(config, context, cat) {
  const platform = context.platform || 'desktop';
  const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];
  const candidates = [];
  for (const theme of config.themes) {
    if (!theme.enabled || !isThemeWindowActive(theme, context.now)) continue;
    for (const decoration of theme.decorations) {
      if (!decoration.enabled) continue;
      if (decoration.platforms[platform] !== true) continue;
      if (capabilities.some((capability) => decoration.capabilities[capability] !== true)) continue;
      candidates.push({
        id: decoration.id,
        themeId: theme.id,
        family: decoration.family,
        themePriority: theme.priority,
        priority: decoration.priority,
        conflictsWith: [...decoration.conflictsWith],
        requires: [...decoration.requires],
        options: { ...decoration.options },
        typography: decoration.typography ? { ...decoration.typography } : {},
      });
    }
  }
  return candidates;
}

function resolveConflicts(candidates) {
  const accepted = [];
  for (const candidate of [...candidates].sort(compareDecorations)) {
    const conflict = accepted.some((entry) => (
      candidate.conflictsWith.includes(entry.id) || entry.conflictsWith.includes(candidate.id)
    ));
    if (!conflict) accepted.push(candidate);
  }
  return accepted;
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => entry.id === b[index].id);
}

function applyRequirements(candidates) {
  const ids = new Set(candidates.map((entry) => entry.id));
  return candidates.filter((entry) => entry.requires.every((required) => ids.has(required)));
}

function resolveTypography(config, active, cat) {
  const winners = active
    .filter((entry) => entry.family === 'typography')
    .sort(compareDecorations);

  return Object.fromEntries(cat.typographyCategories.map((category) => {
    const fallback = { enabled: false, fontKey: 'inter', weight: 400, effect: 'none', ...config.typography[category] };
    const winner = winners.find((entry) => entry.typography[category] && entry.typography[category].enabled !== false);
    if (!winner) return [category, { decorationId: null, ...fallback }];
    const entry = winner.typography[category];
    return [category, {
      decorationId: winner.id,
      themeId: winner.themeId,
      enabled: true,
      fontKey: entry.fontKey,
      weight: entry.weight,
      effect: entry.effect || 'none',
    }];
  }));
}

function disabledResult(config, context, cat) {
  return {
    emergencyDisable: true,
    resolvedAt: context.now.toISOString(),
    platform: context.platform || 'desktop',
    capabilities: Array.isArray(context.capabilities) ? [...context.capabilities] : [],
    themes: [],
    decorations: [],
    families: Object.fromEntries(cat.families.map((family) => [family, []])),
    typography: Object.fromEntries(cat.typographyCategories.map((category) => [
      category,
      { decorationId: null, enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    ])),
  };
}

/**
 * @param {object} config configuration administrative validée
 * @param {{ now?: Date|string|number, platform?: string, capabilities?: string[] }} context
 * @param {object} [cat] catalogue fermé
 */
function resolveSeasonalTheme(config, context = {}, cat = SEASONAL_THEME_CATALOG) {
  validateConfig(config, cat);
  const now = context.now instanceof Date
    ? context.now
    : new Date(context.now === undefined ? Date.now() : context.now);
  if (Number.isNaN(now.getTime())) throw new Error('Horloge invalide pour la résolution décorative');
  const resolvedContext = { ...context, now };

  if (config.emergencyDisable) return disabledResult(config, resolvedContext, cat);

  let active = collectCandidates(config, resolvedContext, cat);
  // Requirements et conflits ne font que retirer des candidats : la boucle
  // converge et reste stable même si l'ordre réseau des thèmes change.
  for (let pass = 0; pass <= active.length; pass += 1) {
    const next = resolveConflicts(applyRequirements(active));
    if (sameIds(next, active)) break;
    active = next;
  }

  const families = Object.fromEntries(cat.families.map((family) => [family, []]));
  for (const entry of active) families[entry.family].push(entry.id);

  return {
    emergencyDisable: false,
    revision: config.revision,
    resolvedAt: now.toISOString(),
    platform: resolvedContext.platform || 'desktop',
    capabilities: Array.isArray(resolvedContext.capabilities) ? [...resolvedContext.capabilities] : [],
    themes: config.themes
      .filter((theme) => active.some((entry) => entry.themeId === theme.id))
      .map((theme) => ({ id: theme.id, priority: theme.priority })),
    decorations: active,
    families,
    typography: resolveTypography(config, active, cat),
  };
}

module.exports = {
  resolveSeasonalTheme,
  isThemeWindowActive,
  compareDecorations,
};
