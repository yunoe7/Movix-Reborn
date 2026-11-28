import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

const PREFS = {
  version: 1,
  m3u8: { voe: false },
  livetv: { vavoo: true }
};

const NORMALIZED = {
  version: 1,
  m3u8: {
    voe: false,
    fsvid: true,
    vidzy: true,
    vidmoly: true,
    sibnet: true,
    uqload: true,
    doodstream: true,
    seekstreaming: true,
    lulustream: true,
    veev: true,
    vidara: true
  },
  livetv: { northlive: true, vavoo: true, matches: true }
};

function bridgeGetValue(nativeStorage) {
  const source = readFileSync(new URL('../app/src/injection/bridge-runtime.ts', import.meta.url), 'utf8');
  const match = source.match(/function GM_getValue\(key, defaultValue\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'GM_getValue doit exister dans le runtime du pont WebView');
  const localStorage = { getItem: () => null };
  const window = { __MOVIX_NATIVE_GM_STORAGE__: nativeStorage };
  return new Function('_storageCache', 'localStorage', 'window', `${match[0]}\nreturn GM_getValue;`)({}, localStorage, window);
}

test('GM_getValue lit la valeur poussée par le natif, pas seulement le localStorage de la WebView', () => {
  const getValue = bridgeGetValue({ movix_extraction_prefs: PREFS });

  assert.deepEqual(getValue('movix_extraction_prefs', null), PREFS);
});

test('une préférence modifiée dans les réglages est poussée dans la WebView', async () => {
  const pushes = [];
  const updateExtractionPrefs = sourceFunction('app/src/screens/SettingsScreen.tsx', 'updateExtractionPrefs', {
    useCallback: (fn) => fn,
    setExtractionPrefs: () => {},
    normalizeExtractionPrefs: () => NORMALIZED,
    MOVIX_EXTRACTION_PREFS_KEY: 'movix_extraction_prefs',
    AsyncStorage: { setItem: async (key, value) => { pushes.push(['AsyncStorage', key, JSON.parse(value)]); } },
    pushGmValueToWebViews: (key, value) => { pushes.push(['WebView', key, value]); }
  });

  await updateExtractionPrefs(PREFS);

  assert.deepEqual(pushes, [
    ['AsyncStorage', 'movix_extraction_prefs', NORMALIZED],
    ['WebView', 'movix_extraction_prefs', NORMALIZED]
  ]);
});
