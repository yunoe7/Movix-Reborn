import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { isPauseVotePassed } from './voteMajority.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// --- Config ---
const PORT = Number(process.env.WATCHPARTY_PORT || 25566);

// Origines autorisées par défaut : uniquement le dev local. En production il faut
// renseigner explicitement WATCHPARTY_REST_CORS_ORIGIN / WATCHPARTY_SOCKET_CORS_ORIGIN.
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Normalise une entrée en origine CORS (`schéma://hôte[:port]`, sans chemin).
// Accepte aussi un domaine nu : « movix.fun » devient « https://movix.fun ».
function toOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

// Une entrée est une SOURCE distante (et non une origine) si c'est une URL http(s)
// pointant vers un chemin : « https://movix.online/address.json » est une source,
// « https://movix.fun » est une origine.
function isRemoteOriginSource(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const { pathname } = new URL(value);
    return pathname !== '' && pathname !== '/';
  } catch {
    return false;
  }
}

// Valeur acceptée : `*`, `true`, une liste d'origines séparées par des virgules,
// une ou plusieurs URL de liste distante, ou un mélange des deux.
const parseCorsOrigin = (value, fallback) => {
  const raw = String(value ?? '').trim();
  if (!raw) return { wildcard: false, origins: fallback.map(toOrigin).filter(Boolean), sources: [] };
  if (raw === 'true' || raw === '*') return { wildcard: true, origins: [], sources: [] };

  const origins = [];
  const sources = [];
  for (const part of raw.split(',').map((v) => v.trim()).filter(Boolean)) {
    if (isRemoteOriginSource(part)) {
      sources.push(part);
    } else {
      const origin = toOrigin(part);
      if (origin) origins.push(origin);
    }
  }
  return { wildcard: false, origins, sources };
};

const WATCHPARTY_REST_CORS_ORIGIN = parseCorsOrigin(process.env.WATCHPARTY_REST_CORS_ORIGIN, DEFAULT_CORS_ORIGINS);
const WATCHPARTY_SOCKET_CORS_ORIGIN = parseCorsOrigin(process.env.WATCHPARTY_SOCKET_CORS_ORIGIN, DEFAULT_CORS_ORIGINS);
const WATCHPARTY_SOCKET_CORS_METHODS = (process.env.WATCHPARTY_SOCKET_CORS_METHODS || 'GET,POST')
  .split(',')
  .map((method) => method.trim())
  .filter(Boolean);

// `credentials: true` combiné à une origine reflétée (`true`) ou `*` est une
// mauvaise configuration classique : n'importe quel site tiers peut alors appeler
// l'API avec les cookies de la victime. On désactive les credentials dans ce cas.
let WATCHPARTY_CORS_CREDENTIALS = (process.env.WATCHPARTY_CORS_CREDENTIALS || 'true') === 'true';
if (WATCHPARTY_CORS_CREDENTIALS && (WATCHPARTY_REST_CORS_ORIGIN.wildcard || WATCHPARTY_SOCKET_CORS_ORIGIN.wildcard)) {
  console.warn('[Watchparty] CORS: origine ouverte (* ou reflétée) détectée — credentials désactivés de force.');
  WATCHPARTY_CORS_CREDENTIALS = false;
}

// --- Origines chargées à distance (liste de miroirs) ---
// Format attendu, celui de https://movix.online/address.json :
//   { "primary": { "url": "..." }, "active": [ { "url": "..." } ], "blocked": [ ... ] }
// Seules `primary` et `active` sont retenues : un domaine listé dans `blocked`
// ne doit plus être autorisé. Une liste JSON nue et les clés `mirrors`,
// `origins` et `domains` sont aussi acceptées, par tolérance.
const CORS_SOURCE_REFRESH_MS = 10 * 60 * 1000;
const CORS_SOURCE_RETRY_MS = 60 * 1000;
const remoteOriginCache = new Map(); // URL de la source -> tableau d'origines

function parseRemoteOriginList(payload) {
  const found = [];
  const add = (entry) => {
    const origin = toOrigin(entry && typeof entry === 'object' ? entry.url : entry);
    if (origin) found.push(origin);
  };

  if (Array.isArray(payload)) {
    payload.forEach(add);
  } else if (payload && typeof payload === 'object') {
    if (payload.primary) add(payload.primary);
    for (const key of ['active', 'mirrors', 'origins', 'domains']) {
      if (Array.isArray(payload[key])) payload[key].forEach(add);
    }
  }
  return [...new Set(found)];
}

async function refreshRemoteOrigins() {
  const sources = new Set([...WATCHPARTY_REST_CORS_ORIGIN.sources, ...WATCHPARTY_SOCKET_CORS_ORIGIN.sources]);
  let allOk = true;

  for (const source of sources) {
    try {
      const res = await fetch(source, {
        signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const origins = parseRemoteOriginList(await res.json());
      if (origins.length === 0) throw new Error('aucune origine exploitable');
      remoteOriginCache.set(source, origins);
      console.log(`[Watchparty] CORS: ${origins.length} origines chargées depuis ${source}`);
    } catch (e) {
      allOk = false;
      const kept = remoteOriginCache.get(source);
      console.warn(
        `[Watchparty] CORS: échec du chargement de ${source} (${e.message})` +
        (kept ? ` — les ${kept.length} origines précédentes restent actives.` : ' — aucune origine en cache pour cette source !')
      );
    }
  }
  return allOk;
}

// En cas d'échec on réessaie vite, pour ne pas rester longtemps sur une liste
// vide ou périmée ; sinon on rafraîchit tranquillement.
function scheduleRemoteOriginRefresh(delay = CORS_SOURCE_REFRESH_MS) {
  setTimeout(async () => {
    const ok = await refreshRemoteOrigins();
    scheduleRemoteOriginRefresh(ok ? CORS_SOURCE_REFRESH_MS : CORS_SOURCE_RETRY_MS);
  }, delay).unref?.();
}

function isOriginAllowed(setting, origin) {
  if (setting.wildcard) return true;
  if (setting.origins.includes(origin)) return true;
  return setting.sources.some((source) => (remoteOriginCache.get(source) || []).includes(origin));
}

// Le paquet `cors` appelle cette fonction avec (origine, callback). Une requête
// sans en-tête `Origin` ne vient pas d'un navigateur : le CORS ne s'y applique
// pas, on la laisse passer (c'est le token de room qui protège l'accès).
function buildCorsOrigin(setting) {
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    return callback(null, isOriginAllowed(setting, origin));
  };
}

// Secret d'administration : protège /api/watchparty/all. Si absent, la route est désactivée.
const WATCHPARTY_ADMIN_SECRET = (process.env.WATCHPARTY_ADMIN_SECRET || '').trim();
if (!WATCHPARTY_ADMIN_SECRET) {
  console.warn('[Watchparty] WATCHPARTY_ADMIN_SECRET non défini — GET /api/watchparty/all est désactivée.');
}

// --- Limites anti-abus ---
const MAX_JSON_BODY = process.env.WATCHPARTY_MAX_BODY || '256kb';
const MAX_ROOMS = Number(process.env.WATCHPARTY_MAX_ROOMS || 500);
const MAX_ROOMS_PER_IP = Number(process.env.WATCHPARTY_MAX_ROOMS_PER_IP || 5);
const MAX_MESSAGES = 100;
const MAX_CHAT_LENGTH = 500;
const MAX_NICKNAME_LENGTH = 32;
const MAX_SOURCES_PER_LIST = 30;
const MAX_STRING_LENGTH = 2048;
const MAX_PARTICIPANTS_CAP = 50;
const MAX_EMOJI_LENGTH = 16;

// Adresse du client réel. La machine n'est pas joignable directement sur son
// port : tout le trafic entre par Cloudflare puis nginx, donc les en-têtes de
// transfert sont posés par notre propre infrastructure.
//
// `CF-Connecting-IP` est essayé en premier car Cloudflare l'écrase à chaque
// requête : un client ne peut pas le falsifier. `X-Forwarded-For` sert de
// repli, puis `req.ip` s'il n'y a aucun en-tête (appel local, tests).
function getClientIp(req) {
  const cfIp = (req.get('cf-connecting-ip') || '').trim();
  if (cfIp) return cfIp;

  const forwarded = (req.get('x-forwarded-for') || '').split(',')[0].trim();
  if (forwarded) return forwarded;

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const app = express();

app.use(cors({ origin: buildCorsOrigin(WATCHPARTY_REST_CORS_ORIGIN), credentials: WATCHPARTY_CORS_CREDENTIALS }));
app.use(express.json({ limit: MAX_JSON_BODY }));

const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: buildCorsOrigin(WATCHPARTY_SOCKET_CORS_ORIGIN),
    methods: WATCHPARTY_SOCKET_CORS_METHODS,
    credentials: WATCHPARTY_CORS_CREDENTIALS
  }
});

// --- Rate limiting (fenêtre glissante simple, en mémoire, sans dépendance) ---
const rateLimitBuckets = new Map();

function rateLimit({ windowMs, max, key = 'default', message = 'Too many requests.' }) {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = `${key}:${getClientIp(req)}`;
    const hits = (rateLimitBuckets.get(bucketKey) || []).filter((ts) => now - ts < windowMs);
    if (hits.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ success: false, message });
    }
    hits.push(now);
    rateLimitBuckets.set(bucketKey, hits);
    return next();
  };
}

// Purge périodique des compteurs pour éviter que la Map ne grossisse indéfiniment.
setInterval(() => {
  const now = Date.now();
  for (const [bucketKey, hits] of rateLimitBuckets.entries()) {
    const fresh = hits.filter((ts) => now - ts < 60_000);
    if (fresh.length === 0) rateLimitBuckets.delete(bucketKey);
    else rateLimitBuckets.set(bucketKey, fresh);
  }
}, 60_000).unref?.();

function requireAdminSecret(req, res, next) {
  if (!WATCHPARTY_ADMIN_SECRET) {
    return res.status(503).json({ success: false, message: 'Admin endpoint disabled.' });
  }
  const provided = req.get('x-admin-secret') || '';
  if (!safeCompare(provided, WATCHPARTY_ADMIN_SECRET)) {
    return res.status(403).json({ success: false, message: 'Forbidden.' });
  }
  return next();
}

// --- Persistance des rooms ---
// Snapshot atomique + journal de deltas : un crash brutal ne doit pas perdre
// les commandes confirmées depuis le dernier arrêt propre. WATCHPARTY_CACHE_DIR
// permet aux tests et aux déploiements d'isoler cet état sans toucher au cache
// de développement. Le service reste mono-instance : un verrou local refuse un
// second écrivain sur le même répertoire plutôt que de simuler un store partagé.
const CACHE_DIR = process.env.WATCHPARTY_CACHE_DIR
  ? path.resolve(process.env.WATCHPARTY_CACHE_DIR)
  : path.join(__dirname, 'cache');
const WATCHPARTY_ROOMS_FILE = path.join(CACHE_DIR, 'watchparty-rooms.json');
const WATCHPARTY_ROOMS_JOURNAL = path.join(CACHE_DIR, 'watchparty-rooms.journal.ndjson');
const CACHE_LOCK_FILE = path.join(CACHE_DIR, '.watchparty.lock');
const CACHE_LOCK_STALE_MS = 10 * 60_000;
const ROOM_SNAPSHOT_VERSION = 3;
const JOURNAL_COMPACTION_THRESHOLD = 50;
const SEQUENCE_WINDOW = 1000;
const watchpartyRooms = new Map();
// Allow a briefly disconnected host to reclaim the room before transferring ownership.
const HOST_RECONNECT_GRACE_MS = 5 * 60_000;
const hostDisconnectTimers = new Map();

// Toutes les écritures sont sérialisées : un journal ne peut pas être renommé
// pendant qu'une autre mutation y append, et le snapshot reflète toujours un
// état cohérent avec les enregistrements déjà journalisés.
let persistenceQueue = Promise.resolve();
let journalWritesSinceSnapshot = 0;
let journalSeq = 0;
let committedJournalSeq = 0;
// Snapshot « committed » : copie désérialisée des rooms dont l'append journal a
// réussi. Les snapshots ne lisent jamais `watchpartyRooms`, qui contient des
// états spéculatifs tant que l'ACK d'écriture n'est pas arrivé.
const committedRooms = new Map();
// Un media:change reçu pendant qu'un seek est en fsync invalide immédiatement
// la commande en vol, même si le handler de média est derrière elle dans la file
// par room.
const pendingMediaChanges = new Map();
let cacheLockToken = null;
let isShuttingDown = false;
let compactionRetryTimer = null;

