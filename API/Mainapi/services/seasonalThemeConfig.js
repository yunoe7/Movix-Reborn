'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_PATH = path.join(__dirname, '..', 'shared', 'seasonalThemeCatalog.json');
const SETTINGS_ID = 1;
// Identifiants canoniques : le premier segment est en minuscules ; les
// segments séparés par `.` ou `-` peuvent conserver le camelCase des familles
// (`halloween.screenDecor`, `categoryTitle`).
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._:@/ -]{1,200}$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const DEFAULT_CATALOG = deepFreeze(JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')));

class SeasonalThemeValidationError extends Error {
  constructor(code, detail) {
    super(`Validation décorative saisonnière invalide (${code}) : ${detail}`);
    this.name = 'SeasonalThemeValidationError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail) {
  throw new SeasonalThemeValidationError(code, detail);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, where) {
  if (!isPlainObject(value)) fail('INVALID_OBJECT', `${where} doit être un objet`);
}

function assertAllowedKeys(value, allowed, where) {
  assertPlainObject(value, where);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNKNOWN_KEY', `${where}.${key} n’existe pas dans le catalogue`);
  }
}

function assertBoolean(value, where) {
  if (typeof value !== 'boolean') fail('INVALID_BOOLEAN', `${where} doit être un booléen`);
}

function assertInteger(value, min, max, where) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('INVALID_NUMBER', `${where} doit être un entier entre ${min} et ${max}`);
  }
}

function assertId(value, where) {
  if (typeof value !== 'string' || value.length > 64 || !ID_PATTERN.test(value)) {
    fail('INVALID_ID', `${where} n’est pas un identifiant valide`);
  }
}

function assertLocaleAssetPath(value, where, cat) {
  if (typeof value !== 'string') fail('INVALID_ASSET', `${where} doit être une chaîne`);
  const { prefix, pattern, maxBytes } = cat.assetPolicy;
  if (!value.startsWith(prefix) || !new RegExp(pattern).test(value) || value.length > 200) {
    fail('EXTERNAL_ASSET_REJECTED', `${where} doit être un chemin local sous ${prefix}`);
  }
  if (value.includes('..') || value.includes('//') || value.includes('\\') || /[?#]/.test(value)
      || /^(?:https?:)?\/\//i.test(value) || /[<>{}()'"]/.test(value)) {
    fail('EXTERNAL_ASSET_REJECTED', `${where} contient une séquence interdite`);
  }
  void maxBytes;
}

function assertNoMarkup(value, where) {
  if (typeof value !== 'string') return;
  if (/[<>]|javascript:|data:|vbscript:|expression\s*\(|@import|\\u003c|\\u003e/i.test(value)) {
    fail('MARKUP_REJECTED', `${where} contient du HTML/CSS/JS arbitraire`);
  }
}

function assertSafeLabel(value, where) {
  if (value === null) return;
  if (typeof value !== 'string' || !SAFE_LABEL_PATTERN.test(value)) {
    fail('INVALID_LABEL', `${where} contient des caractères interdits`);
  }
}

function validateTimezone(timezone, where) {
  if (typeof timezone !== 'string' || timezone.length > 64) fail('INVALID_TIMEZONE', `${where} invalide`);
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone;
    if (!resolved) fail('INVALID_TIMEZONE', `${where} inconnu`);
  } catch {
    fail('INVALID_TIMEZONE', `${where} inconnu`);
  }
}

function validateDate(value, where) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) fail('INVALID_DATE', `${where} doit être AAAA-MM-JJ`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail('INVALID_DATE', `${where} n’est pas une date calendaire valide`);
  }
}

function validateWindow(window, where, cat) {
  assertAllowedKeys(window, ['start', 'end', 'timezone'], where);
  validateDate(window.start, `${where}.start`);
  validateDate(window.end, `${where}.end`);
  if (window.start >= window.end) fail('INVALID_RANGE', `${where}.start doit précéder end`);
  validateTimezone(window.timezone, `${where}.timezone`);
  void cat;
}

