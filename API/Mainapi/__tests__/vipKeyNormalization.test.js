const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const filename = path.resolve(__dirname, '../checkVip.js');
const localRequire = createRequire(filename);

function load(pool) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    Buffer,
    Date,
    URL,
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    require: (name) => (name === './mysqlPool' ? { getPool: () => pool } : localRequire(name)),
  }, { filename });
  return module.exports;
}

function poolRecording(queries) {
  return {
    execute(sql, params) {
      queries.push({ sql, params });
      return Promise.resolve([[]]);
    },
  };
}

test('la normalisation décode les octets Latin-1 d’un en-tête en UTF-8', () => {
  const checkVip = load(poolRecording([]));
  const key = 'clé-été-✓';
  const headerValue = Buffer.from(key, 'utf8').toString('latin1');
  assert.equal(checkVip.normalizeVipKey(headerValue), key);
});

test('une séquence UTF-8 invalide n’est pas remplacée par U+FFFD', () => {
  const checkVip = load(poolRecording([]));
  const invalidHeader = Buffer.from([0xff, 0xfe]).toString('latin1');
  assert.equal(checkVip.normalizeVipKey(invalidHeader), invalidHeader);
});

test('verifyAccessKey et invalidateVipCache utilisent la même clé normalisée', async () => {
  const queries = [];
  const checkVip = load(poolRecording(queries));
  const key = 'clé-été';
  const headerValue = Buffer.from(key, 'utf8').toString('latin1');

  await checkVip.verifyAccessKey(headerValue);
  checkVip.invalidateVipCache(headerValue);

  assert.ok(queries.length >= 1);
  assert.equal(queries[0].params[0], key);
});
