/**
 * Cache management utilities.
 * Extracted from server.js — centralizes all file-based and memory cache helpers.
 */

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const writeFileAtomic = require('write-file-atomic');
const { redis } = require('../config/redis');

// === CACHE DIRECTORIES ===
// NOTE: __dirname is API/utils/, so we go up one level to reach API/
const ANIME_SAMA_CACHE_DIR = path.join(__dirname, '..', 'cache', 'anime-sama');

const CACHE_DIR = {
  ANIME_SAMA: ANIME_SAMA_CACHE_DIR,
  COFLIX: path.join(__dirname, '..', 'cache', 'coflix'),
  CPASMAL: path.join(__dirname, '..', 'cache', 'cpasmal'),
  TVDIRECT: path.join(__dirname, '..', 'cache', 'tvdirect'),
  PURSTREAM: path.join(__dirname, '..', 'cache', 'purstream'),
  NOCTAFLIX: path.join(__dirname, '..', 'cache', 'noctaflix'),
  FTV: path.join(__dirname, '..', 'cache', 'ftv'),
  J1F: path.join(__dirname, '..', 'cache', '1jour1film'),
  SWIFTFLOW: path.join(__dirname, '..', 'cache', 'swiftflow')
};

const DEFAULT_CACHE_REFRESH_WINDOW_MS = 40 * 60 * 1000;

// Cr\u00e9er les dossiers de cache s'ils n'existent pas
(async () => {
  for (const dir of Object.values(CACHE_DIR)) {
    try {
      await fsp.access(dir);
    } catch {
      await fsp.mkdir(dir, { recursive: true });
    }
  }
})();

// Fonction pour g\u00e9n\u00e9rer une cl\u00e9 de cache bas\u00e9e sur les param\u00e8tres
const generateCacheKey = (params) => {
  const stringParams = typeof params === 'string' ? params : JSON.stringify(params);
  return crypto.createHash('md5').update(stringParams).digest('hex');
};

// Fonction pour corriger le type de stream bas\u00e9 sur l'URL
const correctStreamType = (streamData) => {
  if (streamData && streamData.url && streamData.url.includes('.mp4')) {
    return {
      ...streamData,
      type: 'mp4'
    };
  }
  return streamData;
};

// Fonction pour v\u00e9rifier si une donn\u00e9e est en cache avec expiration de 8h
const getFromCacheWithExpiration = async (cacheDir, key, expirationHours = 8) => {
  try {
    // Le fichier seul fait foi (voir getFromCacheNoExpiration).
    const cacheFilePath = path.join(cacheDir, `${key}.json`);
    let stats;
    try {
      stats = await fsp.stat(cacheFilePath);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }

    const now = Date.now();
    const fileTime = stats.mtime.getTime();
    const expirationTime = expirationHours * 60 * 60 * 1000; // en millisecondes

    // V\u00e9rifier si le cache a expir\u00e9
    if (now - fileTime > expirationTime) {
      return null;
    }

    const fileContent = await fsp.readFile(cacheFilePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error(`Erreur lors de la r\u00e9cup\u00e9ration du cache pour ${key}:`, error);
    return null;
  }
};

// Fonction pour sauvegarder des donn\u00e9es en cache
const saveToCache = async (cacheDir, key, data) => {
  try {
    const cacheFilePath = path.join(cacheDir, `${key}.json`);

    // S'assurer que le dossier de cache existe
    await fsp.mkdir(cacheDir, { recursive: true });

    // OPTIMISATION: Utiliser write-file-atomic directement sans lockfile
    // lockfile (utilis\u00e9 dans safeWriteFile) ajoute 50-100ms de latence par \u00e9criture
    // Pour des fichiers de cache temporaires, atomic write suffit largement
    await writeFileAtomic(cacheFilePath, JSON.stringify(data), { encoding: 'utf8', fsync: false });
    return true;
  } catch (error) {
    console.error(`Erreur lors de la sauvegarde en cache pour ${key}:`, error);
    return false;
  }
};

// Fonction pour vérifier si une donnée est en cache sans vérifier la date d'expiration
const getFromCacheNoExpiration = async (cacheDir, key) => {
  try {
    // Le fichier seul fait foi, sans copie Redis de 5 min devant lui : les six
    // workers lisent le même disque, et la plupart des titres ne sont pas revus
    // dans les 5 min. Chaque visite payait un GET Redis presque toujours vide,
    // puis un SET de recopie (rapport du 2026-10-19 : 2 948 SET Swiftflow pour
    // 3 232 lectures, 2 933 Coflix pour 3 297, ~2 700 Purstream).
    const cacheFilePath = path.join(cacheDir, `${key}.json`);
    let fileContent;
    try {
      fileContent = await fsp.readFile(cacheFilePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }

    const cacheData = JSON.parse(fileContent);

    // Validation: s'assurer que les données en cache ne sont pas du texte "Maintenance en cours"
    if (typeof cacheData === 'string' && cacheData.includes('Maintenance en cours')) {
      console.error(`Cache invalide détecté pour ${key} - contient "Maintenance en cours"`);
      try { await fsp.unlink(cacheFilePath); } catch (unlinkError) { }
      return null;
    }

    // Validation: s'assurer que les données en cache sont bien du JSON valide et pas du texte brut
    if (typeof cacheData === 'string' || cacheData === null || cacheData === undefined) {
      console.error(`Cache invalide détecté pour ${key} - données non-JSON ou nulles`);
      try { await fsp.unlink(cacheFilePath); } catch (unlinkError) { }
      return null;
    }

    return cacheData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error(`Erreur lors de la récupération du cache pour ${key}:`, error);
    return null;
  }
};

// Vérifier l'âge du cache, avec un délai de 40 minutes par défaut.
const shouldUpdateCache = async (cacheDir, cacheKey, refreshWindowMs = 40 * 60 * 1000) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    if (fileAge < refreshWindowMs) {
      return false; // Ne pas mettre à jour le cache
    }
    return true; // Mettre à jour le cache
  } catch (error) {
    // Si le fichier n'existe pas ou erreur de lecture, continuer avec la mise à jour
    return true;
  }
};