function validateFlagMap(value, allowed, required, where) {
  assertAllowedKeys(value, allowed, where);
  for (const key of required) {
    if (typeof value[key] !== 'boolean') fail('INVALID_BOOLEAN', `${where}.${key} doit être un booléen`);
  }
  for (const [key, enabled] of Object.entries(value)) {
    if (enabled === true && !allowed.includes(key)) fail('UNKNOWN_KEY', `${where}.${key} n’est pas autorisé`);
  }
}

function validateOptions(options, catalogDecoration, where, cat) {
  const allowed = catalogDecoration.optionKeys;
  assertAllowedKeys(options, allowed, where);
  for (const [key, value] of Object.entries(options)) {
    const target = `${where}.${key}`;
    if (key === 'assetPath') {
      assertLocaleAssetPath(value, target, cat);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
      fail('INVALID_OPTION', `${target} doit être un nombre entre 0 et 1000`);
    }
  }
}

function buildFlagMap(all, enabled) {
  return Object.fromEntries(all.map((key) => [key, enabled.includes(key)]));
}

function validateTypographyMap(value, where, cat, { partial = false } = {}) {
  assertAllowedKeys(value, cat.typographyCategories, where);
  const fontsByKey = new Map(cat.fonts.map((font) => [font.key, font]));
  for (const [category, entry] of Object.entries(value)) {
    const target = `${where}.${category}`;
    assertPlainObject(entry, target);
    assertAllowedKeys(entry, ['enabled', 'fontKey', 'weight', 'effect'], target);
    if (!partial || 'enabled' in entry) assertBoolean(entry.enabled, `${target}.enabled`);
    if (!partial || 'fontKey' in entry) {
      assertNoMarkup(entry.fontKey, `${target}.fontKey`);
      assertId(entry.fontKey, `${target}.fontKey`);
      if (!fontsByKey.has(entry.fontKey)) fail('UNKNOWN_FONT', `${target}.fontKey inconnu ${entry.fontKey}`);
    }
    if (!partial || 'weight' in entry) {
      const font = fontsByKey.get(entry.fontKey);
      if (!font || !font.weights.includes(entry.weight)) {
        fail('INVALID_WEIGHT', `${target}.weight non disponible pour ${entry.fontKey}`);
      }
    }
    if (!partial || 'effect' in entry) {
      if (!cat.effects.includes(entry.effect)) fail('UNKNOWN_EFFECT', `${target}.effet inconnu ${entry.effect}`);
      if (category === 'categoryTitle' && entry.effect !== 'none') {
        fail('EFFECT_SCOPE', `${target} n’accepte que l’effet none`);
      }
    }
  }
}

function mergeTypographyMap(current, patch, where, cat) {
  validateTypographyMap(patch, where, cat, { partial: true });
  const next = { ...current };
  for (const [category, entry] of Object.entries(patch)) {
    next[category] = { ...(next[category] || {}), ...entry };
  }
  validateTypographyMap(next, where, cat);
  return next;
}

