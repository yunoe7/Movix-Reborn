import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFunction, sourceNamedFunction } from './helpers/sourceFunction.mjs';

const CORE = 'src/utils/wrappedTrackerCore.ts';
const HOOK = 'src/hooks/useWrappedTracker.ts';
const DEFERRED_KEY = '__movix_wrapped_deferred';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;

const createWrappedTracker = sourceNamedFunction(CORE, 'createWrappedTrackerImpl', {
  WRAPPED_MIN_SECONDS_TO_SEND: 5,
  WRAPPED_MAX_GAP_SECONDS: 60,
  WRAPPED_MAX_SECONDS_PER_SEND: 60,
  WRAPPED_DEFERRED_STORAGE_KEY: DEFERRED_KEY,
  WRAPPED_DEFERRED_TTL_MS: TTL_MS,
  WRAPPED_DEFERRED_MAX_ENTRIES: MAX_ENTRIES,
  WRAPPED_DEFERRED_VERSION: 1
});

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
}

const P1 = { userType: 'oauth', userId: 'user-1', profileId: 'profile-a', token: 'T1' };
const P2 = { userType: 'oauth', userId: 'user-1', profileId: 'profile-b', token: 'T2' };
const page = (name) => ({ mode: 'page', data: { pageName: name } });

function ownershipFixture({ initialStorage = {}, failTokens = new Set(['T1']), sendImpl = null } = {}) {
  const state = {
    now: Date.now(),
    identity: { ...P1 },
    allowed: new Set(['T1']),
    accounts: new Set(['user-1']),
    failTokens
  };
  const storage = memoryStorage(initialStorage);
  const sent = [];
  const tracker = createWrappedTracker({
    now: () => state.now,
    collectionEnabled: () => true,
    identity: () => state.identity,
    isIdentityAuthenticatable: (identity) => Boolean(
      identity?.token
      && state.allowed.has(identity.token)
      && state.accounts.has(identity.userId)
    ),
    storage,
    send: sendImpl || (async (target, seconds, identity) => {
      sent.push({ target, seconds, identity });
      if (state.failTokens.has(identity?.token)) return false;
      return true;
    })
  });
  return { state, storage, sent, tracker };
}

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

test('P1 puis P2 : les secondes capturées restent à P1, P2 ne reçoit que ses propres secondes', async () => {
  const f = ownershipFixture();
  f.tracker.setActive(true);
  f.tracker.setTarget(page('film-a'));
  f.state.now += 30_000;
  f.tracker.setTarget(page('film-b'));
  await settle();

  const deferred = f.tracker.deferredEntries();
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].seconds, 30);
  assert.deepEqual(deferred[0].identity, P1);
  assert.ok(typeof deferred[0].createdAt === 'number');
  assert.ok(typeof deferred[0].attempts === 'number');
  assert.ok(deferred[0].id);

  f.state.identity = { ...P2 };
  f.state.now += 30_000;
  assert.equal(await f.tracker.tick(), true, 'T1 reste non synchronisé tant que son token échoue');

  assert.equal(f.sent.length, 3, 'échec initial P1, retry P1, puis envoi P2');
  assert.deepEqual(f.sent[0].identity, P1, 'le premier envoi utilise l’identité capturée à l’accumulation');
  assert.deepEqual(f.sent[1].identity, P1, 'le retry garde l’identité capturée');
  assert.deepEqual(f.sent[2].identity, P2, 'les nouvelles secondes utilisent P2, pas l’identité différée');
  assert.equal(f.sent[2].seconds, 30);
});

test('logout puis reconnexion à un autre compte : les secondes P1 restent non synchronisées', async () => {
  const f = ownershipFixture();
  f.tracker.setActive(true);
  f.tracker.setTarget(page('film-a'));
  f.state.now += 30_000;
  f.tracker.setTarget(page('film-b'));
  await settle();

  f.state.allowed.clear();
  f.state.identity = { ...P2 };
  f.state.allowed.add('T2');
  f.state.now += 30_000;

  await f.tracker.tick();
  await f.tracker.tick();

  assert.equal(f.sent.length, 2, 'échec P1 puis envoi des seules secondes accumulées sous P2');
  assert.deepEqual(f.sent[0].identity, P1);
  assert.deepEqual(f.sent[1].identity, P2);
  assert.equal(f.tracker.unsyncedSeconds(), 30);
  const persisted = JSON.parse(f.storage.getItem(DEFERRED_KEY));
  assert.equal(persisted.entries.length, 1);
  assert.deepEqual(persisted.entries[0].identity, P1);
  assert.equal(persisted.entries[0].attempts, 0, 'une identité non authentifiable ne doit pas être tentée');
});

test('reconnexion du compte d’origine : retry une seule fois, aucun doublon', async () => {
  const f = ownershipFixture();
  f.tracker.setActive(true);
  f.tracker.setTarget(page('film-a'));
  f.state.now += 30_000;
  f.tracker.setTarget(page('film-b'));
  await settle();

  f.state.allowed.clear();
  await f.tracker.tick();
  assert.equal(f.sent.length, 1);

  f.state.identity = { ...P1 };
  f.state.allowed.add('T1');
  f.state.failTokens = new Set();
  await f.tracker.tick();
  await f.tracker.tick();
  await f.tracker.tick();

  const p1Sends = f.sent.filter((entry) => entry.seconds === 30 && entry.target.data.pageName === 'film-a');
  assert.equal(p1Sends.length, 2, 'un échec puis une réussite, jamais trois envois du même cumul');
  assert.deepEqual(p1Sends[1].identity, P1);
  assert.equal(f.tracker.deferredEntries().length, 0);
  assert.equal(f.storage.getItem(DEFERRED_KEY), null);
});

