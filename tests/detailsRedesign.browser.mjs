/**
 * Vérifie la refonte des fiches Films / Séries / Animés :
 * un seul bandeau, trois actions principales, distribution horizontale,
 * recommandations et commentaires, sans onglets ni second fond.
 *
 * Relance :
 *   node tests/detailsRedesign.browser.mjs
 * Prérequis : Playwright/Chromium et esbuild dans node_modules.
 * L'artefact (rapport + captures) est écrit dans DETAILS_REDESIGN_ARTIFACT_DIR
 * ou dans un dossier temporaire.
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
const { chromium } = require('playwright');
const execFileAsync = promisify(execFile);
const artifactDir = process.env.DETAILS_REDESIGN_ARTIFACT_DIR
  ? path.resolve(process.env.DETAILS_REDESIGN_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-details-redesign-artifacts-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import MovieDetails from ${JSON.stringify(repo + '/src/pages/MovieDetails')};
import TVDetails from ${JSON.stringify(repo + '/src/pages/TVDetails')};

const initialPath = new URLSearchParams(location.search).get('path') || '/movie/42';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[initialPath]}>
    <Routes>
      <Route path="/movie/:id" element={<MovieDetails/>}/>
      <Route path="/tv/:id" element={<TVDetails/>}/>
    </Routes>
  </MemoryRouter>
);
`;

const stubSources = {
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});`,
  reactI18next: `export const useTranslation=()=>({t:(key)=>key,i18n:{language:'fr-FR'}});`,
  i18n: `export const getTmdbLanguage=()=> 'fr-FR'; export default {language:'fr-FR'};`,
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
};

await writeFile(path.join(work, 'entry.tsx'), fixture);
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
    name: 'details-redesign-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /PrefetchLink$|AdFreePopupContext$|ProfileContext$|LightModeContext$|^react-i18next$|(?:^|\/)i18n$|DetailsSkeleton$|ShareButtons$|EmblaCarousel$|CommentsSection$|LikeDislikeButton$|MovixRatingInfoModal$|LazySection$|(?:^|\/)SEO$|CharactersSection$|DetailExtraMetadata$|AlertButton$|AntiSpoilerSettings$|AntiSpoilerSettingsModal$|CustomDropdown$|useWrappedTracker$|useMovieReleaseWarnings$|useAntiSpoilerSettings$|useTvAiringSchedule$|detailCharacters$|components\/ui\/dialog$/,
      }, ({ path: name }) => {
        const key = name === 'react-i18next' ? 'reactI18next'
          : /components\/ui\/dialog$/.test(name) ? 'dialog'
          : /(?:^|\/)i18n$/.test(name) ? 'i18n'
          : Object.keys(stubSources)
            .sort((left, right) => right.length - left.length)
            .find(candidate => name.endsWith(candidate));
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
  '--input', path.join(repo, 'src/index.css'),
  '--output', path.join(work, 'app.css'),
]);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

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
const animeCandidate = {
  name: anime.name,
  alternative_names: [],
  poster_path: anime.poster_path,
  seasons: [{
    number: 1,
    season_number: 1,
    name: 'Saison Anime 1',
    episodes: [{
      index: 1,
      episode_number: 1,
      name: 'Épisode Anime Fixture',
      still_path: '/anime-still.jpg',
      streaming_links: [{ language: 'vf', players: [] }],
    }],
  }],
};

function jsonFor(url) {
  const pathname = url.pathname;
  if (url.hostname === 'main-api.test') {
    if (/^\/anime\/tmdb\/tv\/99999$/.test(pathname)) return [animeCandidate];
    return {};
  }
  if (/\/movie\/42\/credits$/.test(pathname)) return movie.credits;
  if (/\/movie\/42\/release_dates$/.test(pathname)) return { results: [] };
  if (/\/movie\/42\/images$/.test(pathname)) return {
    backdrops: [{ file_path: '/movie-backdrop.jpg', width: 3840, height: 2160, aspect_ratio: 16 / 9, iso_639_1: null, vote_average: 8, vote_count: 1 }],
    posters: [],
    logos: [],
  };
  if (/\/movie\/42\/videos$/.test(pathname)) return { results: [] };
  if (/\/movie\/42\/recommendations$/.test(pathname)) return { results: [{ id: 7, title: 'Reco Film', poster_path: '/reco.jpg', backdrop_path: '', overview: '', vote_average: 7, release_date: '2023-01-01' }] };
  if (/\/movie\/42$/.test(pathname)) return movie;
  if (/\/tv\/84\/content_ratings$/.test(pathname)) return { results: [] };
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
    episodes: [{ episode_number: 1, season_number: 1, name: 'Épisode Fixture', overview: '', still_path: '/episode-still.jpg', air_date: '2024-11-17' }],
  };
  if (/\/tv\/84$/.test(pathname)) return tv;
  if (/\/tv\/99999\/content_ratings$/.test(pathname)) return { results: [] };
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

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});
const expected = {
  economy: { backdrop: '/w780/' },
  auto: { backdrop: '/w1280/' },
  high: { backdrop: '/original/' },
};
const observations = [];
let runError = null;

async function routeFixture(route) {
  const url = new URL(route.request().url());
  if (url.hostname === 'details.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const fixtureFile = path.join(work, name);
    const publicFile = path.join(repo, 'public', name);
    const servedFile = await readFile(fixtureFile).catch(() => readFile(publicFile));
    const extension = path.extname(name);
    await route.fulfill({
      contentType: extension === '.js' ? 'text/javascript'
        : extension === '.css' ? 'text/css'
          : extension === '.png' ? 'image/png'
            : extension === '.svg' ? 'image/svg+xml'
              : 'text/html',
      body: servedFile,
    });
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
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'main-api.test') {
    await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: jsonFor(url) });
    return;
  }
  await route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
}

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

try {
  for (const mode of ['economy', 'auto', 'high']) {
    for (const kind of ['movie', 'tv']) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: mode === 'high' ? 2 : 1,
      });
      await context.route('**/*', routeFixture);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(value => localStorage.setItem('settings_image_quality', value), mode);
      const routePath = kind === 'movie' ? '/movie/42' : '/tv/84';
      await page.goto(`http://details.test/?path=${encodeURIComponent(routePath)}`);
      await page.locator('.detail-hero').waitFor();

      const heroCount = await page.locator('.detail-hero').count();
      const fixedBackdrops = await page.locator('div.fixed.inset-0[aria-hidden="true"]').count();
      const ambientCount = await page.locator('.detail-hero__ambient').count();
      const heroObjectFit = await page.locator('.detail-hero__picture-img').evaluate(node => getComputedStyle(node).objectFit);
      const heroImageSrc = await page.locator('.detail-hero__picture img').getAttribute('src');
      const actionCount = await page.locator('.detail-hero__actions button').count();
      const tabCount = await page.getByRole('tab').count();
      const castCount = await page.locator('.detail-cast-rail .detail-cast-card').count();
      const firstCastCard = page.locator('.detail-cast-rail .detail-cast-card').first();
      const castCardDirection = castCount ? await firstCastCard.evaluate(node => getComputedStyle(node).flexDirection) : null;
      const castPortrait = firstCastCard.locator('.detail-cast-card__image');
      const castPortraitRatio = castCount ? await castPortrait.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return Number((rect.width / rect.height).toFixed(2));
      }) : null;
      const castImageFit = castCount ? await castPortrait.locator('img').evaluate(node => getComputedStyle(node).objectFit) : null;
      const castNameVisible = castCount ? await firstCastCard.locator('.detail-cast-card__name').isVisible() : false;
      const recommendations = await page.locator('[data-testid="recommendations"]').innerText();
      const commentsCount = await page.locator('[data-testid="comments"]').count();
      const heading = await page.locator('.detail-section__heading h2').allInnerTexts();

      assert.equal(heroCount, 1, `${kind}/${mode}: un seul bandeau`);
      assert.equal(fixedBackdrops, 0, `${kind}/${mode}: aucun fond fixe dupliqué`);
      assert.equal(ambientCount, 0, `${kind}/${mode}: aucun calque flouté ajouté`);
      assert.equal(heroObjectFit, 'cover', `${kind}/${mode}: le backdrop remplit le bandeau`);
      assert.ok(heroImageSrc?.includes(expected[mode].backdrop), `${kind}/${mode}: image nette complète ${heroImageSrc}`);
      assert.equal(actionCount, 3, `${kind}/${mode}: exactement trois actions principales`);
      assert.equal(tabCount, 0, `${kind}/${mode}: aucun onglet`);
      assert.ok(castCount >= 1, `${kind}/${mode}: distribution affichée`);
      assert.equal(castCardDirection, 'row', `${kind}/${mode}: portraits horizontaux avec métadonnées à côté`);
      assert.ok(castPortraitRatio >= 0.65 && castPortraitRatio <= 0.68, `${kind}/${mode}: portrait vertical de la fixture (${castPortraitRatio})`);
      assert.equal(castImageFit, 'cover', `${kind}/${mode}: portrait remplit son cadre sans déformation`);
      assert.equal(castNameVisible, true, `${kind}/${mode}: nom de l'acteur visible`);
      assert.ok(recommendations.includes(kind === 'movie' ? 'Reco Film' : 'Reco Série'), `${kind}/${mode}: recommandations réelles`);
      assert.equal(commentsCount, 1, `${kind}/${mode}: commentaires conservés`);
      assert.ok(heading.some(value => value.includes('details.youMightAlsoLike')), `${kind}/${mode}: titre recommandations`);
      assert.ok(heading.some(value => value.includes('details.castTab')), `${kind}/${mode}: titre distribution`);
      if (kind === 'tv') {
        assert.ok(await page.locator('.seasons-section').isVisible(), `${kind}/${mode}: section des épisodes visible`);
        const seasonPicker = page.locator('[data-testid="season-picker-trigger"]');
        await seasonPicker.waitFor();
        await seasonPicker.click();
        await page.locator('[data-testid="season-option-1"]').waitFor();
        assert.equal(await page.locator('.anime-season-card').count(), 0, `${kind}/${mode}: aucune grille de posters de saisons`);
        await page.locator('[data-testid="season-option-1"]').click();
        await page.locator('[data-testid="episode-download-1-1"]').waitFor();
      }
      
      const addToListTrigger = page.locator('[data-testid="add-to-list-trigger"]');
      await addToListTrigger.waitFor();
      await addToListTrigger.click();
      const addToListPopover = page.locator('[data-testid="add-to-list-popover"]');
      await addToListPopover.waitFor();
      assert.ok(await page.locator('[data-testid="add-to-list-empty"]').isVisible(), `${kind}/${mode}: état vide du menu de listes`);
      const popoverBox = await addToListPopover.boundingBox();
      assert.ok(popoverBox && popoverBox.width >= 230 && popoverBox.width <= 242, `${kind}/${mode}: menu compact d'environ 236px`);
      await page.locator('[data-testid="add-to-list-create-trigger"]').click();
      await page.locator('[data-testid="add-to-list-create-form"]').waitFor();
      const newListInput = page.locator('[data-testid="add-to-list-name"]');
      await newListInput.fill('E2E Watchlist');
      await page.locator('[data-testid="add-to-list-confirm"]').click();
      const savedList = await page.evaluate(() => JSON.parse(localStorage.getItem('custom_lists') || '[]').find(list => list.name === 'E2E Watchlist'));
      assert.ok(savedList, `${kind}/${mode}: création de liste enregistrée`);
      assert.ok(savedList.items?.some(item => item.type === (kind === 'movie' ? 'movie' : 'tv')), `${kind}/${mode}: contenu ajouté à la nouvelle liste`);
      await addToListPopover.waitFor({ state: 'hidden' });

      const screenshot = path.join(artifactDir, `${kind}-${mode}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      observations.push({
        kind, mode, heroCount, fixedBackdrops, ambientCount, heroObjectFit, heroImageSrc, actionCount,
        tabCount, castCount, castCardDirection, castPortraitRatio, castImageFit, castNameVisible,
        recommendations, commentsCount, screenshot: path.basename(screenshot),
        errors,
      });
      assert.deepEqual(errors, [], `${kind}/${mode}: erreurs navigateur`);
      await context.close();
    }
  }

  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://details.test/?path=%2Ftv%2F99999');
    await page.locator('.detail-hero').waitFor();
    const animeSeasonPicker = page.locator('[data-testid="season-picker-trigger"]');
    await animeSeasonPicker.waitFor();
    await animeSeasonPicker.click();
    await page.locator('[data-testid="season-option-1"]').waitFor();
    await page.locator('[data-testid="season-option-1"]').click();
    await page.locator('[data-testid="episode-download-1-1"]').waitFor();
    await page.locator('[data-testid="add-to-list-trigger"]').click();
    await page.locator('[data-testid="add-to-list-popover"]').waitFor();
    await page.locator('[data-testid="add-to-list-empty"]').waitFor();

    const heroCount = await page.locator('.detail-hero').count();
    const fixedBackdrops = await page.locator('div.fixed.inset-0[aria-hidden="true"]').count();
    const actionCount = await page.locator('.detail-hero__actions button').count();
    const tabCount = await page.getByRole('tab').count();
    const playIconWidth = await page.locator('.detail-hero__actions img[src="/icons/play-button-icon.png"]').evaluate(img => img.naturalWidth);
    const castCount = await page.locator('.detail-cast-rail .detail-cast-card').count();
    const recommendations = await page.locator('[data-testid="recommendations"]').innerText();
    const commentsCount = await page.locator('[data-testid="comments"]').count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    assert.equal(heroCount, 1, 'anime: un seul bandeau');
    assert.equal(fixedBackdrops, 0, 'anime: aucun fond fixe dupliqué');
    assert.equal(actionCount, 3, 'anime: exactement trois actions principales');
    assert.equal(tabCount, 0, 'anime: aucun onglet');
    assert.ok(playIconWidth > 0, 'anime: icône de lecture personnalisée chargée');
    assert.ok(castCount >= 1, 'anime: distribution affichée');
    assert.ok(recommendations.includes('Reco Anime'), 'anime: recommandations réelles');
    assert.equal(commentsCount, 1, 'anime: commentaires conservés');
    assert.ok(await page.locator('.seasons-section').isVisible(), 'anime: saisons et épisodes conservés');
    assert.ok(overflow <= 1, `anime: pas de débordement horizontal (${overflow}px)`);

    const screenshot = path.join(artifactDir, 'anime-mobile.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    observations.push({
      kind: 'anime', mode: 'mobile', heroCount, fixedBackdrops, actionCount, tabCount,
      playIconWidth, castCount, recommendations, commentsCount, overflow,
      screenshot: path.basename(screenshot), errors,
    });
    assert.deepEqual(errors, [], 'anime: erreurs navigateur');
    await context.close();
  }

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    await context.route('**/*', routeFixture);
    const page = await context.newPage();
    await page.goto('http://details.test/?path=%2Fmovie%2F42');
    await page.locator('.detail-hero').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${viewport.name}: pas de débordement horizontal (${overflow}px)`);
    const rail = page.locator('.detail-cast-rail');
    assert.ok(await rail.isVisible(), `${viewport.name}: distribution visible`);
    const screenshot = path.join(artifactDir, `movie-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    observations.push({ kind: 'movie', mode: viewport.name, overflow, screenshot: path.basename(screenshot) });
    await context.close();
  }
} catch (error) {
  runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  runError,
  command: 'node tests/detailsRedesign.browser.mjs',
  prerequisites: {
    dependencies: 'playwright, esbuild, tailwindcss depuis node_modules',
    browser: 'Chromium Playwright (CHROMIUM_EXECUTABLE_PATH optionnel)',
    server: 'aucun — fixture esbuild servie via routage Playwright',
  },
  fixtureData: {
    movie: { id: movie.id, title: movie.title, poster: movie.poster_path, backdrop: movie.backdrop_path },
    tv: { id: tv.id, title: tv.name, poster: tv.poster_path, backdrop: tv.backdrop_path },
    anime: { id: anime.id, title: anime.name, poster: anime.poster_path, backdrop: anime.backdrop_path },
  },
  expected: {
    heroCount: 1,
    fixedBackdrops: 0,
    actionCount: 3,
    tabCount: 0,
    backdropWidths: expected,
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
  },
  observations,
};
await writeFile(path.join(artifactDir, 'details-redesign-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.status} — ${artifactDir}`);
if (runError) {
  console.error(runError);
  process.exitCode = 1;
}