function buildDefaultConfig(cat = DEFAULT_CATALOG) {
  return {
    version: cat.version,
    revision: 0,
    emergencyDisable: false,
    themes: cat.themes.map((theme) => ({
      id: theme.id,
      enabled: false,
      priority: theme.priority,
      platforms: buildFlagMap(cat.platforms, cat.platforms),
      capabilities: buildFlagMap(cat.capabilities, cat.capabilities),
      windows: [],
      decorations: cat.decorations
        .filter((decoration) => decoration.themeId === theme.id)
        .map((decoration) => ({
          id: decoration.id,
          family: decoration.family,
          enabled: false,
          priority: decoration.priority,
          conflictsWith: [...decoration.conflictsWith],
          requires: [...(decoration.requires || [])],
          platforms: buildFlagMap(cat.platforms, decoration.allowedPlatforms),
          capabilities: buildFlagMap(cat.capabilities, decoration.allowedCapabilities),
          options: {},
          typography: decoration.typography
            ? Object.fromEntries(cat.typographyCategories.map((category) => [category, {
              enabled: true,
              fontKey: decoration.typography[category].fontKey,
              weight: decoration.typography[category].weight,
              effect: decoration.typography[category].effect || 'none',
            }]))
            : {},
        })),
    })),
    typography: Object.fromEntries(cat.typographyCategories.map((category) => [
      category,
      { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    ])),
    updatedAt: null,
    updatedBy: null,
  };
}

function validateConfig(config, cat = DEFAULT_CATALOG) {
  assertPlainObject(config, 'config');
  assertAllowedKeys(config, ['version', 'revision', 'emergencyDisable', 'themes', 'typography', 'updatedAt', 'updatedBy'], 'config');
  if (config.version !== cat.version) fail('VERSION_MISMATCH', `version attendue ${cat.version}`);
  if (!Number.isInteger(config.revision) || config.revision < 0 || config.revision > 1_000_000_000) {
    fail('INVALID_REVISION', 'config.revision doit être un entier positif');
  }
  assertBoolean(config.emergencyDisable, 'config.emergencyDisable');
  assertSafeLabel(config.updatedBy, 'config.updatedBy');
  if (config.updatedAt !== null
    && (typeof config.updatedAt !== 'string' || Number.isNaN(Date.parse(config.updatedAt)))) {
    fail('INVALID_DATE', 'config.updatedAt doit être une date ISO');
  }

  if (!Array.isArray(config.themes)) fail('INVALID_THEMES', 'config.themes doit être une liste');
  const seenThemes = new Set();
  const knownThemes = new Map(cat.themes.map((theme) => [theme.id, theme]));
  const knownDecorations = new Map(cat.decorations.map((decoration) => [decoration.id, decoration]));

  for (const theme of config.themes) {
    assertPlainObject(theme, 'theme');
    assertAllowedKeys(theme, ['id', 'enabled', 'priority', 'platforms', 'capabilities', 'windows', 'decorations'], 'theme');
    assertId(theme.id, 'theme.id');
    if (!knownThemes.has(theme.id)) fail('UNKNOWN_THEME', `thème inconnu ${theme.id}`);
    if (seenThemes.has(theme.id)) fail('DUPLICATE_THEME', `thème dupliqué ${theme.id}`);
    seenThemes.add(theme.id);
    assertBoolean(theme.enabled, `theme(${theme.id}).enabled`);
    assertInteger(theme.priority, cat.limits.priorityMin, cat.limits.priorityMax, `theme(${theme.id}).priority`);
    validateFlagMap(theme.platforms, cat.platforms, cat.platforms, `theme(${theme.id}).platforms`);
    validateFlagMap(theme.capabilities, cat.capabilities, cat.capabilities, `theme(${theme.id}).capabilities`);

    if (!Array.isArray(theme.windows) || theme.windows.length > cat.limits.maxWindowsPerTheme) {
      fail('INVALID_WINDOWS', `theme(${theme.id}).windows dépasse la limite`);
    }
    for (const [index, window] of theme.windows.entries()) {
      validateWindow(window, `theme(${theme.id}).windows[${index}]`, cat);
    }

    if (!Array.isArray(theme.decorations)) fail('INVALID_DECORATIONS', `theme(${theme.id}).decorations doit être une liste`);
    const seenDecorations = new Set();
    for (const decoration of theme.decorations) {
      assertPlainObject(decoration, 'decoration');
      assertAllowedKeys(decoration, ['id', 'family', 'enabled', 'priority', 'conflictsWith', 'requires', 'platforms', 'capabilities', 'options', 'typography'], 'decoration');
      assertId(decoration.id, 'decoration.id');
      const known = knownDecorations.get(decoration.id);
      if (!known || known.themeId !== theme.id) fail('UNKNOWN_DECORATION', `décoration inconnue ${decoration.id}`);
      if (decoration.family !== known.family || !cat.families.includes(decoration.family)) {
        fail('UNKNOWN_FAMILY', `famille inconnue ${decoration.family} pour ${decoration.id}`);
      }
      if (seenDecorations.has(decoration.id)) fail('DUPLICATE_DECORATION', `décoration dupliquée ${decoration.id}`);
      seenDecorations.add(decoration.id);
      const where = `decoration(${decoration.id})`;
      assertBoolean(decoration.enabled, `${where}.enabled`);
      assertInteger(decoration.priority, cat.limits.priorityMin, cat.limits.priorityMax, `${where}.priority`);
      if (!Array.isArray(decoration.conflictsWith)) fail('INVALID_CONFLICTS', `${where}.conflictsWith doit être une liste`);
      for (const conflict of decoration.conflictsWith) {
        if (!knownDecorations.has(conflict) || !known.conflictsWith.includes(conflict)) {
          fail('UNKNOWN_DECORATION', `${where}.conflictsWith contient ${conflict}`);
        }
      }
      if (!Array.isArray(decoration.requires)) fail('INVALID_REQUIRES', `${where}.requires doit être une liste`);
      for (const required of decoration.requires) {
        assertId(required, `${where}.requires[]`);
        if (!knownDecorations.has(required) || required === decoration.id) {
          fail('UNKNOWN_DECORATION', `${where}.requires contient ${required}`);
        }
      }
      if (known.family !== 'typography' && Object.keys(decoration.typography).length > 0) {
        fail('EFFECT_SCOPE', `${where}.typography n’est autorisé que pour la famille typography`);
      }
      validateTypographyMap(decoration.typography, `${where}.typography`, cat);
      validateFlagMap(decoration.platforms, cat.platforms, cat.platforms, `${where}.platforms`);
      validateFlagMap(decoration.capabilities, cat.capabilities, cat.capabilities, `${where}.capabilities`);
      validateOptions(decoration.options, known, `${where}.options`, cat);
      for (const platform of cat.platforms) {
        if (decoration.platforms[platform] && !known.allowedPlatforms.includes(platform)) {
          fail('UNSUPPORTED_PLATFORM', `${where}.platforms.${platform} n’est pas autorisé`);
        }
      }
      for (const capability of cat.capabilities) {
        if (decoration.capabilities[capability] && !known.allowedCapabilities.includes(capability)) {
          fail('UNSUPPORTED_CAPABILITY', `${where}.capabilities.${capability} n’est pas autorisé`);
        }
      }
    }
  }

  assertAllowedKeys(config.typography, cat.typographyCategories, 'config.typography');
  const knownFonts = new Set(cat.fonts.map((font) => font.key));
  const fontsByKey = new Map(cat.fonts.map((font) => [font.key, font]));
  for (const category of cat.typographyCategories) {
    const entry = config.typography[category];
    const where = `typography.${category}`;
    assertPlainObject(entry, where);
    assertAllowedKeys(entry, ['enabled', 'fontKey', 'weight', 'effect'], where);
    assertBoolean(entry.enabled, `${where}.enabled`);
    if (!knownFonts.has(entry.fontKey)) fail('UNKNOWN_FONT', `${where}.fontKey inconnu ${entry.fontKey}`);
    const font = fontsByKey.get(entry.fontKey);
    if (!font.weights.includes(entry.weight)) fail('INVALID_WEIGHT', `${where}.weight non disponible pour ${entry.fontKey}`);
    if (!cat.effects.includes(entry.effect)) fail('UNKNOWN_EFFECT', `${where}.effet inconnu ${entry.effect}`);
    if (category === 'categoryTitle' && entry.effect !== 'none') {
      fail('EFFECT_SCOPE', `${where} n’accepte que l’effet none`);
    }
    assertNoMarkup(entry.fontKey, `${where}.fontKey`);
  }

  return config;
}

function resolveThemeId(value, cat) {
  assertId(value, 'patch.themes[].id');
  const theme = cat.themes.find((item) => item.id === value || item.aliases.includes(value));
  if (!theme) fail('UNKNOWN_THEME', `thème inconnu ${value}`);
  return theme.id;
}

function mergeFlagMap(current, patch, allowed, where) {
  assertAllowedKeys(patch, allowed, where);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    assertBoolean(value, `${where}.${key}`);
    next[key] = value;
  }
  return next;
}

