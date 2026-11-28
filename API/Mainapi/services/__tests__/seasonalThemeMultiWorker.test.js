'use strict';

/**
 * Propagation réelle entre plusieurs workers Node (processus distincts) via
 * de vraies connexions TCP ioredis. Le serveur RESP local est un double de
 * test : il valide notre architecture de synchronisation, pas le comportement
 * d'un Redis de production (voir le rapport LOT 2 pour les limites).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const Redis = require('ioredis');

const { createRespServer } = require('./fixtures/seasonalThemeRespServer');

const WORKER_FILE = path.join(__dirname, 'fixtures', 'seasonalThemeWorker.js');
const PATCH = {
  themes: [
    {
      id: 'halloween-2026',
      enabled: true,
      decorations: [
        { id: 'halloween.background', enabled: true },
        { id: 'halloween.lights.candles', enabled: true },
      ],
    },
    {
      id: 'christmas-2026',
      enabled: true,
      decorations: [{ id: 'christmas.background', enabled: true }],
    },
  ],
};

function attachWorker(child, workerId) {
  const worker = { child, workerId, messages: [], waiters: [], logs: [] };
  child.stdout?.on('data', (chunk) => worker.logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => worker.logs.push(String(chunk)));
  child.on('message', (message) => {
    worker.messages.push(message);
    for (const waiter of [...worker.waiters]) {
      if (waiter.predicate(message)) {
        clearTimeout(waiter.timer);
        worker.waiters.splice(worker.waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  return worker;
}

function waitFor(worker, predicate, label, timeoutMs = 5000) {
  const existing = worker.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      worker.waiters.splice(worker.waiters.indexOf(waiter), 1);
      reject(new Error(`Timeout ${label} (worker ${worker.workerId}) : ${JSON.stringify(worker.messages.slice(-4))}`));
    }, timeoutMs);
    worker.waiters.push(waiter);
  });
}

function send(worker, message) {
  worker.child.send({ ...message, requestId: `${worker.workerId}-${Date.now()}` });
}

async function spawnWorker(port, workerId) {
  const child = fork(WORKER_FILE, [], {
    env: {
      ...process.env,
      SEASONAL_REDIS_PORT: String(port),
      SEASONAL_WORKER_ID: workerId,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const worker = attachWorker(child, workerId);
  await waitFor(worker, (message) => message.type === 'ready', 'ready', 10000);
  return worker;
}

async function stopWorkers(workers) {
  for (const worker of workers) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) continue;
    try {
      send(worker, { type: 'stop' });
      await Promise.race([
        new Promise((resolve) => worker.child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch { /* processus déjà terminé */ }
    if (worker.child.exitCode === null) worker.child.kill('SIGKILL');
  }
}

async function readPublished(worker, label) {
  send(worker, { type: 'read', label });
  return waitFor(worker, (message) => message.type === 'read' && message.label === label, `read ${label}`);
}

