import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyKisskhResponse } from '../src/utils/kisskhError.ts';

test('un 503 KissKH marqué comme désactivé est une absence de fournisseur', () => {
  assert.deepEqual(
    classifyKisskhResponse(503, { code: 'proxy_unavailable', message: 'KissKH desactive' }, '1'),
    { code: 'provider_disabled' },
  );
  assert.deepEqual(
    classifyKisskhResponse(503, { code: 'proxy_unavailable', message: 'KissKH desactive' }, null),
    { code: 'provider_disabled' },
  );
});

test('un 503 sans marqueur reste une panne de relais', () => {
  assert.deepEqual(
    classifyKisskhResponse(503, { code: 'proxy_unavailable', message: 'autre panne' }, null),
    { code: 'proxy_unavailable' },
  );
});

test('une 404 sans titre KissKH est une route manquante', () => {
  assert.deepEqual(classifyKisskhResponse(404, { code: 'ROUTE_NOT_FOUND' }, null), {
    code: 'route_missing',
  });
});

test('les autres statuts conservent leur code KissKH', () => {
  assert.deepEqual(classifyKisskhResponse(400, { code: 'invalid_input' }, null), { code: 'invalid_input' });
  assert.deepEqual(classifyKisskhResponse(404, { code: 'not_found' }, null), { code: 'not_found' });
  assert.deepEqual(classifyKisskhResponse(429, { code: 'provider_rate_limited' }, null), { code: 'provider_rate_limited' });
  assert.deepEqual(classifyKisskhResponse(502, {}, null), { code: 'upstream_unavailable' });
});
