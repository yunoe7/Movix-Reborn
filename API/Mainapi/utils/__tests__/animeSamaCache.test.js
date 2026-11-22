'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canReuseSeasonCache, hasMissingSeasonPaths, hasHiddenSeasons } = require('../animeSamaCache');

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

test('detects legacy season cache entries without a path', () => {
  assert.equal(hasMissingSeasonPaths({ Season: { episodes: [{ index: 1 }] } }), true);
});

test('does not flag seasons that already have a path', () => {
  assert.equal(hasMissingSeasonPaths({ Season: { path: 'saison1', episodes: [{ index: 1 }] } }), false);
});

test('does not flag an empty or malformed season cache', () => {
  assert.equal(hasMissingSeasonPaths({}), false);
  assert.equal(hasMissingSeasonPaths(null), false);
});

// Une saison « masquée » n'a jamais été vérifiée par le code qui l'a mise en
// cache : sa page peut encore publier des repères lien:. Sans ce marqueur, un
// cache tout juste écrit par une actualisation précédente reste servi une heure
// sans que la page soit relue, même après correction du classement.
test('detects announced seasons cached as hidden without a page check', () => {
  assert.equal(hasHiddenSeasons({
    'Saison 2': { path: 'saison2', available: false, status: 'unavailable', unavailableReason: 'hidden', episodes: [] },
  }), true);
});

test('does not flag genuinely empty, absent or playable seasons as hidden', () => {
  assert.equal(hasHiddenSeasons({ 'Saison 2': { unavailableReason: 'empty', episodes: [] } }), false);
  assert.equal(hasHiddenSeasons({ 'Saison 2': { unavailableReason: 'absent', episodes: [] } }), false);
  assert.equal(hasHiddenSeasons({ 'Saison 2': { available: true, episodes: [{}] } }), false);
});

test('does not flag an empty or malformed season cache as hidden', () => {
  assert.equal(hasHiddenSeasons({}), false);
  assert.equal(hasHiddenSeasons(null), false);
  assert.equal(hasHiddenSeasons([]), false);
});
