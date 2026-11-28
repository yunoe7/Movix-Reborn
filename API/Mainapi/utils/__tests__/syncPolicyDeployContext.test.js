const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const apiRoot = resolve(__dirname, '..', '..');
const repoRoot = resolve(apiRoot, '..', '..');
const policyPath = join(apiRoot, 'utils', 'syncPolicy.js');
const contractPath = join(apiRoot, 'shared', 'syncKeys.json');

// Reproduit le root directory Railway `/API/Mainapi` : seuls les fichiers de
// l'API sont présents, sans le reste du dépôt. Aucun réseau ni base de données.
function isolatedDeployTree() {
  const dir = mkdtempSync(join(tmpdir(), 'movix-mainapi-'));
  mkdirSync(join(dir, 'utils'), { recursive: true });
  mkdirSync(join(dir, 'shared'), { recursive: true });
  copyFileSync(policyPath, join(dir, 'utils', 'syncPolicy.js'));
  copyFileSync(contractPath, join(dir, 'shared', 'syncKeys.json'));
  return dir;
}

test('la politique se charge depuis un contexte ne contenant que API/Mainapi', () => {
  const dir = isolatedDeployTree();
  try {
    const script = `
      const policy = require('./utils/syncPolicy.js');
      const contract = require('./shared/syncKeys.json');
      const exact = [...policy.SYNCABLE_EXACT_KEYS].sort().join('|');
      const expectedExact = [...contract.exact].sort().join('|');
      const rejected = policy.partitionSyncOps([{ op: 'set', key: 'is_vip', value: 'true' }]).rejected;
      const ok =
        exact === expectedExact &&
        JSON.stringify([...policy.SYNCABLE_PREFIXES]) === JSON.stringify(contract.prefixes) &&
        JSON.stringify(policy.SERVER_MANAGED_SYNC_KEYS) === JSON.stringify(contract.serverManaged) &&
        policy.isSyncableStorageKey('is_vip') === false &&
        rejected.length === 1 && rejected[0].code === 'INVALID_SYNC_KEY' &&
        rejected[0].serverManagedRejected === true;
      process.stdout.write(JSON.stringify({ ok, exact: contract.exact.length, blocked: contract.blocked.length }));
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '' },
    });

    assert.equal(result.status, 0, `chargement échoué: ${result.stderr}`);
    assert.equal(result.stderr.includes('MODULE_NOT_FOUND'), false, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, exact: 31, blocked: 33 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le contrat reste unique et aucune import ne sort de API/Mainapi', () => {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  assert.equal(contract.exact.length, 31);
  assert.equal(contract.prefixes.length, 10);
  assert.equal(contract.blocked.length, 33);
  assert.deepEqual(contract.serverManaged, ['is_vip']);
  assert.equal(contract.exact.includes('is_vip'), false);
  for (const key of ['auth', 'access_token', 'user_id', 'session_id']) {
    assert.ok(contract.blocked.includes(key), `clé sensible non bloquée: ${key}`);
  }

  const policySource = readFileSync(policyPath, 'utf8');
  assert.match(policySource, /require\('\.\.\/shared\/syncKeys\.json'\)/);
  assert.doesNotMatch(policySource, /\.\.\/\.\.\/\.\.\/shared/);

  const frontendSource = readFileSync(join(repoRoot, 'src', 'utils', 'syncStorage.ts'), 'utf8');
  assert.match(frontendSource, /API\/Mainapi\/shared\/syncKeys\.json/);
  assert.doesNotMatch(frontendSource, /\.\.\/\.\.\/shared\/syncKeys\.json/);

  const dockerignore = readFileSync(join(repoRoot, '.dockerignore'), 'utf8');
  assert.match(dockerignore, /!API\/Mainapi\/shared\/syncKeys\.json/);

  assert.equal(existsSync(join(repoRoot, 'shared', 'syncKeys.json')), false);
});
