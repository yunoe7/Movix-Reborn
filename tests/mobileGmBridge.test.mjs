import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { sourceEffect, sourceFunction } from './helpers/sourceFunction.mjs';

const KEY = 'movix_extraction_prefs';
const PREFS = {
  version: 1,
  m3u8: { voe: false },
  livetv: { vavoo: true },
};
const M3U8_KEYS = [
  'voe', 'fsvid', 'vidzy', 'vidmoly', 'sibnet', 'uqload', 'doodstream',
  'seekstreaming', 'lulustream', 'veev', 'vidara',
];
const LIVETV_KEYS = ['northlive', 'vavoo', 'matches'];

const DEFAULT_PREFS = {
  version: 1,
  m3u8: Object.fromEntries(M3U8_KEYS.map(key => [key, true])),
  livetv: Object.fromEntries(LIVETV_KEYS.map(key => [key, true])),
};

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

// sourceFunction transpile telles quelles les déclarations trouvées : un
// `export function` ne peut donc pas être évalué directement. On retire uniquement
// le modificateur pour les helpers exportés du code de production.
function sourceExportFunction(file, name, bindings = {}) {
  const sourcePath = new URL(`../${file}`, import.meta.url);
  const source = ts.createSourceFile(
    file,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let declaration;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === name) {
      declaration = node.getText(source).replace(/^export\s+/, '');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Fonction exportée ${name} introuvable dans ${file}`);
  const js = ts.transpile(declaration, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  });
  return new Function(...Object.keys(bindings), `${js}\nreturn ${name};`)(
    ...Object.values(bindings),
  );
}

// Extrait le premier argument d'un useMemo : c'est le callback qui construit
// le script injecté, et ses dépendances doivent refléter le snapshot GM.
function sourceMemo(file, includes, bindings = {}) {
  const sourcePath = new URL(`../${file}`, import.meta.url);
  const source = ts.createSourceFile(
    file,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression;
  const visit = node => {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(source) === 'useMemo'
      && node.arguments[0]?.getText(source).includes(includes)
    ) {
      expression = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error(`Memo introuvable dans ${file}: ${includes}`);
  const js = ts.transpile(`const memo = ${expression};`, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.None,
  });
  return new Function(...Object.keys(bindings), `${js}\nreturn memo;`)(
    ...Object.values(bindings),
  );
}

// Le userscript est du JS pur : on parse ses déclarations nominales pour
// exécuter le vrai handler dans un DOM simulé.
function sourceJsFunction(file, name) {
  const sourcePath = new URL(`../${file}`, import.meta.url);
  const source = ts.createSourceFile(
    file,
    readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let declaration;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(source) === name) {
      declaration = node.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Fonction ${name} introuvable dans ${file}`);
  return declaration;
}

function normalizeFromSource() {
  return sourceExportFunction('app/src/services/bridge.ts', 'normalizeExtractionPrefs', {
    MOVIX_M3U8_KEYS: M3U8_KEYS,
    MOVIX_LIVETV_KEYS: LIVETV_KEYS,
  });
}

function settingsCallback(name, bindings) {
  return sourceFunction('app/src/screens/SettingsScreen.tsx', name, {
    useCallback: fn => fn,
    MOVIX_EXTRACTION_PREFS_KEY: KEY,
    ...bindings,
  });
}

