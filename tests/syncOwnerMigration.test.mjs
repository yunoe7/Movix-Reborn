import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFunction, sourceNamedFunction } from './helpers/sourceFunction.mjs';

const APP = 'src/App.tsx';
const PROFILE = 'src/context/ProfileContext.tsx';
const SYNC_STORAGE = 'src/utils/syncStorage.ts';
const OUTBOX_KEY = '__movix_sync_outbox';
const FORMAT_VERSION = 2;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OPS = 10000;
const LOCK_KEY = '__movix_sync_outbox_replay_lock';
const LOCK_TTL_MS = 30_000;

const OWNER_A = { type: 'oauth', id: 'user-1', profileId: 'profile-a' };
const OWNER_B = { type: 'oauth', id: 'user-1', profileId: 'profile-b' };
const OTHER_ACCOUNT = { type: 'oauth', id: 'user-2', profileId: 'profile-c' };

function storageFrom(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() { return values.size; },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
}

const quietConsole = { warn() {}, error() {}, log() {}, info() {} };
const diag = () => new Proxy({}, { get: (target, key) => target[key] ?? 0, set: (target, key, value) => { target[key] = value; return true; } });
const outboxKey = (owner) => `${OUTBOX_KEY}:${owner.type}:${owner.id || ''}:${owner.profileId}`;

// Les fixtures lisent la vraie politique de production : aucune liste dupliquée
// ne peut masquer une divergence entre l'outbox, l'envoi et l'API.
const getPermanentSyncRejectionCodes = sourceNamedFunction(SYNC_STORAGE, 'getPermanentSyncRejectionCodes');
const getRetryableSyncStatusCodes = sourceNamedFunction(SYNC_STORAGE, 'getRetryableSyncStatusCodes');
const sharedPolicyBindings = { getPermanentSyncRejectionCodes, getRetryableSyncStatusCodes };
const isRetryableSyncRejection = sourceNamedFunction(SYNC_STORAGE, 'isRetryableSyncRejection', sharedPolicyBindings);
const isPermanentSyncRejection = sourceNamedFunction(SYNC_STORAGE, 'isPermanentSyncRejection', sharedPolicyBindings);
const opOwner = (op) => (op && typeof op === 'object' && op.__owner && typeof op.__owner.profileId === 'string' ? op.__owner : null);
const stripOwner = ({ __owner, ...op }) => op;

