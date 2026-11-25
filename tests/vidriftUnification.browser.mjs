/**
 * E2E ciblé : unification VidRift du parcours « carte → fiche → lecteur ».
 *
 * Trois scénarios réels dans le navigateur (film, série avec reprise serveur,
 * animé TMDB) vérifient le seul lecteur /watch/movie|tv, l'iframe VidRift,
 * la reprise et le message local `vidrift:episode` (sans lire le flux externe).
 *
 * Relance :
 *   node tests/vidriftUnification.browser.mjs
 * Prérequis : Playwright/Chromium (CODEX_PRIMARY_RUNTIME_NODE_MODULES et
 * CHROMIUM_EXECUTABLE_PATH, CHROMIUM_ARGS en option, fournis par le
 * coordinateur), esbuild et tailwindcss dans node_modules. Aucun serveur de
 * dev ni API externe.
 * L'artefact (rapport JSON + 3 PNG) est écrit dans
 * VIDRIFT_UNIFICATION_ARTIFACT_DIR ou dans un dossier temporaire.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const execFileAsync = promisify(execFile);

const artifactDir = process.env.VIDRIFT_UNIFICATION_ARTIFACT_DIR
  ? path.resolve(process.env.VIDRIFT_UNIFICATION_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-vidrift-unification-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const movie = {
  id: 42,
  title: 'VidRift Movie Fixture',
  original_title: 'VidRift Movie Fixture',
  overview: 'Film de fixture pour le lecteur unifié.',
  poster_path: '/movie-poster.jpg',
  backdrop_path: '/movie-backdrop.jpg',
  release_date: '2024-03-01',
  vote_average: 8.5,
  genres: [{ id: 878, name: 'Science-fiction' }],
  runtime: 120,
  original_language: 'en',
  status: 'Released',
  production_companies: [],
  production_countries: [],
  spoken_languages: [],
  keywords: { results: [] },
  alternative_titles: { results: [] },
  credits: { cast: [{ id: 1, name: 'Acteur Film', character: 'Rôle', profile_path: '/profile.jpg' }], crew: [] },
};
const tv = {
  id: 84,
  name: 'VidRift Series Fixture',
  original_name: 'VidRift Series Fixture',
  overview: 'Série de fixture pour le lecteur unifié.',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  first_air_date: '2024-01-01',
  vote_average: 7.5,
  genres: [{ id: 18, name: 'Drame' }],
  number_of_seasons: 2,
  number_of_episodes: 4,
  seasons: [
    { season_number: 1, name: 'Saison 1', poster_path: '/season-1.jpg', air_date: '2024-01-01', episode_count: 1 },
    { season_number: 2, name: 'Saison 2', poster_path: '/season-2.jpg', air_date: '2025-01-01', episode_count: 3 },
  ],
  status: 'Returning Series',
  type: 'Scripted',
  original_language: 'en',
  external_ids: {},
  networks: [],
  production_companies: [],
  credits: { cast: [{ id: 2, name: 'Actrice Série', character: 'Rôle Série', profile_path: '/profile.jpg' }], crew: [] },
};
const anime = {
  id: 99999,
  name: 'VidRift Anime Fixture',
  original_name: 'VidRift Anime Fixture',
  overview: 'Animé TMDB de fixture, sans source Anime-Sama.',
  poster_path: '/anime-poster.jpg',
  backdrop_path: '/anime-backdrop.jpg',
  first_air_date: '2024-01-01',
  vote_average: 8.1,
  genres: [{ id: 16, name: 'Animation' }],
  origin_country: ['JP'],
  original_language: 'ja',
  number_of_seasons: 1,
  number_of_episodes: 1,
  seasons: [{ season_number: 1, name: 'Saison 1', poster_path: '/anime-season.jpg', air_date: '2024-01-01', episode_count: 1 }],
  keywords: { results: [{ id: 1, name: 'anime' }] },
  status: 'Ended',
  type: 'Scripted',
  external_ids: {},
  networks: [],
  production_companies: [],
  credits: { cast: [{ id: 3, name: 'Acteur Anime', character: 'Rôle Anime', profile_path: '/profile.jpg' }], crew: [] },
};

const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Route, Routes} from 'react-router-dom';
import MovieDetails from ${JSON.stringify(repo + '/src/pages/MovieDetails')};
import TVDetails from ${JSON.stringify(repo + '/src/pages/TVDetails')};
import WatchMovie from ${JSON.stringify(repo + '/src/pages/Watch/WatchMovie')};
import WatchTv from ${JSON.stringify(repo + '/src/pages/Watch/WatchTv')};

window.__fixtureRequests = [];
window.__vidriftInbound = [];
window.__vidriftLoads = [];
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'vidrift:fixture-inbound') window.__vidriftInbound.push(data.message);
  else if (typeof data.type === 'string' && data.type.startsWith('vidrift:')) window.__vidriftInbound.push(data);
  if (data.type === 'vidrift:fixture-load') window.__vidriftLoads.push(data.url);
});

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/movie/:id" element={<MovieDetails/>}/>
      <Route path="/tv/:id" element={<TVDetails/>}/>
      <Route path="/watch/movie/:tmdbid" element={<WatchMovie/>}/>
      <Route path="/watch/movie/:tmdbid/version/:version" element={<WatchMovie/>}/>
      <Route path="/watch/tv/:tmdbid/s/:season/e/:episode" element={<WatchTv/>}/>
      <Route path="*" element={<div data-testid="not-found">NotFound</div>}/>
    </Routes>
  </BrowserRouter>
);
`;

const stubSources = {
  axios: `
    const movie = ${JSON.stringify(movie)};
    const tv = ${JSON.stringify(tv)};
    const anime = ${JSON.stringify(anime)};
    const reply = (data) => ({ data, status: 200, statusText: 'OK', headers: {}, config: {} });
    const record = (url) => {
      if (!Array.isArray(window.__fixtureRequests)) window.__fixtureRequests = [];
      window.__fixtureRequests.push(String(url));
    };
    const tmdb = (pathname) => {
      if (/\\/movie\\/42\\/credits$/.test(pathname)) return movie.credits;
      if (/\\/movie\\/42\\/release_dates$/.test(pathname)) return { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, certification: 'PG-13' }] }] };
      if (/\\/movie\\/42\\/images$/.test(pathname)) return { backdrops: [{ file_path: '/movie-backdrop.jpg' }], posters: [], logos: [] };
      if (/\\/movie\\/42\\/videos$/.test(pathname)) return { results: [] };
      if (/\\/movie\\/42\\/recommendations$/.test(pathname)) return { results: [{ id: 7, title: 'Reco Film', poster_path: '/reco.jpg', backdrop_path: '', overview: '', vote_average: 7, release_date: '2023-01-01' }] };
      if (/\\/movie\\/42$/.test(pathname)) return movie;
      if (/\\/tv\\/84\\/season\\/(\\d+)\\/videos$/.test(pathname)) return { results: [] };
      const seriesSeason = pathname.match(/\\/tv\\/84\\/season\\/(\\d+)$/)?.[1];
      if (seriesSeason !== undefined) return {
        id: Number(seriesSeason), season_number: Number(seriesSeason), name: 'Saison ' + seriesSeason,
        poster_path: '/season-' + seriesSeason + '.jpg', air_date: '2024-01-01', episode_count: Number(seriesSeason) === 2 ? 3 : 1,
        episodes: Array.from({ length: Number(seriesSeason) === 2 ? 3 : 1 }, (_, index) => ({
          episode_number: index + 1, season_number: Number(seriesSeason), name: 'Épisode ' + (index + 1),
          overview: 'Synopsis fixture.', still_path: '/episode-still.jpg', air_date: '2024-01-01',
        })),
      };
      if (/\\/tv\\/84\\/content_ratings$/.test(pathname)) return { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] };
      if (/\\/tv\\/84\\/images$/.test(pathname)) return { backdrops: [{ file_path: '/tv-backdrop.jpg' }], posters: [], logos: [] };
      if (/\\/tv\\/84\\/videos$/.test(pathname)) return { results: [] };
      if (/\\/tv\\/84\\/recommendations$/.test(pathname)) return { results: [{ id: 9, name: 'Reco Série', poster_path: '/reco-tv.jpg', backdrop_path: '', overview: '', vote_average: 6, first_air_date: '2023-01-01' }] };
      if (/\\/tv\\/84\\/season\\/\\d+\\/episode\\/\\d+$/.test(pathname)) return { episode_number: 3, season_number: 2, name: 'Épisode 3', overview: '', still_path: '/episode-still.jpg', air_date: '2025-01-01' };
      if (/\\/tv\\/84$/.test(pathname)) return tv;
      if (/\\/tv\\/99999\\/season\\/(\\d+)$/.test(pathname)) return {
        id: 1, season_number: 1, name: 'Saison 1', poster_path: '/anime-season.jpg', air_date: '2024-01-01', episode_count: 1,
        episodes: [{ episode_number: 1, season_number: 1, name: 'Épisode 1', overview: '', still_path: '/anime-still.jpg', air_date: '2024-01-01' }],
      };
      if (/\\/tv\\/99999\\/content_ratings$/.test(pathname)) return { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] };
      if (/\\/tv\\/99999\\/images$/.test(pathname)) return { backdrops: [{ file_path: '/anime-backdrop.jpg' }], posters: [], logos: [] };
      if (/\\/tv\\/99999\\/videos$/.test(pathname)) return { results: [] };
      if (/\\/tv\\/99999\\/recommendations$/.test(pathname)) return { results: [{ id: 11, name: 'Reco Anime', poster_path: '/reco-anime.jpg', backdrop_path: '', overview: '', vote_average: 8, first_air_date: '2023-01-01' }] };
      if (/\\/tv\\/99999$/.test(pathname)) return anime;
      return { results: [], cast: [], crew: [] };
    };
    const get = async (url) => {
      record(url);
      const parsed = new URL(String(url), 'https://fixture.test');
      if (parsed.hostname === 'api.themoviedb.org') return reply(tmdb(parsed.pathname));
      return reply({ success: false });
    };
    const api = {
      get,
      post: async (url) => { record(url); return reply({}); },
      defaults: {},
      interceptors: { request: { use() {} }, response: { use() {} } },
      create() { return api; },
    };
    export default api;
    export { get };
  `,
  historyService: `
    export async function fetchTitleHistory(query) {
      const seed = window.__progressionSeed;
      if (!seed || seed.key !== query.type + ':' + query.id) return { ok: true, title: null };
      return {
        ok: true,
        title: {
          mediaType: query.type,
          tmdbId: query.id,
          status: 'in_progress',
          markedWatched: false,
          animeMode: false,
          estimated: false,
          position: seed.position,
          duration: seed.duration,
          season: seed.season ?? null,
          episode: seed.episode ?? null,
          episodesWatched: null,
          episodesTotal: null,
          episodes: [],
        },
      };
    }
  `,
  frembedConfig: `const base = 'https://frembed.test'; export const getFrembedBase = () => base; export const initFrembedBase = async () => base;`,
  searchUtils: `
    export const searchWithFallback = async () => [];
    export const getSearchNameForId = () => '';
    export const getAnimeMatcherForId = () => null;
    export const shouldHideAnimeModeForId = () => true;
  `,
  animeSamaService: `
    export const fetchAnimeByTmdb = async () => [];
    export const fetchAnimePlanning = async () => [];
    export const fetchAnimeEpisodeLinks = async () => [];
  `,
  animeMatcher: `
    export const pickBestAnimeMatch = () => ({ match: null, score: 0, reason: 'fixture' });
    export const collectTmdbNames = () => [];
  `,
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({showAdFreePopup:false,adType:'adfree',shouldLoadIframe:true,showPopupForPlayer:()=>{},handlePopupClose:()=>{},handlePopupAccept:()=>{},resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});`,
  reactI18next: `export const useTranslation=()=>({t:(key,opts={})=>String(key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,name)=>String(opts?.[name]??'')),i18n:{language:'fr-FR'}});`,
  i18n: `export const getTmdbLanguage=()=>'fr-FR'; export default {language:'fr-FR'};`,
  AddToListButton: `export default ()=>null;`,
  AddToListMenu: `export default ()=>null;`,
  DetailsSkeleton: `export default ()=> <div data-testid="details-skeleton"/>;`,
  ShareButtons: `export default ()=>null;`,
  EmblaCarousel: `export default ({items=[]})=> <div data-testid="recommendations">{items.map(item=><span key={item.id}>{item.title||item.name}</span>)}</div>;`,
  CommentsSection: `export default ()=> <div data-testid="comments"/>;`,
  LikeDislikeButton: `export const calculateLikeDislikeRating=()=>null; export default ()=><button>details.like</button>;`,
  MovixRatingInfoModal: `export default ()=>null;`,
  LazySection: `export default ({children})=><>{children}</>;`,
  SEO: `export default ()=>null;`,
  CharactersSection: `export default ()=>null;`,
  DetailExtraMetadata: `export default ()=>null;`,
  AlertButton: `export default ()=>null;`,
  AntiSpoilerSettings: `export default ()=>null;`,
  AntiSpoilerSettingsModal: `export default ()=>null;`,
  CustomDropdown: `export default ()=>null;`,
  useWrappedTracker: `export const useWrappedTracker=()=>{};`,
  useMovieReleaseWarnings: `export const useMovieReleaseWarnings=()=>false;`,
  useAntiSpoilerSettings: `export const useAntiSpoilerSettings=()=>({settings:{},updateSettings:()=>{},shouldHide:()=>false,getMaskedContent:(value)=>value,hasActiveSpoilerProtection:false});`,
  useTvAiringSchedule: `export const useTvAiringSchedule=()=>({schedule:null,now:Date.now()});`,
  detailCharacters: `export const loadDetailCharacters=async()=>({source:'tmdb',total:0,groups:[],themes:[]});`,
  dialog: `export const Dialog=({open,children})=>open ? <>{children}</> : null; export const DialogContent=({children})=><div>{children}</div>; export const DialogDescription=({children})=><p>{children}</p>; export const DialogHeader=({children})=><div>{children}</div>; export const DialogTitle=({children})=><h2>{children}</h2>;`,
  AdFreePlayerAds: `export default ()=>null;`,
  AdWaitingScreen: `export default ()=>null;`,
};

const stubPattern = /^axios$|^react-i18next$|(?:^|\/)i18n$|PrefetchLink$|AdFreePopupContext$|ProfileContext$|LightModeContext$|AddToListButton$|AddToListMenu$|DetailsSkeleton$|ShareButtons$|EmblaCarousel$|CommentsSection$|LikeDislikeButton$|MovixRatingInfoModal$|LazySection$|(?:^|\/)SEO$|CharactersSection$|DetailExtraMetadata$|AlertButton$|components\/AntiSpoilerSettings$|AntiSpoilerSettingsModal$|CustomDropdown$|useWrappedTracker$|useMovieReleaseWarnings$|useAntiSpoilerSettings$|useTvAiringSchedule$|detailCharacters$|components\/ui\/dialog$|services\/historyService$|utils\/frembedConfig$|utils\/searchUtils$|services\/animeSamaService$|utils\/animeMatcher$|AdFreePlayerAds$|AdWaitingScreen$/;

const observations = [];
let runError = null;
let browser = null;

const expected = {
  movie: { route: '/watch/movie/42', embedPath: '/embed/movie/42' },
  tv: { route: '/watch/tv/84/s/2/e/3', embedPath: '/embed/tv/84/2/3' },
  anime: { route: '/watch/tv/99999/s/1/e/1', embedPath: '/embed/tv/99999/1/1' },
  embedParams: { brand: 'Movix', download: '1', hide: 'server,settings' },
  forbiddenNetwork: ['/anime/', 'anime-sama', 'animesama', '/watch/anime'],
};
const seededProgress = {
  key: 'tv:84', season: 2, episode: 3, position: 480, duration: 1200,
};
const forbiddenUi = /details\.(animeModeActiveBadge|backToStandardMode|animeModeLabel)|MODE ANIME ACTIF|Retour au mode standard|Mode anime/;

try {
await writeFile(path.join(work, 'entry.tsx'), entry);
await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2020',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MAIN_API: 'https://main-api.test',
      VITE_TMDB_API_KEY: 'fixture-key',
      VITE_SITE_URL: 'https://movix.test',
    }),
  },
  plugins: [{
    name: 'vidrift-unification-fixture',
    setup(builder) {
      builder.onResolve({ filter: stubPattern }, ({ path: name }) => {
        const normalized = String(name).replace(/\\/g, '/');
        const key = normalized === 'react-i18next' ? 'reactI18next'
          : normalized === 'axios' ? 'axios'
            : /components\/ui\/dialog$/.test(normalized) ? 'dialog'
              : /components\/AntiSpoilerSettings$/.test(normalized) ? 'AntiSpoilerSettingsModal'
                : /(?:^|\/)i18n$/.test(normalized) ? 'i18n'
                  : Object.keys(stubSources)
                    .sort((left, right) => right.length - left.length)
                    .find(candidate => normalized === candidate || normalized.endsWith(candidate));
        return { path: key, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({
        contents: stubSources[key],
        loader: 'tsx',
        resolveDir: repo,
      }));
    },
  }],
});
const bundleSource = await readFile(path.join(work, 'app.js'), 'utf8');
assert.doesNotMatch(bundleSource, /animeSamaService|animeMatcher|WatchAnime|\/watch\/anime/,
  'bundle: aucun module ni lecteur Anime-Sama');
await execFileAsync(process.execPath, [
  require.resolve('tailwindcss/lib/cli/index.js'),
  '--config', path.join(repo, 'tailwind.config.js'),
  '--input', path.join(repo, 'src/index.css'),
  '--output', path.join(work, 'app.css'),
]);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-black"><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const svg = (width, height, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
let iframeMode = 'none';
let episodeTarget = { season: 2, episode: 3 };

function embedHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
  (function () {
    var parts = location.pathname.split('/').filter(Boolean);
    var kind = parts[1] === 'movie' ? 'movie' : 'tv';
    var tmdbId = Number(parts[2]);
    var season = kind === 'tv' ? Number(parts[3] || 1) : 1;
    var episode = kind === 'tv' ? Number(parts[4] || 1) : 1;
    var post = function (message) { window.parent.postMessage(message, '*'); };
    post({ type: 'vidrift:fixture-load', url: location.href });
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      if (event.data && typeof event.data === 'object') {
        post({ type: 'vidrift:fixture-inbound', message: event.data });
      }
    });
    setTimeout(function () {
      post({ type: 'vidrift:state', tmdbId: tmdbId, mediaType: kind,
        currentTime: 0, duration: 1200, season: season, episode: episode });
    }, 120);
    if (${JSON.stringify(iframeMode)} === 'episode' && kind === 'tv') {
      setTimeout(function () {
        post({ type: 'vidrift:episode', tmdbId: tmdbId, mediaType: 'tv',
          season: ${episodeTarget.season}, episode: ${episodeTarget.episode} });
      }, 350);
    }
  })();
  </script></body></html>`;
}

async function routeFixture(route) {
  const url = new URL(route.request().url());
  if (url.hostname === 'vidrift.test') {
    // Route SPA : toute URL sans extension sert index.html, comme le serveur
    // de développement ; seuls les fichiers générés ont une extension.
    const name = path.extname(url.pathname) ? url.pathname.slice(1) : 'index.html';
    const servedFile = await readFile(path.join(work, name))
      .catch(() => readFile(path.join(repo, 'public', name)))
      .catch(() => Buffer.alloc(0));
    const extension = path.extname(name);
    await route.fulfill({
      status: servedFile.length ? 200 : 404,
      contentType: extension === '.js' ? 'text/javascript'
        : extension === '.css' ? 'text/css'
          : extension === '.png' ? 'image/png'
            : extension === '.svg' ? 'image/svg+xml'
              : 'text/html',
      body: servedFile,
    });
    return;
  }
  if (url.hostname === 'embed.vidrift.net') {
    await route.fulfill({ contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: embedHtml() });
    return;
  }
  if (url.hostname === 'image.tmdb.org') {
    const isPoster = /poster|profile/.test(url.pathname);
    await route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: svg(isPoster ? 500 : 1280, isPoster ? 750 : 720, isPoster ? '#a0522d' : '#315d7d'),
    });
    return;
  }
  await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
}

function analyzeEmbed(src) {
  const url = new URL(src);
  return {
    origin: url.origin,
    pathname: url.pathname,
    brand: url.searchParams.get('brand'),
    brandColor: url.searchParams.get('brandColor'),
    download: url.searchParams.get('download'),
    hide: url.searchParams.get('hide'),
  };
}

async function observePage(page) {
  return page.evaluate(() => ({
    requests: window.__fixtureRequests || [],
    inbound: window.__vidriftInbound || [],
    loads: window.__vidriftLoads || [],
    seeded: (() => {
      try {
        return JSON.parse(localStorage.getItem('progress_tv_84_s2_e3') || 'null');
      } catch {
        return null;
      }
    })(),
  }));
}

function assertNoAnimeNetwork(urls, label) {
  const offenders = urls.filter(url => expected.forbiddenNetwork.some(forbidden => String(url).includes(forbidden)));
  assert.deepEqual(offenders, [], `${label}: aucune URL Anime-Sama / mode anime (${offenders.join(' | ')})`);
}

browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});

  const registrySource = await readFile(path.join(repo, 'src/routing/registry.tsx'), 'utf8');
  assert.doesNotMatch(registrySource, /\/watch\/anime/, 'registre: aucune route /watch/anime');

  // Scénario 1 — film : carte/fiche → lecteur film.
  {
    iframeMode = 'none';
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://vidrift.test/movie/42');
    await page.locator('.detail-hero__actions button').first().waitFor();
    const heroText = await page.locator('.detail-hero').innerText();
    assert.ok(heroText.includes('VidRift Movie Fixture'), 'film: fiche TMDB chargée');
    // Le bouton est un composant local remonté à chaque rendu : on déclenche
    // l'événement React sans attendre la stabilité géométrique du nœud.
    await page.locator('.detail-hero__actions button').first().dispatchEvent('click');
    await page.locator('iframe').waitFor();
    await page.waitForFunction(() => (window.__vidriftInbound || []).some(message => message && message.type === 'vidrift:state'));
    const observed = await observePage(page);
    const embed = analyzeEmbed(await page.locator('iframe').getAttribute('src'));
    const pathname = new URL(page.url()).pathname;

    assert.equal(pathname, expected.movie.route, 'film: URL du lecteur');
    assert.equal(embed.origin, 'https://embed.vidrift.net', 'film: origine VidRift');
    assert.equal(embed.pathname, expected.movie.embedPath, 'film: chemin de l’embed');
    assert.equal(embed.brand, expected.embedParams.brand, 'film: marque Movix');
    assert.equal(embed.download, expected.embedParams.download, 'film: panneau téléchargement conservé');
    assert.equal(embed.hide, expected.embedParams.hide, 'film: menus serveur/réglages masqués');
    assert.equal(embed.brandColor, 'DC2626', 'film: couleur de marque');
    assert.equal(await page.locator('[data-testid="not-found"]').count(), 0, 'film: aucune route de compatibilité anime');
    assert.equal(observed.loads.length, 1, 'film: une seule iframe montée');
    assert.deepEqual(errors, [], 'film: aucune erreur JavaScript');
    assertNoAnimeNetwork([...requests, ...observed.requests], 'film');

    const screenshot = path.join(artifactDir, 'movie-vidrift.png');
    await page.screenshot({ path: screenshot });
    observations.push({
      scenario: 'movie',
      expected: { ...expected.movie, embedParams: expected.embedParams, iframeLoads: 1 },
      observed: { pathname, embed, iframeLoads: observed.loads.length, errors, networkUrls: requests.length + observed.requests.length },
      screenshot: path.basename(screenshot),
      status: 'PASS',
    });
    await context.close();
  }

  // Scénario 2 — série : reprise serveur → /watch/tv, messages VidRift locaux.
  {
    iframeMode = 'episode';
    episodeTarget = { season: 3, episode: 2 };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ seed }) => {
      window.__progressionSeed = seed;
      // Position locale pour le lecteur, mais sans horodatage : la fiche ne
      // la considère pas comme une reprise locale et utilise l'historique
      // serveur, qui recopie alors progress_tv_84_s2_e3.
      localStorage.setItem('continueWatching', JSON.stringify({
        movies: [],
        tv: [{
          id: 84,
          currentEpisode: { season: 2, episode: 3, progress: seed.position, duration: seed.duration, completed: false },
        }],
      }));
    }, { seed: seededProgress });
    await page.goto('http://vidrift.test/tv/84');
    const heroButton = page.locator('.detail-hero__actions button').first();
    await heroButton.waitFor();
    const heroText = await heroButton.innerText();
    assert.ok(heroText.includes('details.resumeEpisode') || heroText.includes('details.continueEpisode'), `série: bouton Continuer présent (${heroText})`);
    await heroButton.dispatchEvent('click');
    await page.locator('iframe').waitFor();
    await page.waitForFunction(() => (window.__vidriftInbound || []).some(message => message && message.type === 'vidrift:resume'));
    await page.waitForFunction(() => new URL(window.location.href).pathname === '/watch/tv/84/s/3/e/2');
    const beforeEpisodeMessage = await page.evaluate(() => (window.__vidriftLoads || []).length);
    const observed = await observePage(page);
    const embed = analyzeEmbed(await page.locator('iframe').getAttribute('src'));
    const pathname = new URL(page.url()).pathname;
    const resumeMessage = observed.inbound.find(message => message && message.type === 'vidrift:resume');

    assert.equal(new URL(page.url()).searchParams.get('fixtureEmit'), null, 'série: URL sans paramètre de test');
    assert.equal(pathname, '/watch/tv/84/s/3/e/2', 'série: message vidrift:episode mirroir l’URL navigateur');
    assert.equal(embed.origin, 'https://embed.vidrift.net', 'série: origine VidRift');
    assert.equal(embed.pathname, expected.tv.embedPath, 'série: chemin de l’embed avant message');
    assert.equal(embed.brand, expected.embedParams.brand, 'série: marque Movix');
    assert.equal(embed.download, expected.embedParams.download, 'série: panneau téléchargement conservé');
    assert.equal(embed.hide, expected.embedParams.hide, 'série: menus serveur/réglages masqués');
    assert.deepEqual(resumeMessage, { type: 'vidrift:resume', currentTime: 480 }, 'série: reprise exacte depuis la fiche');
    assert.ok(observed.seeded && observed.seeded.position === 480, 'série: progression serveur recopiée avant lecture');
    assert.equal(observed.loads.length, beforeEpisodeMessage, 'série: aucun remontage iframe après vidrift:episode');
    assert.equal(observed.loads.length, 1, 'série: une seule iframe montée');
    assert.deepEqual(errors, [], 'série: aucune erreur JavaScript');
    assertNoAnimeNetwork([...requests, ...observed.requests], 'série');

    const screenshot = path.join(artifactDir, 'tv-continue-vidrift.png');
    await page.screenshot({ path: screenshot });
    observations.push({
      scenario: 'tv-continue',
      expected: {
        ...expected.tv,
        embedParams: expected.embedParams,
        urlAfterEpisodeMessage: '/watch/tv/84/s/3/e/2',
        resume: { type: 'vidrift:resume', currentTime: 480 },
        iframeLoads: 1,
      },
      observed: {
        pathname,
        embed,
        resumeMessage,
        seeded: observed.seeded,
        iframeLoads: observed.loads.length,
        errors,
        networkUrls: requests.length + observed.requests.length,
      },
      screenshot: path.basename(screenshot),
      status: 'PASS',
    });
    await context.close();
  }

  // Scénario 3 — animé TMDB : aucun mode anime, même lecteur TV.
  {
    iframeMode = 'none';
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://vidrift.test/tv/99999');
    await page.locator('.detail-hero__actions button').first().waitFor();
    const heroText = await page.locator('.detail-hero').innerText();
    assert.ok(heroText.includes('VidRift Anime Fixture'), 'animé: fiche TMDB chargée');
    assert.equal(forbiddenUi.test(heroText), false, 'animé: aucun badge ni bouton de mode anime');
    assert.equal(await page.locator('.anime-season-card').count(), 0, 'animé: aucune grille Anime-Sama');
    // Le bouton est un composant local remonté à chaque rendu : on déclenche
    // l'événement React sans attendre la stabilité géométrique du nœud.
    await page.locator('.detail-hero__actions button').first().dispatchEvent('click');
    await page.locator('iframe').waitFor();
    await page.waitForFunction(() => (window.__vidriftInbound || []).some(message => message && message.type === 'vidrift:state'));
    const observed = await observePage(page);
    const embed = analyzeEmbed(await page.locator('iframe').getAttribute('src'));
    const pathname = new URL(page.url()).pathname;

    assert.equal(pathname, expected.anime.route, 'animé: lecteur TV unifié');
    assert.equal(embed.origin, 'https://embed.vidrift.net', 'animé: origine VidRift');
    assert.equal(embed.pathname, expected.anime.embedPath, 'animé: chemin de l’embed TV/TMDB');
    assert.equal(embed.brand, expected.embedParams.brand, 'animé: marque Movix');
    assert.equal(embed.download, expected.embedParams.download, 'animé: panneau téléchargement conservé');
    assert.equal(embed.hide, expected.embedParams.hide, 'animé: menus serveur/réglages masqués');
    assert.equal(observed.loads.length, 1, 'animé: une seule iframe montée');
    assert.deepEqual(errors, [], 'animé: aucune erreur JavaScript');
    assertNoAnimeNetwork([...requests, ...observed.requests], 'animé');

    const screenshot = path.join(artifactDir, 'anime-vidrift.png');
    await page.screenshot({ path: screenshot });
    observations.push({
      scenario: 'anime',
      expected: { ...expected.anime, embedParams: expected.embedParams, iframeLoads: 1, staleAnimeUi: 0 },
      observed: {
        pathname,
        embed,
        staleAnimeUi: (await page.locator('.anime-season-card').count()) + (forbiddenUi.test(await page.locator('.detail-hero').innerText().catch(() => '')) ? 1 : 0),
        iframeLoads: observed.loads.length,
        errors,
        networkUrls: requests.length + observed.requests.length,
      },
      screenshot: path.basename(screenshot),
      status: 'PASS',
    });
    await context.close();
  }
} catch (error) {
  runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  if (browser) await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  runError,
  command: 'node tests/vidriftUnification.browser.mjs',
  prerequisites: {
    dependencies: 'playwright (CODEX_PRIMARY_RUNTIME_NODE_MODULES), esbuild et tailwindcss dans node_modules',
    browser: 'Chromium Playwright (CHROMIUM_EXECUTABLE_PATH et CHROMIUM_ARGS optionnels)',
    server: 'aucun — bundle esbuild et iframe VidRift servis par routage Playwright',
  },
  fixtureData: {
    movie: { id: movie.id, title: movie.title },
    tv: { id: tv.id, title: tv.name, seededProgress },
    anime: { id: anime.id, title: anime.name, source: 'TMDB' },
  },
  scope: 'Vérifie l’iframe, la navigation et les messages locaux ; aucun flux vidéo externe n’est lu.',
  dataPolicy: 'Aucun secret, aucun compte ni appel réel : données de fixture et API simulées.',
  expected,
  observations,
};
await writeFile(path.join(artifactDir, 'vidrift-unification-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.status} — ${artifactDir}`);
if (runError) {
  console.error(runError);
  process.exitCode = 1;
}
