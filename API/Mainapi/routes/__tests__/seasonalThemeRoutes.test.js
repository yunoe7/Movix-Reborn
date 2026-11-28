'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const serviceModule = require('../../services/seasonalThemeConfig');

// Journal attendu : chaque mutation valide écrit `[SeasonalTheme] ...`.
test.mock.method(console, 'info', () => {});

function createFakePool() {
  const state = {
    row: null,
    history: [],
    audit: [],
    commits: 0,
  };
  const connection = {
    async beginTransaction() {},
    async execute(sql, params = []) {
      if (/^\s*UPDATE seasonal_theme_settings/i.test(sql)) {
        state.row = { settings_json: params[0], updated_by: params[1], updated_at: new Date() };
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_settings_history/i.test(sql)) {
        state.history.push({ changed_by: params[2], change_reason: params[3], settings_json: params[1] });
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_audit_log/i.test(sql)) {
        state.audit.push({ admin_id: params[0], admin_auth_type: params[1], action: params[2], target: params[3] });
        return { affectedRows: 1 };
      }
      throw new Error(`Requête transactionnelle inattendue : ${sql}`);
    },
    async commit() { state.commits += 1; },
    async rollback() {},
    release() {},
  };
  const pool = {
    async execute(sql, params = []) {
      if (/INSERT IGNORE INTO seasonal_theme_settings/i.test(sql)) {
        if (!state.row) {
          state.row = { settings_json: params[1], updated_by: null, updated_at: new Date() };
          return { affectedRows: 1 };
        }
        return { affectedRows: 0 };
      }
      if (/^\s*SELECT settings_json, updated_by, updated_at/i.test(sql)) {
        return [state.row ? [state.row] : [], []];
      }
      if (/FROM seasonal_theme_settings_history/i.test(sql)) {
        return [state.history.slice(0, params[1]).map((entry) => ({
          settings_json: entry.settings_json,
          changed_by: entry.changed_by,
          change_reason: entry.change_reason,
          created_at: new Date(),
        })), []];
      }
      if (/FROM seasonal_theme_audit_log/i.test(sql)) {
        return [state.audit.slice(0, params[0]).map((entry) => ({
          admin_id: entry.admin_id,
          admin_auth_type: entry.admin_auth_type,
          action: entry.action,
          target: entry.target,
          details_json: '{}',
          created_at: new Date(),
        })), []];
      }
      throw new Error(`Requête inattendue : ${sql}`);
    },
    async getConnection() { return connection; },
  };
  return { pool, state };
}

function loadRouter({ pool, admin = true } = {}) {
  const filename = path.resolve(__dirname, '../seasonalTheme.js');
  const state = { limiterCalls: [], blocked: false };
  const isAdmin = (req, res, next) => {
    if (!admin) {
      return res.status(403).json({ success: false, error: 'Accès refusé - Droits admin requis' });
    }
    req.admin = { userId: 'admin-42', userType: 'oauth', adminId: 'staff-42', role: 'admin' };
    return next();
  };
  const dependencies = {
    express,
    '../middleware/auth': { isAdmin },
    '../mysqlPool': { getPool: () => pool },
    '../utils/adminActionRateLimit': {
      createAdminActionLimiter(prefix) {
        return (req, res, next) => {
          state.limiterCalls.push({ prefix, userId: req.user?.userId, userType: req.user?.userType });
          if (state.blocked) {
            return res.status(429).json({ success: false, code: 'RATE_LIMITED' });
          }
          return next();
        };
      },
    },
    '../services/seasonalThemeConfig': serviceModule,
  };
  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    console: { log() {}, warn() {}, error() {} },
    Date,
    Set,
    Map,
    Buffer,
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    },
  }, { filename });
  return { router: sandboxModule.exports.router, state };
}

