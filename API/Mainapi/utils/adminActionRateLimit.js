'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { createRedisRateLimitStore } = require('./redisRateLimitStore');

/**
 * Limiteur partagé pour les actions administratives destructrices
 * (suppressions, rejets en masse, validation/annulation de factures).
 *
 * Décisions de sécurité (Lot 3) :
 * - la clé est l'identité authentifiée du staff (`req.user`, posé par
 *   requireAuth / requireAdmin / isAdmin) et non un en-tête `cf-connecting-ip`
 *   ou `x-forwarded-for` que le client peut forger ;
 * - les limiteurs sont placés APRÈS l'authentification : un anonyme ne consomme
 *   pas le quota d'une IP partagée (NAT) et reçoit directement son 401 ;
 * - en cas de panne Redis, le mode par défaut est `closed` (503 explicite) pour
 *   ces actions destructrices. `onStoreError: 'open'` restaure le fail-open
 *   historique de façon explicite et documentée.
 *
 * @param {string} prefix préfixe Redis du bucket
 * @param {number} limit nombre d'actions autorisées par fenêtre
 * @param {number} windowMs fenêtre en millisecondes
 * @param {{ store?: object, onStoreError?: 'open'|'closed' }} [options]
 */
function createAdminActionLimiter(prefix, limit = 60, windowMs = 60 * 1000, options = {}) {
  const onStoreError = options.onStoreError === 'open' ? 'open' : 'closed';
  const store = options.store || createRedisRateLimitStore({
    prefix: `rate-limit:admin:${prefix}:`,
    onError: onStoreError,
  });

  const limiter = rateLimit({
    windowMs,
    limit,
    store,
    passOnStoreError: onStoreError === 'open',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (req.user?.userId) {
        return `u:${req.user.userType || 'unknown'}:${String(req.user.userId)}`;
      }
      // Repli uniquement pour un appel sans session : l'adresse socket/Express
      // reste la seule source non forgée, avec agrégation IPv6.
      if (req.ip) return ipKeyGenerator(req.ip);
      return 'anonymous';
    },
    validate: { xForwardedForHeader: false, ip: false, keyGeneratorIpFallback: false },
  });

  // express-rate-limit transmet les erreurs de store à `next(err)` quand
  // `passOnStoreError` est faux. On les transforme en 503 stable, sans exposer
  // le message Redis au client.
  return (req, res, next) => limiter(req, res, (error) => {
    if (!error) return next();
    console.error(`[admin-rate-limit:${prefix}] store indisponible :`, error.message);
    return res.status(503).json({ error: 'Service temporairement indisponible - limitation des actions' });
  });
}

module.exports = { createAdminActionLimiter };
