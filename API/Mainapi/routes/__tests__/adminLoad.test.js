// Régression : le chargement réel de routes/admin.js et de app.js doit
// réussir. Un `node --check` ne détecte pas une erreur d'exécution CommonJS
// (accès à une `const` avant son `require`), qui empêchait tout le démarrage
// de la Main API. Les processus enfants isolent les effets de bord (pool
// MySQL, Redis, cache de modules).
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const apiRoot = resolve(__dirname, '..', '..');
const adminRoutePath = resolve(apiRoot, 'routes', 'admin.js');
const appPath = resolve(apiRoot, 'app.js');

function runNode(source) {
  return spawnSync(process.execPath, ['-e', source], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      JWT_SECRET: 'admin-load-test-secret',
      NODE_ENV: 'test',
    },
  });
}

test('routes/admin.js se charge réellement et expose un routeur Express', () => {
  const result = runNode(`
    const router = require(${JSON.stringify(adminRoutePath)});
    if (typeof router !== 'function' || !Array.isArray(router.stack) || router.stack.length === 0) {
      console.error('ROUTER_INVALID');
      process.exit(2);
    }
    console.log('ADMIN_ROUTE_OK');
  `);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, `chargement admin.js : ${output.slice(-1200)}`);
  assert.match(result.stdout, /ADMIN_ROUTE_OK/);
});

test('app.js se charge réellement avec le mounted admin router', () => {
  const result = runNode(`
    // L'initialisation MySQL est asynchrone et sans serveur local en test :
    // on neutralise uniquement le rejet tardif, pas le chargement des modules.
    process.on('unhandledRejection', () => {});
    const appModule = require(${JSON.stringify(appPath)});
    if (!appModule.app || typeof appModule.appReady?.then !== 'function' || typeof appModule.getAppPool !== 'function') {
      console.error('APP_INVALID');
      process.exit(2);
    }
    console.log('APP_LOAD_OK');
    process.exit(0);
  `);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.equal(result.status, 0, `chargement app.js : ${output.slice(-1200)}`);
  assert.match(result.stdout, /APP_LOAD_OK/);
  assert.doesNotMatch(output, /Cannot access 'createAdminActionLimiter' before initialization/);
});

test('server.js démarre réellement et atteint le listen sans erreur de chargement', () => {
  if (process.env.MOVIX_SKIP_STARTUP_SMOKE === '1') return;

  const port = String(25000 + (process.pid % 1000));
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: apiRoot,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      JWT_SECRET: 'admin-load-test-secret',
      PORT: port,
      NODE_ENV: 'test',
    },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.doesNotMatch(output, /Cannot access 'createAdminActionLimiter' before initialization/);
  assert.match(output, /Serveur démarré sur le port/);
  // Le processus est volontairement interrompu : ce test vérifie uniquement
  // que la chaîne de chargement atteint `listen` sans erreur de module.
});
