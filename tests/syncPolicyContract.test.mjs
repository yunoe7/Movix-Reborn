import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceNamedFunction } from './helpers/sourceFunction.mjs';

const require = createRequire(import.meta.url);
const policy = require('../API/Mainapi/utils/syncPolicy.js');
const contract = JSON.parse(readFileSync(new URL('../API/Mainapi/shared/syncKeys.json', import.meta.url), 'utf8'));

const SYNC_STORAGE = 'src/utils/syncStorage.ts';
const getPermanentSyncRejectionCodes = sourceNamedFunction(SYNC_STORAGE, 'getPermanentSyncRejectionCodes');
const getRetryableSyncStatusCodes = sourceNamedFunction(SYNC_STORAGE, 'getRetryableSyncStatusCodes');
const sharedPolicyBindings = { getPermanentSyncRejectionCodes, getRetryableSyncStatusCodes };
const sharedIsPermanentSyncRejection = sourceNamedFunction(SYNC_STORAGE, 'isPermanentSyncRejection', sharedPolicyBindings);
const sharedIsRetryableSyncRejection = sourceNamedFunction(SYNC_STORAGE, 'isRetryableSyncRejection', sharedPolicyBindings);

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

test('is_vip est rejeté explicitement et reste lisible par un ancien client', () => {
  const { rejected } = policy.partitionSyncOps([{ op: 'set', key: 'is_vip', value: 'true' }]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].index, 0);
  assert.equal(rejected[0].code, 'INVALID_SYNC_KEY', 'le code historique ne doit pas changer pour les anciens clients');
  assert.match(rejected[0].message, /serveur|server/i);
  assert.equal(rejected[0].serverManagedRejected, true);

  const buildSyncResponse = sourceNamedFunction('API/Mainapi/routes/sync.js', 'buildSyncResponse', {
    SYNC_LIMITS: policy.SYNC_LIMITS,
    SERVER_MANAGED_SYNC_KEYS: policy.SERVER_MANAGED_SYNC_KEYS
  });
  const response = buildSyncResponse({ bytes: 12, keyCount: 1 }, rejected);

  assert.equal(response.success, true, 'un ancien client doit toujours voir succès + partial');
  assert.equal(response.partial, true);
  assert.equal(response.rejected[0].index, 0);
  assert.deepEqual(response.serverManagedRejected, ['is_vip']);

  const readme = readFileSync(new URL('../API/Mainapi/README.md', import.meta.url), 'utf8');
  assert.match(readme, /serverManagedRejected/);
  assert.match(readme, /is_vip/);
  assert.match(readme, /code historique .*INVALID_SYNC_KEY/, 'la compatibilité ascendante doit être documentée');
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

test('les codes permanents et statuts retryables viennent de syncStorage, pas de copies locales', () => {
  const permanentCodes = getPermanentSyncRejectionCodes();
  const retryableStatuses = getRetryableSyncStatusCodes();

  for (const code of [
    'INVALID_SYNC_KEY', 'INVALID_OP', 'VALUE_TOO_LARGE', 'TOO_MANY_OPS',
    'PROFILE_QUOTA_EXCEEDED', 'SERVER_MANAGED_KEY_REJECTED'
  ]) {
    assert.ok(permanentCodes.has(code), `code permanent manquant dans la source partagée: ${code}`);
  }
  for (const status of [401, 403, 404, 408, 429]) {
    assert.ok(retryableStatuses.has(status), `statut retryable manquant dans la source partagée: ${status}`);
  }

  assert.equal(sharedIsPermanentSyncRejection(413, 'VALUE_TOO_LARGE'), true);
  assert.equal(sharedIsPermanentSyncRejection(429, 'RATE_LIMITED'), false, '429 reste rejouable');
  assert.equal(sharedIsRetryableSyncRejection({ status: 401 }), true);
  assert.equal(sharedIsRetryableSyncRejection({ status: 503 }), true);
  assert.equal(sharedIsRetryableSyncRejection({ status: 400, code: 'INVALID_SYNC_KEY' }), false);
  assert.equal(sharedIsRetryableSyncRejection({ status: 400, code: 'SERVER_MANAGED_KEY_REJECTED' }), false);
});
