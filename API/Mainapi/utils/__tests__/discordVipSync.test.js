'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractAccessCode,
  isAccessKeyActive,
  getAccountVipState,
} = require('../discordVipSync');

const link = { target_user_type: 'oauth', target_user_id: 'account-1' };

test('access code accepts a JSON-encoded string and plain string', () => {
  assert.equal(extractAccessCode({ access_code: '"VIP-123"' }), 'VIP-123');
  assert.equal(extractAccessCode({ access_code: 'VIP-123' }), 'VIP-123');
  assert.equal(extractAccessCode({ access_code: '' }), '');
});

test('access key expiration is checked in milliseconds and invalid dates fail closed', () => {
  const now = 1_800_000_000_000;
  assert.equal(isAccessKeyActive({ active: 1, expires_at: now + 1000 }, now), true);
  assert.equal(isAccessKeyActive({ active: 1, expires_at: now - 1000 }, now), false);
  assert.equal(isAccessKeyActive({ active: 1, expires_at: 'not-a-date' }, now), false);
  assert.equal(isAccessKeyActive({ active: 0, expires_at: null }, now), false);
});

test('account data read errors propagate instead of revoking VIP', async () => {
  const readError = new Error('disk unavailable');
  await assert.rejects(
    getAccountVipState({ execute: async () => { throw new Error('must not query'); } }, link, {
      readUserData: async (_type, _id, options) => {
        assert.equal(options.strict, true);
        throw readError;
      },
    }),
    readError
  );
});

test('profile data read errors propagate instead of revoking VIP', async () => {
  const readError = new Error('profile unreadable');
  await assert.rejects(
    getAccountVipState({ execute: async () => { throw new Error('must not query'); } }, link, {
      readUserData: async () => ({ profiles: [{ id: 'default', isDefault: true }] }),
      readProfileData: async (_type, _id, _profileId, options) => {
        assert.equal(options.strict, true);
        throw readError;
      },
    }),
    readError
  );
});

test('a missing access key is a non-VIP account only after successful reads', async () => {
  const pool = { async execute() { throw new Error('must not query without a key'); } };
  const active = await getAccountVipState(pool, link, {
    readUserData: async () => ({ profiles: [] }),
  });
  assert.equal(active, false);
});

test('VIP state is read from the access_keys table', async () => {
  const pool = {
    async execute(sql, params) {
      assert.match(sql, /FROM access_keys/);
      assert.deepEqual(params, ['VIP-123']);
      return [[{ active: 1, expires_at: null }]];
    },
  };
  const active = await getAccountVipState(pool, link, {
    readUserData: async () => ({ access_code: 'VIP-123', profiles: [] }),
  });
  assert.equal(active, true);
});
