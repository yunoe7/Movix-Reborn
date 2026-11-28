import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_FILE = path.join(REPO, 'API', 'watchpartyAPI', 'watchparty.js');
const TMP_ROOT = path.join(os.tmpdir(), 'opencode');
const ADMIN_SECRET = 'durability-admin-secret';
const MEDIA = {
  src: 'https://example.test/video.mp4',
  title: 'Durabilité',
  mediaType: 'movie'
};

fs.mkdirSync(TMP_ROOT, { recursive: true });

const servers = [];
const sockets = [];

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await Promise.all(servers.map((server) => stopServer(server, 'SIGKILL')));
});

function newCache(t) {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'watchparty-durability-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
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

// Le patch est chargé avec --require : il observe les `sync` réels des FileHandle
// et permet de simuler ENOSPC ou un fsinc lent sans toucher au code de production.
function writePreload(cacheDir) {
  const file = path.join(cacheDir, 'test-preload.cjs');
  fs.writeFileSync(file, `
const fs = require('fs');
const open = fs.promises.open;
const op = (line) => {
  if (process.env.WP_TEST_OP_LOG) fs.appendFileSync(process.env.WP_TEST_OP_LOG, line + '\\n');
};
fs.promises.open = async function patchedOpen(target, flags, mode) {
  const name = typeof target === 'string' ? target : String(target?.path || target);
  if (name.includes('.journal.ndjson')) {
    op('open-journal:' + flags);
    const failFile = process.env.WP_TEST_FAIL_FILE;
    if (failFile && fs.existsSync(failFile)) {
      fs.unlinkSync(failFile);
      const error = new Error('No space left on device');
      error.code = 'ENOSPC';
      throw error;
    }
    const delayFile = process.env.WP_TEST_DELAY_FILE;
    if (delayFile && fs.existsSync(delayFile)) {
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.WP_TEST_DELAY_MS || 200)));
    }
    const onceFile = process.env.WP_TEST_DELAY_ONCE_FILE;
    if (onceFile && fs.existsSync(onceFile)) {
      fs.unlinkSync(onceFile);
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.WP_TEST_DELAY_MS || 200)));
    }
  }
  const handle = await open.call(fs.promises, target, flags, mode);
  if (name && typeof name === 'string') {
    const sync = handle.sync.bind(handle);
    handle.sync = async () => { op('sync:' + name); return sync(); };
  }
  return handle;
};
for (const method of ['rename', 'unlink']) {
  const original = fs.promises[method];
  fs.promises[method] = async function patched(...args) {
    op(method + ':' + args.map(String).join('->'));
    if (method === 'rename' && args.some((arg) => String(arg).includes('.processed.'))) {
      const failFile = process.env.WP_TEST_FAIL_COMPACTION_FILE;
      if (failFile && fs.existsSync(failFile)) {
        fs.unlinkSync(failFile);
        const error = new Error('No space left on device during compaction');
        error.code = 'ENOSPC';
        throw error;
      }
    }
    return original.apply(fs.promises, args);
  };
}
`);
  return file;
}

async function startServer(t, options = {}) {
  const port = await findFreePort();
  const cacheDir = options.cacheDir || newCache(t);
  const preload = options.preload ? writePreload(cacheDir) : null;
  const args = preload ? ['--require', preload, SERVER_FILE] : [SERVER_FILE];
  const child = spawn(process.execPath, args, {
    cwd: path.dirname(SERVER_FILE),
    env: {
      ...process.env,
      WATCHPARTY_PORT: String(port),
      WATCHPARTY_CACHE_DIR: cacheDir,
      WATCHPARTY_ADMIN_SECRET: ADMIN_SECRET,
      WATCHPARTY_REST_CORS_ORIGIN: 'http://127.0.0.1',
      WATCHPARTY_SOCKET_CORS_ORIGIN: 'http://127.0.0.1',
      WATCHPARTY_CORS_CREDENTIALS: 'false',
      WATCHPARTY_MAX_ROOMS_PER_IP: '100',
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });
  const server = { child, cacheDir, baseUrl: `http://127.0.0.1:${port}`, log: () => log };
  servers.push(server);

  if (options.expectFailure) {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && child.exitCode === null) await delay(25);
    assert.notEqual(child.exitCode, null, `le second processus aurait dû refuser de démarrer: ${log}`);
    return server;
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Serveur terminé: ${log}`);
    try {
      const response = await fetch(`${server.baseUrl}/api/watchparty/public`);
      if (response.ok) return server;
    } catch { /* pas encore prêt */ }
    await delay(25);
  }
  throw new Error(`Serveur trop lent: ${log}`);
}

async function stopServer(server, signal = 'SIGKILL') {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill(signal);
  await once(server.child, 'exit');
}

async function api(server, pathname, options = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${pathname} a répondu ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function allRooms(server) {
  const result = await api(server, '/api/watchparty/all', {
    headers: { 'x-admin-secret': ADMIN_SECRET }
  });
  return result.rooms;
}

async function createRoom(server, options = {}) {
  const result = await api(server, '/api/watchparty/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': options.ip || '127.0.10.1' },
    body: JSON.stringify({
      nickname: 'Hôte durabilité',
      roomName: options.roomName || 'Room durabilité',
      maxParticipants: 5,
      isPublic: false,
      syncMode: options.syncMode || 'classic',
      media: options.media || MEDIA
    })
  });
  assert.equal(result.success, true);
  return result;
}

async function joinRoom(server, roomCode, nickname = 'Invité durabilité') {
  const result = await api(server, '/api/watchparty/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.10.1.1' },
    body: JSON.stringify({ roomCode, nickname })
  });
  assert.equal(result.success, true);
  return result;
}

function openSocket(server, roomId, token, nickname) {
  const socket = io(`${server.baseUrl}/watchparty`, {
    query: { roomId, token, nickname },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000
  });
  sockets.push(socket);
  return socket;
}

async function connect(server, room, token, nickname) {
  const socket = openSocket(server, room.roomId, token, nickname);
  await Promise.all([
    waitForPredicate(socket, 'room:participants', (list) => list.some((p) => p.id === socket.id), 'participant connecté'),
    waitForEvent(socket, 'room:playback')
  ]);
  return socket;
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Événement ${event} non reçu`)); }, timeoutMs);
    const onEvent = (payload) => { cleanup(); resolve(payload); };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onEvent); };
    socket.on(event, onEvent);
  });
}

