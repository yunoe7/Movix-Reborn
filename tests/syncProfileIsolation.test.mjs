import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction, sourceNamedFunction } from './helpers/sourceFunction.mjs';

const PAGE = 'src/App.tsx';
const SYNC_STORAGE = 'src/utils/syncStorage.ts';
const buildSyncBatches = sourceNamedFunction(SYNC_STORAGE, 'buildSyncBatches');
const OWNER_A = { type: 'oauth', id: 'user-1', profileId: 'profile-a' };
const OWNER_B = { type: 'oauth', id: 'user-1', profileId: 'profile-b' };

function syncStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); }
  };
}

const opOwner = (op) => op?.__owner || null;
const outboxKeyForOwner = (owner) => `__movix_sync_outbox:${owner.type}:${owner.id || ''}:${owner.profileId}`;
const groupOpsByOwner = sourceFunction(PAGE, 'groupOpsByOwner', { opOwner });

function flushFixture({ currentOwner = OWNER_B, generalOps = [], progressOps = [], existingOutbox = null } = {}) {
  const storage = syncStorage();
  if (existingOutbox) storage.setItem(outboxKeyForOwner(OWNER_A), JSON.stringify(existingOutbox));
  const fetches = [];
  const sameSyncAccount = (a, b) => Boolean(a && b && a.type === b.type && (a.id || null) === (b.id || null));
  const sameSyncOwner = (a, b) => sameSyncAccount(a, b) && Boolean(a && b && a.profileId === b.profileId);
  const persistOpsToOutbox = sourceFunction(PAGE, 'persistOpsToOutbox', {
    isSyncableStorageKey: (key) => typeof key === 'string' && !key.startsWith('legacy_'),
    localStorage: storage,
    getUserInfo: () => currentOwner,
    sameSyncOwner,
    outboxKeyForOwner,
    SYNC_OUTBOX_FORMAT_VERSION: 2,
    SYNC_OUTBOX_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    MAX_SYNC_OUTBOX_OPS: 10000,
    console: { warn() {}, error() {}, log() {} }
  });
  const flush = sourceFunction(PAGE, 'flushPendingOpsSync', {
    isProfileDataLoadingRef: { current: false },
    window: { __forceClearInProgress: false },
    getUserInfo: () => currentOwner,
    readLocalStorage: (key) => (key === 'auth_token' ? 'test-token' : null),
    pendingDiffs: [],
    processSet: () => { throw new Error('processSet ne doit pas être appelé dans ce scénario'); },
    processRemove: () => { throw new Error('processRemove ne doit pas être appelé dans ce scénario'); },
    generalFlushTimeoutRef: { current: null },
    generalOpsRef: { current: generalOps },
    progressOpsMapRef: { current: new Map(progressOps) },
    SYNC_OUTBOX_STORAGE_KEY: '__movix_sync_outbox',
    isSyncableStorageKey: (key) => typeof key === 'string' && !key.startsWith('legacy_'),
    opOwner,
    stripOpOwner: ({ __owner, ...clean }) => clean,
    outboxKeyForOwner,
    groupOpsByOwner,
    persistOpsToOutbox,
    sameSyncAccount,
    SYNC_OUTBOX_FORMAT_VERSION: 2,
    SYNC_OUTBOX_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
    MAX_SYNC_OUTBOX_OPS: 10000,
    localStorage: storage,
    MAX_SYNC_OPS_PER_REQUEST: 100,
    MAX_SYNC_BYTES_PER_REQUEST: 4 * 1024 * 1024,
    buildSyncBatches,
    API_BASE_URL: 'https://api.test',
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true }; },
    console: { warn() {}, error() {}, log() {} }
  });
  return { flush, storage, fetches };
}

test('le flush de déconnexion adresse les opérations en attente à leur profil d’origine', () => {
  const f = flushFixture({
    generalOps: [{ op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A }],
    progressOps: [['progress_movie:1', { delta: { set: { position: 42 }, remove: [] }, owner: OWNER_A }]]
  });

  f.flush();

  const outbox = JSON.parse(f.storage.getItem(outboxKeyForOwner(OWNER_A)));
  assert.equal(outbox.userType, OWNER_A.type);
  assert.equal(outbox.userId, OWNER_A.id);
  assert.equal(outbox.profileId, OWNER_A.profileId);
  assert.ok(outbox.ops.length >= 2);
  for (const op of outbox.ops) assert.equal(op.__owner, undefined);

  assert.equal(f.fetches.length, 1);
  const body = JSON.parse(f.fetches[0].init.body);
  assert.equal(body.profileId, OWNER_A.profileId);
  assert.equal(body.userId, OWNER_A.id);
  for (const op of body.ops) assert.equal(op.__owner, undefined);
});