function appFixture({
  currentUser = OWNER_B,
  token = 'T1',
  generalOps = [],
  progressOps = [],
  pendingDiffs = [],
  axiosImpl = async () => ({ data: { success: true } }),
  fetchImpl = async () => ({ ok: true }),
  persistImpl = null
} = {}) {
  const localStorage = storageFrom({ auth_token: token });
  const calls = { posts: [], fetches: [], authDrains: [] };
  const syncDiag = diag();
  const refs = {
    profileLoading: { current: false },
    generalOps: { current: generalOps },
    progressOps: { current: new Map(progressOps) },
    generalTimeout: { current: null },
    windowObj: { __forceClearInProgress: false }
  };
  const getUserInfo = () => currentUser;
  const sameSyncAccount = (a, b) => Boolean(a && b && a.type === b.type && (a.id || null) === (b.id || null));
  const sameSyncOwner = (a, b) => sameSyncAccount(a, b) && Boolean(a && b && a.profileId === b.profileId);
  const isSyncable = (key) => typeof key === 'string' && !key.startsWith('is_vip');
  const groupOpsByOwner = sourceFunction(APP, 'groupOpsByOwner', { opOwner });
  const persistOpsToOutbox = sourceFunction(APP, 'persistOpsToOutbox', {
    isSyncableStorageKey: isSyncable,
    localStorage,
    getUserInfo,
    sameSyncOwner,
    outboxKeyForOwner: outboxKey,
    SYNC_OUTBOX_FORMAT_VERSION: FORMAT_VERSION,
    SYNC_OUTBOX_MAX_AGE_MS: MAX_AGE_MS,
    MAX_SYNC_OUTBOX_OPS: MAX_OPS,
    console: quietConsole
  });
  const effectivePersist = persistImpl || persistOpsToOutbox;
  const axios = {
    post: async (url, payload, config) => {
      calls.posts.push({ url, payload, config });
      return axiosImpl(url, payload, config);
    }
  };
  const sendOpsHolder = { current: null };
  const sendOps = sourceFunction(APP, 'sendOps', {
    sendOps: (...args) => sendOpsHolder.current(...args),
    isRetryableSyncRejection,
    syncDiag,
    window: refs.windowObj,
    isProfileDataLoadingRef: refs.profileLoading,
    getUserInfo,
    localStorage,
    API_BASE_URL: 'https://api.test',
    axios,
    location: { pathname: '/home' },
    MAX_SYNC_OPS_PER_REQUEST: 100,
    groupOpsByOwner,
    opOwner,
    sameSyncAccount,
    persistOpsToOutbox: effectivePersist,
    debugAppLog() {},
    console: quietConsole
  });
  sendOpsHolder.current = sendOps;
  const flushGeneralOps = sourceFunction(APP, 'flushGeneralOps', {
    syncDiag,
    isProfileDataLoadingRef: refs.profileLoading,
    generalOpsRef: refs.generalOps,
    groupOpsByOwner,
    getUserInfo,
    sendOps
  });
  const flushProgressOps = sourceFunction(APP, 'flushProgressOps', {
    isProfileDataLoadingRef: refs.profileLoading,
    progressOpsMapRef: refs.progressOps,
    groupOpsByOwner,
    getUserInfo,
    sendOps
  });
  const flushPendingOpsSync = sourceFunction(APP, 'flushPendingOpsSync', {
    isProfileDataLoadingRef: refs.profileLoading,
    window: refs.windowObj,
    getUserInfo,
    readLocalStorage: (key) => localStorage.getItem(key),
    pendingDiffs,
    processSet: () => {},
    processRemove: () => {},
    generalFlushTimeoutRef: refs.generalTimeout,
    generalOpsRef: refs.generalOps,
    progressOpsMapRef: refs.progressOps,
    opOwner,
    stripOpOwner: stripOwner,
    isSyncableStorageKey: isSyncable,
    groupOpsByOwner,
    persistOpsToOutbox: effectivePersist,
    sameSyncAccount,
    outboxKeyForOwner: outboxKey,
    SYNC_OUTBOX_FORMAT_VERSION: FORMAT_VERSION,
    MAX_SYNC_OPS_PER_REQUEST: 100,
    API_BASE_URL: 'https://api.test',
    fetch: async (url, init) => { calls.fetches.push({ url, init }); return fetchImpl(url, init); },
    console: quietConsole
  });
  // Reproduit l'affectation faite par le second useEffect de App.tsx : le
  // listener auth_changed ne doit recevoir que cette ref, jamais les identifiants
  // locaux de l'effet.
  const authDrainRef = {
    current: () => {
      calls.authDrains.push('drain');
      const drained = flushPendingOpsSync();
      if (drained && refs.generalTimeout.current) {
        refs.generalTimeout.current = null;
      }
      return drained;
    }
  };
  return {
    localStorage, calls, syncDiag, refs, getUserInfo,
    groupOpsByOwner, persistOpsToOutbox, sendOps,
    flushGeneralOps, flushProgressOps, flushPendingOpsSync, authDrainRef
  };
}

function replayFixture({
  token = 'T1',
  account = { userType: 'oauth', userId: 'user-1' },
  response = { success: true },
  error = null
} = {}) {
  const localStorage = storageFrom(token ? { auth_token: token } : {});
  const calls = [];
  const isSyncOutboxPayload = sourceNamedFunction(PROFILE, 'isSyncOutboxPayload', { SYNC_OUTBOX_FORMAT_VERSION: FORMAT_VERSION });
  const syncOutboxScopedKey = sourceNamedFunction(PROFILE, 'syncOutboxScopedKey', { SYNC_OUTBOX_STORAGE_KEY: OUTBOX_KEY });
  const getSyncOutboxCreatedAt = sourceNamedFunction(PROFILE, 'getSyncOutboxCreatedAt', {});
  const withOutboxMetadata = sourceNamedFunction(PROFILE, 'withOutboxMetadata', {
    getSyncOutboxCreatedAt,
    SYNC_OUTBOX_FORMAT_VERSION: FORMAT_VERSION,
    SYNC_OUTBOX_MAX_AGE_MS: MAX_AGE_MS,
    MAX_SYNC_OUTBOX_OPS: MAX_OPS
  });
  const isIncompleteLegacyOutbox = sourceNamedFunction(PROFILE, 'isIncompleteLegacyOutbox', {});
  const replay = sourceNamedFunction(PROFILE, 'replayOutboxIfAny', {
    localStorage,
    SYNC_OUTBOX_STORAGE_KEY: OUTBOX_KEY,
    SYNC_OUTBOX_FORMAT_VERSION: FORMAT_VERSION,
    SYNC_OUTBOX_MAX_AGE_MS: MAX_AGE_MS,
    SYNC_OUTBOX_REPLAY_LOCK_KEY: LOCK_KEY,
    SYNC_OUTBOX_REPLAY_LOCK_TTL_MS: LOCK_TTL_MS,
    MAX_SYNC_OUTBOX_OPS: MAX_OPS,
    isSyncOutboxPayload,
    syncOutboxScopedKey,
    getSyncOutboxCreatedAt,
    isPermanentSyncRejection,
    withOutboxMetadata,
    isIncompleteLegacyOutbox,
    isSyncableStorageKey: (key) => typeof key === 'string' && !key.startsWith('is_vip') && !key.startsWith('legacy_'),
    getResolvedAccountContext: () => account,
    axios: {
      post: async (url, payload, config) => {
        calls.push({ url, payload, config });
        if (error) throw error;
        return { data: response };
      }
    },
    API_URL: 'https://api.test',
    console: quietConsole
  });
  return { localStorage, calls, replay };
}