function waitForPredicate(socket, event, predicate, description, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${description} non observé`)); }, timeoutMs);
    const onEvent = (payload) => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const cleanup = () => { clearTimeout(timer); socket.off(event, onEvent); };
    socket.on(event, onEvent);
  });
}

function requestState(socket) {
  const snapshot = waitForEvent(socket, 'room:playback');
  socket.emit('playback:getState');
  return snapshot;
}

function readSnapshot(cacheDir) {
  return JSON.parse(fs.readFileSync(path.join(cacheDir, 'watchparty-rooms.json'), 'utf-8'));
}

function snapshotRoom(cacheDir, roomId) {
  return readSnapshot(cacheDir).rooms.find((room) => room.id === roomId) || null;
}

function waitForAck(socket, commandId) {
  return waitForPredicate(
    socket,
    'playback:ack',
    (ack) => ack.commandId === commandId,
    `ACK ${commandId}`
  );
}

async function prepareDemocratic({ host }) {
  const changed = waitForPredicate(
    host,
    'control:state',
    (state) => state.controlMode === 'democratic',
    'mode démocratique'
  );
  host.emit('control:setMode', { mode: 'democratic' });
  await changed;
}

async function prepareCoHost({ host, actor }) {
  const requested = waitForPredicate(
    host,
    'control:state',
    (state) => state.pendingRequests.some((request) => request.participantId === actor.id),
    'demande de contrôle'
  );
  actor.emit('control:request');
  await requested;
  const approved = waitForPredicate(
    actor,
    'control:state',
    (state) => state.coHosts.includes(actor.id),
    'promotion co-hôte'
  );
  host.emit('control:approve', { participantId: actor.id });
  await approved;
}

function roomFixture(overrides = {}) {
  const now = Date.now();
  return {
    id: 'room-durability',
    code: 'ABC234',
    name: 'Room restaurée',
    hostId: null,
    maxParticipants: 10,
    isPublic: false,
    syncMode: 'classic',
    chatEnabled: true,
    controlMode: 'host-only',
    coHosts: [],
    pendingControlRequests: [],
    readyState: {},
    pauseTimer: null,
    pauseVote: null,
    countdown: null,
    reactionCooldowns: {},
    media: { ...MEDIA },
    participants: [],
    messages: [],
    createdByIp: '127.0.0.1',
    createdAt: now - 10000,
    playbackState: { isPlaying: false, position: 0, seq: 10, mediaEpoch: 1, updatedAt: now, updatedBy: 'system' },
    playbackSeq: 10,
    mediaEpoch: 1,
    appliedCommands: {},
    hostToken: 'legacy-host-hash',
    hostTokens: { 'legacy-host-hash': true },
    accessTokens: {},
    ...overrides
  };
}

function writeFixture(cacheDir, { journalSeq = 10, savedAt = 1, room = roomFixture(), records = [] } = {}) {
  fs.writeFileSync(path.join(cacheDir, 'watchparty-rooms.json'), JSON.stringify({
    version: 3,
    savedAt,
    journalSeq,
    rooms: [room]
  }, null, 2));
  if (records.length) {
    fs.writeFileSync(
      path.join(cacheDir, 'watchparty-rooms.journal.ndjson'),
      records.map((record) => JSON.stringify(record)).join('\n') + '\n'
    );
  }
}

function journalDelta(roomId, journalSeq, ts, position, extra = {}) {
  return {
    journalSeq,
    ts,
    roomId,
    type: 'playback',
    state: { seq: journalSeq, mediaEpoch: 1, isPlaying: true, position, reason: 'seek' },
    ...extra
  };
}

test('le replay suit journalSeq, pas Date.now(), et ignore les temp files jamais renommés', async (t) => {
  const cacheDir = newCache(t);
  const room = roomFixture();
  writeFixture(cacheDir, {
    room,
    records: [
      journalDelta(room.id, 11, 5000, 11),
      journalDelta(room.id, 12, 1000, 12),
      journalDelta(room.id, 10, 9999, 99)
    ]
  });
  fs.writeFileSync(
    path.join(cacheDir, `watchparty-rooms.json.${process.pid}.unrenamed.tmp`),
    JSON.stringify({ rooms: [roomFixture({ playbackState: { position: 99 } })] })
  );

  const server = await startServer(t, { cacheDir });
  const restored = (await allRooms(server)).find((entry) => entry.id === room.id);
  assert.equal(restored.playbackState.position, 12, 'le plus grand journalSeq gagne, même avec un ts plus ancien');
  assert.equal(restored.playbackState.seq, 12);
});

test('un .processed orphelin est nettoyé au démarrage sans rejouer le journal déjà compacté', async (t) => {
  const cacheDir = newCache(t);
  const room = roomFixture();
  writeFixture(cacheDir, {
    journalSeq: 12,
    room: roomFixture({
      playbackState: { isPlaying: true, position: 12, seq: 12, mediaEpoch: 1 },
      playbackSeq: 12
    }),
    records: [journalDelta(room.id, 11, 1, 11), journalDelta(room.id, 12, 2, 12)]
  });
  const orphan = path.join(cacheDir, `watchparty-rooms.journal.ndjson.processed.4242.orphan`);
  fs.writeFileSync(orphan, journalDelta(room.id, 11, 1, 11) + '\n');

  const server = await startServer(t, { cacheDir });
  const restored = (await allRooms(server)).find((entry) => entry.id === room.id);
  assert.equal(restored.playbackState.position, 12);
  assert.equal(
    fs.readdirSync(cacheDir).some((name) => name.includes('.processed.')),
    false,
    'les fichiers .processed laissés par une rotation interrompue doivent être purgés'
  );
});

test('le journal ne contient ni token ni URL sensible et les fichiers sont restrictifs', async (t) => {
  const cacheDir = newCache(t);
  const server = await startServer(t, { cacheDir });
  const secrets = [
    'SECRET_QUERY', 'SECRET_KEY', 'POSTER_SECRET', 'NIGHT_SECRET',
    'NEXUS_SECRET', 'BRAVO_SECRET', 'MP4_SECRET', 'CAPTION_SECRET', 'CURRENT_SECRET'
  ];
  const nestedMedia = {
    ...MEDIA,
    src: `https://example.test/secret.mp4?token=${secrets[0]}&apikey=${secrets[1]}`,
    poster: `https://example.test/poster.png?token=${secrets[2]}`,
    nightflixSources: [{ src: `https://example.test/night.mp4?token=${secrets[3]}`, label: 'n' }],
    nexusSources: [{ url: `https://example.test/nexus?token=${secrets[4]}`, label: 'n' }],
    bravoSources: [{ url: `https://example.test/bravo?token=${secrets[5]}`, label: 'b' }],
    mp4Sources: [{ url: `https://example.test/direct.mp4?token=${secrets[6]}`, label: 'm' }],
    captions: [{ file: `https://example.test/fr.vtt?token=${secrets[7]}`, label: 'fr' }],
    currentNexusSource: { url: `https://example.test/current?token=${secrets[8]}`, label: 'c' }
  };
  const room = await createRoom(server, { media: nestedMedia });
  const member = await joinRoom(server, room.roomCode);
  const host = await connect(server, room, room.hostToken, 'Hôte secrets');
  const guest = await connect(server, room, member.token, 'Invité secrets');

  const updated = waitForEvent(guest, 'media:updated');
  host.emit('media:change', { ...nestedMedia, title: 'Nouveau média secret' });
  await updated;

  const journalPath = path.join(cacheDir, 'watchparty-rooms.journal.ndjson');
  const journalLines = fs.readFileSync(journalPath, 'utf-8').split('\n').filter(Boolean);
  const journalText = journalLines.join('\n');
  for (const secret of [...secrets, room.hostToken, member.token, '"src"', '"url"', '"file"', '"poster"', '"createdByIp"', '"accessTokens"', '"hostToken"']) {
    assert.equal(journalText.includes(secret), false, `le journal ne doit pas exposer ${secret}`);
  }
  for (const line of journalLines) {
    const record = JSON.parse(line);
    assert.equal(record.room?.createdByIp, undefined);
    assert.equal(record.room?.media?.src, undefined);
    assert.equal(record.room?.media?.poster, undefined);
  }

  await stopServer(server, 'SIGTERM');
  const journalFiles = fs.readdirSync(cacheDir).filter((name) => name.includes('.journal'));
  for (const file of journalFiles) {
    const text = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
    for (const secret of [...secrets, room.hostToken, member.token]) {
      assert.equal(text.includes(secret), false, `${file} expose ${secret}`);
    }
  }
  const snapshotText = fs.readFileSync(path.join(cacheDir, 'watchparty-rooms.json'), 'utf-8');
  assert.equal(snapshotText.includes(room.hostToken), false, 'le snapshot ne doit pas stocker de token en clair');
  assert.equal(snapshotText.includes(member.token), false, 'le snapshot ne doit pas stocker de token en clair');

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(cacheDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(cacheDir, 'watchparty-rooms.json')).mode & 0o777, 0o600);
    for (const file of journalFiles) {
      assert.equal(fs.statSync(path.join(cacheDir, file)).mode & 0o777, 0o600, `${file} doit être 0600`);
    }
    // Un journal hérité d'une ancienne version avec des droits larges doit être
    // renormalisé au démarrage.
    fs.chmodSync(journalPath, 0o644);
  }

  // Les tokens hachés doivent rester utilisables après un redémarrage propre.
  const restarted = await startServer(t, { cacheDir });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(journalPath).mode & 0o777, 0o600, 'le journal préexistant doit être renormalisé');
  }
  const restoredHost = await connect(restarted, room, room.hostToken, 'Hôte restauré');
  assert.ok(restoredHost.connected);
});

