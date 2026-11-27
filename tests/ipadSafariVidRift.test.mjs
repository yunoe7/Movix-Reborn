import assert from 'node:assert/strict';
import test from 'node:test';
import { isIpadSafari } from '../src/utils/deviceDetection.ts';
import { sourceFunction, sourceNamedFunction } from './helpers/sourceFunction.mjs';

// La page /watch/* monte VidRiftPlayer, pas HLSPlayer : la régression iPad
// observée en production vient donc des paramètres de l'iframe distante. Ces
// tests, écrits avant le correctif, lisent les vrais constructeurs d'URL du source.
const IPAD_9_UA = 'Mozilla/5.0 (iPad; CPU OS 13_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPAD_CHROME_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';

const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';
const VIDRIFT_BRAND_COLOR = 'DC2626';

function withNavigator(userAgent, maxTouchPoints, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent, maxTouchPoints },
  });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

function playerSrc(props) {
  return sourceFunction('src/components/VidRiftPlayer.tsx', 'src', {
    useMemo: (factory) => factory(),
    Number,
    encodeURIComponent,
    URL,
    VIDRIFT_ORIGIN,
    VIDRIFT_BRAND_COLOR,
    isIpadSafari,
    kind: props.kind ?? 'movie',
    tmdbId: props.tmdbId ?? '550',
    season: props.season ?? 1,
    episode: props.episode ?? 1,
    title: props.title ?? 'Fight Club',
    posterPath: props.posterPath ?? 'https://image.tmdb.org/t/p/w500/poster.jpg',
  });
}

function partySrc(media) {
  const callback = sourceNamedFunction('src/pages/WatchPartyPage.tsx', 'buildVidRiftEmbedUrl', {
    URL,
    VIDRIFT_ORIGIN,
    isIpadSafari,
    media,
  });
  return callback(media);
}

const movieMedia = {
  mediaId: '550',
  mediaType: 'movie',
  title: 'Fight Club',
  poster: 'https://image.tmdb.org/t/p/w500/poster.jpg',
};

const tvMedia = {
  mediaId: '1396',
  mediaType: 'tv',
  title: 'Breaking Bad',
  seasonNumber: 2,
  episodeNumber: 3,
  poster: 'https://image.tmdb.org/t/p/w500/poster.jpg',
};

for (const [name, userAgent, touches, expected] of [
  ['iPad 9 Safari classique', IPAD_9_UA, 5, 'vexon'],
  ['iPad Safari en mode desktop', IPAD_DESKTOP_UA, 5, 'vexon'],
]) {
  test(`${name} : le lecteur normal demande le serveur natif HLS pour un film`, () => {
    withNavigator(userAgent, touches, () => {
      const url = new URL(playerSrc({ kind: 'movie' }));
      assert.equal(url.searchParams.get('pref'), expected);
      assert.equal(url.searchParams.get('provider'), null);
      assert.equal(url.origin, VIDRIFT_ORIGIN);
      assert.match(url.pathname, /^\/embed\/movie\/550$/);
    });
  });

  test(`${name} : la WatchParty demande le serveur natif HLS pour une série`, () => {
    withNavigator(userAgent, touches, () => {
      const url = new URL(partySrc(tvMedia));
      assert.equal(url.searchParams.get('pref'), 'evion');
      assert.equal(url.searchParams.get('provider'), null);
      assert.match(url.pathname, /^\/embed\/tv\/1396\/2\/3$/);
    });
  });
}

for (const [name, userAgent, touches] of [
  ['iPhone Safari', PHONE_UA, 1],
  ['Mac Safari', MAC_UA, 0],
  ['Chrome desktop', CHROME_UA, 0],
  ['Android Chrome', ANDROID_UA, 5],
  ['Chrome sur iPad', IPAD_CHROME_UA, 5],
]) {
  test(`${name} conserve l'ordre de serveurs VidRift par défaut`, () => {
    withNavigator(userAgent, touches, () => {
      assert.equal(new URL(playerSrc({ kind: 'movie' })).searchParams.get('pref'), null);
      assert.equal(new URL(partySrc(movieMedia)).searchParams.get('pref'), null);
    });
  });
}

test('les paramètres existants du lecteur VidRift restent inchangés sur iPad', () => {
  withNavigator(IPAD_9_UA, 5, () => {
    const normal = new URL(playerSrc({ kind: 'movie' }));
    const party = new URL(partySrc(movieMedia));
    for (const url of [normal, party]) {
      assert.equal(url.searchParams.get('brand'), 'Movix');
      assert.equal(url.searchParams.get('brandColor'), VIDRIFT_BRAND_COLOR);
      assert.equal(url.searchParams.get('download'), '1');
      assert.equal(url.searchParams.get('title'), 'Fight Club');
      assert.equal(url.searchParams.get('poster'), movieMedia.poster);
    }
    assert.equal(normal.searchParams.get('exit'), null);
    assert.equal(party.searchParams.get('exit'), '1');
  });
});

test('un identifiant TMDB invalide ne produit aucune iframe ni paramètre pref', () => {
  withNavigator(IPAD_9_UA, 5, () => {
    assert.equal(playerSrc({ tmdbId: '../../evil' }), '');
    assert.equal(partySrc({ ...movieMedia, mediaId: 'not-a-number' }), '');
  });
});