function seedOutbox(localStorage, key, payload) {
  const now = Date.now();
  localStorage.setItem(key, JSON.stringify({
    v: FORMAT_VERSION,
    createdAt: now,
    lastAttemptAt: now,
    ts: now,
    ...payload
  }));
}

function httpError(status, code = '', message = '') {
  return { response: { status, data: { code, error: message } } };
}

test('P1 puis P2 dans le même compte : sendOps groupe par propriétaire, pas par premier élément', async () => {
  const f = appFixture();
  await f.sendOps([
    { op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A },
    { op: 'set', key: 'user_language', value: 'fr', __owner: OWNER_B },
    { op: 'set', key: 'favorite_movie', value: '42', __owner: OWNER_A }
  ]);

  assert.equal(f.calls.posts.length, 2);
  const profiles = f.calls.posts.map((call) => call.payload.profileId);
  assert.deepEqual(new Set(profiles), new Set(['profile-a', 'profile-b']));
  for (const call of f.calls.posts) {
    const owner = OWNER_A.profileId === call.payload.profileId ? OWNER_A : OWNER_B;
    assert.equal(call.payload.userId, owner.id);
    assert.ok(call.payload.ops.every((op) => !('__owner' in op)));
  }
  const batchA = f.calls.posts.find((call) => call.payload.profileId === OWNER_A.profileId);
  assert.deepEqual(batchA.payload.ops.map((op) => op.key), ['favorite_movies', 'favorite_movie']);
});

test('flushGeneralOps et flushProgressOps groupent aussi les lots mixtes avant envoi', () => {
  const sent = [];
  const general = [
    { op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A },
    { op: 'set', key: 'user_language', value: 'fr', __owner: OWNER_B }
  ];
  const progress = [
    ['progress_movie:1', { delta: { set: { position: 10 }, remove: [] }, owner: OWNER_A }],
    ['progress_movie:2', { delta: { set: { position: 20 }, remove: [] }, owner: OWNER_B }]
  ];
  const fixture = appFixture({ generalOps: general, progressOps: progress });
  fixture.flushGeneralOps();
  fixture.flushProgressOps();
  assert.equal(sent.length, 0); // les appels sont enregistrés dans les posts de sendOps
  assert.equal(fixture.calls.posts.length, 4);
  const batches = fixture.calls.posts.map((call) => [call.payload.profileId, call.payload.userId, call.payload.ops.map((op) => op.key)]);
  for (const [profileId, userId, keys] of batches) {
    const owner = profileId === OWNER_A.profileId ? OWNER_A : OWNER_B;
    assert.equal(userId, owner.id);
    assert.ok(keys.every((key) => key.startsWith('progress_') || key === 'favorite_movies' || key === 'user_language'));
  }
  const keysByProfile = new Map();
  for (const [profileId, , keys] of batches) {
    keysByProfile.set(profileId, [...(keysByProfile.get(profileId) || []), ...keys]);
  }
  assert.deepEqual(new Set(keysByProfile.get(OWNER_A.profileId)), new Set(['favorite_movies', 'progress_movie:1']));
  assert.deepEqual(new Set(keysByProfile.get(OWNER_B.profileId)), new Set(['user_language', 'progress_movie:2']));
});