test('un échec de persistance obligatoire refuse la commande au lieu de l’accuser', async (t) => {
  const cacheDir = newCache(t);
  const failFile = path.join(cacheDir, 'fail-next-journal');
  const server = await startServer(t, { cacheDir, preload: true, env: { WP_TEST_FAIL_FILE: failFile } });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte persistence');

  fs.writeFileSync(failFile, '1');
  const ack = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', { commandId: 'cmd-enospc', isPlaying: true, position: 77, reason: 'seek' });
  const result = await ack;
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'PERSISTENCE_FAILED');
  assert.equal(result.durable, false, 'un ACK refusé ne doit pas être annoncé durable');

  const state = await requestState(host);
  assert.equal(state.position, 0, 'une commande non persistée ne doit pas devenir l’état autoritaire');
});

test('un heartbeat est transitoire : ACK durable:false et aucun fsync du journal', async (t) => {
  const cacheDir = newCache(t);
  const opLog = path.join(cacheDir, 'ops.log');
  const server = await startServer(t, { cacheDir, preload: true, env: { WP_TEST_OP_LOG: opLog } });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte heartbeat');
  const member = await joinRoom(server, room.roomCode, 'Invité heartbeat');
  const guest = await connect(server, room, member.token, 'Invité heartbeat');
  // Laisse les écritures déclenchées par les connexions se terminer avant de
  // mesurer les ouvertures du journal.
  await delay(150);
  fs.writeFileSync(opLog, '');

  const heartbeatAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    commandId: 'cmd-heartbeat', isPlaying: true, position: 8, reason: 'heartbeat', seq: 1
  });
  const heartbeat = await heartbeatAck;
  assert.equal(heartbeat.accepted, true);
  assert.equal(heartbeat.durable, false, 'un heartbeat ne doit pas être annoncé comme durable');
  await delay(100);
  assert.equal(fs.readFileSync(opLog, 'utf-8').includes('open-journal'), false, 'le heartbeat ne doit pas écrire dans le journal');

  const rejectedAck = waitForAck(guest, 'cmd-heartbeat-guest');
  guest.emit('playback:update', {
    commandId: 'cmd-heartbeat-guest', isPlaying: true, position: 9, reason: 'heartbeat', seq: 2
  });
  const rejected = await rejectedAck;
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.durable, false, 'un heartbeat refusé ne doit pas être annoncé durable');

  const seekAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    commandId: 'cmd-seek', isPlaying: true, position: 12, reason: 'seek', seq: 3
  });
  const seek = await seekAck;
  assert.equal(seek.durable, true);
  assert.equal(fs.readFileSync(opLog, 'utf-8').includes('open-journal'), true);
});

