'use strict';

/**
 * Source unique de résolution des droits staff (admin / uploader).
 *
 * Historiquement, chaque route modération reconstruisait son propre contrôle à
 * partir de la table `admins`. Les comptes reconnus via le bot Discord par
 * `middleware/auth.js` étaient donc refusés par ces routes alors que la porte
 * de l'admin les acceptait. Ce module centralise la décision sans jamais
 * faire confiance à une affirmation du client.
 *
 * Les erreurs Discord (code `DISCORD_*`) sont laissées à l'appelant : elles
 * doivent produire un 503, pas un refus silencieux ni un fail-open.
 */

const { getDiscordAdminRole } = require('./discordAdminRoles');

const DISCORD_STAFF_ROLES = new Set(['owner', 'admin', 'moderator', 'uploader']);

function normalizeStaffRole(role) {
  if (!role) return null;
  return role === 'owner' ? 'admin' : String(role);
}

async function resolveDiscordUserId(pool, userType, userId) {
  const candidate = String(userId || '').trim();
  if (/^\d{17,20}$/.test(candidate)) {
    return candidate;
  }

  if (!pool) return null;

  const [rows] = await pool.execute(
    "SELECT provider_user_id FROM account_links WHERE provider = 'discord' AND target_user_type = ? AND target_user_id = ? LIMIT 1",
    [userType === 'bip39' ? 'bip39' : 'oauth', candidate]
  );

  const discordUserId = String(rows[0]?.provider_user_id || '').trim();
  return /^\d{17,20}$/.test(discordUserId) ? discordUserId : null;
}

/**
 * @param {object} pool pool MySQL (déjà initialisé par l'appelant)
 * @param {{ userId: string, userType: string, authMethod?: string|null }} auth
 * @param {{ getDiscordAdminRole?: Function }} [options] injection de test
 * @returns {Promise<{role: string|null, source: 'discord'|'database', adminId: number|null}|null>}
 */
async function resolveStaffRole(pool, auth, options = {}) {
  if (!pool || !auth?.userId) return null;

  const resolveDiscordRole = options.getDiscordAdminRole || getDiscordAdminRole;

  if (auth.authMethod === 'discord') {
    const discordUserId = await resolveDiscordUserId(pool, auth.userType, auth.userId);
    const discordAccess = await resolveDiscordRole(discordUserId);
    if (discordAccess.configured) {
      const role = normalizeStaffRole(discordAccess.role);
      return {
        role: role && DISCORD_STAFF_ROLES.has(role) ? role : null,
        source: 'discord',
        adminId: null
      };
    }
  }

  const [rows] = await pool.execute(
    'SELECT id, role FROM admins WHERE user_id = ? AND auth_type = ?',
    [auth.userId, auth.userType === 'bip39' ? 'bip-39' : auth.userType]
  );

  if (rows.length === 0) return null;

  return {
    role: normalizeStaffRole(rows[0].role || 'admin'),
    source: 'database',
    adminId: rows[0].id ?? null
  };
}

module.exports = {
  DISCORD_STAFF_ROLES,
  normalizeStaffRole,
  resolveDiscordUserId,
  resolveStaffRole
};