test('26 — la poussée native met à jour le userscript déjà chargé sans reload', () => {
  const injected = [];
  const storage = new Map();
  const webViewRef = {
    current: { injectJavaScript: script => injected.push(script) },
  };
  const push = sourceExportFunction('app/src/services/bridge.ts', 'pushGmValueToWebViews', {
    storage,
    gmWebViewRefs: new Set([webViewRef]),
    GM_VALUE_CHANGE_EVENT: 'movix:gm-value-changed',
    notifyGmStorageListeners: () => {},
  });

  push(KEY, PREFS);

  assert.deepEqual(storage.get(KEY), PREFS);
  assert.equal(injected.length, 1);

  const calls = [];
  const events = [];
  new Function('window', 'CustomEvent', injected[0])(
    {
      __MOVIX_SET_NATIVE_GM_VALUE__: (key, value) => calls.push([key, value]),
      dispatchEvent: event => events.push(event),
    },
    FakeCustomEvent,
  );

  assert.deepEqual(calls, [[KEY, PREFS]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'movix:gm-value-changed');
  assert.deepEqual(events[0].detail, { key: KEY, value: PREFS });
});

test('27 — la ref WebView est enregistrée dès le montage et libérée au nettoyage', () => {
  const registrations = [];
  const effect = sourceEffect(
    'app/src/components/WebViewBrowser.tsx',
    'registerGmWebViewRef',
    {
      webViewRef: { current: null },
      registerGmWebViewRef: ref => registrations.push(['register', ref]),
      unregisterGmWebViewRef: ref => registrations.push(['unregister', ref]),
      startCastShimEventForwarding: () => () => {},
      startPictureInPictureEventForwarding: () => () => {},
      clearBridgeCapabilities: () => {},
      setPictureInPicturePlaybackActive: () => {},
      setLocalPlaybackAwake: () => {},
      onPictureInPictureModeChange: undefined,
    },
  );

  const cleanup = effect();

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], 'register');
  assert.ok(registrations[0][1]);
  cleanup();
  assert.deepEqual(registrations.map(entry => entry[0]), ['register', 'unregister']);
});

test('27 — les préférences initiales sont injectées au document-start, avant le runtime', () => {
  const builtOptions = [];
  const injectedJavaScriptFor = sourceFunction(
    'app/src/components/WebViewBrowser.tsx',
    'injectedJavaScriptFor',
    {
      INJECTED_JS_BY_JOURNAL_STATE: new Map(),
      BASE_INJECTION_OPTIONS: {},
      buildInjectedJavaScript: options => {
        builtOptions.push(options);
        return 'RUNTIME_BRIDGE_MARKER';
      },
    },
  );

  const script = injectedJavaScriptFor(false, { [KEY]: PREFS });

  assert.ok(
    script.indexOf('__MOVIX_NATIVE_GM_STORAGE__') < script.indexOf('RUNTIME_BRIDGE_MARKER'),
    'le snapshot natif doit précéder le runtime injecté',
  );
  assert.match(script, /movix_extraction_prefs/);
  assert.equal(builtOptions.length, 1);
});

test('29 — les préférences stockées sont normalisées au redémarrage', async () => {
  const normalize = normalizeFromSource();
  assert.deepEqual(
    normalize({ version: 1, m3u8: { voe: false, inconnu: 'x' }, livetv: { vavoo: true } }),
    {
      version: 1,
      m3u8: {
        voe: false,
        fsvid: true, vidzy: true, vidmoly: true, sibnet: true, uqload: true,
        doodstream: true, seekstreaming: true, lulustream: true, veev: true, vidara: true,
      },
      livetv: { northlive: true, vavoo: true, matches: true },
    },
  );
  assert.equal(normalize(null).m3u8.voe, true);
  assert.equal(normalize({ version: '1', m3u8: 'oops' }).livetv.vavoo, true);

  const calls = [];
  const restore = settingsCallback('restoreExtractionPrefs', {
    AsyncStorage: {
      getItem: async () => JSON.stringify({ version: 1, m3u8: { voe: false }, livetv: { vavoo: true } }),
    },
    normalizeExtractionPrefs: normalize,
    setExtractionPrefs: value => calls.push(['state', value]),
    pushGmValueToWebViews: (key, value) => calls.push(['WebView', key, value]),
  });

  await restore();

  assert.equal(calls.some(entry => entry[0] === 'WebView'), true);
  const pushed = calls.find(entry => entry[0] === 'WebView');
  assert.deepEqual(pushed.slice(1), [KEY, normalize({ version: 1, m3u8: { voe: false }, livetv: { vavoo: true } })]);
});

