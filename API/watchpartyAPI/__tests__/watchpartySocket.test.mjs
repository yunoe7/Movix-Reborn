import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

// Le serveur WatchParty n'avait aucun test : une erreur au moment de la
// connexion Socket.IO passait inaperçue car le handler global `uncaughtException`
// empêche le processus de mourir. Ces tests exercent le vrai serveur et le vrai
// namespace /watchparty, pas une copie de sa logique.
const SERVER_FILE = process.env.WATCHPARTY_TEST_SERVER
  ? path.resolve(process.env.WATCHPARTY_TEST_SERVER)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'watchparty.js');
const MEDIA = {
  src: 'https://example.test/video.mp4',
  title: 'WatchParty test media',
  mediaType: 'movie'
};

let child;
let baseUrl;
let serverLog = '';
let clientIpCounter = 0;

// Chaque salon de test est attribué à une IP distincte : les limites anti-abus
// du serveur ne doivent pas transformer un scénario de création en 429.
function nextClientIp() {
  clientIpCounter += 1;
  return `127.${Math.floor(clientIpCounter / 250)}.${clientIpCounter % 250}.1`;
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function trackSocket(t, socket) {
  t.after(() => socket.disconnect());
  return socket;
}

function closeRoom(t, room, getHostSocket) {
  t.after(async () => {
    const host = getHostSocket();
    if (host?.connected) host.emit('room:close');
    // Laisse le serveur traiter la fermeture avant de couper le transport.
    await delay(50);
    host?.disconnect();
  });
  return room;
}

async function api(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${pathname} a répondu ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createRoom(t, options = {}) {
  const room = await api('/api/watchparty/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextClientIp() },
    body: JSON.stringify({
      nickname: options.nickname || 'Hôte test',
      roomName: options.roomName || 'Room test',
      maxParticipants: 5,
      isPublic: options.isPublic === true,
      syncMode: options.syncMode || 'classic',
      media: options.media || MEDIA
    })
  });
  assert.equal(room.success, true);
  return room;
}

async function joinRoom(roomCode, nickname) {
  const joined = await api('/api/watchparty/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextClientIp() },
    body: JSON.stringify({ roomCode, nickname })
  });
  assert.equal(joined.success, true);
  return joined;
}

function openSocket(roomId, token, nickname) {
  return io(`${baseUrl}/watchparty`, {
    query: { roomId, token, nickname },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000
  });
}

function connectSocket(t, roomId, token, nickname) {
  return trackSocket(t, openSocket(roomId, token, nickname));
}

async function connectHost(t, options = {}) {
  const room = await createRoom(t, options);
  const ctx = { room, socket: openSocket(room.roomId, room.hostToken, room.nickname) };
  closeRoom(t, room, () => ctx.socket);
  const socket = ctx.socket;
  const [participants, playback] = await Promise.all([
    waitForPredicate(
      socket,
      'room:participants',
      (list) => list.some((participant) => participant.id === socket.id && participant.isHost),
      'la liste des participants avec l’hôte connecté'
    ),
    waitForEvent(socket, 'room:playback')
  ]);
  assert.equal(playback.isPlaying, false);
  assert.equal(playback.position, 0);
  return { room, socket, participants, ctx };
}

async function connectMember(t, room) {
  const joined = await joinRoom(room.roomCode, 'Invité test');
  const socket = connectSocket(t, room.roomId, joined.token, joined.nickname);
  const [participants, playback] = await Promise.all([
    waitForPredicate(
      socket,
      'room:participants',
      (list) => list.length === 2 && list.some((participant) => participant.id === socket.id),
      'la liste des participants avec l’invité connecté'
    ),
    waitForEvent(socket, 'room:playback')
  ]);
  return { joined, socket, participants, playback };
}

function requestPlaybackState(socket) {
  const snapshot = waitForEvent(socket, 'room:playback');
  socket.emit('playback:getState');
  return snapshot;
}

// Le lobby n'a pas de token de salle : il se connecte à un namespace distinct
// et doit recevoir un snapshot complet à chaque changement de visibilité.
async function connectLobbySocket(t) {
  const socket = io(`${baseUrl}/watchparty-lobby`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000
  });
  trackSocket(t, socket);
  socket.snapshots = [];
  socket.on('lobby:rooms', (rooms) => {
    if (Array.isArray(rooms)) socket.snapshots.push(rooms);
  });
  const first = await waitForEvent(socket, 'lobby:rooms');
  assert.ok(Array.isArray(first));
  return socket;
}