test('deux instances refusent de partager le même WATCHPARTY_CACHE_DIR', async (t) => {
  const cacheDir = newCache(t);
  const first = await startServer(t, { cacheDir });
  const second = await startServer(t, { cacheDir, expectFailure: true });
  assert.notEqual(second.child.exitCode, 0);
  assert.match(second.log(), /mono-instance|already running|déjà|lock/i);
  await stopServer(first, 'SIGKILL');
  // Sur Windows, SIGTERM tue brutalement le processus : le verrou peut rester,
  // mais son PID mort doit être reconnu comme périmé au démarrage suivant.
  const restarted = await startServer(t, { cacheDir });
  assert.equal(restarted.child.exitCode, null);
});

test('les mutations autoritaires sont journalisées et leurs timers restaurés', async (t) => {
  const cacheDir = newCache(t);
  const server = await startServer(t, { cacheDir });
  const room = await createRoom(server, { roomName: 'Timers' });
  const host = await connect(server, room, room.hostToken, 'Hôte timers');
  const member = await joinRoom(server, room.roomCode);
  const guest = await connect(server, room, member.token, 'Invité timers');

  const mediaUpdated = waitForEvent(guest, 'media:updated');
  host.emit('media:change', { ...MEDIA, title: 'Après mutation' });
  await mediaUpdated;

  host.emit('ready:toggle');
  guest.emit('ready:toggle');
  await waitForPredicate(host, 'ready:state', (state) => Object.values(state).every(Boolean), 'tous prêts');

  const countdown = waitForEvent(guest, 'room:countdown');
  host.emit('room:startCountdown');
  await countdown;

  const pauseTimer = waitForEvent(guest, 'pause:timerStarted');
  host.emit('pause:start', { duration: 60 });
  await pauseTimer;

  const vote = waitForEvent(guest, 'vote:started');
  guest.emit('vote:request', { duration: 60 });
  await vote;

  const journalText = fs.readFileSync(path.join(cacheDir, 'watchparty-rooms.journal.ndjson'), 'utf-8');
  for (const type of [
    'media-change', 'countdown-start', 'pause-start', 'room-created'
  ]) {
    assert.equal(journalText.includes(type), true, `le journal doit tracer ${type}`);
  }

  await stopServer(server, 'SIGKILL');
  const restarted = await startServer(t, { cacheDir });
  const restored = (await allRooms(restarted)).find((entry) => entry.id === room.roomId);
  assert.ok(restored, 'la salle doit survivre au crash');
  assert.equal(restored.media.title, 'Après mutation');
  assert.ok(restored.countdown?.startAt > Date.now(), 'le countdown actif doit être restauré');
  assert.ok(restored.pauseTimer?.endTime > Date.now(), 'le timer de pause actif doit être restauré');
  assert.ok(restored.pauseVote?.endTime > Date.now(), 'l’échéance du vote doit être restaurée');
});

test('un timer de pause restauré reprend la lecture et un vote échu est résolu', async (t) => {
  const cacheDir = newCache(t);
  const now = Date.now();
  const resumedRoom = roomFixture({
    id: 'room-resume',
    code: 'RESUME1',
    playbackState: { isPlaying: false, position: 42, seq: 10, mediaEpoch: 1 },
    pauseTimer: {
      endTime: now + 200,
      startedBy: 'old-host',
      duration: 60,
      resumeAfterPause: true
    }
  });
  const votedRoom = roomFixture({
    id: 'room-vote',
    code: 'VOTE001',
    playbackState: { isPlaying: false, position: 5, seq: 10, mediaEpoch: 1 },
    participants: [{ id: 'voter', nickname: 'Électeur', isHost: false, isActive: true, joinedAt: now - 1000 }],
    pauseVote: {
      requestedBy: 'old-guest',
      requestedByNickname: 'Invité',
      requestedDuration: 60,
      votes: { voter: true },
      endTime: now - 10,
      totalParticipants: 1
    }
  });
  writeFixture(cacheDir, { room: resumedRoom });
  fs.appendFileSync(
    path.join(cacheDir, 'watchparty-rooms.json'),
    ''
  );
  const snapshotPath = path.join(cacheDir, 'watchparty-rooms.json');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  snapshot.rooms.push(votedRoom);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  const server = await startServer(t, { cacheDir });
  await delay(500);
  const rooms = await allRooms(server);
  const resumed = rooms.find((entry) => entry.id === resumedRoom.id);
  const voted = rooms.find((entry) => entry.id === votedRoom.id);
  assert.equal(resumed.isPlaying ?? resumed.playbackState.isPlaying, true, 'la reprise automatique doit être rejouée');
  assert.equal(resumed.pauseTimer, null);
  assert.equal(voted.pauseVote, null, 'un vote échu doit être résolu au redémarrage');
  // Les participants d'avant redémarrage ont des identifiants de socket périmés :
  // le vote est résolu, mais il ne peut pas être accepté sur ces identifiants.
});

