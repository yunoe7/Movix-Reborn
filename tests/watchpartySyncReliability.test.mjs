import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceEffect, sourceFunction, sourceNamedFunction } from './helpers/sourceFunction.mjs';

// Ces scénarios couvrent les courses et les états de connexion que les E2E
// Chromium ne reproduisent pas : reconnexion, retour en arrière-plan, commandes
// rapides et changement de média. Les callbacks sont extraits du vrai composant.
const PAGE = 'src/pages/WatchPartyPage.tsx';
const noop = () => {};

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function fakeSocket(id = 'guest-1') {
  const handlers = new Map();
  const emits = [];
  return {
    id,
    connected: true,
    handlers,
    emits,
    on(event, handler) { handlers.set(event, handler); return this; },
    off(event, handler) { if (handlers.get(event) === handler) handlers.delete(event); },
    emit(event, payload) { emits.push([event, payload]); },
    disconnect() { this.connected = false; },
    fire(event, payload) { handlers.get(event)?.(payload); },
  };
}

function roomFixture({ host = false, syncMode = 'classic' } = {}) {
  const socket = fakeSocket('guest-1');
  const room = {
    id: 'room-1',
    hostId: host ? socket.id : 'host-1',
    syncMode,
    media: { src: 'video.mp4', playbackType: 'video' },
    participants: [],
    readyState: {},
    playbackState: { isPlaying: false, position: 0, updatedAt: Date.now(), updatedBy: 'system' }
  };
  const state = { error: [], room: [], socketState: [], notices: [], navigate: [], participants: [], selfId: [], applied: [] };
  const refs = {
    roomRef: { current: room },
    pendingPlaybackRef: { current: { isPlaying: true, position: 99 } },
    clockOffsetSamplesRef: { current: [] },
    clockOffsetRef: { current: 0 },
    pendingClockProbesRef: { current: new Map() },
    clockProbeSequenceRef: { current: 0 },
    syncWorkerRef: { current: null },
    socketRef: { current: null },
    authoritativePlaybackRef: { current: null },
    resyncRequestedRef: { current: false },
    playbackIntentsRef: { current: [] },
    stateRequestedForRetryRef: { current: false },
    retryRequestRef: { current: null },
    applyingRemoteRef: { current: false },
    remoteSuppressionUntilRef: { current: 0 },
    remoteCommandTimeoutRef: { current: null },
    canControlRef: { current: true },
    videoRef: { current: null },
    vidriftPlaybackRef: { current: { currentTime: 0, paused: true, updatedAt: 0, playbackRate: 1 } },
  };
  const workerMessages = [];
  refs.syncWorkerRef.current = { postMessage: message => workerMessages.push(message) };
  const resetPlaybackEngine = () => {
    refs.pendingPlaybackRef.current = null;
    refs.authoritativePlaybackRef.current = null;
    refs.syncWorkerRef.current.postMessage({ type: 'reset' });
  };
  const documentListeners = [];
  const fakeDocument = {
    visibilityState: 'hidden',
    addEventListener(name, handler) { documentListeners.push([name, handler]); },
    removeEventListener(name, handler) {
      const index = documentListeners.findIndex(entry => entry[1] === handler);
      if (index >= 0) documentListeners.splice(index, 1);
    },
  };
  const fakeWindow = { setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop };
  const bindings = {
    roomId: 'room-1',
    navigate: (path, options) => state.navigate.push([path, options]),
    getRoomToken: () => 'token',
    clearRoomToken: noop,
    apiRequest: async () => ({ room }),
    sessionStorage: { getItem: () => 'Invité' },
    io: () => socket,
    WATCHPARTY_API: 'https://watchparty.test',
    ...refs,
    setSocketState: value => state.socketState.push(value),
    setSelfId: value => state.selfId.push(value),
    setError: value => state.error.push(value),
    setRoom: updater => state.room.push(typeof updater === 'function' ? updater(room) : updater),
    setParticipants: value => state.participants.push(value),
    setReadyState: noop,
    setPauseTimer: noop,
    setCountdownTarget: noop,
    setPauseVote: noop,
    setControlNotice: value => state.notices.push(value),
    setControlRequests: noop,
    setMessages: noop,
    setReactions: noop,
    setSyncStatus: noop,
    setSyncEngine: noop,
    applyRemotePlayback: snapshot => state.applied.push(snapshot),
    resetPlaybackEngine,
    window: fakeWindow,
    document: fakeDocument,
  };
  const cleanup = sourceEffect(PAGE, "socket.on('connect'", bindings)();
  return { socket, room, refs, state, workerMessages, documentListeners, fakeDocument, cleanup };
}

