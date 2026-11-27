import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_WORKER = path.join(REPO_ROOT, 'cloudflareproxy', 'worker.js');
const WRANGLER_JS = path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures');
const TEST_CERT = path.join(FIXTURE_DIR, 'cloudflareProxyTest.crt');
const TEST_KEY = path.join(FIXTURE_DIR, 'cloudflareProxyTest.key');

const TEST_ORIGIN = 'https://allowed.test';
const ALLOWED_PREFIX = '/allowed/';
const EMPTY_ORIGIN_DECLARATION = 'const ALLOWED_ORIGINS = Object.freeze([]);';
const EMPTY_TARGET_DECLARATION = 'const ALLOWED_TARGETS = Object.freeze([]);';

let tempRoot;
let denyDir;
let allowDir;
let upstreamServer;
let upstreamPort;
let upstreamRequests;
let deny;
let allow;
let productionSource;

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function writeWorkerAndConfig(directory, source, name) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'worker.js'), source, 'utf8');
  await writeFile(
    path.join(directory, 'wrangler.toml'),
    `name = "${name}"\nmain = "worker.js"\ncompatibility_date = "2024-01-01"\n`,
    'utf8',
  );
}

function startWrangler(directory, extraEnv = {}) {
  const port = findFreePort();
  return port.then(async (resolvedPort) => {
    const instance = { child: null, url: null, logs: '' };
    const env = {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_LOG: 'error',
      ...extraEnv,
    };
    const args = [
      WRANGLER_JS, 'dev', '--local',
      '--config', path.join(directory, 'wrangler.toml'),
      '--persist-to', path.join(directory, 'persist'),
      '--ip', '127.0.0.1',
      '--port', String(resolvedPort),
    ];

    instance.child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    instance.url = `http://127.0.0.1:${resolvedPort}`;
    instance.child.stdout.on('data', (chunk) => { instance.logs += chunk.toString(); });
    instance.child.stderr.on('data', (chunk) => { instance.logs += chunk.toString(); });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (instance.child.exitCode !== null) {
        throw new Error(`Wrangler s'est terminé avec ${instance.child.exitCode} :\n${instance.logs}`);
      }
      try {
        const response = await fetch(instance.url, { signal: AbortSignal.timeout(1000) });
        await response.arrayBuffer();
        return instance;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(`Wrangler local non prêt après 60 s :\n${instance.logs}`);
  });
}

function stopWrangler(instance) {
  if (!instance || !instance.child || instance.child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(instance.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    instance.child.kill('SIGTERM');
  }
}

function upstreamHandler(req, res) {
  const url = new URL(req.url, `https://127.0.0.1:${upstreamPort}`);
  upstreamRequests.push({
    method: req.method,
    pathname: url.pathname,
    headers: { ...req.headers },
  });

  if (url.pathname === '/allowed/redirect') {
    res.writeHead(302, { Location: `https://127.0.0.1:${upstreamPort}/redirect-target` });
    res.end();
    return;
  }

  if (url.pathname === '/redirect-target') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('REDIRECT_TARGET_REACHED');
    return;
  }

  if (url.pathname === '/allowed/echo') {
    const forwardedNames = [
      'accept',
      'accept-language',
      'if-modified-since',
      'if-none-match',
      'range',
    ];
    const forbiddenNames = [
      'authorization',
      'cookie',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-cors-headers',
      'cf-connecting-ip',
      'origin',
      'referer',
    ];
    const forwarded = {};
    for (const name of forwardedNames) {
      if (req.headers[name] !== undefined) forwarded[name] = req.headers[name];
    }
    const leaked = forbiddenNames.filter((name) => req.headers[name] !== undefined);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ forwarded, leaked }));
    return;
  }

  if (url.pathname === '/allowed/ok') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=999',
      'Set-Cookie': 'upstream=secret',
      'CF-Ray': 'upstream-ray',
      'cf-ipcountry': 'FR',
      'Cors-Received-Headers': 'leaked',
      'X-Upstream-Secret': 'upstream-secret',
      'Accept-Ranges': 'bytes',
    });
    res.end(`OK:${req.method}`);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('NOT_FOUND');
}