// Les commandes de lecture d'une même room sont arbitrées dans l'ordre d'arrivée :
// deux `playback:update` concurrents ne doivent pas pouvoir acquérir le même seq.
const playbackCommandQueues = new Map();
function enqueuePlaybackCommand(roomId, task) {
  const previous = playbackCommandQueues.get(roomId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(task)
    .catch((error) => console.error('[Watchparty] Commande de lecture ignorée:', error.message));
  playbackCommandQueues.set(roomId, next);
  next.finally(() => {
    if (playbackCommandQueues.get(roomId) === next) playbackCommandQueues.delete(roomId);
  });
  return next;
}

// Une room supprimée ne doit laisser aucun timer capable de réveiller son état
// plus tard (transfert d'hôte, contrôle, countdown ou vote).
function clearRoomTimers(roomId) {
  const transferTimer = hostDisconnectTimers.get(roomId);
  if (transferTimer) {
    clearTimeout(transferTimer);
    hostDisconnectTimers.delete(roomId);
  }
  const room = watchpartyRooms.get(roomId);
  if (!room) return;
  if (room._cleanupTimer) { clearTimeout(room._cleanupTimer); room._cleanupTimer = null; }
  if (room.pauseTimerTimeout) { clearTimeout(room.pauseTimerTimeout); room.pauseTimerTimeout = null; }
  if (room.countdownTimer) { clearTimeout(room.countdownTimer); room.countdownTimer = null; }
  if (room.pauseVote?.timeoutId) clearTimeout(room.pauseVote.timeoutId);
}

async function ensureCacheDir() {
  await fsp.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  try { await fsp.chmod(CACHE_DIR, 0o700); } catch { /* plates-formes sans chmod */ }
}

// Un snapshot ou un journal hérité d'une ancienne version peut avoir des droits
// larges : on les renormalise à chaque démarrage, pas seulement à la création.
async function normalizeCachePermissions() {
  await ensureCacheDir();
  for (const file of [WATCHPARTY_ROOMS_FILE, WATCHPARTY_ROOMS_JOURNAL]) {
    try {
      await fsp.access(file);
      await fsp.chmod(file, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[Watchparty] Impossible de renormaliser ${path.basename(file)}:`, error.message);
      }
    }
  }
}

// fsync du répertoire après rename/unlink : sans lui, le nom du nouveau fichier
// peut encore être perdu après un crash alors que le contenu était bien fsyncé.
// Windows refuse fsync sur un répertoire : on tente, sans faire échouer l'écriture.
async function syncDirectory(dir) {
  let handle = null;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch {
    // Système de fichiers sans fsync de répertoire (Windows, certains FUSE).
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* ignore */ }
    }
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isHashedToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function normalizeStoredToken(value, legacyTokens) {
  if (typeof value !== 'string' || !value) return value;
  return legacyTokens && !isHashedToken(value) ? hashToken(value) : value;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readCacheLock() {
  try {
    return JSON.parse(await fsp.readFile(CACHE_LOCK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function acquireCacheLock() {
  await ensureCacheDir();
  const token = `${process.pid}.${uuidv4()}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsp.open(CACHE_LOCK_FILE, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          token,
          createdAt: Date.now()
        }), 'utf-8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(CACHE_DIR);
      cacheLockToken = token;
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readCacheLock();
      if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
        throw new Error(
          `WATCHPARTY_CACHE_DIR est déjà utilisé par le PID ${existing.pid}. ` +
          'La WatchParty est mono-instance : utilisez un répertoire de cache distinct ' +
          'ou arrêtez la première instance.'
        );
      }
      // Lock périmé : PID mort, contenu illisible ou processus terminé depuis
      // plus de CACHE_LOCK_STALE_MS. On ne supprime que notre propre verrou.
      try {
        if (existing?.token && existing.token !== token && isProcessAlive(existing.pid)
            && Date.now() - Number(existing.createdAt) < CACHE_LOCK_STALE_MS) {
          throw new Error('lock actif');
        }
        await fsp.unlink(CACHE_LOCK_FILE);
        await syncDirectory(CACHE_DIR);
      } catch (cleanupError) {
        throw new Error(`Impossible de libérer le verrou WatchParty: ${cleanupError.message}`);
      }
    }
  }
  throw new Error('Verrou WatchParty indisponible après deux tentatives.');
}

async function releaseCacheLock() {
  if (!cacheLockToken) return;
  const existing = await readCacheLock();
  if (existing?.token === cacheLockToken) {
    try {
      await fsp.unlink(CACHE_LOCK_FILE);
      await syncDirectory(CACHE_DIR);
    } catch { /* le verrou a déjà disparu */ }
  }
  cacheLockToken = null;
}

process.on('exit', () => {
  if (!cacheLockToken) return;
  try {
    const existing = JSON.parse(fs.readFileSync(CACHE_LOCK_FILE, 'utf-8'));
    if (existing?.token === cacheLockToken) fs.unlinkSync(CACHE_LOCK_FILE);
  } catch { /* fermeture déjà nettoyée */ }
});

async function cleanupStartupArtifacts() {
  const names = await fsp.readdir(CACHE_DIR);
  const stale = names.filter((name) => (
    name.includes('.processed.') || (name.startsWith('watchparty-rooms.json.') && name.endsWith('.tmp'))
  ));
  for (const name of stale) {
    try { await fsp.unlink(path.join(CACHE_DIR, name)); } catch { /* déjà parti */ }
  }
  if (stale.length > 0) await syncDirectory(CACHE_DIR);
}

// Les identifiants de socket ne survivent pas à un redémarrage : toute
// l'appartenance basée dessus est repartie de zéro, mais les tokens hachés, le
// média, les timers et la séquence de lecture restent valides.
function restoreRuntimeRoomState(room, legacyTokens = false) {
  if (!room || typeof room !== 'object' || !room.id) return null;
  room.participants = [];
  room.hostId = null;
  room.coHosts = [];
  room.pendingControlRequests = [];
  room.readyState = {};
  room.pauseTimer = Number.isFinite(room.pauseTimer?.endTime) ? room.pauseTimer : null;
  // Un countdown restauré appartient au serveur : la connexion d'un participant
  // ne doit pas l'annuler, sinon le départ synchronisé disparaît au premier join.
  room.countdown = Number.isFinite(room.countdown?.startAt)
    ? { ...room.countdown, restored: true }
    : null;
  if (room.pauseVote && Number.isFinite(room.pauseVote.endTime)) {
    delete room.pauseVote.timeoutId;
  } else {
    room.pauseVote = null;
  }
  room.pauseTimerTimeout = null;
  room.countdownTimer = null;
  room._cleanupTimer = null;
  room.playbackSeq = Number.isSafeInteger(room.playbackSeq) ? room.playbackSeq : 0;
  room.mediaEpoch = Number.isSafeInteger(room.mediaEpoch) ? room.mediaEpoch : 1;
  const applied = Object.create(null);
  for (const [commandId, value] of Object.entries(room.appliedCommands || {})) {
    applied[commandId] = value;
  }
  room.appliedCommands = applied;

  room.hostToken = normalizeStoredToken(room.hostToken, legacyTokens);
  if (Array.isArray(room.hostTokens)) {
    room.hostTokens = new Set(room.hostTokens.map((value) => normalizeStoredToken(value, legacyTokens)));
  } else if (room.hostTokens instanceof Set) {
    room.hostTokens = new Set([...room.hostTokens].map((value) => normalizeStoredToken(value, legacyTokens)));
  } else {
    const keys = Object.keys(room.hostTokens || (room.hostToken ? { [room.hostToken]: true } : {}));
    room.hostTokens = new Set(keys.map((value) => normalizeStoredToken(value, legacyTokens)));
  }
  const accessTokens = Object.create(null);
  for (const [token, meta] of Object.entries(room.accessTokens || {})) {
    accessTokens[normalizeStoredToken(token, legacyTokens)] = meta;
  }
  room.accessTokens = accessTokens;

  if (!room.playbackState || typeof room.playbackState !== 'object') {
    room.playbackState = {
      isPlaying: false,
      position: 0,
      updatedAt: Date.now(),
      updatedBy: 'system'
    };
  }
  room.playbackState.seq = room.playbackSeq;
  room.playbackState.mediaEpoch = room.mediaEpoch;
  return room;
}

function playbackDelta(room) {
  const state = room.playbackState || {};
  return {
    seq: room.playbackSeq,
    mediaEpoch: room.mediaEpoch,
    isPlaying: state.isPlaying === true,
    position: Number.isFinite(state.position) ? state.position : 0,
    reason: state.reason || null,
    commandId: state.commandId || null,
    updatedBy: state.updatedBy || 'system'
  };
}

async function loadJournalLines() {
  try {
    return (await fsp.readFile(WATCHPARTY_ROOMS_JOURNAL, 'utf-8')).split(/\r?\n/);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function parseJournalRecords(lines, sinceSeq, sinceTs) {
  const records = [];
  let hasLegacy = false;
  let maxSeq = Number.isSafeInteger(sinceSeq) ? sinceSeq : 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!record || (!record.room && !record.deleted && !record.type)) continue;

    if (Number.isSafeInteger(record.journalSeq)) {
      if (record.journalSeq > maxSeq) {
        records.push(record);
        maxSeq = record.journalSeq;
      }
      if (record.room) hasLegacy = true;
      continue;
    }

    // Journaux historiques : pas de journalSeq, tri par date uniquement en
    // attendant la compaction. Ils sont purgés juste après la restauration.
    if ((record.room || record.deleted === true) && Number.isFinite(record.ts) && record.ts > sinceTs) {
      maxSeq += 1;
      records.push({ ...record, journalSeq: maxSeq });
      hasLegacy = true;
    }
  }
  return { records, hasLegacy, maxSeq };
}

function applyJournalRecord(record) {
  if (record.deleted === true || record.type === 'room-delete') {
    watchpartyRooms.delete(record.roomId);
    return;
  }
  if (record.room) {
    const room = restoreRuntimeRoomState(record.room, true);
    if (room) watchpartyRooms.set(room.id, room);
  }
  const room = watchpartyRooms.get(record.roomId);
  if (!room) return;

  const epoch = Number.isSafeInteger(record.mediaEpoch)
    ? record.mediaEpoch
    : Number.isSafeInteger(record.state?.mediaEpoch) ? record.state.mediaEpoch : room.mediaEpoch;
  room.mediaEpoch = epoch;
  if (record.state) {
    const seq = Number.isSafeInteger(record.state.seq) ? record.state.seq : room.playbackSeq;
    room.playbackSeq = seq;
    room.playbackState = {
      ...room.playbackState,
      ...record.state,
      seq,
      mediaEpoch: epoch
    };
  }
  for (const key of ['pauseTimer', 'countdown', 'pauseVote']) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      if (value && typeof value === 'object') delete value.timeoutId;
      // Un countdown rejoué depuis le journal est server-owned, comme celui
      // restauré depuis le snapshot : la connexion ne doit pas l'annuler.
      room[key] = value && typeof value === 'object'
        ? (key === 'countdown' ? { ...value, restored: true } : value)
        : null;
    }
  }
}

