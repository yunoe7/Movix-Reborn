import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceEffect, sourceFunction } from './helpers/sourceFunction.mjs';

const PAGE = 'src/pages/WatchPartyPage.tsx';

test('refreshPublicRooms applique la réponse réelle de la route publique', async () => {
  const rooms = [{ id: 'room-1', code: 'ABC123', title: 'Salle publique' }];
  const requested = [];
  const states = [];
  const errors = [];
  const loading = [];
  const refresh = sourceFunction(PAGE, 'refreshPublicRooms', {
    useCallback: (callback) => callback,
    apiRequest: async (path) => {
      requested.push(path);
      return { success: true, rooms };
    },
    setPublicRooms: (next) => states.push(next),
    setError: (next) => errors.push(next),
    setIsLoadingRooms: (next) => loading.push(next),
  }, '/api/watchparty/public');

  await refresh();

  assert.deepEqual(requested, ['/api/watchparty/public']);
  assert.deepEqual(states, [rooms]);
  assert.deepEqual(errors, ['']);
  assert.deepEqual(loading, [true, false]);
});

test('apiRequest remonte les statuts 404 et 502 au lieu de masquer la réponse', async () => {
  const request = sourceFunction(PAGE, 'apiRequest', {
    WATCHPARTY_API: 'https://watchparty.test',
    fetch: async (url, init) => {
      const status = init?.headers?.['x-test-status'] || 404;
      return {
        ok: status < 400,
        status,
        json: async () => ({ message: status === 502 ? 'Bad gateway' : 'Not found' }),
      };
    },
  }, 'response.ok');

  await assert.rejects(
    request('/api/watchparty/public', { headers: { 'x-test-status': 404 } }),
    /Not found/
  );
  await assert.rejects(
    request('/api/watchparty/public', { headers: { 'x-test-status': 502 } }),
    /Bad gateway/
  );
});

test('le lobby ouvert reçoit les salons publics sans rechargement ni clic', () => {
  const rooms = [{ id: 'room-2', code: 'XYZ789', title: 'Créée ailleurs' }];
  const calls = { refresh: 0, disconnect: 0, setRooms: [], setError: [] };
  const socketHandlers = new Map();
  const listeners = { window: new Map(), document: new Map() };
  const intervals = [];
  const cleared = [];
  const fakeSocket = {
    on: (event, handler) => socketHandlers.set(event, handler),
    disconnect: () => { calls.disconnect += 1; },
  };
  const fakeWindow = {
    setInterval: (handler, delay) => { intervals.push({ handler, delay }); return 77; },
    clearInterval: (id) => cleared.push(id),
    addEventListener: (event, handler) => listeners.window.set(event, handler),
    removeEventListener: (event) => listeners.window.delete(event),
  };
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (event, handler) => listeners.document.set(event, handler),
    removeEventListener: (event) => listeners.document.delete(event),
  };
  const effect = sourceEffect(PAGE, 'LOBBY_PUBLIC_ROOMS', {
    roomId: undefined,
    refreshPublicRooms: async () => { calls.refresh += 1; },
    io: (url, options) => {
      calls.url = url;
      calls.options = options;
      return fakeSocket;
    },
    WATCHPARTY_API: 'https://watchparty.test',
    lobbySocketRef: { current: null },
    setPublicRooms: (next) => calls.setRooms.push(next),
    setError: (next) => calls.setError.push(next),
    window: fakeWindow,
    document: fakeDocument,
    PUBLIC_ROOMS_POLL_MS: 10_000,
  });

  const cleanup = effect();

  assert.equal(calls.refresh, 1, 'le lobby charge immédiatement la liste');
  assert.equal(calls.url, 'https://watchparty.test/watchparty-lobby');
  assert.ok(socketHandlers.has('lobby:rooms'), 'le lobby écoute les changements serveur');
  assert.ok(listeners.window.has('focus'));
  assert.ok(listeners.document.has('visibilitychange'));
  assert.equal(intervals.length, 1);

  socketHandlers.get('lobby:rooms')(rooms);
  assert.deepEqual(calls.setRooms, [rooms]);

  intervals[0].handler();
  assert.equal(calls.refresh, 2, 'un polling de sécurité rafraîchit la liste');

  listeners.document.get('visibilitychange')();
  assert.equal(calls.refresh, 3, 'le retour en avant-plan rafraîchit la liste');

  cleanup();
  assert.equal(calls.disconnect, 1);
  assert.deepEqual(cleared, [77]);
  assert.equal(listeners.window.has('focus'), false);
  assert.equal(listeners.document.has('visibilitychange'), false);
});
