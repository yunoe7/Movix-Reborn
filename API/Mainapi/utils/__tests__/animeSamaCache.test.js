'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canReuseSeasonCache } = require('../animeSamaCache');

const sameEpisodes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('legacy season cache without path is rewritten even when episodes are unchanged', () => {
  const episodes = [{ index: 1, streaming_links: [] }];
  assert.equal(canReuseSeasonCache({}, 'saison1', episodes, episodes, sameEpisodes), false);
});

test('season cache is reused when path and episode payload match', () => {
  const episodes = [{ index: 1, streaming_links: [] }];
  assert.equal(canReuseSeasonCache({ path: 'saison1' }, 'saison1', episodes, episodes, sameEpisodes), true);
});

test('season cache is rewritten when the site season path changes', () => {
  const episodes = [{ index: 1, streaming_links: [] }];
  assert.equal(canReuseSeasonCache({ path: 'saison1-old' }, 'saison1', episodes, episodes, sameEpisodes), false);
});

test('season cache is rewritten when episode payload changes', () => {
  const cached = [{ index: 1, streaming_links: [] }];
  const latest = [{ index: 1, streaming_links: [{ language: 'vostfr', refs: [{ id: '123' }] }] }];
  assert.equal(canReuseSeasonCache({ path: 'saison1' }, 'saison1', cached, latest, sameEpisodes), false);
});