test('un fsync du répertoire suit le rename et le unlink de rotation', async (t) => {
  const cacheDir = newCache(t);
  const opLog = path.join(cacheDir, 'ops.log');
  const server = await startServer(t, { cacheDir, preload: true, env: { WP_TEST_OP_LOG: opLog } });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte fsync');
  fs.writeFileSync(opLog, '');

  // Le seuil de compaction est de 50 écritures : on le franchit pour observer
  // la rotation du journal sans dépendre d'un arrêt propre (SIGTERM sur Windows).
  for (let index = 0; index < 50; index += 1) {
    const ack = waitForEvent(host, 'playback:ack');
    host.emit('playback:update', {
      commandId: `cmd-compaction-${index}`,
      isPlaying: true,
      position: index + 1,
      reason: 'seek'
    });
    assert.equal((await ack).accepted, true);
  }
  const ops = fs.readFileSync(opLog, 'utf-8').split('\n').filter(Boolean);
  const renameIndex = ops.findIndex((line) => line.startsWith('rename:') && line.includes('.journal'));
  const unlinkIndex = ops.findIndex((line) => line.startsWith('unlink:') && line.includes('.processed'));
  assert.ok(renameIndex >= 0, 'la rotation doit renommer le journal');
  assert.ok(unlinkIndex >= renameIndex, 'le fichier processed doit être supprimé après la rotation');
  assert.ok(
    ops.some((line, index) => index > renameIndex && line === `sync:${cacheDir}`),
    'un fsync du répertoire doit suivre le rename'
  );
  assert.ok(
    ops.some((line, index) => index > unlinkIndex && line === `sync:${cacheDir}`),
    'un fsync du répertoire doit suivre le unlink'
  );
});

test('une commande en vol d’un participant expulsé est refusée sans diffusion', async (t) => {
  const cacheDir = newCache(t);
  const delayFile = path.join(cacheDir, 'delay-journal');
  const server = await startServer(t, {
    cacheDir,
    preload: true,
    env: { WP_TEST_DELAY_FILE: delayFile, WP_TEST_DELAY_MS: '250' }
  });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte kick');
  const member = await joinRoom(server, room.roomCode);
  const guest = await connect(server, room, member.token, 'Invité kick');

  const modeChanged = waitForPredicate(
    host,
    'control:state',
    (state) => state.controlMode === 'democratic',
    'mode démocratique'
  );
  host.emit('control:setMode', { mode: 'democratic' });
  await modeChanged;

  const states = [];
  host.on('playback:state', (state) => states.push(state));
  const kicked = waitForEvent(guest, 'room:kicked');
  fs.writeFileSync(delayFile, '1');
  guest.emit('playback:update', {
    commandId: 'cmd-kicked-inflight', isPlaying: true, position: 999, reason: 'seek', seq: 1
  });
  await delay(40);
  host.emit('participant:kick', { participantId: guest.id });
  await kicked;
  await delay(800);

  assert.equal(
    states.some((state) => state.position === 999),
    false,
    'une commande déjà en vol ne doit pas être diffusée après expulsion'
  );
  const finalState = await requestState(host);
  assert.equal(finalState.position, 0, 'la position du salon ne doit pas être écrasée par l’expulsé');
});

test('une compaction échouée après append reste commitée et n’est pas réappliquée', async (t) => {
  const cacheDir = newCache(t);
  const failFile = path.join(cacheDir, 'fail-compaction');
  const opLog = path.join(cacheDir, 'ops.log');
  const server = await startServer(t, {
    cacheDir,
    preload: true,
    env: { WP_TEST_FAIL_COMPACTION_FILE: failFile, WP_TEST_OP_LOG: opLog }
  });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte compaction');
  fs.writeFileSync(opLog, '');

  // Snapshot de création = 1 append ; 48 commandes portent le compteur à 49.
  for (let index = 0; index < 48; index += 1) {
    const ack = waitForEvent(host, 'playback:ack');
    host.emit('playback:update', {
      commandId: `cmd-compaction-ok-${index}`, isPlaying: true, position: index + 1, reason: 'seek'
    });
    assert.equal((await ack).accepted, true);
  }

  fs.writeFileSync(failFile, '1');
  const finalAck = waitForEvent(host, 'playback:ack');
  host.emit('playback:update', {
    commandId: 'cmd-compaction-final', isPlaying: true, position: 49, reason: 'seek'
  });
  const final = await finalAck;
  assert.equal(final.accepted, true, 'l’append réussi est le point de commit, pas la compaction');
  assert.notEqual(final.code, 'PERSISTENCE_FAILED');

  await delay(200);
  const journal = fs.readFileSync(path.join(cacheDir, 'watchparty-rooms.journal.ndjson'), 'utf-8');
  assert.equal(journal.split('cmd-compaction-final').length - 1, 1);
  assert.match(fs.readFileSync(opLog, 'utf-8'), /rename:.*\.processed\./);

  await stopServer(server, 'SIGKILL');
  const restarted = await startServer(t, { cacheDir });
  const restoredHost = await connect(restarted, room, room.hostToken, 'Hôte après compaction');
  const state = await requestState(restoredHost);
  assert.equal(state.position, 49, 'la mutation journalisée doit être rejouée une seule fois');
  assert.equal(state.commandId, 'cmd-compaction-final');
});

