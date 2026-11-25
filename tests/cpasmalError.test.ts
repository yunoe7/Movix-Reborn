import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCpasmalError } from '../src/utils/cpasmalError.ts';

const axiosError = (status: number | undefined, data: unknown) => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${status ?? 'inconnu'}`,
  response: status === undefined ? undefined : { status, data },
});

test('un fournisseur désactivé est distingué dun contenu absent', () => {
  assert.deepEqual(
    classifyCpasmalError(axiosError(503, { code: 'PROVIDER_DISABLED', error: 'Cpasmal désactivé' })),
    { kind: 'disabled', status: 503, code: 'PROVIDER_DISABLED' },
  );
  assert.equal(classifyCpasmalError(axiosError(404, { error: 'Cpasmal désactivé' })).kind, 'disabled');
});

test('un contenu introuvable reste une réponse métier 404', () => {
  assert.deepEqual(
    classifyCpasmalError(axiosError(404, { code: 'CONTENT_NOT_FOUND', error: 'Movie not found on Cpasmal' })),
    { kind: 'not_found', status: 404, code: 'CONTENT_NOT_FOUND' },
  );
  assert.equal(classifyCpasmalError(axiosError(404, { error: 'Movie not found on Cpasmal (Cached)' })).kind, 'not_found');
});

test('un identifiant invalide est une erreur client distincte', () => {
  assert.deepEqual(
    classifyCpasmalError(axiosError(400, { code: 'INVALID_TMDB_ID' })),
    { kind: 'invalid_id', status: 400, code: 'INVALID_TMDB_ID' },
  );
});

test('une 404 sans payload Cpasmal est une route manquante', () => {
  assert.deepEqual(classifyCpasmalError(axiosError(404, 'Cannot GET /api/cpasmal/movie/1')), {
    kind: 'route_missing',
    status: 404,
  });
});

test('une panne amont et les autres erreurs restent des pannes', () => {
  assert.deepEqual(classifyCpasmalError(axiosError(503, { code: 'UPSTREAM_ERROR' })), {
    kind: 'upstream_error',
    status: 503,
    code: 'UPSTREAM_ERROR',
  });
  assert.deepEqual(classifyCpasmalError(new Error('réseau')), { kind: 'failure' });
});
