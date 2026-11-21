const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const routePath = path.join(__dirname, '..', 'purstream.js');
const routeSource = fs.readFileSync(routePath, 'utf8');
const cacheManagerSource = fs.readFileSync(path.join(__dirname, '..', '..', 'utils', 'cacheManager.js'), 'utf8');
const refreshCheckSource = cacheManagerSource.slice(
  cacheManagerSource.indexOf('const shouldUpdateCache ='),
  cacheManagerSource.indexOf('const getCacheRefreshInfo ='),
);
const createRefreshCheck = (stat, now) => vm.compileFunction(
  `${refreshCheckSource}\nreturn shouldUpdateCache;`, ['fsp', 'path', 'Date'],
)({ stat }, path, { now });
const sixHours = 6 * 60 * 60 * 1000;
const notFound = { __not_found: true };
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function createFixture(type, { negativeMapping = false, streamCache, stale = false, cacheAge = 0, searchGate } = {}) {
  const mapKey = `purstream_map_${type}_1433583`;
  const streamKey = `purstream_stream_${type}_1433583${type === 'tv' ? '_s2e3' : ''}`;
  const mapping = { purstream_id: 123, title: 'Titre test', type };
  const cache = new Map([[mapKey, negativeMapping ? notFound : mapping]]);
  if (streamCache) cache.set(streamKey, streamCache);
  let now = 10 * sixHours;
  const modifiedAt = new Map([...cache.keys()].map((key) => [key, now - (stale ? sixHours : cacheAge)]));
  const retryAt = new Map();
  const shouldUpdateCache = createRefreshCheck(async (filePath) => {
    const key = path.basename(filePath, '.json');
    if (!cache.has(key)) throw new Error('Cache absent');
    return { mtime: new Date(modifiedAt.get(key)) };
  }, () => now);
  // La route utilise createWiflixRefreshState (et non plus shouldUpdateCache).
  // Le mock reproduit sa fenêtre de six heures et son délai de reprise sans
  // écrire de sidecars sur le disque.
  const refreshState = {
    async remaining(_dir, key, cachedData) {
      const modified = modifiedAt.get(key);
      if (cachedData && modified !== undefined) {
        const freshFor = modified + sixHours - now;
        if (freshFor > 0) return freshFor;
      }
      const retry = retryAt.get(key);
      return retry === undefined ? 0 : Math.max(0, retry - now);
    },
    async defer(_dir, key) { retryAt.set(key, now + 60 * 1000); },
    async clear(_dir, key) { retryAt.delete(key); },
  };
  const writes = [];
  const warnings = [];
  const infos = [];
  const failures = [];
  const calls = { searches: 0, streams: [] };
  const upstream = { status: 200, searchStatus: 200, emptySearch: false, emptyStream: false };

  const modules = {
    express,
    axios: async ({ url }) => {
      if (url.endsWith('/api/status')) return { data: { domain: 'purstream.test' } };
      if (url.includes('/search-bar/search/')) {
        calls.searches += 1;
        if (searchGate) await searchGate;
        if (upstream.searchStatus !== 200) throw { response: { status: upstream.searchStatus } };
        return { data: { type: 'success', data: { items: { movies: { items: upstream.emptySearch ? [] : [{
          id: 123, title: 'Titre test', type, large_poster_path: 'https://image.test/poster.jpg',
        }] } } } } };
      }
      calls.streams.push(url);
      if (upstream.status !== 200) throw { response: { status: upstream.status } };
      return { data: { type: 'success', data: { items: { sources: upstream.emptyStream ? [] : [{
        stream_url: 'https://video.test/fresh.m3u8', source_name: 'Source test', format: 'hls',
      }] } } } };
    },
    '../utils/cacheManager': {
      CACHE_DIR: { PURSTREAM: 'purstream-test-cache' }, generateCacheKey: (key) => key,
    },
    '../utils/tmdbCache': {
      fetchTmdbDetails: async () => ({ title: 'Titre test', name: 'Titre test', poster_path: '/poster.jpg' }),
      fetchTmdbImages: async () => null,
      isTmdbDetailsMissing: async () => false,
    },
    '../utils/proxyManager': { pickRandomProxy: () => null, getProxyAgent: () => null },
    '../utils/mediaSigning': { buildSignedProxyUrl: (_base, _path, url) => url, signingConfigured: () => false },
    '../utils/wiflixRefreshState': { createWiflixRefreshState: () => refreshState },
    '../utils/sourceRefreshTelemetry': {
      reportRefreshFailure: (reason, error, context) => failures.push({ reason, error, context }),
    },
    '../config/redis': { redis: { status: 'end' } },
  };
  const routeModule = { exports: {} };
  vm.compileFunction(routeSource, ['require', 'module', 'console'], { filename: routePath })((request) => {
    assert.ok(Object.hasOwn(modules, request), `Dépendance non simulée : ${request}`);
    return modules[request];
  }, routeModule, {
    ...console,
    info: (...args) => infos.push(args),
    warn: (...args) => warnings.push(args),
    error: (...args) => warnings.push(args),
  });
  const router = routeModule.exports;
  router.configure({
    getFromCacheNoExpiration: async (_dir, key) => cache.get(key) || null,
    saveToCache: async (_dir, key, value) => {
      cache.set(key, value);
      modifiedAt.set(key, now);
      writes.push({ key, value });
    },
    shouldUpdateCache,
  });
  const handler = router.stack.find((layer) => layer.route?.path === `/${type}/:tmdbId/stream`).route.stack[0].handle;
  const newResponse = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const request = async () => {
    const response = newResponse();
    await handler({ params: { tmdbId: '1433583' }, query: { season: '2', episode: '3' }, headers: {} }, response);
    return response;
  };
  const unknownRequest = async () => {
    const response = newResponse();
    const fallback = router.stack.findLast((layer) => !layer.route && typeof layer.handle === 'function');
    assert.ok(fallback, 'un gestionnaire de route inconnue doit être enregistré');
    await fallback.handle({ method: 'GET', path: '/inconnu', url: '/inconnu' }, response);
    return response;
  };
  return { cache, mapKey, streamKey, writes, warnings, infos, failures, calls, upstream, request, unknownRequest,
    advanceTime: (ms) => { now += ms; } };
}

