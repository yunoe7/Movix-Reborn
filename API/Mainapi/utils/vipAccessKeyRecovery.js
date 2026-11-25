'use strict';

const referralRules = require('./referralRules');

const DAY_MS = 24 * 60 * 60 * 1000;

function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildVipDurationLabel(vipYears) {
  const years = Number(vipYears);
  if (!Number.isFinite(years) || years <= 0) return null;
  const months = Math.max(1, Math.round(years * 12));
  if (months % 12 === 0) {
    const wholeYears = months / 12;
    return `${wholeYears} ${wholeYears > 1 ? 'ans' : 'an'}`;
  }
  return `${months} mois`;
}

function invoiceExpiry(deliveredAt, vipYears) {
  const delivered = toValidDate(deliveredAt);
  const years = Number(vipYears);
  if (!delivered || !Number.isFinite(years) || years <= 0) return null;
  const months = Math.max(1, Math.round(years * 12));
  const expires = new Date(delivered.getTime());
  expires.setMonth(expires.getMonth() + months);
  return Number.isNaN(expires.getTime()) ? null : expires.getTime();
}

/**
 * Rebuild only missing access-key rows from durable VIP history.
 * Existing access_keys rows are never overwritten (INSERT IGNORE).
 *
 * Delivered invoices are the source of truth for purchased VIP keys.
 * Redeemed referral rewards are also preserved. If a referral key belongs
 * to a delivered invoice, its earned days are added to that invoice expiry.
 * If it has no invoice, only the recorded referral days are reconstructed;
 * any older manually-issued base term cannot be inferred from that history.
 */
async function restoreMissingVipAccessKeys(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new Error('Pool MySQL invalide pour la restauration des clés VIP');
  }

  const [invoiceRows] = await pool.execute(
    `SELECT vip_key_value, vip_years, delivered_at
       FROM vip_invoices
      WHERE status = 'delivered'
        AND vip_key_value IS NOT NULL
        AND TRIM(vip_key_value) <> ''`
  );

  const [rewardRows] = await pool.execute(
    `SELECT access_key, days, redeemed_at
       FROM referral_rewards
      WHERE status = 'redeemed'
        AND access_key IS NOT NULL
        AND TRIM(access_key) <> ''
      ORDER BY redeemed_at ASC`
  );

  const invoiceKeys = new Map();
  let skippedInvoices = 0;

  for (const row of invoiceRows || []) {
    const key = String(row.vip_key_value || '').trim();
    const expiresAt = invoiceExpiry(row.delivered_at, row.vip_years);
    const duration = buildVipDurationLabel(row.vip_years);
    const deliveredAt = toValidDate(row.delivered_at);

    if (!key || expiresAt === null || !duration || !deliveredAt) {
      skippedInvoices += 1;
      continue;
    }

    const existing = invoiceKeys.get(key);
    if (!existing || expiresAt > existing.expiresAt) {
      invoiceKeys.set(key, {
        key,
        expiresAt,
        duration,
        createdAt: deliveredAt,
        source: null,
        referralDays: 0
      });
    }
  }

  const referralOnly = new Map();
  let skippedRewards = 0;

  for (const row of rewardRows || []) {
    const key = String(row.access_key || '').trim();
    const days = Math.floor(Number(row.days));
    const redeemedAt = toValidDate(row.redeemed_at);

    if (!key || !Number.isFinite(days) || days <= 0 || !redeemedAt) {
      skippedRewards += 1;
      continue;
    }

    const invoiceRecord = invoiceKeys.get(key);
    if (invoiceRecord) {
      // The original referral flow extends an active key from its current
      // expiration, or from the redemption time if that is later.
      invoiceRecord.expiresAt =
        Math.max(invoiceRecord.expiresAt, redeemedAt.getTime()) + days * DAY_MS;
      invoiceRecord.referralDays += days;
      continue;
    }

    if (!referralOnly.has(key)) {
      referralOnly.set(key, []);
    }
    referralOnly.get(key).push({ days, redeemedAt });
  }

  const records = [...invoiceKeys.values()];

  for (const [key, rewards] of referralOnly.entries()) {
    rewards.sort((a, b) => a.redeemedAt.getTime() - b.redeemedAt.getTime());

    let expiresAt = null;
    let totalDays = 0;
    for (const reward of rewards) {
      const redeemedMs = reward.redeemedAt.getTime();
      expiresAt = expiresAt === null
        ? redeemedMs + reward.days * DAY_MS
        : Math.max(expiresAt, redeemedMs) + reward.days * DAY_MS;
      totalDays += reward.days;
    }

    const createdAt = rewards[0]?.redeemedAt || null;
    const duration = referralRules.buildDurationLabel(totalDays);
    if (!createdAt || !duration || !Number.isFinite(expiresAt)) {
      skippedRewards += rewards.length;
      continue;
    }

    records.push({
      key,
      expiresAt,
      duration,
      createdAt,
      source: 'referral',
      referralDays: totalDays
    });
  }

  let restoredInvoiceKeys = 0;
  let restoredReferralKeys = 0;
  let alreadyPresent = 0;

  for (const record of records) {
    const [result] = await pool.execute(
      `INSERT IGNORE INTO access_keys
        (key_value, active, used, duree_validite, expires_at, source, created_at, updated_at)
       VALUES (?, 1, 0, ?, ?, ?, ?, NOW())`,
      [
        record.key,
        record.duration,
        record.expiresAt,
        record.source,
        record.createdAt
      ]
    );

    if (result?.affectedRows === 1) {
      if (record.source === 'referral') restoredReferralKeys += 1;
      else restoredInvoiceKeys += 1;
    } else {
      alreadyPresent += 1;
    }
  }

  const stats = {
    restoredInvoiceKeys,
    restoredReferralKeys,
    alreadyPresent,
    skippedInvoices,
    skippedRewards,
    invoiceHistoryRows: (invoiceRows || []).length,
    redeemedReferralRows: (rewardRows || []).length
  };

  console.log('[VIP recovery] completed', stats);
  return stats;
}

module.exports = { restoreMissingVipAccessKeys };
