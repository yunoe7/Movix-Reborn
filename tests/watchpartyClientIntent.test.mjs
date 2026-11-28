import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceEffect, sourceFunction, sourceJsxHandler, sourceNamedFunction } from './helpers/sourceFunction.mjs';

// Ces scénarios isolent les intentions utilisateur du client : séquence stale,
// file pendant une application distante, compatibilité des serveurs dénués
// d'accusé de réception et réconciliation de room.playbackState. Les callbacks
// sont extraits du vrai composant, sans monter la SPA ni le serveur.
const PAGE = 'src/pages/WatchPartyPage.tsx';
const NOOP = () => {};
const T0 = 1_700_000_000_000;

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function fakeSocket(id = 'host-1') {
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
    updates() { return emits.filter(([event]) => event === 'playback:update').map(([, payload]) => payload); },
    count(event) { return emits.filter(([name]) => name === event).length; },
  };
}

function playbackHelpers() {
  const playbackStateMatches = sourceNamedFunction(PAGE, 'playbackStateMatches');
  const readLocalPlaybackState = sourceNamedFunction(PAGE, 'readLocalPlaybackState');
  const emitPlaybackUpdate = sourceNamedFunction(PAGE, 'emitPlaybackUpdate');
  const queuePlaybackIntent = sourceNamedFunction(PAGE, 'queuePlaybackIntent');
  const desiredPlaybackTarget = sourceNamedFunction(PAGE, 'desiredPlaybackTarget');
  const isRetryResponseFresh = sourceNamedFunction(PAGE, 'isRetryResponseFresh');
  const flushQueuedPlaybackIntents = sourceNamedFunction(PAGE, 'flushQueuedPlaybackIntents', {
    emitPlaybackUpdate,
    readLocalPlaybackState,
    playbackStateMatches,
  });
  return {
    playbackStateMatches,
    readLocalPlaybackState,
    emitPlaybackUpdate,
    queuePlaybackIntent,
    desiredPlaybackTarget,
    isRetryResponseFresh,
    flushQueuedPlaybackIntents,
  };
}

function createFixture({ host = true, syncMode = 'classic' } = {}) {
  const timers = new Map();
  let nextTimerId = 0;
  const fakeWindow = {
    setTimeout(handler, delayMs) {
      const id = ++nextTimerId;
      timers.set(id, { handler, due: Date.now() + delayMs });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 1,
    clearInterval: NOOP,
  };
  const fireDueTimers = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.handler();
    }
  };
  const socket = fakeSocket(host ? 'host-1' : 'guest-1');
  const room = {
    id: 'room-1',
    hostId: 'host-1',
    syncMode,
    media: { src: 'movie.mp4', playbackType: 'video' },
    participants: [],
    readyState: {},
    playbackState: {
      isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'system', seq: 4, mediaEpoch: 1
    }
  };
  const state = { room: [], participant: [], notices: [], playerUi: [], applied: [], error: [] };
  const refs = {
    roomRef: { current: room },
    socketRef: { current: socket },
    authoritativePlaybackRef: { current: { ...room.playbackState, reason: 'heartbeat' } },
    pendingPlaybackRef: { current: null },
    playbackIntentsRef: { current: [] },
    stateRequestedForRetryRef: { current: false },
    retryRequestRef: { current: null },
    applyingRemoteRef: { current: false },
    canControlRef: { current: true },
    remoteCommandTimeoutRef: { current: null },
    remoteSuppressionUntilRef: { current: 0 },
    vidriftFrameRef: { current: null },
    vidriftPlaybackRef: { current: { currentTime: 0, paused: true, updatedAt: 0, playbackRate: 1 } },
    videoRef: { current: { paused: true, currentTime: 10, playbackRate: 1, play: NOOP, pause: NOOP } },
    clockOffsetSamplesRef: { current: [] },
    clockOffsetRef: { current: 0 },
    pendingClockProbesRef: { current: new Map() },
    clockProbeSequenceRef: { current: 0 },
    resyncRequestedRef: { current: false },
    syncWorkerRef: { current: null },
    lastHeartbeatRef: { current: 0 },
  };
  const helpers = playbackHelpers();
  const bindings = {
    roomId: 'room-1',
    navigate: NOOP,
    getRoomToken: () => 'token',
    clearRoomToken: NOOP,
    apiRequest: async () => ({ room }),
    sessionStorage: { getItem: () => 'Invité' },
    io: () => socket,
    WATCHPARTY_API: 'https://watchparty.test',
    window: fakeWindow,
    performance: { now: () => Date.now() },
    document: { visibilityState: 'visible', addEventListener: NOOP, removeEventListener: NOOP },
    ...refs,
    ...helpers,
    setSocketState: NOOP,
    setSelfId: NOOP,
    setError: value => state.error.push(value),
    setRoom: updater => state.room.push(typeof updater === 'function' ? updater(room) : updater),
    setParticipants: value => state.participant.push(value),
    setReadyState: NOOP,
    setPauseTimer: NOOP,
    setCountdownTarget: NOOP,
    setPauseVote: NOOP,
    setControlNotice: value => state.notices.push(value),
    setControlRequests: NOOP,
    setMessages: NOOP,
    setReactions: NOOP,
    setPlayerUi: updater => state.playerUi.push(typeof updater === 'function'
      ? updater({ currentTime: 0, duration: 0, paused: true, isBuffering: false })
      : updater),
    setSyncStatus: NOOP,
    setSyncEngine: NOOP,
    applyRemotePlayback: snapshot => state.applied.push(snapshot),
    resetPlaybackEngine: NOOP,
  };
  bindings.useCallback = callback => callback;
  bindings.resetPlaybackEngine = sourceFunction(PAGE, 'resetPlaybackEngine', bindings, 'postMessage');
  const sendBindings = {
    ...bindings,
    canControl: true,
    isHost: host,
  };
  const suppressBindings = { ...bindings, canControl: true };
  const cleanup = sourceEffect(PAGE, "socket.on('playback:ack'", bindings)();
  const sendPlayback = sourceFunction(PAGE, 'sendPlayback', sendBindings, 'applyingRemoteRef');
  const suppressRemotePlaybackEvents = sourceFunction(
    PAGE, 'suppressRemotePlaybackEvents', suppressBindings, 'remoteSuppressionUntilRef'
  );

  return {
    socket, room, refs, helpers, state, sendPlayback, suppressRemotePlaybackEvents,
    resetPlaybackEngine: bindings.resetPlaybackEngine, timers, fireDueTimers, cleanup,
  };
}

