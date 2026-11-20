const test = require('node:test');
const assert = require('node:assert/strict');

const mockState = {
  existingColumns: new Set(),
  failAlter: false,
  adminRows: [],
  total: 0,
  stats: { total: 0, public_count: 0, moderated_count: 0 }
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

test('migration on up-to-date schema has exactly the expected columns', async () => {
  mockState.existingColumns = new Set(allColumns);
  mockState.failAlter = false;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();
  assert.deepEqual([...mockState.existingColumns].sort(), [...allColumns].sort());
});

test('migration on partial schema results in exactly the expected columns', async () => {
  mockState.existingColumns = new Set([...baseColumns, 'is_public_in_catalog']);
  mockState.failAlter = false;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();
  assert.deepEqual([...mockState.existingColumns].sort(), [...allColumns].sort());
});

test('repeated initialization with module cache reset tolerates duplicate columns', async () => {
  mockState.existingColumns = new Set(allColumns);
  mockState.failAlter = false;
  installMocks();
  const router1 = require('../../sharedListsRoutes');
  await router1.initSharedListsTable();
  delete require.cache[require.resolve('../../sharedListsRoutes')];
  const router2 = require('../../sharedListsRoutes');
  await router2.initSharedListsTable();
  assert.deepEqual([...mockState.existingColumns].sort(), [...allColumns].sort());
});

test('migration propagates non-duplicate SQL errors', async () => {
  mockState.existingColumns = new Set(baseColumns);
  mockState.failAlter = true;
  installMocks();
  const router = require('../../sharedListsRoutes');
  await assert.rejects(() => router.initSharedListsTable());
  mockState.failAlter = false;
});

test('admin public route returns JSON and HTTP 200', async () => {
  mockState.existingColumns = new Set(allColumns);
  mockState.failAlter = false;
  mockState.adminRows = [];
  mockState.total = 0;
  mockState.stats = { total: 0, public_count: 0, moderated_count: 0 };

  installMocks();

  const mysqlPoolPath = require.resolve('../../mysqlPool');
  const customPool = {
    getConnection: async () => ({
      query: async (sql) => {
        if (String(sql).includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (String(sql).includes('RELEASE_LOCK')) return [[{ released: 1 }]];
        return [[]];
      },
      execute: async (sql) => {
        if (/FROM user_sessions/i.test(sql)) return [[{ id: 'sess' }]];
        if (/FROM admins/i.test(sql)) return [[{ id: 1, role: 'admin' }]];
        if (/COUNT\(\*\)/i.test(sql)) return [[{ total: mockState.total }]];
        if (/SUM\(CASE/i.test(sql)) {
          return [[{
            total: mockState.stats.total,
            public_count: mockState.stats.public_count,
            moderated_count: mockState.stats.moderated_count
          }]];
        }
        if (/FROM shared_lists WHERE is_public_in_catalog/i.test(sql)) return [mockState.adminRows];
        return [[]];
      },
      release: () => {}
    }),
    execute: async (sql) => {
      if (/FROM user_sessions/i.test(sql)) return [[{ id: 'sess' }]];
      if (/FROM admins/i.test(sql)) return [[{ id: 1, role: 'admin' }]];
      if (/COUNT\(\*\)/i.test(sql)) return [[{ total: mockState.total }]];
      if (/SUM\(CASE/i.test(sql)) {
        return [[{
          total: mockState.stats.total,
          public_count: mockState.stats.public_count,
          moderated_count: mockState.stats.moderated_count
        }]];
      }
      if (/FROM shared_lists WHERE is_public_in_catalog/i.test(sql)) return [mockState.adminRows];
      return [[]];
    },
    query: async () => [[]]
  };

  require.cache[mysqlPoolPath] = {
    exports: {
      getPool: () => customPool,
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

  delete require.cache[require.resolve('../../sharedListsRoutes')];
  const router = require('../../sharedListsRoutes');
  await router.initSharedListsTable();

  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ sub: 'admin-test', userType: 'oauth', sessionId: 'sess' }, 'test-secret', { algorithm: 'HS256' });

  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; }
  };

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
    router.handle(
      {
        method: 'GET',
        url: '/admin/public?page=1&limit=50',
        headers: { authorization: `Bearer ${token}` },
        query: { page: '1', limit: '50', search: '' }
      },
      res,
      (err) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve();
      }
    );
    // Resolve when json is called
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      clearTimeout(timeout);
      res.payload = payload;
      resolve();
      return res;
    };
  });

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.payload.lists));
  assert.equal(typeof res.payload.total, 'number');
});