function mergeDecorations(current, patch, cat) {
  if (!Array.isArray(patch)) fail('INVALID_DECORATIONS', 'patch.decorations doit être une liste');
  const byId = new Map(current.map((item) => [item.id, item]));
  const known = new Map(cat.decorations.map((item) => [item.id, item]));
  for (const entry of patch) {
    assertPlainObject(entry, 'patch.decoration');
    assertAllowedKeys(entry, ['id', 'family', 'enabled', 'priority', 'conflictsWith', 'requires', 'platforms', 'capabilities', 'options', 'typography'], 'patch.decoration');
    assertId(entry.id, 'patch.decoration.id');
    if (!byId.has(entry.id) || !known.has(entry.id)) fail('UNKNOWN_DECORATION', `décoration inconnue ${entry.id}`);
    const target = byId.get(entry.id);
    const catalogEntry = known.get(entry.id);
    const where = `patch.decoration(${entry.id})`;
    if ('family' in entry) {
      if (typeof entry.family !== 'string' || !cat.families.includes(entry.family) || entry.family !== catalogEntry.family) {
        fail('UNKNOWN_FAMILY', `${where}.family n’appartient pas au catalogue fermé`);
      }
    }
    if ('enabled' in entry) { assertBoolean(entry.enabled, `${where}.enabled`); target.enabled = entry.enabled; }
    if ('priority' in entry) { assertInteger(entry.priority, cat.limits.priorityMin, cat.limits.priorityMax, `${where}.priority`); target.priority = entry.priority; }
    if ('conflictsWith' in entry) {
      if (!Array.isArray(entry.conflictsWith)) fail('INVALID_CONFLICTS', `${where}.conflictsWith doit être une liste`);
      for (const conflict of entry.conflictsWith) assertId(conflict, `${where}.conflictsWith[]`);
      target.conflictsWith = [...entry.conflictsWith];
    }
    if ('requires' in entry) {
      if (!Array.isArray(entry.requires)) fail('INVALID_REQUIRES', `${where}.requires doit être une liste`);
      for (const required of entry.requires) assertId(required, `${where}.requires[]`);
      target.requires = [...entry.requires];
    }
    if ('typography' in entry) {
      target.typography = mergeTypographyMap(target.typography, entry.typography, `${where}.typography`, cat);
    }
    if ('platforms' in entry) target.platforms = mergeFlagMap(target.platforms, entry.platforms, cat.platforms, `${where}.platforms`);
    if ('capabilities' in entry) target.capabilities = mergeFlagMap(target.capabilities, entry.capabilities, cat.capabilities, `${where}.capabilities`);
    if ('options' in entry) {
      assertAllowedKeys(entry.options, known.get(entry.id).optionKeys, `${where}.options`);
      target.options = { ...target.options, ...entry.options };
    }
  }
  return current;
}

