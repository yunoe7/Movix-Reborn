const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStaffRole, normalizeStaffRole } = require('../staffAccess');

function poolWithAdminRow(row) {
  return {
    async execute(sql) {
      if (String(sql).includes('FROM admins')) return [row ? [row] : []];
      return [[]];
    },
  };
}

function discordRole(role, configured = true) {
  return async () => ({ configured, role });
}

const DISCORD_ID = '123456789012345678';

test('rôles Discord canoniques et owner normalisé', async () => {
  for (const [role, expected] of [
    ['owner', 'admin'],
    ['admin', 'admin'],
    ['moderator', 'moderator'],
    ['uploader', 'uploader'],
  ]) {
    const staff = await resolveStaffRole(
      poolWithAdminRow(null),
      { userId: DISCORD_ID, userType: 'oauth', authMethod: 'discord' },
      { getDiscordAdminRole: discordRole(role) },
    );
    assert.equal(staff.role, expected, `Discord ${role}`);
    assert.equal(staff.source, 'discord');
  }
});

test('un compte Google lié à un Discord admin n’hérite pas de ce rôle', async () => {
  const staff = await resolveStaffRole(
    poolWithAdminRow(null),
    { userId: 'google-user', userType: 'oauth', authMethod: 'google' },
    { getDiscordAdminRole: discordRole('admin') },
  );
  assert.equal(staff, null);
});

test('Discord configuré sans rôle ne replie pas sur la table admins', async () => {
  const staff = await resolveStaffRole(
    poolWithAdminRow({ id: 7, role: 'admin' }),
    { userId: DISCORD_ID, userType: 'oauth', authMethod: 'discord' },
    { getDiscordAdminRole: discordRole(null) },
  );
  assert.equal(staff.role, null);
  assert.equal(staff.source, 'discord');
});

test('table admins : owner devient admin, moderator/uploader restent distincts', async () => {
  for (const [role, expected] of [
    ['owner', 'admin'],
    ['admin', 'admin'],
    ['moderator', 'moderator'],
    ['uploader', 'uploader'],
    [null, 'admin'],
  ]) {
    const staff = await resolveStaffRole(
      poolWithAdminRow({ id: 7, role }),
      { userId: 'user-42', userType: 'oauth', authMethod: 'google' },
    );
    assert.equal(staff.role, expected, `DB ${role}`);
    assert.equal(staff.source, 'database');
  }
  assert.equal(normalizeStaffRole('owner'), 'admin');
});

test('les erreurs Discord sont propagées (aucun fail-open)', async () => {
  await assert.rejects(
    resolveStaffRole(
      poolWithAdminRow({ id: 7, role: 'admin' }),
      { userId: DISCORD_ID, userType: 'oauth', authMethod: 'discord' },
      { getDiscordAdminRole: async () => { throw Object.assign(new Error('Discord indisponible'), { code: 'DISCORD_API_UNAVAILABLE' }); } },
    ),
    { code: 'DISCORD_API_UNAVAILABLE' },
  );
});
