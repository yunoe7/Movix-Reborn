import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverFile = path.join(repo, 'API', 'watchpartyAPI', 'watchparty.js');
const artifactDir = path.join(os.tmpdir(), 'opencode', 'watchparty-public-rooms-e2e');
const buildLogPath = path.join(artifactDir, 'build.log');
const apiLogPath = path.join(artifactDir, 'watchparty-api.log');
const reportPath = path.join(artifactDir, 'report.json');
const tracePath = path.join(artifactDir, 'trace.zip');
const screenshotPath = path.join(artifactDir, 'lobby-second-browser.png');

const PUBLIC_ROOM = 'E2E salle publique';
const PRIVATE_ROOM = 'E2E salle privée';
const TMDB_RESULT = {
  results: [{
    id: 550,
    media_type: 'movie',
    title: 'Fight Club',
    name: null,
    poster_path: '/e2e-poster.jpg',
    release_date: '1999-10-15',
    genre_ids: [18]
  }]
};
const SVG_PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="15"><rect width="10" height="15" fill="#333"/></svg>';

let apiOrigin;
let siteOrigin;
let apiChild;
let staticServer;
let browser;
let contexts = [];
let consoleErrors = [];
let pageErrors = [];
let routedRequests = [];
let buildStatus = 'not-run';
let observed = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactSecrets(value) {
  return String(value)
    .replace(/("token"\s*:\s*")[^"]+(")/g, '$1<redacted>$2')
    .replace(/([?&]token=)[^&#\s]+/g, '$1<redacted>');
}

async function findFreePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function startStaticServer(distDir, port) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
  };
  const server = createHttpServer((req, res) => {
    const pathname = new URL(req.url || '/', siteOrigin).pathname;
    let file = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(distDir, 'index.html');
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function waitForApi(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Le serveur écoute déjà le port mais n'a pas encore répondu.
    }
    await delay(200);
  }
  throw new Error(`L'API WatchParty de test n'a pas répondu : ${url}`);
}

async function stubExternalRequests(context) {
  // Une seule route : les handlers Playwright sont essayés du plus récent au
  // plus ancien, donc un generic enregistré après masquerait la recherche.
  await context.route('https://api.themoviedb.org/3/**', (route) => {
    const url = route.request().url();
    if (/search\/multi/.test(url)) {
      routedRequests.push(`handled ${url}`);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TMDB_RESULT)
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    });
  });
  await context.route('https://image.tmdb.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: SVG_PLACEHOLDER
  }));
  await context.route('https://challenges.cloudflare.com/**', (route) => route.abort());
  await context.route('https://www.gstatic.com/**', (route) => route.abort());
}