async function callRoute(router, method, routePath, { body = {}, query = {}, sync = null } = {}) {
  const layer = router.stack.find((entry) => (
    entry.route?.path === routePath && entry.route.methods[method]
  ));
  assert.ok(layer, `Route absente : ${method.toUpperCase()} ${routePath}`);
  const req = {
    method: method.toUpperCase(),
    body,
    query,
    params: {},
    headers: {},
    ip: '203.0.113.7',
    get: () => '',
    app: { locals: { seasonalThemeSync: sync } },
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    headersSent: false,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  for (const entry of layer.route.stack) {
    const result = entry.handle(req, res, (error) => {
      if (error) throw error;
    });
    if (result && typeof result.then === 'function') await result;
    // Un middleware qui répond sans appeler next() interrompt la chaîne,
    // exactement comme dans Express.
    if (res.body !== null) break;
  }
  return res;
}

async function readyRouter(options = {}) {
  const { pool, state } = createFakePool();
  const loaded = loadRouter({ pool, ...options });
  await serviceModule.createSeasonalThemeService({ pool }).initialize();
  return { ...loaded, poolState: state };
}

// ---------------------------------------------------------------------------

test('GET /seasonal-theme est public, no-store et n’appelle pas le limiteur admin', async () => {
  const { router, state } = await readyRouter({ admin: false });
  const res = await callRoute(router, 'get', '/seasonal-theme');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.config.emergencyDisable, false);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(state.limiterCalls, []);
});

