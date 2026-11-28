'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SEASONAL_THEME_CATALOG,
  buildDefaultConfig,
  createSeasonalThemeService,
  mergeConfig,
  parseStoredConfig,
  validateConfig,
} = require('../seasonalThemeConfig');

// Journal attendu : chaque mutation valide écrit `[SeasonalTheme] ...`.
test.mock.method(console, 'info', () => {});

const SAVED_AT = '2026-11-28T12:00:00.000Z';
const ADMIN = { adminId: 'staff-42', userId: 'admin-42', userType: 'oauth' };

function createFakePool({ row = null } = {}) {
  const state = {
    row: row
      ? { settings_json: JSON.stringify(row), updated_by: 'seed', updated_at: new Date(SAVED_AT) }
      : null,
    history: [],
    audit: [],
    queries: [],
    connections: 0,
    commits: 0,
    rollbacks: 0,
    transactions: 0,
  };

  const connection = {
    async beginTransaction() { state.transactions += 1; },
    async execute(sql, params = []) {
      state.queries.push({ sql, params: [...params] });
      if (/^\s*UPDATE seasonal_theme_settings/i.test(sql)) {
        state.row = {
          settings_json: params[0],
          updated_by: params[1],
          updated_at: new Date(SAVED_AT),
        };
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_settings_history/i.test(sql)) {
        state.history.push({
          id: state.history.length + 1,
          settings_json: params[1],
          changed_by: params[2],
          change_reason: params[3],
          created_at: new Date(SAVED_AT),
        });
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_audit_log/i.test(sql)) {
        state.audit.push({
          id: state.audit.length + 1,
          admin_id: params[0],
          admin_auth_type: params[1],
          action: params[2],
          target: params[3],
          details_json: params[4],
          created_at: new Date(SAVED_AT),
        });
        return { affectedRows: 1 };
      }
      throw new Error(`Requête transactionnelle inattendue : ${sql}`);
    },
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() {},
  };

  const pool = {
    async execute(sql, params = []) {
      state.queries.push({ sql, params: [...params] });
      if (/INSERT IGNORE INTO seasonal_theme_settings/i.test(sql)) {
        if (!state.row) {
          state.row = {
            settings_json: params[1],
            updated_by: null,
            updated_at: new Date(SAVED_AT),
          };
          return { affectedRows: 1 };
        }
        return { affectedRows: 0 };
      }
      if (/^\s*SELECT settings_json, updated_by, updated_at/i.test(sql)) {
        return [state.row ? [state.row] : [], []];
      }
      if (/FROM seasonal_theme_settings_history/i.test(sql)) {
        const limit = params[1];
        const rows = state.history.slice(0, limit).map((entry) => ({
          id: entry.id,
          settings_json: entry.settings_json,
          changed_by: entry.changed_by,
          change_reason: entry.change_reason,
          created_at: entry.created_at,
        }));
        return [rows, []];
      }
      if (/FROM seasonal_theme_audit_log/i.test(sql)) {
        const limit = params[0];
        const rows = state.audit.slice(0, limit).map((entry) => ({
          id: entry.id,
          admin_id: entry.admin_id,
          admin_auth_type: entry.admin_auth_type,
          action: entry.action,
          target: entry.target,
          details_json: entry.details_json,
          created_at: entry.created_at,
        }));
        return [rows, []];
      }
      throw new Error(`Requête inattendue : ${sql}`);
    },
    async getConnection() {
      state.connections += 1;
      return connection;
    },
  };

  return { pool, state };
}

async function assertRejectedCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `code attendu ${code}, reçu ${error.code}`);
    return true;
  });
}

// ---------------------------------------------------------------------------

test('la configuration initiale est désactivée et sûre', () => {
  const config = buildDefaultConfig();
  validateConfig(config);
  assert.equal(config.emergencyDisable, false);
  assert.deepEqual(config.themes.map((theme) => theme.id), ['halloween-2026', 'christmas-2026']);
  assert.equal(config.themes.every((theme) => theme.enabled === false), true);
  assert.equal(config.themes.every((theme) => theme.decorations.every((item) => item.enabled === false)), true);
  assert.deepEqual(Object.keys(config.typography), SEASONAL_THEME_CATALOG.typographyCategories);
  assert.equal(Object.values(config.typography).every((entry) => (
    entry.enabled === false && entry.fontKey === 'inter' && entry.effect === 'none'
  )), true);
});

