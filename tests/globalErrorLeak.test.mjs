import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('API/Mainapi/app.js', 'utf8');
const marker = 'app.use((err, req, res, next) => {';
const start = source.indexOf(marker);
const tail = source.search(/\r?\n\r?\nmodule\.exports/);
const end = source.lastIndexOf('});', tail);
if (start < 0 || end < 0 || end < start) throw new Error('gestionnaire d’erreur global introuvable');
const expression = source.slice(start + 'app.use('.length, end + 1);
const logs = [];
const handler = new Function('console', `return ${expression};`)({
  error: (...args) => logs.push(args),
  log() {},
  warn() {},
});

function call(error) {
  let status = null;
  let body = null;
  const req = { path: '/api/private?signature=secret', headers: {}, get: () => null };
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  handler(error, req, res, () => {});
  return { status, body };
}

test('la réponse 500 ne contient ni message interne ni chemin de requête', () => {
  const { status, body } = call(new Error('détail MySQL confidentiel'));
  assert.equal(status, 500);
  assert.deepEqual(body, { error: 'Erreur serveur interne' });
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('détail MySQL confidentiel'), false);
  assert.equal(serialized.includes('/api/private'), false);
  assert.equal(logs.length, 1);
});

test('les erreurs CORS et auth gardent leur réponse dédiée', () => {
  assert.equal(call(Object.assign(new Error('Not allowed by CORS'), {})).status, 403);
  assert.equal(call(Object.assign(new Error('indisponible'), { code: 'AUTH_INFRASTRUCTURE_UNAVAILABLE' })).status, 503);
});
