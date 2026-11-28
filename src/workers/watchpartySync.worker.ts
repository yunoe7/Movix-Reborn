/// <reference lib="webworker" />

import { PlaybackState, ScheduledPlaybackEvent, SyncProbeResult, SyncMode } from '../utils/watchparty';
import {
  clampPlaybackRate,
  LocalPlayerSnapshot,
  SYNC_PRO_HARD_THRESHOLD_SECONDS,
  SYNC_PRO_SOFT_THRESHOLD_SECONDS,
  SyncCommandMessage,
  SyncEngineMessage,
  SyncStatusMessage,
  WatchPartySyncWorkerInput,
  WatchPartySyncWorkerOutput
} from '../utils/watchpartySync';

declare const self: DedicatedWorkerGlobalScope;

interface WasmEngineModule {
  default: () => Promise<unknown>;
  WatchPartySyncEngine: new () => WasmEngine;
}

interface WasmEngine {
  reset(): void;
  set_mode(mode: string): unknown;
  ingest_master_state(state: unknown): unknown;
  ingest_schedule(event: unknown): unknown;
  update_clock_offset(result: unknown): unknown;
  tick(state: unknown): unknown;
  get_status(): string;
}

// Une action explicite reste en attente jusqu'à son `scheduledAt`. Tant qu'il
// en reste, aucun tick local ne peut anticiper la commande ni appliquer une
// correction de dérive futures. Plusieurs actions rapides sont exécutées dans
// l'ordre de leur échéance, pas en remplaçant le timer precedent.
interface PendingSchedule {
  event: ScheduledPlaybackEvent;
  wasPlaying: boolean;
}

let mode: SyncMode = 'classic';
let masterState: PlaybackState | null = null;
let clockOffsetMs = 0;
let lastStatus: SyncStatusMessage['status'] = 'classic';
let scheduledActionTimer: number | null = null;
const pendingSchedules: PendingSchedule[] = [];
let lastRateSent = 1;
let lastHardSyncAt = 0;
let lastPlayPauseAt = 0;
const offsetSamples: number[] = [];
let wasmEngine: WasmEngine | null = null;

const postStatus = (status: SyncStatusMessage['status']) => {
  if (status === lastStatus) return;
  lastStatus = status;
  self.postMessage({ type: 'status', status } satisfies SyncStatusMessage);
};

const postCommand = (message: SyncCommandMessage) => {
  self.postMessage(message);
};

const forwardWorkerOutputs = (rawOutputs: unknown) => {
  if (!Array.isArray(rawOutputs)) return;

  rawOutputs.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;

    const typedEntry = entry as WatchPartySyncWorkerOutput;
    if (typedEntry.type === 'status') {
      postStatus(typedEntry.status);
      return;
    }

    if (typedEntry.type === 'command') {
      postCommand(typedEntry);
    }
  });
};

const clearScheduledTimer = () => {
  if (scheduledActionTimer !== null) {
    clearTimeout(scheduledActionTimer);
    scheduledActionTimer = null;
  }
};

const clearPendingSchedules = () => {
  pendingSchedules.length = 0;
  clearScheduledTimer();
};

function executeNextSchedule() {
  scheduledActionTimer = null;
  const pending = pendingSchedules.shift();
  if (!pending) return;

  const { event, wasPlaying } = pending;
  const executionServerTime = Date.now() + clockOffsetMs;
  const isPlaying = event.action === 'seek' ? wasPlaying : event.action !== 'pause';
  // L'hôte a appliqué son action localement à `serverNow`. Pendant les 250 ms
  // de latence volontaire, un lecteur en lecture a avancé : viser la position
  // brute ferait revenir les invités en arrière à l'exécution.
  const elapsedSeconds = event.action === 'seek' && isPlaying
    ? Math.max(0, (executionServerTime - event.serverNow) / 1000)
    : 0;
  const position = event.position + elapsedSeconds;

  masterState = {
    isPlaying,
    position,
    updatedAt: executionServerTime,
    updatedBy: event.updatedBy
  };

  if (wasmEngine) {
    forwardWorkerOutputs(wasmEngine.ingest_schedule({ ...event, position, scheduledAt: executionServerTime }));
  }

  if (event.action === 'seek') {
    postCommand({ type: 'command', action: 'seek', value: position });
  } else if (event.action === 'play') {
    postCommand({ type: 'command', action: 'play' });
  } else {
    postCommand({ type: 'command', action: 'pause' });
  }

  armNextSchedule();
}

function armNextSchedule() {
  clearScheduledTimer();
  if (mode !== 'pro' || pendingSchedules.length === 0) return;
  const delay = Math.max(0, pendingSchedules[0].event.scheduledAt - (Date.now() + clockOffsetMs));
  scheduledActionTimer = self.setTimeout(executeNextSchedule, delay);
}

