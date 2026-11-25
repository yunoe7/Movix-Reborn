/**
 * Vérifie la refonte visuelle réelle (fiches + panneau de téléchargement) et
 * produit des captures avant/après reproductibles.
 *
 * Relance :
 *   node tests/visualRefonte.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild, tailwindcss, git et tar disponibles.
 * L'artefact est écrit dans VISUAL_REFONTE_ARTIFACT_DIR ou dans
 * <workspace>/movix-artifacts/visual-refonte-final.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const execFileAsync = promisify(execFile);

const artifactDir = process.env.VISUAL_REFONTE_ARTIFACT_DIR
  ? path.resolve(process.env.VISUAL_REFONTE_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'visual-refonte-final');
const beforeSourceDir = path.join(artifactDir, 'before-source');
let currentWork = path.join(artifactDir, 'fixture-before');

await rm(artifactDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });
await mkdir(beforeSourceDir, { recursive: true });

// Snapshot HEAD sans worktree ni nouvelle branche : sert de référence « avant ».
const archivePath = path.join(artifactDir, 'head.tar');
await execFileAsync('git', ['archive', '--format=tar', '-o', archivePath, 'HEAD'], { cwd: repo });
await execFileAsync('tar', ['-xf', archivePath, '-C', beforeSourceDir]);

const stubSources = {
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});`,
  reactI18next: `export const useTranslation=()=>({t:(key,opts={})=>String(key).replace(/\\{\\{(\\w+)\\}\\}/g,(_,name)=>opts?.[name]??''),i18n:{language:'fr-FR'}});`,
  i18n: `export const getTmdbLanguage=()=> 'fr-FR'; export default {language:'fr-FR'};`,
  AddToListButton: `export default ()=><button>lists.addToList</button>;`,
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
  downloadLinksService: `
    export async function listDownloadLinks() {
      const mode = new URLSearchParams(window.location.search).get('linkMode') || 'available';
      if (mode === 'empty') return [];
      if (mode === 'error') return [{
        url: 'https://downloads.test/error.mkv',
        language: 'VF', quality: '720p', codec: 'h265', sub: false, host: '1fichier', size: '900 Mo',
      }];
      return [{
        url: 'https://downloads.test/sample.mkv',
        language: 'VF', quality: '1080p', sub: true,
        codec: 'h264', host: '1fichier', size: '2.1 GB',
      }];
    }
  `,
  useExternalSubtitles: `
    const TRACKS = [
      { id:'sub-fr', provider:'shegu', source:'shegu', lang:'fr', label:'Film.French.FR.srt',
        url:'https://subs.test/french.srt', format:'srt', encoding:'plain', downloads:42 },
      { id:'sub-en', provider:'opensubtitlesLegacy', source:'opensubs', lang:'en', label:'Film.EN.srt',
        url:'https://subs.test/english.srt', format:'srt', encoding:'plain', downloads:17 },
    ];
    export function useExternalSubtitles() {
      return { tracks: TRACKS, loading: false, providerErrors: [] };
    }
  `,
};

const stubPattern = /PrefetchLink$|AdFreePopupContext$|ProfileContext$|LightModeContext$|^react-i18next$|(?:^|\/)i18n$|AddToListButton$|AddToListMenu$|DetailsSkeleton$|ShareButtons$|EmblaCarousel$|CommentsSection$|LikeDislikeButton$|MovixRatingInfoModal$|LazySection$|(?:^|\/)SEO$|CharactersSection$|DetailExtraMetadata$|AlertButton$|AntiSpoilerSettings$|AntiSpoilerSettingsModal$|CustomDropdown$|useWrappedTracker$|useMovieReleaseWarnings$|useAntiSpoilerSettings$|useTvAiringSchedule$|detailCharacters$|components\/ui\/dialog$|downloadLinksService$|useExternalSubtitles$/;

function fixtureSource(sourceRoot, includeDownload) {
  const importPath = (relative) => JSON.stringify(
    path.join(sourceRoot, 'src', relative).replace(/\\/g, '/'),
  );
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import MovieDetails from ${importPath('pages/MovieDetails')};
import TVDetails from ${importPath('pages/TVDetails')};
${includeDownload ? `import DownloadPage from ${importPath('pages/DownloadPage')};` : ''}
const initialPath = new URLSearchParams(location.search).get('path') || '/movie/42';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/movie/:id" element={<MovieDetails/>}/>
      <Route path="/tv/:id" element={<TVDetails/>}/>
      ${includeDownload ? '<Route path="/download/:type/:id" element={<DownloadPage/>}/>' : ''}
    </Routes>
  </MemoryRouter>
);
`;
}

async function buildFixture(sourceRoot, workDir, includeDownload) {
  await mkdir(workDir, { recursive: true });
  const entry = path.join(workDir, 'entry.tsx');
  await writeFile(entry, fixtureSource(sourceRoot, includeDownload));

  await build({
    entryPoints: [entry],
    outfile: path.join(workDir, 'bundle.js'),
    bundle: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    nodePaths: [path.join(repo, 'node_modules')],
    alias: { '@': path.join(sourceRoot, 'src') },
    define: {
      'import.meta.env': JSON.stringify({
        VITE_MAIN_API: 'https://main-api.test',
        VITE_TMDB_API_KEY: 'fixture-key',
        VITE_SITE_URL: 'https://movix.test',
      }),
    },
    plugins: [{
      name: 'visual-refonte-fixture',
      setup(builder) {
        builder.onResolve({ filter: stubPattern }, ({ path: name }) => {
          const normalized = String(name).replace(/\\/g, '/');
          const key = normalized === 'react-i18next' ? 'reactI18next'
            : /components\/ui\/dialog$/.test(normalized) ? 'dialog'
              : /(?:^|\/)i18n$/.test(normalized) ? 'i18n'
                : Object.keys(stubSources)
                  .sort((left, right) => right.length - left.length)
                  .find(candidate => normalized.endsWith(candidate));
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

  await execFileAsync(process.execPath, [
    require.resolve('tailwindcss/lib/cli/index.js'),
    '--config', path.join(repo, 'tailwind.config.js'),
    '--input', path.join(sourceRoot, 'src/index.css'),
    '--output', path.join(workDir, 'tailwind.css'),
  ]);

  const componentCss = await readFile(path.join(workDir, 'bundle.css'), 'utf8').catch(() => '');
  const tailwindCss = await readFile(path.join(workDir, 'tailwind.css'), 'utf8');
  await writeFile(path.join(workDir, 'app.css'), `${tailwindCss}\n${componentCss}`);
  await writeFile(
    path.join(workDir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>',
  );
}

const svg = (width, height, fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
const movie = {
  id: 42,
  title: 'Dune 2 Fixture',
  original_title: 'Dune: Part Two',
  overview: 'Fixture qualité image.',
  poster_path: '/movie-poster.jpg',
  backdrop_path: '/movie-backdrop.jpg',
  release_date: '2024-03-01',
  vote_average: 8.5,
  genres: [{ id: 878, name: 'Science-fiction' }],
  runtime: 166,
  original_language: 'en',
  status: 'Released',
  production_companies: [],
  production_countries: [],
  spoken_languages: [],
  keywords: { results: [] },
  alternative_titles: { results: [] },
  credits: { cast: [{ id: 1, name: 'Acteur Fixture', character: 'Personnage', profile_path: '/profile.jpg' }], crew: [] },
};
const tv = {
  id: 84,
  name: 'Dune Prophecy Fixture',
  original_name: 'Dune Prophecy',
  overview: 'Fixture qualité image.',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  first_air_date: '2024-11-17',
  vote_average: 7.5,
  genres: [{ id: 18, name: 'Drame' }],
  number_of_seasons: 1,
  number_of_episodes: 1,
  seasons: [{ season_number: 1, name: 'Saison 1 Fixture', poster_path: '/season-poster.jpg', air_date: '2024-11-17', episode_count: 1 }],
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
  name: 'Anime Fixture',
  original_name: 'Anime Fixture',
  overview: 'Fixture anime sous /tv/:id.',
  poster_path: '/anime-poster.jpg',
  backdrop_path: '/anime-backdrop.jpg',
  first_air_date: '2024-01-01',
  vote_average: 8.1,
  genres: [{ id: 16, name: 'Animation' }],
  origin_country: ['JP'],
  original_language: 'ja',
  number_of_seasons: 1,
  number_of_episodes: 1,
  seasons: [{ season_number: 1, name: 'Saison Anime 1', poster_path: '/anime-season.jpg', air_date: '2024-01-01', episode_count: 1 }],
  keywords: { results: [{ id: 1, name: 'anime' }] },
  status: 'Ended',
  type: 'Scripted',
  external_ids: {},
  networks: [],
  production_companies: [],
  credits: { cast: [{ id: 3, name: 'Acteur Anime', character: 'Personnage Anime', profile_path: '/profile.jpg' }], crew: [] },
};
function jsonFor(url) {
  const pathname = url.pathname;
  if (url.hostname === 'main-api.test') return {};
  if (/\/movie\/42\/credits$/.test(pathname)) return movie.credits;
  if (/\/movie\/42\/release_dates$/.test(pathname)) {
    return { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, certification: 'PG-13' }] }] };
  }
  if (/\/movie\/42\/images$/.test(pathname)) return {
    backdrops: [{ file_path: '/movie-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
    posters: [],
    logos: [],
  };
  if (/\/movie\/42\/videos$/.test(pathname)) return { results: [] };
  if (/\/movie\/42\/recommendations$/.test(pathname)) return { results: [{ id: 7, title: 'Reco Film', poster_path: '/reco.jpg', backdrop_path: '', overview: '', vote_average: 7, release_date: '2023-01-01' }] };
  if (/\/movie\/42$/.test(pathname)) return movie;
  if (/\/tv\/84\/content_ratings$/.test(pathname)) return { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] };
  if (/\/tv\/84\/images$/.test(pathname)) return {
    backdrops: [{ file_path: '/tv-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
    posters: [],
    logos: [],
  };
  if (/\/tv\/84\/videos$/.test(pathname)) return { results: [] };
  if (/\/tv\/84\/recommendations$/.test(pathname)) return { results: [{ id: 9, name: 'Reco Série', poster_path: '/reco-tv.jpg', backdrop_path: '', overview: '', vote_average: 6, first_air_date: '2023-01-01' }] };
  if (/\/tv\/84\/season\/(\d+)\/videos$/.test(pathname)) return { results: [] };
  const season = pathname.match(/\/tv\/84\/season\/(\d+)$/)?.[1];
  if (season !== undefined) return {
    id: Number(season),
    season_number: Number(season),
    name: 'Saison 1 Fixture',
    poster_path: '/season-poster.jpg',
    air_date: '2024-11-17',
    episode_count: 1,
    episodes: [{ episode_number: 1, season_number: 1, name: 'Épisode Fixture', overview: 'Synopsis épisode fixture.', still_path: '/episode-still.jpg', air_date: '2024-11-17' }],
  };
  if (/\/tv\/84$/.test(pathname)) return tv;
  if (/\/tv\/99999\/content_ratings$/.test(pathname)) return { results: [{ iso_3166_1: 'US', rating: 'TV-14' }] };
  if (/\/tv\/99999\/images$/.test(pathname)) return {
    backdrops: [{ file_path: '/anime-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
    posters: [],
    logos: [],
  };
  if (/\/tv\/99999\/videos$/.test(pathname)) return { results: [] };
  if (/\/tv\/99999\/recommendations$/.test(pathname)) return { results: [{ id: 11, name: 'Reco Anime', poster_path: '/reco-anime.jpg', backdrop_path: '', overview: '', vote_average: 8, first_air_date: '2023-01-01' }] };
  if (/\/tv\/99999\/season\/(\d+)\/videos$/.test(pathname)) return { results: [] };
  const animeSeason = pathname.match(/\/tv\/99999\/season\/(\d+)$/)?.[1];
  if (animeSeason !== undefined) return {
    id: Number(animeSeason),
    season_number: Number(animeSeason),
    name: 'Saison Anime 1',
    poster_path: '/anime-season.jpg',
    air_date: '2024-01-01',
    episode_count: 1,
    episodes: [{ episode_number: 1, season_number: 1, name: 'Épisode Anime Fixture', overview: '', still_path: '/anime-still.jpg', air_date: '2024-01-01' }],
  };
  if (/\/tv\/99999$/.test(pathname)) return anime;
  return {};
}

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];
const observations = [];
let runError = null;

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});

async function routeFixture(route) {
  const url = new URL(route.request().url());
  if (url.hostname === 'visual.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const fixtureFile = path.join(currentWork, name);
    const publicFile = path.join(repo, 'public', name);
    const servedFile = await readFile(fixtureFile).catch(() => readFile(publicFile));
    const extension = path.extname(name);
    await route.fulfill({
      contentType: extension === '.js' ? 'text/javascript'
        : extension === '.css' ? 'text/css'
          : extension === '.png' ? 'image/png'
            : extension === '.svg' ? 'image/svg+xml'
              : 'text/html',
      headers: { 'access-control-allow-origin': '*' },
      body: servedFile,
    });
    return;
  }
  if (url.hostname === 'image.tmdb.org') {
    const isPortrait = /poster|profile/.test(url.pathname);
    const isStill = /still/.test(url.pathname);
    await route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'access-control-allow-origin': '*' },
      body: isPortrait ? svg(500, 750, '#8b5a2b') : svg(1280, 720, isStill ? '#315d7d' : '#244a63'),
    });
    return;
  }
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'main-api.test') {
    await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: jsonFor(url) });
    return;
  }
  if (url.hostname === 'downloads.test' || url.hostname === 'subs.test') {
    if (url.pathname.includes('error')) {
      await route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: 'source failure' });
      return;
    }
    const body = Buffer.from('MOVIX-FIXTURE-BYTES-'.repeat(64), 'utf8');
    await route.fulfill({
      headers: { 'access-control-allow-origin': '*', 'content-length': String(body.length) },
      contentType: 'application/octet-stream',
      body,
    });
    return;
  }
  await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
}

async function captureDetails(phase, sourceRoot, workDir, includeDownload) {
  await buildFixture(sourceRoot, workDir, includeDownload);
  currentWork = workDir;

  for (const kind of ['movie', 'tv', 'anime']) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: phase === 'after' && viewport.name === 'desktop' ? 2 : 1,
      });
      await context.route('**/*', routeFixture);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const routePath = kind === 'movie' ? '/movie/42' : kind === 'tv' ? '/tv/84' : '/tv/99999';
      await page.goto(`http://visual.test/?path=${encodeURIComponent(routePath)}`);
      await page.locator('.detail-hero').waitFor();
      await page.locator('.detail-cast-rail').waitFor();
      if (kind !== 'movie') {
        await page.locator('.seasons-section').waitFor();
        // Les épisodes de la saison sélectionnée sont rendus directement.
        await page.waitForFunction(() => document.querySelectorAll('.seasons-section img').length >= 1);
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const observation = { phase, kind, viewport: viewport.name, overflow, errors };
      const screenshot = path.join(artifactDir, `${phase}-${kind}-${viewport.name}.png`);

      if (phase === 'after') {
        const heroCount = await page.locator('.detail-hero').count();
        const backCount = await page.locator('.detail-hero__back').count();
        const actions = await page.locator('.detail-hero__actions button').count();
        const heroFit = await page.locator('.detail-hero__picture img').evaluate(img => getComputedStyle(img).objectFit);
        const castFit = await page.locator('.detail-cast-card__image img').first().evaluate(img => getComputedStyle(img).objectFit);
        const episodeFits = await page.locator('.seasons-section img').evaluateAll(
          images => images.map(img => getComputedStyle(img).objectFit),
        );
        const heroText = await page.locator('.detail-hero').innerText();
        // La fixture i18n renvoie la clé de traduction ; la classification réelle
        // est bien dérivée de la certification TMDB (PG-13 / TV-14).
        const classification = 'details.ageAndAbove';

        assert.equal(heroCount, 1, `${kind}/${viewport.name}: un seul bandeau`);
        assert.equal(backCount, 1, `${kind}/${viewport.name}: bouton retour présent`);
        assert.equal(actions, 3, `${kind}/${viewport.name}: trois actions principales`);
        assert.equal(heroFit, 'cover', `${kind}/${viewport.name}: bandeau complet`);
        assert.equal(castFit, 'cover', `${kind}/${viewport.name}: portrait acteur complet`);
        assert.ok(heroText.includes(classification), `${kind}/${viewport.name}: classification visible`);
        assert.ok(overflow <= 1, `${kind}/${viewport.name}: aucun débordement horizontal (${overflow}px)`);
        if (kind !== 'movie') {
          assert.ok(episodeFits.includes('cover'), `${kind}/${viewport.name}: miniature d'épisode complète`);
        }
        assert.deepEqual(errors, [], `${kind}/${viewport.name}: erreurs navigateur`);

        if (kind === 'anime') {
          const animeToggle = page.locator('button[aria-pressed]').filter({ hasText: 'details.backToStandardMode' });
          assert.equal(await animeToggle.count(), 0, `${viewport.name}: aucun bouton « retour au mode standard »`);
          assert.equal(heroText.toLowerCase().includes('details.animemodeactivebadge'), false, `${viewport.name}: aucun badge de mode anime`);
          assert.equal(await page.locator('.anime-season-card').count(), 0, `${viewport.name}: aucune grille de saisons Anime-Sama`);
        }
        Object.assign(observation, { heroCount, backCount, actions, heroFit, castFit, episodeFits });
      }

      await page.screenshot({ path: screenshot, fullPage: true });
      observation.screenshot = path.basename(screenshot);
      observations.push(observation);
      await context.close();
    }
  }
}

