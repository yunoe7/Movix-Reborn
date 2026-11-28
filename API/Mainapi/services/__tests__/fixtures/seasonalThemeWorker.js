'use strict';

/**
 * Worker réel utilisé par seasonalThemeMultiWorker.test.js.
 * Chaque processus possède son propre "MySQL" mémoire et ses deux connexions
 * Redis ; seule la base du worker éditeur est modifiée, exactement comme dans
 * un cluster où une requête administrative ne touche qu'un worker.
 */

const Redis = require('ioredis');
const {
  buildDefaultConfig,
  createSeasonalThemeService,
} = require('../../seasonalThemeConfig');
const { createSeasonalThemeSync } = require('../../seasonalThemeSync');

const workerId = process.env.SEASONAL_WORKER_ID;
const port = Number(process.env.SEASONAL_REDIS_PORT);
// Horloge absolue haute résolution, comparable entre processus d'une même
// machine (timeOrigin + now), contrairement à nowMs() limité à la ms.
const nowMs = () => performance.timeOrigin + performance.now();

let storedConfig = JSON.stringify(buildDefaultConfig());
const transactional = {
  async beginTransaction() {},
  async execute(sql, params = []) {
    if (/^\s*UPDATE seasonal_theme_settings/i.test(sql)) {
      storedConfig = params[0];
      return { affectedRows: 1 };
    }
    if (/INSERT INTO seasonal_theme_settings_history/i.test(sql)) return { affectedRows: 1 };
    if (/INSERT INTO seasonal_theme_audit_log/i.test(sql)) return { affectedRows: 1 };
    throw new Error(`Requête inattendue : ${sql}`);
  },
  async commit() {},
  async rollback() {},
  release() {},
};
const pool = {
  async execute(sql, params = []) {
    if (/INSERT IGNORE INTO seasonal_theme_settings/i.test(sql)) return { affectedRows: 1 };
    if (/^\s*SELECT settings_json/i.test(sql)) return [[{ settings_json: storedConfig }], []];
    if (/FROM seasonal_theme_settings_history|FROM seasonal_theme_audit_log/i.test(sql)) return [[], []];
    throw new Error(`Requête inattendue : ${sql}`);
  },
  async getConnection() { return transactional; },
};

const options = {
  host: '127.0.0.1',
  port,
  lazyConnect: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => 100,
  enableOfflineQueue: true,
};
const redis = new Redis(options);
const subscriber = new Redis(options);
const service = createSeasonalThemeService({ pool, logger: { info() {} } });

let sync;
let emergencyTag = null;
sync = createSeasonalThemeSync({
  service,
  redis,
  subscriber,
  logger: { info() {}, warn() {} },
  onEvent: async (event) => {
    // Instant de confirmation Redis : écrit avant la transaction MySQL, c'est
    // le point de départ de la mesure de propagation demandée.
    if (event.type === 'emergency' && event.emergency === true) {
      process.send({ type: 'emergencyCommitted', workerId, tag: emergencyTag, at: nowMs(), epoch: event.epoch });
    }
    const config = await sync.getPublished();
    process.send({
      type: 'observed',
      workerId,
      event: event.type,
      tag: emergencyTag,
      epoch: event.epoch ?? null,
      at: nowMs(),
      revision: config.revision,
      emergencyDisable: config.emergencyDisable,
      failClosed: sync.getStatus().failClosed,
    });
  },
});

function sendRead(label) {
  return sync.getPublished().then((config) => process.send({
    type: 'read',
    workerId,
    label,
    at: nowMs(),
    revision: config.revision,
    emergencyDisable: config.emergencyDisable,
    failClosed: sync.getStatus().failClosed,
    status: sync.getStatus(),
  }));
}

process.on('message', async (message) => {
  try {
    if (message.type === 'publish') {
      const config = await sync.publish(message.patch, { userId: 'admin-42' }, 'test publication');
      process.send({ type: 'published', workerId, at: nowMs(), revision: config.revision });
    } else if (message.type === 'emergency') {
      emergencyTag = message.tag || null;
      const config = await sync.setEmergencyDisable(message.enabled, { userId: 'admin-42' }, 'test urgence');
      process.send({ type: 'emergencySet', workerId, tag: emergencyTag, at: nowMs(), revision: config.revision });
    } else if (message.type === 'read') {
      await sendRead(message.label);
    } else if (message.type === 'recover') {
      const result = await sync.recover();
      process.send({
        type: 'recovered',
        workerId,
        at: nowMs(),
        revision: result.config.revision,
        emergencyDisable: result.config.emergencyDisable,
        failClosed: result.status.failClosed,
      });
    } else if (message.type === 'stop') {
      await sync.stop();
      redis.disconnect();
      subscriber.disconnect();
      process.exit(0);
    }
  } catch (error) {
    process.send({
      type: 'error',
      workerId,
      requestId: message.requestId,
      code: error.code || 'WORKER_ERROR',
      message: error.message,
    });
  }
});

(async () => {
  await sync.start();
  process.send({ type: 'ready', workerId });
})().catch((error) => {
  process.send({ type: 'error', workerId, code: 'START_ERROR', message: error.message });
});