const tryLoadWasmBundle = async () => {
  try {
    const wasmEntryUrl = `${self.location.origin}/wasm/watchparty-sync/watchparty_sync.js`;
    const wasmModule = await import(/* @vite-ignore */ wasmEntryUrl) as WasmEngineModule;
    await wasmModule.default();
    wasmEngine = new wasmModule.WatchPartySyncEngine();
    forwardWorkerOutputs(wasmEngine.set_mode(mode));
    if (masterState) {
      forwardWorkerOutputs(wasmEngine.ingest_master_state(masterState));
    }
    self.postMessage({ type: 'engine', implementation: 'wasm' } satisfies SyncEngineMessage);
  } catch {
    wasmEngine = null;
    self.postMessage({ type: 'engine', implementation: 'js' } satisfies SyncEngineMessage);
  }
};

const resetEngine = () => {
  clearPendingSchedules();
  masterState = null;
  clockOffsetMs = 0;
  offsetSamples.length = 0;
  lastRateSent = 1;
  lastHardSyncAt = 0;
  lastPlayPauseAt = 0;
  wasmEngine?.reset();
};

const setMode = (nextMode: SyncMode) => {
  mode = nextMode;
  clearPendingSchedules();

  if (wasmEngine) {
    forwardWorkerOutputs(wasmEngine.set_mode(nextMode));
    return;
  }

  if (mode === 'classic') {
    lastRateSent = 1;
    postCommand({ type: 'command', action: 'resetPlaybackRate' });
    postStatus('classic');
    return;
  }

  postStatus(offsetSamples.length >= 3 ? 'adjusting' : 'calibrating');
};

const updateClockOffset = (result: SyncProbeResult) => {
  if (wasmEngine) {
    forwardWorkerOutputs(wasmEngine.update_clock_offset(result));
    return;
  }

  if (typeof result.clientReceivedAt !== 'number') return;

  const roundTripMs = result.clientReceivedAt - result.clientSentAt;
  const estimatedOffsetMs = result.serverSentAt - (result.clientSentAt + roundTripMs / 2);

  offsetSamples.push(estimatedOffsetMs);
  if (offsetSamples.length > 5) {
    offsetSamples.shift();
  }

  clockOffsetMs = offsetSamples.reduce((sum, sample) => sum + sample, 0) / offsetSamples.length;
  postStatus(offsetSamples.length >= 3 ? 'perfect' : 'calibrating');
};

const getExpectedPosition = (nowMs: number) => {
  if (!masterState) return null;

  const adjustedNow = nowMs + clockOffsetMs;
  if (!masterState.isPlaying) {
    return masterState.position;
  }

  return masterState.position + Math.max(0, adjustedNow - masterState.updatedAt) / 1000;
};

const handleSchedule = (event: ScheduledPlaybackEvent) => {
  if (mode !== 'pro') return;

  const eventEpoch = Number(event.mediaEpoch) || 0;
  const masterEpoch = Number(masterState?.mediaEpoch) || 0;
  // Après un `media:change`, une commande différée appartenant encore à l'ancien
  // média ne doit jamais s'exécuter sur le nouveau lecteur.
  if (eventEpoch && masterEpoch && eventEpoch < masterEpoch) return;

  // Socket.IO peut rediffuser le même snapshot après une reconnexion : ne pas
  // exécuter deux fois la même action explicite. La dédup forte n'est autorisée
  // que si le serveur fournit une vraie séquence et une vraie époque. En legacy,
  // un commandId explicite ou un horodatage serveur exploitable identifie un
  // snapshot ; sans aucune de ces clés, mieux vaut ne pas dédupliquer deux
  // actions distinctes de contenu identique.
  const scheduleIdentity = (candidate: ScheduledPlaybackEvent): string | null => {
    const seq = Number(candidate.seq) || 0;
    const epoch = Number(candidate.mediaEpoch) || 0;
    const actionIdentity = [
      candidate.scheduledAt,
      candidate.action,
      candidate.position,
      candidate.updatedBy
    ].join('|');
    if (seq > 0 && epoch > 0) return `strong:${seq}:${epoch}:${actionIdentity}`;
    const commandId = (candidate as ScheduledPlaybackEvent & { commandId?: string }).commandId;
    if (commandId) return `command:${commandId}`;
    const serverNow = Number(candidate.serverNow);
    if (Number.isFinite(serverNow) && serverNow > 0) return `legacy:${serverNow}:${actionIdentity}`;
    return null;
  };
  const identity = scheduleIdentity(event);
  const alreadyQueued = identity !== null && pendingSchedules.some(
    pending => scheduleIdentity(pending.event) === identity
  );
  if (alreadyQueued) return;

  pendingSchedules.push({
    event,
    wasPlaying: event.action === 'seek'
      ? masterState?.isPlaying ?? false
      : event.action !== 'pause'
  });
  pendingSchedules.sort((a, b) => a.event.scheduledAt - b.event.scheduledAt);
  armNextSchedule();
};

