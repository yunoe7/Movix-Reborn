const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionSyncOps, isSyncableStorageKey } = require('../syncPolicy.js');

test('un lot valide est conservé même si une opération du milieu est refusée', () => {
  const result = partitionSyncOps([
    { op: 'set', key: 'user_language', value: 'fr' },
    { op: 'set', key: 'is_vip', value: 'true' },
    { op: 'arrayAdd', key: 'favorite_movies', value: { type: 'movie', id: 42 } }
  ]);

  assert.equal(result.ops.length, 2);
  assert.equal(result.ops[0].key, 'user_language');
  assert.equal(result.ops[1].key, 'favorite_movies');
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].index, 1);
  assert.equal(result.rejected[0].code, 'INVALID_SYNC_KEY');
});

test('les erreurs globales restent bloquantes', () => {
  assert.throws(() => partitionSyncOps('nope'), (error) => error.code === 'INVALID_OPS');
  assert.throws(() => partitionSyncOps(new Array(201).fill({ op: 'remove', key: 'user_language' })), (error) => error.code === 'TOO_MANY_OPS');
});

test('la clé VIP n’est plus writable par le client', () => {
  assert.equal(isSyncableStorageKey('is_vip'), false);
});