test('shouldUpdateCache conserve le délai de 40 minutes par défaut pour les autres sources', async () => {
  let now = 40 * 60 * 1000 - 1;
  const check = createRefreshCheck(async () => ({ mtime: new Date(0) }), () => now);
  assert.equal(await check('cache', 'key'), false);
  now += 1;
  assert.equal(await check('cache', 'key'), true);
});

for (const type of ['movie', 'tv']) {
  for (const streamCache of [undefined, notFound]) {
    test(`${type}: le négatif ${streamCache ? 'stream' : 'mapping'} reste silencieux pendant six heures`, async () => {
      const fixture = createFixture(type, { negativeMapping: true, streamCache });
      assert.equal((await fixture.request()).statusCode, 404);
      fixture.advanceTime(sixHours - 1);
      assert.equal((await fixture.request()).statusCode, 404);
      await nextTurn();
      assert.deepEqual(fixture.calls, { searches: 0, streams: [] });
      assert.deepEqual(fixture.writes, []);
      assert.deepEqual(fixture.warnings, []);
    });
  }

  test(`${type}: un mapping négatif est revérifié à six heures`, async () => {
    const fixture = createFixture(type, { negativeMapping: true });
    fixture.advanceTime(sixHours);
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.searches, 1);
    assert.equal(fixture.cache.get(fixture.mapKey).purstream_id, 123);
    assert.equal((await fixture.request()).statusCode, 200);
    assert.equal(fixture.cache.get(fixture.streamKey).sources[0].url, 'https://video.test/fresh.m3u8');
  });

  test(`${type}: les 404 simultanées partagent le refresh du mapping et du stream périmés`, async () => {
    let releaseSearch;
    const searchGate = new Promise((resolve) => { releaseSearch = resolve; });
    const fixture = createFixture(type, { negativeMapping: true, streamCache: notFound, searchGate, stale: true });
    try {
      const responses = await Promise.all([fixture.request(), fixture.request(), fixture.request()]);
      assert.deepEqual(responses.map((response) => response.statusCode), [404, 404, 404]);
      await nextTurn();
      assert.equal(fixture.calls.searches, 1);
      assert.equal(fixture.calls.streams.length, 0);
    } finally {
      releaseSearch();
    }
    await nextTurn();
    assert.equal(fixture.cache.get(fixture.mapKey).purstream_id, 123);
    assert.equal(fixture.cache.get(fixture.streamKey).sources[0].url, 'https://video.test/fresh.m3u8');
    assert.equal(fixture.calls.streams.length, 1);
    if (type === 'tv') {
      assert.match(fixture.calls.streams[0], /\/episode\?season=2&episode=3$/);
      assert.equal(fixture.cache.get(fixture.streamKey).season, 2);
      assert.equal(fixture.cache.get(fixture.streamKey).episode, 3);
    }
    assert.equal((await fixture.request()).statusCode, 200);
  });

  test(`${type}: une nouvelle 404 amont empêche les tentatives pendant six heures`, async () => {
    const fixture = createFixture(type);
    fixture.upstream.status = 404;
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    // La 404 amont déclenche aussi une revalidation du mapping : une écriture
    // de mapping valide est attendue en plus du négatif du stream.
    assert.ok(fixture.writes.some(({ key, value }) => key === fixture.streamKey && value.__not_found));
    assert.equal(fixture.cache.get(fixture.mapKey).purstream_id, 123);

    fixture.upstream.status = 200;
    fixture.advanceTime(sixHours - 1);
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 1);

    fixture.advanceTime(1);
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 2);
    assert.equal((await fixture.request()).statusCode, 200);
  });

  test(`${type}: une panne de recherche ne fige pas le mapping négatif`, async () => {
    const fixture = createFixture(type, { negativeMapping: true, stale: true });
    fixture.upstream.searchStatus = 502;
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.deepEqual(fixture.writes, []);

    fixture.upstream.searchStatus = 200;
    // Le délai de reprise du refreshstate (60 s) est respecté avant une
    // nouvelle recherche : on ne retry pas immédiatement une panne amont.
    fixture.advanceTime(61 * 1000);
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.searches, 2);
    assert.equal(fixture.cache.get(fixture.mapKey).purstream_id, 123);
  });

  test(`${type}: une panne du stream ne réécrit pas le négatif`, async () => {
    const fixture = createFixture(type, { streamCache: notFound, stale: true });
    fixture.upstream.status = 502;
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 1);
    assert.equal(fixture.writes.some(({ key }) => key === fixture.streamKey), false);
  });

  test(`${type}: une 404 de refresh conserve les liens sans écrire de négatif`, async () => {
    const playable = { purstream_id: 123, sources: [{ url: 'https://video.test/cached.m3u8' }] };
    const fixture = createFixture(type, { streamCache: playable, stale: true });
    fixture.upstream.status = 404;
    const response = await fixture.request();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.sources, playable.sources);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 1);
    assert.equal(fixture.cache.get(fixture.streamKey), playable);
    assert.equal(fixture.writes.some(({ key }) => key === fixture.streamKey), false,
      'une 404 en refresh ne doit pas écraser les liens encore valides');

    // Aucune écriture signifie que la date du cache reste ancienne : un
    // prochain refresh est tenté, mais le film reste lisible entre-temps.
    fixture.advanceTime(sixHours - 1);
    const later = await fixture.request();
    assert.equal(later.statusCode, 200);
    assert.deepEqual(later.body.sources, playable.sources);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 2);
  });

  test(`${type}: un stream utilisable attend six heures avant son actualisation`, async () => {
    const playable = { purstream_id: 123, sources: [{ url: 'https://video.test/cached.m3u8' }] };
    const fixture = createFixture(type, { streamCache: playable });
    fixture.advanceTime(sixHours - 1);
    assert.equal((await fixture.request()).statusCode, 200);
    await nextTurn();
    assert.deepEqual(fixture.calls, { searches: 0, streams: [] });
    assert.deepEqual(fixture.writes, []);
    fixture.advanceTime(1);
    assert.equal((await fixture.request()).statusCode, 200);
    await nextTurn();
    assert.equal(fixture.calls.streams.length, 1);
    assert.equal(fixture.cache.get(fixture.streamKey).sources[0].url, 'https://video.test/fresh.m3u8');
  });

  test(`${type}: un mapping utilisable attend six heures avant son actualisation`, async () => {
    const fixture = createFixture(type, { cacheAge: sixHours - 1 });
    assert.equal((await fixture.request()).statusCode, 200);
    await nextTurn();
    assert.equal(fixture.calls.searches, 0);
    fixture.cache.delete(fixture.streamKey);
    fixture.advanceTime(1);
    assert.equal((await fixture.request()).statusCode, 200);
    await nextTurn();
    assert.equal(fixture.calls.searches, 1);
  });

  test(`${type}: une recherche vide renouvelle le délai du mapping négatif`, async () => {
    const fixture = createFixture(type, { negativeMapping: true, stale: true });
    fixture.upstream.emptySearch = true;
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.deepEqual(fixture.cache.get(fixture.mapKey), notFound);
    const warningCount = fixture.warnings.length;
    fixture.advanceTime(sixHours - 1);
    assert.equal((await fixture.request()).statusCode, 404);
    await nextTurn();
    assert.equal(fixture.calls.searches, 1);
    assert.equal(fixture.warnings.length, warningCount);
  });

  test(`${type}: un stream vide ne détruit pas les liens utilisables`, async () => {
    const playable = { purstream_id: 123, sources: [{ url: 'https://video.test/cached.m3u8' }] };
    const fixture = createFixture(type, { streamCache: playable, stale: true });
    fixture.upstream.emptyStream = true;
    assert.equal((await fixture.request()).statusCode, 200);
    await nextTurn();
    assert.equal(fixture.cache.get(fixture.streamKey), playable);
    assert.equal(fixture.writes.some(({ key }) => key === fixture.streamKey), false);
    assert.equal(fixture.calls.streams.length, 1);
  });

  test(`${type}: une route PurStream inconnue n'est pas confondue avec une absence de source`, async () => {
    const fixture = createFixture(type);
    const response = await fixture.unknownRequest();
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, 'ROUTE_NOT_FOUND');
    assert.equal(fixture.calls.searches, 0);
    assert.equal(fixture.calls.streams.length, 0);
  });

  if (type === 'movie') {
    test('movie: un titre absent est une 404 CONTENT_NOT_FOUND journalisée en info', async () => {
      const fixture = createFixture('movie', { negativeMapping: true });
      const response = await fixture.request();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.code, 'CONTENT_NOT_FOUND');
      assert.match(response.body.error, /non trouvé/i);
      assert.deepEqual(fixture.failures, []);
      assert.equal(fixture.warnings.length, 0);
      assert.ok(fixture.infos.length > 0, 'une absence normale doit être tracée sans alerte');
    });

    test('movie: un titre sans flux est une 404 NO_SOURCES distincte du contenu absent', async () => {
      const fixture = createFixture('movie');
      fixture.upstream.emptyStream = true;
      const response = await fixture.request();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.code, 'NO_SOURCES');
      assert.match(response.body.error, /aucun stream/i);
    });
  }
}
