const test = require('node:test');
const assert = require('node:assert/strict');

const mockState = {
  existingColumns: new Set(),
  failAlter: false
};

const baseColumns = new Set([
  'id', 'user_id', 'user_type', 'profile_id', 'list_id', 'share_code',
  'created_at', 'updated_at'
]);

const allColumns = new Set([
  ...baseColumns,
  'is_public_in_catalog', 'moderation_flagged', 'moderation_reason',
  'moderation_details', 'moderated_at'
]);

function createMockPool() {
  const connection = {
    query: async (sql) => {
      if (String(sql).includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (String(sql).includes('RELEASE_LOCK')) return [[{ released: 1 }]];
      return [[]];
    },
    execute: async (sql) => {
      if (/CREATE TABLE/i.test(sql)) return [[]];
      if (/ALTER TABLE/i.test(sql)) {
        if (mockState.failAlter) {
          const err = new Error('boom');
          err.errno = 1234;
          throw err;
        }
        const match = String(sql).match(/ADD COLUMN (\w+)/i);
        const col = match ? match[1] : null;
        if (col && mockState.existingColumns.has(col)) {
          const err = new Error(`Duplicate column name '${col}'`);
          err.errno = 1060;
          throw err;
        }
        if (col) mockState.existingColumns.add(col);
        return [[]];
      }
      return [[]];
    },
    release: () => {}
  };

  return {
    getConnection: async () => connection,
    execute: async (sql, params) => connection.execute(sql, params),
    query: async (sql, params) => connection.query(sql, params)
  };
}

function installMocks() {
  const mysqlPoolPath = require.resolve('../../mysqlPool');
  const redisPath = require.resolve('../../config/redis');
  const sharedPath = require.resolve('../../sharedListsRoutes');

  require.cache[mysqlPoolPath] = {
    exports: {
      getPool: () => createMockPool(),
      withMysqlAdvisoryLock: async (poolInstance, lockName, task) => {
        const conn = await poolInstance.getConnection();
        try {
          return await task(conn);
        } finally {
          conn.release();
        }
      },
      SCHEMA_BOOTSTRAP_LOCK_NAME: 'test-lock'
    }
  };

  require.cache[redisPath] = {
    exports: {
      redis: {
        del: async () => {},
        set: async () => {},
        get: async () => null
      }
    }
  };

  delete require.cache[sharedPath];
}

test('migration from old schema adds all moderation columns', async () => {
  mockState.existingColumns = new Set(baseColumns);
  mockState.failAlter = false;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();
  for (const col of ['is_public_in_catalog', 'moderation_flagged', 'moderation_reason', 'moderation_details', 'moderated_at']) {
    assert.ok(mockState.existingColumns.has(col), `missing column ${col}`);
  }
});

test('migration from partial schema adds only missing columns', async () => {
  mockState.existingColumns = new Set([...baseColumns, 'is_public_in_catalog']);
  mockState.failAlter = false;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();
  for (const col of ['moderation_flagged', 'moderation_reason', 'moderation_details', 'moderated_at']) {
    assert.ok(mockState.existingColumns.has(col), `missing column ${col}`);
  }
});

test('migration on up-to-date schema is idempotent', async () => {
  mockState.existingColumns = new Set(allColumns);
  mockState.failAlter = false;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();
  await router.initSharedListsTable();
  assert.equal(mockState.existingColumns.size, allColumns.size);
});

test('migration propagates non-duplicate SQL errors', async () => {
  mockState.existingColumns = new Set(baseColumns);
  mockState.failAlter = true;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await assert.rejects(() => router.initSharedListsTable());
  mockState.failAlter = false;
});
