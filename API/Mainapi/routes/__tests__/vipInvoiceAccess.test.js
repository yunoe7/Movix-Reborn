'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const FILE = path.resolve(__dirname, '../vipDonations.js');

const INVOICE = {
  public_id: 'inv_test_public_id',
  created_by_user_id: 'owner-1',
  created_by_user_type: 'oauth',
  recipient_mode: 'self',
  status: 'delivered',
  vip_key_value: 'VIP-SECRET-KEY'
};

function loadRouter({ auth = null, viewToken = null, invoice = INVOICE } = {}) {
  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = (ip) => ip;

  const serializePublicInvoice = (row, options = {}) => ({
    publicId: row.public_id,
    vipKey: options.includeVipKey ? row.vip_key_value : null
  });

  const dependencies = {
    express,
    'express-rate-limit': rateLimit,
    '../mysqlPool': { getPool: () => ({}) },
    '../middleware/auth': {
      isAdmin: (_req, _res, next) => next(),
      getAuthIfValid: async () => auth
    },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    '../utils/adminActionRateLimit': { createAdminActionLimiter: () => (_req, _res, next) => next() },
    '../utils/turnstile': { verifyTurnstileFromRequest: async () => ({ valid: true }) },
    '../utils/vipDonations': {
      createVipInvoice: async () => invoice,
      fetchInvoiceByPublicId: async () => invoice,
      refreshInvoiceStatus: async (_pool, row) => row,
      serializePublicInvoice,
      serializeAdminInvoice: serializePublicInvoice,
      buildInvoiceViewToken: () => 'valid-view-token',
      isInvoiceViewTokenValid: (_publicId, token) => token === 'valid-view-token',
      getClientIp: () => '203.0.113.7'
    },
    '../utils/vipDonationSettings': {
      VIP_DONATION_ERROR_CODES: {},
      getDefaultVipDonationSettings: () => ({}),
      getVipDonationAvailability: async () => ({}),
      loadVipDonationSettings: async () => ({}),
      saveVipDonationSettings: async () => ({}),
      validateSettingsInput: () => ({ valid: true })
    }
  };

  const sandboxModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    module: sandboxModule,
    exports: sandboxModule.exports,
    Buffer,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(name in dependencies, `Dépendance non isolée : ${name}`);
      return dependencies[name];
    }
  }, { filename: FILE });

  return sandboxModule.exports.router;
}

async function callGetInvoice(router, headers = {}) {
  const layer = router.stack.find(
    (entry) => entry.route?.path === '/vip/invoices/:publicId' && entry.route.methods.get
  );
  assert.ok(layer, 'Route GET /vip/invoices/:publicId absente');

  const req = {
    method: 'GET',
    body: {},
    query: {},
    params: { publicId: INVOICE.public_id },
    headers,
    ip: '203.0.113.7',
    protocol: 'https',
    get: () => 'api.movix.test'
  };
  const res = {
    statusCode: 200,
    body: undefined,
    set() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this; }
  };

  for (const handlerLayer of layer.route.stack) {
    let proceed = false;
    await handlerLayer.handle(req, res, () => { proceed = true; });
    if (!proceed) break;
  }
  return res;
}

test('a public invoice lookup never exposes the VIP key without owner proof', async () => {
  const router = loadRouter({ auth: null });
  const res = await callGetInvoice(router);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.vipKey, null);
});

test('a different authenticated account never exposes the VIP key', async () => {
  const router = loadRouter({ auth: { userId: 'other-user', userType: 'oauth' } });
  const res = await callGetInvoice(router);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.invoice.vipKey, null);
});

test('the invoice owner receives the delivered VIP key', async () => {
  const router = loadRouter({ auth: { userId: 'owner-1', userType: 'oauth' } });
  const res = await callGetInvoice(router);

  assert.equal(res.body.invoice.vipKey, 'VIP-SECRET-KEY');
});

test('the creation view token reveals the key for an anonymous creator', async () => {
  const router = loadRouter({ auth: null });
  const res = await callGetInvoice(router, { 'x-invoice-view-token': 'valid-view-token' });

  assert.equal(res.body.invoice.vipKey, 'VIP-SECRET-KEY');
});

test('an invalid view token is ignored', async () => {
  const router = loadRouter({ auth: null });
  const res = await callGetInvoice(router, { 'x-invoice-view-token': 'not-the-token' });

  assert.equal(res.body.invoice.vipKey, null);
});
