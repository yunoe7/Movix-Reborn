'use strict';

const { getPool } = require('../mysqlPool');
const { setDiscordVipRole, getConfig } = require('./discordAdminRoles');
const { ensureAccountLinksStorage } = require('./accountLinks');

const LOCK_NAME = 'movix:discord-vip-reconcile:v1';
const INTERVAL_MS = Math.max(60_000, Number(process.env.DISCORD_VIP_SYNC_INTERVAL_MS) || 5 * 60_000);
let timer = null;
let running = false;

function extractAccessCode(source) {
  const raw = source && source.access_code;
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const value = raw.trim();
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed.trim() : value;
  } catch {
    return value;
  }
}

function isAccessKeyActive(row, now = Date.now()) {
  if (!row || !(row.active === true || Number(row.active) === 1)) return false;
  if (row.expires_at === null || row.expires_at === undefined || row.expires_at === '') return true;
  const raw = row.expires_at;
  let expiry = raw instanceof Date ? raw.getTime()
    : (typeof raw === 'number' || /^-?\d+$/.test(String(raw).trim()))
      ? Number(raw) : new Date(raw).getTime();
  return Number.isFinite(expiry) && now < expiry;
}

async function getAccountVipState(pool, link, options = {}) {
  // Charger les lecteurs uniquement si nécessaire : évite d'importer les routes
  // Express (et leur configuration JWT) lors des tests avec lecteurs injectés.
  const readUser = options.readUserData || ((...args) => require('../routes/sync').readUserData(...args));
  const readProfile = options.readProfileData || ((...args) => require('../routes/sync').readProfileData(...args));
  const userData = await readUser(link.target_user_type, link.target_user_id, { strict: true });
  if (!userData || typeof userData !== 'object') throw new Error('Linked account data unavailable');
  const profiles = Array.isArray(userData.profiles) ? userData.profiles : [];
  const profile = profiles.find((item) => item && item.isDefault) || profiles[0] || null;
  const profileData = profile?.id
    ? await readProfile(link.target_user_type, link.target_user_id, profile.id, { strict: true })
    : null;
  const key = extractAccessCode(profileData) || extractAccessCode(userData);
  if (!key) return false;
  const [rows] = await pool.execute(
    'SELECT active, expires_at FROM access_keys WHERE key_value = ? LIMIT 1',
    [key]
  );
  const active = isAccessKeyActive(rows[0]);
  if (active) {
    await pool.execute('UPDATE access_keys SET used = 1 WHERE key_value = ? AND used = 0', [key]);
  }
  return active;
}

async function syncDiscordVipForAccount(discordUserId, options = {}) {
  const pool = options.pool || getPool();
  const [rows] = await pool.execute(
    'SELECT provider_user_id, target_user_type, target_user_id FROM account_links WHERE provider = ? AND provider_user_id = ? LIMIT 1',
    ['discord', String(discordUserId)]
  );
  const link = rows[0];
  if (!link) {
    await setDiscordVipRole(discordUserId, false, options);
    return { linked: false, active: false };
  }
  const active = await getAccountVipState(pool, link);
  await setDiscordVipRole(discordUserId, active, options);
  return { linked: true, active };
}

async function reconcileDiscordVipRoles(options = {}) {
  const config = getConfig(options.env || process.env);
  if (!config.vipConfigured) return { skipped: true, reason: 'not_configured', checked: 0 };
  const pool = options.pool || getPool();
  await ensureAccountLinksStorage();
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) return { skipped: true, reason: 'already_running', checked: 0 };
    const [links] = await connection.execute(
      "SELECT provider_user_id, target_user_type, target_user_id FROM account_links WHERE provider = 'discord'"
    );
    let checked = 0;
    let failed = 0;
    for (const link of links) {
      try {
        const active = await getAccountVipState(pool, link);
        await setDiscordVipRole(link.provider_user_id, active, options);
        checked += 1;
      } catch (error) {
        failed += 1;
        console.error('[Discord VIP Sync] Account reconciliation failed:', error.code || error.message);
      }
    }
    return { skipped: false, checked, failed };
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (_) {}
    }
    connection.release();
  }
}

function startDiscordVipReconciliation(options = {}) {
  if (timer) return timer;
  const config = getConfig(options.env || process.env);
  if (!config.vipConfigured) {
    console.log('[Discord VIP Sync] Disabled: bot, guild or VIP role is not configured');
    return null;
  }
  const run = () => {
    if (running) return;
    running = true;
    reconcileDiscordVipRoles(options)
      .then((result) => {
        if (!result.skipped) console.log('[Discord VIP Sync] Reconciled:', result.checked, 'failed:', result.failed);
      })
      .catch((error) => console.error('[Discord VIP Sync] Reconciliation failed:', error.code || error.message))
      .finally(() => { running = false; });
  };
  timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  run();
  return timer;
}

function stopDiscordVipReconciliation() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  extractAccessCode,
  isAccessKeyActive,
  getAccountVipState,
  syncDiscordVipForAccount,
  reconcileDiscordVipRoles,
  startDiscordVipReconciliation,
  stopDiscordVipReconciliation,
};