test('un utilisateur standard ne peut pas modifier la configuration', async () => {
  const { router, state, poolState } = await readyRouter({ admin: false });
  const res = await callRoute(router, 'put', '/admin/seasonal-theme', {
    body: { patch: { emergencyDisable: true } },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.deepEqual(state.limiterCalls, []);
  assert.equal(poolState.history.length, 0);
});

test('un admin peut publier un patch ; la mutation est limitée et auditée', async () => {
  const { router, state, poolState } = await readyRouter();
  const res = await callRoute(router, 'put', '/admin/seasonal-theme', {
    body: {
      patch: {
        themes: [{ id: 'halloween-2026', enabled: true }],
      },
      reason: 'publication halloween',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.themes.find((theme) => theme.id === 'halloween-2026').enabled, true);
  assert.deepEqual(state.limiterCalls, [{
    prefix: 'seasonal-theme',
    userId: 'admin-42',
    userType: 'oauth',
  }]);
  assert.equal(poolState.history[0].changed_by, 'staff-42');
  assert.equal(poolState.audit[0].admin_id, 'staff-42');
  assert.equal(poolState.commits, 1);
});

test('le limiteur bloque une mutation avant toute écriture', async () => {
  const loaded = await readyRouter();
  loaded.state.blocked = true;
  const res = await callRoute(loaded.router, 'post', '/admin/seasonal-theme/emergency-disable', {
    body: { enabled: true },
  });
  assert.equal(res.statusCode, 429);
  assert.equal(loaded.state.limiterCalls.length, 1);
  assert.equal(loaded.poolState.history.length, 0);
  assert.equal(loaded.poolState.commits, 0);
});

test('une police inconnue renvoie 400 avec un code stable', async () => {
  const { router, poolState } = await readyRouter();
  const res = await callRoute(router, 'put', '/admin/seasonal-theme', {
    body: { patch: { typography: { pageTitle: { fontKey: 'comic-sans' } } } },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNKNOWN_FONT');
  assert.equal(poolState.history.length, 0);
});

test('l’arrêt d’urgence est exposé via une route admin dédiée', async () => {
  const { router } = await readyRouter();
  const res = await callRoute(router, 'post', '/admin/seasonal-theme/emergency-disable', {
    body: { enabled: true, reason: 'incident' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.emergencyDisable, true);
});

test('les lectures admin ne consomment pas le quota de mutations', async () => {
  const { router, state } = await readyRouter();
  for (const routePath of ['/admin/seasonal-theme', '/admin/seasonal-theme/history', '/admin/seasonal-theme/audit']) {
    const res = await callRoute(router, 'get', routePath);
    assert.equal(res.statusCode, 200, routePath);
    assert.equal(res.body.success, true, routePath);
  }
  assert.deepEqual(state.limiterCalls, []);
});

function createFakeSync(overrides = {}, { publishedConfig } = {}) {
  const calls = [];
  const sync = {
    calls,
    async getPublished() { calls.push(['getPublished']); return publishedConfig || serviceModule.buildDefaultConfig(); },
    async getResolved(context) {
      calls.push(['getResolved', context]);
      return {
        emergencyDisable: false,
        revision: 1,
        decorations: [],
        families: {},
        typography: {},
      };
    },
    async publish(patch, actor, reason, options) {
      calls.push(['publish', patch, actor, reason, options]);
      return serviceModule.buildDefaultConfig();
    },
    async setEmergencyDisable(enabled, actor, reason, options) {
      calls.push(['setEmergencyDisable', enabled, actor, reason, options]);
      return serviceModule.buildDefaultConfig();
    },
    async disableDecoration(id, actor, reason, options) {
      calls.push(['disableDecoration', id, actor, reason, options]);
      return serviceModule.buildDefaultConfig();
    },
    async invalidateCache(actor, reason, options) {
      calls.push(['invalidateCache', actor, reason, options]);
      return { success: true, revision: 1 };
    },
    getStatus() { return { failClosed: false, subscribed: true, emergency: false }; },
  };
  return { sync: { ...sync, ...overrides }, calls };
}

test('la route publique utilise la vue synchronisée fail-closed quand elle est montée', async () => {
  const { router } = await readyRouter({ admin: false });
  const disabled = serviceModule.buildDefaultConfig();
  disabled.emergencyDisable = true;
  const { sync, calls } = createFakeSync({}, { publishedConfig: disabled });
  const res = await callRoute(router, 'get', '/seasonal-theme', { sync });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.config.emergencyDisable, true);
  assert.deepEqual(calls, [['getPublished']]);
});

test('la publication transmet la révision attendue et l’identité admin authentifiée', async () => {
  const { router } = await readyRouter();
  const { sync, calls } = createFakeSync();
  const res = await callRoute(router, 'put', '/admin/seasonal-theme', {
    sync,
    body: { patch: { emergencyDisable: true }, reason: 'test', expectedRevision: 7 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0][0], 'publish');
  assert.equal(calls[0][1].emergencyDisable, true);
  assert.equal(calls[0][2].userId, 'admin-42');
  assert.equal(calls[0][2].adminId, 'staff-42');
  assert.equal(calls[0][3], 'test');
  assert.equal(calls[0][4].expectedRevision, 7);
});

test('la résolution publique valide plateforme et capacités avant de résoudre', async () => {
  const { router } = await readyRouter({ admin: false });
  const { sync, calls } = createFakeSync();
  const bad = await callRoute(router, 'get', '/seasonal-theme/resolve', {
    sync,
    query: { platform: 'unknown' },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.code, 'UNKNOWN_PLATFORM');

  const invalidDate = await callRoute(router, 'get', '/seasonal-theme/resolve', {
    sync,
    query: { at: 'pas-une-date' },
  });
  assert.equal(invalidDate.statusCode, 400);
  assert.equal(invalidDate.body.code, 'INVALID_DATE');

  const ok = await callRoute(router, 'get', '/seasonal-theme/resolve', {
    sync,
    query: { platform: 'tv', capabilities: 'tvStaticEffects', at: '2026-10-28T12:00:00.000Z' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(calls[0][0], 'getResolved');
  assert.equal(calls[0][1].platform, 'tv');
  assert.deepEqual(Array.from(calls[0][1].capabilities), ['tvStaticEffects']);
  assert.equal(calls[0][1].now, '2026-10-28T12:00:00.000Z');
});

test('la désactivation ciblée et l’invalidation du cache restent réservées aux admins', async () => {
  const { router } = await readyRouter({ admin: false });
  const { sync } = createFakeSync();
  for (const routePath of ['/admin/seasonal-theme/decorations/disable', '/admin/seasonal-theme/cache/invalidate']) {
    const res = await callRoute(router, 'post', routePath, { sync, body: { decorationId: 'halloween.background' } });
    assert.equal(res.statusCode, 403, routePath);
  }

  const adminRouter = (await readyRouter()).router;
  const disabled = await callRoute(adminRouter, 'post', '/admin/seasonal-theme/decorations/disable', {
    sync,
    body: { decorationId: 'halloween.background', expectedRevision: 2 },
  });
  assert.equal(disabled.statusCode, 200);
  const invalidated = await callRoute(adminRouter, 'post', '/admin/seasonal-theme/cache/invalidate', {
    sync,
    body: { reason: 'reconciliation' },
  });
  assert.equal(invalidated.statusCode, 200);
  assert.deepEqual(invalidated.body.invalidation, { success: true, revision: 1 });
});

test('une erreur de synchronisation est traduite en conflit ou indisponibilité', async () => {
  const { router } = await readyRouter();
  const error = Object.assign(new Error('arrêt actif'), {
    name: 'SeasonalThemeSyncError',
    code: 'EMERGENCY_ACTIVE',
    detail: 'un arrêt d’urgence est actif',
  });
  const { sync } = createFakeSync({ publish: async () => { throw error; } });
  const res = await callRoute(router, 'put', '/admin/seasonal-theme', {
    sync,
    body: { patch: { emergencyDisable: false } },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'EMERGENCY_ACTIVE');
});
