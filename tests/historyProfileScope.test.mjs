import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadService(storage, account) {
  const calls = [];
  const axios = {
    async get(url, config) { calls.push({ method: 'get', url, config }); return { status: 200, data: { items: [], complete: true } }; },
    async delete(url, config) { calls.push({ method: 'delete', url, config }); return { status: 204 }; },
  };
  const source = readFileSync(new URL('../src/services/historyService.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const localStorage = { getItem: (key) => (key in storage ? storage[key] : null) };
  new Function('exports', 'require', 'localStorage', js)(exports, (name) => {
    if (name === 'axios') return axios;
    if (name === '../config/runtime') return { MAIN_API: 'https://api.test' };
    if (name === '../utils/accountAuth') return { getResolvedAccountContext: () => account };
    throw new Error(`module inattendu : ${name}`);
  }, localStorage);
  return { service: exports, calls };
}

test('l’historique cible la sélection du compte courant, pas le profil global périmé', async () => {
  const { service, calls } = loadService({
    auth_token: 'token',
    selected_profile_id: 'ancien-profil',
    'movix_selected_profile:oauth:user-1': 'profil-attendu'
  }, { userType: 'oauth', userId: 'user-1' });

  await service.fetchContinueWatching('fr-FR');
  await service.hideContinueWatching('tv', 1399);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.params.profileId, 'profil-attendu');
  assert.equal(calls[1].config.params.profileId, 'profil-attendu');
  assert.ok(!calls.some(call => Object.values(call.config.params || {}).includes('ancien-profil')));
});

test('sans sélection account-scopée, l’historique n’utilise pas un profil global d’un autre compte', async () => {
  const { service, calls } = loadService({ auth_token: 'token', selected_profile_id: 'ancien-profil' }, { userType: 'oauth', userId: 'user-1' });

  assert.equal(await service.fetchContinueWatching('fr-FR'), null);
  assert.equal(calls.length, 0);
});