// Fonction pour vérifier si le cache French-Stream doit être mis à jour (3 heures)
const getCacheRefreshInfo = async (cacheDir, cacheKey, refreshWindowMs = DEFAULT_CACHE_REFRESH_WINDOW_MS) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const lastModifiedAtMs = stats.mtime.getTime();
    const refreshAvailableAtMs = lastModifiedAtMs + refreshWindowMs;
    const refreshInMs = Math.max(refreshAvailableAtMs - now, 0);

    return {
      shouldRefreshNow: refreshInMs === 0,
      cacheLastModifiedAt: new Date(lastModifiedAtMs).toISOString(),
      refreshAvailableAt: new Date(refreshAvailableAtMs).toISOString(),
      refreshInMs,
      refreshInMinutes: Math.ceil(refreshInMs / 60000)
    };
  } catch (error) {
    return {
      shouldRefreshNow: true,
      cacheLastModifiedAt: null,
      refreshAvailableAt: null,
      refreshInMs: 0,
      refreshInMinutes: 0
    };
  }
};

// Fonction pour rafraichir la date d'un cache sans ecraser son contenu
const touchCacheEntry = async (cacheDir, key) => {
  try {
    const cacheFilePath = path.join(cacheDir, `${key}.json`);
    const now = new Date();
    await fsp.utimes(cacheFilePath, now, now);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    console.error(`Erreur lors du rafraichissement du cache pour ${key}:`, error);
    return false;
  }
};

const shouldUpdateCacheFrenchStream = async (cacheDir, cacheKey) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    const threeHours = 3 * 60 * 60 * 1000; // 3 heures en millisecondes

    if (fileAge < threeHours) {
      return false; // Ne pas mettre à jour le cache
    }
    return true; // Mettre à jour le cache
  } catch (error) {
    return true;
  }
};

// Fonction pour vérifier si le cache LecteurVideo doit être mis à jour (2 heures)
const shouldUpdateCacheLecteurVideo = async (cacheDir, cacheKey) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    const twoHours = 2 * 60 * 60 * 1000; // 2 heures en millisecondes

    if (fileAge < twoHours) {
      return false; // Ne pas mettre à jour le cache
    }
    return true; // Mettre à jour le cache
  } catch (error) {
    return true;
  }
};

// Fonction pour vérifier si le cache doit être mis à jour (24 heures) - utilisée pour la route decode
const shouldUpdateCache24h = async (cacheDir, cacheKey) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    const twentyFourHours = 24 * 60 * 60 * 1000; // 24 heures en millisecondes

    if (fileAge < twentyFourHours) {
      return false; // Ne pas mettre à jour le cache
    }
    return true; // Mettre à jour le cache
  } catch (error) {
    return true;
  }
};

const shouldUpdateCache48h = async (cacheDir, cacheKey) => {
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.json`);
  try {
    const stats = await fsp.stat(cacheFilePath);
    const now = Date.now();
    const fileAge = now - stats.mtime.getTime();
    const fortyEightHours = 48 * 60 * 60 * 1000;

    if (fileAge < fortyEightHours) {
      return false;
    }
    return true;
  } catch (error) {
    return true;
  }
};

module.exports = {
  CACHE_DIR,
  ANIME_SAMA_CACHE_DIR,
  generateCacheKey,
  correctStreamType,
  getFromCacheWithExpiration,
  getFromCacheNoExpiration,
  saveToCache,
  touchCacheEntry,
  getCacheRefreshInfo,
  shouldUpdateCache,
  shouldUpdateCacheFrenchStream,
  shouldUpdateCacheLecteurVideo,
  shouldUpdateCache24h,
  shouldUpdateCache48h,
};