test('le journal de création ne contient aucune URL imbriquée ni IP client', async (t) => {
  const cacheDir = newCache(t);
  const server = await startServer(t, { cacheDir });
  const room = await createRoom(server, {
    media: {
      ...MEDIA,
      src: 'https://example.test/top.mp4?token=TOKEN_TOP',
      poster: 'https://example.test/poster.png?token=TOKEN_POSTER',
      nightflixSources: [{ src: 'https://example.test/night.mp4?token=TOKEN_NIGHT', label: 'n' }],
      nexusSources: [{ url: 'https://example.test/nexus?token=TOKEN_NEXUS', label: 'n' }],
      bravoSources: [{ url: 'https://example.test/bravo?token=TOKEN_BRAVO', label: 'b' }],
      mp4Sources: [{ url: 'https://example.test/direct.mp4?token=TOKEN_MP4', label: 'm' }],
      captions: [{ file: 'https://example.test/fr.vtt?token=TOKEN_CAPTION', label: 'fr' }],
      currentNexusSource: { url: 'https://example.test/current?token=TOKEN_CURRENT', label: 'c' }
    },
    ip: '203.0.113.77'
  });
  await delay(100);
  const journal = fs.readFileSync(path.join(cacheDir, 'watchparty-rooms.journal.ndjson'), 'utf-8');
  for (const secret of [
    'TOKEN_TOP', 'TOKEN_POSTER', 'TOKEN_NIGHT', 'TOKEN_NEXUS', 'TOKEN_BRAVO',
    'TOKEN_MP4', 'TOKEN_CAPTION', 'TOKEN_CURRENT', '203.0.113.77'
  ]) {
    assert.equal(journal.includes(secret), false, `le journal room-created ne doit pas exposer ${secret}`);
  }
  assert.equal(room.roomId.length > 0, true);
});

test('un countdown restauré survit à la connexion et déclenche toujours la lecture', async (t) => {
  const cacheDir = newCache(t);
  const server = await startServer(t, { cacheDir });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte countdown');
  const member = await joinRoom(server, room.roomCode);
  const guest = await connect(server, room, member.token, 'Invité countdown');

  host.emit('ready:toggle');
  guest.emit('ready:toggle');
  await waitForPredicate(host, 'ready:state', (state) => Object.values(state).every(Boolean), 'tous prêts');
  const started = waitForEvent(guest, 'room:countdown');
  host.emit('room:startCountdown');
  await started;

  await stopServer(server, 'SIGKILL');
  const restarted = await startServer(t, { cacheDir });
  const restoredHost = openSocket(restarted, room.roomId, room.hostToken, 'Hôte restauré');
  const restoredCountdown = await waitForEvent(restoredHost, 'room:countdown', 6000);
  assert.ok(restoredCountdown.startAt > Date.now(), 'le countdown serveur doit rester actif après connexion');

  const finished = await waitForEvent(restoredHost, 'room:countdownFinished', 7000);
  assert.ok(finished.startedAt);
  const state = await requestState(restoredHost);
  assert.equal(state.isPlaying, true, 'le scheduling restauré doit démarrer la lecture');
});

test('une fermeture refusée par la persistance ne retire pas la salle', async (t) => {
  const cacheDir = newCache(t);
  const failFile = path.join(cacheDir, 'fail-delete');
  const server = await startServer(t, { cacheDir, preload: true, env: { WP_TEST_FAIL_FILE: failFile } });
  const room = await createRoom(server);
  const host = await connect(server, room, room.hostToken, 'Hôte fermeture');

  fs.writeFileSync(failFile, '1');
  host.emit('room:close');
  await delay(250);
  const rooms = await allRooms(server);
  assert.ok(
    rooms.some((entry) => entry.id === room.roomId),
    'une suppression non persistée ne doit pas supprimer la room en mémoire'
  );
});