function mergeThemes(current, patch, cat) {
  if (!Array.isArray(patch)) fail('INVALID_THEMES', 'patch.themes doit être une liste');
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const entry of patch) {
    assertPlainObject(entry, 'patch.theme');
    assertAllowedKeys(entry, ['id', 'enabled', 'priority', 'platforms', 'capabilities', 'windows', 'decorations'], 'patch.theme');
    const id = resolveThemeId(entry.id, cat);
    const target = byId.get(id);
    if (!target) fail('UNKNOWN_THEME', `thème absent de la configuration ${id}`);
    const where = `patch.theme(${id})`;
    if ('enabled' in entry) { assertBoolean(entry.enabled, `${where}.enabled`); target.enabled = entry.enabled; }
    if ('priority' in entry) { assertInteger(entry.priority, cat.limits.priorityMin, cat.limits.priorityMax, `${where}.priority`); target.priority = entry.priority; }
    if ('platforms' in entry) target.platforms = mergeFlagMap(target.platforms, entry.platforms, cat.platforms, `${where}.platforms`);
    if ('capabilities' in entry) target.capabilities = mergeFlagMap(target.capabilities, entry.capabilities, cat.capabilities, `${where}.capabilities`);
    if ('windows' in entry) {
      if (!Array.isArray(entry.windows) || entry.windows.length > cat.limits.maxWindowsPerTheme) {
        fail('INVALID_WINDOWS', `${where}.windows dépasse la limite`);
      }
      for (const [index, window] of entry.windows.entries()) validateWindow(window, `${where}.windows[${index}]`, cat);
      target.windows = entry.windows.map((window) => ({ ...window }));
    }
    if ('decorations' in entry) mergeDecorations(target.decorations, entry.decorations, cat);
  }
  return current;
}