test('STALE_SEQUENCE : une seule intention, un commandId stable et un seul retry avec un seq frais', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    fixture.sendPlayback('play');
    const first = fixture.socket.updates()[0];
    assert.equal(first.seq, 5, 'le seq est une estimation au moment de l’envoi, pas une valeur pré-incrémentée dans la ref');
    assert.equal(typeof first.commandId, 'string');
    assert.ok(fixture.refs.playbackIntentsRef.current.some(intent => intent.commandId === first.commandId));

    fixture.socket.fire('playback:ack', {
      commandId: first.commandId,
      seq: first.seq,
      accepted: false,
      code: 'STALE_SEQUENCE',
      reason: 'play',
      mediaEpoch: 1,
      state: { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'system', seq: 8, mediaEpoch: 1 }
    });
    assert.equal(fixture.socket.count('playback:getState'), 1, 'un rejet stale doit redemander l’état serveur');
    assert.equal(fixture.socket.updates().length, 1, 'aucune commande ne doit être réémise avant la réception de l’état');

    fixture.socket.fire('room:playback', {
      isPlaying: false, position: 12, updatedAt: T0 + 2000, updatedBy: 'system', seq: 9, mediaEpoch: 1
    });
    const updates = fixture.socket.updates();
    assert.equal(updates.length, 2, 'la file ne doit rejouer l’intention qu’une fois');
    assert.equal(updates[1].commandId, first.commandId, 'le même identifiant logique doit être réémis');
    assert.equal(updates[1].seq, 10, 'le retry doit utiliser le seq de l’état reçu');
    assert.equal(fixture.refs.stateRequestedForRetryRef.current, false);

    fixture.socket.fire('playback:ack', {
      commandId: first.commandId,
      seq: 10,
      accepted: false,
      code: 'STALE_SEQUENCE',
      reason: 'play',
      mediaEpoch: 1,
      state: { isPlaying: true, position: 12, updatedAt: T0 + 2000, updatedBy: 'host-1', seq: 10, mediaEpoch: 1 }
    });
    assert.equal(fixture.socket.updates().length, 2, 'un second rejet stale ne doit jamais relancer la file');
    assert.equal(fixture.socket.count('playback:getState'), 1, 'aucune boucle de getState');
  } finally {
    fixture.cleanup();
  }
});

