'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getAuthIfValid } = require('../middleware/auth');
const { getPool } = require('../mysqlPool');
const { redis } = require('../config/redis');
const { fetchTmdbDetails } = require('../utils/tmdbCache');
const { ensureImported } = require('../utils/historyImport');
const {
  ALLOWED_SYNC_USER_TYPES,
  SyncPolicyError,
  ensureSafeProfileId,
  ensureSafeUserId,
  getOwnedProfile,
} = require('../utils/syncPolicy');
const { buildRecommendations, mediaKey } = require('../utils/recommendationEngine');

const router = express.Router();
const TMDB_API_URL = 'https://api.themoviedb.org/3';
const CACHE_TTL_SECONDS = 10 * 60;
const MAX_HISTORY_ITEMS = 12;
const MAX_RECOMMENDATION_REQUESTS = 4;
const LANGUAGES = new Set(['fr-FR', 'en-US']);

const recommendationsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0].trim()
    || ipKeyGenerator(req.ip),
  validate: { xForwardedForHeader: false, ip: false },
  message: { success: false, error: 'Trop de demandes de recommandations. Réessaie dans une minute.' },
});

function emptyResult(contentAnalyzed = 0) {
  return {
    success: true,
    becauseYouWatched: [],
    topGenres: [],
    trendingForYou: [],
    usersAlsoWatched: [],
    profileSummary: {
      topGenreIds: [],
      preferredFormat: 'mixed',
      topDecade: null,
      contentAnalyzed,
    },
  };
}

function parseLanguage(value) {
  return LANGUAGES.has(value) ? value : 'fr-FR';
}

function cacheKey(owner, language) {
  const digest = crypto.createHash('sha256')
    .update(`${owner.userType}:${owner.userId}:${owner.profileId}:${language}`)
    .digest('hex');
  return `recommendations:personalized:${digest}`;
}

async function readCache(key) {
  if (!redis || redis.status !== 'ready') return null;
  try {
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return parsed && parsed.success === true ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCache(key, value) {
  if (!redis || redis.status !== 'ready') return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Les recommandations restent disponibles même si le cache est en panne.
  }
}

async function resolveOwner(req, res) {
  const auth = await getAuthIfValid(req);
  if (!auth || !ALLOWED_SYNC_USER_TYPES.includes(auth.userType)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  const userType = auth.userType;
  const userId = ensureSafeUserId(auth.userId);
  const profileId = ensureSafeProfileId(req.query.profileId);
  const sync = require('./sync');
  const userData = await sync.readUserData(userType, userId);
  getOwnedProfile(userData, profileId);
  return { userType, userId, profileId, sync };
}

function tmdbRequestUrl(type, id) {
  return `${TMDB_API_URL}/${type}/${id}/recommendations`;
}

async function fetchRecommendationsFor(source, language, apiKey) {
  const response = await axios.get(tmdbRequestUrl(source.media_type, source.tmdb_id), {
    params: { api_key: apiKey, language, page: 1 },
    timeout: 8000,
  });
  return Array.isArray(response.data?.results) ? response.data.results : [];
}

router.get('/recommendations/personalized', recommendationsRateLimit, async (req, res) => {
  try {
    const owner = await resolveOwner(req, res);
    if (!owner) return;

    const language = parseLanguage(req.query.language);
    const profileData = await owner.sync.readProfileData(owner.userType, owner.userId, owner.profileId);
    if (
      profileData?.settings_disable_recommendations === 'true'
      || profileData?.privacy_data_collection === 'false'
    ) {
      return res.status(200).json(emptyResult());
    }

    const key = cacheKey(owner, language);
    const cached = await readCache(key);
    if (cached) return res.status(200).json(cached);

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return res.status(200).json(emptyResult());

    const historyStore = owner.sync.getHistoryStore();
    const importStatus = await ensureImported(
      getPool(),
      historyStore,
      { userType: owner.userType, userId: owner.userId, profileId: owner.profileId },
      owner.sync.readProfileImportData,
    );
    if (importStatus !== 'imported' && importStatus !== 'already') {
      return res.status(200).json(emptyResult());
    }

    // Les recommandations se basent sur tout l'historique récent du profil,
    // films et séries terminés ou non, sans consulter les autres profils.
    const [historyRows] = await getPool().execute(
      `SELECT media_type, tmdb_id, last_watched_at
       FROM watch_history
       WHERE user_type = ? AND user_id = ? AND profile_id = ? AND hidden = 0
       ORDER BY last_watched_at DESC
       LIMIT ?`,
      [owner.userType, owner.userId, owner.profileId, MAX_HISTORY_ITEMS],
    );
    if (!Array.isArray(historyRows) || historyRows.length === 0) {
      const result = emptyResult();
      await writeCache(key, result);
      return res.status(200).json(result);
    }

    const history = historyRows
      .filter((row) => (row.media_type === 'movie' || row.media_type === 'tv') && Number(row.tmdb_id) > 0)
      .map((row) => ({ ...row, tmdb_id: Number(row.tmdb_id) }));
    const detailsPairs = await Promise.all(history.map(async (item) => {
      try {
        const details = await fetchTmdbDetails(TMDB_API_URL, apiKey, item.tmdb_id, item.media_type, language);
        return [mediaKey(item.media_type, item.tmdb_id), details || null];
      } catch {
        return [mediaKey(item.media_type, item.tmdb_id), null];
      }
    }));
    const detailsByKey = new Map(detailsPairs.filter(([, details]) => details));

    // Les titres sans détails TMDB ne déclenchent pas d'appel de recommandations.
    const sources = history.filter((item) => detailsByKey.has(mediaKey(item.media_type, item.tmdb_id)))
      .slice(0, MAX_RECOMMENDATION_REQUESTS);
    const recommendationPairs = await Promise.all(sources.map(async (source) => {
      try {
        return [mediaKey(source.media_type, source.tmdb_id), await fetchRecommendationsFor(source, language, apiKey)];
      } catch (error) {
        console.warn('[RECOMMENDATIONS] TMDB request failed:', error.response?.status || error.code || error.message);
        return [mediaKey(source.media_type, source.tmdb_id), []];
      }
    }));
    const result = {
      success: true,
      ...buildRecommendations({
        history: sources.map((source) => ({
          ...source,
          title: detailsByKey.get(mediaKey(source.media_type, source.tmdb_id))?.title
            || detailsByKey.get(mediaKey(source.media_type, source.tmdb_id))?.name
            || '',
        })),
        recommendationResults: new Map(recommendationPairs),
        detailsByKey,
      }),
    };
    await writeCache(key, result);
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof SyncPolicyError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    console.error('[RECOMMENDATIONS] Personalized recommendations failed:', error.message || error);
    return res.status(500).json({ success: false, error: 'Recommendations unavailable' });
  }
});

module.exports = router;