test('29 — un reset global empêche la valeur périmée de revenir au redémarrage', async () => {
  const calls = [];
  const restore = settingsCallback('restoreExtractionPrefs', {
    AsyncStorage: { getItem: async () => null },
    normalizeExtractionPrefs: normalizeFromSource(),
    setExtractionPrefs: value => calls.push(['state', value]),
    pushGmValueToWebViews: (key, value) => calls.push(['WebView', key, value]),
  });

  await restore();

  assert.equal(calls.some(entry => entry[0] === 'WebView'), false);
});

test('29 — l’écriture AsyncStorage est confirmée avant la poussée WebView', async () => {
  const sequence = [];
  const update = settingsCallback('updateExtractionPrefs', {
    setExtractionPrefs: () => {},
    normalizeExtractionPrefs: normalizeFromSource(),
    AsyncStorage: {
      setItem: async (key, value) => {
        sequence.push(['AsyncStorage', key, JSON.parse(value)]);
      },
    },
    pushGmValueToWebViews: (key, value) => sequence.push(['WebView', key, value]),
  });

  await update({ version: 1, m3u8: { voe: false }, livetv: { vavoo: true } });

  assert.deepEqual(sequence, [
    ['AsyncStorage', KEY, normalizeFromSource()({ version: 1, m3u8: { voe: false }, livetv: { vavoo: true } })],
    ['WebView', KEY, normalizeFromSource()({ version: 1, m3u8: { voe: false }, livetv: { vavoo: true } })],
  ]);
});

test('29 — AsyncStorage en erreur ne pousse pas une valeur non persistée', async () => {
  const pushes = [];
  const update = settingsCallback('updateExtractionPrefs', {
    setExtractionPrefs: () => {},
    normalizeExtractionPrefs: normalizeFromSource(),
    AsyncStorage: {
      setItem: async () => {
        throw new Error('AsyncStorage indisponible');
      },
    },
    pushGmValueToWebViews: (key, value) => pushes.push([key, value]),
  });

  await update(PREFS);

  assert.deepEqual(pushes, []);
});

test('28 — GM_deleteValue efface cache, localStorage WebView, snapshot natif et Map native', async () => {
  const source = readFileSync(
    new URL('../app/src/injection/bridge-runtime.ts', import.meta.url),
    'utf8',
  );
  const match = source.match(/function GM_deleteValue\(key\) \{[\s\S]*?\n  \}/);
  const forgetMatch = source.match(/function forgetNativeGmValue\(key\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'GM_deleteValue doit exister dans le runtime du pont WebView');
  assert.ok(forgetMatch, 'forgetNativeGmValue doit exister dans le runtime du pont WebView');

  const localStore = new Map([[`movix_userscript:${KEY}`, JSON.stringify(PREFS)]]);
  const localStorage = {
    setItem: (key, value) => localStore.set(key, value),
    getItem: key => localStore.get(key) ?? null,
    removeItem: key => localStore.delete(key),
  };
  const cache = { [KEY]: PREFS };
  const snapshot = { [KEY]: PREFS, autre: 1 };
  const sent = [];
  const deleteValue = new Function(
    '_storageCache',
    '_nativeStorageSnapshot',
    'localStorage',
    'sendToNative',
    'generateId',
    `${forgetMatch[0]}\n${match[0]}\nreturn GM_deleteValue;`,
  )(
    cache,
    snapshot,
    localStorage,
    message => sent.push(message),
    () => 'req_delete',
  );

  deleteValue(KEY);

  assert.equal(KEY in cache, false);
  assert.equal(localStore.has(`movix_userscript:${KEY}`), false);
  assert.equal(KEY in snapshot, false);
  assert.equal(snapshot.autre, 1);
  assert.deepEqual(sent, [{ type: 'GM_DELETE_VALUE', id: 'req_delete', key: KEY }]);

  const storage = new Map([[KEY, PREFS]]);
  const removed = [];
  const handleDelete = sourceFunction('app/src/services/bridge.ts', 'handleGMDeleteValue', {
    storage,
    getGmAsyncStorage: async () => ({ removeItem: async key => removed.push(key) }),
    notifyGmStorageListeners: () => {},
  });

  const response = await handleDelete({ id: 'req_delete', key: KEY });

  assert.equal(response.success, true);
  assert.equal(storage.has(KEY), false);
  assert.deepEqual(removed, [KEY]);
});

test('30 — reset global émet la suppression native movix_extraction_prefs', () => {
  const removed = [];
  const calls = [];
  const events = [];
  const reset = sourceExportFunction('src/utils/resetAllSettings.ts', 'resetAllSettings', {
    SETTINGS_STORAGE_KEYS: ['settings_image_quality'],
    localStorage: { removeItem: key => removed.push(key) },
    resetExtractionPrefs: () => calls.push('resetExtractionPrefs'),
    pushPrefsToExtension: () => calls.push('pushPrefsToExtension'),
    NATIVE_GM_CHANGE_EVENT: 'movix:gm-value-changed',
    MOVIX_EXTRACTION_PREFS_KEY: KEY,
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: FakeCustomEvent,
  });

  reset();

  assert.deepEqual(removed, ['settings_image_quality']);
  assert.ok(calls.includes('resetExtractionPrefs'));
  assert.ok(calls.includes('pushPrefsToExtension'));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'movix:gm-value-changed');
  assert.deepEqual(events[0].detail, { key: KEY, value: null });
});