async function newTestPage() {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 }
  });
  contexts.push(context);
  await stubExternalRequests(context);
  const page = await context.newPage();
  page.on('request', (request) => {
    if (request.url().includes('themoviedb') || request.url().includes('socket.io')) {
      routedRequests.push(`raw ${request.url()}`);
    }
  });
  page.on('websocket', (socket) => {
    if (socket.url().includes('watchparty') || socket.url().includes('socket.io')) {
      routedRequests.push(`websocket ${socket.url()}`);
      socket.on('framesent', (payload) => routedRequests.push(`sent ${String(payload.payload).slice(0, 300)}`));
      socket.on('framereceived', (payload) => routedRequests.push(`received ${String(payload.payload).slice(0, 300)}`));
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return { context, page };
}

async function createRoom(page, { name, isPublic }) {
  if (!page.url().endsWith('/watchparty')) {
    await page.goto(`${siteOrigin}/watchparty`, { waitUntil: 'domcontentloaded' });
  }
  await page.getByRole('button', { name: 'Créer une salle' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Créer une salle/ });
  await dialog.getByLabel('Nom de la salle').fill(name);
  await dialog.getByLabel('Ton pseudo').fill('E2E Hôte');
  const searchInput = dialog.locator('input[placeholder^="Rechercher un film"]');
  await searchInput.fill('Fight Club');
  try {
    await dialog.getByRole('button', { name: /Fight Club/ }).first().waitFor({ timeout: 10_000 });
  } catch (error) {
    observed.push(`diagnostic recherche : value=${JSON.stringify(await searchInput.inputValue())} routed=${routedRequests.length}`);
    fs.writeFileSync(path.join(artifactDir, 'create-dialog.html'), await dialog.innerHTML());
    await page.screenshot({ path: path.join(artifactDir, 'create-dialog-failure.png'), fullPage: true });
    throw error;
  }
  await dialog.getByRole('button', { name: /Fight Club/ }).first().click();
  if (isPublic) await dialog.locator('input[type="checkbox"]').check();
  await dialog.getByRole('button', { name: 'Créer la salle' }).click();
  await page.waitForURL(/\/watchparty\/room\/[^/]+$/, { timeout: 15_000 });
  return page.url();
}

before(async () => {
  fs.mkdirSync(artifactDir, { recursive: true });
  const apiPort = Number(process.env.WATCHPARTY_E2E_API_PORT) || await findFreePort();
  const sitePort = Number(process.env.WATCHPARTY_E2E_SITE_PORT) || await findFreePort();
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  siteOrigin = `http://127.0.0.1:${sitePort}`;

  const buildEnv = {
    ...process.env,
    VITE_WATCHPARTY_API: apiOrigin,
    VITE_SITE_URL: siteOrigin,
    VITE_TMDB_API_KEY: 'e2e-key',
  };
  if (process.env.WATCHPARTY_E2E_SKIP_BUILD === '1') {
    buildStatus = 'reused';
  } else {
    const buildLog = fs.openSync(buildLogPath, 'w');
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: repo,
      env: buildEnv,
      shell: process.platform === 'win32',
      stdio: ['ignore', buildLog, buildLog]
    });
    fs.closeSync(buildLog);
    buildStatus = build.status === 0 ? 'pass' : 'fail';
    if (build.status !== 0) {
      const tail = fs.readFileSync(buildLogPath, 'utf8').slice(-3000);
      throw new Error(`Build Vite échoué (${build.status}). Fin du log :\n${tail}`);
    }
  }

  staticServer = await startStaticServer(path.join(repo, 'dist'), sitePort);
  const apiLog = fs.openSync(apiLogPath, 'w');
  apiChild = spawn(process.execPath, [serverFile], {
    cwd: repo,
    env: {
      ...process.env,
      WATCHPARTY_PORT: String(apiPort),
      WATCHPARTY_REST_CORS_ORIGIN: siteOrigin,
      WATCHPARTY_SOCKET_CORS_ORIGIN: siteOrigin,
      WATCHPARTY_CORS_CREDENTIALS: 'true',
    },
    stdio: ['ignore', apiLog, apiLog]
  });
  await waitForApi(`${apiOrigin}/api/watchparty/public`);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  for (const context of contexts) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (apiChild) apiChild.kill();
  if (staticServer) await new Promise((resolve) => staticServer.close(resolve));
  fs.writeFileSync(reportPath, JSON.stringify({
    command: 'node --test tests/watchpartyPublicRooms.browser.mjs',
    prerequisites: [
      'Node 24 avec fetch/AbortSignal.timeout',
      'Playwright Chromium installé (npx playwright install chromium)',
      'Build Vite lancé par le test avec VITE_WATCHPARTY_API pointant sur le serveur WatchParty local'
    ],
    data: {
      apiOrigin,
      siteOrigin,
      tmdbStub: TMDB_RESULT.results[0],
      rooms: [PUBLIC_ROOM, PRIVATE_ROOM],
      build: buildStatus
    },
    expected: [
      'un second navigateur voit le salon public sans rechargement manuel',
      'un salon privé reste invisible',
      'la fermeture par l’hôte retire le salon du lobby du second navigateur',
      'aucune erreur postMessage répétée'
    ],
    observed: observed.map(redactSecrets),
    routedRequests: routedRequests.map(redactSecrets),
    consoleErrors: consoleErrors.map(redactSecrets),
    pageErrors: pageErrors.map(redactSecrets),
    artifacts: {
      trace: tracePath,
      screenshot: screenshotPath,
      buildLog: buildLogPath,
      apiLog: apiLogPath
    }
  }, null, 2));
});

