import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { sourceEffect } from './helpers/sourceFunction.mjs';
import { getLocalPlaybackInitPolicy } from '../src/utils/castLocalPlaybackRecovery.ts';
import { observeNativeAudioTracks } from '../src/utils/nativeAudioTracks.ts';
import { isIpadSafari } from '../src/utils/deviceDetection.ts';

// Scénarios couverts ici (aucun d'eux n'est reproductible par les E2E navigateur
// du dépôt, qui tournent sous Chromium) :
//  - iPadOS Safari annonce MSE -> Hls.isSupported() vrai -> le lecteur HLS.js
//    peut rester bloqué sans canplay ni erreur ; il doit utiliser le HLS natif ;
//  - iPadOS Safari en UA « Macintosh » + multi-touch doit être détecté ;
//  - PC, Android et iPhone Safari doivent garder leur chemin actuel ;
//  - un échec du flux natif doit sortir du spinner / remonter une erreur lisible.
const HLS_SRC = 'https://media.test/master.m3u8';
const noop = () => {};
const silentConsole = { log: noop, warn: noop, error: noop };

function withNavigator(userAgent, maxTouchPoints, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent, maxTouchPoints },
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPAD_CHROME_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';

test('la détection iPadOS Safari couvre les iPad en UA desktop sans toucher aux autres appareils', () => {
  const cases = [
    [IPAD_UA, 5, true],
    [IPAD_DESKTOP_UA, 5, true],
    [IPHONE_UA, 1, false],
    [MAC_UA, 0, false],
    [ANDROID_UA, 5, false],
    [IPAD_CHROME_UA, 5, false],
  ];
  for (const [userAgent, maxTouchPoints, expected] of cases) {
    withNavigator(userAgent, maxTouchPoints, () => {
      assert.equal(isIpadSafari(), expected, `UA : ${userAgent}`);
    });
  }
});

let hlsInstances = 0;
class HlsStub extends EventEmitter {
  static Events = new Proxy({}, { get: (_, name) => name });
  static isSupported = () => true;
  levels = [{ height: 720 }];
  currentLevel = 0;
  constructor() { super(); hlsInstances += 1; }
  loadSource() {}
  attachMedia() {}
  startLoad() {}
  destroy() { this.destroyed = true; this.removeAllListeners(); }
}

function videoFixture() {
  const video = new EventTarget();
  Object.assign(video, {
    currentTime: 0,
    readyState: 0,
    paused: true,
    textTracks: [],
    disableRemotePlayback: false,
    webkitWirelessVideoPlaybackDisabled: false,
    webkitCurrentPlaybackTargetIsWireless: false,
    canPlayType: () => 'maybe',
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    load() { this.dispatchEvent(new Event('loadstart')); },
    setAttribute: noop,
    async play() { this.paused = false; this.playCalls = (this.playCalls ?? 0) + 1; },
  });
  return video;
}

