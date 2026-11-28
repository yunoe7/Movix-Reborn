'use strict';

// Tests de la couche publication/synchronisation avec un Redis et un MySQL
// simulés. Les scénarios multi-processus réels sont dans
// seasonalThemeMultiWorker.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  SEASONAL_THEME_KEYS,
  SEASONAL_THEME_CHANNEL,
  SeasonalThemeSyncError,
  createSeasonalThemeSync,
} = require('../seasonalThemeSync');
const {
  buildDefaultConfig,
  createSeasonalThemeService,
} = require('../seasonalThemeConfig');
const { resolveSeasonalTheme } = require('../seasonalThemeResolver');

test.mock.method(console, 'info', () => {});
test.mock.method(console, 'warn', () => {});

const NOW = new Date('2026-10-28T12:00:00.000Z');
const ACTOR = { userId: 'admin-42', adminId: 'staff-42' };

function createBus() {
  const bus = {
    store: new Map(),
    clients: [],
    down: false,
    events: [],
  };
  bus.createClient = () => {
    const client = new EventEmitter();
    client.subscriptions = new Set();
    const guard = () => {
      if (bus.down) throw new Error('Redis indisponible');
    };
    client.ping = async () => { guard(); return 'PONG'; };
    client.get = async (key) => { guard(); return bus.store.has(key) ? bus.store.get(key) : null; };
    client.set = async (key, value) => { guard(); bus.store.set(key, String(value)); return 'OK'; };
    client.del = async (...keys) => {
      guard();
      let removed = 0;
      for (const key of keys) if (bus.store.delete(key)) removed += 1;
      return removed;
    };
    client.publish = async (channel, payload) => {
      guard();
      bus.events.push({ channel, payload });
      for (const other of bus.clients) other.emit('message', channel, payload);
      return bus.clients.length;
    };
    client.subscribe = async (channel) => { client.subscriptions.add(channel); return 1; };
    client.unsubscribe = async (channel) => { client.subscriptions.delete(channel); return 0; };
    client.quit = async () => {};
    bus.clients.push(client);
    return client;
  };
  return bus;
}

function createPool() {
  const state = {
    row: JSON.stringify(buildDefaultConfig()),
    history: [],
    audit: [],
  };
  const transactional = {
    async beginTransaction() {},
    async execute(sql, params = []) {
      if (/^\s*UPDATE seasonal_theme_settings/i.test(sql)) {
        state.row = params[0];
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_settings_history/i.test(sql)) {
        state.history.push({ settings_json: params[1], changed_by: params[2] });
        return { affectedRows: 1 };
      }
      if (/INSERT INTO seasonal_theme_audit_log/i.test(sql)) {
        state.audit.push({ action: params[2], details: params[4] });
        return { affectedRows: 1 };
      }
      throw new Error(`Requête inattendue : ${sql}`);
    },
    async commit() {},
    async rollback() {},
    release() {},
  };
  return {
    state,
    execute: async (sql, params = []) => {
      if (/INSERT IGNORE INTO seasonal_theme_settings/i.test(sql)) return { affectedRows: 1 };
      if (/^\s*SELECT settings_json/i.test(sql)) return [[{ settings_json: state.row }], []];
      if (/FROM seasonal_theme_settings_history/i.test(sql)) {
        return [state.history.map((entry) => ({ settings_json: entry.settings_json, changed_by: entry.changed_by })), []];
      }
      if (/FROM seasonal_theme_audit_log/i.test(sql)) {
        return [state.audit.map((entry) => ({ action: entry.action, details_json: entry.details })), []];
      }
      throw new Error(`Requête inattendue : ${sql}`);
    },
    getConnection: async () => transactional,
  };
}

function createSync({ bus = createBus(), pool = createPool() } = {}) {
  const publisher = bus.createClient();
  const subscriber = bus.createClient();
  const service = createSeasonalThemeService({ pool, now: () => NOW, logger: { info() {} } });
  const sync = createSeasonalThemeSync({
    service,
    redis: publisher,
    subscriber,
    now: () => NOW,
    logger: { info() {}, warn() {} },
  });
  return { bus, pool, publisher, subscriber, service, sync };
}

