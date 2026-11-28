/**
 * E2E navigateur ciblé de la fiabilité de synchronisation.
 *
 * Relance :
 *   node tests/syncReliability.browser.mjs
 *
 * Prérequis : Chrome installé, `playwright-core` disponible (installation locale
 * `npm install --no-save --no-package-lock playwright-core`), Vite/Node. Le
 * script construit le vrai bundle SPA avec une API locale factice, puis pilote
 * Chrome. Aucun secret ni compte réel n'est utilisé.
 *
 * Artefacts (par défaut <workspace>/../movix-artifacts/sync-reliability, ou
 * SYNC_E2E_ARTIFACT_DIR) : report.json, trace.zip, captures PNG, journaux.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.SYNC_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.SYNC_E2E_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'sync-reliability');
const buildDir = path.join(artifactDir, 'dist');
const chromePath = process.env.SYNC_E2E_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const reportPath = path.join(artifactDir, 'report.json');
const tracePath = path.join(artifactDir, 'trace.zip');

fs.mkdirSync(artifactDir, { recursive: true });

const apiCalls = [];
const observed = [];
const consoleErrors = [];
const pageErrors = [];

function redact(value) {
  return String(value)
    .replace(/("?(?:auth_token|token|access_code|Authorization)"?\s*[:=]\s*"?)[^",}]+/gi, '$1<redacted>')
    .replace(/Bearer [^" ]+/g, 'Bearer <redacted>');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startApiServer(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const entry = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        authorization: redact(req.headers.authorization || ''),
        accessKey: redact(req.headers['x-access-key'] || ''),
        body: body ? redact(body) : null
      };
      apiCalls.push(entry);

      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'authorization,content-type,x-access-key,x-profile-id,x-watchparty-token'
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const json = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === '/api/check-vip') {
        const valid = req.headers['x-access-key'] === 'KEY-VALID';
        return json(200, valid ? { vip: true } : { vip: false, reason: 'fixture-invalid' });
      }
      if (url.pathname === '/api/sync') return json(200, { success: true, applied: JSON.parse(body || '{}').ops?.length || 0 });
      if (url.pathname === '/api/profiles') {
        return json(200, {
          success: true,
          profiles: [
            { id: 'profile-a', name: 'Profil A', isDefault: true },
            { id: 'profile-b', name: 'Profil B', isDefault: false }
          ]
        });
      }
      if (/^\/api\/profiles\/[^/]+\/data$/.test(url.pathname)) return json(200, { success: true, data: {} });
      if (url.pathname === '/api/wrapped/track') return json(200, { success: true });
      if (url.pathname === '/api/history/continue') return json(200, { items: [], complete: true });
      return json(200, { success: true, items: [] });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function startStaticServer(distDir, port) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2'
  };
  const server = createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    let file = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(distDir, 'index.html');
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const apiPort = await freePort();
const sitePort = await freePort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const siteOrigin = `http://127.0.0.1:${sitePort}`;

const build = spawnSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build',
  '--outDir', buildDir,
  '--emptyOutDir'
], {
  cwd: repo,
  encoding: 'utf8',
  env: {
    ...process.env,
    VITE_SITE_URL: siteOrigin,
    VITE_MAIN_API: apiOrigin,
    VITE_WATCHPARTY_API: apiOrigin
  }
});
fs.writeFileSync(path.join(artifactDir, 'build.log'), `${build.stdout || ''}\n${build.stderr || ''}`);
assert.equal(build.status, 0, `build Vite échoué : ${build.stderr?.slice(-2000)}`);
observed.push(`build Vite réussi avec VITE_MAIN_API=${apiOrigin}`);

const apiServer = await startApiServer(apiPort);
const staticServer = await startStaticServer(buildDir, sitePort);
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(redact(message.text()));
});
page.on('pageerror', (error) => pageErrors.push(redact(error.message)));
await context.tracing.start({ screenshots: true, snapshots: true });

const seed = async () => {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'fixture-token');
    localStorage.setItem('auth_method', 'discord');
    localStorage.setItem('discord_auth', 'true');
    localStorage.setItem('resolved_user_type', 'oauth');
    localStorage.setItem('resolved_user_id', 'user-e2e');
    localStorage.setItem('selected_profile_id', 'profile-a');
    localStorage.setItem('movix_selected_profile:oauth:user-e2e', 'profile-a');
    localStorage.setItem('is_vip', 'true');
    localStorage.setItem('access_code', 'KEY-VALID');
  });
  await page.goto(`${siteOrigin}/`, { waitUntil: 'domcontentloaded' });
  // Hydratation des profils : on attend la fin des requêtes de profil avant
  // toute écriture, sinon le patch Storage la considère comme interne.
  for (let i = 0; i < 50; i += 1) {
    const profileCalls = apiCalls.filter((call) => call.path.startsWith('/api/profiles'));
    if (profileCalls.length >= 2) break;
    await delay(200);
  }
  await delay(500);
  const historyCalls = apiCalls.filter((call) => call.path === '/api/history/continue' && call.method === 'GET');
  assert.ok(historyCalls.length > 0, 'aucune requête /api/history/continue observée');
  assert.ok(
    historyCalls.every((call) => call.query.profileId === 'profile-a'),
    'l’historique doit cibler la sélection account-scopée, pas la clé globale'
  );
  observed.push(`historique adressé à ${historyCalls[0].query.profileId}`);
};

try {
  await seed();

  // Scénario 1 : une écriture du profil A reste attribuée à A si le profil
  // courant est changé avant le pagehide.
  await page.evaluate(() => {
    localStorage.setItem('favorite_movies', '[550]');
    localStorage.setItem('movix_selected_profile:oauth:user-e2e', 'profile-b');
    window.dispatchEvent(new Event('pagehide'));
  });
  await delay(700);
  const syncCalls = apiCalls.filter((call) => call.path === '/api/sync');
  const ownerCall = syncCalls.find((call) => {
    try { return JSON.parse(call.body).ops?.some((op) => op.key === 'favorite_movies'); } catch { return false; }
  });
  assert.ok(ownerCall, 'aucune requête /api/sync ne contient favorite_movies');
  const ownerPayload = JSON.parse(ownerCall.body);
  assert.equal(ownerPayload.profileId, 'profile-a', 'l’opération doit rester au profil qui l’a écrite');
  assert.ok(
    !syncCalls.some((call) => {
      try { return JSON.parse(call.body).ops?.some((op) => op.key === 'is_vip'); } catch { return false; }
    }),
    'is_vip ne doit jamais être synchronisé : le serveur en reste l’autorité'
  );
  const outbox = await page.evaluate(() => localStorage.getItem(
    '__movix_sync_outbox:oauth:user-e2e:profile-a'
  ));
  assert.ok(outbox, 'l’outbox du profil A doit être conservée séparément');
  observed.push(`sync attribué à ${ownerPayload.profileId} malgré le profil courant profile-b`);
  await page.screenshot({ path: path.join(artifactDir, '01-owner-flush.png'), fullPage: true });

  // Scénario 2 : un changement de clé VIP force une vérification serveur avec
  // la nouvelle clé, sans réutiliser le cache de l'ancienne.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('storage'));
  });
  await delay(400);
  await page.evaluate(() => {
    localStorage.setItem('access_code', 'KEY-INVALID');
    window.dispatchEvent(new Event('storage'));
  });
  await delay(500);
  const vipCalls = apiCalls.filter((call) => call.path === '/api/check-vip' && call.method === 'GET');
  const keys = vipCalls.map((call) => call.accessKey);
  assert.ok(keys.includes('KEY-VALID'), 'la première clé doit être vérifiée');
  assert.ok(keys.includes('KEY-INVALID'), 'la nouvelle clé doit être vérifiée malgré le cache');
  const revoked = await page.evaluate(() => localStorage.getItem('is_vip'));
  assert.equal(revoked, null, 'la clé invalide doit révoquer le VIP local');
  observed.push(`vérifications VIP observées : ${keys.join(' puis ')}`);
  await page.screenshot({ path: path.join(artifactDir, '02-vip-key-change.png'), fullPage: true });

  assert.deepEqual(pageErrors, [], 'aucune exception JavaScript de page');
} finally {
  await page.screenshot({ path: path.join(artifactDir, 'final.png'), fullPage: true }).catch(() => {});
  await context.tracing.stop({ path: tracePath }).catch(() => {});
  await browser.close();
  apiServer.close();
  staticServer.close();

  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node tests/syncReliability.browser.mjs',
    prerequisites: [
      'Chrome installé (SYNC_E2E_CHROME peut surcharger le chemin)',
      'playwright-core installé localement sans modifier package.json',
      'Vite et Node disponibles dans le checkout'
    ],
    data: {
      account: 'fixture oauth user-e2e',
      profiles: ['profile-a', 'profile-b'],
      vipKeys: ['KEY-VALID', 'KEY-INVALID'],
      api: apiOrigin,
      site: siteOrigin
    },
    expected: [
      'l’historique cible la sélection account-scopée du profil A',
      'la progression/les favoris écrits sous le profil A restent adressés au profil A après changement de profil',
      'l’outbox est conservée sous la clé du propriétaire A',
      'un changement de clé VIP déclenche une nouvelle vérification serveur avec la nouvelle clé et révoque le VIP invalide',
      'aucune exception JavaScript de page'
    ],
    observed,
    apiCalls: apiCalls.map((call) => ({ ...call, body: call.body?.slice(0, 4000) })),
    consoleErrors,
    pageErrors,
    artifacts: {
      report: reportPath,
      trace: tracePath,
      buildLog: path.join(artifactDir, 'build.log')
    }
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`artefacts E2E : ${artifactDir}`);
  console.log(`rapport : ${reportPath}`);
}
