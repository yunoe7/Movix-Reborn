const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminActionLimiter } = require('../adminActionRateLimit');

function makeRequest(user, ip = '203.0.113.10', headers = {}) {
  return {
    user,
    ip,
    headers,
    method: 'PUT',
    originalUrl: '/api/admin/test',
    path: '/api/admin/test',
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    end() { return this; },
  };
}

function makeStore(result = { totalHits: 1, resetTime: new Date(Date.now() + 60_000) }) {
  const keys = [];
  return {
    keys,
    init() {},
    async increment(key) { keys.push(key); return typeof result === 'function' ? result(key) : result; },
    async decrement() {},
    async resetKey() {},
    async resetAll() {},
  };
}

// Résout soit sur `next()`, soit sur la réponse envoyée par le limiteur.
function invoke(limiter, req, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const markResponded = (payload) => {
      if (!settled) {
        settled = true;
        resolve({ nextCalled: false });
      }
      return payload;
    };
    res.json = (payload) => markResponded(originalJson(payload));
    res.send = (payload) => markResponded(originalSend(payload));
    limiter(req, res, (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve({ nextCalled: true });
    });
  });
}

test('la clé de quota utilise le compte authentifié, jamais un en-tête IP forgé', async () => {
  const store = makeStore();
  const limiter = createAdminActionLimiter('test-identity', 60, 60_000, { store });
  const admin = { userId: '42', userType: 'oauth' };

  await invoke(limiter, makeRequest(admin, '203.0.113.10', { 'cf-connecting-ip': '1.2.3.4' }), makeResponse());
  await invoke(limiter, makeRequest(admin, '198.51.100.7', { 'x-forwarded-for': '9.9.9.9' }), makeResponse());
  await invoke(limiter, makeRequest({ userId: '43', userType: 'oauth' }, '203.0.113.10'), makeResponse());

  assert.equal(store.keys[0], 'u:oauth:42');
  assert.equal(store.keys[1], 'u:oauth:42');
  assert.equal(store.keys[2], 'u:oauth:43');
  assert.ok(store.keys.every((key) => !key.includes('cf-connecting-ip') && !key.includes('x-forwarded-for')));
});

test('le quota dépassé répond 429 sans appeler l’action', async () => {
  const limiter = createAdminActionLimiter('test-limit', 1, 60_000, {
    store: makeStore({ totalHits: 2, resetTime: new Date(Date.now() + 60_000) }),
  });
  const res = makeResponse();
  const outcome = await invoke(limiter, makeRequest({ userId: '42', userType: 'oauth' }), res);
  assert.equal(outcome.nextCalled, false);
  assert.equal(res.statusCode, 429);
});

test('panne Redis : mode closed par défaut, 503 explicite sans appeler l’action', async () => {
  const store = makeStore();
  store.increment = async () => { throw new Error('ECONNREFUSED Redis'); };
  const limiter = createAdminActionLimiter('test-closed', 60, 60_000, { store });
  const res = makeResponse();

  const outcome = await invoke(limiter, makeRequest({ userId: '42', userType: 'oauth' }), res);

  assert.equal(outcome.nextCalled, false);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body || {}), /ECONNREFUSED/);
});

test('panne Redis : le mode open explicite laisse passer (compatibilité)', async () => {
  const store = makeStore();
  store.increment = async () => { throw new Error('ECONNREFUSED Redis'); };
  const limiter = createAdminActionLimiter('test-open', 60, 60_000, {
    store,
    onStoreError: 'open',
  });
  const res = makeResponse();

  const outcome = await invoke(limiter, makeRequest({ userId: '42', userType: 'oauth' }), res);

  assert.equal(outcome.nextCalled, true);
  assert.equal(res.statusCode, 200);
});
