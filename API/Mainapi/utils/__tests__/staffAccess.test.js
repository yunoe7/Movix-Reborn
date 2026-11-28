'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveStaffRole, resolveDiscordUserId } = require('../staffAccess');

function poolWithAdminRows(rows, calls = []) {
  return {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('account_links')) return [rows];
      return [rows];
    }
  };
}

test('resolveStaffRole reads the admin role from the database', async () => {
  const calls = [];
  const pool = poolWithAdminRows([{ id: 7, role: 'admin' }], calls);

  const result = await resolveStaffRole(pool, { userId: 'user-1', userType: 'oauth' });

  assert.deepEqual(result, { role: 'admin', source: 'database', adminId: 7 });
  assert.equal(calls[0].params[1], 'oauth');
});

test('resolveStaffRole preserves legacy rows without a role and maps bip39 identifiers', async () => {
  const calls = [];
  const pool = poolWithAdminRows([{ id: 9, role: null }], calls);

  const result = await resolveStaffRole(pool, { userId: 'user-2', userType: 'bip39' });

  assert.equal(result.role, 'admin');
  assert.equal(calls[0].params[1], 'bip-39');
});

test('resolveStaffRole rejects accounts absent from the admins table', async () => {
  const result = await resolveStaffRole(poolWithAdminRows([]), {
    userId: 'user-3',
    userType: 'oauth'
  });

  assert.equal(result, null);
});

test('resolveStaffRole keeps the uploader role distinct from admin', async () => {
  const result = await resolveStaffRole(poolWithAdminRows([{ id: 3, role: 'uploader' }]), {
    userId: 'user-4',
    userType: 'oauth'
  });

  assert.deepEqual(result, { role: 'uploader', source: 'database', adminId: 3 });
});

test('a configured Discord admin is accepted without an admins row', async () => {
  const pool = poolWithAdminRows([]);
  const seen = [];

  const result = await resolveStaffRole(
    pool,
    { userId: '123456789012345678', userType: 'oauth', authMethod: 'discord' },
    {
      getDiscordAdminRole: async (discordUserId) => {
        seen.push(discordUserId);
        return { configured: true, role: 'admin' };
      }
    }
  );

  assert.deepEqual(result, { role: 'admin', source: 'discord', adminId: null });
  assert.deepEqual(seen, ['123456789012345678']);
});

test('Discord owner is normalized to the admin role', async () => {
  const result = await resolveStaffRole(
    poolWithAdminRows([]),
    { userId: '123456789012345678', userType: 'oauth', authMethod: 'discord' },
    { getDiscordAdminRole: async () => ({ configured: true, role: 'owner' }) }
  );

  assert.equal(result.role, 'admin');
});

test('Discord moderator and uploader keep their narrower role', async () => {
  const moderator = await resolveStaffRole(
    poolWithAdminRows([]),
    { userId: '123456789012345678', userType: 'oauth', authMethod: 'discord' },
    { getDiscordAdminRole: async () => ({ configured: true, role: 'moderator' }) }
  );
  const uploader = await resolveStaffRole(
    poolWithAdminRows([]),
    { userId: '123456789012345678', userType: 'oauth', authMethod: 'discord' },
    { getDiscordAdminRole: async () => ({ configured: true, role: 'uploader' }) }
  );

  assert.equal(moderator.role, 'moderator');
  assert.equal(uploader.role, 'uploader');
});

test('when Discord is not configured the database remains authoritative', async () => {
  const result = await resolveStaffRole(
    poolWithAdminRows([{ id: 12, role: 'admin' }]),
    { userId: 'user-5', userType: 'oauth', authMethod: 'discord' },
    { getDiscordAdminRole: async () => ({ configured: false, role: null }) }
  );

  assert.deepEqual(result, { role: 'admin', source: 'database', adminId: 12 });
});

test('Discord infrastructure errors are propagated to the caller', async () => {
  const error = new Error('Discord unavailable');
  error.code = 'DISCORD_API_UNAVAILABLE';

  await assert.rejects(
    resolveStaffRole(
      poolWithAdminRows([]),
      { userId: '123456789012345678', userType: 'oauth', authMethod: 'discord' },
      { getDiscordAdminRole: async () => { throw error; } }
    ),
    (caught) => caught.code === 'DISCORD_API_UNAVAILABLE'
  );
});

test('resolveDiscordUserId resolves linked OAuth accounts', async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ provider_user_id: '123456789012345678' }]];
    }
  };

  const result = await resolveDiscordUserId(pool, 'oauth', 'google-user');

  assert.equal(result, '123456789012345678');
  assert.equal(calls[0].params[0], 'oauth');
  assert.equal(calls[0].params[1], 'google-user');
});