test('publication, arrêt d’urgence et pannes : 3 workers réels', { timeout: 90000 }, async () => {
  const server = createRespServer();
  const port = await server.listen();
  const workers = [];
  let directClient;

  try {
    workers.push(await spawnWorker(port, 'worker-1'));
    workers.push(await spawnWorker(port, 'worker-2'));
    workers.push(await spawnWorker(port, 'worker-3'));
    const [publisher, ...listeners] = workers;

    // --- Publication sans redéploiement -----------------------------------
    send(publisher, { type: 'publish', patch: PATCH });
    const published = await waitFor(publisher, (message) => message.type === 'published', 'published', 10000);
    assert.equal(published.revision, 1);
    const publishObservations = await Promise.all(listeners.map((worker) => waitFor(
      worker,
      (message) => message.type === 'observed' && message.event === 'config' && message.revision === 1,
      'observation publication',
      10000,
    )));
    // Les horloges absolues de processus distincts peuvent dériver de quelques
    // dixièmes de milliseconde : on borne l'écart et on ne retient que les
    // valeurs positives pour le rapport.
    const publishSkew = publishObservations.map((message) => message.at - published.at);
    assert.ok(publishSkew.every((ms) => Math.abs(ms) < 1000), `latences publication : ${publishSkew}`);
    const publishLatencies = publishSkew.map((ms) => Math.max(0, ms));
    for (const worker of listeners) {
      const read = await readPublished(worker, 'after-publish');
      assert.equal(read.emergencyDisable, false);
      assert.equal(read.revision, 1);
    }

    let revision = published.revision;
    const emergencyLatencies = [];

    // La confirmation qui compte est l'écriture Redis + PUBLISH, avant même
    // la fin de la transaction MySQL. Deux cycles distincts permettent de
    // vérifier la reproductibilité de la mesure.
    async function emergencyCycle(tag) {
      send(publisher, { type: 'emergency', enabled: true, tag });
      const confirmed = await waitFor(
        publisher,
        (message) => message.type === 'emergencyCommitted' && message.tag === tag,
        `confirmation Redis arrêt urgence ${tag}`,
        10000,
      );
      const set = await waitFor(
        publisher,
        (message) => message.type === 'emergencySet' && message.tag === tag,
        `emergencySet ${tag}`,
        10000,
      );
      revision = set.revision;
      const observations = await Promise.all(listeners.map((worker) => waitFor(
        worker,
        (message) => message.type === 'observed' && message.event === 'emergency'
          && message.epoch === confirmed.epoch && message.emergencyDisable === true,
        `observation urgence ${tag}`,
        10000,
      )));
      const skew = observations.map((message) => message.at - confirmed.at);
      assert.ok(skew.every((ms) => Math.abs(ms) < 1000), `latences arrêt d’urgence ${tag} : ${skew}`);
      const latencies = skew.map((ms) => Math.max(0, ms));
      emergencyLatencies.push(...latencies);
      for (const worker of listeners) {
        const read = await readPublished(worker, `after-emergency-${tag}`);
        assert.equal(read.emergencyDisable, true);
        assert.equal(read.failClosed, false);
      }
    }

    async function reenable(tag) {
      send(publisher, { type: 'emergency', enabled: false, tag });
      const set = await waitFor(
        publisher,
        (message) => message.type === 'emergencySet' && message.tag === tag,
        `réactivation ${tag}`,
        10000,
      );
      revision = set.revision;
      for (const worker of listeners) {
        const read = await readPublished(worker, `after-reenable-${tag}`);
        assert.equal(read.emergencyDisable, false);
        assert.equal(read.revision, revision);
      }
    }

    // --- Arrêt d'urgence : mesure après confirmation Redis ------------------
    await emergencyCycle('on-1');

    // Aucun worker ne peut publier une configuration active après l'arrêt.
    send(listeners[0], { type: 'publish', patch: { themes: [{ id: 'halloween-2026', enabled: false }] } });
    const rejected = await waitFor(
      listeners[0],
      (message) => message.type === 'error' && message.code === 'EMERGENCY_ACTIVE',
      'publication refusée après urgence',
    );
    assert.equal(rejected.code, 'EMERGENCY_ACTIVE');

    // --- Retour à une configuration active, puis second cycle ---------------
    await reenable('off-1');
    await emergencyCycle('on-2');
    await reenable('off-2');

    // --- Panne Redis : fail-closed sur tous les workers --------------------
    server.setDown(true);
    for (const worker of workers) {
      const read = await readPublished(worker, 'redis-down');
      assert.equal(read.emergencyDisable, true, `worker ${worker.workerId}`);
      assert.equal(read.failClosed, true, `worker ${worker.workerId}`);
    }
    send(listeners[0], { type: 'publish', patch: {} });
    const downError = await waitFor(
      listeners[0],
      (message) => message.type === 'error' && message.code === 'REDIS_UNAVAILABLE',
      'publication refusée Redis down',
    );
    assert.equal(downError.code, 'REDIS_UNAVAILABLE');

    server.setDown(false);
    send(listeners[0], { type: 'recover' });
    const recovered = await waitFor(listeners[0], (message) => message.type === 'recovered', 'recovery', 10000);
    assert.equal(recovered.revision, revision);
    assert.equal(recovered.emergencyDisable, false);
    assert.equal(recovered.failClosed, false);

    // --- Cache incohérent : fail-closed puis réconciliation -----------------
    directClient = new Redis({ host: '127.0.0.1', port, lazyConnect: false, maxRetriesPerRequest: 1 });
    await directClient.set('seasonal-theme:revision', '999');
    const incoherent = await readPublished(listeners[1], 'incoherent-cache');
    assert.equal(incoherent.emergencyDisable, true);
    assert.equal(incoherent.failClosed, true);
    await directClient.del('seasonal-theme:revision');
    send(listeners[1], { type: 'recover' });
    const reconciled = await waitFor(listeners[1], (message) => message.type === 'recovered', 'réconciliation', 10000);
    assert.equal(reconciled.revision, revision);
    assert.equal(reconciled.failClosed, false);

    console.log('[LOT2 measures] publish_ms=', publishLatencies, 'emergency_ms=', emergencyLatencies);
  } finally {
    if (directClient) directClient.disconnect();
    await stopWorkers(workers);
    await server.close();
  }
});
