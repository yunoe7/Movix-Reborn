'use strict';

/**
 * Publication, synchronisation et cache du moteur décoratif saisonnier.
 *
 * Source de vérité : ligne `seasonal_theme_settings:1` (MySQL), écrite par
 * l'administration. Redis sert uniquement de cache de lecture et de bus
 * d'invalidation pub/sub entre workers. La configuration publiée ne dépend
 * donc d'aucun redéploiement.
 *
 * Garantie fail-closed : dès qu'un worker ne peut pas vérifier Redis, qu'une
 * clé est incohérente ou qu'un arrêt d'urgence est connu, il sert une
 * configuration désactivée. Il ne sert jamais une configuration active
 * ancienne dont il n'a pas pu confirmer la fraîcheur.
 */

const {
  SEASONAL_THEME_CATALOG,
  SeasonalThemeValidationError,
  buildDefaultConfig,
  validateConfig,
  parseStoredConfig,
} = require('./seasonalThemeConfig');
const { resolveSeasonalTheme } = require('./seasonalThemeResolver');

const SEASONAL_THEME_KEYS = Object.freeze({
  config: 'seasonal-theme:config',
  revision: 'seasonal-theme:revision',
  emergency: 'seasonal-theme:emergency',
});
const SEASONAL_THEME_CHANNEL = 'seasonal-theme:changes';

class SeasonalThemeSyncError extends Error {
  constructor(code, detail) {
    super(`Synchronisation décorative indisponible (${code}) : ${detail}`);
    this.name = 'SeasonalThemeSyncError';
    this.code = code;
    this.detail = detail;
  }
}

function localFail(code, detail) {
  throw new SeasonalThemeSyncError(code, detail);
}