test('le flush fusionne avec l’outbox du même propriétaire uniquement', () => {
  const f = flushFixture({
    generalOps: [{ op: 'set', key: 'user_language', value: 'fr', __owner: OWNER_A }],
    existingOutbox: { userType: 'oauth', userId: 'user-1', profileId: 'profile-a', ops: [{ op: 'set', key: 'favorite_movies', value: '[9]' }], ts: Date.now() }
  });

  f.flush();

  const outbox = JSON.parse(f.storage.getItem(outboxKeyForOwner(OWNER_A)));
  assert.equal(outbox.profileId, OWNER_A.profileId);
  assert.deepEqual(outbox.ops.map((op) => op.key), ['favorite_movies', 'user_language']);
});

test('une opération sans propriétaire capturé suit le profil courant', () => {
  const f = flushFixture({ generalOps: [{ op: 'set', key: 'user_language', value: 'en' }] });

  f.flush();

  const body = JSON.parse(f.fetches[0].init.body);
  assert.equal(body.profileId, OWNER_B.profileId);
  assert.equal(body.userId, OWNER_B.id);
});

test('un changement de compte ne tente pas d’envoyer les ops du compte précédent', () => {
  const current = { type: 'oauth', id: 'user-2', profileId: 'profile-c' };
  const f = flushFixture({
    currentOwner: current,
    generalOps: [{ op: 'set', key: 'favorite_movies', value: '[1]', __owner: OWNER_A }]
  });

  f.flush();

  assert.equal(f.fetches.length, 0, 'le token courant ne peut pas autoriser les ops de l’ancien compte');
  const scopedKey = '__movix_sync_outbox:oauth:user-1:profile-a';
  assert.equal(f.storage.getItem(scopedKey) !== null, true);
  assert.equal(f.storage.getItem('__movix_sync_outbox'), null);
});

test('le flush périodique de progression respecte le propriétaire capturé à l’écriture', () => {
  const sent = [];
  const flushProgressOps = sourceFunction(PAGE, 'flushProgressOps', {
    progressOpsMapRef: { current: new Map([['progress_movie:1', { delta: { set: { position: 42 }, remove: [] }, owner: OWNER_A }]]) },
    isProfileDataLoadingRef: { current: false },
    getUserInfo: () => OWNER_B,
    groupOpsByOwner,
    sendOps: (ops) => sent.push(ops)
  });

  flushProgressOps();

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].__owner.profileId, OWNER_A.profileId);
  assert.equal(sent[0][0].key, 'progress_movie:1');
});

test('une écriture de progression capture le propriétaire avant la fin de l’hydratation', () => {
  const map = new Map();
  const processSet = sourceFunction(PAGE, 'processSet', {
    suppressSyncRef: { current: false },
    syncDiag: { skipSuppress: 0, skipNotSyncable: 0, skipNoop: 0, skipForceClear: 0, skipGateSet: 0 },
    isSyncableStorageKey: () => true,
    window: {},
    isProfileDataLoadingRef: { current: false },
    isProgressKey: (key) => key.startsWith('progress_'),
    computeObjectPatch: () => ({ set: { position: 42 }, remove: [] }),
    progressOpsMapRef: { current: map },
    computeArrayDiffOps: () => null,
    enqueueGeneralOp: () => {},
    getUserInfo: () => OWNER_A
  });

  processSet('progress_movie:1', null, '{"position":42}', OWNER_A);

  assert.equal(map.get('progress_movie:1').owner.profileId, OWNER_A.profileId);
});

test('le nettoyage d’isolation du compte est silencieux pour la synchronisation', async () => {
  let wipeActive = false;
  let removed = 0;
  const storage = {
    getItem: () => 'test-token',
    removeItem: () => {
      assert.equal(wipeActive, true, 'aucune clé syncable ne doit être supprimée hors du nettoyage isolé');
      removed += 1;
    }
  };
  const handleAuthChange = sourceFunction('src/context/ProfileContext.tsx', 'handleAuthChange', {
    profileIntentGuard: { begin() {} },
    profileHydrationGuard: { begin: () => ({ finish() {} }) },
    setCurrentProfile: () => {},
    setProfiles: () => {},
    setIsLoading: () => {},
    profileDataHydratedRef: { current: true },
    getSyncableLocalStorageEntries: () => ({ favorite_movies: '[]', user_language: 'fr' }),
    localStorage: storage,
    runProfileIsolationWipe: (fn) => {
      wipeActive = true;
      try { return fn(); } finally { wipeActive = false; }
    },
    setTimeout: (fn) => { fn(); return 1; },
    loadProfilesRef: { current: () => {} }
  });

  await handleAuthChange();

  assert.equal(removed, 2);
});