function twoThemesPatch() {
  return {
    themes: [
      {
        id: 'halloween-2026',
        enabled: true,
        decorations: [
          { id: 'halloween.background', enabled: true },
          { id: 'halloween.lights.candles', enabled: true },
        ],
      },
      {
        id: 'christmas-2026',
        enabled: true,
        decorations: [
          { id: 'christmas.background', enabled: true },
          { id: 'christmas.background.snow', enabled: true },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------

test('la publication met à jour la base, le cache et notifie sans redéploiement', async () => {
  const { bus, pool, sync } = createSync();
  const config = await sync.publish(twoThemesPatch(), ACTOR, 'campagne octobre');

  assert.equal(config.revision, 1);
  assert.equal(JSON.parse(pool.state.row).revision, 1);
  assert.equal(bus.store.has(SEASONAL_THEME_KEYS.config), true);
  assert.equal(bus.store.get(SEASONAL_THEME_KEYS.revision), '1');
  const event = JSON.parse(bus.events.at(-1).payload);
  assert.equal(bus.events.at(-1).channel, SEASONAL_THEME_CHANNEL);
  assert.equal(event.type, 'config');
  assert.equal(event.revision, 1);

  const published = await sync.getPublished();
  assert.equal(published.revision, 1);
  assert.deepEqual(published.themes.map((theme) => theme.id), ['halloween-2026', 'christmas-2026']);
  await sync.stop();
});

test('plusieurs décorations compatibles de familles distinctes sont publiées ensemble', async () => {
  const { sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  const resolved = await sync.getResolved({ now: NOW, platform: 'desktop' });
  assert.deepEqual(resolved.decorations.map((entry) => entry.id).sort(), [
    'christmas.background',
    'christmas.background.snow',
    'halloween.background',
    'halloween.lights.candles',
  ]);
  assert.deepEqual(resolved.families.lights, ['halloween.lights.candles']);
  await sync.stop();
});

test('l’arrêt d’urgence est prioritaire, immédiat et bloque toute publication', async () => {
  const { bus, sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  const emergency = await sync.setEmergencyDisable(true, ACTOR, 'incident');

  assert.equal(emergency.emergencyDisable, true);
  assert.ok(bus.store.get(SEASONAL_THEME_KEYS.emergency));
  const event = JSON.parse(bus.events.at(-1).payload);
  assert.equal(event.type, 'config');

  const published = await sync.getPublished();
  assert.equal(published.emergencyDisable, true);
  const resolved = await sync.getResolved({ now: NOW });
  assert.deepEqual(resolved.decorations, []);
  assert.equal(Object.values(resolved.typography).every((entry) => !entry.enabled), true);

  await assert.rejects(
    () => sync.publish({ themes: [{ id: 'halloween-2026', enabled: false }] }, ACTOR, 'trop tard'),
    (error) => error instanceof SeasonalThemeSyncError && error.code === 'EMERGENCY_ACTIVE',
  );

  // Un événement reçu d'un autre worker prime même si la clé Redis a disparu.
  bus.store.delete(SEASONAL_THEME_KEYS.emergency);
  bus.clients[1].emit('message', SEASONAL_THEME_CHANNEL, JSON.stringify({ type: 'emergency', emergency: true, epoch: 123 }));
  assert.equal((await sync.getPublished()).emergencyDisable, true);
  await sync.stop();
});

test('le retour à une configuration désactivée puis à une configuration active est versionné', async () => {
  const { bus, sync } = createSync();
  const first = await sync.publish(twoThemesPatch(), ACTOR, 'on');
  const off = await sync.publish({
    themes: [
      { id: 'halloween-2026', enabled: false },
      { id: 'christmas-2026', enabled: false },
    ],
  }, ACTOR, 'off');
  assert.equal(off.revision, first.revision + 1);
  assert.deepEqual((await sync.getResolved({ now: NOW })).decorations, []);

  const back = await sync.publish(twoThemesPatch(), ACTOR, 'on again');
  assert.equal(back.revision, off.revision + 1);
  assert.equal((await sync.getResolved({ now: NOW })).decorations.length, 4);

  const reenabled = await sync.setEmergencyDisable(false, ACTOR, 'reprise');
  assert.equal(reenabled.emergencyDisable, false);
  assert.equal(bus.store.has(SEASONAL_THEME_KEYS.emergency), false);
  assert.equal((await sync.getPublished()).emergencyDisable, false);
  await sync.stop();
});

test('une désactivation ciblée ne modifie que la décoration visée', async () => {
  const { sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  await sync.disableDecoration('halloween.background', ACTOR, 'signalement');
  const resolved = await sync.getResolved({ now: NOW });
  assert.deepEqual(resolved.decorations.map((entry) => entry.id).sort(), [
    'christmas.background',
    'christmas.background.snow',
  ]);
  await assert.rejects(
    () => sync.disableDecoration('inconnu.decoration', ACTOR, 'x'),
    (error) => error.code === 'UNKNOWN_DECORATION',
  );
  await sync.stop();
});

test('une panne Redis provoque un fail-closed et refuse les mutations', async () => {
  const { bus, sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  bus.down = true;

  const published = await sync.getPublished();
  assert.equal(published.emergencyDisable, true);
  assert.equal(sync.getStatus().failClosed, true);
  await assert.rejects(() => sync.publish({}, ACTOR, 'x'), SeasonalThemeSyncError);
  assert.equal((await sync.getResolved({ now: NOW })).decorations.length, 0);

  bus.down = false;
  const recovered = await sync.recover();
  assert.equal(recovered.config.revision, 1);
  assert.equal(recovered.status.failClosed, false);
  await sync.stop();
});

test('un cache incohérent provoque un fail-closed jusqu’à réconciliation', async () => {
  const { bus, sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  bus.store.set(SEASONAL_THEME_KEYS.revision, '999');

  const published = await sync.getPublished();
  assert.equal(published.emergencyDisable, true);
  assert.equal(sync.getStatus().failClosed, true);

  await sync.invalidateCache(ACTOR, 'réconciliation');
  const refreshed = await sync.getPublished();
  assert.equal(refreshed.revision, 1);
  assert.equal(refreshed.emergencyDisable, false);
  await sync.stop();
});

test('un arrêt d’urgence survenu pendant une transaction bloque sa publication', async () => {
  const { bus, sync, service } = createSync();
  await sync.publish({}, ACTOR, 'initial');
  // L'arrêt survient après la deuxième garde mais avant la fin de l'écriture.
  const originalApply = service.applyConfig;
  service.applyConfig = async (...args) => {
    bus.store.set(SEASONAL_THEME_KEYS.emergency, JSON.stringify({ epoch: 999999, by: 'admin-42' }));
    bus.clients[1].emit('message', SEASONAL_THEME_CHANNEL, JSON.stringify({
      type: 'emergency', emergency: true, epoch: 999999,
    }));
    return originalApply(...args);
  };

  await assert.rejects(
    () => sync.publish(twoThemesPatch(), ACTOR, 'publication en vol'),
    (error) => error instanceof SeasonalThemeSyncError && error.code === 'EMERGENCY_ACTIVE',
  );
  const published = await sync.getPublished();
  assert.equal(published.emergencyDisable, true);
  assert.equal(bus.store.get(SEASONAL_THEME_KEYS.revision), '1');
  await sync.stop();
});

test('une révision attendue obsolète est refusée (concurrence entre administrateurs)', async () => {
  const { sync } = createSync();
  const first = await sync.publish({}, ACTOR, 'init');
  await assert.rejects(
    () => sync.publish({}, ACTOR, 'conflit', { expectedRevision: first.revision - 1 }),
    (error) => error.code === 'REVISION_CONFLICT',
  );
  await sync.stop();
});

test('un cache vide est réchauffé depuis la source de vérité après redémarrage', async () => {
  const { bus, pool, sync } = createSync();
  await sync.publish(twoThemesPatch(), ACTOR, 'multi');
  bus.store.delete(SEASONAL_THEME_KEYS.config);
  bus.store.delete(SEASONAL_THEME_KEYS.revision);

  // Nouveau worker : aucun cache local, Redis vide, MySQL conserve la vérité.
  const fresh = createSync({ bus, pool });
  const published = await fresh.sync.getPublished();
  assert.equal(published.revision, 1);
  assert.equal(published.emergencyDisable, false);
  assert.equal(bus.store.get(SEASONAL_THEME_KEYS.revision), '1');
  await sync.stop();
  await fresh.sync.stop();
});
