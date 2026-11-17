'use strict';

const express = require('express');

const router = express.Router();

function parseLinks(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTmdbId(value) {
  const id = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createCommunityLinksRouter(mysqlPool) {
  const routes = express.Router();

  routes.get('/movie/:id', async (req, res) => {
    const tmdbId = parseTmdbId(req.params.id);
    if (!tmdbId) return res.status(400).json({ success: false, error: 'invalid_tmdb_id' });
    try {
      const [rows] = await mysqlPool.execute(
        'SELECT links FROM films WHERE id = ? LIMIT 1',
        [tmdbId],
      );
      const links = rows.length ? parseLinks(rows[0].links) : [];
      return res.json({ success: true, data: { links } });
    } catch (error) {
      console.error('[communityLinks] movie lookup failed:', error.message);
      return res.status(500).json({ success: false, error: 'community_links_unavailable' });
    }
  });

  routes.get('/tv/:id', async (req, res) => {
    const tmdbId = parseTmdbId(req.params.id);
    const season = parseTmdbId(req.query.season);
    const episode = parseTmdbId(req.query.episode);
    if (!tmdbId || !season || !episode) {
      return res.status(400).json({ success: false, error: 'invalid_episode_parameters' });
    }
    try {
      const [rows] = await mysqlPool.execute(
        'SELECT links FROM series WHERE series_id = ? AND season_number = ? AND episode_number = ? LIMIT 1',
        [tmdbId, season, episode],
      );
      const data = rows.map((row) => ({ links: parseLinks(row.links) }));
      return res.json({ success: true, data });
    } catch (error) {
      console.error('[communityLinks] TV lookup failed:', error.message);
      return res.status(500).json({ success: false, error: 'community_links_unavailable' });
    }
  });

  return routes;
}

module.exports = { createCommunityLinksRouter, parseLinks, parseTmdbId };
