import assert from 'node:assert/strict';
import test from 'node:test';
import { getSourceCapabilities, isSourceEnabled } from '../src/services/sourceCapabilities.ts';

const capabilities = (kisskh: boolean, cpasmal: boolean) => ({
  kisskh: { enabled: kisskh },
  cpasmal: { enabled: cpasmal },
});

test('une capacité absente ou invalide ne désactive pas le fournisseur par défaut', () => {
  assert.equal(isSourceEnabled(null, 'kisskh'), true);
  assert.equal(isSourceEnabled({}, 'cpasmal'), true);
  assert.equal(isSourceEnabled(capabilities(false, true), 'kisskh'), false);
  assert.equal(isSourceEnabled(capabilities(true, false), 'cpasmal'), false);
});

test('les capacités sont lues une seule fois et mises en cache', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls += 1;
    assert.equal(String(input), 'https://api.test/api/source-capabilities');
    return new Response(JSON.stringify(capabilities(false, true)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const first = await getSourceCapabilities('https://api.test/');
    const second = await getSourceCapabilities('https://api.test/');
    assert.deepEqual(first, capabilities(false, true));
    assert.deepEqual(second, capabilities(false, true));
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('une réponse invalide ou une panne du endpoint laisse les fournisseurs activés', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not json', { status: 500 });
  try {
    assert.equal(await getSourceCapabilities('https://broken.test/'), null);
    assert.equal(isSourceEnabled(await getSourceCapabilities('https://broken.test/'), 'kisskh'), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
