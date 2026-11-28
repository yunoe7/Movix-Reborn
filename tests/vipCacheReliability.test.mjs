import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function loadVipUtils(values, responder) {
  const source = readFileSync(new URL('../src/utils/vipUtils.ts', import.meta.url), 'utf8')
    .replace('import.meta.env.VITE_MAIN_API', JSON.stringify('https://api.test'));
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const localStorage = {
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => { values[key] = String(value); },
    removeItem: (key) => { delete values[key]; }
  };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return responder({ url, init, values });
  };
  const window = {
    dispatchEvent: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  new Function('exports', 'require', 'localStorage', 'fetch', 'window', 'console', js)(
    exports,
    (name) => {
      if (name === './browserStorage') return { readLocalStorage: (key) => localStorage.getItem(key) };
      throw new Error(`module inattendu : ${name}`);
    },
    localStorage,
    fetch,
    window,
    { warn() {}, error() {}, log() {} }
  );
  return { utils: exports, requests };
}

const valid = (vip, reason = '') => ({ ok: true, json: async () => ({ vip, reason }) });

test('un changement de clé VIP force une nouvelle vérification serveur', async () => {
  const values = { access_code: 'KEY-A', is_vip: 'true' };
  const { utils, requests } = loadVipUtils(values, () => valid(true));

  assert.equal(await utils.checkVipStatus(), true);
  values.access_code = 'KEY-B';
  assert.equal(await utils.checkVipStatus(true), true);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers['x-access-key'], 'KEY-A');
  assert.equal(requests[1].init.headers['x-access-key'], 'KEY-B');
});

test('une vérification forcée avec une autre clé ne réutilise pas la promesse en vol', async () => {
  let resolveA;
  let resolveB;
  const values = { access_code: 'KEY-A' };
  const { utils, requests } = loadVipUtils(values, ({ init }) => {
    const key = init.headers['x-access-key'];
    if (key === 'KEY-A') return new Promise((resolve) => { resolveA = resolve; });
    return new Promise((resolve) => { resolveB = resolve; });
  });

  const inFlightA = utils.checkVipStatus(true);
  values.access_code = 'KEY-B';
  const inFlightB = utils.checkVipStatus(true);

  assert.notEqual(inFlightA, inFlightB, 'les deux clés doivent avoir leur propre vérification');
  resolveA(valid(true));
  resolveB(valid(false));
  assert.equal(await inFlightA, true);
  assert.equal(await inFlightB, false);
  assert.equal(requests.length, 2);
});

test('le cache d’une clé n’est pas servi pour une autre clé', async () => {
  const values = { access_code: 'KEY-A' };
  const { utils, requests } = loadVipUtils(values, ({ init }) => valid(init.headers['x-access-key'] === 'KEY-A'));

  assert.equal(await utils.checkVipStatus(), true);
  values.access_code = 'KEY-B';
  assert.equal(await utils.checkVipStatus(), false);

  assert.equal(requests.length, 2, 'la seconde clé doit être vérifiée malgré le cache encore valide de la première');
  assert.equal(values.is_vip, undefined);
});