function playerFixture({ ipad = false, hlsSupported = true, isMp4 = false } = {}) {
  hlsInstances = 0;
  const video = videoFixture();
  const hlsRef = { current: null };
  const timers = new Map();
  let nextTimer = 0;
  let fallbacks = 0;
  const state = { loading: true, fatal: false };
  const bindings = {
    isCasting: false,
    Hls: class extends HlsStub { static isSupported = () => hlsSupported; },
    hlsRef,
    videoRef: { current: video },
    nativeAirPlay: false,
    nativeAirPlayRef: { current: false },
    playbackRestoreRef: { current: null },
    isAirPlayLoading: false,
    isAirPlaySupported: () => true,
    isRemotePlaybackSupported: () => false,
    useCallback: callback => callback,
    setNativeAirPlay: value => { bindings.nativeAirPlay = value; },
    setPlaybackRevision: noop,
    setIsAirPlayLoading: noop,
    setAirPlayError: noop,
    setAirPlayAvailable: noop,
    setIsAirPlaying: noop,
    setShowCastMenu: noop,
    t: key => key,
    observeNativeAudioTracks,
    setCurrentAudioTrack: noop,
    safePlay: media => media.play(),
    postCastPlaybackSuppressedRef: { current: false },
    getLocalPlaybackInitPolicy,
    bufferingTimeoutRef: { current: null },
    sourceTimeoutRef: { current: null },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    setIsLoading: value => { state.loading = value; },
    setIsBuffering: noop,
    setBuffered: noop,
    setHasFatalPlaybackError: value => { state.fatal = value; },
    requestHlsFallback: () => { fallbacks += 1; state.loading = false; state.fatal = true; },
    src: HLS_SRC,
    subtitleUrl: undefined,
    normalizeUqloadEmbedUrl: url => url,
    kisskhSources: [],
    isMP4Source: () => isMp4,
    contentTypeMp4Urls: new Set(),
    createHlsConfig: () => ({}),
    purstreamSources: [],
    console: silentConsole,
    window: {},
    qualitiesRef: { current: [] },
    qualityPreferenceRef: { current: 'auto' },
    buildHlsQualityOptions: levels => levels.map(() => ({ height: 720 })),
    setQualities: noop,
    selectLevelForPreference: () => 0,
    formatDetectedStreamQuality: () => '720p',
    rememberSourceQuality: noop,
    playbackSpeed: 1,
    lastKnownTimeRef: { current: 0 },
    autoPlay: true,
    setAudioTracks: noop,
    hlsAudioPreferences: new Map(),
    contentQualityKey: 'test',
    contentQualityKeyRef: { current: 'test' },
    selectAudioTrackIndex: () => -1,
    applySelectedTextTrackMode: noop,
    currentSubtitleRef: { current: -1 },
    failed429Segments: new Set(),
    setInterval: noop,
    clearInterval: noop,
    isIpadSafari: () => ipad,
    setEffectiveQualityHeight: noop,
    estimateAverageBitrate: () => Promise.resolve(null),
  };
  bindings.restoreLocalPlayback = noop;
  const cleanup = sourceEffect('src/components/HLSPlayer.tsx', 'const clearSourceTimeout', bindings)();
  return {
    video,
    state,
    cleanup,
    get hlsCount() { return hlsInstances; },
    get hls() { return hlsRef.current; },
    get fallbacks() { return fallbacks; },
    expireSourceTimeout: () => {
      for (const [id, timer] of timers) {
        if (timer.delay === 45000) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

test('iPad Safari avec MSE annoncé lit le master en HLS natif et retire le spinner à loadedmetadata', () => {
  const fixture = playerFixture({ ipad: true });
  try {
    assert.equal(fixture.hlsCount, 0, 'HLS.js/MSE ne doit pas être instancié sur iPad');
    assert.equal(fixture.video.src, HLS_SRC, 'le master doit être confié à la balise vidéo');
    assert.equal(fixture.state.loading, true);
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(fixture.state.loading, false, 'loadedmetadata doit lever le spinner infini');
    assert.equal(fixture.video.playCalls, 1, 'la lecture démarre sur loadedmetadata');
    fixture.expireSourceTimeout();
    assert.equal(fixture.fallbacks, 0, 'un média natif prêt ne doit pas changer de source');
  } finally {
    fixture.cleanup();
  }
});

test('iPad Safari : une source MP4 conserve le chemin MP4 habituel', () => {
  const fixture = playerFixture({ ipad: true, isMp4: true });
  try {
    assert.equal(fixture.hlsCount, 0);
    assert.equal(fixture.video.src, HLS_SRC);
    fixture.video.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(fixture.state.loading, true, 'le spinner MP4 reste géré par le lecteur existant');
  } finally {
    fixture.cleanup();
  }
});

test('iPad Safari : une erreur native sort du chargement et déclenche le secours de source', () => {
  const fixture = playerFixture({ ipad: true });
  try {
    fixture.video.dispatchEvent(new Event('error'));
    assert.equal(fixture.state.loading, false);
    assert.equal(fixture.state.fatal, true);
    assert.equal(fixture.fallbacks, 1);
  } finally {
    fixture.cleanup();
  }
});

for (const platform of [
  { name: 'PC/Mac Safari', options: {} },
  { name: 'Android', options: {} },
  { name: 'iPhone Safari', options: { hlsSupported: false } },
]) {
  test(`${platform.name} conserve son chemin de lecture actuel`, () => {
    const fixture = playerFixture(platform.options);
    try {
      assert.equal(fixture.hlsCount, platform.options.hlsSupported === false ? 0 : 1);
      assert.equal(fixture.video.src, platform.options.hlsSupported === false ? HLS_SRC : undefined);
    } finally {
      fixture.cleanup();
    }
  });
}

function watchPartyFixture({ ipad }) {
  const video = videoFixture();
  const hlsRef = { current: null };
  const errors = [];
  const bindings = {
    videoRef: { current: video },
    room: { media: { src: HLS_SRC } },
    hlsRef,
    Hls: HlsStub,
    setError: message => errors.push(message),
    isIpadSafari: () => ipad,
  };
  const cleanup = sourceEffect(
    'src/pages/WatchPartyPage.tsx',
    'hlsRef.current?.destroy()',
    bindings,
  )();
  return { video, errors, cleanup, get hls() { return hlsRef.current; } };
}

test('WatchParty sur iPad Safari laisse le HLS natif lire le flux et affiche une erreur lisible', () => {
  const fixture = watchPartyFixture({ ipad: true });
  try {
    assert.equal(fixture.hls, null, 'pas de HLS.js/MSE sur iPad');
    assert.equal(fixture.video.src, HLS_SRC);
    fixture.video.dispatchEvent(new Event('error'));
    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.errors[0], /iPad/i);
  } finally {
    fixture.cleanup();
  }
  fixture.video.dispatchEvent(new Event('error'));
  assert.equal(fixture.errors.length, 1, 'le listener natif est retiré au nettoyage');
});

test('WatchParty hors iPad garde Hls.js pour un manifeste .m3u8', () => {
  const fixture = watchPartyFixture({ ipad: false });
  try {
    assert.ok(fixture.hls, 'le chemin HLS.js existant reste inchangé');
    assert.equal(fixture.video.src, '');
  } finally {
    fixture.cleanup();
  }
});