test('une erreur de connexion disparaît après une reconnexion réussie', async () => {
  const fixture = roomFixture();
  try {
    await flushMicrotasks();
    fixture.socket.fire('connect_error', { message: 'Serveur indisponible' });
    assert.equal(fixture.state.error.at(-1), 'Serveur indisponible');

    fixture.socket.fire('connect');
    assert.equal(fixture.state.error.at(-1), '', 'le message d’erreur ne doit pas rester affiché une fois connecté');
    assert.equal(fixture.socket.emits.filter(([event]) => event === 'sync:probe').length, 5);
    assert.ok(fixture.socket.emits.some(([event]) => event === 'playback:getState'));
  } finally {
    fixture.cleanup();
  }
});

test('le créateur reçoit son rôle d’hôte dans room, participants et selfId', async () => {
  const fixture = roomFixture();
  try {
    await flushMicrotasks();
    fixture.socket.id = 'creator-socket';
    fixture.socket.fire('connect');

    const participants = [{
      id: 'creator-socket',
      nickname: 'Créateur',
      isHost: true,
      isActive: true,
      joinedAt: 1
    }];
    fixture.socket.fire('room:participants', participants);
    fixture.socket.fire('room:info', {
      ...fixture.room,
      hostId: 'creator-socket',
      participants,
      controlMode: 'host-only'
    });

    const selfId = fixture.state.selfId.at(-1);
    const currentRoom = fixture.state.room.at(-1);
    const currentParticipants = fixture.state.participants.at(-1);
    assert.equal(selfId, 'creator-socket');
    assert.equal(currentRoom.hostId, selfId);
    assert.equal(currentParticipants[0].isHost, true);

    const isHost = sourceFunction(PAGE, 'isHost', { Boolean, selfId, room: currentRoom });
    const canControl = sourceFunction(
      PAGE, 'canControl', { Boolean, selfId, isHost, isCoHost: false, room: currentRoom },
    );
    assert.equal(isHost, true, 'le créateur doit être reconnu comme hôte');
    assert.equal(canControl, true, 'l’hôte doit obtenir les commandes de lecture');
  } finally {
    fixture.cleanup();
  }
});

test('un participant expulsé ou une salle fermée transmet le motif au lobby', async () => {
  for (const event of ['room:kicked', 'room:closed']) {
    const fixture = roomFixture();
    try {
      await flushMicrotasks();
      fixture.socket.fire(event, { reason: 'Motif du serveur' });
      const navigation = fixture.state.navigate.at(-1);
      assert.equal(navigation[0], '/watchparty');
      assert.equal(navigation[1]?.state?.message, 'Motif du serveur', `${event} doit conserver le motif`);
    } finally {
      fixture.cleanup();
    }
  }
});

test('le retour en arrière-plan resynchronise l’hôte et l’invité sans inverser leurs rôles', async () => {
  for (const host of [false, true]) {
    const fixture = roomFixture({ host });
    try {
      await flushMicrotasks();
      const listener = fixture.documentListeners.find(([name]) => name === 'visibilitychange');
      assert.ok(listener, 'un écouteur visibilitychange doit être enregistré');

      fixture.fakeDocument.visibilityState = 'visible';
      listener[1]();
      if (host) {
        assert.ok(
          fixture.socket.emits.some(([event, payload]) => event === 'playback:update' && payload.reason === 'heartbeat'),
          'l’hôte doit réémettre sa position après un retour en avant-plan',
        );
      } else {
        assert.ok(fixture.socket.emits.some(([event]) => event === 'playback:getState'));
        assert.ok(
          !fixture.socket.emits.some(([event]) => event === 'playback:update'),
          'un invité ne doit jamais émettre de heartbeat',
        );
      }
    } finally {
      fixture.cleanup();
    }
    assert.equal(fixture.documentListeners.length, 0, 'l’écouteur doit être retiré au nettoyage');
  }
});

