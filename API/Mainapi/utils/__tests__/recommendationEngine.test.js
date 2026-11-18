'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecommendations, normalizeItem } = require('../recommendationEngine');

test('normalizeItem returns the frontend contract for movies and series', () => {
  assert.deepEqual(normalizeItem({
    id: 42, title: 'Film', poster_path: '/poster.jpg', genre_ids: [28], popularity: 12,
  }, 'movie'), {
    id: 42, title: 'Film', name: undefined, poster_path: '/poster.jpg',
    backdrop_path: null, media_type: 'movie', overview: '', vote_average: 0,
    genre_ids: [28], score: 12,
  });

  const series = normalizeItem({ id: 9, name: 'Série' }, 'tv');
  assert.equal(series.title, 'Série');
  assert.equal(series.name, 'Série');
  assert.equal(series.media_type, 'tv');
});

test('buildRecommendations excludes already watched titles and groups by watched source', () => {
  const history = [
    { media_type: 'movie', tmdb_id: 1, title: 'Film source' },
    { media_type: 'tv', tmdb_id: 2, title: 'Série source' },
  ];
  const detailsByKey = new Map([
    ['movie:1', { title: 'Film source', poster_path: '/source.jpg', genres: [{ id: 28, name: 'Action' }] }],
    ['tv:2', { name: 'Série source', genres: [{ id: 28, name: 'Action' }, { id: 18, name: 'Drame' }] }],
  ]);
  const recommendationResults = new Map([
    ['movie:1', [
      { id: 1, title: 'Déjà vu', genre_ids: [28], popularity: 100 },
      { id: 3, title: 'Recommandation A', genre_ids: [28], popularity: 30 },
    ]],
    ['tv:2', [
      { id: 4, name: 'Recommandation B', genre_ids: [18], popularity: 50 },
      { id: 3, name: 'Recommandation A', genre_ids: [28], popularity: 20 },
    ]],
  ]);

  const result = buildRecommendations({ history, recommendationResults, detailsByKey });
  assert.equal(result.becauseYouWatched.length, 2);
  assert.deepEqual(result.trendingForYou.map((item) => item.id), [4, 3]);
  assert.equal(result.trendingForYou.some((item) => item.id === 1), false);
  assert.equal(result.topGenres[0].genreId, 28);
  assert.equal(result.topGenres[0].genreName, 'Action');
  assert.equal(result.profileSummary.preferredFormat, 'mixed');
  assert.equal(result.profileSummary.contentAnalyzed, 2);
  assert.deepEqual(result.usersAlsoWatched, []);
});

test('buildRecommendations safely handles an empty history', () => {
  const result = buildRecommendations({
    history: [],
    recommendationResults: new Map(),
    detailsByKey: new Map(),
  });
  assert.deepEqual(result.becauseYouWatched, []);
  assert.deepEqual(result.topGenres, []);
  assert.deepEqual(result.trendingForYou, []);
  assert.equal(result.profileSummary.contentAnalyzed, 0);
});