test('deux navigateurs constatent création public, invisibilité privée et fermeture', async (t) => {
  const { page: hostPage } = await newTestPage();
  const { context: watcherContext, page: watcherPage } = await newTestPage();

  await watcherPage.goto(`${siteOrigin}/watchparty`, { waitUntil: 'domcontentloaded' });
  await watcherContext.tracing.start({ screenshots: true, snapshots: true });

  try {
    const publicRoomUrl = await createRoom(hostPage, { name: PUBLIC_ROOM, isPublic: true });
    observed.push(`salon public créé : ${new URL(publicRoomUrl).pathname}`);
    await watcherPage.getByText(PUBLIC_ROOM).waitFor({ state: 'visible', timeout: 12_000 });
    observed.push('le second navigateur a vu le salon public sans rechargement');

    hostPage.on('dialog', (dialog) => dialog.accept());
    const closeButton = hostPage.getByRole('button', { name: 'Fermer la salle' });
    if (await closeButton.count() === 0) {
      const diagnostics = await hostPage.evaluate(() => ({
        href: window.location.href,
        storage: Object.fromEntries(Object.keys(sessionStorage).map((key) => [
          key,
          key.startsWith('watchPartyToken:') ? '<redacted>' : sessionStorage.getItem(key),
        ])),
        bodyHasHostPanel: document.body.innerText.includes('Gérer la salle'),
        bodyHasConnection: document.body.innerText.includes('Connecté'),
        bodyText: document.body.innerText.slice(0, 900),
      }));
      observed.push(`diagnostic hôte : ${JSON.stringify(diagnostics)}`);
      const roomId = new URL(publicRoomUrl).pathname.split('/').pop();
      const hostToken = diagnostics.storage[`watchPartyToken:${roomId}`];
      if (hostToken) {
        const response = await fetch(`${apiOrigin}/api/watchparty/room/${roomId}`, {
          headers: { 'x-watchparty-token': hostToken }
        });
        const payload = await response.json();
        observed.push(`diagnostic API : ${JSON.stringify({
          status: response.status,
          hostId: payload?.room?.hostId,
          participants: payload?.room?.participants
        })}`);
      }
      observed.push(`requêtes : ${JSON.stringify(routedRequests.filter((line) => /socket\.io|watchparty|received/.test(line)).slice(-20))}`);
      fs.writeFileSync(path.join(artifactDir, 'host-room.html'), await hostPage.content());
      await hostPage.screenshot({ path: path.join(artifactDir, 'host-room-failure.png'), fullPage: true });
      await closeButton.waitFor({ timeout: 10_000 });
    }
    await closeButton.click({ timeout: 10_000 });
    await hostPage.waitForURL('**/watchparty', { timeout: 10_000 });
    await watcherPage.getByText(PUBLIC_ROOM).waitFor({ state: 'detached', timeout: 12_000 });
    observed.push('le second navigateur a vu disparaître le salon fermé');

    await createRoom(hostPage, { name: PRIVATE_ROOM, isPublic: false });
    await delay(1000);
    assert.equal(await watcherPage.getByText(PRIVATE_ROOM).count(), 0);
    observed.push('le salon privé est resté invisible pour le second navigateur');

    const repeatedPostMessageErrors = consoleErrors.filter((line) => /postMessage/i.test(line));
    assert.deepEqual(repeatedPostMessageErrors, [], 'aucune erreur postMessage ne doit apparaître');
    assert.deepEqual(pageErrors, [], 'aucune exception JavaScript de page');
    observed.push(`aucune erreur postMessage ni exception de page (${consoleErrors.length} erreurs console externes ignorées)`);

  } finally {
    await watcherPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    await watcherContext.tracing.stop({ path: tracePath }).catch(() => {});
  }

  t.diagnostic(`artefacts E2E : ${artifactDir}`);
});
