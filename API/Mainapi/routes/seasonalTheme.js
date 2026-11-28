'use strict';

/**
 * Routes du moteur décoratif saisonnier (LOT 1). Montage : app.use('/api', router).
 *
 * - GET   /seasonal-theme                       → configuration publiée (publique, no-store)
 * - GET   /seasonal-theme/resolve               → vue résolue déterministe (publique)
 * - GET   /admin/seasonal-theme                 → configuration complète (admin)
 * - PUT   /admin/seasonal-theme                 → publication d'un patch (admin)
 * - POST  /admin/seasonal-theme/decorations/disable → désactivation ciblée (admin)
 * - POST  /admin/seasonal-theme/emergency-disable → arrêt d'urgence (admin)
 * - POST  /admin/seasonal-theme/cache/invalidate → invalidation du cache (admin)
 * - GET   /admin/seasonal-theme/status          → état de synchronisation (admin)
 * - GET   /admin/seasonal-theme/history         → snapshots (admin)
 * - GET   /admin/seasonal-theme/audit           → journal des actions (admin)
 *
 * Lorsque le runtime de synchronisation est monté (`app.locals.seasonalThemeSync`),
 * toutes les lectures passent par lui : panne Redis, cache incohérent ou arrêt
 * d'urgence produisent une configuration désactivée (fail-closed). En son
 * absence, les routes conservent le comportement de lecture directe du LOT 1.
 */

const express = require('express');

const { isAdmin } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const { createAdminActionLimiter } = require('../utils/adminActionRateLimit');
const {
  SeasonalThemeValidationError,
  createSeasonalThemeService,
} = require('../services/seasonalThemeConfig');

const router = express.Router();

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

// Le limiteur partagé lit `req.user`, posé par les routes communautaires.
// `isAdmin` pose `req.admin` : on lui donne la même identité authentifiée
// avant le limiteur, sans jamais faire confiance à un en-tête client.
function exposeAdminIdentityToLimiter(req, res, next) {
  if (!req.user && req.admin) {
    req.user = { userId: req.admin.userId, userType: req.admin.userType };
  }
  return next();
}

const mutationLimiter = createAdminActionLimiter('seasonal-theme', 30);
const mutationGuards = [setNoStore, isAdmin, exposeAdminIdentityToLimiter, mutationLimiter];

function fail(res, status, code, error) {
  return res.status(status).json({ success: false, code, error });
}

function getSync(req) {
  return req.app?.locals?.seasonalThemeSync || null;
}

function requireSync(req, res) {
  const sync = getSync(req);
  if (!sync) {
    fail(res, 503, 'SYNC_UNAVAILABLE', 'Synchronisation décorative non initialisée');
    return null;
  }
  return sync;
}

function requireService(res) {
  const pool = getPool();
  if (!pool) {
    fail(res, 503, 'DB_UNAVAILABLE', 'Base de données indisponible, réessayez plus tard');
    return null;
  }
  return createSeasonalThemeService({ pool });
}

function actorFrom(req) {
  return {
    adminId: req.admin?.adminId || req.admin?.userId || 'system',
    userId: req.admin?.userId,
    userType: req.admin?.userType,
  };
}

function handle(label, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof SeasonalThemeValidationError) {
        return fail(res, 400, error.code, error.detail);
      }
      if (error?.name === 'SeasonalThemeSyncError') {
        const status = ['EMERGENCY_ACTIVE', 'REVISION_CONFLICT'].includes(error.code) ? 409 : 503;
        return fail(res, status, error.code, error.detail);
      }
      console.error(`[Décor saisonnier] ${label} :`, error?.message || error);
      if (!res.headersSent) {
        return fail(res, 500, 'SERVER_ERROR', 'Erreur de configuration décorative, réessayez plus tard');
      }
    }
  };
}

router.get('/seasonal-theme', setNoStore, handle('lecture publique', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const sync = getSync(req);
  const config = sync ? await sync.getPublished() : await service.getConfig();
  return res.json({ success: true, config });
}));

