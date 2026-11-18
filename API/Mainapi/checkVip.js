/**
 * checkVip.js - Module centralisé de vérification VIP
 * 
 * Vérifie la validité d'une clé d'accès VIP en interrogeant la table `access_keys` MySQL.
 * Utilisé par : liveTvRoutes, wishboardRoutes, commentsRoutes, server.js (fstream), etc.
 * 
 * Le frontend envoie la clé via le header `x-access-key`.
 * Le serveur vérifie que la clé existe, est active et non expirée.
 */

const { getPool } = require('./mysqlPool');
const { LruMap } = require('./utils/lruMap');

// Cache en mémoire pour éviter de spammer MySQL à chaque requête
// TTL de 5 minutes — si une clé est révoquée, il faut max 5 min pour que ça prenne effet
// LRU-capped because the cache key is the user-supplied `x-access-key` header:
// without a cap, a spammer sending random header values could grow the map
// unboundedly within the 5-min cleanup window.
const VIP_CACHE_MAX_ENTRIES = 5000;
const vipCache = new LruMap({ max: VIP_CACHE_MAX_ENTRIES });
const VIP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes maximum
const VIP_CACHE_NEGATIVE_TTL = 60 * 1000; // 1 minute

function cacheVipResult(key, result, options = {}) {
    const now = Date.now();
    const ttl = Number.isFinite(options.ttl)
        ? Math.max(0, Math.min(VIP_CACHE_TTL, options.ttl))
        : (result.vip ? VIP_CACHE_TTL : VIP_CACHE_NEGATIVE_TTL);

    vipCache.set(key, { result, timestamp: now, ttl });
}

function parseExpiryTimestamp(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'bigint') {
        const timestamp = Number(value);
        return Number.isSafeInteger(timestamp) ? timestamp : null;
    }
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    if (/^-?[0-9]+$/.test(normalized)) {
        const timestamp = Number(normalized);
        return Number.isSafeInteger(timestamp) ? timestamp : null;
    }

    const timestamp = new Date(normalized).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Vérifie si une clé d'accès est valide dans la table `access_keys` MySQL.
 * 
 * @param {string} accessKey - La clé d'accès à vérifier
 * @returns {Promise<{vip: boolean, expiresAt: string|null, duration: string|null}>}
 */
async function verifyAccessKey(accessKey) {
    // Pas de clé = pas VIP
    if (!accessKey || typeof accessKey !== 'string' || accessKey.trim() === '') {
        return { vip: false, expiresAt: null, duration: null };
    }

    const trimmedKey = accessKey.trim();

    // Fix encoding: HTTP headers carry non-ASCII bytes as Latin-1.
    // Node stores them as-is in the string, so 0xe9 (é) stays as \xe9.
    // Convert Latin-1 bytes → Buffer → UTF-8 string to recover proper Unicode.
    let fixedKey = trimmedKey;
    try {
        const buf = Buffer.from(trimmedKey, 'latin1');
        const decoded = buf.toString('utf8');
        // Only use the fixed version if it's valid UTF-8 (no replacement chars)
        if (!decoded.includes('\ufffd')) {
            fixedKey = decoded;
        }
    } catch (e) {
        // Encoding fix failed, use original
    }

    // Vérifier le cache d'abord
    const cached = vipCache.get(fixedKey);
    if (cached) {
        const cacheTtl = Number.isFinite(cached.ttl) ? cached.ttl : VIP_CACHE_TTL;
        if (Date.now() - cached.timestamp < cacheTtl) {
            return cached.result;
        }
        vipCache.delete(fixedKey);
    }

    try {
        const pool = getPool();
        if (!pool) {
            console.warn('[checkVip] MySQL pool not available');
            return { vip: false, expiresAt: null, duration: null };
        }

        const [rows] = await pool.execute(
            'SELECT key_value, active, expires_at, duree_validite FROM access_keys WHERE key_value = ? LIMIT 1',
            [fixedKey]
        );

        if (rows.length === 0) {
            // Clé inexistante — mettre en cache le résultat négatif (durée plus courte: 1 min)
            const result = { vip: false, expiresAt: null, duration: null };
            cacheVipResult(fixedKey, result);
            return result;
        }

        const keyData = rows[0];

        // Vérifier si la clé est active
        if (!keyData.active) {
            const result = { vip: false, expiresAt: null, duration: null, reason: 'key_inactive' };
            cacheVipResult(fixedKey, result);
            return result;
        }

        // Vérifier l'expiration en millisecondes (format stocké dans MySQL).
        // Une expiration invalide est refusée par sécurité au lieu d'être traitée comme une clé à vie.
        const hasExpiry = keyData.expires_at !== null
            && keyData.expires_at !== undefined
            && keyData.expires_at !== '';
        const expiresAtMs = hasExpiry ? parseExpiryTimestamp(keyData.expires_at) : null;
        if (hasExpiry && (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs)) {
            const result = { vip: false, expiresAt: keyData.expires_at, duration: keyData.duree_validite, reason: 'key_expired' };
            cacheVipResult(fixedKey, result);
            return result;
        }

        // Clé valide : son cache positif ne peut pas survivre à son expiration.
        const result = {
            vip: true,
            expiresAt: keyData.expires_at || null,
            duration: keyData.duree_validite || null
        };
        // Une clé est marquée utilisée dès sa première validation réelle.
        // Le champ used est un indicateur d'utilisation, pas un verrou de consommation.
        try {
            await pool.execute('UPDATE access_keys SET used = 1 WHERE key_value = ? AND used = 0', [fixedKey]);
        } catch (markError) {
            console.warn('[checkVip] Unable to mark access key as used:', markError.message);
        }

        const now = Date.now();
        const ttlUntilExpiry = expiresAtMs === null ? VIP_CACHE_TTL : expiresAtMs - now;
        cacheVipResult(fixedKey, result, { ttl: ttlUntilExpiry });
        return result;

    } catch (error) {
        console.error('[checkVip] Error verifying access key:', error.message);
        // En cas d'erreur DB, ne pas bloquer — retourner non-VIP
        return { vip: false, expiresAt: null, duration: null };
    }
}