// Les snapshots déjà reçus doivent compter : un salon créé pendant que le
// client attendait sa connexion ne doit pas être perdu par le test.
function waitForLobbySnapshot(socket, predicate, description, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${description} non observé dans les ${timeoutMs} ms`));
    }, timeoutMs);
    const check = () => {
      const found = socket.snapshots.find(predicate);
      if (!found) return;
      cleanup();
      resolve(found);
    };
    const onEvent = () => check();
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('lobby:rooms', onEvent);
    };
    socket.on('lobby:rooms', onEvent);
    check();
  });
}

function roomIsInLobby(snapshot, roomId) {
  return snapshot.some((room) => room.id === roomId);
}

before(async () => {
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER_FILE], {
    cwd: path.dirname(SERVER_FILE),
    env: {
      ...process.env,
      WATCHPARTY_PORT: String(port),
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
    if (child.exitCode !== null) throw new Error(`Serveur WatchParty terminé: ${serverLog}`);
    try {
      const response = await fetch(`${baseUrl}/api/watchparty/public`);
      if (response.ok) return;
    } catch { /* serveur pas encore prêt */ }
    await delay(50);
  }
  throw new Error(`Serveur WatchParty démarré trop lentement: ${serverLog}`);
});

after(() => {
  // SIGKILL évite d'écraser le cache de rooms de développement avec des rooms de test.
  if (child && child.exitCode === null) child.kill('SIGKILL');
});

test('un hôte et un invité se connectent et reçoivent l’état initial de la room', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member, playback } = await connectMember(t, room);

  assert.equal(member.connected, true);
  assert.equal(host.connected, true);
  assert.equal(playback.isPlaying, false);
  assert.equal(playback.position, 0);
});

test('la lecture, la pause et les heartbeats de l’hôte sont diffusés aux invités', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);
  const received = [];
  member.on('playback:state', (state) => received.push(state));

  host.emit('playback:update', { isPlaying: true, position: 12, reason: 'play' });
  const playing = await waitForPredicate(
    member,
    'playback:state',
    (state) => state.isPlaying && state.position === 12,
    'la lecture à 12s chez l’invité'
  );
  assert.equal(playing.reason, 'play');

  host.emit('playback:update', { isPlaying: true, position: 20, reason: 'heartbeat' });
  await waitForPredicate(
    member,
    'playback:state',
    (state) => state.isPlaying && state.position === 20,
    'le heartbeat à 20s chez l’invité'
  );

  host.emit('playback:update', { isPlaying: false, position: 20, reason: 'pause' });
  await waitForPredicate(
    member,
    'playback:state',
    (state) => !state.isPlaying && state.position === 20,
    'la pause chez l’invité'
  );
  assert.ok(received.length >= 3);
});

test('un invité ne peut ni piloter la lecture ni changer le mode de synchronisation', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);
  const states = [];
  const modeChanges = [];
  member.on('playback:state', (state) => states.push(state));
  member.on('sync:modeChanged', (change) => modeChanges.push(change));

  member.emit('playback:update', { isPlaying: true, position: 99, reason: 'play' });
  member.emit('sync:setMode', { mode: 'pro' });
  await delay(200);

  assert.deepEqual(states, [], 'une commande de lecture d’invité ne doit pas être diffusée');
  assert.deepEqual(modeChanges, [], 'un invité ne doit pas changer le mode de sync');

  const snapshot = await requestPlaybackState(host);
  assert.equal(snapshot.isPlaying, false);
  assert.equal(snapshot.position, 0);
});

test('un changement de média réinitialise la lecture et les états de préparation', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);

  const ready = waitForEvent(member, 'ready:state');
  const updated = waitForEvent(member, 'media:updated');
  const playback = waitForPredicate(
    member,
    'playback:state',
    (state) => !state.isPlaying && state.position === 0,
    'la lecture réinitialisée après changement de média'
  );
  host.emit('media:change', { ...MEDIA, title: 'Episode 2' });

  const [readyState, media, state] = await Promise.all([ready, updated, playback]);
  assert.deepEqual(readyState, {});
  assert.equal(media.title, 'Episode 2');
  assert.equal(state.position, 0);
});

test('Sync Pro : l’hôte peut activer le mode pro et ses commandes produisent un schedule', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);
  const modeChanges = [];
  member.on('sync:modeChanged', (change) => modeChanges.push(change));

  const modeChanged = waitForPredicate(
    member,
    'sync:modeChanged',
    (change) => change.mode === 'pro',
    'l’activation de Sync Pro chez l’invité'
  );
  const scheduled = waitForEvent(member, 'playback:schedule');
  host.emit('sync:setMode', { mode: 'pro' });
  await modeChanged;
  host.emit('playback:update', { isPlaying: true, position: 42, reason: 'play' });

  const event = await scheduled;
  assert.equal(event.action, 'play');
  assert.equal(event.position, 42);
  assert.ok(event.scheduledAt > event.serverNow, 'le schedule doit être dans le futur');

  const backToClassic = waitForPredicate(
    member,
    'sync:modeChanged',
    (change) => change.mode === 'classic',
    'le retour en sync classique chez l’invité'
  );
  host.emit('sync:setMode', { mode: 'classic' });
  await backToClassic;
  assert.equal(modeChanges.length, 2);
});

test('un hôte qui se reconnecte pendant le délai de grâce conserve son rôle', async (t) => {
  const { room, socket: host, ctx } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);

  host.emit('playback:update', { isPlaying: true, position: 30, reason: 'play' });
  await waitForPredicate(member, 'playback:state', (state) => state.position === 30, 'la position 30s chez l’invité');

  const memberAlone = waitForPredicate(
    member,
    'room:participants',
    (list) => list.length === 1 && list.every((participant) => !participant.isHost),
    'la déconnexion de l’hôte sans transfert immédiat'
  );
  host.disconnect();
  await memberAlone;

  const reconnected = openSocket(room.roomId, room.hostToken, room.nickname);
  ctx.socket = reconnected;
  const [participants, snapshot] = await Promise.all([
    waitForPredicate(
      reconnected,
      'room:participants',
      (list) => list.some((participant) => participant.id === reconnected.id && participant.isHost),
      'la récupération du rôle hôte après reconnexion'
    ),
    waitForEvent(reconnected, 'room:playback')
  ]);
  assert.equal(participants.length, 2);
  assert.equal(snapshot.position, 30);

  member.emit('playback:update', { isPlaying: true, position: 999, reason: 'heartbeat' });
  await delay(200);
  const afterHeartbeat = await requestPlaybackState(reconnected);
  assert.equal(afterHeartbeat.position, 30, 'un heartbeat d’invité ne doit pas écraser la position de l’hôte');
});

test('un token invalide est rejeté sans inscrire le participant', async (t) => {
  const { room } = await connectHost(t);
  const intruder = connectSocket(t, room.roomId, 'not-a-valid-token', 'Intrus');
  const error = await waitForEvent(intruder, 'error');
  assert.match(error.message, /Unauthorized/);
});

test('un appui sur « prêt » ne bascule qu’une seule fois', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);
  const updates = [];
  member.on('ready:state', (state) => updates.push(state));

  const changed = waitForPredicate(
    host,
    'ready:state',
    (state) => state[member.id] === true,
    'la préparation de l’invité vue par l’hôte'
  );
  member.emit('ready:toggle');
  await changed;
  await delay(200);

  const values = updates.map(state => state[member.id]);
  assert.ok(values.length > 0, 'l’invité doit recevoir son propre état de préparation');
  assert.equal(values.at(-1), true, 'l’état final doit rester « prêt »');
  assert.equal(values.filter(value => value === true).length, 1, 'un seul appui ne doit produire qu’un passage à « prêt »');
});

test('un changement de média annule un vote de pause en cours', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const { socket: member, joined } = await connectMember(t, room);

  const started = waitForEvent(host, 'vote:started');
  member.emit('vote:request', { duration: 30 });
  await started;

  const before = await api(`/api/watchparty/room/${room.roomId}`, {
    headers: { 'x-watchparty-token': joined.token }
  });
  assert.ok(before.room.pauseVote, 'un vote doit être en cours avant le changement de média');

  const updated = waitForEvent(member, 'media:updated');
  host.emit('media:change', { ...MEDIA, title: 'Nouveau média' });
  await updated;

  const after = await api(`/api/watchparty/room/${room.roomId}`, {
    headers: { 'x-watchparty-token': joined.token }
  });
  assert.equal(after.room.pauseVote, null, 'le vote ne doit pas survivre au changement de média');
});

test('un hôte seul qui se déconnecte ne laisse pas un hostId mort dans la room', async (t) => {
  const { room, socket: host } = await connectHost(t);
  host.disconnect();
  await delay(100);

  const joined = await joinRoom(room.roomCode, 'Nouveau participant');
  const state = await api(`/api/watchparty/room/${room.roomId}`, {
    headers: { 'x-watchparty-token': joined.token }
  });
  assert.equal(state.room.hostId, null, 'aucun identifiant de socket déconnecté ne doit rester comme hôte');

  const member = connectSocket(t, room.roomId, joined.token, joined.nickname);
  const participants = await waitForPredicate(
    member, 'room:participants', list => list.length === 1, 'le nouveau participant connecté',
  );
  assert.equal(participants.length, 1);
});

test('le créateur devient hôte dès sa connexion avec le token renvoyé par /create', async (t) => {
  const room = await createRoom(t);
  const ctx = { socket: null };
  closeRoom(t, room, () => ctx.socket);

  // État brut renvoyé par le REST avant la connexion : personne n'est encore
  // dans la room, exactement comme au retour du formulaire de création.
  const before = await api(`/api/watchparty/room/${room.roomId}`, {
    headers: { 'x-watchparty-token': room.hostToken }
  });
  assert.equal(before.room.hostId, null);
  assert.equal(before.room.participants.length, 0);

  const socket = openSocket(room.roomId, room.hostToken, room.nickname);
  ctx.socket = socket;
  trackSocket(t, socket);

  const [info, participants, playback] = await Promise.all([
    waitForEvent(socket, 'room:info'),
    waitForEvent(socket, 'room:participants'),
    waitForEvent(socket, 'room:playback')
  ]);

  assert.equal(info.hostId, socket.id, 'room:info doit attribuer hostId au socket du créateur');
  assert.equal(info.participants.length, 1, 'le créateur doit apparaître dans la liste');
  assert.equal(info.participants[0].nickname, room.nickname);
  assert.equal(info.participants[0].isHost, true);
  assert.equal(participants[0].id, socket.id);
  assert.equal(participants[0].isHost, true, 'le créateur doit être marqué isHost');
  assert.equal(playback.isPlaying, false);
});

test('un second participant reste invité et il n’y a qu’un seul hôte', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const hostViewPromise = waitForPredicate(
    host,
    'room:participants',
    (list) => list.length === 2
      && list.find((person) => person.id === host.id)?.isHost === true
      && list.find((person) => person.id === member.id)?.isHost === false,
    'la vue hôte avec un invité non hôte',
  );
  const { socket: member, participants: memberView } = await connectMember(t, room);
  const hostView = await hostViewPromise;

  assert.equal(hostView.find((person) => person.id === member.id)?.isHost, false);
  assert.equal(memberView.find((person) => person.id === host.id)?.isHost, true);
  assert.equal(memberView.filter((person) => person.isHost).length, 1);
});

test('un rafraîchissement ou une reconnexion du propriétaire conserve un seul hôte', async (t) => {
  const { room, socket: host, ctx } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);

  host.disconnect();
  await delay(75);

  const refreshed = openSocket(room.roomId, room.hostToken, room.nickname);
  ctx.socket = refreshed;
  trackSocket(t, refreshed);

  const [info, participants] = await Promise.all([
    waitForPredicate(refreshed, 'room:info', (state) => state.hostId === refreshed.id, 'le hostId après reconnexion'),
    waitForPredicate(
      refreshed,
      'room:participants',
      (list) => list.length === 2 && list.some((person) => person.id === refreshed.id && person.isHost),
      'le créateur reconnecté comme hôte',
    )
  ]);

  assert.equal(info.participants.filter((person) => person.isHost).length, 1);
  assert.equal(participants.filter((person) => person.isHost).length, 1);
  assert.equal(participants.find((person) => person.id === member.id)?.isHost, false);

  refreshed.disconnect();
  await delay(75);
  const reconnected = openSocket(room.roomId, room.hostToken, room.nickname);
  ctx.socket = reconnected;
  trackSocket(t, reconnected);
  const state = await waitForPredicate(
    reconnected,
    'room:info',
    (value) => value.hostId === reconnected.id,
    'le hostId après une seconde reconnexion',
  );
  assert.equal(state.participants.filter((person) => person.isHost).length, 1);
});

test('des salons successifs ont chacun leur propre hôte, y compris après fermeture', async (t) => {
  const first = await createRoom(t);
  const firstCtx = { socket: null };
  closeRoom(t, first, () => firstCtx.socket);
  const firstSocket = openSocket(first.roomId, first.hostToken, first.nickname);
  firstCtx.socket = firstSocket;
  trackSocket(t, firstSocket);
  const firstView = await waitForPredicate(
    firstSocket,
    'room:participants',
    (list) => list.length === 1 && list[0].id === firstSocket.id && list[0].isHost,
    'le premier salon a son hôte',
  );
  assert.equal(firstView.length, 1);

  const second = await createRoom(t);
  const secondCtx = { socket: null };
  closeRoom(t, second, () => secondCtx.socket);
  const secondSocket = openSocket(second.roomId, second.hostToken, second.nickname);
  secondCtx.socket = secondSocket;
  trackSocket(t, secondSocket);
  const [secondInfo, secondView] = await Promise.all([
    waitForEvent(secondSocket, 'room:info'),
    waitForPredicate(
      secondSocket,
      'room:participants',
      (list) => list.length === 1 && list[0].id === secondSocket.id && list[0].isHost,
      'le second salon a son propre hôte',
    )
  ]);
  assert.equal(secondInfo.hostId, secondSocket.id);
  assert.notEqual(secondSocket.id, firstSocket.id);
  assert.notEqual(second.hostToken, first.hostToken);

  const closed = waitForEvent(firstSocket, 'room:closed');
  firstSocket.emit('room:close');
  await closed;

  const third = await createRoom(t);
  const thirdCtx = { socket: null };
  closeRoom(t, third, () => thirdCtx.socket);
  const thirdSocket = openSocket(third.roomId, third.hostToken, third.nickname);
  thirdCtx.socket = thirdSocket;
  trackSocket(t, thirdSocket);
  const thirdInfo = await waitForPredicate(
    thirdSocket,
    'room:info',
    (state) => state.hostId === thirdSocket.id && state.participants.length === 1,
    'un nouveau salon après fermeture a son hôte',
  );
  assert.equal(thirdInfo.participants[0].isHost, true);
});

test('un salon créé public est visible immédiatement dans le lobby d’un autre client', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room } = await connectHost(t, { isPublic: true, roomName: 'Public depuis la création' });

  // La route REST doit rester la source de vérité pour un client qui arrive.
  const publicResponse = await fetch(`${baseUrl}/api/watchparty/public`);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  const listing = await publicResponse.json();
  assert.equal(roomIsInLobby(listing.rooms, room.roomId), true);
  const info = await api(`/api/watchparty/info/${room.roomCode}`);
  assert.equal(info.room.isPublic, true);

  // Le lobby déjà ouvert doit recevoir le même état sans cliquer sur Rafraîchir.
  const snapshot = await waitForLobbySnapshot(
    lobby,
    (rooms) => roomIsInLobby(rooms, room.roomId),
    'le salon public dans le lobby connecté'
  );
  assert.equal(snapshot.find((entry) => entry.id === room.roomId).title, 'Public depuis la création');
});

test('un salon privé reste invisible dans le lobby', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room } = await connectHost(t, { roomName: 'Salon privé' });

  const info = await api(`/api/watchparty/info/${room.roomCode}`);
  assert.equal(info.room.isPublic, false);
  const listing = await api('/api/watchparty/public');
  assert.equal(roomIsInLobby(listing.rooms, room.roomId), false);

  await waitForLobbySnapshot(lobby, (rooms) => rooms.length >= 0, 'un snapshot après création privée');
  assert.ok(lobby.snapshots.every((rooms) => !roomIsInLobby(rooms, room.roomId)));
});

test('rendre un salon public depuis la salle le diffuse immédiatement au lobby', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room, socket: host } = await connectHost(t, { roomName: 'Privé puis public' });
  const before = await api('/api/watchparty/public');
  assert.equal(roomIsInLobby(before.rooms, room.roomId), false);

  host.emit('room:setVisibility', { isPublic: true });
  const snapshot = await waitForLobbySnapshot(
    lobby,
    (rooms) => roomIsInLobby(rooms, room.roomId),
    'le basculement public dans le lobby connecté'
  );
  const info = await api(`/api/watchparty/info/${room.roomCode}`);
  assert.equal(info.room.isPublic, true);
  assert.equal(snapshot.find((entry) => entry.id === room.roomId).title, 'Privé puis public');
});

test('un invité ne peut pas rendre un salon public', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room, socket: host } = await connectHost(t);
  const { socket: member } = await connectMember(t, room);

  const denied = waitForEvent(member, 'error');
  member.emit('room:setVisibility', { isPublic: true });
  const error = await denied;
  assert.match(error.message, /hôte|host|autoris/i);

  await waitForLobbySnapshot(lobby, (rooms) => rooms.length >= 0, 'un snapshot après tentative non autorisée');
  assert.ok(lobby.snapshots.every((rooms) => !roomIsInLobby(rooms, room.roomId)));
  assert.equal(host.connected, true);
});

test('la fermeture d’un salon public le retire du lobby connecté', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room, socket: host } = await connectHost(t, { isPublic: true });
  await waitForLobbySnapshot(
    lobby,
    (rooms) => roomIsInLobby(rooms, room.roomId),
    'le salon ouvert dans le lobby'
  );

  host.emit('room:close');
  const snapshot = await waitForLobbySnapshot(
    lobby,
    (rooms) => !roomIsInLobby(rooms, room.roomId),
    'la disparition du salon après fermeture'
  );
  assert.equal(roomIsInLobby(snapshot, room.roomId), false);
});


test('un salon public reste listé et son compteur se met à jour après connexion de l’hôte', async (t) => {
  const lobby = await connectLobbySocket(t);
  const { room } = await connectHost(t, { isPublic: true });

  const snapshot = await waitForLobbySnapshot(
    lobby,
    (rooms) => rooms.some((entry) => entry.id === room.roomId && entry.participantCount === 1),
    'le salon public avec son hôte connecté'
  );
  assert.ok(roomIsInLobby(snapshot, room.roomId));

  const publicRooms = await api('/api/watchparty/public');
  const listed = publicRooms.rooms.find((entry) => entry.id === room.roomId);
  assert.ok(listed, 'la route REST doit retourner le salon public');
  assert.equal(listed.participantCount, 1);
});

test('trois participants : kick avec révocation de token puis départ du dernier invité', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const first = await connectMember(t, room);

  const secondJoined = await joinRoom(room.roomCode, 'Invité 2');
  const second = connectSocket(t, room.roomId, secondJoined.token, secondJoined.nickname);
  const three = await waitForPredicate(
    second,
    'room:participants',
    (list) => list.length === 3 && list.some((participant) => participant.id === second.id),
    'la liste des participants avec trois personnes'
  );
  assert.equal(three.filter((participant) => participant.isHost).length, 1);

  const kicked = waitForEvent(first.socket, 'room:kicked');
  host.emit('participant:kick', { participantId: first.socket.id });
  assert.match((await kicked).reason, /removed/i);

  const afterKick = await waitForPredicate(
    host,
    'room:participants',
    (list) => list.length === 2 && !list.some((participant) => participant.id === first.socket.id),
    'la liste après expulsion'
  );
  assert.equal(afterKick.filter((participant) => participant.isHost).length, 1);

  // Le jeton révoqué ne doit pas permettre à l'exclu de revenir.
  const revoked = io(`${baseUrl}/watchparty`, {
    query: { roomId: room.roomId, token: first.joined.token, nickname: first.joined.nickname },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 3000,
    autoConnect: false,
  });
  const refused = waitForEvent(revoked, 'error');
  revoked.connect();
  assert.match((await refused).message, /token/i);
  revoked.disconnect();

  second.disconnect();
  const afterLeave = await waitForPredicate(
    host,
    'room:participants',
    (list) => list.length === 1 && list[0].id === host.id,
    'la liste après départ du dernier invité'
  );
  assert.equal(afterLeave[0].isHost, true);
});

test('un vote en cours oublie le votant parti et réduit le dénominateur', async (t) => {
  const { room, socket: host } = await connectHost(t);
  const member = await connectMember(t, room);

  const started = waitForEvent(host, 'vote:started');
  member.socket.emit('vote:request', { duration: 60 });
  await started;

  const firstUpdate = waitForEvent(host, 'vote:update');
  member.socket.emit('vote:cast', { vote: true });
  const before = await firstUpdate;
  assert.equal(before.yesVotes, 1);
  assert.equal(before.totalParticipants, 2);

  const afterLeave = waitForPredicate(
    host,
    'vote:update',
    (payload) => payload.totalVotes === 0 && payload.totalParticipants === 1,
    'la mise à jour du vote après départ'
  );
  member.socket.disconnect();
  const update = await afterLeave;
  assert.equal(update.yesVotes, 0);
  assert.equal(update.noVotes, 0);
});
