const test = require('node:test');
const assert = require('node:assert/strict');
const { domainRestriction } = require('../security');

function check(origin) {
  let nextCalled = false;
  let statusCode = null;
  const req = {
    path: '/api/catalog',
    get(name) { return name === 'origin' ? origin : undefined; },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };
  domainRestriction(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode };
}

test('accepts an existing approved domain', () => {
  assert.equal(check('https://movix.rodeo').nextCalled, true);
});

test('rejects a hostname containing the localhost allowlist as a substring', () => {
  assert.equal(check('https://attacker.example/?next=localhost:3000').nextCalled, false);
});

test('rejects localhost with the wrong port', () => {
  assert.equal(check('http://localhost:30001').nextCalled, false);
});

test('accepts localhost only on its explicitly allowed port', () => {
  assert.equal(check('http://localhost:3000').nextCalled, true);
});

test('rejects unsupported URL schemes', () => {
  assert.equal(check('file:///movix.rodeo').nextCalled, false);
});
