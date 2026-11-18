'use strict';

const MAX_SOURCE_ITEMS = 8;
const MAX_GENRE_GROUPS = 3;
const MAX_GENRE_ITEMS = 12;
const MAX_TRENDING_ITEMS = 20;

function mediaKey(type, id) {
  return `${type}:${Number(id)}`;
}

function normalizeItem(item, mediaType) {
  const id = Number(item && item.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const isTv = mediaType === 'tv';
  return {
    id,
    title: String((isTv ? item.name : item.title) || (isTv ? item.original_name : item.original_title) || ''),
    name: isTv ? String(item.name || item.original_name || '') : undefined,
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    media_type: mediaType,
    overview: String(item.overview || ''),
    vote_average: Number.isFinite(Number(item.vote_average)) ? Number(item.vote_average) : 0,
    genre_ids: Array.isArray(item.genre_ids) ? item.genre_ids.map(Number).filter(Number.isInteger) : [],
    score: Number.isFinite(Number(item.popularity)) ? Number(item.popularity) : 0,
  };
}

function buildRecommendations({ history, recommendationResults, detailsByKey }) {
  const watched = new Set((history || []).map((item) => mediaKey(item.media_type, item.tmdb_id)));
  const groups = [];
  const candidates = new Map();
  const genreCounts = new Map();
  const genreNames = new Map();
  let movieCount = 0;
  let tvCount = 0;

  for (const source of (history || [])) {
    if (source.media_type === 'movie') movieCount += 1;
    if (source.media_type === 'tv') tvCount += 1;
    const sourceKey = mediaKey(source.media_type, source.tmdb_id);
    const details = detailsByKey.get(sourceKey);
    for (const genre of (Array.isArray(details?.genres) ? details.genres : [])) {
      const id = Number(genre.id);
      if (!Number.isInteger(id)) continue;
      genreCounts.set(id, (genreCounts.get(id) || 0) + 1);
      if (genre.name) genreNames.set(id, String(genre.name));
    }

    const raw = recommendationResults.get(sourceKey) || [];
    const items = raw
      .map((item) => normalizeItem(item, source.media_type))
      .filter((item) => item && item.title && !watched.has(mediaKey(item.media_type, item.id)))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SOURCE_ITEMS);
    if (items.length > 0) {
      groups.push({
        title: details?.title || details?.name || source.title || 'Ce que tu as regardé',
        sourceId: Number(source.tmdb_id),
        sourceType: source.media_type,
        poster_path: details?.poster_path || null,
        items,
      });
    }
    for (const item of items) {
      const key = mediaKey(item.media_type, item.id);
      const previous = candidates.get(key);
      if (!previous || item.score > previous.score) candidates.set(key, item);
    }
  }

  const topGenreIds = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_GENRE_GROUPS)
    .map(([id]) => id);

  const topGenres = topGenreIds.map((genreId) => ({
    genreId,
    genreName: genreNames.get(genreId) || `Genre ${genreId}`,
    items: [...candidates.values()]
      .filter((item) => item.genre_ids.includes(genreId))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_GENRE_ITEMS),
  })).filter((group) => group.items.length > 0);

  const trendingForYou = [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TRENDING_ITEMS);

  return {
    becauseYouWatched: groups.slice(0, 5),
    topGenres,
    trendingForYou,
    // Le filtrage collaboratif n'est pas activé : aucune donnée d'un autre profil
    // n'est exposée tant qu'un traitement agrégé et consenti n'existe pas.
    usersAlsoWatched: [],
    profileSummary: {
      topGenreIds,
      preferredFormat: movieCount === tvCount ? 'mixed' : movieCount > tvCount ? 'movie' : 'tv',
      topDecade: null,
      contentAnalyzed: (history || []).length,
    },
  };
}

module.exports = { buildRecommendations, normalizeItem, mediaKey };
