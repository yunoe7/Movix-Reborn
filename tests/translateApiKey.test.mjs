import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const translateSource = readFileSync('src/services/subtitles/translate.ts', 'utf8');
const runtimeSource = readFileSync('src/config/runtime.ts', 'utf8');

function endpointsWithKey(value) {
  const built = esbuild.buildSync({
    entryPoints: ['src/services/subtitles/translate.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    write: false,
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SITE_URL': '""',
      'import.meta.env.VITE_WATCHPARTY_API': '""',
      'import.meta.env.VITE_MAIN_API': '""',
      'import.meta.env.VITE_PROXIES_EMBED_API': '""',
      'import.meta.env.VITE_TRANSLATE_HTML_API_KEY': JSON.stringify(value),
    },
    external: ['axios'],
  });
  const moduleObj = { exports: {} };
  new Function('exports', 'module', 'require', built.outputFiles[0].text)(
    moduleObj.exports,
    moduleObj,
    require,
  );
  return moduleObj.exports.TRANSLATE_ENDPOINTS.map(endpoint => endpoint.id);
}

test('aucune clé Google n’est codée en dur dans le service de traduction', () => {
  // Ne pas inclure la source dans le message d'erreur : elle contiendrait la clé.
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(translateSource), 'clé API codée en dur détectée');
});

test('la clé du point d’accès translateHtml vient de la configuration runtime', () => {
  assert.match(runtimeSource, /VITE_TRANSLATE_HTML_API_KEY/);
  assert.match(translateSource, /TRANSLATE_HTML_API_KEY/);
});

test('sans clé configurée, le point d’accès translateHtml est désactivé', () => {
  const ids = endpointsWithKey('');
  assert.ok(ids.length > 0);
  assert.equal(ids.some(id => id.startsWith('translateHtml@')), false);
});

test('avec une clé configurée, le point d’accès translateHtml reste disponible', () => {
  const ids = endpointsWithKey('test-key');
  assert.equal(ids.some(id => id.startsWith('translateHtml@')), true);
});
