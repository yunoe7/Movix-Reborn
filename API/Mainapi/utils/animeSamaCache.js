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

module.exports = { canReuseSeasonCache };
