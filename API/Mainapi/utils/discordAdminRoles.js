'use strict';

const axios = require('axios');

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const REQUEST_TIMEOUT_MS = 5000;
const MEMBER_CACHE_TTL_MS = 30 * 1000;
const MEMBER_CACHE_MAX_ENTRIES = 5000;
const memberCache = new Map();

function parseRoleIds(raw) {
  return String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{17,20}$/.test(value));
}

function getConfig(env = process.env) {
  const botToken = String(env.DISCORD_BOT_TOKEN || '').trim();
  const guildId = String(env.DISCORD_GUILD_ID || '1570056496471867483').trim();
  const ownerUserId = String(env.DISCORD_OWNER_USER_ID || '1239889177055596607').trim();
  const adminRoleIds = parseRoleIds(env.DISCORD_ADMIN_ROLE_IDS || '1570072172104261732');
  const moderatorRoleIds = parseRoleIds(env.DISCORD_MODERATOR_ROLE_IDS || '1570312607988977667');
  const uploaderRoleIds = parseRoleIds(env.DISCORD_UPLOADER_ROLE_IDS);
  const vipRoleId = String(env.DISCORD_VIP_ROLE_ID || '').trim();

  return {
    botToken,
    guildId,
    ownerUserId,
    adminRoleIds,
    moderatorRoleIds,
    uploaderRoleIds,
    vipRoleId: /^\\d{17,20}$/.test(vipRoleId) ? vipRoleId : '',
    vipConfigured: Boolean(botToken && /^\\d{17,20}$/.test(String(env.DISCORD_GUILD_ID || '').trim()) && /^\\d{17,20}$/.test(vipRoleId)),
    configured: Boolean(botToken && /^\d{17,20}$/.test(guildId)),
  };
}

function readCache(key, now) {
  const entry = memberCache.get(key);
  if (!entry) return undefined;
  if (now - entry.timestamp >= MEMBER_CACHE_TTL_MS) {
    memberCache.delete(key);
    return undefined;
  }
  memberCache.delete(key);
  memberCache.set(key, entry);
  return entry.role;
}

function writeCache(key, role, now) {
  if (!memberCache.has(key) && memberCache.size >= MEMBER_CACHE_MAX_ENTRIES) {
    const oldestKey = memberCache.keys().next().value;
    if (oldestKey !== undefined) memberCache.delete(oldestKey);
  }
  memberCache.set(key, { role, timestamp: now });
}

function createDiscordError(code) {
  const error = new Error('Discord role verification is unavailable');
  error.code = code;
  return error;
}

/**
 * Returns the highest Movix role granted by Discord.
 * Owner is explicit and does not depend on Discord API availability.
 * Admin and moderator map to the Movix admin capability; uploader remains separate.
 */
async function getDiscordAdminRole(userId, options = {}) {
  const env = options.env || process.env;
  const http = options.http || axios;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const config = getConfig(env);
  const discordUserId = String(userId || '').trim();

  if (!/^\d{17,20}$/.test(discordUserId)) {
    return { configured: Boolean(config.configured), role: null };
  }
  if (discordUserId === config.ownerUserId) {
    return { configured: true, role: 'owner' };
  }
  if (!config.configured) {
    return { configured: false, role: null };
  }

  const allowedRoleIds = new Set([
    ...config.adminRoleIds,
    ...config.moderatorRoleIds,
    ...config.uploaderRoleIds,
  ]);
  if (allowedRoleIds.size === 0) {
    return { configured: true, role: null };
  }

  const cacheKey = config.guildId + ':' + discordUserId;
  const cachedRole = readCache(cacheKey, now());
  if (cachedRole !== undefined) return { configured: true, role: cachedRole };

  try {
    const response = await http.get(
      DISCORD_API_BASE + '/guilds/' + config.guildId + '/members/' + discordUserId,
      {
        headers: { Authorization: 'Bot ' + config.botToken },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const memberRoles = Array.isArray(response.data?.roles)
      ? response.data.roles.map(String)
      : [];

    let role = null;
    if (config.adminRoleIds.some((roleId) => memberRoles.includes(roleId))) {
      role = 'admin';
    } else if (config.moderatorRoleIds.some((roleId) => memberRoles.includes(roleId))) {
      role = 'moderator';
    } else if (config.uploaderRoleIds.some((roleId) => memberRoles.includes(roleId))) {
      role = 'uploader';
    }

    writeCache(cacheKey, role, now());
    return { configured: true, role };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404) {
      writeCache(cacheKey, null, now());
      return { configured: true, role: null };
    }
    if (status === 401 || status === 403) throw createDiscordError('DISCORD_BOT_CONFIGURATION');
    if (status === 429) throw createDiscordError('DISCORD_RATE_LIMITED');
    throw createDiscordError('DISCORD_API_UNAVAILABLE');
  }
}


/**
 * Adds or removes the Movix VIP role for a Discord guild member.
 * This operation is intentionally uncached; Discord remains the source of truth.
 */
async function setDiscordVipRole(userId, active, options = {}) {
  const env = options.env || process.env;
  const http = options.http || axios;
  const config = getConfig(env);
  const discordUserId = String(userId || '').trim();

  if (!/^\\d{17,20}$/.test(discordUserId)) {
    const error = new Error('Invalid Discord user ID');
    error.code = 'DISCORD_INVALID_USER';
    throw error;
  }
  if (typeof active !== 'boolean') {
    const error = new Error('VIP role state must be boolean');
    error.code = 'DISCORD_INVALID_ROLE_STATE';
    throw error;
  }
  if (!config.vipConfigured) {
    const error = new Error('Discord VIP role synchronization is not configured');
    error.code = 'DISCORD_VIP_NOT_CONFIGURED';
    throw error;
  }

  const url = DISCORD_API_BASE + '/guilds/' + config.guildId +
    '/members/' + discordUserId + '/roles/' + config.vipRoleId;
  try {
    if (active) {
      await http.put(url, null, {
        headers: { Authorization: 'Bot ' + config.botToken },
        timeout: REQUEST_TIMEOUT_MS,
      });
    } else {
      await http.delete(url, {
        headers: { Authorization: 'Bot ' + config.botToken },
        timeout: REQUEST_TIMEOUT_MS,
      });
    }
    memberCache.delete(config.guildId + ':' + discordUserId);
    return { configured: true, active };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404) {
      // A user who left the guild has no role to update; treat removal as complete.
      if (!active) return { configured: true, active: false, memberMissing: true };
      const wrapped = createDiscordError('DISCORD_MEMBER_NOT_FOUND');
      throw wrapped;
    }
    if (status === 401 || status === 403) throw createDiscordError('DISCORD_BOT_CONFIGURATION');
    if (status === 429) throw createDiscordError('DISCORD_RATE_LIMITED');
    throw createDiscordError('DISCORD_API_UNAVAILABLE');
  }
}

function clearDiscordAdminRoleCache() {
  memberCache.clear();
}

module.exports = {
  getDiscordAdminRole,
  setDiscordVipRole,
  clearDiscordAdminRoleCache,
  getConfig,
};
