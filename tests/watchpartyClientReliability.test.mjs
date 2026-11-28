import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceFunction, sourceJsxHandler } from './helpers/sourceFunction.mjs';

const PAGE = 'src/pages/WatchPartyPage.tsx';

test('fin de lecture du lecteur direct est relayée comme action ended', () => {
  const calls = [];
  const handler = sourceJsxHandler(PAGE, 'onEnded', 'sendPlayback', {
    sendPlayback: (reason) => calls.push(reason),
    setPlayerUi: () => {}
  });
  handler({ currentTarget: { paused: true, currentTime: 100 } });
  assert.deepEqual(calls, ['ended']);
});

test('buffering du lecteur direct est relayé avec la séquence de lecture', () => {
  const emits = [];
  const bindings = {
    socketRef: { current: { connected: true, emit: (event, payload) => emits.push([event, payload]) } },
    authoritativePlaybackRef: { current: { seq: 7, mediaEpoch: 2 } },
    roomRef: { current: { media: { playbackType: 'video' } } },
    videoRef: { current: null }
  };
  const waiting = sourceJsxHandler(PAGE, 'onWaiting', 'playback:buffering', bindings);
  const playing = sourceJsxHandler(PAGE, 'onPlaying', 'playback:buffering', bindings);

  waiting({ currentTarget: { currentTime: 12.5 } });
  playing({ currentTarget: { currentTime: 12.75 } });

  assert.deepEqual(emits, [
    ['playback:buffering', { isBuffering: true, position: 12.5, seq: 7, mediaEpoch: 2 }],
    ['playback:buffering', { isBuffering: false, position: 12.75, seq: 7, mediaEpoch: 2 }]
  ]);
});

test('un changement de média purge la file Pro et réinitialise le worker', () => {
  const posts = [];
  const bindings = {
    useCallback: (fn) => fn,
    pendingPlaybackRef: { current: { position: 99 } },
    authoritativePlaybackRef: { current: { position: 99 } },
    playbackIntentsRef: { current: [{ reason: 'play' }] },
    stateRequestedForRetryRef: { current: true },
    retryRequestRef: { current: { id: 'retry-1' } },
    applyingRemoteRef: { current: true },
    remoteSuppressionUntilRef: { current: 999 },
    remoteCommandTimeoutRef: { current: 7 },
    window: { clearTimeout: () => {} },
    vidriftPlaybackRef: { current: { currentTime: 99, paused: false, updatedAt: 10, playbackRate: 1 } },
    syncWorkerRef: { current: { postMessage: (message) => posts.push(message) } },
    roomRef: { current: { syncMode: 'pro' } },
    room: { syncMode: 'pro' }
  };
  const reset = sourceFunction(PAGE, 'resetPlaybackEngine', bindings, 'postMessage');

  reset();

  assert.equal(bindings.pendingPlaybackRef.current, null);
  assert.equal(bindings.authoritativePlaybackRef.current, null);
  assert.deepEqual(bindings.vidriftPlaybackRef.current, {
    currentTime: 0, paused: true, updatedAt: 0, playbackRate: 1
  });
  assert.deepEqual(posts.map((message) => message.type), ['reset', 'set-mode', 'master-state']);
  assert.equal(posts[1].mode, 'pro');
  assert.equal(posts[2].state.position, 0);
});
