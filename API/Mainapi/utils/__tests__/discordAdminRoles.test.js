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
  DISCORD_GUILD_ID: '1570056496471867483',
  DISCORD_OWNER_USER_ID: '1239889177055596607',
  DISCORD_ADMIN_ROLE_IDS: '1570072172104261732',
  DISCORD_MODERATOR_ROLE_IDS: '1570312607988977667',
  DISCORD_UPLOADER_ROLE_IDS: '44444444444444444',
};
const USER_ID = '11111111111111111';
const MEMBER_URL = 'https://discord.com/api/v10/guilds/1570056496471867483/members/' + USER_ID;

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
  assert.deepEqual(await getDiscordAdminRole(USER_ID, { env: {} }), { configured: false, role: null });
});

test('configured owner always receives owner access without an API call', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: [] });
  const result = await getDiscordAdminRole('1239889177055596607', { env: {}, http });
  assert.deepEqual(result, { configured: true, role: 'owner' });
  assert.equal(http.calls.length, 0);
});

test('the configured admin role grants admin', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['1570072172104261732'] });
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });
  assert.deepEqual(result, { configured: true, role: 'admin' });
  assert.equal(http.calls[0].url, MEMBER_URL);
  assert.equal(http.calls[0].config.headers.Authorization, 'Bot test-token');
});

test('the configured moderator role grants moderator, not owner', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['1570312607988977667'] });
  const result = await getDiscordAdminRole(USER_ID, { env: ENV, http });
  assert.deepEqual(result, { configured: true, role: 'moderator' });
});

test('uploader remains a separate, limited role', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['44444444444444444'] });
  assert.deepEqual(await getDiscordAdminRole(USER_ID, { env: ENV, http }), { configured: true, role: 'uploader' });
});

test('ordinary member is denied', async () => {
  clearDiscordAdminRoleCache();
  const http = fakeHttp({ roles: ['55555555555555555'] });
  assert.deepEqual(await getDiscordAdminRole(USER_ID, { env: ENV, http }), { configured: true, role: null });
});

test('non-member is denied', async () => {
  clearDiscordAdminRoleCache();
  const error = new Error('Not found');
  error.response = { status: 404 };
  assert.deepEqual(await getDiscordAdminRole(USER_ID, { env: ENV, http: fakeHttp(error) }), { configured: true, role: null });
});

test('Discord API failures are fail-closed', async () => {
  clearDiscordAdminRoleCache();
  const error = new Error('Forbidden');
  error.response = { status: 403 };
  await assert.rejects(getDiscordAdminRole(USER_ID, { env: ENV, http: fakeHttp(error) }), { code: 'DISCORD_BOT_CONFIGURATION' });
});

test('successful membership checks are cached briefly', async () => {
  clearDiscordAdminRoleCache();
  let calls = 0;
  const http = { async get() { calls += 1; return { data: { roles: ['1570072172104261732'] } }; } };
  await getDiscordAdminRole(USER_ID, { env: ENV, http, now: () => 1000 });
  await getDiscordAdminRole(USER_ID, { env: ENV, http, now: () => 2000 });
  assert.equal(calls, 1);
});