test('une intention utilisateur pendant une application distante est rejouée à la fin de la fenêtre', () => {
  const fixture = createFixture();
  try {
    const expectedState = { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'host-1', seq: 4, mediaEpoch: 1 };
    fixture.refs.authoritativePlaybackRef.current = expectedState;
    const localVideo = {
      paused: true,
      currentTime: 12,
      play: NOOP,
      pause() { this.paused = true; },
    };
    fixture.refs.videoRef.current = localVideo;

    const timers = new Map();
    const fakeWindow = {
      setTimeout(handler, delayMs) {
        const id = timers.size + 1;
        timers.set(id, { handler, due: Date.now() + delayMs });
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    };
    const suppress = sourceFunction(PAGE, 'suppressRemotePlaybackEvents', {
      useCallback: callback => callback,
      ...fixture.refs,
      window: fakeWindow,
      canControl: true,
      flushQueuedPlaybackIntents: fixture.helpers.flushQueuedPlaybackIntents,
    }, 'remoteSuppressionUntilRef');

    suppress(250, expectedState);
    fixture.sendPlayback('play', { userInitiated: true });
    fixture.sendPlayback('play', { userInitiated: true });
    assert.equal(fixture.socket.updates().length, 0, 'rien ne part pendant l’application distante');
    assert.equal(fixture.refs.playbackIntentsRef.current.length, 1, 'les intentions identiques sont fusionnées');

    // Fin de la fenêtre de suppression : le timer échéant rejoue la file.
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.due = Date.now();
      timer.handler();
    }
    const updates = fixture.socket.updates();
    assert.equal(updates.length, 1, 'l’intention en file est rejouée une seule fois');
    assert.equal(updates[0].reason, 'play');
    assert.equal(fixture.refs.applyingRemoteRef.current, false);
  } finally {
    fixture.cleanup();
  }
});

test('les événements générés par la vidéo pendant une application distante restent supprimés', () => {
  const fixture = createFixture();
  try {
    const expectedState = { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'host-1', seq: 4, mediaEpoch: 1 };
    fixture.refs.authoritativePlaybackRef.current = expectedState;
    fixture.refs.remoteSuppressionUntilRef.current = Date.now() + 250;
    fixture.refs.remoteSuppressionUntilRef.expectedState = expectedState;
    fixture.refs.applyingRemoteRef.current = true;
    fixture.refs.videoRef.current = { paused: true, currentTime: 10, play: NOOP, pause: NOOP };

    fixture.sendPlayback('play');
    assert.equal(fixture.socket.updates().length, 0, 'un onPlay causé par la commande distante ne génère pas de commande locale');
    assert.equal(fixture.refs.playbackIntentsRef.current.length, 0, 'aucune intention utilisateur à rejouer');
  } finally {
    fixture.cleanup();
  }
});

test('buffering : aucun seq 0 émis quand la séquence est inconnue, réception legacy sans rejet', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    const bindings = {
      socketRef: fixture.refs.socketRef,
      authoritativePlaybackRef: { current: null },
      roomRef: { current: { media: { playbackType: 'video' } } },
      videoRef: { current: null },
    };
    const waiting = sourceJsxHandler(PAGE, 'onWaiting', 'playback:buffering', bindings);
    const playing = sourceJsxHandler(PAGE, 'onPlaying', 'playback:buffering', bindings);

    waiting({ currentTarget: { currentTime: 12.5 } });
    playing({ currentTarget: { currentTime: 12.75 } });

    assert.deepEqual(fixture.socket.emits.filter(([event]) => event === 'playback:buffering').map(([, payload]) => payload), [
      { isBuffering: true, position: 12.5, mediaEpoch: 1 },
      { isBuffering: false, position: 12.75, mediaEpoch: 1 }
    ]);

    const authoritative = { isPlaying: true, position: 42, updatedAt: T0, updatedBy: 'host-1', seq: 9 };
    fixture.refs.authoritativePlaybackRef.current = authoritative;
    fixture.socket.fire('playback:buffering', {
      participantId: 'guest-1', isBuffering: true, position: 42.5, mediaEpoch: 1
    });
    assert.equal(fixture.refs.authoritativePlaybackRef.current, authoritative, 'un signal sans seq ne doit pas effacer l’état autoritaire');
    assert.equal(fixture.state.error.length, 0);
    assert.equal(fixture.state.playerUi.at(-1)?.isBuffering, true);
  } finally {
    fixture.cleanup();
  }
});

