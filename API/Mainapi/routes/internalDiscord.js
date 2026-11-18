const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../mysqlPool');
const { getLinkedTarget } = require('../utils/accountLinks');
const { readUserData, readProfileData } = require('./sync');

const router = express.Router();

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

function isAccessKeyActive(key, now = Date.now()) {
  if (!key || !(key.active === true || Number(key.active) === 1)) return false;
  if (key.expires_at === null || key.expires_at === undefined || key.expires_at === '') return true;
  const raw = key.expires_at;
  const expiry = raw instanceof Date ? raw.getTime()
    : (typeof raw === 'number' || /^-?\\d+$/.test(String(raw).trim()))
      ? Number(raw) : new Date(raw).getTime();
  return Number.isFinite(expiry) && now < expiry;
}

function serializeExpiry(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const raw = String(value).trim();
  if (/^-?\\d+$/.test(raw)) {
    const numeric = Number(raw);
    const date = new Date(numeric);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

function isAuthorized(req, expectedSecret) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

// GET /api/internal/discord/member?discordId=<Discord user ID>
// Endpoint privé en lecture seule : ne modifie ni comptes, ni profils, ni rôles.
router.post('/member', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const secret = String(process.env.MOVIX_DISCORD_SYNC_SECRET || '');
  if (!secret) {
    return res.status(503).json({ success: false, error: 'Discord sync is not configured' });
  }
  if (!isAuthorized(req, secret)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const discordId = String(req.body?.discordUserId || '').trim();
  if (!/^\d{17,20}$/.test(discordId)) {
    return res.status(400).json({ success: false, error: 'Invalid Discord user ID' });
  }

  try {
    const link = await getLinkedTarget('discord', discordId);
    if (!link) {
      return res.status(200).json({ success: true, linked: false, vip: { active: false } });
    }

    const userData = await readUserData(link.targetUserType, link.targetUserId);
    if (!userData || typeof userData !== 'object') {
      throw new Error('Linked account data is unavailable');
    }

    const profiles = Array.isArray(userData.profiles) ? userData.profiles : [];
    const defaultProfile = profiles.find((profile) => profile && profile.isDefault) || profiles[0] || null;
    let profileData = null;
    if (defaultProfile && defaultProfile.id) {
      profileData = await readProfileData(link.targetUserType, link.targetUserId, defaultProfile.id);
    }

    const accessCode = extractAccessCode(profileData) || extractAccessCode(userData);
    let active = false;\n    let expiresAt = null;

    if (accessCode) {
      const pool = getPool();
      if (!pool) throw new Error('MySQL pool is unavailable');
      const [rows] = await pool.execute(
        'SELECT active, expires_at FROM access_keys WHERE key_value = ? LIMIT 1',
        [accessCode]
      );
      const key = rows[0];
      active = isAccessKeyActive(key);
      expiresAt = key ? serializeExpiry(key.expires_at) : null;
    }

    return res.status(200).json({
      success: true,
      linked: true,
      vip: { active, expiresAt: active ? expiresAt : null },
    });
  } catch (error) {
    console.error('[Discord Sync] Member lookup failed:', error.message);
    return res.status(503).json({ success: false, error: 'Member status temporarily unavailable' });
  }
});

module.exports = router;
