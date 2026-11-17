'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getDiscordAdminRole,
  clearDiscordAdminRoleCache,
  getConfig,
} = require('../discordAdminRoles');

const ENV = {
  DISCORD_BOT_TOKEN: 'test-token',
  DISCORD_GUILD_ID: '12345678901234567',
  DISCORD_ADMIN_ROLE_IDS: '22222222222222222, 33333333333333333',
  DISCORD_UPLOADER_ROLE_IDS: '44444444444444444',
};
const USER_ID = '11111111111111111';
const MEMBER_URL = 'https://discord.com/api/v10/guilds/12345678901234567/members/' + USER_ID;

function fakeHttp(responseOrError) {
  const calls = [];
  return {
    calls,
    async get(url, config) {
      calls.push({ url, config });
      if (responseOrError instanceof Error) throw responseOrError;
      return { data: responseOrError };
    },
  };
}

test('Discord role check stays disabled until bot token and server ID are configured', async () => {
  clearDiscordAdminRoleCache();
  assert.equal(getConfig({}).configured, false);
  assert.deepEqual(await getDiscordAdminRole(USER_ID, { env: {} }), {
    configured: false,
    role: null,
  });
});

test('an admin Discord role grants admin', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['22222222222222222'] });
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });

  assert.deepEqual(result, { configured: true, role: 'admin' });
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, MEMBER_URL);
  assert.equal(http.calls[0].config.headers.Authorization, 'Bot test-token');
});

test('an uploader role grants uploader but not admin', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['44444444444444444'] });
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });

  assert.deepEqual(result, { configured: true, role: 'uploader' });
});

test('an ordinary member receives no admin role', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['55555555555555555'] });
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });

  assert.deepEqual(result, { configured: true, role: null });
});

test('a member outside the Discord server is denied', async () => {
  clearDiscordAdminRoleCache();
  const error = new Error('Not found');
  error.response = { status: 404 };
  const http = fakeHttp(error);
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });

  assert.deepEqual(result, { configured: true, role: null });
});

test('Discord API failures are fail-closed', async () => {
  clearDiscordAdminRoleCache();
  const error = new Error('Forbidden');
  error.response = { status: 403 };
  const http = fakeHttp(error);

  await assert.rejects(
    getDiscordAdminRole(USER_ID, { env: ENV, http }),
    { code: 'DISCORD_BOT_CONFIGURATION' }
  );
});

test('successful membership checks are cached briefly', async () => {
  clearDiscordAdminRoleCache();
  let calls = 0;
  const http = {
    async get() {
      calls += 1;
      return { data: { roles: ['22222222222222222'] } };
    },
  };

  await getDiscordAdminRole(USER_ID, { env: ENV, http, now: () => 1000 });
  await getDiscordAdminRole(USER_ID, { env: ENV, http, now: () => 2000 });
  assert.equal(calls, 1);
});