test('Sync Pro continue à différer les actions explicites et à recevoir les heartbeats', async () => {
  const fixture = roomFixture({ syncMode: 'pro' });
  try {
    await flushMicrotasks();
    fixture.socket.fire('playback:state', { isPlaying: true, position: 12, reason: 'play', updatedBy: 'host-1' });
    assert.equal(
      fixture.workerMessages.filter(message => message.type === 'master-state').length,
      0,
      'une action explicite ne doit pas être appliquée avant son schedule',
    );

    fixture.socket.fire('room:playback', { isPlaying: true, position: 13, reason: 'heartbeat', updatedBy: 'host-1' });
    assert.equal(fixture.workerMessages.filter(message => message.type === 'master-state').length, 1);

    fixture.socket.fire('playback:schedule', { action: 'play', position: 13, scheduledAt: 1000, serverNow: 750, updatedBy: 'host-1' });
    const schedule = fixture.workerMessages.find(message => message.type === 'schedule');
    assert.equal(schedule.event.action, 'play');
    assert.equal(schedule.event.scheduledAt, 1000);
  } finally {
    fixture.cleanup();
  }
});

test('le retour en avant-plan applique le snapshot de resync même avec reason=seek', async () => {
  for (const syncMode of ['classic', 'pro']) {
    const fixture = roomFixture({ syncMode });
    try {
      await flushMicrotasks();
      const listener = fixture.documentListeners.find(([name]) => name === 'visibilitychange');
      assert.ok(listener, 'un écouteur visibilitychange doit être enregistré');
      fixture.fakeDocument.visibilityState = 'visible';
      listener[1]();
      assert.ok(fixture.socket.emits.some(([event]) => event === 'playback:getState'));

      const snapshot = { isPlaying: true, position: 42, reason: 'seek', updatedBy: 'host-1' };
      fixture.socket.fire('room:playback', snapshot);

      if (syncMode === 'pro') {
        assert.equal(
          fixture.workerMessages.filter(message => message.type === 'master-state').length,
          1,
          'le snapshot de resync doit alimenter le worker même après une action explicite',
        );
      } else {
        assert.equal(fixture.state.applied.length, 1, 'le snapshot de resync doit être appliqué en classique');
        assert.equal(fixture.state.applied[0].position, 42);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test('un hôte Pro ne double pas une action explicite d’un autre contrôleur', async () => {
  const fixture = roomFixture({ host: true, syncMode: 'pro' });
  try {
    await flushMicrotasks();
    fixture.socket.fire('playback:state', {
      isPlaying: false,
      position: 88,
      reason: 'pause',
      updatedBy: 'co-host-1'
    });

    assert.equal(fixture.state.applied.length, 0, 'l’action doit passer par le schedule, pas par une application immédiate');
    fixture.socket.fire('playback:schedule', {
      action: 'pause',
      position: 88,
      scheduledAt: 2000,
      serverNow: 1750,
      updatedBy: 'co-host-1'
    });
    const schedule = fixture.workerMessages.find(message => message.type === 'schedule');
    assert.equal(schedule?.event.action, 'pause');
  } finally {
    fixture.cleanup();
  }
});

test('un changement de média jette la position en attente du média précédent', async () => {
  const fixture = roomFixture();
  try {
    await flushMicrotasks();
    fixture.refs.pendingPlaybackRef.current = { isPlaying: true, position: 99, updatedAt: 1 };
    fixture.socket.fire('media:updated', { src: 'episode-2.mp4', playbackType: 'video' });
    assert.equal(fixture.refs.pendingPlaybackRef.current, null);
  } finally {
    fixture.cleanup();
  }
});

function suppressionFixture() {
  const originalNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  const timers = new Map();
  const fakeWindow = {
    setTimeout(fn, delayMs) {
      const id = timers.size + 1;
      timers.set(id, { fn, due: now + delayMs });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const applyingRemoteRef = { current: false };
  const remoteCommandTimeoutRef = { current: null };
  const remoteSuppressionUntilRef = { current: 0 };
  const playbackIntentsRef = { current: [] };
  const emits = [];
  const video = {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    play() { video.paused = false; return Promise.resolve(); },
    pause() { video.paused = true; },
  };
  const bindings = {
    useCallback: fn => fn,
    applyingRemoteRef,
    remoteCommandTimeoutRef,
    remoteSuppressionUntilRef,
    playbackIntentsRef,
    window: fakeWindow,
    roomRef: { current: { media: { playbackType: 'video' } } },
    vidriftFrameRef: { current: null },
    videoRef: { current: video },
    getVidRiftTargetOrigin: () => 'https://vidrift.test',
    postToVidRift: noop,
    VIDRIFT_ORIGIN: 'https://vidrift.test',
    setRequiresUserGesture: noop,
    authoritativePlaybackRef: { current: null },
    clockOffsetRef: { current: 0 },
    vidriftPlaybackRef: { current: { currentTime: 0, paused: true, updatedAt: 0, playbackRate: 1 } },
    pendingPlaybackRef: { current: null },
    socketRef: { current: { connected: true, emit: (event, payload) => emits.push([event, payload]) } },
    canControl: true,
    isHost: true,
    lastHeartbeatRef: { current: 0 },
    performance: { now: () => now },
    canControlRef: { current: true },
  };
  const playbackHelpers = {
    playbackStateMatches: sourceNamedFunction(PAGE, 'playbackStateMatches'),
    readLocalPlaybackState: sourceNamedFunction(PAGE, 'readLocalPlaybackState'),
    emitPlaybackUpdate: sourceNamedFunction(PAGE, 'emitPlaybackUpdate'),
    queuePlaybackIntent: sourceNamedFunction(PAGE, 'queuePlaybackIntent'),
    desiredPlaybackTarget: sourceNamedFunction(PAGE, 'desiredPlaybackTarget'),
  };
  playbackHelpers.flushQueuedPlaybackIntents = sourceNamedFunction(
    PAGE, 'flushQueuedPlaybackIntents', playbackHelpers
  );
  Object.assign(bindings, playbackHelpers);

  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.due > now) continue;
      timers.delete(id);
      timer.fn();
    }
  };

  return {
    emits,
    async run() {
      const suppressRemotePlaybackEvents = sourceFunction(
        PAGE, 'suppressRemotePlaybackEvents', bindings, 'remoteSuppressionUntilRef',
      );
      bindings.suppressRemotePlaybackEvents = suppressRemotePlaybackEvents;
      const applySyncCommand = sourceFunction(PAGE, 'applySyncCommand', bindings, 'postToVidRift');
      const applyRemotePlayback = sourceFunction(PAGE, 'applyRemotePlayback', bindings, 'targetPosition');
      const sendPlayback = sourceFunction(PAGE, 'sendPlayback', bindings, 'applyingRemoteRef');

      applySyncCommand({ action: 'resetPlaybackRate' });
      advance(100);
      await applyRemotePlayback({ isPlaying: false, position: 0, updatedAt: now, updatedBy: 'host-1' });
      advance(300);
      sendPlayback('play');
      const suppressedCount = emits.length;
      advance(1000);
      sendPlayback('play');
      return { suppressedCount, finalCount: emits.length };
    },
    restore() { Date.now = originalNow; },
  };
}

test('une commande tardive ne raccourcit pas la fenêtre de suppression des événements locaux', async () => {
  const fixture = suppressionFixture();
  try {
    const { suppressedCount, finalCount } = await fixture.run();
    assert.equal(suppressedCount, 0, 'un événement reçu pendant la commande distante ne doit pas être renvoyé au serveur');
    assert.equal(finalCount, suppressedCount + 1, 'la fenêtre doit se terminer et autoriser de nouveau les commandes locales');
    const updates = fixture.emits.filter(([event]) => event === 'playback:update');
    assert.equal(updates.length, 1);
    assert.equal(typeof updates[0][1].commandId, 'string');
    assert.ok(updates[0][1].commandId.length > 0);
    assert.equal(updates[0][1].seq, 1, 'les commandes locales portent une séquence monotone');
  } finally {
    fixture.restore();
  }
});
