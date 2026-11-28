import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Ces tests exécutent le VRAI worker Synchronisation Pro, compilé depuis sa
// source TypeScript, avec une horloge et des timers déterministes. Le but est
// de vérifier les positions/états/ordres de commande observés par un lecteur,
// pas seulement les messages émis par Socket.IO.
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const WORKER_FILE = path.resolve('src/workers/watchpartySync.worker.ts');
const T0 = 1_700_000_000_000;

const FROZEN_STATE = { isPlaying: true, position: 120, updatedAt: T0 - 1000, updatedBy: 'host-1' };

function compileWorker() {
  const built = esbuild.buildSync({
    entryPoints: [WORKER_FILE],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    write: false,
    logLevel: 'silent'
  });
  return built.outputFiles[0].text;
}

const WORKER_SOURCE = compileWorker();

function createWasmFixture({ missing = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'watchparty-sync-pro-'));
  const moduleDir = path.join(root, 'wasm', 'watchparty-sync');
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  if (missing) return { root, calls: globalThis.__watchpartyWasmCalls ||= [] };
  writeFileSync(path.join(moduleDir, 'watchparty_sync.js'), `
const calls = globalThis.__watchpartyWasmCalls ||= [];
export default async function init() {}
export class WatchPartySyncEngine {
  constructor() { calls.push(['construct']); }
  reset() { calls.push(['reset']); return []; }
  set_mode(mode) { calls.push(['set_mode', mode]); return []; }
  ingest_master_state(state) { calls.push(['ingest_master_state', JSON.parse(JSON.stringify(state))]); return []; }
  ingest_schedule(event) { calls.push(['ingest_schedule', JSON.parse(JSON.stringify(event))]); return []; }
  update_clock_offset(result) { calls.push(['update_clock_offset', JSON.parse(JSON.stringify(result))]); return []; }
  tick(state) { calls.push(['tick', JSON.parse(JSON.stringify(state))]); return []; }
  get_status() { return 'perfect'; }
}
`);
  return { root, calls: globalThis.__watchpartyWasmCalls };
}

