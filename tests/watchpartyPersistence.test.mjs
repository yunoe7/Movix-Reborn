import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('API/watchpartyAPI/watchparty.js', 'utf8');
const match = source.match(/function serializeRoom\(room\) \{[\s\S]*?\r?\n\}/);
if (!match) throw new Error('serializeRoom introuvable');
const serializeRoom = new Function(`return ${match[0]};`)();

function circularTimer() {
  const timer = {};
  timer.self = timer;
  return timer;
}

test('la sauvegarde exclut tous les timers, y compris le timer de nettoyage', () => {
  const serialized = serializeRoom({
    id: 'room-1',
    _cleanupTimer: circularTimer(),
    countdownTimer: circularTimer(),
    pauseTimerTimeout: circularTimer(),
    pauseVote: { votes: {}, timeoutId: circularTimer() },
  });

  assert.equal('_cleanupTimer' in serialized, false);
  assert.equal('countdownTimer' in serialized, false);
  assert.equal('pauseTimerTimeout' in serialized, false);
  assert.equal('timeoutId' in serialized.pauseVote, false);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('un salon sans vote est sérialisé avec un vote nul', () => {
  const serialized = serializeRoom({ id: 'room-2', _cleanupTimer: circularTimer() });
  assert.equal(serialized.pauseVote, null);
  assert.doesNotThrow(() => JSON.stringify(serialized));
});
