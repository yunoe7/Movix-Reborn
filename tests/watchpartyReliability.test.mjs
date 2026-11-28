import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = path.join(repo, 'API', 'watchpartyAPI', 'watchparty.js');
const artifactDir = path.join(os.tmpdir(), 'opencode', 'watchparty-reliability');
const cacheDir = path.join(artifactDir, 'cache');
const MEDIA = {
  src: 'https://example.test/reliability.mp4',
  title: 'Reliability media',
  mediaType: 'movie'
};
const OTHER_MEDIA = {
  src: 'https://example.test/other.mp4',
  title: 'Other media',
  mediaType: 'movie'
};

let baseUrl;
let child;
let serverLog = '';
let ipCounter = 0;
const sockets = [];

function nextClientIp() {
  ipCounter += 1;
  return `127.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.9`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function startServer() {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverLog = '';
  child = spawn(process.execPath, [serverFile], {
    cwd: path.dirname(serverFile),
    env: {
      ...process.env,
      WATCHPARTY_PORT: String(port),
      WATCHPARTY_CACHE_DIR: cacheDir,
      WATCHPARTY_REST_CORS_ORIGIN: 'http://127.0.0.1',
      WATCHPARTY_SOCKET_CORS_ORIGIN: 'http://127.0.0.1',
      WATCHPARTY_CORS_CREDENTIALS: 'false',
      WATCHPARTY_MAX_ROOMS_PER_IP: '50'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Serveur terminé: ${serverLog}`);
    try {
      const response = await fetch(`${baseUrl}/api/watchparty/public`);
      if (response.ok) return;
    } catch { /* pas encore prêt */ }
    await delay(50);
  }
  throw new Error(`Serveur trop lent: ${serverLog}`);
}

async function stopServer(signal = 'SIGKILL') {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  await once(child, 'exit');
  child = null;
}

async function api(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${pathname} a répondu ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createRoom(options = {}) {
  return api('/api/watchparty/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextClientIp() },
    body: JSON.stringify({
      nickname: 'Hôte fiabilité',
      roomName: options.roomName || 'Room fiabilité',
      maxParticipants: 5,
      isPublic: false,
      syncMode: options.syncMode || 'classic',
      media: options.media || MEDIA
    })
  });
}

async function joinRoom(roomCode, nickname) {
  return api('/api/watchparty/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextClientIp() },
    body: JSON.stringify({ roomCode, nickname })
  });
}

function openSocket(roomId, token, nickname) {
  const socket = io(`${baseUrl}/watchparty`, {
    query: { roomId, token, nickname },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000
  });
  sockets.push(socket);
  return socket;
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Événement ${event} non reçu dans les ${timeoutMs} ms`));
    }, timeoutMs);
    const onEvent = (payload) => { cleanup(); resolve(payload); };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onEvent); };
    socket.on(event, onEvent);
  });
}

