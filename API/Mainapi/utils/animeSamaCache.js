'use strict';

/**
 * Whether a cached season can be reused without writing a fresh copy.
 *
 * A missing path is not equivalent to a matching path: legacy cache entries
 * need to be rewritten with the stable Anime-Sama season path discovered
 * during refresh, even when their episode payload is otherwise unchanged.
 */
function canReuseSeasonCache(seasonCache, seasonPath, cachedEpisodes, siteEpisodes, sameEpisodes) {
  return Array.isArray(cachedEpisodes)
    && seasonCache?.path === seasonPath
    && sameEpisodes(cachedEpisodes, siteEpisodes);
}

function hasMissingSeasonPaths(seasons) {
  if (!seasons || typeof seasons !== 'object' || Array.isArray(seasons)) return false;
  return Object.values(seasons).some((season) => (
    Array.isArray(season?.episodes) && (typeof season.path !== 'string' || !season.path.trim())
  ));
}

module.exports = { canReuseSeasonCache, hasMissingSeasonPaths };
