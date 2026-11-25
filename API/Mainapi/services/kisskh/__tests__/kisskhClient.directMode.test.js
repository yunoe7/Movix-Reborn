const assert = require('node:assert/strict');
const test = require('node:test');

const { createKisskhClient } = require('../kisskhClient');
const { fromEnv } = require('../config');

function createHarness({ directMode = false, status = 200 } = {}) {
  const calls = { reserve: 0, reserveGlobal: 0, assertCircuitClosed: 0, recordSuccess: 0, recordFailure: 0, record429: 0 };
  const proxy = { type: 'socks5', host: '127.0.0.1', port: 1080 };
  const requestOptions = [];
  const policy = {
    async reserve() { calls.reserve += 1; return proxy; },
    async reserveGlobal() { calls.reserveGlobal += 1; },
    async assertCircuitClosed() { calls.assertCircuitClosed += 1; },
    async recordSuccess() { calls.recordSuccess += 1; },
    async recordFailure() { calls.recordFailure += 1; },
    async record429() { calls.record429 += 1; },
  };
  const client = createKisskhClient({
    baseUrl: 'https://kisskh.do',
    directMode,
    proxyPolicy: policy,
    resolveDns: async () => ['8.8.8.8'],
    request: async (options) => {
      requestOptions.push(options);
      return {
        status,
        headers: { 'content-type': 'application/json' },
        data: status === 200 ? '{"ok":true}' : '',
      };
    },
    metadataCache: {
      async search(_origin, _query, _type, load) { return load(); },
      async drama(_origin, _id, load) { return load(); },
    },
  });
  return { client, calls, proxy, requestOptions };
}

test('le mode direct est désactivé par défaut', () => {
  const config = fromEnv({ KISSKH_ENABLED: 'true' });
  assert.equal(config.directMode, false);
});

test('le mode direct envoie les métadonnées sans réserver de proxy', async () => {
  const harness = createHarness({ directMode: true });
  assert.deepEqual(await harness.client.search('test'), { ok: true });
  assert.equal(harness.calls.reserve, 0);
  assert.equal(harness.requestOptions.length, 1);
  assert.equal(harness.requestOptions[0].proxy, null);
  assert.deepEqual(harness.requestOptions[0].addresses, ['8.8.8.8']);
  assert.equal(harness.calls.reserveGlobal, 1);
  assert.equal(harness.calls.assertCircuitClosed, 1);
  assert.equal(harness.calls.recordSuccess, 0);
  assert.equal(harness.calls.recordFailure, 0);
});

test('le mode proxy continue de réserver et transmettre un proxy', async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.client.search('test'), { ok: true });
  assert.equal(harness.calls.reserve, 1);
  assert.equal(harness.requestOptions[0].proxy, harness.proxy);
  assert.equal(harness.calls.recordSuccess, 1);
});

test('une réponse 429 en mode direct ouvre toujours le circuit', async () => {
  const harness = createHarness({ directMode: true, status: 429 });
  await assert.rejects(harness.client.search('test'), { code: 'provider_rate_limited' });
  assert.equal(harness.calls.reserve, 0);
  assert.equal(harness.calls.record429, 1);
});