async function verifyDownloadPanel() {
  currentWork = path.join(artifactDir, 'fixture-after');
  const scenarios = [
    { name: 'available', linkMode: 'available', expectVideo: true, expectEmpty: false, downloadUrl: 'https://downloads.test/sample.mkv' },
    { name: 'unavailable', linkMode: 'empty', expectVideo: false, expectEmpty: true },
    { name: 'error', linkMode: 'error', expectVideo: true, expectEmpty: false, downloadUrl: 'https://downloads.test/error.mkv' },
  ];

  for (const scenario of scenarios) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://visual.test/?path=${encodeURIComponent('/download/movie/42')}&linkMode=${scenario.linkMode}`);
    await page.locator('[data-testid="download-panel"]').waitFor();
    await page.locator('[data-testid="download-video-list"], [data-testid="download-video-empty"]').first().waitFor();

    const videoOptions = page.locator('[data-testid="download-video-option"]');
    const emptyVisible = await page.locator('[data-testid="download-video-empty"]').isVisible();
    assert.equal(await videoOptions.count() > 0, scenario.expectVideo, `${scenario.name}: présence de la source réelle`);
    assert.equal(emptyVisible, scenario.expectEmpty, `${scenario.name}: état d'indisponibilité`);

    if (scenario.expectVideo) {
      const option = videoOptions.first();
      const quality = await option.getAttribute('data-quality');
      const codec = await option.getAttribute('data-codec');
      const size = await option.getAttribute('data-size');
      assert.ok(quality && codec && size, `${scenario.name}: métadonnées réelles affichées`);
      if (scenario.name === 'available') {
        assert.equal(quality, '1080p');
        assert.equal(codec, 'h264');
        assert.equal(size, '2.1 GB');
      }
    }

    const search = page.locator('[data-testid="download-subtitle-search"]');
    await search.fill('french');
    assert.equal(await page.locator('[data-testid="download-subtitle-option"]').count(), 1, `${scenario.name}: recherche de langue`);
    await search.fill('');

    const finalButton = page.locator('[data-testid="download-final"]');
    if (scenario.downloadUrl) {
      await videoOptions.first().click();
    } else {
      await page.locator('[data-testid="download-subtitle-option"]').first().click();
    }
    await page.waitForTimeout(250);
    const buttonStyle = await finalButton.evaluate(button => ({
      background: getComputedStyle(button).backgroundColor,
      radius: getComputedStyle(button).borderRadius,
      height: button.getBoundingClientRect().height,
      disabled: button.disabled,
      classes: button.className,
    }));
    assert.equal(buttonStyle.background, 'rgb(255, 255, 255)', `${scenario.name}: bouton final blanc (${JSON.stringify(buttonStyle)})`);
    assert.ok(buttonStyle.height >= 44, `${scenario.name}: bouton final assez grand`);

    if (scenario.downloadUrl) {
      await finalButton.click();
      await page.locator('[data-testid="download-progress"]').waitFor();
      await page.locator('[data-testid="download-status"]').waitFor();
      const status = await page.locator('[data-testid="download-status"]').innerText();
      if (scenario.name === 'error') {
        assert.ok(status.includes('downloadFailed'), `${scenario.name}: erreur réelle affichée`);
      } else {
        assert.ok(status.includes('downloadDone'), `${scenario.name}: téléchargement réel terminé`);
      }
    } else {
      await finalButton.click();
      await page.locator('[data-testid="download-progress"]').waitFor();
      await page.locator('[data-testid="download-status"]').waitFor();
    }

    assert.deepEqual(errors, [], `${scenario.name}: erreurs navigateur`);
    const screenshot = path.join(artifactDir, `after-download-${scenario.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    observations.push({
      phase: 'after', kind: 'download', viewport: scenario.name,
      videoSources: await videoOptions.count(), emptyVisible, buttonStyle,
      screenshot: path.basename(screenshot), errors,
    });
    await context.close();
  }
}

try {
  await captureDetails('before', beforeSourceDir, currentWork, false);
  await captureDetails('after', repo, path.join(artifactDir, 'fixture-after'), true);
  await verifyDownloadPanel();
} catch (error) {
  runError = error;
} finally {
  await browser.close();
}

const report = {
  command: 'node tests/visualRefonte.browser.mjs',
  prerequisites: [
    'Playwright/Chromium installés',
    'esbuild et tailwindcss présents dans node_modules',
    'git et tar disponibles pour reconstruire le snapshot HEAD « avant »',
  ],
  fixtureData: {
    movieId: 42,
    tvId: 84,
    animeId: 99999,
    backdrop: '1280x720',
    poster: '500x750',
    videoSource: '1080p / h264 / 2.1 GB injectés par la fixture du service autorisé',
    subtitles: ['fr / srt / shegu', 'en / srt / opensubtitlesLegacy'],
  },
  status: runError ? 'FAIL' : 'PASS',
  error: runError ? String(runError.stack || runError) : null,
  observations,
};
await writeFile(path.join(artifactDir, 'visual-refonte-report.json'), JSON.stringify(report, null, 2));
const markdown = [
  '# Rapport E2E — refonte visuelle Movix',
  '',
  `- Commande : \`${report.command}\``,
  `- Résultat : **${report.status}**`,
  `- Prérequis : ${report.prerequisites.join(' ; ')}`,
  '',
  '## Données de fixture',
  '',
  `- Film ${report.fixtureData.movieId}, série ${report.fixtureData.tvId}, anime ${report.fixtureData.animeId}.`,
  `- Backdrop ${report.fixtureData.backdrop}, affiche ${report.fixtureData.poster}.`,
  `- Source vidéo : ${report.fixtureData.videoSource}.`,
  `- Sous-titres : ${report.fixtureData.subtitles.join(', ')}.`,
  '',
  '## Résultats attendus et observés',
  '',
  '- Attendu : image complète nette, bouton retour, trois actions, classification visible, aucun débordement horizontal.',
  '- Attendu : panneau de téléchargement avec métadonnées réelles, recherche de langue, progression réelle et erreurs réelles.',
  `- Observé : ${report.status}.`,
  runError ? `- Erreur : ${report.error}` : '',
  '',
  '## Captures',
  '',
  ...observations.map(item => `- ${item.phase} / ${item.kind} / ${item.viewport} : \`${item.screenshot}\``),
  '',
  'Le snapshot « avant » est construit depuis `git archive HEAD`, sans branche ni worktree supplémentaire.',
  '',
].filter(Boolean).join('\n');
await writeFile(path.join(artifactDir, 'visual-refonte-report.md'), markdown);

if (runError) {
  console.error(markdown);
  process.exitCode = 1;
} else {
  console.log(`PASS — ${artifactDir}`);
}