test('file différée : TTL de 7 jours et borne de taille appliqués au chargement', () => {
  const now = Date.now();
  const expired = {
    id: 'expired', seconds: 30, target: page('ancien'), identity: P1,
    createdAt: now - TTL_MS - 1000, lastAttemptAt: now, attempts: 3
  };
  const fresh = Array.from({ length: MAX_ENTRIES + 12 }, (_, index) => ({
    id: `fresh-${index}`, seconds: 5, target: page(`page-${index}`), identity: P1,
    createdAt: now - index, lastAttemptAt: now - index, attempts: 1
  }));
  const f = ownershipFixture({
    initialStorage: { [DEFERRED_KEY]: JSON.stringify({ v: 1, entries: [expired, ...fresh] }) },
    failTokens: new Set()
  });

  const entries = f.tracker.deferredEntries();
  assert.equal(entries.length, MAX_ENTRIES, 'la file doit être bornée');
  assert.equal(entries.some((entry) => entry.id === 'expired'), false, 'une entrée âgée de plus de 7 jours doit être évincée');
  assert.equal(f.tracker.unsyncedSeconds(), MAX_ENTRIES * 5);
});

test('le hook envoie avec l’identité capturée, même si la session courante a changé', async () => {
  const requests = [];
  const isIdentityAuthenticatable = () => false;
  const sendToApi = sourceFunction(HOOK, 'sendToApi', {
    useCallback: (fn) => fn,
    getUserInfo: () => ({ authToken: 'T2', profileId: 'profile-b', userId: 'user-2' }),
    isIdentityAuthenticatable,
    MAIN_API: 'https://api.test',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200 };
    }
  });

  const accepted = await sendToApi(page('home'), 30, { ...P1 });

  assert.equal(accepted, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer T1');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.userId, 'user-1');
  assert.equal(body.profileId, 'profile-a');
  assert.equal(body.duration, 30);
});

test('401 puis réussite : le retry garde l’identité capturée et le cumul n’est envoyé qu’une fois', async () => {
  const requests = [];
  const responses = [
    { ok: false, status: 401 },
    { ok: true, status: 200 }
  ];
  const getUserInfo = () => ({ authToken: 'T1', profileId: 'profile-a', userId: 'user-1' });
  const resolveIdentity = sourceFunction(HOOK, 'resolveIdentity', {
    useCallback: (fn) => fn,
    getUserInfo,
    getResolvedAccountContext: () => ({ userType: 'oauth' })
  });
  const isIdentityAuthenticatable = sourceFunction(HOOK, 'isIdentityAuthenticatable', {
    useCallback: (fn) => fn,
    resolveIdentity
  });
  const sendToApi = sourceFunction(HOOK, 'sendToApi', {
    useCallback: (fn) => fn,
    getUserInfo,
    isIdentityAuthenticatable,
    MAIN_API: 'https://api.test',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return responses.shift() ?? { ok: true, status: 200 };
    }
  });
  const f = ownershipFixture({ sendImpl: sendToApi, failTokens: new Set() });

  f.tracker.setActive(true);
  f.tracker.setTarget(page('film-a'));
  f.state.now += 30_000;
  f.tracker.setTarget(page('film-b'));
  await settle();

  assert.equal(requests.length, 1, 'le 401 ne doit pas acquitter le cumul');
  assert.equal(f.tracker.deferredEntries().length, 1);

  assert.equal(await f.tracker.tick(), false);
  assert.equal(requests.length, 2, 'un seul retry après le 401');
  assert.equal(f.tracker.deferredEntries().length, 0);
  assert.equal(f.tracker.unsyncedSeconds(), 0);

  await f.tracker.tick();
  assert.equal(requests.length, 2, 'aucun nouvel envoi après réussite');

  for (const request of requests) {
    assert.equal(request.init.headers.Authorization, 'Bearer T1', 'le retry garde le token de l’identité capturée');
    const body = JSON.parse(request.init.body);
    assert.equal(body.userId, 'user-1');
    assert.equal(body.profileId, 'profile-a');
    assert.equal(body.duration, 30);
  }
});

test('403 d’appartenance : refus permanent acquitté, sans file différée ni retry', async () => {
  const requests = [];
  const getUserInfo = () => ({ authToken: 'T1', profileId: 'profile-a', userId: 'user-1' });
  const resolveIdentity = sourceFunction(HOOK, 'resolveIdentity', {
    useCallback: (fn) => fn,
    getUserInfo,
    getResolvedAccountContext: () => ({ userType: 'oauth' })
  });
  const isIdentityAuthenticatable = sourceFunction(HOOK, 'isIdentityAuthenticatable', {
    useCallback: (fn) => fn,
    resolveIdentity
  });
  const sendToApi = sourceFunction(HOOK, 'sendToApi', {
    useCallback: (fn) => fn,
    getUserInfo,
    isIdentityAuthenticatable,
    MAIN_API: 'https://api.test',
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: false, status: 403 };
    }
  });
  const f = ownershipFixture({ sendImpl: sendToApi, failTokens: new Set() });

  f.tracker.setActive(true);
  f.tracker.setTarget(page('film-a'));
  f.state.now += 30_000;
  f.tracker.setTarget(page('film-b'));
  await settle();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer T1');
  assert.equal(f.tracker.deferredEntries().length, 0, 'un 403 d’appartenance reste permanent');
  assert.equal(f.tracker.unsyncedSeconds(), 0);

  assert.equal(await f.tracker.tick(), false);
  assert.equal(requests.length, 1, 'aucun retry ne doit être tenté après un 403');
});