/**
 * Middleware Express qui extrait la clé du header `x-access-key`
 * et attache le résultat VIP à `req.vipStatus`.
 * 
 * Usage: router.get('/route', vipMiddleware, (req, res) => { ... })
 * Puis accéder à req.vipStatus.vip (boolean)
 */
async function vipMiddleware(req, res, next) {
    const accessKey = req.headers['x-access-key'] || null;
    req.vipStatus = await verifyAccessKey(accessKey);
    next();
}

/**
 * Middleware Express qui BLOQUE l'accès si l'utilisateur n'est pas VIP.
 * Renvoie 403 si la clé est absente ou invalide.
 * 
 * Usage: router.get('/vip-only-route', requireVip, (req, res) => { ... })
 */
async function requireVip(req, res, next) {
    const accessKey = req.headers['x-access-key'] || null;
    const vipStatus = await verifyAccessKey(accessKey);
    req.vipStatus = vipStatus;

    if (!vipStatus.vip) {
        return res.status(403).json({
            success: false,
            error: 'Accès réservé aux membres VIP',
            reason: vipStatus.reason || 'no_valid_key'
        });
    }
    next();
}

// Nettoyage périodique du cache VIP — supprime les entrées expirées pour éviter les fuites mémoire
setInterval(() => {
    const now = Date.now();
    for (const [key, cached] of vipCache) {
        const cacheTtl = Number.isFinite(cached.ttl) ? cached.ttl : VIP_CACHE_TTL;
        if (now - cached.timestamp >= cacheTtl) {
            vipCache.delete(key);
        }
    }
}, VIP_CACHE_TTL).unref(); // Nettoyage toutes les 5 minutes

/**
 * Invalider le cache pour une clé spécifique (utile quand un admin révoque une clé)
 * @param {string} accessKey
 */
function normalizeVipKey(accessKey) {
    if (!accessKey || typeof accessKey !== 'string') return null;
    const trimmedKey = accessKey.trim();
    if (!trimmedKey) return null;
    let fixedKey = trimmedKey;
    try {
        const buf = Buffer.from(trimmedKey, 'latin1');
        const decoded = buf.toString('utf8');
        if (!decoded.includes('\\ufffd')) {
            fixedKey = decoded;
        }
    } catch (e) {
        // Encoding fix failed, use original
    }
    return fixedKey;
}

function invalidateVipCache(accessKey) {
    const key = normalizeVipKey(accessKey);
    if (key) {
        vipCache.delete(key);
    }
}

/**
 * Invalider tout le cache VIP (utile pour un flush global)
 */
function invalidateAllVipCache() {
    vipCache.clear();
}

module.exports = {
    verifyAccessKey,
    vipMiddleware,
    requireVip,
    invalidateVipCache,
    invalidateAllVipCache
};