test('une expulsion pendant la persistance est refusée pour tous les handlers de contrôle', async (t) => {
  const cases = [
    {
      name: 'media:change',
      guestActor: true,
      forbidden: ['media:updated', 'playback:state'],
      prepare: prepareDemocratic,
      emit: (actor) => actor.emit('media:change', { ...MEDIA, title: 'Média expulsé' })
    },
    {
      name: 'room:startCountdown',
      forbidden: ['room:countdown'],
      prepare: async ({ actor, observer }) => {
        const guest = observer;
        actor.emit('ready:toggle');
        guest.emit('ready:toggle');
        await waitForPredicate(actor, 'ready:state', (state) => Object.values(state).every(Boolean), 'tous prêts');
      },
      emit: (actor) => actor.emit('room:startCountdown')
    },
    {
      name: 'room:cancelCountdown',
      forbidden: ['room:countdownCancelled'],
      prepare: async ({ actor, observer }) => {
        observer.emit('ready:toggle');
        actor.emit('ready:toggle');
        await waitForPredicate(actor, 'ready:state', (state) => Object.values(state).every(Boolean), 'tous prêts');
        const started = waitForEvent(actor, 'room:countdown');
        actor.emit('room:startCountdown');
        await started;
      },
      emit: (actor) => actor.emit('room:cancelCountdown')
    },
    {
      name: 'pause:start',
      guestActor: true,
      forbidden: ['pause:timerStarted', 'playback:state'],
      prepare: prepareCoHost,
      emit: (actor) => actor.emit('pause:start', { duration: 45 })
    },
    {
      name: 'pause:cancel',
      guestActor: true,
      forbidden: ['pause:timerCancelled', 'playback:state'],
      prepare: async ({ host, actor, observer }) => {
        await prepareCoHost({ host, actor });
        const started = waitForEvent(observer, 'pause:timerStarted');
        actor.emit('pause:start', { duration: 45 });
        await started;
      },
      emit: (actor) => actor.emit('pause:cancel')
    },
    {
      name: 'vote:request',
      guestActor: true,
      forbidden: ['vote:started'],
      emit: (actor) => actor.emit('vote:request', { duration: 45 })
    },
    {
      name: 'vote:cast',
      guestActor: true,
      forbidden: ['vote:ended'],
      prepare: async ({ server, room, actor, observer }) => {
        const voterJoined = await joinRoom(server, room.roomCode, 'Votant expulsion');
        const voter = await connect(server, room, voterJoined.token, voterJoined.nickname);
        const started = waitForEvent(observer, 'vote:started');
        voter.emit('vote:request', { duration: 45 });
        await started;
        actor.voter = voter;
      },
      emit: (actor) => actor.emit('vote:cast', { vote: true })
    }
  ];

  for (const spec of cases) {
    const cacheDir = newCache(t);
    const delayFile = path.join(cacheDir, `delay-${spec.name.replace(':', '-')}`);
    const server = await startServer(t, {
      cacheDir,
      preload: true,
      env: { WP_TEST_DELAY_ONCE_FILE: delayFile, WP_TEST_DELAY_MS: '250' }
    });
    const room = await createRoom(server, { roomName: `Expulsion ${spec.name}` });
    const host = await connect(server, room, room.hostToken, `Hôte ${spec.name}`);
    let actor = host;
    let observer = host;

    if (spec.guestActor) {
      const joined = await joinRoom(server, room.roomCode, `Acteur ${spec.name}`);
      actor = await connect(server, room, joined.token, joined.nickname);
    } else {
      const joined = await joinRoom(server, room.roomCode, `Observateur ${spec.name}`);
      observer = await connect(server, room, joined.token, joined.nickname);
    }

    if (spec.prepare) await spec.prepare({ server, room, host, actor, observer });

    const baseline = await requestState(observer);
    await delay(150);
    fs.writeFileSync(delayFile, '1');
    spec.emit(actor);
    await delay(20);

    let controller = host;
    if (spec.guestActor) {
      host.emit('participant:kick', { participantId: actor.id });
    } else {
      // Le contrôleur arrive avec le token hôte : il devient hôte et peut expulser
      // l'ancien socket pendant que sa mutation est encore en persistance.
      controller = await connect(server, room, room.hostToken, `Contrôleur ${spec.name}`);
    }

    // Les effets de la connexion du contrôleur (migration de rôle, éventuel
    // countdown annulé) ne font pas partie de la mutation en vol : on n'observe
    // qu'après cette connexion.
    const seen = [];
    const watch = [...new Set([host, observer, actor, controller])];
    for (const socket of watch) {
      for (const event of spec.forbidden) {
        socket.on(event, (payload) => seen.push({ event, payload }));
      }
    }
    if (!spec.guestActor) controller.emit('participant:kick', { participantId: actor.id });
    await delay(550);

    assert.deepEqual(seen, [], `${spec.name} ne doit pas diffuser après expulsion`);
    const finalState = await requestState(controller);
    assert.equal(finalState.seq, baseline.seq, `${spec.name} ne doit pas avancer la séquence`);
    assert.equal(finalState.position, baseline.position, `${spec.name} ne doit pas écraser la position`);
  }
});

test('un append refusé ne doit pas laisser de snapshot spéculatif ni ressusciter la mutation', async (t) => {
  const cacheDir = newCache(t);
  const failFile = path.join(cacheDir, 'fail-append');
  const server = await startServer(t, {
    cacheDir,
    preload: true,
    env: { WP_TEST_FAIL_FILE: failFile }
  });
  const room = await createRoom(server, { roomName: 'Anti snapshot fantôme' });
  const member = await joinRoom(server, room.roomCode);
  const host = await connect(server, room, room.hostToken, 'Hôte anti snapshot');
  const guest = await connect(server, room, member.token, 'Invité anti snapshot');
  await delay(150);
  const ghosts = [];
  guest.on('media:updated', (media) => ghosts.push(media));

  fs.writeFileSync(failFile, '1');
  host.emit('media:change', { ...MEDIA, title: 'Snapshot fantôme' });
  await delay(250);
  assert.equal(
    ghosts.some((media) => media.title === 'Snapshot fantôme'),
    false,
    'un append refusé ne doit pas diffuser le média'
  );
  const afterMedia = snapshotRoom(cacheDir, room.roomId);
  assert.ok(afterMedia, 'la salle doit rester dans le snapshot précédent');
  assert.notEqual(
    afterMedia.media?.title,
    'Snapshot fantôme',
    'aucun snapshot ne doit être écrit avant l’append journal'
  );
  assert.equal(afterMedia.playbackState.position, 0);

  fs.writeFileSync(failFile, '1');
  const ackPromise = waitForAck(host, 'cmd-seek-ghost');
  host.emit('playback:update', {
    commandId: 'cmd-seek-ghost', isPlaying: true, position: 777, reason: 'seek'
  });
  const ack = await ackPromise;
  assert.equal(ack.accepted, false);
  assert.equal(ack.code, 'PERSISTENCE_FAILED');
  assert.equal(ack.durable, false, 'un ACK refusé ne doit pas être durable');
  assert.notEqual(
    snapshotRoom(cacheDir, room.roomId).playbackState.position,
    777,
    'un seek refusé ne doit pas être écrit dans le snapshot'
  );

  await stopServer(server, 'SIGKILL');
  const restarted = await startServer(t, { cacheDir });
  const restoredHost = await connect(restarted, room, room.hostToken, 'Hôte restauré anti snapshot');
  const state = await requestState(restoredHost);
  assert.equal(state.position, 0, 'la mutation non commitée ne doit pas ressusciter');
  assert.notEqual(state.commandId, 'cmd-seek-ghost');
});

