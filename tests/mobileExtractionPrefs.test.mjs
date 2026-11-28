import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

const PREFS = {
  version: 1,
  m3u8: { voe: false },
  livetv: { vavoo: true }
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
    AsyncStorage: { setItem: async (key, value) => { pushes.push(['AsyncStorage', key, JSON.parse(value)]); } },
    pushGmValueToWebViews: (key, value) => { pushes.push(['WebView', key, value]); }
  });

  await updateExtractionPrefs(PREFS);

  assert.deepEqual(pushes, [
    ['WebView', 'movix_extraction_prefs', PREFS],
    ['AsyncStorage', 'movix_extraction_prefs', PREFS]
  ]);
});
