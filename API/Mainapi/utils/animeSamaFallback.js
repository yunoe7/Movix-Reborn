'use strict';

const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESULTS = 20;
const MAX_QUERY_LENGTH = 120;

function cleanText(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeHttpUrl(value) {
  const text = cleanText(value, 2048);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.animes)) return payload.animes;
  return [];
}

function normalizeSearchResults(payload, sourceBaseUrl = 'https://anime-sama.to') {
  const rows = extractRows(payload);
  const seen = new Set();
  const results = [];

  for (const row of rows.slice(0, MAX_RESULTS * 2)) {
    if (!row || typeof row !== 'object') continue;
    const name = cleanText(row.name || row.title || row.nom, 200);
    if (!name) continue;

    const rawUrl = row.url || row.href || row.link || row.id;
    let url = safeHttpUrl(rawUrl);
    if (!url && typeof rawUrl === 'string' && /^[a-z0-9][a-z0-9._-]{0,180}$/i.test(rawUrl)) {
      url = new URL('/catalogue/' + encodeURIComponent(rawUrl) + '/', sourceBaseUrl).toString();
    }
    if (!url) continue;

    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (!/(^|\.)anime-sama\.[a-z]{2,}$/i.test(parsed.hostname)) continue;
    if (!/^\/catalogue\/[^/]+\/?$/i.test(parsed.pathname)) continue;

    const key = parsed.pathname.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const alternatives = Array.isArray(row.alternative_names)
      ? row.alternative_names
      : Array.isArray(row.alternativeNames) ? row.alternativeNames : [];
    results.push({
      url: parsed.toString(),
      name,
      image: safeHttpUrl(row.image || row.poster || row.cover || row.imageUrl),
      alternative_names: alternatives.map(value => cleanText(value, 120)).filter(Boolean).slice(0, 20),
      alternative_names_string: cleanText(row.alternative_names_string || row.alternativeNamesString, 1000),
      fallbackSource: 'atomic-anime-sama-api',
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function createAnimeSamaFallback({
  baseUrl = process.env.ANIME_SAMA_FALLBACK_URL || '',
  sourceBaseUrl = process.env.ANIME_SAMA_URL || 'https://anime-sama.to',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  http = axios,
  logger = console,
} = {}) {
  let parsedBase = null;
  try {
    const candidate = new URL(baseUrl);
    if (candidate.protocol === 'https:' && candidate.hostname) parsedBase = candidate;
  } catch { /* fallback disabled */ }

  const enabled = Boolean(parsedBase);
  let circuitUntil = 0;
  let failures = 0;
  const inFlight = new Map();

  async function search(query) {
    if (!enabled) return null;
    const normalizedQuery = cleanText(query, MAX_QUERY_LENGTH);
    if (!normalizedQuery) return null;
    if (Date.now() < circuitUntil) return null;
    const requestKey = normalizedQuery.toLocaleLowerCase();
    if (inFlight.has(requestKey)) return inFlight.get(requestKey);

    const pending = (async () => {
      try {
        const response = await http.get(new URL('/api/search', parsedBase).toString(), {
          params: { q: normalizedQuery },
          timeout: Math.max(1000, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 10000)),
          headers: { Accept: 'application/json' },
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 2 * 1024 * 1024,
          validateStatus: status => status >= 200 && status < 300,
        });
        const results = normalizeSearchResults(response?.data, sourceBaseUrl);
        if (!results.length) throw new Error('Réponse de secours vide ou incompatible');
        failures = 0;
        return results;
      } catch (error) {
        failures += 1;
        if (failures >= 2) {
          circuitUntil = Date.now() + 60 * 1000;
          failures = 0;
        }
        logger?.warn?.('[ANIME-SAMA FALLBACK] Recherche indisponible: ' + String(error?.message || error).slice(0, 160));
        return null;
      } finally {
        inFlight.delete(requestKey);
      }
    })();
    inFlight.set(requestKey, pending);
    return pending;
  }

  return Object.freeze({
    enabled,
    search,
    snapshot: () => ({
      enabled,
      paused: Date.now() < circuitUntil,
      retryAfterMs: Math.max(0, circuitUntil - Date.now()),
      inFlight: inFlight.size > 0,
    }),
  });
}

module.exports = {
  createAnimeSamaFallback,
  normalizeSearchResults,
};
