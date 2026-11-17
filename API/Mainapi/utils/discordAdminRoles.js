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
  const guildId = String(env.DISCORD_GUILD_ID || '').trim();

  return {
    botToken,
    guildId,
    adminRoleIds: parseRoleIds(env.DISCORD_ADMIN_ROLE_IDS),
    uploaderRoleIds: parseRoleIds(env.DISCORD_UPLOADER_ROLE_IDS),
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
 * Returns the highest Movix role granted by Discord for this member.
 * An unconfigured bot leaves the legacy MySQL allowlist unchanged.
 * When configured, Discord is authoritative for Discord-authenticated sessions.
 */
async function getDiscordAdminRole(userId, options = {}) {
  const env = options.env || process.env;
  const http = options.http || axios;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const config = getConfig(env);

  if (!config.configured) {
    return { configured: false, role: null };
  }

  const discordUserId = String(userId || '').trim();
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return { configured: true, role: null };
  }

  const allowedRoleIds = new Set([...config.adminRoleIds, ...config.uploaderRoleIds]);
  if (allowedRoleIds.size === 0) {
    return { configured: true, role: null };
  }

  const cacheKey = config.guildId + ':' + discordUserId;
  const cachedRole = readCache(cacheKey, now());
  if (cachedRole !== undefined) {
    return { configured: true, role: cachedRole };
  }

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

    if (status === 401 || status === 403) {
      throw createDiscordError('DISCORD_BOT_CONFIGURATION');
    }
    if (status === 429) {
      throw createDiscordError('DISCORD_RATE_LIMITED');
    }

    throw createDiscordError('DISCORD_API_UNAVAILABLE');
  }
}

function clearDiscordAdminRoleCache() {
  memberCache.clear();
}

module.exports = {
  getDiscordAdminRole,
  clearDiscordAdminRoleCache,
  getConfig,
};