test('un ACK contenant un état réconcilie room.playbackState sans boucle de feedback', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    const state = { isPlaying: true, position: 23, updatedAt: T0 + 1000, updatedBy: 'host-1', seq: 12, mediaEpoch: 1, commandId: 'ack-1' };
    fixture.socket.fire('playback:ack', {
      commandId: 'ack-1', seq: 12, accepted: true, code: null, reason: 'play', mediaEpoch: 1, state
    });
    assert.equal(fixture.refs.authoritativePlaybackRef.current.seq, 12);
    assert.equal(fixture.state.room.at(-1)?.playbackState?.seq, 12);
    assert.equal(fixture.state.room.at(-1)?.playbackState?.position, 23);
    assert.equal(fixture.refs.roomRef.current.playbackState.seq, 12);
    assert.equal(fixture.state.applied.length, 0, 'un ACK ne doit pas réappliquer l’état sur le lecteur local');
    const roomCallsAfterFirstAck = fixture.state.room.length;

    fixture.socket.fire('playback:ack', {
      commandId: 'ack-1', seq: 12, accepted: true, code: null, reason: 'play', mediaEpoch: 1, state
    });
    assert.equal(fixture.state.room.length, roomCallsAfterFirstAck, 'un ACK identique ne doit pas générer de cycle React');
  } finally {
    fixture.cleanup();
  }
});

test('ancien serveur sans ACK : les commandes restent indépendantes et sans retry fantôme', () => {
  const fixture = createFixture();
  try {
    fixture.sendPlayback('play');
    fixture.sendPlayback('pause');
    const updates = fixture.socket.updates();
    assert.equal(updates.length, 2);
    assert.equal(updates[0].reason, 'play');
    assert.equal(updates[1].reason, 'pause');
    assert.notEqual(updates[0].commandId, updates[1].commandId);
    assert.equal(fixture.socket.count('playback:getState'), 0, 'sans accusé reçu, aucune relance ne doit être déclenchée');
    assert.equal(fixture.refs.stateRequestedForRetryRef.current, false);
  } finally {
    fixture.cleanup();
  }
});

test('un heartbeat intercalé ne consomme pas le retry ; la réponse getState le déclenche', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    fixture.sendPlayback('play');
    const first = fixture.socket.updates()[0];
    fixture.socket.fire('playback:ack', {
      commandId: first.commandId,
      seq: first.seq,
      accepted: false,
      code: 'STALE_SEQUENCE',
      reason: 'play',
      mediaEpoch: 1,
      state: { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'system', seq: 8, mediaEpoch: 1 }
    });

    fixture.socket.fire('room:playback', {
      isPlaying: false, position: 10, updatedAt: T0 + 500, updatedBy: 'host-1',
      seq: 9, mediaEpoch: 1, reason: 'heartbeat'
    });
    assert.equal(fixture.socket.updates().length, 1, 'un heartbeat ne doit pas être pris pour la réponse getState');

    // Le serveur peut répondre avec exactement le snapshot rejeté, dont le
    // `reason` heartbeat hérité du dernier état diffusé.
    fixture.socket.fire('room:playback', {
      isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'system',
      seq: 8, mediaEpoch: 1, reason: 'heartbeat'
    });
    const updates = fixture.socket.updates();
    assert.equal(updates.length, 2, 'la vraie réponse getState doit rejouer l’intention');
    assert.equal(updates[1].commandId, first.commandId);
    assert.equal(updates[1].seq, 9);
  } finally {
    fixture.cleanup();
  }
});

test('sans réponse getState, une intention en attente expire sans commande fantôme', async () => {
  const fixture = createFixture();
  const originalNow = Date.now;
  let now = T0 + 5000;
  Date.now = () => now;
  try {
    await flushMicrotasks();
    fixture.sendPlayback('play');
    const first = fixture.socket.updates()[0];
    fixture.socket.fire('playback:ack', {
      commandId: first.commandId,
      seq: first.seq,
      accepted: false,
      code: 'STALE_SEQUENCE',
      reason: 'play',
      mediaEpoch: 1,
      state: { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'system', seq: 8, mediaEpoch: 1 }
    });
    assert.equal(fixture.refs.playbackIntentsRef.current.filter(intent => intent.awaitingState).length, 1);

    now += 6000;
    fixture.socket.fire('room:playback', {
      isPlaying: false, position: 12, updatedAt: T0 + 1000, updatedBy: 'system',
      seq: 10, mediaEpoch: 1, reason: 'play'
    });
    assert.equal(fixture.socket.updates().length, 1, 'aucune commande ne doit partir après expiration du TTL');
    assert.equal(fixture.refs.playbackIntentsRef.current.filter(intent => intent.awaitingState).length, 0);
    assert.equal(fixture.socket.count('playback:getState'), 1);
  } finally {
    Date.now = originalNow;
    fixture.cleanup();
  }
});

