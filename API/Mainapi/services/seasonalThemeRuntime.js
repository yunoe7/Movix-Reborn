'use strict';

/**
 * Runtime unique du moteur décoratif saisonnier par worker.
 *
 * Une seule instance de synchronisation est partagée par toutes les routes
 * d'un processus. Le client ioredis existant sert aux commandes ; un client
 * dupliqué est réservé au pub/sub (ioredis interdit les commandes ordinaires
 * en mode subscriber).
 */

const { redis } = require('../config/redis');
const { getPool } = require('../mysqlPool');
const { createSeasonalThemeService } = require('./seasonalThemeConfig');
const { createSeasonalThemeSync } = require('./seasonalThemeSync');

let instance = null;

function attach(app) {
  if (instance && app?.locals) app.locals.seasonalThemeSync = instance;
  return instance;
}

async function startSeasonalThemeSync() {
  if (instance) return instance;
  const pool = getPool();
  if (!pool) {
    console.error('[SeasonalTheme] pool MySQL indisponible : synchronisation non démarrée');
    return null;
  }
  const service = createSeasonalThemeService({ pool, logger: console });
  instance = createSeasonalThemeSync({
    service,
    redis,
    ownsSubscriber: true,
    logger: console,
  });
  try {
    await instance.start();
  } catch (error) {
    // L'absence du bus ne doit jamais faire démarrer le worker avec une
    // configuration active non vérifiée : getPublished() est fail-closed.
    console.error('[SeasonalTheme] abonnement Redis indisponible :', error?.message || error);
  }
  return instance;
}

async function stopSeasonalThemeSync() {
  if (!instance) return;
  try { await instance.stop(); } catch { /* arrêt en cours */ }
  instance = null;
}

/** Injection contrôlée pour les tests d'intégration. */
function setSeasonalThemeSyncForTests(value) {
  instance = value;
}

module.exports = {
  startSeasonalThemeSync,
  stopSeasonalThemeSync,
  attach,
  setSeasonalThemeSyncForTests,
  getSeasonalThemeSync: () => instance,
};