test('initialize() crée une ligne par défaut une seule fois', async () => {
  const { pool, state } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  const first = await service.initialize();
  const second = await service.initialize();
  assert.equal(first.emergencyDisable, false);
  assert.equal(second.emergencyDisable, false);
  assert.equal(state.queries.filter((entry) => /INSERT IGNORE/.test(entry.sql)).length, 2);
  assert.equal(state.row.settings_json, JSON.stringify(buildDefaultConfig()));
});

test('plusieurs thèmes et plusieurs décorations d’une même famille peuvent être Actifs', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();
  const config = await service.updateConfig({
    themes: [
      {
        id: 'halloween-2026',
        enabled: true,
        decorations: [
          {
            id: 'halloween.background',
            enabled: true,
            options: { assetPath: '/assets/seasonal-theme/halloween/background.webp' },
          },
          { id: 'halloween.background.fog', enabled: true, options: { opacity: 45 } },
          { id: 'halloween.lights.candles', enabled: true },
        ],
      },
      {
        id: 'christmas-2026',
        enabled: true,
        decorations: [{ id: 'christmas.background.snow', enabled: true, options: { density: 30 } }],
      },
    ],
  }, ADMIN, 'deux décorations simultanées');

  const halloween = config.themes.find((theme) => theme.id === 'halloween-2026');
  const backgrounds = halloween.decorations.filter((item) => item.family === 'background');
  assert.equal(halloween.enabled, true);
  assert.equal(backgrounds.length >= 2, true);
  assert.equal(backgrounds.every((item) => item.enabled), true);
  assert.deepEqual(backgrounds.map((item) => item.id), ['halloween.background', 'halloween.background.fog']);
  assert.equal(config.themes.find((theme) => theme.id === 'christmas-2026').enabled, true);
  assert.ok(!('activeThemeId' in config));
});

test('un patch partiel conserve l’état non mentionné', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();
  await service.updateConfig({
    themes: [{ id: 'halloween', enabled: true, decorations: [{ id: 'halloween.particles', enabled: true }] }],
  }, ADMIN, 'activer halloween');

  const config = await service.getConfig();
  const christmas = config.themes.find((theme) => theme.id === 'christmas-2026');
  assert.equal(christmas.enabled, false);
  assert.equal(christmas.decorations.every((item) => item.enabled === false), true);
  assert.equal(config.typography.pageTitle.enabled, false);
  assert.equal(config.emergencyDisable, false);
  assert.equal(config.themes.find((theme) => theme.id === 'halloween-2026').decorations.find(
    (item) => item.id === 'halloween.background',
  ).enabled, false);
});

test('emergencyDisable est prioritaire et ne détruit pas la configuration', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();
  await service.updateConfig({
    themes: [{ id: 'halloween-2026', enabled: true }],
  }, ADMIN, 'publication halloween');
  const disabled = await service.setEmergencyDisable(true, ADMIN, 'arrêt d’urgence');

  assert.equal(disabled.emergencyDisable, true);
  assert.equal(disabled.themes.find((theme) => theme.id === 'halloween-2026').enabled, true);
  const reread = await service.getConfig();
  assert.equal(reread.emergencyDisable, true);
  assert.equal(reread.themes.find((theme) => theme.id === 'halloween-2026').enabled, true);
});

test('les identifiants, familles et polices inconnus sont rejetés', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();

  await assertRejectedCode(service.updateConfig({ themes: [{ id: 'Halloween!' }] }, ADMIN), 'INVALID_ID');
  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', decorations: [{ id: 'halloween.background', family: 'lights' }] }],
  }, ADMIN), 'UNKNOWN_FAMILY');
  await assertRejectedCode(service.updateConfig({
    typography: { pageTitle: { fontKey: 'comic-sans' } },
  }, ADMIN), 'UNKNOWN_FONT');
  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', decorations: [{ id: 'unknown.decor' }] }],
  }, ADMIN), 'UNKNOWN_DECORATION');
});