function waitForPredicate(socket, event, predicate, description, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${description} non observé dans les ${timeoutMs} ms`));
    }, timeoutMs);
    const onEvent = (payload) => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onEvent); };
    socket.on(event, onEvent);
  });
}

async function connectParticipant(room, token, nickname) {
  const socket = openSocket(room.roomId, token, nickname);
  const ready = waitForPredicate(
    socket,
    'room:participants',
    (list) => list.some((participant) => participant.id === socket.id),
    'participant connecté'
  );
  const playback = waitForEvent(socket, 'room:playback');
  await Promise.all([ready, playback]);
  return socket;
}

function requestState(socket) {
  const snapshot = waitForEvent(socket, 'room:playback');
  socket.emit('playback:getState');
  return snapshot;
}

before(async () => {
  fs.mkdirSync(cacheDir, { recursive: true });
  await startServer();
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await stopServer('SIGKILL');
});

test('une commande confirmée survit à un crash brutal du serveur', async () => {
  const room = await createRoom({ roomName: 'Crash brutal' });
  const host = await connectParticipant(room, room.hostToken, 'Hôte crash');

  const ack = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: true,
    position: 42,
    reason: 'seek',
    commandId: 'cmd-crash',
    seq: 2
  });
  await ack;

  // Le snapshot demandé au serveur sert d'accusé de réception observable.
  const beforeCrash = await requestState(host);
  assert.equal(beforeCrash.position, 42);

  await stopServer('SIGKILL');
  await startServer();

  const restoredHost = await connectParticipant(room, room.hostToken, 'Hôte crash');
  const restored = await requestState(restoredHost);
  assert.equal(restored.position, 42);
  assert.equal(restored.isPlaying, true);
});

test('les commandes sont arbitrées par séquence, accusées et idémpotentes', async () => {
  const room = await createRoom({ roomName: 'Arbitrage séquence' });
  const host = await connectParticipant(room, room.hostToken, 'Hôte séquence');
  const joined = await joinRoom(room.roomCode, 'Invité séquence');
  const guest = await connectParticipant(room, joined.token, 'Invité séquence');
  const guestStates = [];
  guest.on('playback:state', (state) => guestStates.push(state));

  const firstAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: true, position: 10, reason: 'play', commandId: 'cmd-1', seq: 1
  });
  const first = await firstAck;
  assert.equal(first.commandId, 'cmd-1');
  assert.equal(first.accepted, true);

  const newerAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: false, position: 20, reason: 'pause', commandId: 'cmd-3', seq: 3
  });
  await newerAck;

  const staleAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: true, position: 15, reason: 'seek', commandId: 'cmd-2', seq: 2
  });
  const stale = await staleAck;
  assert.equal(stale.accepted, false);

  const duplicateAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: true, position: 99, reason: 'seek', commandId: 'cmd-3', seq: 3
  });
  const duplicate = await duplicateAck;
  assert.equal(duplicate.accepted, false);

  const final = await requestState(host);
  assert.equal(final.seq, 3);
  assert.equal(final.position, 20);
  assert.equal(final.isPlaying, false);
  assert.equal(guestStates.filter((state) => state.position === 15 || state.position === 99).length, 0);
});

test('un événement ended force la pause même si le lecteur annonce encore la lecture', async () => {
  const room = await createRoom({ roomName: 'Fin de lecture' });
  const host = await connectParticipant(room, room.hostToken, 'Hôte ended');
  const ack = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: true, position: 30, reason: 'ended', commandId: 'cmd-ended', seq: 1
  });
  await ack;

  const state = await requestState(host);
  assert.equal(state.isPlaying, false);
  assert.equal(state.reason, 'ended');
});

test('un changement de média annule les schedules Pro en attente', async () => {
  const room = await createRoom({ roomName: 'Changement de média' });
  const host = await connectParticipant(room, room.hostToken, 'Hôte média');
  const joined = await joinRoom(room.roomCode, 'Invité média');
  const guest = await connectParticipant(room, joined.token, 'Invité média');

  // Le mode Pro est une décision de l'hôte pendant la session : on vérifie
  // aussi que le basculement est réellement notifié aux participants.
  const modeChanged = waitForEvent(guest, 'sync:modeChanged');
  host.emit('sync:setMode', { mode: 'pro' });
  await modeChanged;

  const schedules = [];
  guest.on('playback:schedule', (schedule) => schedules.push(schedule));
  const scheduleAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    isPlaying: false, position: 100, reason: 'seek', commandId: 'cmd-schedule', seq: 1
  });
  await scheduleAck;
  await waitForPredicate(guest, 'playback:schedule', () => true, 'schedule Pro initial');

  const cancelled = waitForEvent(guest, 'playback:scheduleCancelled');
  host.emit('media:change', OTHER_MEDIA);
  const cancellation = await cancelled;
  assert.equal(cancellation.reason, 'media-changed');
  assert.equal(cancellation.mediaEpoch, 2);

  const countAtCancellation = schedules.length;
  await delay(450);
  assert.equal(schedules.length, countAtCancellation);

  const state = await requestState(host);
  assert.equal(state.position, 0);
  assert.equal(state.isPlaying, false);
  assert.equal(state.mediaEpoch, 2);
});