test('un ACK retardé ne réécrit pas un état autoritaire plus récent', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    fixture.sendPlayback('play');
    const first = fixture.socket.updates()[0];
    const roomUpdatesBeforeAck = fixture.state.room.length;
    const fresh = {
      isPlaying: true, position: 23, updatedAt: T0 + 2000, updatedBy: 'host-1',
      seq: 12, mediaEpoch: 1, commandId: 'fresh-1'
    };
    fixture.refs.authoritativePlaybackRef.current = fresh;
    fixture.room.playbackState = fresh;

    fixture.socket.fire('playback:ack', {
      commandId: first.commandId,
      seq: 10,
      accepted: true,
      code: null,
      reason: 'play',
      mediaEpoch: 1,
      state: { isPlaying: false, position: 1, updatedAt: T0, updatedBy: 'system', seq: 10, mediaEpoch: 1 }
    });

    assert.equal(fixture.refs.authoritativePlaybackRef.current.seq, 12, 'l’état autoritaire doit conserver le seq le plus récent');
    assert.equal(fixture.room.playbackState.seq, 12, 'room.playbackState ne doit pas régresser');
    assert.equal(
      fixture.state.room.length,
      roomUpdatesBeforeAck,
      'aucun cycle React ne doit être déclenché par un ACK retardé'
    );
    assert.equal(fixture.refs.playbackIntentsRef.current.some(intent => intent.commandId === first.commandId), false, 'l’intention doit tout de même être acquittée');
  } finally {
    fixture.cleanup();
  }
});

test('un changement de média pendant une suppression distante purge toute la fenêtre', async () => {
  const fixture = createFixture();
  try {
    await flushMicrotasks();
    fixture.suppressRemotePlaybackEvents(250, fixture.refs.authoritativePlaybackRef.current);
    assert.equal(fixture.refs.applyingRemoteRef.current, true);
    assert.equal(fixture.timers.size, 1);

    fixture.socket.fire('media:updated', { src: 'next.mp4', playbackType: 'video' });

    assert.equal(fixture.refs.applyingRemoteRef.current, false);
    assert.equal(fixture.refs.remoteSuppressionUntilRef.current, 0);
    assert.equal(fixture.refs.remoteCommandTimeoutRef.current, null);
    assert.equal(fixture.refs.remoteSuppressionUntilRef.expectedState, undefined);
    assert.equal(fixture.timers.size, 0, 'le timer de suppression doit être annulé');
    assert.equal(fixture.refs.playbackIntentsRef.current.length, 0);
    assert.equal(fixture.refs.stateRequestedForRetryRef.current, false);
  } finally {
    fixture.cleanup();
  }
});

test('une intention utilisateur reste rejouée après convergence locale vers l’autoritaire', async () => {
  const fixture = createFixture();
  try {
    const authoritative = { isPlaying: false, position: 10, updatedAt: T0, updatedBy: 'host-1', seq: 4, mediaEpoch: 1 };
    fixture.refs.authoritativePlaybackRef.current = authoritative;
    const video = { paused: true, currentTime: 10, playbackRate: 1, play: NOOP, pause: NOOP };
    fixture.refs.videoRef.current = video;

    fixture.suppressRemotePlaybackEvents(250, authoritative);
    // Clic utilisateur : la vidéo démarre avant que la fenêtre distante se termine.
    video.paused = false;
    video.currentTime = 10.1;
    fixture.sendPlayback('play', { userInitiated: true });
    assert.equal(fixture.refs.playbackIntentsRef.current.length, 1);

    // L'application distante rétablit l'état autoritaire avant le flush.
    video.paused = true;
    video.currentTime = 10;
    fixture.fireDueTimers();

    const updates = fixture.socket.updates();
    assert.equal(updates.length, 1, 'la cible voulue par l’utilisateur n’est pas atteinte : l’intention doit survivre');
    assert.equal(updates[0].reason, 'play');
  } finally {
    fixture.cleanup();
  }
});
