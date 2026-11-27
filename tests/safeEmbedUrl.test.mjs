import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const built = esbuild.buildSync({
  entryPoints: ['src/utils/safeEmbedUrl.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  logLevel: 'silent',
});

const moduleObj = { exports: {} };
new Function('exports', 'module', 'window', built.outputFiles[0].text)(
  moduleObj.exports,
  moduleObj,
  { location: { href: 'https://movix.site/watch/movie/42', origin: 'https://movix.site' } }
);
const { safeEmbedUrl } = moduleObj.exports;

test('une URL embed absolue en HTTPS est conservée', () => {
  const url = 'https://embed.example.net/player/42';
  assert.equal(safeEmbedUrl(url), url);
});

test('une URL embed absolue en HTTP reste autorisée', () => {
  const url = 'http://embed.example.net/player/42';
  assert.equal(safeEmbedUrl(url), url);
});

test('une URL relative ne devient jamais une iframe same-origin', () => {
  assert.equal(safeEmbedUrl('/api/internal/preview'), '');
  assert.equal(safeEmbedUrl('embed/player'), '');
});

test('une URL relative au protocole ne contourne pas le contrôle', () => {
  assert.equal(safeEmbedUrl('//evil.example.net/player'), '');
});

test('les schémas non HTTP restent rejetés', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd']) {
    assert.equal(safeEmbedUrl(url), '');
  }
});

test('les espaces et retours à la ligne insérés dans le schéma restent rejetés', () => {
  assert.equal(safeEmbedUrl('java\nscript:alert(1)'), '');
  assert.equal(safeEmbedUrl('https://movix.site\n.evil.net/player'), '');
});