function mergeTypography(current, patch, cat) {
  assertAllowedKeys(patch, cat.typographyCategories, 'patch.typography');
  for (const [category, entry] of Object.entries(patch)) {
    const where = `patch.typography.${category}`;
    assertAllowedKeys(entry, ['enabled', 'fontKey', 'weight', 'effect'], where);
    const target = current[category];
    if ('enabled' in entry) { assertBoolean(entry.enabled, `${where}.enabled`); target.enabled = entry.enabled; }
    if ('fontKey' in entry) {
      assertNoMarkup(entry.fontKey, `${where}.fontKey`);
      assertId(entry.fontKey, `${where}.fontKey`);
      target.fontKey = entry.fontKey;
    }
    if ('weight' in entry) { assertInteger(entry.weight, 100, 900, `${where}.weight`); target.weight = entry.weight; }
    if ('effect' in entry) {
      assertId(entry.effect, `${where}.effect`);
      target.effect = entry.effect;
    }
  }
  return current;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fusionne un patch partiel sans écraser l'état non mentionné. */
function mergeConfig(current, patch, cat = DEFAULT_CATALOG) {
  assertPlainObject(current, 'config');
  assertPlainObject(patch, 'patch');
  const next = clone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'emergencyDisable') { assertBoolean(value, 'patch.emergencyDisable'); next.emergencyDisable = value; }
    else if (key === 'themes') mergeThemes(next.themes, value, cat);
    else if (key === 'typography') mergeTypography(next.typography, value, cat);
    else if (key === 'updatedAt' || key === 'updatedBy' || key === 'version' || key === 'revision') continue;
    else fail('UNKNOWN_KEY', `patch.${key} n’est pas modifiable`);
  }
  return next;
}

function parseStoredConfig(raw, cat = DEFAULT_CATALOG) {
  let stored;
  try {
    stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return buildDefaultConfig(cat);
  }
  if (!isPlainObject(stored)) return buildDefaultConfig(cat);
  try {
    const restored = mergeConfig(buildDefaultConfig(cat), stored, cat);
    restored.revision = Number.isInteger(stored.revision) ? stored.revision : 0;
    restored.updatedAt = stored.updatedAt ?? null;
    restored.updatedBy = stored.updatedBy ?? null;
    return validateConfig(restored, cat);
  } catch {
    return buildDefaultConfig(cat);
  }
}

function safeActorLabel(actor) {
  const raw = actor?.adminId || actor?.userId || 'system';
  const cleaned = String(raw).replace(/[^A-Za-z0-9._:@/ -]/g, '_').slice(0, 200);
  return cleaned || 'system';
}

function auditActor(actor) {
  const raw = String(actor?.userType || 'oauth');
  const authType = raw === 'bip39' || raw === 'bip-39' ? 'bip-39' : 'oauth';
  return {
    adminId: String(actor?.adminId || actor?.userId || 'system').slice(0, 128),
    adminAuthType: authType.slice(0, 16),
  };
}

