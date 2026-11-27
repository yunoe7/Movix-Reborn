import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPauseVotePassed } from '../API/watchpartyAPI/voteMajority.mjs';

test('une majorité absolue est requise, pas une simple moitié arrondie', () => {
  assert.equal(isPauseVotePassed(0, 1), false);
  assert.equal(isPauseVotePassed(1, 2), false);
  assert.equal(isPauseVotePassed(1, 3), false);
  assert.equal(isPauseVotePassed(2, 3), true);
  assert.equal(isPauseVotePassed(2, 4), false);
  assert.equal(isPauseVotePassed(3, 4), true);
  assert.equal(isPauseVotePassed(4, 4), true);
});

test('sans participant, aucun vote ne passe', () => {
  assert.equal(isPauseVotePassed(0, 0), false);
  assert.equal(isPauseVotePassed(1, 0), false);
});