function countUpstream(pathname) {
  return upstreamRequests.filter((entry) => entry.pathname === pathname).length;
}

function proxyUrl(baseUrl, target) {
  return `${baseUrl}/?uri=${encodeURIComponent(target)}`;
}

async function get(baseUrl, target, origin, extraHeaders = {}) {
  return fetch(proxyUrl(baseUrl, target), {
    headers: { Origin: origin, ...extraHeaders },
  });
}

function rawRequest(url, method, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

function assertNoSensitiveResponseHeaders(response) {
  for (const name of [
    'set-cookie',
    'cf-ray',
    'cf-ipcountry',
    'cors-received-headers',
    'x-upstream-secret',
    'location',
    'access-control-allow-credentials',
  ]) {
    assert.equal(response.headers.get(name), null, name);
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

before(async () => {
  productionSource = await readFile(PRODUCTION_WORKER, 'utf8');
  assert.ok(productionSource.includes(EMPTY_ORIGIN_DECLARATION));
  assert.ok(productionSource.includes(EMPTY_TARGET_DECLARATION));

  tempRoot = await mkdtemp(path.join(tmpdir(), 'movix-cloudflareproxy-'));
  denyDir = path.join(tempRoot, 'deny');
  allowDir = path.join(tempRoot, 'allow');

  // La suite deny-all utilise une copie octet pour octet du Worker de
  // production, mais dans un répertoire temporaire : aucun `.wrangler`
  // n'est créé dans le dépôt.
  await writeWorkerAndConfig(denyDir, productionSource, 'cloudflareproxy-deny');

  upstreamRequests = [];
  upstreamServer = https.createServer({
    key: readFileSync(TEST_KEY),
    cert: readFileSync(TEST_CERT),
  }, upstreamHandler);
  await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
  upstreamPort = upstreamServer.address().port;
  const targetOrigin = `https://127.0.0.1:${upstreamPort}`;

  const allowSource = productionSource
    .replace(EMPTY_ORIGIN_DECLARATION, `const ALLOWED_ORIGINS = Object.freeze([${JSON.stringify(TEST_ORIGIN)}]);`)
    .replace(
      EMPTY_TARGET_DECLARATION,
      `const ALLOWED_TARGETS = Object.freeze([{ origin: ${JSON.stringify(targetOrigin)}, pathPrefix: ${JSON.stringify(ALLOWED_PREFIX)} }]);`,
    );
  assert.notEqual(allowSource, productionSource);
  assert.ok(!allowSource.includes(EMPTY_ORIGIN_DECLARATION));
  assert.ok(!allowSource.includes(EMPTY_TARGET_DECLARATION));
  await writeWorkerAndConfig(allowDir, allowSource, 'cloudflareproxy-allow');

  deny = await startWrangler(denyDir);
  // Certificat autosigné de test uniquement, injecté dans le processus
  // Wrangler isolé. Aucune configuration de production n'est modifiée.
  allow = await startWrangler(allowDir, { NODE_EXTRA_CA_CERTS: TEST_CERT });
});

after(async () => {
  stopWrangler(deny);
  stopWrangler(allow);
  if (upstreamServer && upstreamServer.listening) {
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe('configuration de production copiée (deny-all)', () => {
  test('les constantes de production restent vides', async () => {
    const source = await readFile(PRODUCTION_WORKER, 'utf8');
    assert.ok(source.includes(EMPTY_ORIGIN_DECLARATION));
    assert.ok(source.includes(EMPTY_TARGET_DECLARATION));
    assert.ok(source.includes("const ALLOWED_PROTOCOLS = Object.freeze(['https:']);"));
  });

  test('une cible publique arbitraire est refusée', async () => {
    const response = await get(deny.url, 'https://example.com/video.mp4', 'https://movix.fun');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: 'forbidden' });
    assert.doesNotMatch(body, /example\.com|movix\.fun/i);
  });

  test('une cible privée est refusée', async () => {
    const targets = [
      'http://127.0.0.1:65530/admin',
      'https://10.0.0.5/internal',
      'http://169.254.169.254/latest/meta-data/',
    ];
    for (const target of targets) {
      const response = await get(deny.url, target, 'https://movix.fun');
      assert.equal(response.status, 403, target);
      assert.equal(response.headers.get('location'), null);
    }
  });

  test('une liste ALLOWED_TARGETS vide entraîne toujours un refus', async () => {
    const targets = [
      'https://example.com/a',
      'https://movix.fun/api/content/home',
      'https://www.movix.fun/a',
      'https://proxiesembed.movix.fun/proxy?url=https://example.com',
    ];
    for (const target of targets) {
      const response = await get(deny.url, target, 'https://movix.fun');
      assert.equal(response.status, 403, target);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  });

  test('une origine inconnue est refusée sans réflexion', async () => {
    const response = await get(deny.url, 'https://example.com/a', 'https://attacker.example');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(JSON.parse(await response.text()), { error: 'forbidden' });
  });

  test('les variantes www. ne sont pas autorisées implicitement', async () => {
    const origins = ['https://www.movix.fun', 'https://movix.fun', 'http://www.movix.fun'];
    const targets = ['https://www.example.com/a', 'https://example.com/a'];
    for (const origin of origins) {
      for (const target of targets) {
        const response = await get(deny.url, target, origin);
        assert.equal(response.status, 403, `${origin} -> ${target}`);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
      }
    }
  });

  test('POST est refusé', async () => {
    const response = await fetch(proxyUrl(deny.url, 'https://example.com/a'), {
      method: 'POST',
      headers: { Origin: 'https://movix.fun', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('PUT, PATCH, DELETE et TRACE sont refusés', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE', 'TRACE']) {
      const response = await rawRequest(proxyUrl(deny.url, 'https://example.com/a'), method, {
        Origin: 'https://movix.fun',
      });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.allow, 'GET, HEAD', method);
    }
  });

  test('aucune redirection n’est renvoyée quand tout est refusé', async () => {
    const targets = [
      'https://example.test/redirect',
      'https://example.test/?uri=http://127.0.0.1:65530/admin',
    ];
    for (const target of targets) {
      const response = await get(deny.url, target, 'https://movix.fun');
      assert.equal(response.status, 403, target);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('access-control-expose-headers'), null);
    }
  });

  test('les en-têtes personnalisés et les métadonnées ne sont pas exposés', async () => {
    const response = await get(deny.url, 'https://example.com/file', 'https://movix.fun', {
      Authorization: 'Bearer caller-secret',
      Cookie: 'session=caller-secret',
      'x-cors-headers': JSON.stringify({ Authorization: 'Bearer injected-secret' }),
      'CF-Connecting-IP': '203.0.113.9',
      'X-Forwarded-For': '198.51.100.7',
    });
    assert.equal(response.status, 403);
    const body = await response.text();
    assert.doesNotMatch(body, /caller-secret|injected-secret|203\.0\.113\.9|198\.51\.100\.7/i);
    assert.doesNotMatch(body, /Country|Datacenter|IP:/i);
    for (const name of [
      'cors-received-headers',
      'x-cors-headers',
      'set-cookie',
      'location',
      'access-control-allow-credentials',
    ]) {
      assert.equal(response.headers.get(name), null, name);
    }
  });

  test('une pré-requête d’origine inconnue est refusée', async () => {
    const response = await fetch(deny.url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-methods'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('les URL avec identifiants, fragment, HTTP ou port arbitraire restent refusées', async () => {
    const targets = [
      'https://user:pass@example.com/a',
      'https://example.com/a#fragment',
      'http://example.com/a',
      'https://example.com:8443/a',
      `${proxyUrl(deny.url, 'https://example.com/a')}&uri=https://example.com/b`,
      '',
    ];
    for (const target of targets) {
      const response = await get(deny.url, target, 'https://movix.fun');
      assert.equal(response.status, 403, target);
      assert.equal(response.headers.get('location'), null);
    }
  });
});

describe('configuration temporaire isolée (contrôles réellement exercés)', () => {
  const targetOrigin = () => `https://127.0.0.1:${upstreamPort}`;

  test('GET avec origine et cible autorisées', async () => {
    const before = countUpstream('/allowed/ok');
    const response = await get(allow.url, `${targetOrigin()}/allowed/ok`, TEST_ORIGIN, {
      Authorization: 'Bearer caller-secret',
      Cookie: 'session=caller-secret',
      'X-Forwarded-For': '203.0.113.9',
      'x-cors-headers': JSON.stringify({ Authorization: 'Bearer injected-secret' }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK:GET');
    assert.equal(response.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(response.headers.get('vary'), 'Origin');
    assertNoSensitiveResponseHeaders(response);
    assert.equal(countUpstream('/allowed/ok'), before + 1);

    const request = upstreamRequests.filter((entry) => entry.pathname === '/allowed/ok').at(-1);
    for (const name of ['authorization', 'cookie', 'x-forwarded-for', 'x-cors-headers', 'cf-connecting-ip']) {
      assert.equal(request.headers[name], undefined, name);
    }
    assert.equal(request.method, 'GET');
  });

  test('HEAD avec origine et cible autorisées', async () => {
    const before = countUpstream('/allowed/ok');
    const response = await fetch(proxyUrl(allow.url, `${targetOrigin()}/allowed/ok`), {
      method: 'HEAD',
      headers: { Origin: TEST_ORIGIN },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assertNoSensitiveResponseHeaders(response);
    assert.equal(countUpstream('/allowed/ok'), before + 1);
    const request = upstreamRequests.filter((entry) => entry.pathname === '/allowed/ok').at(-1);
    assert.equal(request.method, 'HEAD');
  });

  test('OPTIONS avec origine autorisée', async () => {
    const before = upstreamRequests.length;
    const response = await fetch(allow.url, {
      method: 'OPTIONS',
      headers: {
        Origin: TEST_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
    assert.equal(
      response.headers.get('access-control-allow-headers'),
      'Accept, Accept-Language, If-Modified-Since, If-None-Match, Range',
    );
    assert.equal(response.headers.get('access-control-max-age'), '600');
    assert.match(response.headers.get('vary') || '', /Origin/);
    assert.equal(upstreamRequests.length, before);
  });

  test('refus d’une origine non autorisée', async () => {
    const before = upstreamRequests.length;
    const response = await get(allow.url, `${targetOrigin()}/allowed/ok`, 'https://attacker.test');
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(JSON.parse(await response.text()), { error: 'forbidden' });
    assert.equal(upstreamRequests.length, before);
  });

  test('refus d’une cible non autorisée', async () => {
    const before = countUpstream('/forbidden/x');
    const response = await get(allow.url, `${targetOrigin()}/forbidden/x`, TEST_ORIGIN);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), TEST_ORIGIN);
    assert.deepEqual(JSON.parse(await response.text()), { error: 'target_not_allowed' });
    assert.equal(countUpstream('/forbidden/x'), before);
  });

  test('POST, PUT, PATCH, DELETE et TRACE sont refusés avec origine autorisée', async () => {
    const before = upstreamRequests.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE']) {
      const response = await rawRequest(
        proxyUrl(allow.url, `${targetOrigin()}/allowed/ok`),
        method,
        { Origin: TEST_ORIGIN },
      );
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.allow, 'GET, HEAD', method);
      assert.equal(response.headers['access-control-allow-origin'], undefined, method);
    }
    assert.equal(upstreamRequests.length, before);
  });

  test('transmission uniquement des headers autorisés', async () => {
    const response = await get(allow.url, `${targetOrigin()}/allowed/echo`, TEST_ORIGIN, {
      Accept: 'application/json',
      'Accept-Language': 'fr-FR',
      'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'If-None-Match': '"etag"',
      Range: 'bytes=0-10',
      Authorization: 'Bearer caller-secret',
      Cookie: 'session=caller-secret',
      'X-Forwarded-For': '203.0.113.9',
      'X-Forwarded-Host': 'attacker.test',
      'x-cors-headers': JSON.stringify({ Authorization: 'Bearer injected-secret' }),
      'CF-Connecting-IP': '203.0.113.9',
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(await response.text());
    assert.deepEqual(body.leaked, []);
    assert.equal(body.forwarded.accept, 'application/json');
    assert.equal(body.forwarded['accept-language'], 'fr-FR');
    assert.equal(body.forwarded['if-modified-since'], 'Wed, 21 Oct 2015 07:28:00 GMT');
    assert.equal(body.forwarded['if-none-match'], '"etag"');
    assert.equal(body.forwarded.range, 'bytes=0-10');
    assert.doesNotMatch(JSON.stringify(body), /caller-secret|injected-secret|203\.0\.113\.9|attacker\.test/i);
  });

  test('aucune fuite de headers de réponse sensibles et no-store conservé', async () => {
    const response = await get(allow.url, `${targetOrigin()}/allowed/ok`, TEST_ORIGIN);
    assert.equal(response.status, 200);
    assertNoSensitiveResponseHeaders(response);
    const body = await response.text();
    assert.doesNotMatch(body, /upstream-secret|upstream-ray|REDIRECT_TARGET_REACHED/i);
  });

  test('une redirection 302 réelle n’est jamais suivie', async () => {
    const beforeRedirect = countUpstream('/allowed/redirect');
    const beforeTarget = countUpstream('/redirect-target');
    const response = await get(allow.url, `${targetOrigin()}/allowed/redirect`, TEST_ORIGIN);
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(await response.text()), { error: 'redirect_blocked' });
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(countUpstream('/allowed/redirect'), beforeRedirect + 1);
    assert.equal(countUpstream('/redirect-target'), beforeTarget);
  });

  test('le protocole HTTP est refusé avec une origine autorisée', async () => {
    const before = upstreamRequests.length;
    const response = await get(allow.url, `http://127.0.0.1:${upstreamPort}/allowed/ok`, TEST_ORIGIN);
    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(await response.text()), { error: 'target_not_allowed' });
    assert.equal(upstreamRequests.length, before);
  });

  test('identifiants, fragment et port non standard sont refusés', async () => {
    const before = upstreamRequests.length;
    const port = upstreamPort;
    const targets = [
      `https://user:pass@127.0.0.1:${port}/allowed/ok`,
      `https://127.0.0.1:${port}/allowed/ok#fragment`,
      `https://127.0.0.1:${port + 1}/allowed/ok`,
    ];
    for (const target of targets) {
      const response = await get(allow.url, target, TEST_ORIGIN);
      assert.equal(response.status, 403, target);
      assert.deepEqual(JSON.parse(await response.text()), { error: 'target_not_allowed' });
    }
    assert.equal(upstreamRequests.length, before);
  });

  test('segments encodés, doubles encodages et contournements de préfixe sont refusés', async () => {
    const before = upstreamRequests.length;
    const port = upstreamPort;
    const targets = [
      `https://127.0.0.1:${port}/allowed/%2e%2e/redirect-target`,
      `https://127.0.0.1:${port}/allowed/%252e%252e/redirect-target`,
      `https://127.0.0.1:${port}/allowed/%2f../redirect-target`,
      `https://127.0.0.1:${port}/allowed/%5c..%5credirect-target`,
      `https://127.0.0.1:${port}/allowed%2f../redirect-target`,
      `https://127.0.0.1:${port}/%61llowed/redirect-target`,
    ];
    for (const target of targets) {
      const response = await get(allow.url, target, TEST_ORIGIN);
      assert.equal(response.status, 403, target);
      assert.deepEqual(JSON.parse(await response.text()), { error: 'target_not_allowed' });
    }
    assert.equal(upstreamRequests.length, before);
    assert.equal(countUpstream('/redirect-target'), 0);
  });
});