test('30 — build-userscript --check distingue source absente et dérive réelle', () => {
  const directory = mkdtempSync(join(tmpdir(), 'movix-build-userscript-'));
  const run = args => spawnSync(process.execPath, ['app/scripts/build-userscript.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  try {
    const missing = join(directory, 'absent', 'userscript-source.ts');
    const absentResult = run(['--check', '--output', missing]);
    assert.equal(absentResult.status, 2, absentResult.stdout + absentResult.stderr);
    assert.match(absentResult.stderr, /Source générée absente/);

    const drifted = join(directory, 'derive.ts');
    writeFileSync(drifted, 'export const USERSCRIPT_SOURCE = `ancienne version`;');
    const driftResult = run(['--check', '--output', drifted]);
    assert.equal(driftResult.status, 1, driftResult.stdout + driftResult.stderr);
    assert.match(driftResult.stderr, /Dérive détectée/);
    assert.ok(driftResult.stderr.includes(drifted));

    const generated = join(directory, 'genere.ts');
    const generationResult = run(['--output', generated]);
    assert.equal(generationResult.status, 0, generationResult.stdout + generationResult.stderr);
    assert.match(readFileSync(generated, 'utf8'), /movix:gm-value-changed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('05 — une poussée native met à jour le snapshot injecté à la navigation suivante', () => {
  const storage = new Map();
  const listeners = new Set();
  const getSnapshot = sourceExportFunction('app/src/services/bridge.ts', 'getGmStorageSnapshot', {
    storage,
  });
  const notify = sourceExportFunction('app/src/services/bridge.ts', 'notifyGmStorageListeners', {
    gmStorageListeners: listeners,
    getGmStorageSnapshot: getSnapshot,
  });
  const subscribe = sourceExportFunction('app/src/services/bridge.ts', 'subscribeGmStorageChanges', {
    gmStorageListeners: listeners,
  });
  const push = sourceExportFunction('app/src/services/bridge.ts', 'pushGmValueToWebViews', {
    storage,
    gmWebViewRefs: new Set(),
    GM_VALUE_CHANGE_EVENT: 'movix:gm-value-changed',
    notifyGmStorageListeners: notify,
  });

  let currentSnapshot = {};
  const unsubscribe = sourceEffect(
    'app/src/components/WebViewBrowser.tsx',
    'subscribeGmStorageChanges',
    {
      subscribeGmStorageChanges: subscribe,
      setGmStorageSnapshot: snapshot => { currentSnapshot = snapshot; },
    },
  )();

  assert.equal(typeof unsubscribe, 'function');
  assert.equal(listeners.size, 1);

  const scriptFor = snapshot => sourceMemo(
    'app/src/components/WebViewBrowser.tsx',
    'injectedJavaScriptFor',
    {
      injectedJavaScriptFor: (_journal, gmSnapshot, ready) =>
        `SCRIPT:${JSON.stringify(gmSnapshot)}:${ready}`,
      journalConsole: false,
      nativeStorageReady: true,
      gmStorageSnapshot: snapshot,
    },
  )();

  assert.doesNotMatch(scriptFor(currentSnapshot), /"voe":false/);

  push(KEY, PREFS);

  assert.deepEqual(currentSnapshot, { [KEY]: PREFS });
  const nextNavigationScript = scriptFor(currentSnapshot);
  assert.match(nextNavigationScript, /"voe":false/);
  assert.match(nextNavigationScript, /"vavoo":true/);

  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('08 — le handler natif du userscript met à jour la config effective puis supprime la clé', async () => {
  const normalizeSource = sourceJsFunction(
    'userscript/movix.user.js',
    'normalizeExtractionPrefsFromNative',
  );
  const handlerSource = sourceJsFunction(
    'userscript/movix.user.js',
    'handleNativeGmValueChange',
  );
  const calls = [];
  const pageListeners = {};
  const pageWindow = {
    addEventListener: (type, handler) => { pageListeners[type] = handler; },
  };

  const runtime = new Function(
    'pageWindow',
    'DEFAULT_EXTRACTION_PREFS',
    'gmSetValueCompat',
    'gmDeleteValueCompat',
    `${normalizeSource}
let extractionPrefs = DEFAULT_EXTRACTION_PREFS;
${handlerSource}
pageWindow.addEventListener("movix:gm-value-changed", handleNativeGmValueChange);
return { getPrefs: () => extractionPrefs };`,
  )(
    pageWindow,
    DEFAULT_PREFS,
    async (key, value) => { calls.push(['set', key, value]); },
    async key => { calls.push(['delete', key]); },
  );

  const handler = pageListeners['movix:gm-value-changed'];
  assert.equal(typeof handler, 'function');

  await handler(new FakeCustomEvent('movix:gm-value-changed', {
    detail: {
      key: KEY,
      value: { version: 1, m3u8: { voe: false }, livetv: { vavoo: true } },
    },
  }));

  assert.equal(handler.constructor.name, 'AsyncFunction');
  assert.equal(pageListeners['movix:gm-value-changed'].name, 'handleNativeGmValueChange');
  assert.equal(calls[0][0], 'set');
  assert.equal(calls[0][1], KEY);
  assert.equal(calls[0][2].m3u8.voe, false);
  assert.equal(calls[0][2].m3u8.fsvid, true);
  assert.equal(calls[0][2].livetv.vavoo, true);

  await handler(new FakeCustomEvent('movix:gm-value-changed', {
    detail: { key: KEY, value: null },
  }));

  assert.deepEqual(calls.at(-1), ['delete', KEY]);
  assert.deepEqual(runtime.getPrefs(), DEFAULT_PREFS);
});

test('12 — une valeur AsyncStorage corrompue est normalisée en mémoire sans réécriture', async () => {
  const writes = [];
  const pushes = [];
  const storage = new Map();
  const normalize = normalizeFromSource();
  const hydrate = sourceExportFunction(
    'app/src/services/bridge.ts',
    'hydrateGmStorageFromAsyncStorage',
    {
      getGmAsyncStorage: async () => ({
        getItem: async () => '{invalid json',
        setItem: async (key, value) => writes.push([key, value]),
        removeItem: async () => {},
      }),
      MOVIX_EXTRACTION_PREFS_KEY: KEY,
      normalizeExtractionPrefs: normalize,
      storage,
      pushGmValueToWebViews: (key, value) => pushes.push([key, value]),
      notifyGmStorageListeners: () => {},
    },
  );

  await hydrate();

  assert.deepEqual(storage.get(KEY), normalize(null));
  assert.deepEqual(writes, []);
  assert.deepEqual(pushes, [[KEY, normalize(null)]]);
});
