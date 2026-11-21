'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnimeSamaFallback, normalizeSearchResults } = require('../animeSamaFallback');

const BASE = 'https://anime-sama.fr';

test('fallback is disabled when no HTTPS endpoint is configured', async () => {
  const fallback = createAnimeSamaFallback({ baseUrl: '' });
  assert.equal(fallback.enabled, false);
  assert.equal(await fallback.search('One Piece'), null);
});

test('normalizes only valid Anime-Sama catalogue entries', () => {
  const results = normalizeSearchResults({
    success: true,
    data: [
      { name: 'One Piece', url: 'https://anime-sama.fr/catalogue/one-piece/', image: 'https://cdn.example/poster.jpg' },
      { title: 'Naruto', id: 'naruto' },
      { name: 'External injection', url: 'https://evil.example/catalogue/evil/' },
      { name: 'Bad protocol', url: 'javascript:alert(1)' },
      { name: 'No URL' },
      { name: 'One Piece duplicate', url: 'https://anime-sama.fr/catalogue/one-piece/' },
    ],
  }, BASE);

  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'One Piece');
  assert.equal(results[0].image, 'https://cdn.example/poster.jpg');
  assert.equal(results[1].url, 'https://anime-sama.fr/catalogue/naruto/');
  assert.equal(results[0].fallbackSource, 'atomic-anime-sama-api');
});

test('rejects non-catalogue paths and non-http images', () => {
  const results = normalizeSearchResults([
    { name: 'Season page', url: 'https://anime-sama.fr/catalogue/one-piece/saison1/vostfr/' },
    { name: 'Safe title', url: 'https://anime-sama.fr/catalogue/safe/', image: 'data:image/png;base64,AAAA' },
  ], BASE);
  assert.equal(results.length, 1);
  assert.equal(results[0].image, '');
});

test('uses a bounded timeout and coalesces concurrent identical fallback work', async () => {
  let calls = 0;
  let release;
  const http = {
    get: async (_url, options) => {
      calls += 1;
      assert.ok(options.timeout >= 1000 && options.timeout <= 10000);
      await new Promise(resolve => { release = resolve; });
      return { data: [{ name: 'One Piece', url: 'https://anime-sama.fr/catalogue/one-piece/' }] };
    },
  };
  const fallback = createAnimeSamaFallback({ baseUrl: 'https://api.example.test', http, logger: { warn() {} } });
  const first = fallback.search('One Piece');
  const second = fallback.search('One Piece');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
});

test('does not merge different searches that happen at the same time', async () => {
  const queries = [];
  const releases = [];
  const http = {
    get: async (_url, options) => {
      queries.push(options.params.q);
      await new Promise(resolve => { releases.push(resolve); });
      return { data: [{ name: options.params.q, url: 'https://anime-sama.fr/catalogue/' + options.params.q.toLowerCase().replace(/\\s+/g, '-') + '/' }] };
    },
  };
  const fallback = createAnimeSamaFallback({ baseUrl: 'https://api.example.test', http, logger: { warn() {} } });
  const first = fallback.search('One Piece');
  const second = fallback.search('Naruto');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(queries.sort(), ['Naruto', 'One Piece']);
  releases.forEach(resolve => resolve());
  await Promise.all([first, second]);
});

test('rejects insecure and malformed fallback endpoints', () => {
  assert.equal(createAnimeSamaFallback({ baseUrl: 'http://api.example.test' }).enabled, false);
  assert.equal(createAnimeSamaFallback({ baseUrl: 'not a url' }).enabled, false);
});
