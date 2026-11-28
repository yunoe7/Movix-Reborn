import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const FILE = 'src/services/apiNotificationService.ts';
const source = readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8');

function loadGetUnreadCount({ axios, getAuthToken, getCurrentProfileId }) {
  const state = source.match(/let unreadCountInFlight[^;]+;/);
  const fn = source.match(/export async function getUnreadNotificationsCount\(\): Promise<number> \{[\s\S]*?\n\}/);
  assert.ok(state, 'état de déduplication introuvable');
  assert.ok(fn, 'getUnreadNotificationsCount introuvable');

  const js = ts.transpile(
    `${state[0]}\n${fn[0].replace(/^export /, '')}\nreturn getUnreadNotificationsCount;`,
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  );
  return new Function('axios', 'getAuthToken', 'getCurrentProfileId', 'API_URL', 'console', js)(
    axios, getAuthToken, getCurrentProfileId, 'https://api.test', { error() {}, log() {}, warn() {} }
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const requests = [];
  let token = 'token-a';
  let profileId = 'profile-a';
  const axios = {
    get(url, config) {
      const pending = deferred();
      requests.push({ url, config, pending });
      return pending.promise;
    },
  };
  const getUnreadCount = loadGetUnreadCount({
    axios,
    getAuthToken: () => token,
    getCurrentProfileId: () => profileId,
  });
  return {
    requests,
    getUnreadCount,
    setIdentity(nextToken, nextProfileId) {
      token = nextToken;
      profileId = nextProfileId;
    },
    setProfile(nextProfileId) {
      profileId = nextProfileId;
    },
  };
}

test('deux appels pour le même profil partagent la requête et conservent le timeout', async () => {
  const { requests, getUnreadCount } = fixture();

  const first = getUnreadCount();
  const second = getUnreadCount();

  assert.equal(requests.length, 1, 'les appels concurrents du même profil doivent être dédupliqués');
  assert.equal(requests[0].url, 'https://api.test/api/comments/notifications/unread-count');
  assert.deepEqual(requests[0].config.params, { profileId: 'profile-a' });
  assert.equal(requests[0].config.timeout, 5000);
  assert.equal(requests[0].config.headers.Authorization, 'Bearer token-a');

  requests[0].pending.resolve({ data: { count: 7 } });
  assert.equal(await first, 7);
  assert.equal(await second, 7);
});

test('un changement de profil pendant le vol ne réutilise pas la réponse précédente', async () => {
  const { requests, getUnreadCount, setProfile } = fixture();

  const oldProfileCount = getUnreadCount();
  setProfile('profile-b');
  const newProfileCount = getUnreadCount();

  assert.equal(requests.length, 2, 'le nouveau profil doit lancer sa propre requête');
  assert.deepEqual(requests.map((item) => item.config.params.profileId), ['profile-a', 'profile-b']);

  // La fin de la requête A ne doit pas effacer la déduplication de la requête B.
  requests[0].pending.resolve({ data: { count: 3 } });
  assert.equal(await oldProfileCount, 3);
  const newProfileDuplicate = getUnreadCount();
  assert.equal(requests.length, 2, 'la requête B reste dédupliquée après la fin de A');

  requests[1].pending.resolve({ data: { count: 11 } });
  assert.equal(await newProfileCount, 11);
  assert.equal(await newProfileDuplicate, 11);
  assert.deepEqual(requests.map((item) => item.config.params.profileId), ['profile-a', 'profile-b']);
});

test('un changement de compte pendant le vol ne réutilise pas la réponse précédente', async () => {
  const { requests, getUnreadCount, setIdentity } = fixture();

  const oldAccountCount = getUnreadCount();
  setIdentity('token-b', 'profile-a');
  const newAccountCount = getUnreadCount();

  assert.equal(requests.length, 2, 'le nouveau compte doit lancer sa propre requête');
  assert.deepEqual(requests.map((item) => item.config.headers.Authorization), ['Bearer token-a', 'Bearer token-b']);

  requests[0].pending.resolve({ data: { count: 1 } });
  requests[1].pending.resolve({ data: { count: 9 } });
  assert.equal(await oldAccountCount, 1);
  assert.equal(await newAccountCount, 9);
});
