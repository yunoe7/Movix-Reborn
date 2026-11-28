import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceNamedFunction } from './helpers/sourceFunction.mjs';

const OUTBOX_KEY = '__movix_sync_outbox';

function fixture(response) {
  const values = new Map();
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
  const calls = [];
  const axios = {
    post: async (url, payload, config) => {
      calls.push({ url, payload, config });
      return { data: response };
    }
  };
  const replay = sourceNamedFunction('src/context/ProfileContext.tsx', 'replayOutboxIfAny', {
    localStorage,
    SYNC_OUTBOX_STORAGE_KEY: OUTBOX_KEY,
    SYNC_OUTBOX_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    isSyncOutboxPayload: (value) => Boolean(value && typeof value === 'object'
      && Array.isArray(value.ops) && value.ops.length > 0
      && typeof value.profileId === 'string'),
    isSyncableStorageKey: (key) => typeof key === 'string' && !key.startsWith('legacy_') && key !== 'is_vip',
    getResolvedAccountContext: () => ({ userType: 'oauth', userId: 'user-1' }),
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

test('un rejeu partiel ne conserve que les opérations réellement rejetées', async () => {
  const f = fixture({ success: true, partial: true, rejected: [{ index: 1, code: 'INVALID_SYNC_KEY' }] });
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
  const f = fixture({ success: true });
  seed({
    userType: 'oauth',
    profileId: 'profile-1',
    userId: 'user-1',
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }, f.values);

  await f.replay();

  assert.equal(f.values.has(OUTBOX_KEY), false);
});