async function loadRoomsFromDisk() {
  try {
    await normalizeCachePermissions();
    await cleanupStartupArtifacts();

    let snapshot = { version: 1, savedAt: 0, journalSeq: 0, rooms: [] };
    let legacyTokens = false;
    try {
      const parsed = JSON.parse(await fsp.readFile(WATCHPARTY_ROOMS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        snapshot = { version: 1, savedAt: 0, journalSeq: 0, rooms: parsed };
        legacyTokens = true;
      } else if (parsed && Array.isArray(parsed.rooms)) {
        snapshot = parsed;
        legacyTokens = Number(parsed.version || 1) < 3;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('[Watchparty] Snapshot illisible:', error.message);
    }

    for (const raw of snapshot.rooms) {
      const room = restoreRuntimeRoomState(raw, legacyTokens);
      if (room) watchpartyRooms.set(room.id, room);
    }

    const { records, hasLegacy, maxSeq } = parseJournalRecords(
      await loadJournalLines(),
      Number(snapshot.journalSeq) || 0,
      Number(snapshot.savedAt) || 0
    );
    journalSeq = Math.max(journalSeq, Number(snapshot.journalSeq) || 0, maxSeq);
    for (const record of records) applyJournalRecord(record);
    journalWritesSinceSnapshot = 0;
    initializeCommittedState();

    if (hasLegacy) {
      // Les anci journaux contenaient des tokens et des URLs en clair : on les
      // remplace par un snapshot propre dès que la restauration est terminée.
      await writeSnapshotNow(false);
      try {
        await fsp.unlink(WATCHPARTY_ROOMS_JOURNAL);
        await syncDirectory(CACHE_DIR);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    console.log(`[Watchparty] ${watchpartyRooms.size} rooms restaurées depuis le disque (${records.length} journal).`);
  } catch (error) {
    console.error('[Watchparty] Erreur lors de la restauration des rooms:', error.message);
  }
}

function serializeRoom(room) {
  const { pauseVote, countdownTimer, pauseTimerTimeout, _cleanupTimer, ...rest } = room;
  if (!pauseVote) return { ...rest, pauseVote: null };
  const { timeoutId, ...voteRest } = pauseVote;
  return { ...rest, pauseVote: voteRest };
}

// Copie profonde indépendante des mutations spéculatives ultérieures. Les sets
// de tokens deviennent des objets JSON, exactement comme dans le snapshot écrit
// sur disque ; `restoreRuntimeRoomState` sait les relire.
function cloneCommittedRoom(room) {
  return JSON.parse(JSON.stringify(serializeRoom(room)));
}

function initializeCommittedState() {
  committedRooms.clear();
  for (const [id, room] of watchpartyRooms) committedRooms.set(id, cloneCommittedRoom(room));
  committedJournalSeq = journalSeq;
}

function markMediaChange(roomId) {
  pendingMediaChanges.set(roomId, (pendingMediaChanges.get(roomId) || 0) + 1);
}

function releaseMediaChange(roomId) {
  const count = pendingMediaChanges.get(roomId) || 0;
  if (count <= 1) pendingMediaChanges.delete(roomId);
  else pendingMediaChanges.set(roomId, count - 1);
}

// Les enregistrements de création doivent pouvoir reconstruire une salle après
// un crash brutal, mais jamais transporter de secret ni d'URL de flux. On part
// d'une liste blanche : toute clé `src`/`url`/`file`/`poster`/`token` imbriquée
// est ainsi exclue par construction, y compris dans les listes de sources.
function journalRoomBase(room) {
  const media = room.media && typeof room.media === 'object' ? {
    title: sanitizeString(room.media.title, 200) || null,
    mediaType: room.media.mediaType === 'tv' ? 'tv' : 'movie',
    mediaId: sanitizeOptionalString(room.media.mediaId, 64),
    playbackType: room.media.playbackType === 'vidrift' ? 'vidrift' : 'direct',
    isAnime: room.media.isAnime === true,
    seasonNumber: sanitizeNumber(room.media.seasonNumber),
    episodeNumber: sanitizeNumber(room.media.episodeNumber)
  } : null;
  return {
    id: room.id,
    code: room.code,
    name: room.name || '',
    maxParticipants: room.maxParticipants,
    isPublic: !!room.isPublic,
    syncMode: room.syncMode || 'classic',
    chatEnabled: room.chatEnabled !== false,
    controlMode: room.controlMode,
    coHosts: Array.isArray(room.coHosts)
      ? room.coHosts.filter((id) => typeof id === 'string')
      : [],
    media,
    createdAt: room.createdAt
  };
}

async function writeAtomicJson(target, value) {
  await ensureCacheDir();
  const temp = `${target}.${process.pid}.${uuidv4()}.tmp`;
  const handle = await fsp.open(temp, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(temp, target);
    await syncDirectory(path.dirname(target));
  } catch (error) {
    try { await fsp.unlink(temp); } catch { /* déjà parti */ }
    await syncDirectory(path.dirname(target));
    throw error;
  }
}

async function rotateJournal() {
  const processed = `${WATCHPARTY_ROOMS_JOURNAL}.processed.${process.pid}.${uuidv4()}`;
  try {
    await fsp.rename(WATCHPARTY_ROOMS_JOURNAL, processed);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return;
  }
  await syncDirectory(CACHE_DIR);
  try {
    await fsp.unlink(processed);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await syncDirectory(CACHE_DIR);
}

async function writeSnapshotNow(compactJournal = false, explicitJournalSeq = null) {
  await ensureCacheDir();
  // Jamais d'état spéculatif : le snapshot est construit depuis la copie commitée
  // uniquement. Les rooms en attente d'append restent absentes jusqu'au succès.
  const rooms = Array.from(committedRooms.values()).map((room) => ({ ...room, pauseVote: room.pauseVote ? { ...room.pauseVote } : null }));
  const seq = Number.isSafeInteger(explicitJournalSeq) ? explicitJournalSeq : committedJournalSeq;
  await writeAtomicJson(WATCHPARTY_ROOMS_FILE, {
    version: ROOM_SNAPSHOT_VERSION,
    savedAt: Date.now(),
    journalSeq: seq,
    rooms
  });
  if (compactJournal) {
    // Rotation atomique du journal : les enregistrements déjà inclus dans le
    // snapshot ne doivent jamais être rejoués après un crash pendant la rotation.
    await rotateJournal();
    journalWritesSinceSnapshot = 0;
  }
  console.log(`[Watchparty] ${rooms.length} rooms sauvegardées sur le disque.`);
}

// Append fsyncé : la transition est durable dès que l'événement est diffusé.
// Le journal ne contient que des deltas : jamais de token ni d'URL de flux.
async function appendJournalNow(entry, explicitSeq = null) {
  await ensureCacheDir();
  const existed = await fsp.access(WATCHPARTY_ROOMS_JOURNAL).then(() => true, () => false);
  const seq = Number.isSafeInteger(explicitSeq) ? explicitSeq : ++journalSeq;
  const record = `${JSON.stringify({ journalSeq: seq, ts: Date.now(), ...entry })}\n`;
  let handle;
  try {
    handle = await fsp.open(WATCHPARTY_ROOMS_JOURNAL, 'a', 0o600);
    await handle.writeFile(record, 'utf-8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  if (!existed) await syncDirectory(CACHE_DIR);
  journalWritesSinceSnapshot += 1;
  return seq;
}

function scheduleCompactionRetry() {
  if (compactionRetryTimer || isShuttingDown) return;
  compactionRetryTimer = setTimeout(() => {
    compactionRetryTimer = null;
    persistenceQueue = persistenceQueue.then(async () => {
      try {
        await writeSnapshotNow(true);
      } catch (error) {
        console.error('[Watchparty] Compaction toujours différée:', error.message);
        scheduleCompactionRetry();
      }
    });
  }, 1000);
  compactionRetryTimer.unref?.();
}

function persistMutation(roomId, entry, options = {}) {
  if (isShuttingDown) return Promise.resolve({ ok: false, code: 'PERSISTENCE_FAILED' });
  const operation = persistenceQueue.then(async () => {
    const seq = Number.isSafeInteger(options.journalSeq) ? options.journalSeq : ++journalSeq;
    // Copie figée de l'état correspondant EXACTEMENT à cet enregistrement. Elle
    // ne sera publiée dans le snapshot qu'après un append fsyncé réussi.
    const committedState = entry.deleted === true
      ? null
      : (watchpartyRooms.has(roomId) ? cloneCommittedRoom(watchpartyRooms.get(roomId)) : null);

    await appendJournalNow({ roomId, ...entry }, seq);

    // L'append fsyncé est le point de commit. À partir d'ici la mutation est
    // durable : ni une erreur de snapshot ni une erreur de compaction ne doit
    // la faire apparaître comme PERSISTENCE_FAILED ou restaurer l'état mémoire.
    committedJournalSeq = Math.max(committedJournalSeq, seq);
    if (entry.deleted === true) committedRooms.delete(roomId);
    else if (committedState) committedRooms.set(roomId, committedState);

    if (options.snapshot) {
      try {
        await writeSnapshotNow(false, seq);
      } catch (error) {
        console.error('[Watchparty] Snapshot différé après un append durable:', error.message);
        scheduleCompactionRetry();
      }
    }
    if (journalWritesSinceSnapshot >= JOURNAL_COMPACTION_THRESHOLD) {
      try {
        await writeSnapshotNow(true, seq);
      } catch (error) {
        console.error('[Watchparty] Compaction différée après un append durable:', error.message);
        scheduleCompactionRetry();
      }
    }
    return { ok: true, journalSeq: seq };
  });
  persistenceQueue = operation.catch((error) => {
    console.error('[Watchparty] Erreur lors de la persistance incrémentale:', error.message);
    return { ok: false, code: 'PERSISTENCE_FAILED', error };
  });
  return persistenceQueue;
}

function persistRoomSnapshot(roomId, type) {
  const room = watchpartyRooms.get(roomId);
  const state = room?.playbackState ? playbackDelta(room) : null;
  return persistMutation(roomId, { type, state }, { snapshot: true });
}

async function saveRoomsToDisk() {
  const operation = persistenceQueue.then(async () => {
    await writeSnapshotNow(true);
    return { ok: true };
  });
  persistenceQueue = operation.catch((error) => {
    console.error('[Watchparty] Erreur lors de la sauvegarde des rooms:', error.message);
    return { ok: false, code: 'PERSISTENCE_FAILED', error };
  });
  return persistenceQueue;
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Watchparty] Signal ${signal} reçu. Sauvegarde des rooms avant arrêt...`);
  // Laisse les handlers déjà démarrés terminer avant de figer le snapshot.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await saveRoomsToDisk();
  await releaseCacheLock();
  try { io.close(); } catch { }
  try { server.close(() => process.exit(0)); } catch { process.exit(0); }
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Helpers ---

// Comparaison à temps constant, tolérante aux longueurs différentes.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // On compare quand même pour ne pas court-circuiter sur la longueur.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Code de room : CSPRNG. `Math.random()` (xorshift128+) est prédictible à partir
// de quelques tirages, et le code était de surcroît fourni par le client.
function generateRoomCode() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) result += charset[crypto.randomInt(charset.length)];
  return result;
}

function generateUniqueRoomCode() {
  const existing = new Set();
  for (const room of watchpartyRooms.values()) existing.add(room.code);
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateRoomCode();
    if (!existing.has(code)) return code;
  }
  return null;
}

// --- Validation des entrées ---
function sanitizeString(value, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function sanitizeNickname(value) {
  const cleaned = sanitizeString(value, MAX_NICKNAME_LENGTH).replace(/[\r\n\t]/g, ' ').trim();
  // A nickname is a short display label, never a pasted invite URL.
  if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(cleaned)) return 'Guest';
  return cleaned;
}

function sanitizeOptionalString(value, maxLength = MAX_STRING_LENGTH) {
  const cleaned = sanitizeString(value, maxLength);
  return cleaned || null;
}

function sanitizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Durée de pause bornée : `duration` arrivait brut du client (NaN, négatif ou
// arbitrairement long) directement dans un calcul d'horodatage.
function clampPauseDuration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 60;
  return Math.max(5, Math.min(600, Math.round(parsed)));
}

// Chaque objet source est réduit à ses champs connus et borné en taille : sans ça,
// un client pouvait stocker des mégaoctets arbitraires par room.
function sanitizeSourceList(list, fields) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SOURCES_PER_LIST).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const out = {};
    for (const field of fields) {
      if (entry[field] === undefined || entry[field] === null) continue;
      out[field] = typeof entry[field] === 'boolean' ? entry[field] : sanitizeString(entry[field]);
    }
    return out;
  }).filter((entry) => entry && Object.keys(entry).length > 0);
}

function sanitizeMedia(media) {
  const src = sanitizeString(media?.src);
  if (!src) return null;
  return {
    src,
    title: sanitizeString(media?.title, 200) || 'Media',
    poster: sanitizeOptionalString(media?.poster),
    mediaType: media?.mediaType === 'tv' ? 'tv' : 'movie',
    mediaId: sanitizeOptionalString(media?.mediaId, 64),
    playbackType: media?.playbackType === 'vidrift' ? 'vidrift' : 'direct',
    isAnime: media?.isAnime === true,
    seasonNumber: sanitizeNumber(media?.seasonNumber),
    episodeNumber: sanitizeNumber(media?.episodeNumber),
    nightflixSources: sanitizeSourceList(media?.nightflixSources, ['src', 'quality', 'language', 'label']),
    nexusSources: sanitizeSourceList(media?.nexusSources, ['url', 'label', 'type']),
    bravoSources: sanitizeSourceList(media?.bravoSources, ['url', 'label', 'language', 'isVip']),
    // `followsRedirect` : le salon en a besoin pour retirer `crossOrigin` sur la
    // source SwiftFlux, dont le CDN répond une 302 qu'une requête CORS refuse
    // de suivre. Sans ce champ dans la liste blanche, le drapeau était perdu au
    // passage par le serveur et les invités repartaient en mode CORS.
    mp4Sources: sanitizeSourceList(media?.mp4Sources, ['url', 'label', 'language', 'isVip', 'followsRedirect']),
    captions: sanitizeSourceList(media?.captions, ['label', 'file']),
    currentNexusSource: sanitizeSourceList([media?.currentNexusSource], ['url', 'label', 'type'])[0] || null,
    currentBravoSource: sanitizeSourceList([media?.currentBravoSource], ['url', 'label', 'language', 'isVip'])[0] || null
  };
}

// Point d'entrée unique pour l'historique du chat : le plafond s'applique aussi
// aux messages système (join/leave/vote), qui grossissaient sans limite et
// étaient rejoués intégralement à chaque nouvel arrivant.
function pushMessage(room, message) {
  room.messages.push(message);
  while (room.messages.length > MAX_MESSAGES) room.messages.shift();
  return message;
}

function systemMessage(room, text) {
  return pushMessage(room, {
    id: uuidv4(),
    senderId: 'system',
    senderNickname: 'System',
    text,
    timestamp: Date.now(),
    type: 'system'
  });
}

// Rôle du porteur d'un token pour une room donnée : 'host', 'member' ou null.
function resolveRoomRole(room, token) {
  if (!room || typeof token !== 'string' || !token) return null;
  const fingerprint = hashToken(token);
  if (room.hostTokens && room.hostTokens instanceof Set && room.hostTokens.has(fingerprint)) return 'host';
  if (room.hostToken && safeCompare(fingerprint, room.hostToken)) return 'host';
  if (room.accessTokens && Object.prototype.hasOwnProperty.call(room.accessTokens, fingerprint)) return 'member';
  return null;
}

function issueAccessToken(room, nickname) {
  const token = generateToken();
  room.accessTokens[hashToken(token)] = { nickname, issuedAt: Date.now() };
  // Borne le nombre de tokens vivants par room (10x la capacité) pour éviter
  // qu'un spam de POST /join ne fasse grossir l'objet indéfiniment.
  const tokens = Object.keys(room.accessTokens);
  const maxTokens = Math.max(50, room.maxParticipants * 10);
  if (tokens.length > maxTokens) {
    tokens
      .sort((a, b) => room.accessTokens[a].issuedAt - room.accessTokens[b].issuedAt)
      .slice(0, tokens.length - maxTokens)
      .forEach((stale) => { delete room.accessTokens[stale]; });
  }
  return token;
}

function extractRequestToken(req) {
  return sanitizeString(req.get('x-watchparty-token') || req.query.token || '', 256);
}

// --- Socket.IO namespace dédié watchparty ---
const watchpartyIO = io.of('/watchparty');
// Les clients du lobby n'ont pas de token de salle : ils reçoivent uniquement
// les métadonnées publiques, jamais les URLs de flux ni les participants privés.
const lobbyIO = io.of('/watchparty-lobby');
const SYNC_PRO_SCHEDULE_DELAY_MS = 250;

// Un vote ne doit compter que les participants encore présents : sans cela,
// un invité parti faisait échouer un vote-majorité par son absence.
function emitVoteUpdate(roomId, room) {
  if (!room.pauseVote) return;
  const present = new Set(room.participants.map((participant) => participant.id));
  for (const id of Object.keys(room.pauseVote.votes)) {
    if (!present.has(id)) delete room.pauseVote.votes[id];
  }
  const values = Object.values(room.pauseVote.votes);
  watchpartyIO.to(roomId).emit('vote:update', {
    yesVotes: values.filter((value) => value === true).length,
    noVotes: values.filter((value) => value === false).length,
    totalVotes: values.length,
    totalParticipants: room.participants.length,
  });
}

// Garde participants sur TOUS les handlers de contrôle : une commande en vol
// d'un participant expulsé (ou d'un ancien socket) doit être refusée, pas seulement
// une commande reçue après la déconnexion.
function getActiveRoom(roomId, socket) {
  const room = watchpartyRooms.get(roomId);
  if (!room || !room.participants.some((participant) => participant.id === socket.id)) return null;
  return room;
}

function snapshotPlayback(room) {
  return {
    playbackSeq: room.playbackSeq,
    mediaEpoch: room.mediaEpoch,
    playbackState: { ...room.playbackState },
    media: room.media ? { ...room.media } : null,
    pauseTimer: room.pauseTimer ? { ...room.pauseTimer } : null,
    countdown: room.countdown ? { ...room.countdown } : null,
    pauseVote: room.pauseVote
      ? { ...room.pauseVote, votes: { ...(room.pauseVote.votes || {}) } }
      : null
  };
}

function restorePlayback(room, snapshot) {
  room.playbackSeq = snapshot.playbackSeq;
  room.mediaEpoch = snapshot.mediaEpoch;
  room.playbackState = snapshot.playbackState;
  if (Object.prototype.hasOwnProperty.call(snapshot, 'media')) room.media = snapshot.media;
  room.pauseTimer = snapshot.pauseTimer;
  room.countdown = snapshot.countdown;
  room.pauseVote = snapshot.pauseVote;
}

// Figure l'état attendu juste après la mutation spéculative, avant l'attente
// d'écriture. `assertStillAuthorized` s'en sert pour détecter une commande
// devenue périmée pendant le fsync.
function captureAuthorizationBaseline(before, room) {
  before.expectedSeq = room.playbackSeq;
  before.expectedEpoch = room.mediaEpoch;
  return before;
}

// Revérifie APRÈS chaque await : participation, token encore valide et état
// autoritaire inchangé depuis la mutation spéculative de ce handler.
function assertStillAuthorized(roomId, socket, before) {
  const room = watchpartyRooms.get(roomId);
  if (!room || !getActiveRoom(roomId, socket)) return false;
  if (!socket.data?.token || !resolveRoomRole(room, socket.data.token)) return false;
  const expectedSeq = Number.isSafeInteger(before.expectedSeq) ? before.expectedSeq : before.playbackSeq;
  const expectedEpoch = Number.isSafeInteger(before.expectedEpoch) ? before.expectedEpoch : before.mediaEpoch;
  return room.playbackSeq === expectedSeq && room.mediaEpoch === expectedEpoch;
}

function restoreMutationState(room, before) {
  if (!room) return;
  restorePlayback(room, before);
  restoreTimers(room, before);
}

function isAcceptableRequestedSeq(value, nextSeq) {
  if (value === undefined || value === null) return true;
  return Number.isSafeInteger(value)
    && value > 0
    && value <= nextSeq + SEQUENCE_WINDOW
    && value <= Number.MAX_SAFE_INTEGER - SEQUENCE_WINDOW;
}

function buildRoomInfo(roomId, room) {
  return {
    id: roomId,
    code: room.code,
    name: room.name || '',
    hostId: room.hostId,
    maxParticipants: room.maxParticipants,
    isPublic: !!room.isPublic,
    syncMode: room.syncMode || 'classic',
    chatEnabled: room.chatEnabled !== false,
    controlMode: room.controlMode,
    coHosts: room.coHosts,
    media: room.media,
    countdown: room.countdown || null,
    readyState: room.readyState || {},
    createdAt: room.createdAt,
    participants: room.participants
  };
}

function emitRoomInfo(roomId, room) {
  watchpartyIO.to(roomId).emit('room:info', buildRoomInfo(roomId, room));
}

// Le lobby et la route REST partagent exactement la même projection : aucun
// champ privé (media.src, tokens, messages) ne quitte ce module.
function buildPublicRoomEntry(roomId, room) {
  return {
    id: roomId,
    code: room.code,
    title: room.name || room.media.title,
    mediaTitle: room.media.title,
    hostNickname: room.participants.find((participant) => participant.isHost)?.nickname || 'Hôte',
    isAnime: room.media.isAnime === true,
    playbackType: room.media.playbackType || 'direct',
    mediaId: room.media.mediaId || null,
    seasonNumber: room.media.seasonNumber,
    episodeNumber: room.media.episodeNumber,
    poster: room.media.poster,
    mediaType: room.media.mediaType,
    participantCount: room.participants.length,
    maxParticipants: room.maxParticipants,
    syncMode: room.syncMode || 'classic',
    createdAt: room.createdAt
  };
}

function buildPublicRoomSnapshot() {
  const rooms = [];
  for (const [roomId, room] of watchpartyRooms.entries()) {
    if (room.isPublic) rooms.push(buildPublicRoomEntry(roomId, room));
  }
  return rooms.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function emitPublicRooms() {
  lobbyIO.emit('lobby:rooms', buildPublicRoomSnapshot());
}

lobbyIO.on('connection', (socket) => {
  socket.emit('lobby:rooms', buildPublicRoomSnapshot());
});

function emitControlState(roomId, room) {
  watchpartyIO.to(roomId).emit('control:state', {
    controlMode: room.controlMode,
    coHosts: room.coHosts,
    pendingRequests: room.pendingControlRequests
  });
}

function buildScheduledPlaybackEvent(playbackUpdate, action, originCommandId = null) {
  const serverNow = Date.now();
  return {
    action,
    position: playbackUpdate.position,
    scheduledAt: serverNow + SYNC_PRO_SCHEDULE_DELAY_MS,
    serverNow,
    updatedBy: playbackUpdate.updatedBy,
    seq: playbackUpdate.seq,
    mediaEpoch: playbackUpdate.mediaEpoch,
    originCommandId
  };
}

// Tout changement d'état autoritaire passe par ici : la séquence et l'époque du
// média sont incrémentées côté serveur, jamais acceptées telles quelles du client.
function advancePlayback(roomId, room, patch, updatedBy, explicitSeq = null) {
  const nextSeq = explicitSeq === null
    ? (Number.isSafeInteger(room.playbackSeq) ? room.playbackSeq : 0) + 1
    : explicitSeq;
  if (!Number.isSafeInteger(nextSeq)) return null;
  room.playbackSeq = nextSeq;
  room.playbackState = {
    ...room.playbackState,
    ...patch,
    seq: room.playbackSeq,
    mediaEpoch: room.mediaEpoch,
    updatedAt: Date.now(),
    updatedBy
  };
  return room.playbackState;
}

function emitPlaybackUpdate(roomId, room, state, options = {}) {
  const { scheduleAction = null, exceptSocket = null, originCommandId = null } = options;
  const broadcastState = originCommandId
    ? { ...state, originCommandId }
    : state;
  if (exceptSocket) {
    exceptSocket.to(roomId).emit('playback:state', broadcastState);
  } else {
    watchpartyIO.to(roomId).emit('playback:state', broadcastState);
  }
  if (scheduleAction && room.syncMode === 'pro') {
    const event = buildScheduledPlaybackEvent(state, scheduleAction, originCommandId);
    if (exceptSocket) exceptSocket.to(roomId).emit('playback:schedule', event);
    else watchpartyIO.to(roomId).emit('playback:schedule', event);
  }
  return state;
}

function sendPlaybackAck(socket, payload) {
  socket.emit('playback:ack', {
    commandId: payload.commandId || null,
    seq: payload.seq,
    accepted: payload.accepted,
    code: payload.code || null,
    reason: payload.reason || null,
    // Un ACK n'est durable que si le handler a explicitement journalisé la
    // mutation. Rejets et heartbeats restent transitoires (champ optionnel côté
    // client, donc sans casse de compatibilité).
    durable: payload.durable === true,
    mediaEpoch: payload.mediaEpoch,
    state: payload.state
  });
}

function persistRoom(roomId, type = 'mutation', options = { snapshot: true }) {
  const room = watchpartyRooms.get(roomId);
  return persistMutation(roomId, {
    type,
    state: room?.playbackState ? playbackDelta(room) : null,
    ...(type === 'room-created' && room ? { room: journalRoomBase(room) } : {})
  }, options);
}

function persistRoomDeletion(roomId) {
  return persistMutation(roomId, { type: 'room-delete', deleted: true });
}

async function persistAuthoritativeMutation(roomId, entry, before, options = {}) {
  const result = await persistMutation(roomId, entry, options);
  if (result.ok) return true;
  restoreMutationState(watchpartyRooms.get(roomId), before);
  return false;
}

function restoreTimers(room, before) {
  room.pauseTimer = before.pauseTimer;
  room.countdown = before.countdown;
  room.pauseVote = before.pauseVote;
}

function schedulePauseAutoResume(roomId, room) {
  if (room.pauseTimerTimeout) clearTimeout(room.pauseTimerTimeout);
  const expectedEndTime = room.pauseTimer?.endTime;
  if (!expectedEndTime) return;

  const delay = Math.max(0, expectedEndTime - Date.now());
  room.pauseTimerTimeout = setTimeout(() => {
    enqueuePlaybackCommand(roomId, async () => {
      const current = watchpartyRooms.get(roomId);
      if (!current || current.pauseTimer?.endTime !== expectedEndTime) return;
      const before = snapshotPlayback(current);
      const shouldResume = current.pauseTimer.resumeAfterPause === true;
      current.pauseTimer = null;
      current.pauseTimerTimeout = null;

      let state = null;
      if (shouldResume) {
        state = advancePlayback(roomId, current, {
          isPlaying: true,
          updatedBy: 'pause-timer',
          reason: 'play'
        }, 'pause-timer');
      }
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'pause-auto-resume',
        state: state ? playbackDelta(current) : null,
        pauseTimer: null,
        ts: Date.now()
      }, before);
      if (!ok || current.mediaEpoch !== before.mediaEpoch) return;

      if (state) {
        emitPlaybackUpdate(roomId, current, state, {
          scheduleAction: 'play',
          originCommandId: `pause-timer-${expectedEndTime}`
        });
      }
      watchpartyIO.to(roomId).emit('pause:timerFinished');
      const message = systemMessage(current, shouldResume
        ? '▶️ La pause est terminée, la lecture reprend.'
        : 'La pause est terminée. La lecture reste en pause.');
      watchpartyIO.to(roomId).emit('room:chat', message);
    });
  }, delay);
  room.pauseTimerTimeout.unref?.();
}

function scheduleCountdownTimer(roomId, room, startAt, startedBy) {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = setTimeout(() => {
    enqueuePlaybackCommand(roomId, async () => {
      const current = watchpartyRooms.get(roomId);
      if (!current || current.countdown?.startAt !== startAt) return;
      const before = snapshotPlayback(current);
      const position = Number(current.playbackState?.position) || 0;
      current.countdown = null;
      current.countdownTimer = null;
      const state = advancePlayback(roomId, current, {
        isPlaying: true,
        position,
        updatedBy: startedBy || 'system',
        reason: 'play'
      }, startedBy || 'system');
      if (!state) return;
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'countdown-finish',
        state: playbackDelta(current),
        countdown: null
      }, before);
      if (!ok || current.mediaEpoch !== before.mediaEpoch) return;

      emitPlaybackUpdate(roomId, current, state, {
        scheduleAction: 'play',
        originCommandId: `countdown-${startAt}`
      });
      watchpartyIO.to(roomId).emit('room:countdownFinished', { startedAt: startAt });
    });
  }, Math.max(0, startAt - Date.now()));
  room.countdownTimer.unref?.();
}

function scheduleVoteDeadline(roomId, room) {
  const deadline = room.pauseVote?.endTime;
  if (!deadline) return;
  if (room.pauseVote.timeoutId) clearTimeout(room.pauseVote.timeoutId);
  room.pauseVote.timeoutId = setTimeout(() => resolveVote(roomId), Math.max(0, deadline - Date.now()));
  room.pauseVote.timeoutId.unref?.();
}

// Résolution d'un vote. La variante « Now » est appelée depuis un handler déjà
// dans la file de la room ; l'autre est le point d'entrée des timers restaurés.
async function resolveVoteNow(roomId) {
  const r = watchpartyRooms.get(roomId);
  if (!r?.pauseVote) return;

  const before = snapshotPlayback(r);
  const currentIds = new Set(r.participants.map((participant) => participant.id));
  const eligibleEntries = Object.entries(r.pauseVote.votes).filter(([id]) => currentIds.has(id));
  const yesVotes = eligibleEntries.filter(([, value]) => value === true).length;
  const totalVotes = eligibleEntries.length;
  const totalParticipants = r.participants.length || r.pauseVote.totalParticipants;
  const passed = isPauseVotePassed(yesVotes, totalParticipants);

  let state = null;
  if (passed) {
    const wasPlaying = r.playbackState?.isPlaying === true;
    if (r.pauseTimerTimeout) clearTimeout(r.pauseTimerTimeout);
    r.pauseTimer = {
      endTime: Date.now() + r.pauseVote.requestedDuration * 1000,
      startedBy: r.pauseVote.requestedBy,
      duration: r.pauseVote.requestedDuration,
      resumeAfterPause: wasPlaying
    };
    schedulePauseAutoResume(roomId, r);
    state = advancePlayback(roomId, r, {
      isPlaying: false,
      updatedBy: 'vote',
      reason: 'pause'
    }, 'vote');
  }

  const ended = {
    passed,
    yesVotes,
    noVotes: totalVotes - yesVotes,
    totalParticipants
  };
  const requestedDuration = r.pauseVote.requestedDuration;
  if (r.pauseVote.timeoutId) clearTimeout(r.pauseVote.timeoutId);
  r.pauseVote = null;

  const ok = await persistAuthoritativeMutation(roomId, {
    type: 'vote-resolve',
    state: state ? playbackDelta(r) : null,
    pauseTimer: r.pauseTimer ? { ...r.pauseTimer } : null,
    pauseVote: null,
    result: ended
  }, before);
  if (!ok || r.mediaEpoch !== before.mediaEpoch) return;

  if (passed && state) {
    emitPlaybackUpdate(roomId, r, state, {
      scheduleAction: 'pause',
      originCommandId: `vote-${requestedDuration}`
    });
    watchpartyIO.to(roomId).emit('pause:timerStarted', r.pauseTimer);
    watchpartyIO.to(roomId).emit('room:chat', systemMessage(
      r,
      `✅ Vote accepté (${yesVotes}/${totalParticipants}). Pause de ${requestedDuration}s lancée.`
    ));
  } else {
    watchpartyIO.to(roomId).emit('room:chat', systemMessage(
      r,
      `❌ Vote refusé (${yesVotes}/${totalParticipants}). La majorité n'a pas été atteinte.`
    ));
  }
  watchpartyIO.to(roomId).emit('vote:ended', ended);
}

function resolveVote(roomId) {
  enqueuePlaybackCommand(roomId, () => resolveVoteNow(roomId));
}

function scheduleRestoredTimers() {
  for (const [roomId, room] of watchpartyRooms.entries()) {
    if (room.pauseTimer?.endTime) schedulePauseAutoResume(roomId, room);
    if (room.countdown?.startAt) scheduleCountdownTimer(roomId, room, room.countdown.startAt, room.countdown.startedBy);
    if (room.pauseVote?.endTime) scheduleVoteDeadline(roomId, room);
  }
}

watchpartyIO.on('connection', (socket) => {
  // Socket.IO v4 place les données de connexion dans `auth` ; `query` reste
  // accepté pour les clients v3 encore déployés.
  const handshake = { ...socket.handshake.query, ...(socket.handshake.auth || {}) };
  const roomId = sanitizeString(handshake.roomId, 64);
  const nickname = sanitizeNickname(handshake.nickname);
  const token = sanitizeString(handshake.token, 256);

  if (!roomId || !watchpartyRooms.has(roomId)) {
    socket.emit('error', { message: 'Invalid room ID' });
    socket.disconnect();
    return;
  }

  const room = watchpartyRooms.get(roomId);

  // Un roomId seul ne suffit plus : il faut un token délivré par
  // POST /create (hôte) ou POST /join (membre). Sans ça, toute personne
  // connaissant l'identifiant pouvait entrer dans n'importe quelle room privée.
  const role = resolveRoomRole(room, token);

  // A host returning during the grace period keeps ownership and their existing token.
  if (role === 'host') {
    const pendingTransfer = hostDisconnectTimers.get(roomId);
    if (pendingTransfer) {
      clearTimeout(pendingTransfer);
      hostDisconnectTimers.delete(roomId);
    }
  }

  if (!role) {
    socket.emit('error', { message: 'Unauthorized: missing or invalid room token' });
    socket.disconnect();
    return;
  }

  // La capacité n'était vérifiée que dans POST /join, donc contournable en se
  // connectant directement au socket.
  if (room.participants.length >= room.maxParticipants) {
    socket.emit('error', { message: 'This watch party is full.' });
    socket.disconnect();
    return;
  }

  socket.data.role = role;
  socket.data.token = token;
  if (room._cleanupTimer) { clearTimeout(room._cleanupTimer); room._cleanupTimer = null; }
  socket.join(roomId);

  // Migration explicite du rôle : un second socket muni du token hôte démote
  // l'ancien socket au lieu de laisser deux hôtes autoritaires coexister.
  const isHost = role === 'host';
  if (isHost) {
    const previousHostId = room.hostId;
    if (previousHostId && previousHostId !== socket.id) {
      const previousHost = room.participants.find((person) => person.id === previousHostId);
      if (previousHost) previousHost.isHost = false;
      const previousSocket = watchpartyIO.sockets.get(previousHostId);
      if (previousSocket && previousSocket !== socket) previousSocket.data.role = 'member';
      room.hostId = socket.id;
      room.coHosts = room.coHosts.filter((id) => id !== socket.id && id !== previousHostId);
      watchpartyIO.to(roomId).emit('host:transferred', {
        hostId: socket.id,
        previousHostId
      });
      persistRoom(roomId, 'host-migration');
    } else if (!previousHostId) {
      room.hostId = socket.id;
    }
  }

  const participant = {
    id: socket.id,
    nickname,
    isHost,
    isActive: true,
    joinedAt: Date.now()
  };
  room.participants.push(participant);
  room.readyState[socket.id] = false;
  // Rafraîchir aussi le compteur public quand l'hôte ou un invité rejoint.
  emitPublicRooms();

  // Emit room info + participants
  emitRoomInfo(roomId, room);
  watchpartyIO.to(roomId).emit('room:participants', room.participants);
  // Send control state and ready state to the new participant
  socket.emit('control:state', {
    controlMode: room.controlMode,
    coHosts: room.coHosts,
    pendingRequests: room.pendingControlRequests
  });
  watchpartyIO.to(roomId).emit('ready:state', room.readyState);
  // Un countdown restauré appartient au serveur : on le conserve et on le
  // réémet au nouveau venu. Un countdown créé par un participant reste annulé
  // quand la liste des prêts change.
  if (room.countdown && !room.countdown.restored) {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdown = null;
    room.countdownTimer = null;
    watchpartyIO.to(roomId).emit('room:countdownCancelled');
  }

  // System join message
  const joinMessage = systemMessage(room, `${participant.nickname} a rejoint la Watch Party.`);
  watchpartyIO.to(roomId).emit('room:chat', joinMessage);

  // Send current playback state + chat history + pause timer
  socket.emit('room:playback', room.playbackState);
  if (room.countdown?.restored && room.countdown.startAt > Date.now()) {
    socket.emit('room:countdown', { ...room.countdown });
  }
  if (room.pauseTimer && room.pauseTimer.endTime > Date.now()) {
    socket.emit('pause:timerStarted', room.pauseTimer);
  }
  if (room.pauseVote) {
    socket.emit('vote:started', {
      requestedBy: room.pauseVote.requestedBy,
      requestedByNickname: room.pauseVote.requestedByNickname,
      requestedDuration: room.pauseVote.requestedDuration,
      endTime: room.pauseVote.endTime,
      totalParticipants: room.pauseVote.totalParticipants
    });
    socket.emit('vote:update', {
      yesVotes: Object.values(room.pauseVote.votes || {}).filter(Boolean).length,
      noVotes: Object.values(room.pauseVote.votes || {}).filter(value => value === false).length,
      totalVotes: Object.keys(room.pauseVote.votes || {}).length,
      totalParticipants: room.participants.length
    });
  }
  room.messages.filter(m => !m.deleted).forEach(m => socket.emit('room:chat', m));

  // A client can load or reload its iframe after the Socket.IO connection.
  // Return the authoritative snapshot on demand so a newly mounted VidRift
  // player never keeps its local autoplay/position instead of the room state.
  socket.on('playback:getState', () => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (!r.participants.some((participant) => participant.id === socket.id)) return;
    socket.emit('room:playback', r.playbackState);
  });

  // Chat
  socket.on('chat:message', (data) => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (r.chatEnabled === false && socket.id !== r.hostId && !r.coHosts.includes(socket.id)) return;
    const me = r.participants.find(p => p.id === socket.id);
    if (!me) return;
    const text = sanitizeString(data?.text, MAX_CHAT_LENGTH);
    if (!text) return;
    const replyToId = sanitizeString(data?.replyToId, 64);
    const repliedMessage = replyToId
      ? r.messages.find(message => message.id === replyToId && !message.deleted)
      : null;
    const msg = pushMessage(r, {
      id: uuidv4(),
      senderId: socket.id,
      senderNickname: me.nickname,
      text,
      replyTo: repliedMessage ? {
        id: repliedMessage.id,
        senderNickname: sanitizeString(repliedMessage.senderNickname, 32),
        text: sanitizeString(repliedMessage.text, 140)
      } : null,
      timestamp: Date.now(),
      type: 'chat'
    });
    watchpartyIO.to(roomId).emit('room:chat', msg);
  });

  socket.on('playback:update', (data) => {
    enqueuePlaybackCommand(roomId, async () => {
      const r = getActiveRoom(roomId, socket);
      if (isShuttingDown || !r) return;
      // Check if user can control: host, co-host, or democratic mode
      const canControl = socket.id === r.hostId ||
        r.coHosts.includes(socket.id) ||
        r.controlMode === 'democratic';
      const commandId = sanitizeString(data?.commandId, 128) || uuidv4();
      const requestedSeq = Number.isSafeInteger(data?.seq) ? data.seq : null;
      const invalidSeq = data?.seq !== undefined && data?.seq !== null
        && !isAcceptableRequestedSeq(data.seq, r.playbackSeq + 1);

      if (!canControl) {
        sendPlaybackAck(socket, {
          commandId,
          seq: requestedSeq || r.playbackSeq,
          accepted: false,
          code: 'NOT_AUTHORIZED',
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      if (invalidSeq) {
        sendPlaybackAck(socket, {
          commandId,
          seq: r.playbackSeq,
          accepted: false,
          code: 'INVALID_SEQUENCE',
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      const reason = ['play', 'pause', 'seek', 'heartbeat', 'ended'].includes(data?.reason)
        ? data.reason
        : 'heartbeat';
      // Playback controls may be shared with co-hosts/democratic members,
      // but periodic heartbeats must have a single source of truth.
      if (reason === 'heartbeat' && socket.id !== r.hostId) {
        sendPlaybackAck(socket, {
          commandId,
          seq: requestedSeq || r.playbackSeq,
          accepted: false,
          code: 'HOST_ONLY_HEARTBEAT',
          reason,
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      if (!r.appliedCommands || Object.getPrototypeOf(r.appliedCommands) !== null) {
        const applied = Object.create(null);
        for (const [key, value] of Object.entries(r.appliedCommands || {})) applied[key] = value;
        r.appliedCommands = applied;
      }
      if (Object.prototype.hasOwnProperty.call(r.appliedCommands, commandId)) {
        sendPlaybackAck(socket, {
          commandId,
          seq: r.appliedCommands[commandId].seq,
          accepted: false,
          code: 'DUPLICATE_COMMAND',
          reason,
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      const seq = requestedSeq === null ? r.playbackSeq + 1 : requestedSeq;
      if (seq <= r.playbackSeq) {
        sendPlaybackAck(socket, {
          commandId,
          seq,
          accepted: false,
          code: 'STALE_SEQUENCE',
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      const position = sanitizeNumber(data?.position);
      // `ended` est une information de fin de lecture, jamais une demande de
      // lecture : même si le lecteur envoie encore isPlaying=true, l'état serveur
      // doit rester en pause.
      const isPlaying = reason === 'ended' ? false : data?.isPlaying === true;
      const before = snapshotPlayback(r);
      r.appliedCommands[commandId] = { seq, at: Date.now() };
      const commandIds = Object.keys(r.appliedCommands);
      if (commandIds.length > 200) {
        commandIds
          .sort((a, b) => r.appliedCommands[a].at - r.appliedCommands[b].at)
          .slice(0, commandIds.length - 200)
          .forEach((stale) => { delete r.appliedCommands[stale]; });
      }

      const state = advancePlayback(roomId, r, {
        isPlaying,
        position: position === null ? 0 : position,
        updatedBy: socket.id,
        reason,
        commandId
      }, socket.id, seq);
      if (!state) {
        delete r.appliedCommands[commandId];
        return;
      }

      // Seuls les heartbeats restent transitoires : ils ne doivent pas écrire
      // dans le journal ni être annoncés comme durables.
      const durable = reason !== 'heartbeat';
      if (durable) {
        const persisted = await persistMutation(roomId, {
          type: 'playback',
          state: playbackDelta(r)
        }, { journalSeq: null });
        if (!persisted.ok) {
          restorePlayback(r, before);
          delete r.appliedCommands[commandId];
          sendPlaybackAck(socket, {
            commandId,
            seq,
            accepted: false,
            code: 'PERSISTENCE_FAILED',
            reason,
            mediaEpoch: before.mediaEpoch,
            state: before.playbackState
          });
          return;
        }
      }

      // Une mutation concurrentielle peut avoir changé la room pendant l'fsync :
      // la commande journalisée est alors périmée et ne doit pas écraser l'état.
      if (r.playbackSeq !== seq || r.mediaEpoch !== before.mediaEpoch
        || pendingMediaChanges.has(roomId) || !getActiveRoom(roomId, socket)) {
        // Si le média n'a pas changé, la commande périmée ne doit pas laisser
        // son état spéculatif dans la room. Un changement de média garde au
        // contraire son propre état autoritaire.
        if (r.mediaEpoch === before.mediaEpoch) restorePlayback(r, before);
        sendPlaybackAck(socket, {
          commandId,
          seq,
          accepted: false,
          code: 'SUPERSEDED',
          durable: false,
          reason,
          mediaEpoch: r.mediaEpoch,
          state: r.playbackState
        });
        return;
      }

      sendPlaybackAck(socket, {
        commandId,
        seq,
        accepted: true,
        durable,
        reason,
        mediaEpoch: r.mediaEpoch,
        state
      });

      if (requestedSeq === null) socket.emit('playback:state', state);
      // Broadcast aux autres clients (exclure le sender pour éviter la boucle de feedback)
      emitPlaybackUpdate(roomId, r, state, {
        exceptSocket: socket,
        originCommandId: commandId,
        scheduleAction: reason !== 'heartbeat' ? (reason === 'ended' ? 'pause' : reason) : null
      });
    });
  });

  // Control request from participant
  socket.on('control:request', () => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id === r.hostId || r.coHosts.includes(socket.id)) return; // Already has control
    const me = r.participants.find(p => p.id === socket.id);
    if (!me) return;
    // Check if already pending
    if (r.pendingControlRequests.some(req => req.participantId === socket.id)) return;
    r.pendingControlRequests.push({
      participantId: socket.id,
      nickname: me.nickname,
      requestedAt: Date.now()
    });
    // Notify host of request
    const hostSocket = watchpartyIO.sockets.get(r.hostId);
    if (hostSocket) {
      hostSocket.emit('control:requestReceived', { participantId: socket.id, nickname: me.nickname });
    }
    // Broadcast updated control state
    watchpartyIO.to(roomId).emit('control:state', {
      controlMode: r.controlMode,
      coHosts: r.coHosts,
      pendingRequests: r.pendingControlRequests
    });
  });

  // Host approves control request
  socket.on('control:approve', (payload) => {
    const { participantId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return; // Only host can approve
    // Une demande inexistante ne doit pas pouvoir être approuvée « à l'aveugle ».
    const pending = r.pendingControlRequests.find(req => req.participantId === participantId);
    if (!pending) return;
    // Validate that the target is a current participant.
    const targetParticipant = r.participants.find((p) => p.id === participantId);
    if (!targetParticipant) return;
    // Remove from pending
    r.pendingControlRequests = r.pendingControlRequests.filter(req => req.participantId !== participantId);
    // Add to co-hosts if not already
    if (!r.coHosts.includes(participantId)) {
      r.coHosts.push(participantId);
    }
    // Notify the participant
    const targetSocket = watchpartyIO.sockets.get(participantId);
    if (targetSocket) {
      targetSocket.emit('control:approved');
    }
    // System message
    const participant = r.participants.find(p => p.id === participantId);
    const systemMsg = systemMessage(r, `${participant?.nickname || 'Un participant'} peut maintenant contrôler la lecture.`);
    watchpartyIO.to(roomId).emit('room:chat', systemMsg);
    // Broadcast updated control state
    watchpartyIO.to(roomId).emit('control:state', {
      controlMode: r.controlMode,
      coHosts: r.coHosts,
      pendingRequests: r.pendingControlRequests
    });
  });

  // Host denies control request
  socket.on('control:deny', (payload) => {
    const { participantId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    r.pendingControlRequests = r.pendingControlRequests.filter(req => req.participantId !== participantId);
    const targetSocket = watchpartyIO.sockets.get(participantId);
    if (targetSocket) {
      targetSocket.emit('control:denied');
    }
    watchpartyIO.to(roomId).emit('control:state', {
      controlMode: r.controlMode,
      coHosts: r.coHosts,
      pendingRequests: r.pendingControlRequests
    });
  });

  // Host revokes control from co-host
  socket.on('control:revoke', (payload) => {
    const { participantId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    r.coHosts = r.coHosts.filter(id => id !== participantId);
    const targetSocket = watchpartyIO.sockets.get(participantId);
    if (targetSocket) {
      targetSocket.emit('control:revoked');
    }
    watchpartyIO.to(roomId).emit('control:state', {
      controlMode: r.controlMode,
      coHosts: r.coHosts,
      pendingRequests: r.pendingControlRequests
    });
  });

  // Host toggles control mode
  socket.on('control:setMode', (payload) => {
    const { mode } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    if (mode === 'host-only' || mode === 'democratic') {
      r.controlMode = mode;
      if (mode === 'host-only') {
        // Switching back from democratic mode must really lock the room.
        const previouslyGranted = [...r.coHosts];
        r.coHosts = [];
        previouslyGranted.forEach((participantId) => {
          watchpartyIO.sockets.get(participantId)?.emit('control:revoked');
        });
        // Une demande restante pourrait être approuvée après le verrouillage.
        r.pendingControlRequests = [];
      }
      const systemMsg = systemMessage(r, mode === 'democratic'
        ? '🎮 Mode démocratique activé - Tout le monde peut contrôler la lecture !'
        : '🔒 Mode hôte activé - Seul l\'hôte contrôle la lecture.');
      watchpartyIO.to(roomId).emit('room:chat', systemMsg);
      watchpartyIO.to(roomId).emit('control:state', {
        controlMode: r.controlMode,
        coHosts: r.coHosts,
        pendingRequests: r.pendingControlRequests
      });
    }
  });

  socket.on('sync:setMode', (payload) => {
    const { mode } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    if (mode !== 'classic' && mode !== 'pro') return;
    if (r.syncMode === mode) return;

    r.syncMode = mode;
    const systemMsg = systemMessage(r, mode === 'pro'
      ? 'Sync Pro activé par l’hôte. La synchronisation avancée est maintenant active.'
      : 'Le mode de synchronisation classique a été réactivé par l’hôte.');
    watchpartyIO.to(roomId).emit('room:chat', systemMsg);
    watchpartyIO.to(roomId).emit('sync:modeChanged', {
      mode,
      changedBy: socket.id
    });
    emitRoomInfo(roomId, r);
  });

  socket.on('sync:probe', (payload) => {
    const { probeId, clientSentAt } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    const serverReceivedAt = Date.now();
    socket.emit('sync:probeResult', {
      probeId,
      clientSentAt,
      serverReceivedAt,
      serverSentAt: Date.now()
    });
  });

  socket.on('playback:buffering', (payload) => {
    const { isBuffering, position } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (!r.participants.some((participant) => participant.id === socket.id)) return;
    const requestedSeq = Number.isSafeInteger(payload?.seq) ? payload.seq : null;
    // Un buffering ancien (avant un seek plus récent) ne doit pas figer les
    // autres participants sur une position obsolète.
    if (requestedSeq !== null && requestedSeq < r.playbackSeq) return;
    socket.to(roomId).emit('playback:buffering', {
      participantId: socket.id,
      isBuffering: !!isBuffering,
      position: Number.isFinite(position) ? position : 0,
      seq: requestedSeq || r.playbackSeq,
      mediaEpoch: r.mediaEpoch
    });
  });

  socket.on('room:close', async () => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    clearRoomTimers(roomId);
    const result = await persistRoomDeletion(roomId);
    if (!result?.ok) {
      socket.emit('error', { message: 'La fermeture n’a pas pu être persistée.' });
      return;
    }
    watchpartyIO.to(roomId).emit('room:closed', { reason: 'L’hôte a fermé cette salle.' });
    for (const participant of [...r.participants]) {
      const participantSocket = watchpartyIO.sockets.get(participant.id);
      if (participantSocket) participantSocket.disconnect(true);
    }
    watchpartyRooms.delete(roomId);
    emitPublicRooms();
  });

  socket.on('host:transfer', (payload) => {
    const { participantId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId || !participantId || participantId === socket.id) return;
    const target = r.participants.find(participant => participant.id === participantId);
    const targetSocket = watchpartyIO.sockets.get(participantId);
    if (!target || !targetSocket || !targetSocket.data?.token) return;

    const targetToken = hashToken(targetSocket.data.token);
    if (!Object.prototype.hasOwnProperty.call(r.accessTokens, targetToken)) return;

    const oldHostSocket = watchpartyIO.sockets.get(r.hostId);
    const oldHostToken = oldHostSocket?.data?.token;
    const oldHost = r.participants.find(participant => participant.id === r.hostId);
    if (oldHostToken) {
      r.accessTokens[hashToken(oldHostToken)] = {
        nickname: oldHost?.nickname || 'Host',
        issuedAt: Date.now()
      };
      if (oldHostSocket) oldHostSocket.data.role = 'member';
    }

    delete r.accessTokens[targetToken];
    r.hostToken = targetToken;
    r.hostTokens = new Set([targetToken]);
    targetSocket.data.role = 'host';
    r.hostId = target.id;
    r.coHosts = r.coHosts.filter(id => id !== target.id && id !== oldHost?.id);
    r.pendingControlRequests = r.pendingControlRequests.filter(request => request.participantId !== target.id);
    r.participants.forEach(participant => { participant.isHost = participant.id === target.id; });

    const message = systemMessage(r, `${target.nickname} est maintenant l'hôte de la Watch Party.`);
    watchpartyIO.to(roomId).emit('room:chat', message);
    watchpartyIO.to(roomId).emit('host:transferred', { hostId: target.id, previousHostId: oldHost?.id || null });
    persistRoom(roomId);
    emitControlState(roomId, r);
    emitRoomInfo(roomId, r);
    watchpartyIO.to(roomId).emit('room:participants', r.participants);
  });

  socket.on('room:setVisibility', (payload) => {
    const { isPublic } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    // Un refus silencieux laissait l'invité croire que le basculement avait
    // réussi alors que l'UI n'était pas rafraîchie.
    if (socket.id !== r.hostId) {
      socket.emit('error', { message: 'Seul l’hôte peut modifier la visibilité du salon.' });
      return;
    }
    r.isPublic = isPublic === true;
    const me = r.participants.find(participant => participant.id === socket.id);
    watchpartyIO.to(roomId).emit('room:chat', systemMessage(r, `${me?.nickname || 'L’hôte'} a ${r.isPublic ? 'rendu la salle publique' : 'rendu la salle privée'}.`));
    emitRoomInfo(roomId, r);
    emitPublicRooms();
  });

  socket.on('room:toggleChat', (payload) => {
    const { enabled } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    r.chatEnabled = enabled !== false;
    watchpartyIO.to(roomId).emit('room:chatToggled', { enabled: r.chatEnabled });
    emitRoomInfo(roomId, r);
  });

  socket.on('room:setMaxParticipants', (payload) => {
    const { max } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId) return;
    const parsedMax = Math.max(2, r.participants.length, Math.min(MAX_PARTICIPANTS_CAP, Number(max) || 10));
    r.maxParticipants = parsedMax;
    emitRoomInfo(roomId, r);
  });

  socket.on('media:change', (media) => {
    // Marquage SYNCHRONE : un seek déjà en fsync doit être déclaré SUPERSEDED
    // même si ce handler est placé derrière lui dans la file de la room.
    const arrivalRoom = getActiveRoom(roomId, socket);
    const arrivalAllowed = !!arrivalRoom && (
      socket.id === arrivalRoom.hostId
      || arrivalRoom.coHosts.includes(socket.id)
      || arrivalRoom.controlMode === 'democratic'
    );
    const arrivalMedia = sanitizeMedia(media);
    const marked = arrivalAllowed && !!arrivalMedia;
    if (marked) markMediaChange(roomId);

    enqueuePlaybackCommand(roomId, async () => {
      try {
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      const canControl = socket.id === r.hostId
        || r.coHosts.includes(socket.id)
        || r.controlMode === 'democratic';
      if (!canControl) return;

      const sanitized = arrivalMedia || sanitizeMedia(media);
      if (!sanitized) return;
      const before = snapshotPlayback(r);
      const expectedEpoch = r.mediaEpoch + 1;
      r.media = sanitized;
      r.mediaEpoch = expectedEpoch;
      if (r.pauseTimerTimeout) clearTimeout(r.pauseTimerTimeout);
      r.pauseTimerTimeout = null;
      r.pauseTimer = null;
      r.readyState = {};
      if (r.countdownTimer) clearTimeout(r.countdownTimer);
      r.countdownTimer = null;
      if (r.countdown) watchpartyIO.to(roomId).emit('room:countdownCancelled');
      r.countdown = null;
      if (r.pauseVote?.timeoutId) clearTimeout(r.pauseVote.timeoutId);
      r.pauseVote = null;
      const state = advancePlayback(roomId, r, {
        isPlaying: false,
        position: 0,
        updatedBy: socket.id,
        reason: 'media-changed'
      }, socket.id);
      if (!state) return;
      captureAuthorizationBaseline(before, r);

      // Le journal garde des métadonnées, jamais l'URL ni les query secrets.
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'media-change',
        mediaEpoch: expectedEpoch,
        media: {
          title: sanitized.title || null,
          mediaType: sanitized.mediaType || null
        },
        state: playbackDelta(r),
        countdown: null,
        pauseTimer: null,
        pauseVote: null
      }, before, { snapshot: true });
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || r.mediaEpoch !== expectedEpoch) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      watchpartyIO.to(roomId).emit('ready:state', r.readyState);
      // Toute commande déjà programmée appartenait au média précédent : le client
      // doit purge sa file avant d'appliquer le nouvel état.
      watchpartyIO.to(roomId).emit('playback:scheduleCancelled', {
        reason: 'media-changed',
        mediaEpoch: r.mediaEpoch,
        lastSeq: r.playbackSeq
      });
      watchpartyIO.to(roomId).emit('media:updated', r.media);
      watchpartyIO.to(roomId).emit('playback:state', state);
      emitRoomInfo(roomId, r);
      } finally {
        if (marked) releaseMediaChange(roomId);
      }
    });
  });

  // A synchronized start is only allowed after every current participant
  // explicitly marks themselves ready. The server is the single countdown clock.
  socket.on('room:startCountdown', () => {
    enqueuePlaybackCommand(roomId, async () => {
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      if (socket.id !== r.hostId || r.participants.length < 2) return;
      const everyoneReady = r.participants.every(participant => r.readyState[participant.id] === true);
      if (!everyoneReady) {
        socket.emit('room:startCountdownDenied', { message: 'Tout le monde doit être prêt avant le départ.' });
        return;
      }
      if (r.countdownTimer) clearTimeout(r.countdownTimer);
      const before = snapshotPlayback(r);
      const startAt = Date.now() + 5000;
      r.countdown = { startAt, startedBy: socket.id };
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'countdown-start',
        countdown: { ...r.countdown }
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || r.countdown?.startAt !== startAt) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      watchpartyIO.to(roomId).emit('room:countdown', r.countdown);
      scheduleCountdownTimer(roomId, r, startAt, socket.id);
    });
  });

  socket.on('room:cancelCountdown', () => {
    enqueuePlaybackCommand(roomId, async () => {
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      if (socket.id !== r.hostId || !r.countdown) return;
      const before = snapshotPlayback(r);
      if (r.countdownTimer) clearTimeout(r.countdownTimer);
      r.countdownTimer = null;
      r.countdown = null;
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'countdown-cancel',
        countdown: null
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || r.countdown !== null) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }
      watchpartyIO.to(roomId).emit('room:countdownCancelled');
    });
  });

  // Ready toggle
  socket.on('ready:toggle', () => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (r.countdown) return;
    r.readyState[socket.id] = !r.readyState[socket.id];
    watchpartyIO.to(roomId).emit('ready:state', r.readyState);
  });

  // Emoji reaction
  socket.on('reaction:send', (payload) => {
    const { emoji } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    const me = r.participants.find(p => p.id === socket.id);
    if (!me) return;
    const cleanEmoji = sanitizeString(emoji, MAX_EMOJI_LENGTH);
    const allowedEmojis = new Set(['😂', '❤️', '🔥', '😱', '👏', '😭', '🍿', '👀', '💀', '😍']);
    const now = Date.now();
    if (!allowedEmojis.has(cleanEmoji) || now - (socket.data.lastReactionAt || 0) < 650) return;
    socket.data.lastReactionAt = now;
    watchpartyIO.to(roomId).emit('reaction:received', {
      id: uuidv4(),
      emoji: cleanEmoji,
      senderId: socket.id,
      senderNickname: me.nickname,
      timestamp: Date.now()
    });
  });

  // Pause timer start (host or co-host)
  socket.on('pause:start', (payload) => {
    enqueuePlaybackCommand(roomId, async () => {
      const { duration } = payload || {};
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      const canControl = socket.id === r.hostId || r.coHosts.includes(socket.id);
      if (!canControl) return;
      const safeDuration = clampPauseDuration(duration);
      const before = snapshotPlayback(r);
      const wasPlaying = r.playbackState?.isPlaying === true;
      if (r.pauseTimerTimeout) clearTimeout(r.pauseTimerTimeout);
      r.pauseTimerTimeout = null;
      r.pauseTimer = {
        endTime: Date.now() + safeDuration * 1000,
        startedBy: socket.id,
        duration: safeDuration,
        resumeAfterPause: wasPlaying
      };
      const state = advancePlayback(roomId, r, {
        isPlaying: false,
        updatedBy: socket.id,
        reason: 'pause'
      }, socket.id);
      if (!state) return;
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'pause-start',
        state: playbackDelta(r),
        pauseTimer: { ...r.pauseTimer }
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || r.mediaEpoch !== before.mediaEpoch) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      schedulePauseAutoResume(roomId, r);
      emitPlaybackUpdate(roomId, r, state, { scheduleAction: 'pause' });
      watchpartyIO.to(roomId).emit('pause:timerStarted', r.pauseTimer);
      const me = r.participants.find(p => p.id === socket.id);
      const systemMsg = systemMessage(r, `⏸️ ${me?.nickname || 'L\'hôte'} a lancé une pause de ${safeDuration} secondes.`);
      watchpartyIO.to(roomId).emit('room:chat', systemMsg);
    });
  });

  // Pause timer cancel
  socket.on('pause:cancel', () => {
    enqueuePlaybackCommand(roomId, async () => {
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      const canControl = socket.id === r.hostId || r.coHosts.includes(socket.id);
      if (!canControl || !r.pauseTimer) return;
      const before = snapshotPlayback(r);
      const shouldResume = r.pauseTimer.resumeAfterPause === true;
      if (r.pauseTimerTimeout) clearTimeout(r.pauseTimerTimeout);
      r.pauseTimerTimeout = null;
      r.pauseTimer = null;
      let state = null;
      if (shouldResume) {
        state = advancePlayback(roomId, r, {
          isPlaying: true,
          updatedBy: socket.id,
          reason: 'play'
        }, socket.id);
      }
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'pause-cancel',
        state: state ? playbackDelta(r) : null,
        pauseTimer: null
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || r.mediaEpoch !== before.mediaEpoch) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      if (state) emitPlaybackUpdate(roomId, r, state, { scheduleAction: 'play' });
      watchpartyIO.to(roomId).emit('pause:timerCancelled');
    });
  });

  // Vote request for pause (guests only)
  socket.on('vote:request', (payload) => {
    enqueuePlaybackCommand(roomId, async () => {
      const { duration } = payload || {};
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      if (socket.id === r.hostId || r.coHosts.includes(socket.id)) return;
      if (r.pauseVote) return;

      const me = r.participants.find(p => p.id === socket.id);
      if (!me) return;

      const before = snapshotPlayback(r);
      const requestedDuration = clampPauseDuration(duration);
      const voteDuration = 20000; // 20 seconds to vote
      r.pauseVote = {
        requestedBy: socket.id,
        requestedByNickname: me.nickname,
        requestedDuration,
        votes: {}, // participantId -> true (yes) or false (no)
        endTime: Date.now() + voteDuration,
        totalParticipants: r.participants.length
      };
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'vote-request',
        pauseVote: {
          requestedBy: r.pauseVote.requestedBy,
          requestedByNickname: r.pauseVote.requestedByNickname,
          requestedDuration: r.pauseVote.requestedDuration,
          votes: r.pauseVote.votes,
          endTime: r.pauseVote.endTime,
          totalParticipants: r.pauseVote.totalParticipants
        }
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || !r.pauseVote) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      scheduleVoteDeadline(roomId, r);
      watchpartyIO.to(roomId).emit('vote:started', {
        requestedBy: socket.id,
        requestedByNickname: me.nickname,
        requestedDuration,
        endTime: r.pauseVote.endTime,
        totalParticipants: r.participants.length
      });
      const voteMsg = systemMessage(r, `${me.nickname} a demandé une pause de ${requestedDuration}s. Vote en cours...`);
      watchpartyIO.to(roomId).emit('room:chat', voteMsg);
    });
  });

  // Cast vote
  socket.on('vote:cast', (payload) => {
    enqueuePlaybackCommand(roomId, async () => {
      const { vote } = payload || {};
      const r = getActiveRoom(roomId, socket);
      if (!r) return;
      if (!r.pauseVote) return;
      if (Date.now() > r.pauseVote.endTime) return;

      const before = snapshotPlayback(r);
      r.pauseVote.votes[socket.id] = vote === true;
      captureAuthorizationBaseline(before, r);
      const ok = await persistAuthoritativeMutation(roomId, {
        type: 'vote-cast',
        pauseVote: {
          requestedBy: r.pauseVote.requestedBy,
          requestedByNickname: r.pauseVote.requestedByNickname,
          requestedDuration: r.pauseVote.requestedDuration,
          votes: r.pauseVote.votes,
          endTime: r.pauseVote.endTime,
          totalParticipants: r.pauseVote.totalParticipants
        }
      }, before);
      const authorized = assertStillAuthorized(roomId, socket, before);
      if (!ok || !authorized || !r.pauseVote) {
        if (!ok || !authorized) restoreMutationState(r, before);
        return;
      }

      emitVoteUpdate(roomId, r);
      if (Object.keys(r.pauseVote.votes).length >= r.participants.length) resolveVote(roomId);
    });
  });

  // Delete message (host only)
  socket.on('message:delete', (payload) => {
    const { messageId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId || !messageId) return;
    const idx = r.messages.findIndex(m => m.id === messageId);
    if (idx !== -1) {
      r.messages[idx].deleted = true;
      watchpartyIO.to(roomId).emit('message:deleted', { messageId });
    }
  });

  // Kick participant (host only)
  socket.on('participant:kick', (payload) => {
    const { participantId } = payload || {};
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    if (socket.id !== r.hostId || !participantId || participantId === r.hostId) return;
    const target = r.participants.find(p => p.id === participantId);
    if (!target) return;
    r.coHosts = r.coHosts.filter((id) => id !== participantId);
    r.pendingControlRequests = r.pendingControlRequests.filter((req) => req.participantId !== participantId);
    delete r.readyState[participantId];
    const s = watchpartyIO.sockets.get(participantId);
    if (s) {
      // Sans révocation du token, l'exclu se reconnectait immédiatement.
      if (s.data?.token && s.data.role !== 'host') delete r.accessTokens[hashToken(s.data.token)];
      s.emit('room:kicked', { reason: 'You have been removed from the watch party by the host.' });
      s.disconnect(true);
    }
    // La déconnexion asynchrone n'arrive pas toujours assez vite : publier
    // immédiatement la liste sans l'exclu évite un participant fantôme.
    r.participants = r.participants.filter(participant => participant.id !== participantId);
    emitVoteUpdate(roomId, r);
    watchpartyIO.to(roomId).emit('room:participants', r.participants);
    watchpartyIO.to(roomId).emit('ready:state', r.readyState);
    persistRoom(roomId);
    const kickMessage = systemMessage(r, `${target.nickname} a été retiré de la Watch Party.`);
    watchpartyIO.to(roomId).emit('room:chat', kickMessage);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const r = getActiveRoom(roomId, socket);
    if (!r) return;
    const idx = r.participants.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    const leaving = r.participants[idx];
    r.participants.splice(idx, 1);
    delete r.readyState[socket.id];
    emitVoteUpdate(roomId, r);
    // Garder le nombre de participants du lobby synchronisé aux déconnexions.
    emitPublicRooms();
    if (r.countdown) {
      if (r.countdownTimer) clearTimeout(r.countdownTimer);
      r.countdownTimer = null;
      r.countdown = null;
      watchpartyIO.to(roomId).emit('room:countdownCancelled');
    }

    const leaveMessage = systemMessage(r, `${leaving.nickname} a quitté la Watch Party.`);

    // A mobile browser may suspend its socket when the host switches apps.
    // Keep the host token valid and wait briefly before transferring ownership.
    if (socket.id === r.hostId && r.participants.length > 0) {
      r.hostId = null;
      const existingTimer = hostDisconnectTimers.get(roomId);
      if (existingTimer) clearTimeout(existingTimer);
      const transferTimer = setTimeout(() => {
        hostDisconnectTimers.delete(roomId);
        const current = watchpartyRooms.get(roomId);
        // A reconnecting host has already reclaimed the room.
        if (!current || current.hostId || current.participants.length === 0) return;

        const newHost = current.participants.sort((a, b) => a.joinedAt - b.joinedAt)[0];
        const newHostToken = generateToken();
        current.hostToken = hashToken(newHostToken);
        current.hostTokens = new Set([current.hostToken]);
        current.hostId = newHost.id;
        current.participants.forEach((participant) => {
          participant.isHost = participant.id === newHost.id;
        });

        const newHostSocket = watchpartyIO.sockets.get(newHost.id);
        if (newHostSocket) newHostSocket.emit('host:token', { token: newHostToken });

        const newHostMsg = systemMessage(current, `${newHost.nickname} est maintenant l'hôte de la Watch Party.`);
        watchpartyIO.to(roomId).emit('room:chat', newHostMsg);
        watchpartyIO.to(roomId).emit('room:participants', current.participants);
        emitRoomInfo(roomId, current);
        persistRoom(roomId);
        console.log(`[Watchparty] Host ownership transferred for room ${roomId} after reconnect grace period.`);
      }, HOST_RECONNECT_GRACE_MS);
      transferTimer.unref?.();
      hostDisconnectTimers.set(roomId, transferTimer);
    } else if (socket.id === r.hostId) {
      // Sans participant, personne ne peut prendre le relais : libérer
      // immédiatement l'identifiant pour ne pas conserver un socket mort.
      r.hostId = null;
    }

    // Clean stale permission/request entries for the leaving participant.
    r.coHosts = r.coHosts.filter((id) => id !== socket.id);
    r.pendingControlRequests = r.pendingControlRequests.filter((req) => req.participantId !== socket.id);

    // If empty, auto-clean after 5 min
    if (r.participants.length === 0) {
      if (r._cleanupTimer) clearTimeout(r._cleanupTimer);
      r._cleanupTimer = setTimeout(async () => {
        const still = watchpartyRooms.get(roomId);
        if (!still || still.participants.length !== 0) return;
        clearRoomTimers(roomId);
        const result = await persistRoomDeletion(roomId);
        if (!result?.ok) {
          console.error(`[Watchparty] Suppression non persistée pour ${roomId}; salle conservée.`);
          return;
        }
        watchpartyRooms.delete(roomId);
        emitPublicRooms();
        console.log(`Room ${roomId} closed due to inactivity`);
      }, 5 * 60 * 1000);
    } else {
      watchpartyIO.to(roomId).emit('room:participants', r.participants);
      watchpartyIO.to(roomId).emit('ready:state', r.readyState);
      watchpartyIO.to(roomId).emit('room:chat', leaveMessage);
      emitRoomInfo(roomId, r);
    }
    persistRoom(roomId);
  });
});

// --- Routes API (mêmes que le serveur principal) ---

// Nombre de rooms actives par IP, pour empêcher qu'un seul client sature la mémoire.
function countRoomsForIp(ip) {
  let count = 0;
  for (const room of watchpartyRooms.values()) {
    if (room.createdByIp === ip) count++;
  }
  return count;
}

app.post(
  '/api/watchparty/create',
  rateLimit({ windowMs: 60_000, max: 10, key: 'create', message: 'Too many watch parties created. Please wait a moment.' }),
  async (req, res) => {
    try {
      const { nickname, maxParticipants, media, roomName, isPublic, syncMode } = req.body || {};
      const cleanNickname = sanitizeNickname(nickname);
      const cleanMedia = sanitizeMedia(media);
      if (!nickname || !cleanMedia) {
        return res.status(400).json({ success: false, message: 'Missing required fields: nickname, media.src' });
      }

      // Plafonds mémoire : les rooms vivent jusqu'à 12 h et un POST non
      // authentifié suffisait à en créer autant qu'on voulait.
      if (watchpartyRooms.size >= MAX_ROOMS) {
        return res.status(503).json({ success: false, message: 'Server at capacity. Please try again later.' });
      }
      if (countRoomsForIp(getClientIp(req)) >= MAX_ROOMS_PER_IP) {
        return res.status(429).json({ success: false, message: 'Too many active watch parties for this client.' });
      }

      // Le code est généré côté serveur : accepter celui du client permettait de
      // squatter un code et de bloquer sa réutilisation.
      const code = generateUniqueRoomCode();
      if (!code) return res.status(503).json({ success: false, message: 'Could not allocate a room code. Please try again.' });

      const roomId = uuidv4();
      const hostToken = generateToken();
      const hostTokenFingerprint = hashToken(hostToken);
      const position = sanitizeNumber(media?.position);

      const newRoom = {
        id: roomId,
        code,
        name: sanitizeString(roomName, 80),
        hostId: null,
        hostToken: hostTokenFingerprint, // empreinte : le secret ne sort que dans la réponse
        hostTokens: new Set([hostTokenFingerprint]), // jetons d'hôte valides (transfert révoque les anciens)
        accessTokens: Object.create(null), // empreinte -> { nickname, issuedAt }
        createdByIp: getClientIp(req),
        maxParticipants: Math.max(2, Math.min(MAX_PARTICIPANTS_CAP, Number(maxParticipants) || 10)),
        isPublic: isPublic === true,
        syncMode: syncMode === 'pro' ? 'pro' : 'classic',
        chatEnabled: true,
        controlMode: 'host-only', // 'host-only' | 'democratic'
        coHosts: [],              // Array of participant IDs with control
        pendingControlRequests: [], // Array of {participantId, nickname, requestedAt}
        readyState: {},           // Map: participantId -> boolean
        pauseTimer: null,         // {endTime, startedBy, duration, resumeAfterPause} or null
        pauseTimerTimeout: null,
        pauseVote: null,          // {requestedBy, requestedDuration, votes: {participantId: boolean}, endTime, timeoutId}
        media: cleanMedia,
        participants: [],
        messages: [],
        countdown: null,
        countdownTimer: null,
        reactionCooldowns: {},
        playbackState: {
          isPlaying: media?.isPlaying === true,
          position: position === null ? 0 : position,
          updatedAt: Date.now(),
          updatedBy: 'system',
          seq: 0,
          mediaEpoch: 1
        },
        playbackSeq: 0,
        mediaEpoch: 1,
        appliedCommands: Object.create(null),
        createdAt: Date.now()
      };

      watchpartyRooms.set(roomId, newRoom);
      const created = await persistRoom(roomId, 'room-created', { snapshot: true });
      if (!created.ok) return res.status(503).json({ success: false, message: 'Persistance indisponible.' });
      emitPublicRooms();
      // `hostToken` n'est renvoyé qu'ici, au créateur, et lie l'hôte à la room.
      res.status(200).json({ success: true, roomId, roomCode: code, hostToken, token: hostToken, nickname: cleanNickname });
    } catch (e) {
      console.error('Error creating watch party:', e);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.post(
  '/api/watchparty/join',
  rateLimit({ windowMs: 60_000, max: 30, key: 'join', message: 'Too many join attempts. Please slow down.' }),
  (req, res) => {
    try {
      const { roomCode, nickname } = req.body || {};
      const cleanCode = sanitizeString(roomCode, 6).toUpperCase();
      const cleanNickname = sanitizeNickname(nickname);
      if (!cleanCode || !nickname) return res.status(400).json({ success: false, message: 'Missing required fields: roomCode, nickname' });

      let foundRoomId = null; let foundRoom = null;
      for (const [id, room] of watchpartyRooms.entries()) {
        if (room.code === cleanCode) { foundRoomId = id; foundRoom = room; break; }
      }
      if (!foundRoomId) return res.status(404).json({ success: false, message: 'Watch party not found. Please check the room code and try again.' });
      if (foundRoom.participants.length >= foundRoom.maxParticipants) return res.status(400).json({ success: false, message: 'This watch party is full.' });

      const token = issueAccessToken(foundRoom, cleanNickname);
      persistRoom(foundRoomId);
      res.status(200).json({ success: true, roomId: foundRoomId, roomCode: cleanCode, token, nickname: cleanNickname });
    } catch (e) {
      console.error('Error joining watch party:', e);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.get('/api/watchparty/room/:roomId', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { roomId } = req.params;
  if (!watchpartyRooms.has(roomId)) return res.status(404).json({ message: 'Room not found' });
  const room = watchpartyRooms.get(roomId);

  // `media` contient les URLs de flux : réservé aux porteurs d'un token de la room.
  const role = resolveRoomRole(room, extractRequestToken(req));
  if (!role) return res.status(403).json({ message: 'Forbidden: missing or invalid room token' });

  res.json({
    room: {
      id: roomId,
      code: room.code,
      name: room.name || '',
      hostId: room.hostId,
      maxParticipants: room.maxParticipants,
      isPublic: !!room.isPublic,
      syncMode: room.syncMode || 'classic',
      chatEnabled: room.chatEnabled !== false,
      controlMode: room.controlMode,
      coHosts: room.coHosts,
      media: room.media,
      createdAt: room.createdAt,
      participants: room.participants.map(p => ({ id: p.id, nickname: p.nickname, isHost: p.id === room.hostId, isActive: p.isActive })),
      playbackState: room.playbackState,
      readyState: room.readyState || {},
      countdown: room.countdown || null,
      pauseTimer: room.pauseTimer || null,
      pauseVote: room.pauseVote ? {
        requestedBy: room.pauseVote.requestedBy,
        requestedByNickname: room.pauseVote.requestedByNickname,
        requestedDuration: room.pauseVote.requestedDuration,
        endTime: room.pauseVote.endTime,
        totalParticipants: room.pauseVote.totalParticipants,
        yesVotes: Object.values(room.pauseVote.votes || {}).filter(Boolean).length,
        noVotes: Object.values(room.pauseVote.votes || {}).filter(value => value === false).length,
        totalVotes: Object.keys(room.pauseVote.votes || {}).length
      } : null
    }
  });
});

app.get('/api/watchparty/info/:code', rateLimit({ windowMs: 1000, max: 10, key: 'info' }), (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const code = sanitizeString(req.params.code, 6).toUpperCase();
    let foundRoom = null;
    for (const room of watchpartyRooms.values()) { if (room.code === code) { foundRoom = room; break; } }
    if (!foundRoom) return res.status(404).json({ success: false, message: 'Watch party not found' });
    res.status(200).json({
      success: true, room: {
        title: foundRoom.media.title,
        mediaType: foundRoom.media.mediaType,
        participantCount: foundRoom.participants.length,
        maxParticipants: foundRoom.maxParticipants,
        isPublic: !!foundRoom.isPublic,
        syncMode: foundRoom.syncMode || 'classic'
      }
    });
  } catch (e) {
    console.error('Error getting watch party info by code:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/watchparty/public', rateLimit({ windowMs: 1000, max: 10, key: 'public' }), (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, rooms: buildPublicRoomSnapshot() });
  } catch (e) {
    console.error('Error listing public watch parties:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Route d'administration : elle expose toutes les rooms, y compris privées.
// Elle exige WATCHPARTY_ADMIN_SECRET (header `x-admin-secret`) et est limitée à
// 5 requêtes/seconde. Le front ne l'utilise pas.
app.get(
  '/api/watchparty/all',
  rateLimit({ windowMs: 1000, max: 5, key: 'all' }),
  requireAdminSecret,
  (_req, res) => {
    try {
      const allRooms = Array.from(watchpartyRooms.entries()).map(([id, room]) => ({
        id,
        code: room.code,
        hostId: room.hostId,
        maxParticipants: room.maxParticipants,
        isPublic: room.isPublic,
        syncMode: room.syncMode || 'classic',
        media: room.media,
        participants: room.participants,
        createdAt: room.createdAt,
        playbackState: room.playbackState,
        countdown: room.countdown ? { ...room.countdown } : null,
        pauseTimer: room.pauseTimer ? { ...room.pauseTimer } : null,
        pauseVote: room.pauseVote
          ? Object.fromEntries(Object.entries(room.pauseVote).filter(([key]) => key !== 'timeoutId'))
          : null
      }));
      res.status(200).json({ success: true, rooms: allRooms });
    } catch (e) {
      console.error('Error listing all watch parties:', e);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// Setup watchparty cleanup job (hourly)
setInterval(async () => {
  const nowTime = Date.now();
  const expiredRooms = [];

  // Find expired rooms (older than 12 hours or inactive for 3 hours)
  for (const [roomId, room] of watchpartyRooms.entries()) {
    const roomAge = nowTime - room.createdAt;
    const isExpired = roomAge > 12 * 60 * 60 * 1000; // 12 hours
    const isEmpty = room.participants.length === 0;
    const lastActivity = room.participants.length
      ? Math.max(...room.participants.map(p => p.joinedAt), room.createdAt)
      : room.createdAt;
    const inactiveFor = isEmpty ? nowTime - lastActivity : 0;
    const isInactive = isEmpty && inactiveFor > 3 * 60 * 60 * 1000; // 3 hours

    if (isExpired || isInactive) expiredRooms.push(roomId);
  }

  // Remove expired rooms : la suppression disque précède la suppression mémoire
  // et l'événement client, sinon un crash peut faire ressusciter la salle.
  for (const roomId of expiredRooms) {
    clearRoomTimers(roomId);
    const result = await persistRoomDeletion(roomId);
    if (!result?.ok) {
      console.error(`[Watchparty] Suppression non persistée pour ${roomId}; salle conservée.`);
      continue;
    }
    watchpartyIO.to(roomId).emit('room:closed', {
      reason: 'La Watch Party a été fermée pour inactivité ou expiration.'
    });
    watchpartyRooms.delete(roomId);
    console.log(`Room ${roomId} closed due to expiration or inactivity`);
  }
  if (expiredRooms.length > 0) emitPublicRooms();
}, 60 * 60 * 1000);

// Startup
(async () => {
  try {
    await acquireCacheLock();
  } catch (error) {
    console.error(`[Watchparty] Démarrage refusé: ${error.message}`);
    process.exit(1);
    return;
  }
  await loadRoomsFromDisk();
  scheduleRestoredTimers();
  await writeSnapshotNow(false);

  // Les listes distantes sont chargées AVANT d'écouter, pour qu'aucune requête
  // ne soit refusée le temps du premier téléchargement.
  const sourceCount = new Set([...WATCHPARTY_REST_CORS_ORIGIN.sources, ...WATCHPARTY_SOCKET_CORS_ORIGIN.sources]).size;
  if (sourceCount > 0) {
    const ok = await refreshRemoteOrigins();
    scheduleRemoteOriginRefresh(ok ? CORS_SOURCE_REFRESH_MS : CORS_SOURCE_RETRY_MS);
  }

  server.listen(PORT, () => console.log(`Watchparty server listening on http://localhost:${PORT}`));
})();
