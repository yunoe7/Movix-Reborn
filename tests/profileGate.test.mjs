import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const built = esbuild.buildSync({
  entryPoints: ['src/utils/profileGate.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  logLevel: 'silent',
});

const moduleObj = { exports: {} };
new Function('exports', 'module', built.outputFiles[0].text)(moduleObj.exports, moduleObj);
const { resolveProfileGate } = moduleObj.exports;

const base = {
  isAuthenticated: true,
  skipGate: false,
  loadingTimedOut: false,
  isLoading: false,
  profileCount: 1,
  hasCurrentProfile: true,
};

test('un timeout n’autorise jamais le rendu sans profil validé', () => {
  assert.equal(resolveProfileGate({ ...base, loadingTimedOut: true }), 'error');
  assert.equal(resolveProfileGate({ ...base, loadingTimedOut: true, isLoading: true }), 'error');
  assert.equal(resolveProfileGate({ ...base, loadingTimedOut: true, profileCount: 0 }), 'error');
});

test('les exemptions explicites restent appliquées avant le timeout', () => {
  assert.equal(resolveProfileGate({ ...base, loadingTimedOut: true, skipGate: true }), 'pass');
  assert.equal(resolveProfileGate({ ...base, isAuthenticated: false }), 'pass');
});

test('le chargement et la sélection de profil conservent leur comportement', () => {
  assert.equal(resolveProfileGate({ ...base, isLoading: true }), 'loading');
  assert.equal(resolveProfileGate({ ...base, profileCount: 0 }), 'loading');
  assert.equal(resolveProfileGate({ ...base, hasCurrentProfile: false }), 'select');
  assert.equal(resolveProfileGate(base), 'pass');
});