function createSeasonalThemeService(options = {}) {
  const {
    pool,
    catalog: cat = DEFAULT_CATALOG,
    now = () => new Date(),
    logger = console,
  } = options;
  if (!pool || typeof pool.execute !== 'function') {
    throw new Error('Pool MySQL invalide pour le service décoratif saisonnier');
  }

  async function initialize() {
    const config = buildDefaultConfig(cat);
    validateConfig(config, cat);
    await pool.execute(
      'INSERT IGNORE INTO seasonal_theme_settings (id, settings_json, updated_by) VALUES (?, ?, NULL)',
      [SETTINGS_ID, JSON.stringify(config)],
    );
    return config;
  }

  async function getConfig() {
    const [rows] = await pool.execute(
      'SELECT settings_json, updated_by, updated_at FROM seasonal_theme_settings WHERE id = ? LIMIT 1',
      [SETTINGS_ID],
    );
    if (!Array.isArray(rows) || rows.length === 0) return buildDefaultConfig(cat);
    return parseStoredConfig(rows[0].settings_json, cat);
  }

  async function persist(config, actor, action, reason, target) {
    const details = JSON.stringify({
      reason: String(reason || '').slice(0, 120),
      revision: config.revision,
      emergencyDisable: config.emergencyDisable,
      themes: config.themes.map((theme) => ({ id: theme.id, enabled: theme.enabled })),
    });
    const actorInfo = auditActor(actor);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'UPDATE seasonal_theme_settings SET settings_json = ?, updated_by = ? WHERE id = ?',
        [JSON.stringify(config), safeActorLabel(actor), SETTINGS_ID],
      );
      await connection.execute(
        'INSERT INTO seasonal_theme_settings_history (settings_id, settings_json, changed_by, change_reason) VALUES (?, ?, ?, ?)',
        [SETTINGS_ID, JSON.stringify(config), safeActorLabel(actor), String(reason || '').slice(0, 120) || null],
      );
      await connection.execute(
        'INSERT INTO seasonal_theme_audit_log (admin_id, admin_auth_type, action, target, details_json) VALUES (?, ?, ?, ?, ?)',
        [actorInfo.adminId, actorInfo.adminAuthType, action, target ? String(target).slice(0, 128) : null, details],
      );
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch { /* transaction déjà rompue */ }
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Construit la prochaine révision sans toucher à la source de vérité. */
  function buildUpdatedConfig(current, patch, actor) {
    const next = mergeConfig(current, patch, cat);
    next.revision = (Number.isInteger(current.revision) ? current.revision : 0) + 1;
    next.updatedAt = now().toISOString();
    next.updatedBy = safeActorLabel(actor);
    validateConfig(next, cat);
    return next;
  }

  /** Persiste une révision déjà construite et validée (utilisé par la synchro). */
  async function applyConfig(next, actor, reason, action = 'settings.update') {
    assertNoMarkup(reason, 'reason');
    validateConfig(next, cat);
    await persist(next, actor, action, reason, 'seasonal_theme_settings:1');
    if (logger?.info) {
      logger.info('[SeasonalTheme] configuration mise à jour', { by: next.updatedBy || safeActorLabel(actor) });
    }
    return next;
  }

  async function updateConfig(patch, actor, reason, options = {}) {
    assertNoMarkup(reason, 'reason');
    const current = await getConfig();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      fail('REVISION_CONFLICT', `révision attendue ${options.expectedRevision}, révision courante ${current.revision}`);
    }
    const next = buildUpdatedConfig(current, patch, actor);
    return applyConfig(next, actor, reason, options.action || 'settings.update');
  }

  async function setEmergencyDisable(enabled, actor, reason) {
    assertBoolean(enabled, 'emergencyDisable');
    return updateConfig({ emergencyDisable: enabled }, actor, reason || 'emergency-disable');
  }

  async function getHistory({ limit = 20 } = {}) {
    assertInteger(limit, 1, 100, 'limit');
    const [rows] = await pool.execute(
      'SELECT id, settings_json, changed_by, change_reason, created_at FROM seasonal_theme_settings_history WHERE settings_id = ? ORDER BY id DESC LIMIT ?',
      [SETTINGS_ID, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      config: parseStoredConfig(row.settings_json, cat),
      changedBy: row.changed_by,
      reason: row.change_reason,
      changedAt: row.created_at,
    }));
  }

  async function getAuditLog({ limit = 50 } = {}) {
    assertInteger(limit, 1, 100, 'limit');
    const [rows] = await pool.execute(
      'SELECT id, admin_id, admin_auth_type, action, target, details_json, created_at FROM seasonal_theme_audit_log ORDER BY id DESC LIMIT ?',
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      adminId: row.admin_id,
      adminAuthType: row.admin_auth_type,
      action: row.action,
      target: row.target,
      details: typeof row.details_json === 'string' ? JSON.parse(row.details_json) : row.details_json,
      createdAt: row.created_at,
    }));
  }

  return {
    initialize,
    getConfig,
    updateConfig,
    setEmergencyDisable,
    buildUpdatedConfig,
    applyConfig,
    getHistory,
    getAuditLog,
    catalog: cat,
  };
}

module.exports = {
  SETTINGS_ID,
  SeasonalThemeValidationError,
  SEASONAL_THEME_CATALOG: DEFAULT_CATALOG,
  buildDefaultConfig,
  validateConfig,
  mergeConfig,
  parseStoredConfig,
  createSeasonalThemeService,
};