test('les URLs externes et le CSS/HTML/JS arbitraire sont rejetés', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();

  await assertRejectedCode(service.updateConfig({
    themes: [{
      id: 'halloween-2026',
      decorations: [{ id: 'halloween.background', options: { assetPath: 'https://cdn.example/bg.webp' } }],
    }],
  }, ADMIN), 'EXTERNAL_ASSET_REJECTED');
  await assertRejectedCode(service.updateConfig({
    typography: { pageTitle: { fontKey: '<style>body{color:red}</style>' } },
  }, ADMIN), 'MARKUP_REJECTED');
  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', decorations: [{ id: 'halloween.background', customCss: 'body{}' }] }],
  }, ADMIN), 'UNKNOWN_KEY');
});

test('les dates et fuseaux horaires sont validés', async () => {
  const { pool } = createFakePool();
  const service = createSeasonalThemeService({ pool });
  await service.initialize();

  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', windows: [{ start: '2026-13-40', end: '2026-11-01', timezone: 'Europe/Paris' }] }],
  }, ADMIN), 'INVALID_DATE');
  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', windows: [{ start: '2026-10-01', end: '2026-11-01', timezone: 'Mars/Phobos' }] }],
  }, ADMIN), 'INVALID_TIMEZONE');
  await assertRejectedCode(service.updateConfig({
    themes: [{ id: 'halloween-2026', windows: [{ start: '2026-11-02', end: '2026-11-01', timezone: 'Europe/Paris' }] }],
  }, ADMIN), 'INVALID_RANGE');
});

test('historique et audit attribuent la mutation à l’administrateur', async () => {
  const { pool, state } = createFakePool();
  const service = createSeasonalThemeService({ pool, now: () => new Date(SAVED_AT) });
  await service.initialize();
  await service.setEmergencyDisable(true, ADMIN, 'arrêt manuel');

  assert.equal(state.connections, 1);
  assert.equal(state.transactions, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 0);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].changed_by, 'staff-42');
  assert.equal(state.history[0].change_reason, 'arrêt manuel');
  assert.equal(state.audit[0].admin_id, 'staff-42');
  assert.equal(state.audit[0].admin_auth_type, 'oauth');
  assert.equal(state.audit[0].action, 'settings.update');
  assert.equal(state.audit[0].target, 'seasonal_theme_settings:1');

  const history = await service.getHistory({ limit: 5 });
  const audit = await service.getAuditLog({ limit: 5 });
  assert.equal(history[0].config.emergencyDisable, true);
  assert.equal(audit[0].adminId, 'staff-42');
});

test('une configuration stockée corrompue retombe sur les valeurs par défaut', () => {
  const fallback = parseStoredConfig('{"settings_json":');
  assert.deepEqual(fallback, buildDefaultConfig());
  const partial = parseStoredConfig({ version: 1, emergencyDisable: true });
  assert.equal(partial.emergencyDisable, true);
  assert.equal(partial.themes.every((theme) => theme.enabled === false), true);
});

test('la typographie d’une décoration reste un catalogue fermé', () => {
  assert.throws(
    () => mergeConfig(buildDefaultConfig(), {
      themes: [{
        id: 'halloween-2026',
        decorations: [{
          id: 'halloween.typography',
          typography: { pageTitle: { fontKey: 'inconnue' } },
        }],
      }],
    }),
    (error) => error.code === 'UNKNOWN_FONT',
  );
  assert.throws(
    () => mergeConfig(buildDefaultConfig(), {
      themes: [{
        id: 'halloween-2026',
        decorations: [{
          id: 'halloween.typography',
          typography: { categoryTitle: { effect: 'glow' } },
        }],
      }],
    }),
    (error) => error.code === 'EFFECT_SCOPE',
  );
});

test('un prérequis inconnu est rejeté', () => {
  assert.throws(
    () => validateConfig(mergeConfig(buildDefaultConfig(), {
      themes: [{
        id: 'halloween-2026',
        decorations: [{ id: 'halloween.lights.candles', requires: ['inconnu.background'] }],
      }],
    })),
    (error) => error.code === 'UNKNOWN_DECORATION',
  );
});

test('une préférence utilisateur historique ne peut pas modifier la configuration publiée', () => {
  for (const key of ['settings_halloween_theme', 'settings_christmas_theme', 'snow_enabled', 'theme']) {
    assert.throws(
      () => mergeConfig(buildDefaultConfig(), { [key]: true }),
      (error) => error.code === 'UNKNOWN_KEY',
    );
  }
});