const handleLocalState = (state: LocalPlayerSnapshot) => {
  // Tant qu'une action explicite n'est pas exécutée, son état futur ne doit
  // piloter ni le moteur WASM ni le repli JS : c'est la principale source des
  // seeks/pause anticipés constatés pendant les tests réels.
  if (pendingSchedules.length > 0) return;

  if (wasmEngine) {
    forwardWorkerOutputs(wasmEngine.tick(state));
    return;
  }

  if (mode !== 'pro') {
    postStatus('classic');
    return;
  }

  if (!masterState) {
    postStatus(offsetSamples.length >= 3 ? 'adjusting' : 'calibrating');
    return;
  }

  const expectedPosition = getExpectedPosition(state.now);
  if (expectedPosition === null) return;

  if (masterState.isPlaying && !state.isPlaying && state.now - lastPlayPauseAt > 600) {
    lastPlayPauseAt = state.now;
    postCommand({ type: 'command', action: 'play' });
  } else if (!masterState.isPlaying && state.isPlaying && state.now - lastPlayPauseAt > 600) {
    lastPlayPauseAt = state.now;
    postCommand({ type: 'command', action: 'pause' });
  }

  const driftSeconds = expectedPosition - state.currentTime;
  const absDrift = Math.abs(driftSeconds);

  if (absDrift >= SYNC_PRO_HARD_THRESHOLD_SECONDS && state.now - lastHardSyncAt > 1200) {
    lastHardSyncAt = state.now;
    lastRateSent = 1;
    postStatus('unstable');
    postCommand({ type: 'command', action: 'seek', value: expectedPosition });
    postCommand({ type: 'command', action: 'resetPlaybackRate' });
    return;
  }

  if (!masterState.isPlaying || !state.isPlaying) {
    if (lastRateSent !== 1) {
      lastRateSent = 1;
      postCommand({ type: 'command', action: 'resetPlaybackRate' });
    }
    postStatus(absDrift < SYNC_PRO_SOFT_THRESHOLD_SECONDS ? 'perfect' : 'adjusting');
    return;
  }

  if (absDrift < 0.08) {
    if (lastRateSent !== 1) {
      lastRateSent = 1;
      postCommand({ type: 'command', action: 'resetPlaybackRate' });
    }
    postStatus('perfect');
    return;
  }

  const targetRate = clampPlaybackRate(1 + driftSeconds * 0.08);
  if (Math.abs(targetRate - lastRateSent) >= 0.005) {
    lastRateSent = targetRate;
    postCommand({ type: 'command', action: 'setPlaybackRate', value: targetRate });
  }

  postStatus(absDrift < 0.6 ? 'adjusting' : 'unstable');
};

self.addEventListener('message', (event: MessageEvent<WatchPartySyncWorkerInput>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      resetEngine();
      masterState = message.state || null;
      void tryLoadWasmBundle();
      setMode(message.mode);
      break;
    case 'set-mode':
      setMode(message.mode);
      break;
    case 'master-state': {
      const state = message.state;
      if (pendingSchedules.length > 0) {
        const lastScheduledAt = Math.max(...pendingSchedules.map(pending => pending.event.scheduledAt));
        // Un heartbeat émis avant l'échéance ne connaît pas encore l'action
        // explicite : il ne doit pas écraser le schedule en attente.
        if (state.updatedAt <= lastScheduledAt) break;
        // Un état plus récent décrit déjà l'action de l'hôte : les commandes
        // programmées deviennent obsolètes et doivent être annulées.
        clearPendingSchedules();
      }
      if (masterState && state.updatedAt < masterState.updatedAt) break;
      masterState = state;
      // Le chemin WASM doit recevoir les heartbeats comme le repli JS, sinon
      // sa position attendue reste figée sur le dernier snapshot reçu.
      if (wasmEngine) forwardWorkerOutputs(wasmEngine.ingest_master_state(state));
      break;
    }
    case 'local-state':
      handleLocalState(message.state);
      break;
    case 'probe-result':
      updateClockOffset(message.result);
      break;
    case 'schedule':
      handleSchedule(message.event);
      break;
    case 'reset':
      resetEngine();
      setMode('classic');
      break;
    default:
      break;
  }
});