test('une compaction pendant une mutation en vol ne fige pas l’état spéculatif', async (t) => {
  const cacheDir = newCache(t);
  const delayFile = path.join(cacheDir, 'delay-media-pending');
  const opLog = path.join(cacheDir, 'ops.log');
  const server = await startServer(t, {
    cacheDir,
    preload: true,
    env: {
      WP_TEST_DELAY_ONCE_FILE: delayFile,
      WP_TEST_DELAY_MS: '250',
      WP_TEST_OP_LOG: opLog
    }
  });
  const roomA = await createRoom(server, { roomName: 'Room A', syncMode: 'pro' });
  const roomB = await createRoom(server, { roomName: 'Room B', syncMode: 'pro' });
  const hostA = await connect(server, roomA, roomA.hostToken, 'Hôte A');
  const hostB = await connect(server, roomB, roomB.hostToken, 'Hôte B');
  await delay(150);

  const mediaUpdated = waitForEvent(hostA, 'media:updated').catch(() => null);
  fs.writeFileSync(delayFile, '1');
  hostA.emit('media:change', { ...MEDIA, title: 'Mutation A' });

  // L'append est volontairement retardé : aucun snapshot ne doit figer cet état
  // tant que le journal n'a pas acquitté la mutation.
  await delay(60);
  assert.notEqual(
    snapshotRoom(cacheDir, roomA.roomId)?.media?.title,
    'Mutation A',
    'le snapshot ne doit pas capturer une mutation en attente de fsync'
  );
  await mediaUpdated;
  assert.equal(
    snapshotRoom(cacheDir, roomA.roomId)?.media?.title,
    'Mutation A',
    'le snapshot doit refléter la mutation après un append réussi'
  );

  // 2 créations + 1 media = 3 append ; 47 seeks portent le compteur à 50 et
  // déclenchent la compaction depuis une autre room.
  for (let index = 0; index < 47; index += 1) {
    const ack = waitForAck(hostB, `cmd-b-${index}`);
    hostB.emit('playback:update', {
      commandId: `cmd-b-${index}`, isPlaying: true, position: index + 1, reason: 'seek'
    });
    assert.equal((await ack).accepted, true);
  }

  assert.match(fs.readFileSync(opLog, 'utf-8'), /rename:.*\.processed\./, 'la compaction doit avoir tourné');
  assert.equal(snapshotRoom(cacheDir, roomA.roomId)?.media?.title, 'Mutation A');
  assert.equal(snapshotRoom(cacheDir, roomB.roomId)?.playbackState.position, 47);

  await stopServer(server, 'SIGKILL');
  const restarted = await startServer(t, { cacheDir });
  const restoredA = await connect(restarted, roomA, roomA.hostToken, 'Hôte A restauré');
  const restoredB = await connect(restarted, roomB, roomB.hostToken, 'Hôte B restauré');
  assert.equal((await requestState(restoredA)).position, 0, 'le média réinitialise la lecture A');
  assert.equal((await requestState(restoredA)).mediaEpoch, 2);
  assert.equal((await requestState(restoredB)).position, 47, 'le journal rejoue les commandes B');
});

test('un seek en attente est supplanté par un media:change sans schedule périmé', async (t) => {
  const cacheDir = newCache(t);
  const delayFile = path.join(cacheDir, 'delay-seek-media');
  const server = await startServer(t, {
    cacheDir,
    preload: true,
    env: { WP_TEST_DELAY_ONCE_FILE: delayFile, WP_TEST_DELAY_MS: '250' }
  });
  const room = await createRoom(server, { roomName: 'Race seek média', syncMode: 'pro' });
  const member = await joinRoom(server, room.roomCode, 'Observateur race');
  const host = await connect(server, room, room.hostToken, 'Hôte race');
  const guest = await connect(server, room, member.token, 'Observateur race');

  const schedules = [];
  const states = [];
  for (const socket of [host, guest]) {
    socket.on('playback:schedule', (event) => schedules.push(event));
    socket.on('playback:state', (state) => states.push(state));
  }

  fs.writeFileSync(delayFile, '1');
  const ackPromise = waitForAck(host, 'cmd-seek-superseded');
  host.emit('playback:update', {
    commandId: 'cmd-seek-superseded', isPlaying: true, position: 321, reason: 'seek'
  });
  await delay(20);
  const mediaUpdated = waitForEvent(guest, 'media:updated').catch(() => null);
  host.emit('media:change', { ...MEDIA, title: 'Media après seek' });

  const ack = await ackPromise;
  await mediaUpdated;
  assert.equal(ack.accepted, false, 'le seek en vol doit être supplanté par le changement de média');
  assert.equal(ack.code, 'SUPERSEDED');
  assert.equal(ack.durable, false);
  await mediaUpdated;
  await delay(350);

  assert.equal(
    schedules.some((event) => event.position === 321 || event.seq === ack.seq),
    false,
    'aucun schedule du média précédent ne doit être diffusé'
  );
  assert.equal(
    states.some((state) => state.position === 321 && state.commandId === 'cmd-seek-superseded'),
    false,
    'aucun état du seek supplanté ne doit être diffusé'
  );
});

