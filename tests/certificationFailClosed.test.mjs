import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const built = esbuild.buildSync({
  entryPoints: ['src/utils/certificationUtils.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  logLevel: 'silent',
});

const moduleObj = { exports: {} };
new Function('exports', 'module', built.outputFiles[0].text)(moduleObj.exports, moduleObj);
const { isContentAllowed } = moduleObj.exports;

test('une classification absente bloque les profils mineurs', () => {
  for (const age of [6, 7, 10, 12, 13, 14, 15, 16, 17]) {
    assert.equal(isContentAllowed('', age), false, `age ${age}`);
    assert.equal(isContentAllowed('   ', age), false, `age ${age}`);
  }
});

test('une classification inconnue bloque les profils mineurs', () => {
  assert.equal(isContentAllowed('UNKNOWN-RATING', 16), false);
  assert.equal(isContentAllowed('??', 12), false);
});

test('les profils majeurs conservent l’accès aux titres non classés', () => {
  assert.equal(isContentAllowed('', 18), true);
  assert.equal(isContentAllowed('UNKNOWN-RATING', 18), true);
});

test('une classification connue reste autorisée quand elle est compatible', () => {
  assert.equal(isContentAllowed('PG-13', 16), true);
  assert.equal(isContentAllowed('PG-13', 12), false);
  assert.equal(isContentAllowed('TV-MA', 18), true);
  assert.equal(isContentAllowed('TP', 7), true);
});

test('sans restriction d’âge, aucune classification ne bloque', () => {
  assert.equal(isContentAllowed('', 0), true);
  assert.equal(isContentAllowed('R', 0), true);
});
