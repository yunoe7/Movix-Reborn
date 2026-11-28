'use strict';

/**
 * Routes du moteur décoratif saisonnier (LOT 1). Montage : app.use('/api', router).
 *
 * - GET   /seasonal-theme                       → configuration published (publique, no-store)
 * - GET   /admin/seasonal-theme                 → configuration complète (admin)
 * - PUT   /admin/seasonal-theme                 → patch partiel de configuration (admin)
 * - POST  /admin/seasonal-theme/emergency-disable → arrêt d'urgence (admin)
 * - GET   /admin/seasonal-theme/history         → snapshots (admin)
 * - GET   /admin/seasonal-theme/audit           → journal des actions (admin)
 *
 * Le moteur graphique et sa résolution restent au LOT 2 : ces routes ne
 * servent que la configuration et son historique.
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
  const config = await service.getConfig();
  return res.json({ success: true, config });
}));

router.get('/admin/seasonal-theme', ...mutationGuards.slice(0, 2), handle('lecture admin', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const config = await service.getConfig();
  return res.json({ success: true, config });
}));

router.put('/admin/seasonal-theme', ...mutationGuards, handle('mise à jour', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const config = await service.updateConfig(
    req.body?.patch,
    actorFrom(req),
    req.body?.reason,
  );
  return res.json({ success: true, config });
}));

router.post('/admin/seasonal-theme/emergency-disable', ...mutationGuards, handle('arrêt d’urgence', async (req, res) => {
  const service = requireService(res);
  if (!service) return;
  const config = await service.setEmergencyDisable(
    req.body?.enabled,
    actorFrom(req),
    req.body?.reason || 'emergency-disable',
  );
  return res.json({ success: true, config });
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
