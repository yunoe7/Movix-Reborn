import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceNamedFunction } from './helpers/sourceFunction.mjs';

const require = createRequire(import.meta.url);
const policy = require('../API/Mainapi/utils/syncPolicy.js');
const contract = JSON.parse(readFileSync(new URL('../shared/syncKeys.json', import.meta.url), 'utf8'));

test('la politique backend utilise exactement le contrat partagé', () => {
  assert.deepEqual([...policy.SYNCABLE_EXACT_KEYS].sort(), [...contract.exact].sort());
  assert.deepEqual([...policy.SYNCABLE_PREFIXES], contract.prefixes);
  assert.deepEqual([...policy.SERVER_MANAGED_SYNC_KEYS], contract.serverManaged);
  for (const key of contract.blocked) {
    assert.ok(policy.BLOCKED_SYNC_KEYS.has(key), `clé bloquée manquante côté backend: ${key}`);
  }
});

test('les clés métier sont synchronisables et is_vip ne l’est plus', () => {
  assert.equal(policy.isSyncableStorageKey('movixCalendarEntries'), true);
  assert.equal(policy.isSyncableStorageKey('favorite_movies'), true);
  assert.equal(policy.isSyncableStorageKey('is_vip'), false);
  assert.equal(policy.isSyncableStorageKey('__movix_sync_outbox'), false);
});

test('le frontend utilise le même contrat que le backend', () => {
  const frontendState = sourceNamedFunction('src/utils/syncStorage.ts', 'getStorageKeySyncState', {
    SYNCABLE_EXACT_KEYS: new Set(contract.exact),
    SYNCABLE_PREFIXES: contract.prefixes,
    BLOCKED_SYNC_KEYS: new Set(contract.blocked),
    SAFE_SYNC_KEY_PATTERN: /^[A-Za-z0-9:_-]{1,120}$/,
    exports: {}
  });

  const keys = [
    ...contract.exact,
    'player_brand',
    'progress_movie:42',
    ...contract.serverManaged,
    ...contract.blocked,
    'unknown_key'
  ];
  for (const key of keys) {
    assert.equal(
      frontendState(key),
      policy.isSyncableStorageKey(key) ? 'syncable' : policy.BLOCKED_SYNC_KEYS.has(key) ? 'blocked' : 'not_allowlisted',
      `décision divergente pour ${key}`
    );
  }
});
