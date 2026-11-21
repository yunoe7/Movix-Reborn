/**
 * Vérifie à l'exécution le moteur i18next réel du frontend, dans les deux
 * locales chargées, en capturant les événements `missingKey` sans les masquer.
 *
 * Le bundle est construit depuis les sources avec esbuild, puis exécuté avec
 * un minimum de shims navigateur. Toutes les clés des bundles sont traduites
 * avec plusieurs valeurs de `count` pour couvrir les formes plurielles.
 *
 * Run: node scripts/check-i18n-runtime.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');

const entry = `
import i18n, { AVAILABLE_LANGUAGES, changeLanguage, getResolvedAppLanguage } from '@/i18n';
globalThis.__i18nCheck = { i18n, AVAILABLE_LANGUAGES, changeLanguage, getResolvedAppLanguage };
`;

const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'movix-i18n-runtime-'));
const bundlePath = path.join(tempDir, 'i18n.cjs');
const originalLog = console.log;
const originalWarn = console.warn;
try {
  await build({
    stdin: { contents: entry, loader: 'js', resolveDir: repo },
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    nodePaths: [path.join(repo, 'node_modules')],
    alias: { '@': path.join(repo, 'src') },
    define: { 'import.meta.env': JSON.stringify({ VITE_SITE_URL: 'https://movix.test' }) },
    logLevel: 'silent',
  });

  const storage = new Map();
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storage.set(key, String(value)); },
    removeItem: key => { storage.delete(key); },
  };
  globalThis.window = { localStorage, sessionStorage: localStorage, location: { hostname: 'movix.test' } };
  globalThis.localStorage = localStorage;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'fr', languages: ['fr'] },
  });
  globalThis.fetch = async () => ({ ok: false });

  const missing = [];
  const waitFor = async (condition, label) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error(`${label} — bundle=${i18n.hasResourceBundle('en', 'translation')} language=${i18n.language} resolved=${i18n.resolvedLanguage} app=${getResolvedAppLanguage()}`);
      }
      await new Promise(resolve => setImmediate(resolve));
    }
  };
  console.log = (...args) => {
    const values = Array.isArray(args[0]) ? args[0] : args;
    if (typeof values[0] === 'string' && values[0].includes('missingKey')) {
      missing.push({ lng: values[1], namespace: values[2], key: values[3] });
    }
  };
  console.warn = () => {};

  require(bundlePath);
  const { i18n, AVAILABLE_LANGUAGES, changeLanguage, getResolvedAppLanguage } = globalThis.__i18nCheck;
  await waitFor(() => i18n.isInitialized, 'i18next non initialisé');
  i18n.logger.debug = true;
  if (i18n.translator?.logger) i18n.translator.logger.debug = true;

  const keys = [];
  const collect = (value, prefix = '') => {
    for (const [key, child] of Object.entries(value)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) collect(child, full);
      else keys.push(full);
    }
  };
  collect(JSON.parse(fs.readFileSync(path.join(repo, 'src/i18n/locales/fr.json'), 'utf8')));
  keys.sort();

  missing.length = 0;
  i18n.t('__i18n_probe_missing__');
  if (!missing.some(item => item.key === '__i18n_probe_missing__')) {
    throw new Error('la capture des missingKey ne fonctionne pas');
  }

  const results = [];
  for (const lng of AVAILABLE_LANGUAGES.map(language => language.code)) {
    missing.length = 0;
    await changeLanguage(lng);
    // Le bundle anglais est importé à la demande : une seconde sélection
    // stabilise resolvedLanguage une fois la ressource enregistrée.
    if (i18n.resolvedLanguage !== lng) await changeLanguage(lng);
    await waitFor(
      () => i18n.hasResourceBundle(lng, 'translation')
        && i18n.resolvedLanguage === lng
        && getResolvedAppLanguage() === lng,
      `locale ${lng} non active`,
    );
    for (const key of keys) {
      i18n.t(key);
      for (const count of [0, 1, 2, 5, 1000000]) i18n.t(key, { count });
    }
    results.push({ locale: lng, keys: keys.length, calls: keys.length * 6, missing: missing.length });
  }

  if (results.some(result => result.missing > 0)) {
    throw new Error(`missingKey détectés: ${JSON.stringify(missing.slice(0, 20))}`);
  }
  originalLog(`i18n runtime OK — ${results.map(r => `${r.locale}:${r.calls} appels/0 missing`).join(', ')}`);
} finally {
  console.log = originalLog;
  console.warn = originalWarn;
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}