function createEngine({ wasm = false, wasmMissing = false, mode = 'pro', state = FROZEN_STATE } = {}) {
  const originalDateNow = Date.now;
  let now = T0;
  Date.now = () => now;

  let fixture = null;
  let origin = 'http://127.0.0.1:1';
  if (wasm) {
    fixture = createWasmFixture({ missing: wasmMissing });
    globalThis.__watchpartyWasmCalls = fixture.calls;
    origin = pathToFileURL(fixture.root).href;
  }

  const messages = [];
  const listeners = [];
  const timers = new Map();
  let nextTimerId = 0;

  const fakeSelf = {
    location: { origin },
    postMessage(message) { messages.push({ ...message, at: now }); },
    addEventListener(type, handler) { if (type === 'message') listeners.push(handler); },
    setTimeout(handler, delayMs) {
      const id = ++nextTimerId;
      timers.set(id, { handler, due: now + Math.max(0, delayMs) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };

  const module = { exports: {} };
  // Le worker appelle `self.setTimeout` mais `clearTimeout` nu : fournir les
  // deux aux mêmes timers simulés, sinon les anciennes commandes survivent.
  new Function('self', 'module', 'exports', 'require', 'clearTimeout', WORKER_SOURCE)(
    fakeSelf,
    module,
    module.exports,
    require,
    id => timers.delete(id)
  );

  const send = message => listeners.forEach(handler => handler({ data: message }));
  const advanceTo = (target) => {
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.due;
      timer.handler();
    }
    now = target;
  };

  send({ type: 'init', mode, state });

  return {
    get now() { return now; },
    messages,
    send,
    advanceTo,
    commands() {
      return messages
        .filter(message => message.type === 'command')
        .map(message => ({ action: message.action, value: message.value, at: message.at }));
    },
    statuses() {
      return messages.filter(message => message.type === 'status').map(message => message.status);
    },
    wasmCalls() {
      return globalThis.__watchpartyWasmCalls || [];
    },
    async waitForWasm() {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (this.wasmCalls().some(call => call[0] === 'construct')) return;
        await new Promise(resolve => setImmediate(resolve));
      }
      throw new Error('le moteur WASM factice ne s’est pas chargé');
    },
    async waitForEngine(implementation) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (messages.some(message => message.type === 'engine' && message.implementation === implementation)) return;
        await new Promise(resolve => setImmediate(resolve));
      }
      throw new Error(`le moteur ${implementation} n’a pas été annoncé`);
    },
    dispose() {
      Date.now = originalDateNow;
      if (fixture) rmSync(fixture.root, { recursive: true, force: true });
      delete globalThis.__watchpartyWasmCalls;
    }
  };
}

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label} : attendu ${expected} ±${tolerance}, obtenu ${actual}`
  );
}

test('seek arrière de 10 s : aucune commande avant scheduledAt, une seule commande ensuite', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 110, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 120, isPlaying: true, playbackRate: 1 } });
  engine.send({ type: 'local-state', state: { now: T0 + 200, currentTime: 120, isPlaying: true, playbackRate: 1 } });

  assert.equal(
    engine.commands().filter(command => command.action === 'seek').length,
    0,
    'un tick avant scheduledAt ne doit jamais déclencher de seek'
  );

  engine.advanceTo(T0 + 250);
  const seeks = engine.commands().filter(command => command.action === 'seek');
  assert.equal(seeks.length, 1, 'une seule commande de seek doit être émise');
  assert.ok(seeks[0].at >= T0 + 250, 'la commande doit être exécutée à scheduledAt');
});

test('seek avant de 10 s : la position programmée compense les 250 ms écoulées chez l’hôte', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 130, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.advanceTo(T0 + 250);

  const seeks = engine.commands().filter(command => command.action === 'seek');
  assert.equal(seeks.length, 1);
  assertClose(seeks[0].value, 130.25, 0.05, 'position du seek avant');
});

test('un heartbeat ancien reçu après un seek ne remplace pas la commande programmée', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 110, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({
    type: 'master-state',
    state: { isPlaying: true, position: 120, updatedAt: T0 + 50, updatedBy: 'host-1' }
  });
  engine.advanceTo(T0 + 250);

  const seeks = engine.commands().filter(command => command.action === 'seek');
  assert.equal(seeks.length, 1, 'le heartbeat ancien ne doit pas générer de commande supplémentaire');
  assertClose(seeks[0].value, 110.25, 0.05, 'position après heartbeat ancien');
});

test('pause programmée : une seule commande pause, aucun play fantôme', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'pause', position: 50, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 50, isPlaying: true, playbackRate: 1 } });
  engine.advanceTo(T0 + 250);

  assert.equal(engine.commands().filter(command => command.action === 'pause').length, 1);
  assert.equal(engine.commands().filter(command => command.action === 'play').length, 0);
});

test('une action programmée pour un média précédent est ignorée', (t) => {
  const engine = createEngine({
    state: { ...FROZEN_STATE, seq: 1, mediaEpoch: 2 }
  });
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: {
      action: 'play', position: 50, scheduledAt: T0 + 250, serverNow: T0,
      updatedBy: 'host-1', seq: 2, mediaEpoch: 1
    }
  });
  engine.send({
    type: 'schedule',
    event: {
      action: 'pause', position: 50, scheduledAt: T0 + 250, serverNow: T0,
      updatedBy: 'host-1', seq: 3, mediaEpoch: 2
    }
  });
  engine.advanceTo(T0 + 300);

  assert.equal(engine.commands().filter(command => command.action === 'play').length, 0);
  assert.equal(engine.commands().filter(command => command.action === 'pause').length, 1);
});

test('reprise programmée : une seule commande play, aucun pause fantôme', (t) => {
  const engine = createEngine({
    state: { isPlaying: false, position: 50, updatedAt: T0 - 1000, updatedBy: 'host-1' }
  });
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'play', position: 50, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 50, isPlaying: false, playbackRate: 1 } });
  engine.advanceTo(T0 + 250);

  assert.equal(engine.commands().filter(command => command.action === 'play').length, 1);
  assert.equal(engine.commands().filter(command => command.action === 'pause').length, 0);
});

test('actions rapides : les commandes sont exécutées dans l’ordre des scheduledAt', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 130, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({
    type: 'schedule',
    event: { action: 'pause', position: 130, scheduledAt: T0 + 300, serverNow: T0 + 50, updatedBy: 'host-1' }
  });
  engine.send({
    type: 'schedule',
    event: { action: 'play', position: 130, scheduledAt: T0 + 350, serverNow: T0 + 100, updatedBy: 'host-1' }
  });
  engine.advanceTo(T0 + 400);

  assert.deepEqual(
    engine.commands().map(command => command.action),
    ['seek', 'pause', 'play'],
    'aucune action explicite ne doit être supplantée par la suivante'
  );
});

test('un heartbeat plus récent que le schedule annule la commande devenue obsolète', (t) => {
  const engine = createEngine();
  t.after(() => engine.dispose());

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 110, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({
    type: 'master-state',
    state: { isPlaying: true, position: 130, updatedAt: T0 + 300, updatedBy: 'host-1' }
  });
  engine.advanceTo(T0 + 400);

  assert.equal(
    engine.commands().filter(command => command.action === 'seek').length,
    0,
    'un état plus récent décrit déjà la position de l’hôte'
  );
});

test('chemin WASM : les heartbeats sont transmis au moteur après le chargement', async (t) => {
  const engine = createEngine({ wasm: true });
  t.after(() => engine.dispose());
  await engine.waitForWasm();

  const initial = engine.wasmCalls().filter(call => call[0] === 'ingest_master_state');
  assert.equal(initial.length, 1, 'l’état initial doit être transmis au moteur WASM');

  engine.send({
    type: 'master-state',
    state: { isPlaying: true, position: 42, updatedAt: T0 + 10, updatedBy: 'host-1' }
  });

  const states = engine.wasmCalls().filter(call => call[0] === 'ingest_master_state');
  assert.equal(states.length, 2, 'chaque heartbeat doit alimenter le moteur WASM, pas seulement la variable JS');
  assert.equal(states.at(-1)[1].position, 42);
});

test('chemin WASM : une commande programmée est différée et compensée comme en JS', async (t) => {
  const engine = createEngine({ wasm: true });
  t.after(() => engine.dispose());
  await engine.waitForWasm();

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 110, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 120, isPlaying: true, playbackRate: 1 } });

  assert.equal(engine.commands().length, 0, 'le tick WASM ne doit pas anticiper le seek');
  engine.advanceTo(T0 + 250);

  const seeks = engine.commands().filter(command => command.action === 'seek');
  assert.equal(seeks.length, 1);
  assertClose(seeks[0].value, 110.25, 0.05, 'position du seek en WASM');

  const schedules = engine.wasmCalls().filter(call => call[0] === 'ingest_schedule');
  assert.equal(schedules.length, 1);
  assertClose(schedules[0][1].position, 110.25, 0.05, 'position transmise au moteur WASM');
});

test('repli WASM→JS : un bundle indisponible laisse le moteur JS appliquer les schedules', async (t) => {
  const engine = createEngine({ wasm: true, wasmMissing: true });
  t.after(() => engine.dispose());
  await engine.waitForEngine('js');

  engine.send({
    type: 'schedule',
    event: { action: 'seek', position: 110, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 120, isPlaying: true, playbackRate: 1 } });

  assert.equal(engine.commands().length, 0, 'le repli JS ne doit pas anticiper le seek');
  engine.advanceTo(T0 + 250);

  const seeks = engine.commands().filter(command => command.action === 'seek');
  assert.equal(seeks.length, 1);
  assertClose(seeks[0].value, 110.25, 0.05, 'position du seek en repli JS');
  assert.equal(engine.wasmCalls().length, 0, 'aucun appel WASM ne doit être tenté après l’échec de chargement');
});

test('mode classique : aucun schedule ni commande n’est piloté par le worker', (t) => {
  const engine = createEngine({ mode: 'classic' });
  t.after(() => engine.dispose());
  const initialCommands = engine.commands().length;

  engine.send({
    type: 'schedule',
    event: { action: 'play', position: 12, scheduledAt: T0 + 250, serverNow: T0, updatedBy: 'host-1' }
  });
  engine.send({ type: 'local-state', state: { now: T0 + 100, currentTime: 12, isPlaying: true, playbackRate: 1 } });
  engine.advanceTo(T0 + 400);

  assert.deepEqual(engine.commands().slice(initialCommands), []);
});
