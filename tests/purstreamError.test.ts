import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPurstreamError } from '../src/utils/purstreamError.ts';

const axiosError = (status: number | undefined, data: unknown) => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: `Request failed with status code ${status ?? 'inconnu'}`,
  response: status === undefined ? undefined : { status, data },
});

test('une 404 CONTENT_NOT_FOUND est une absence normale de source', () => {
  const info = classifyPurstreamError(axiosError(404, { error: 'Film non trouvé sur PurStream', code: 'CONTENT_NOT_FOUND' }));
  assert.deepEqual(info, { kind: 'absent', status: 404, code: 'CONTENT_NOT_FOUND' });
});

test('une 404 NO_SOURCES est distinguée du titre absent', () => {
  const info = classifyPurstreamError(axiosError(404, { error: 'Aucun stream disponible pour ce film', code: 'NO_SOURCES' }));
  assert.deepEqual(info, { kind: 'no_sources', status: 404, code: 'NO_SOURCES' });
});

test('les réponses 404 de l’ancien backend restent reconnues comme une absence', () => {
  assert.equal(classifyPurstreamError(axiosError(404, { error: 'Film non trouvé sur PurStream' })).kind, 'absent');
  assert.equal(classifyPurstreamError(axiosError(404, { error: 'Aucun stream disponible pour ce film' })).kind, 'no_sources');
});

test('une 404 sans payload PurStream est une route manquante', () => {
  assert.deepEqual(classifyPurstreamError(axiosError(404, 'Cannot GET /api/purstream/movie/1/stream')), {
    kind: 'route_missing',
    status: 404,
  });
  assert.equal(classifyPurstreamError(axiosError(404, { error: 'Autre chose' })).kind, 'route_missing');
});

test('les autres erreurs restent des pannes d’extraction', () => {
  assert.deepEqual(classifyPurstreamError(axiosError(502, { error: 'Erreur temporaire PurStream' })), {
    kind: 'failure',
    status: 502,
  });
  assert.deepEqual(classifyPurstreamError(new Error('réseau')), { kind: 'failure' });
});