router.get('/seasonal-theme/resolve', setNoStore, handle('résolution publique', async (req, res) => {
  const sync = requireSync(req, res);
  if (!sync) return;
  const service = requireService(res);
  if (!service) return;
  const platform = req.query?.platform || 'desktop';
  if (!service.catalog.platforms.includes(platform)) {
    return fail(res, 400, 'UNKNOWN_PLATFORM', `plateforme inconnue ${platform}`);
  }
  const requested = typeof req.query?.capabilities === 'string'
    ? req.query.capabilities.split(',').filter(Boolean)
    : [];
  for (const capability of requested) {
    if (!service.catalog.capabilities.includes(capability)) {
      return fail(res, 400, 'UNKNOWN_CAPABILITY', `capacité inconnue ${capability}`);
    }
  }
  const at = req.query?.at;
  if (at !== undefined && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) {
    return fail(res, 400, 'INVALID_DATE', 'paramètre at invalide');
  }
  const context = {
    platform,
    capabilities: requested,
    now: at || undefined,
  };
  return res.json({ success: true, resolved: await sync.getResolved(context) });
}));

router.get('/admin/seasonal-theme', ...mutationGuards.slice(0, 2), handle('lecture admin', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const sync = getSync(req);
  const config = sync ? await sync.getPublished() : await service.getConfig();
  return res.json({ success: true, config });
}));

router.put('/admin/seasonal-theme', ...mutationGuards, handle('mise à jour', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const sync = getSync(req);
  const options = { expectedRevision: req.body?.expectedRevision };
  const config = sync
    ? await sync.publish(req.body?.patch, actorFrom(req), req.body?.reason, options)
    : await service.updateConfig(req.body?.patch, actorFrom(req), req.body?.reason);
  return res.json({ success: true, config });
}));

router.post('/admin/seasonal-theme/decorations/disable', ...mutationGuards, handle('désactivation décoration', async (req, res) => {
  const sync = requireSync(req, res);
  if (!sync) return;
  const config = await sync.disableDecoration(
    req.body?.decorationId,
    actorFrom(req),
    req.body?.reason,
    { expectedRevision: req.body?.expectedRevision },
  );
  return res.json({ success: true, config });
}));

router.post('/admin/seasonal-theme/emergency-disable', ...mutationGuards, handle('arrêt d’urgence', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const sync = getSync(req);
  const enabled = req.body?.enabled;
  const reason = req.body?.reason || 'emergency-disable';
  const options = { expectedRevision: req.body?.expectedRevision };
  const config = sync
    ? await sync.setEmergencyDisable(enabled, actorFrom(req), reason, options)
    : await service.setEmergencyDisable(enabled, actorFrom(req), reason);
  return res.json({ success: true, config });
}));

router.post('/admin/seasonal-theme/cache/invalidate', ...mutationGuards, handle('invalidation cache', async (req, res) => {
  const sync = requireSync(req, res);
  if (!sync) return;
  const invalidation = await sync.invalidateCache(
    actorFrom(req),
    req.body?.reason,
    { expectedRevision: req.body?.expectedRevision },
  );
  return res.json({ success: true, invalidation });
}));

router.get('/admin/seasonal-theme/status', ...mutationGuards.slice(0, 2), handle('état synchronisation', async (req, res) => {
  const sync = requireSync(req, res);
  if (!sync) return;
  return res.json({ success: true, status: sync.getStatus() });
}));

router.get('/admin/seasonal-theme/history', ...mutationGuards.slice(0, 2), handle('historique', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const limit = req.query?.limit === undefined ? 20 : Number(req.query.limit);
  const history = await service.getHistory({ limit });
  return res.json({ success: true, history });
}));

router.get('/admin/seasonal-theme/audit', ...mutationGuards.slice(0, 2), handle('audit', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const limit = req.query?.limit === undefined ? 50 : Number(req.query.limit);
  const audit = await service.getAuditLog({ limit });
  return res.json({ success: true, audit });
}));

module.exports = { router };
