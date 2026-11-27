import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const PAGE = 'src/pages/WatchPartyPage.tsx';
const PARENT_ORIGIN = 'https://movix-reborn.yunoo-collab.workers.dev';
const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';

const built = esbuild.buildSync({
  entryPoints: ['src/utils/vidriftMessaging.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  write: false,
  logLevel: 'silent'
});

const moduleExports = {};
new Function('exports', 'module', built.outputFiles[0].text)(moduleExports, { exports: moduleExports });
const {
  isAllowedVidRiftOrigin,
  getVidRiftTargetOrigin,
  postToVidRift,
  isTrustedVidRiftMessage,
} = moduleExports;

function fakeFrame({ src = `${VIDRIFT_ORIGIN}/embed/movie/550`, sameOriginDocument = false, missing = false } = {}) {
  if (missing) return { src, contentWindow: null, contentDocument: null };
  const calls = [];
  const currentOrigin = sameOriginDocument ? PARENT_ORIGIN : VIDRIFT_ORIGIN;
  return {
    src,
    calls,
    get contentDocument() { return sameOriginDocument ? {} : null; },
    contentWindow: {
      postMessage(message, targetOrigin) {
        if (targetOrigin !== currentOrigin) {
          throw new Error(
            `Failed to execute 'postMessage': target origin '${targetOrigin}' does not match '${currentOrigin}'`
          );
        }
        calls.push({ message, targetOrigin });
      }
    }
  };
}

test('une frame VidRift autorisée reçoit les commandes avec une origine explicite', () => {
  globalThis.window = { location: { href: `${PARENT_ORIGIN}/watchparty/room/abc` } };
  const frame = fakeFrame();

  assert.equal(isAllowedVidRiftOrigin(frame.contentWindow ? VIDRIFT_ORIGIN : ''), true);
  assert.equal(getVidRiftTargetOrigin(frame), VIDRIFT_ORIGIN);
  assert.equal(postToVidRift(frame, { type: 'vidrift:get-state' }), true);
  assert.deepEqual(frame.calls, [
    { message: { type: 'vidrift:get-state' }, targetOrigin: VIDRIFT_ORIGIN }
  ]);
});

test('une frame about:blank ou SPA parent ne reçoit jamais de postMessage', () => {
  globalThis.window = { location: { href: `${PARENT_ORIGIN}/watchparty/room/abc` } };
  const frame = fakeFrame({ src: '', sameOriginDocument: true });

  assert.equal(getVidRiftTargetOrigin(frame), null);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(postToVidRift(frame, { type: 'vidrift:get-state' }), false);
  }
  assert.equal(frame.calls.length, 0, 'aucune erreur postMessage ne doit être produite à répétition');
});

test('une origine d’iframe non autorisée est refusée', () => {
  globalThis.window = { location: { href: `${PARENT_ORIGIN}/watchparty/room/abc` } };
  const frame = fakeFrame({ src: 'https://evil.example/embed/movie/550' });

  assert.equal(isAllowedVidRiftOrigin('https://evil.example'), false);
  assert.equal(getVidRiftTargetOrigin(frame), null);
  assert.equal(postToVidRift(frame, { type: 'vidrift:play' }), false);
  assert.equal(frame.calls.length, 0);
});

test('une iframe indisponible est gérée sans lever d’erreur', () => {
  globalThis.window = { location: { href: `${PARENT_ORIGIN}/watchparty/room/abc` } };
  const frame = fakeFrame({ missing: true });

  assert.equal(getVidRiftTargetOrigin(frame), null);
  assert.equal(postToVidRift(frame, { type: 'vidrift:play' }), false);
});

test('les messages entrants sont acceptés seulement depuis la frame et l’origine VidRift', () => {
  const frame = fakeFrame();
  const event = (origin, source) => ({ origin, source, data: { type: 'vidrift:state', tmdbId: 550 } });

  assert.equal(isTrustedVidRiftMessage(event(VIDRIFT_ORIGIN, frame.contentWindow), frame), true);
  assert.equal(isTrustedVidRiftMessage(event(PARENT_ORIGIN, frame.contentWindow), frame), false);
  assert.equal(isTrustedVidRiftMessage(event(VIDRIFT_ORIGIN, {}), frame), false);
  assert.equal(isTrustedVidRiftMessage(event('https://evil.example', frame.contentWindow), frame), false);
});

test('handleVidRiftLoad demande toujours l’état serveur, même sans frame prête', () => {
  const emitted = [];
  const handler = sourceFunction(PAGE, 'handleVidRiftLoad', {
    vidriftFrameRef: { current: fakeFrame({ src: '', sameOriginDocument: true }) },
    vidRiftHasReportedStateRef: { current: true },
    hasCustomLocalVolumeRef: { current: false },
    localVolume: 0.8,
    localMuted: false,
    socketRef: { current: { emit: (event, ...args) => emitted.push([event, ...args]) } },
    postToVidRift,
    VIDRIFT_ORIGIN,
  }, 'vidrift:get-state');

  handler();

  assert.deepEqual(emitted, [['playback:getState']]);
});

test('une URL VidRift sans identifiant numérique ne produit pas d’iframe', () => {
  const build = sourceFunction(PAGE, 'buildVidRiftEmbedUrl', { VIDRIFT_ORIGIN }, '/embed/');

  assert.equal(build({ mediaType: 'movie', mediaId: null }), '');
  assert.equal(build({ mediaType: 'movie', mediaId: 'abc' }), '');
  assert.equal(build({ mediaType: 'movie', mediaId: '0' }), '');
  assert.match(build({ mediaType: 'movie', mediaId: '550' }), /^https:\/\/embed\.vidrift\.net\/embed\/movie\/550/);
});
