const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildInvoiceViewToken, isInvoiceViewTokenValid } = require('../vipDonations');

const KEYS = ['VIP_INVOICE_VIEW_SECRET', 'JWT_SECRET'];

function setEnv(t, values) {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

function hmac(secret, publicId) {
  return crypto.createHmac('sha256', secret).update(String(publicId)).digest('base64url');
}

test('le secret dédié émet, JWT_SECRET ne sert plus qu’à vérifier les anciens jetons', (t) => {
  setEnv(t, { VIP_INVOICE_VIEW_SECRET: 'dedicated-secret', JWT_SECRET: 'legacy-jwt-secret' });
  const token = buildInvoiceViewToken('invoice-123');

  assert.equal(token, hmac('dedicated-secret', 'invoice-123'));
  assert.equal(isInvoiceViewTokenValid('invoice-123', token), true);
  assert.equal(isInvoiceViewTokenValid('invoice-123', hmac('legacy-jwt-secret', 'invoice-123')), true);
  assert.equal(isInvoiceViewTokenValid('invoice-124', token), false);
});

test('sans secret dédié, le comportement historique JWT_SECRET est conservé', (t) => {
  setEnv(t, { JWT_SECRET: 'legacy-jwt-secret' });
  const token = buildInvoiceViewToken('invoice-123');

  assert.equal(token, hmac('legacy-jwt-secret', 'invoice-123'));
  assert.equal(isInvoiceViewTokenValid('invoice-123', token), true);
});

test('la rotation de JWT_SECRET n’invalide pas les jetons émis avec le secret dédié', (t) => {
  setEnv(t, { VIP_INVOICE_VIEW_SECRET: 'dedicated-secret', JWT_SECRET: 'old-jwt' });
  const legacyToken = hmac('old-jwt', 'invoice-123');
  const dedicatedToken = buildInvoiceViewToken('invoice-123');
  assert.equal(isInvoiceViewTokenValid('invoice-123', legacyToken), true);

  process.env.JWT_SECRET = 'rotated-jwt';
  assert.equal(isInvoiceViewTokenValid('invoice-123', dedicatedToken), true);
  assert.equal(buildInvoiceViewToken('invoice-123'), dedicatedToken);
  // Un jeton émis avant la configuration du secret dédié reste lié à
  // l'ancien JWT_SECRET : la rotation le rend invalide (cas transitoire).
  assert.equal(isInvoiceViewTokenValid('invoice-123', legacyToken), false);
});

test('sans secret, aucun jeton n’est émis ni accepté', (t) => {
  setEnv(t, {});
  assert.equal(buildInvoiceViewToken('invoice-123'), null);
  assert.equal(isInvoiceViewTokenValid('invoice-123', 'anything'), false);
});

test('un jeton altéré ou de mauvaise longueur est rejeté sans exception', (t) => {
  setEnv(t, { VIP_INVOICE_VIEW_SECRET: 'dedicated-secret' });
  assert.equal(isInvoiceViewTokenValid('invoice-123', 'short'), false);
  assert.equal(isInvoiceViewTokenValid('invoice-123', `${buildInvoiceViewToken('invoice-123')}x`), false);
});