function assertReason(reason) {
  if (typeof reason !== 'string') return;
  if (/[<>]|javascript:|data:|vbscript:|expression\s*\(|@import|\\u003c|\\u003e/i.test(reason)) {
    throw new SeasonalThemeValidationError('MARKUP_REJECTED', 'reason contient du HTML/CSS/JS arbitraire');
  }
}

function safeLabel(actor) {
  const value = actor?.userId || actor?.adminId || 'system';
  return String(value).replace(/[^A-Za-z0-9._:@/ -]/g, '').slice(0, 120) || 'system';
}

function disabledConfig(cat, revision = 0) {
  const config = buildDefaultConfig(cat);
  config.emergencyDisable = true;
  config.revision = Number.isInteger(revision) && revision >= 0 ? revision : 0;
  return config;
}

function emergencyConfig(config, cat = SEASONAL_THEME_CATALOG) {
  const next = { ...config, emergencyDisable: true };
  validateConfig(next, cat);
  return next;
}

/**
 * @param {object} options
 * @param {object} options.service service MySQL (source de vérité)
 * @param {object} options.redis client ioredis pour les commandes
 * @param {object} [options.subscriber] client abonné dédié (ioredis interdit les commandes en mode subscriber)
 */
function createSeasonalThemeSync({
  service,
  redis,
  subscriber,
  ownsSubscriber = false,
  logger = console,
  now = () => new Date(),
  catalog: cat = SEASONAL_THEME_CATALOG,
  ttl = 300,
  channel = SEASONAL_THEME_CHANNEL,
  keys = SEASONAL_THEME_KEYS,
  onEvent,
} = {}) {
  if (!service || typeof service.getConfig !== 'function' || typeof service.buildUpdatedConfig !== 'function') {
    throw new Error('Service décoratif saisonnier invalide pour la synchronisation');
  }
  if (!redis || typeof redis.get !== 'function' || typeof redis.set !== 'function') {
    throw new Error('Client Redis invalide pour la synchronisation décorative');
  }

  const subClient = subscriber || (typeof redis.duplicate === 'function' ? redis.duplicate() : null);
  let localConfig = null;
  let localRevision = -1;
  let localEmergency = null;
  let failClosed = false;
  let subscribed = false;
  let stopped = false;

  function warn(message, error) {
    if (logger?.warn) logger.warn(`[SeasonalTheme] ${message}`, error?.message || error || '');
  }

  function info(message, meta) {
    if (logger?.info) logger.info(`[SeasonalTheme] ${message}`, meta);
  }

  function markFailClosed(reason, error) {
    failClosed = true;
    warn(`fail-closed : ${reason}`, error);
  }

  function invalidate() {
    localConfig = null;
    localRevision = -1;
  }

  async function ping() {
    if (typeof redis.ping !== 'function') return;
    let answer;
    try {
      answer = await redis.ping();
    } catch (error) {
      markFailClosed('Redis indisponible', error);
      localFail('REDIS_UNAVAILABLE', 'Redis indisponible');
    }
    if (String(answer).toUpperCase() !== 'PONG') localFail('REDIS_ERROR', 'réponse PING inattendue');
  }

  async function readEmergency() {
    const raw = await redis.get(keys.emergency);
    if (raw === null || raw === undefined || raw === '') return null;
    let value;
    try {
      value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      markFailClosed('clé d’arrêt d’urgence corrompue');
      localFail('EMERGENCY_CORRUPT', 'la clé d’arrêt d’urgence n’est pas du JSON');
    }
    if (!value || typeof value !== 'object' || typeof value.epoch !== 'number') {
      markFailClosed('clé d’arrêt d’urgence invalide');
      localFail('EMERGENCY_CORRUPT', 'la clé d’arrêt d’urgence est invalide');
    }
    return value;
  }

  async function readRevision() {
    const raw = await redis.get(keys.revision);
    if (raw === null || raw === undefined || raw === '') return 0;
    const revision = Number(raw);
    if (!Number.isInteger(revision) || revision < 0 || revision > 1_000_000_000) {
      markFailClosed('révision Redis invalide');
      localFail('CACHE_INCOHERENT', 'révision Redis invalide');
    }
    return revision;
  }

  async function readCachedConfig() {
    const raw = await redis.get(keys.config);
    if (!raw) return null;
    try {
      const config = parseStoredConfig(raw, cat);
      validateConfig(config, cat);
      return config;
    } catch (error) {
      markFailClosed('configuration en cache invalide', error);
      localFail('CACHE_INCOHERENT', 'configuration en cache invalide');
    }
  }

  async function writeCache(config) {
    if (typeof redis.set !== 'function') localFail('REDIS_ERROR', 'SET indisponible');
    await redis.set(keys.config, JSON.stringify(config), 'EX', ttl);
    await redis.set(keys.revision, String(config.revision), 'EX', ttl);
  }

  async function publishEvent(payload) {
    if (typeof redis.publish !== 'function') return;
    await redis.publish(channel, JSON.stringify(payload));
  }

  async function emergencyEpoch() {
    const emergency = await readEmergency();
    return emergency ? emergency.epoch : 0;
  }

  /**
   * Garde d'époque : une publication ne peut aboutir que si l'état d'urgence
   * est exactement celui observé à son début. Cela couvre aussi le cas
   * ABA (arrêt puis reprise) survenu pendant la transaction.
   */
  async function assertEpoch(expected) {
    if (localEmergency || (await emergencyEpoch()) !== expected) {
      localFail('EMERGENCY_ACTIVE', 'un arrêt d’urgence est actif ou a changé pendant la publication');
    }
  }

  /** Vue publiée à utiliser par toutes les routes (jamais la lecture MySQL brute). */
  async function getPublished() {
    // L'événement pub/sub prime sur tout, y compris un état fail-closed :
    // l'arrêt d'urgence est toujours la décision la plus prioritaire.
    if (localEmergency) return disabledConfig(cat, Math.max(0, localRevision));
    if (failClosed) return disabledConfig(cat, Math.max(0, localRevision));

    try {
      await ping();
      const emergency = await readEmergency();
      if (emergency) {
        localEmergency = emergency;
        let base = localConfig || await readCachedConfig();
        if (!base) {
          try {
            base = await service.getConfig();
            validateConfig(base, cat);
          } catch {
            base = buildDefaultConfig(cat);
          }
        }
        localRevision = base.revision;
        return emergencyConfig(base);
      }

      const revision = await readRevision();
      if (localConfig && localRevision === revision) return localConfig;

      let cached = await readCachedConfig();
      if (!cached) {
        // Cache vide : la base est la source de vérité. On la réchauffe puis
        // on revérifie la révision pour ne pas figer une valeur obsolète.
        const stored = await service.getConfig();
        validateConfig(stored, cat);
        cached = stored;
        if (stored.emergencyDisable) {
          localEmergency = { epoch: Date.now(), revision: stored.revision, source: 'database' };
          try {
            await redis.set(keys.emergency, JSON.stringify(localEmergency));
          } catch (error) {
            warn('impossible de réchauffer la clé d’urgence depuis la base', error);
          }
          return emergencyConfig(stored);
        }
        await writeCache(stored);
        const afterEmergency = await readEmergency();
        if (afterEmergency) {
          localEmergency = afterEmergency;
          return emergencyConfig(stored);
        }
        const afterRevision = await readRevision();
        if (afterRevision !== stored.revision) {
          invalidate();
          localFail('CACHE_INCOHERENT', 'la révision a changé pendant le réchauffage du cache');
        }
      } else if (cached.revision !== revision && revision !== 0) {
        invalidate();
        localFail('CACHE_INCOHERENT', `cache révision ${cached.revision} ≠ Redis révision ${revision}`);
      }

      validateConfig(cached, cat);
      localConfig = cached;
      localRevision = cached.revision;
      return cached;
    } catch (error) {
      // Toute défaillance de la lecture (Redis indisponible, cache ou clé
      // d'urgence invalide, révision incohérente) bascule en fail-closed.
      markFailClosed('lecture de configuration non vérifiable', error);
      return disabledConfig(cat, Math.max(0, localRevision));
    }
  }

  /** Publie un patch sans redéploiement, avec contrôle d'urgence et de révision. */
  async function publish(patch, actor, reason, options = {}) {
    assertReason(reason);
    await ping();
    const epochAtStart = await emergencyEpoch();
    if (epochAtStart !== 0) {
      localFail('EMERGENCY_ACTIVE', 'un arrêt d’urgence est actif : publication refusée');
    }

    const current = await service.getConfig();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new SeasonalThemeValidationError(
        'REVISION_CONFLICT',
        `révision attendue ${options.expectedRevision}, révision courante ${current.revision}`,
      );
    }
    const cacheRevision = await readRevision();
    if (cacheRevision > current.revision) {
      invalidate();
      markFailClosed('Redis est en avance sur la source de vérité');
      localFail('CACHE_INCOHERENT', 'Redis est en avance sur la base');
    }

    const next = service.buildUpdatedConfig(current, patch, actor);
    // Deuxième garde, juste avant l'écriture : une confirmation d'arrêt
    // d'urgence survenue pendant la lecture doit gagner.
    await assertEpoch(epochAtStart);
    await service.applyConfig(next, actor, reason, options.action || 'settings.publish');

    try {
      // Troisième garde : une écriture MySQL déjà lancée n'est jamais
      // publiée dans le cache si l'époque d'urgence a changé entre temps.
      await assertEpoch(epochAtStart);
      await writeCache(next);
      await publishEvent({
        type: 'config',
        revision: next.revision,
        emergency: next.emergencyDisable,
        by: safeLabel(actor),
      });
      localConfig = next;
      localRevision = next.revision;
    } catch (error) {
      invalidate();
      markFailClosed('publication du cache impossible après écriture en base', error);
      throw error;
    }
    info('configuration publiée', { revision: next.revision, by: safeLabel(actor) });
    return next;
  }

  /**
   * Arrêt d'urgence. L'activation écrit Redis AVANT la base : tous les workers
   * basculent dès la confirmation Redis, avant même la fin de la transaction.
   */
  async function setEmergencyDisable(enabled, actor, reason, options = {}) {
    if (typeof enabled !== 'boolean') {
      throw new SeasonalThemeValidationError('INVALID_BOOLEAN', 'emergencyDisable doit être un booléen');
    }
    assertReason(reason);

    if (enabled) {
      let redisReady = true;
      const epoch = Date.now();
      try {
        await ping();
        await redis.set(keys.emergency, JSON.stringify({
          epoch,
          revision: options.expectedRevision ?? null,
          at: now().toISOString(),
          by: safeLabel(actor),
        }));
        localEmergency = { epoch };
        await publishEvent({ type: 'emergency', emergency: true, epoch });
      } catch (error) {
        redisReady = false;
        localEmergency = { epoch };
        markFailClosed('écriture de l’arrêt d’urgence impossible', error);
      }

      const current = await service.getConfig();
      if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
        throw new SeasonalThemeValidationError(
          'REVISION_CONFLICT',
          `révision attendue ${options.expectedRevision}, révision courante ${current.revision}`,
        );
      }
      const next = service.buildUpdatedConfig(current, { emergencyDisable: true }, actor);
      await service.applyConfig(next, actor, reason || 'emergency-disable', 'settings.emergency_enable');
      try {
        await writeCache(next);
        await publishEvent({ type: 'config', revision: next.revision, emergency: true, by: safeLabel(actor) });
        localConfig = next;
        localRevision = next.revision;
      } catch (error) {
        markFailClosed('cache d’arrêt d’urgence non publié', error);
      }
      if (!redisReady) {
        localFail('REDIS_UNAVAILABLE', 'arrêt d’urgence persisté mais non propagé (fail-closed local)');
      }
      info('arrêt d’urgence activé', { epoch, by: safeLabel(actor) });
      return next;
    }

    const current = await service.getConfig();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new SeasonalThemeValidationError(
        'REVISION_CONFLICT',
        `révision attendue ${options.expectedRevision}, révision courante ${current.revision}`,
      );
    }
    const next = service.buildUpdatedConfig(current, { emergencyDisable: false }, actor);
    // La base est mise à jour avant l'effacement du drapeau Redis : on ne
    // réactive jamais une décoration avant que la source de vérité le permette.
    await service.applyConfig(next, actor, reason || 'emergency-disable:off', 'settings.emergency_disable');
    try {
      await ping();
      if (typeof redis.del !== 'function') localFail('REDIS_ERROR', 'DEL indisponible');
      await redis.del(keys.emergency);
      localEmergency = null;
      await writeCache(next);
      await publishEvent({ type: 'emergency', emergency: false, epoch: null, revision: next.revision });
      localConfig = next;
      localRevision = next.revision;
    } catch (error) {
      markFailClosed('réactivation d’urgence non propagée', error);
      throw error;
    }
    info('arrêt d’urgence désactivé', { revision: next.revision, by: safeLabel(actor) });
    return next;
  }

  async function disableDecoration(decorationId, actor, reason, options = {}) {
    if (typeof decorationId !== 'string' || !cat.decorations.some((entry) => entry.id === decorationId)) {
      throw new SeasonalThemeValidationError('UNKNOWN_DECORATION', `décoration inconnue ${decorationId}`);
    }
    const current = await service.getConfig();
    const theme = current.themes.find((entry) => entry.decorations.some((decoration) => decoration.id === decorationId));
    if (!theme) {
      throw new SeasonalThemeValidationError('UNKNOWN_DECORATION', `décoration absente de la configuration ${decorationId}`);
    }
    return publish({
      themes: [{ id: theme.id, decorations: [{ id: decorationId, enabled: false }] }],
    }, actor, reason || 'decoration-disable', options);
  }

  /** Invalide le cache local Redis et force un rechargement depuis la base. */
  async function invalidateCache(actor, reason, options = {}) {
    assertReason(reason);
    await ping();
    const current = await service.getConfig();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new SeasonalThemeValidationError(
        'REVISION_CONFLICT',
        `révision attendue ${options.expectedRevision}, révision courante ${current.revision}`,
      );
    }
    invalidate();
    localEmergency = null;
    failClosed = false;
    if (typeof redis.del === 'function') {
      await redis.del(keys.config, keys.revision);
      // La clé d'urgence n'est jamais supprimée ici : sa présence est une
      // décision administrative, pas un simple cache.
      if (current.emergencyDisable) {
        await redis.set(keys.emergency, JSON.stringify({ epoch: Date.now(), revision: current.revision, source: 'database' }));
        localEmergency = { epoch: Date.now() };
      }
    }
    await publishEvent({ type: 'invalidate', revision: current.revision, by: safeLabel(actor) });
    info('cache invalidé', { revision: current.revision, by: safeLabel(actor) });
    return { success: true, revision: current.revision };
  }

  async function getResolved(context = {}) {
    const config = await getPublished();
    return resolveSeasonalTheme(config, context, cat);
  }

  function handleMessage(_channel, payload) {
    let event;
    try {
      event = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch {
      markFailClosed('événement pub/sub illisible');
      return;
    }
    if (!event || typeof event !== 'object') {
      markFailClosed('événement pub/sub invalide');
      return;
    }
    invalidate();
    // Un événement reçu prouve que le bus est vivant : on tente la recovery,
    // getPublished() refera toutes les vérifications fail-closed.
    failClosed = false;
    if (event.type === 'emergency' && event.emergency === true) {
      localEmergency = { epoch: event.epoch ?? Date.now(), fromBus: true };
    } else if (event.type === 'emergency' && event.emergency === false) {
      localEmergency = null;
    }
    if (typeof onEvent === 'function') {
      // Hook d'observation (tests/monitoring) : ne bloque pas le traitement.
      Promise.resolve(onEvent(event)).catch((error) => warn('hook onEvent en erreur', error));
    }
  }

  async function start() {
    if (stopped || subscribed || !subClient || typeof subClient.subscribe !== 'function') return false;
    subClient.on('message', handleMessage);
    subClient.on('error', (error) => markFailClosed('abonnement Redis en erreur', error));
    subClient.on('ready', () => {
      failClosed = false;
      invalidate();
    });
    await subClient.subscribe(channel);
    subscribed = true;
    info('abonnement de synchronisation actif', { channel });
    return true;
  }

  async function stop() {
    stopped = true;
    if (subClient && subscribed && typeof subClient.unsubscribe === 'function') {
      try { await subClient.unsubscribe(channel); } catch { /* fermeture en cours */ }
    }
    if (subClient && ownsSubscriber && typeof subClient.quit === 'function') {
      try { await subClient.quit(); } catch { /* fermeture en cours */ }
    }
    subscribed = false;
  }

  function getStatus() {
    return {
      failClosed,
      subscribed,
      localRevision: Math.max(0, localRevision),
      emergency: Boolean(localEmergency),
      channel,
    };
  }

  /** Sortie contrôlée du mode fail-closed après vérification effectuée. */
  async function recover() {
    invalidate();
    failClosed = false;
    const config = await getPublished();
    return { config, status: getStatus() };
  }

  return {
    start,
    stop,
    getPublished,
    getResolved,
    publish,
    setEmergencyDisable,
    disableDecoration,
    invalidateCache,
    recover,
    getStatus,
    keys,
    channel,
  };
}

module.exports = {
  SEASONAL_THEME_KEYS,
  SEASONAL_THEME_CHANNEL,
  SeasonalThemeSyncError,
  createSeasonalThemeSync,
};
