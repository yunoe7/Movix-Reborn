import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceFunction } from './helpers/sourceFunction.mjs';

const PAGE = 'src/hooks/useWrappedTracker.ts';

function storage(values) {
  return {
    getItem: (key) => (key in values ? values[key] : null)
  };
}

function readSession(values, fallbackProfileId = null) {
  const readWrappedSession = sourceFunction('src/utils/wrappedSession.ts', 'readWrappedSession', {
    getResolvedAccountContext: () => ({ userType: 'oauth', userId: 'user-1' })
  }, 'getResolvedAccountContext');
  return readWrappedSession(storage(values), fallbackProfileId);
}

test('la session Wrapped ignore le profil global périmé', () => {
  const session = readSession({
    auth_token: 'token',
    selected_profile_id: 'ancien-profil',
    'movix_selected_profile:oauth:user-1': 'profil-attendu'
  });

  assert.equal(session.profileId, 'profil-attendu');
});

test('la session Wrapped utilise le profil courant si la sélection account-scopée n’est pas encore écrite', () => {
  const session = readSession({ auth_token: 'token', selected_profile_id: 'ancien-profil' }, 'profil-courant');

  assert.equal(session.profileId, 'profil-courant');
});

test('la confidentialité désactivée reste respectée', () => {
  const session = readSession({ auth_token: 'token', privacy_data_collection: 'false' });

  assert.equal(session.collectionEnabled, false);
});

test('le tracker ne acquitte pas les secondes sur un 403 d’appartenance', async () => {
  const sends = [];
  const sendToApi = sourceFunction(PAGE, 'sendToApi', {
    useCallback: (fn) => fn,
    getUserInfo: () => ({ authToken: 'token', profileId: 'profil-attendu', userId: 'user-1' }),
    MAIN_API: 'https://api.test',
    fetch: async (url, init) => {
      sends.push({ url, init });
      return { ok: false, status: 403 };
    }
  });

  const accepted = await sendToApi({ mode: 'page', data: { pageName: 'home' } }, 30);

  assert.equal(accepted, false, 'un refus d’appartenance doit rester retryable');
  assert.equal(sends.length, 1);
  assert.equal(JSON.parse(sends[0].init.body).profileId, 'profil-attendu');
});

test('le tracker acquitte une réponse 4xx qui n’est pas un refus d’appartenance', async () => {
  const sendToApi = sourceFunction(PAGE, 'sendToApi', {
    useCallback: (fn) => fn,
    getUserInfo: () => ({ authToken: 'token', profileId: 'profil-attendu', userId: 'user-1' }),
    MAIN_API: 'https://api.test',
    fetch: async () => ({ ok: false, status: 400 })
  });

  assert.equal(await sendToApi({ mode: 'page', data: { pageName: 'home' } }, 30), true);
});
