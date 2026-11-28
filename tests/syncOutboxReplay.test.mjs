import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceNamedFunction } from './helpers/sourceFunction.mjs';

const OUTBOX_KEY = '__movix_sync_outbox';
const isSyncOutboxPayload = sourceNamedFunction('src/context/ProfileContext.tsx', 'isSyncOutboxPayload');

function fixture({ response = { success: true }, error = null, account = { userType: 'oauth', userId: 'user-1' } } = {}) {
  const values = new Map();
  const localStorage = {
    get length() { return values.size; },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
  const calls = [];
  const axios = {
    post: async (url, payload, config) => {
      calls.push({ url, payload, config });
      if (error) throw error;
      return { data: response };
    }
  };
  const replay = sourceNamedFunction('src/context/ProfileContext.tsx', 'replayOutboxIfAny', {
    localStorage,
    SYNC_OUTBOX_STORAGE_KEY: OUTBOX_KEY,
    SYNC_OUTBOX_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    isSyncOutboxPayload,
    isSyncableStorageKey: (key) => typeof key === 'string' && !key.startsWith('legacy_') && key !== 'is_vip',
    getResolvedAccountContext: () => account,
    axios,
    API_URL: 'https://api.test',
    console: { warn() {}, log() {}, error() {} }
  });
  return { values, localStorage, calls, replay };
}

function seed(payload, values) {
  values.set('auth_token', 'test-token');
  values.set(OUTBOX_KEY, JSON.stringify({ ...payload, ts: Date.now() }));
}

function httpError(status, message) {
  return { response: { status, data: { error: message } } };
}

test('un rejeu partiel ne conserve que les opérations réellement rejetées', async () => {
  const f = fixture({ response: { success: true, partial: true, rejected: [{ index: 1, code: 'INVALID_SYNC_KEY' }] } });
  seed({
    userType: 'oauth',
    profileId: 'profile-1',
    userId: 'user-1',
    ops: [
      { op: 'set', key: 'user_language', value: 'fr' },
      { op: 'set', key: 'legacy_key', value: 'drop' },
      { op: 'set', key: 'favorite_movies', value: '[]' }
    ]
  }, f.values);

  await f.replay();

  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].payload.ops.map((op) => op.key), ['user_language', 'favorite_movies']);
  const remaining = JSON.parse(f.values.get(OUTBOX_KEY));
  assert.deepEqual(remaining.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(remaining.profileId, 'profile-1');
});

test('un rejeu intégralement réussi vide l’outbox', async () => {
  const f = fixture();
  seed({
    userType: 'oauth',
    profileId: 'profile-1',
    userId: 'user-1',
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }, f.values);

  await f.replay();

  assert.equal(f.values.has(OUTBOX_KEY), false);
});

test('une outbox sans userId n’est pas rejouée sous une autre identité', async () => {
  const f = fixture({ account: { userType: 'oauth', userId: 'user-2' } });
  seed({ userType: 'oauth', profileId: 'profile-1', ops: [{ op: 'set', key: 'user_language', value: 'fr' }] }, f.values);

  await f.replay();

  assert.equal(f.calls.length, 0, 'aucune opération ne doit partir avec le token du compte courant');
  assert.equal(f.values.has(OUTBOX_KEY), true, 'l’outbox du propriétaire légitime doit rester intacte');
});

test('une outbox appartenant à un autre compte du même type reste inactive', async () => {
  const f = fixture({ account: { userType: 'bip39', userId: 'user-2' } });
  seed({
    userType: 'bip39', profileId: 'profile-1', userId: 'user-1',
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }, f.values);

  await f.replay();

  assert.equal(f.calls.length, 0);
  assert.equal(JSON.parse(f.values.get(OUTBOX_KEY)).userId, 'user-1');
});

test('un refus d’appartenance du profil ne supprime pas l’outbox', async () => {
  const f = fixture({ error: httpError(403, 'Profile does not belong to this user') });
  seed({
    userType: 'oauth', profileId: 'profile-1', userId: 'user-1',
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }, f.values);

  await f.replay();

  assert.equal(f.calls.length, 1);
  assert.equal(f.values.has(OUTBOX_KEY), true, 'un 403 d’appartenance est conservé pour le propriétaire légitime');
});

test('une requête mal formée reste supprimée comme erreur permanente', async () => {
  const f = fixture({ error: httpError(400, 'INVALID_SYNC_OP') });
  seed({
    userType: 'oauth', profileId: 'profile-1', userId: 'user-1',
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }, f.values);

  await f.replay();

  assert.equal(f.values.has(OUTBOX_KEY), false);
});