test('deux comptes différents : les opérations du compte A restent dans son outbox, jamais sous le token B', async () => {
  const f = appFixture({ currentUser: OTHER_ACCOUNT, token: 'T2' });
  await f.sendOps([{ op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A }]);

  assert.equal(f.calls.posts.length, 0, 'le token B ne doit pas envoyer les ops du compte A');
  const scoped = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
  assert.equal(scoped.v, FORMAT_VERSION);
  assert.equal(scoped.userId, OWNER_A.id);
  assert.deepEqual(scoped.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(f.localStorage.getItem(OUTBOX_KEY), null, 'aucune copie legacy ne doit être réécrite');
});

test('logout pendant flush : le vrai flush persiste avant la mutation d’auth puis vide les files', () => {
  const events = [];
  const ownerAOp = { op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A };
  let realPersist = null;
  const f = appFixture({
    currentUser: OWNER_A,
    token: 'T1',
    generalOps: [ownerAOp],
    persistImpl: (...args) => {
      events.push('persist');
      return realPersist(...args);
    }
  });
  realPersist = f.persistOpsToOutbox;
  const handleAuthChanged = sourceFunction(APP, 'handleAuthChanged', {
    authDrainRef: f.authDrainRef,
    generalOpsRef: f.refs.generalOps,
    progressOpsMapRef: f.refs.progressOps,
    isProfileDataLoadingRef: f.refs.profileLoading,
    handleStorageChange: () => { events.push('auth-mutation'); }
  });

  handleAuthChanged();

  assert.deepEqual(f.calls.authDrains, ['drain']);
  assert.deepEqual(events, ['persist', 'auth-mutation']);
  const outbox = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
  assert.deepEqual(outbox.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(f.refs.generalOps.current.length, 0);
  assert.equal(f.refs.progressOps.current.size, 0);
  assert.equal(f.refs.generalTimeout.current, null);
});

test('login pendant flush : le vrai flush refuse la persistance et garde les files capturées', () => {
  const events = [];
  const ownerAOp = { op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A };
  const progressEntry = { delta: { set: { position: 8 }, remove: [] }, owner: OWNER_A };
  const f = appFixture({
    currentUser: OWNER_B,
    token: 'T2',
    generalOps: [ownerAOp],
    progressOps: [['progress_movie:1', progressEntry]],
    persistImpl: (...args) => {
      events.push('persist-refused');
      return false;
    }
  });
  f.refs.generalTimeout.current = 9;
  const handleAuthChanged = sourceFunction(APP, 'handleAuthChanged', {
    authDrainRef: f.authDrainRef,
    generalOpsRef: f.refs.generalOps,
    progressOpsMapRef: f.refs.progressOps,
    isProfileDataLoadingRef: f.refs.profileLoading,
    handleStorageChange: () => { events.push('auth-mutation'); }
  });

  assert.equal(f.flushPendingOpsSync(), false, 'une écriture refusée ne peut pas vider la file');
  handleAuthChanged();

  assert.equal(f.calls.authDrains.length, 1, 'auth_changed repasse par le drain réel');
  assert.deepEqual(events, ['persist-refused', 'persist-refused', 'auth-mutation']);
  assert.equal(f.refs.generalOps.current[0], ownerAOp, 'les ops non persistées restent avec leur propriétaire capturé');
  assert.equal(f.refs.progressOps.current.get('progress_movie:1'), progressEntry);
  assert.equal(f.refs.progressOps.current.get('progress_movie:1').owner, OWNER_A);
  assert.equal(f.refs.generalTimeout.current, 9, 'un timer non confirmé ne doit pas être perdu');
  assert.equal(f.localStorage.getItem(outboxKey(OWNER_B)), null, 'rien n’est réattribué au profil B');
  assert.equal(f.calls.fetches.length, 0, 'aucun envoi keepalive ne doit partir sous le token B');
});

test('auth_changed sans injection locale : le drain réel part de la ref et précède la mutation d’auth', () => {
  const events = [];
  const ownerAOp = { op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A };
  let realPersist = null;
  const f = appFixture({
    currentUser: OWNER_A,
    token: 'T1',
    generalOps: [ownerAOp],
    persistImpl: (...args) => {
      events.push('persist');
      return realPersist(...args);
    }
  });
  realPersist = f.persistOpsToOutbox;
  f.refs.generalTimeout.current = 7;
  // Volontairement AUCUNE injection de flushPendingOpsSync ni de
  // generalFlushTimeoutRef : le callback doit passer uniquement par la ref
  // exposée par le composant, sinon l'événement réel lève une ReferenceError.
  const handleAuthChanged = sourceFunction(APP, 'handleAuthChanged', {
    authDrainRef: f.authDrainRef,
    currentUserInfo: { current: OWNER_A },
    getUserInfo: f.getUserInfo,
    generalOpsRef: f.refs.generalOps,
    progressOpsMapRef: f.refs.progressOps,
    isProfileDataLoadingRef: f.refs.profileLoading,
    debugAppLog: () => {},
    setTimeout: () => 0,
    setIsInitialSyncDone: () => {},
    handleStorageChange: () => { events.push('auth-mutation'); }
  });

  assert.doesNotThrow(() => handleAuthChanged());
  assert.deepEqual(f.calls.authDrains, ['drain']);
  assert.deepEqual(events, ['persist', 'auth-mutation']);
  assert.equal(f.refs.generalTimeout.current, null);
  const outbox = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
  assert.deepEqual(outbox.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(f.refs.generalOps.current.length, 0);
  assert.equal(f.refs.progressOps.current.size, 0);
});

test('changement de token pendant la requête : la persistance reste dans l’outbox du propriétaire capturé', async () => {
  const f = appFixture({
    currentUser: OWNER_A,
    token: 'T1',
    axiosImpl: async () => {
      f.localStorage.setItem('auth_token', 'T2');
      throw httpError(503);
    }
  });

  await f.sendOps([{ op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A }]);

  const scoped = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
  assert.ok(scoped, 'une erreur temporaire après changement de token doit rester rejouable');
  assert.equal(scoped.v, FORMAT_VERSION);
  assert.deepEqual(scoped.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(f.localStorage.getItem(outboxKey(OTHER_ACCOUNT)), null);
  assert.equal(f.localStorage.getItem(OUTBOX_KEY), null);
  assert.equal(f.calls.posts[0].config.headers.Authorization, 'Bearer T1', 'la requête en vol garde le token capturé');
});

test('legacy et scopée simultanément : lecture one-shot et suppression de la copie legacy après succès', async () => {
  const f = replayFixture();
  seedOutbox(f.localStorage, OUTBOX_KEY, {
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  });
  seedOutbox(f.localStorage, outboxKey(OWNER_A), {
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [{ op: 'set', key: 'favorite_movies', value: '[1]' }]
  });

  await f.replay();

  assert.equal(f.calls.length, 1, 'une seule file doit être rejouée');
  assert.deepEqual(f.calls[0].payload.ops.map((op) => op.key), ['favorite_movies']);
  assert.equal(f.localStorage.getItem(OUTBOX_KEY), null, 'la copie legacy doit être supprimée après le rejeu');
  assert.equal(f.localStorage.getItem(outboxKey(OWNER_A)), null);
});

test('rejeu après migration : la clé historique devient une outbox scopée v:2 puis est supprimée', async () => {
  const f = replayFixture();
  seedOutbox(f.localStorage, OUTBOX_KEY, {
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  });

  await f.replay();

  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.profileId, OWNER_A.profileId);
  assert.equal(f.localStorage.getItem(OUTBOX_KEY), null);
  assert.equal(f.localStorage.getItem(outboxKey(OWNER_A)), null);
});

test('rejets permanents et erreurs temporaires : createdAt stable, lastAttemptAt mis à jour, TTL fiable', async () => {
  const f = replayFixture({
    response: {
      success: true,
      partial: true,
      rejected: [
        { index: 0, code: 'VALUE_TOO_LARGE', message: 'Valeur trop volumineuse', status: 413 },
        { index: 1, code: 'RATE_LIMITED', message: 'Reessayer', status: 429 }
      ]
    }
  });
  const createdAt = Date.now() - 60_000;
  seedOutbox(f.localStorage, outboxKey(OWNER_A), {
    v: FORMAT_VERSION, createdAt, lastAttemptAt: createdAt,
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [
      { op: 'set', key: 'favorite_movies', value: 'trop' },
      { op: 'set', key: 'settings_test_retry', value: 'later' },
      { op: 'set', key: 'user_language', value: 'fr' }
    ]
  });

  await f.replay();

  const remaining = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
  assert.deepEqual(remaining.ops.map((op) => op.key), ['settings_test_retry'], 'seul le rejet temporaire reste à rejouer');
  assert.equal(remaining.createdAt, createdAt, 'un retry ne doit jamais réinitialiser createdAt');
  assert.ok(remaining.lastAttemptAt > createdAt);
});

test('erreurs 401/403/408/429/5xx et réseau restent rejouables avec un lastAttemptAt distinct', async () => {
  for (const error of [httpError(401, '', 'Unauthorized'), httpError(403, '', 'Profile does not belong to this user'), httpError(408), httpError(429), httpError(503), new Error('offline')]) {
    const f = replayFixture({ error });
    const createdAt = Date.now() - 120_000;
    seedOutbox(f.localStorage, outboxKey(OWNER_A), {
      v: FORMAT_VERSION, createdAt, lastAttemptAt: createdAt,
      userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
      ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
    });

    await f.replay();

    const kept = JSON.parse(f.localStorage.getItem(outboxKey(OWNER_A)));
    assert.ok(kept, `l'erreur ${error?.response?.status || error.message} doit rester rejouable`);
    assert.equal(kept.createdAt, createdAt);
    assert.ok(kept.lastAttemptAt > createdAt);
  }
});

test('plusieurs onglets concurrents : un seul rejeu de la même file', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = replayFixture({
    response: { success: true },
  });
  const originalPost = f.replay;
  // Le locker est simulé par le fixture : on remplace axios.post après extraction via la fermeture.
  seedOutbox(f.localStorage, outboxKey(OWNER_A), {
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  });

  const first = originalPost();
  const second = originalPost();
  release();
  await Promise.all([first, second]);

  assert.equal(f.calls.length, 1, 'deux onglets ne doivent pas poster deux fois la même file');
});

test('TTL et cap : une file âgée est évincée même si lastAttemptAt est récent, une file longue est bornée', async () => {
  const expired = replayFixture();
  const now = Date.now();
  expired.localStorage.setItem(outboxKey(OWNER_A), JSON.stringify({
    v: FORMAT_VERSION,
    createdAt: now - MAX_AGE_MS - 1000,
    lastAttemptAt: now,
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId,
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }));

  await expired.replay();

  assert.equal(expired.calls.length, 0, 'une file âgée de plus de 7 jours ne doit pas être rejouée');
  assert.equal(expired.localStorage.getItem(outboxKey(OWNER_A)), null);

  const capped = replayFixture({ error: httpError(503) });
  const ops = Array.from({ length: MAX_OPS + 5 }, (_, index) => ({ op: 'set', key: `settings_test_${index}`, value: String(index) }));
  seedOutbox(capped.localStorage, outboxKey(OWNER_A), {
    userType: 'oauth', userId: OWNER_A.id, profileId: OWNER_A.profileId, ops
  });

  await capped.replay();

  const stored = JSON.parse(capped.localStorage.getItem(outboxKey(OWNER_A)));
  assert.equal(stored.ops.length, MAX_OPS);
  assert.equal(capped.calls[0].payload.ops.length, MAX_OPS);
});

test('ancienne outbox sans userId : TTL appliqué avant migration versionnée, sans attribution au compte courant', async () => {
  const expired = replayFixture();
  expired.localStorage.setItem(OUTBOX_KEY, JSON.stringify({
    userType: 'oauth', profileId: OWNER_A.profileId,
    ts: Date.now() - MAX_AGE_MS - 1000,
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }));

  await expired.replay();

  assert.equal(expired.calls.length, 0, 'une ancienne file périmée ne doit pas être migrée');
  assert.equal(expired.localStorage.getItem(OUTBOX_KEY), null);
  assert.equal(expired.localStorage.getItem(outboxKey(OWNER_A)), null);

  const fresh = replayFixture();
  fresh.localStorage.setItem(OUTBOX_KEY, JSON.stringify({
    userType: 'oauth', profileId: OWNER_A.profileId,
    ts: Date.now(),
    ops: [{ op: 'set', key: 'user_language', value: 'fr' }]
  }));

  await fresh.replay();

  assert.equal(fresh.calls.length, 0, 'sans userId, aucune opération ne doit être attribuée au compte courant');
  const migrated = JSON.parse(fresh.localStorage.getItem(OUTBOX_KEY));
  assert.equal(migrated.v, FORMAT_VERSION);
  assert.equal(migrated.userId, undefined);
  assert.ok(typeof migrated.createdAt === 'number');
  assert.equal(fresh.localStorage.getItem(outboxKey(OWNER_A)), null);
});
