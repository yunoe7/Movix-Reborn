/**
 * E2E ciblé : miniatures individuelles TMDB des épisodes en mode Anime.
 *
 * Le tableau TMDB est volontairement désordonné : une association par position
 * donnerait les mauvaises images. La correspondance doit se faire par ID TMDB,
 * numéro de saison et numéro d'épisode.
 *
 * Relance :
 *   $env:ANIME_THUMBNAIL_E2E_LABEL='before'   # puis 'after'
 *   $env:CODEX_PRIMARY_RUNTIME_NODE_MODULES='<runtime-node_modules>'
 *   $env:CHROMIUM_EXECUTABLE_PATH='<chrome.exe>'
 *   $env:ANIME_THUMBNAIL_E2E_ARTIFACT_DIR='reports/anime-thumbnails'
 *   node tests/animeEpisodeThumbnails.browser.mjs
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
const label = process.env.ANIME_THUMBNAIL_E2E_LABEL || 'run';
const artifactDir = process.env.ANIME_THUMBNAIL_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.ANIME_THUMBNAIL_E2E_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-anime-thumbnails-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const svgDataUrl = (name, fill) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${fill}"/><text x="320" y="190" fill="white" font-family="sans-serif" font-size="44" text-anchor="middle">${name}</text></svg>`,
  )}`;

const tmdbSeriesPoster = svgDataUrl('SERIES-POSTER', '#be123c');
const tmdbSeasonPoster = svgDataUrl('TMDB-SEASON-POSTER', '#7c3aed');
const tmdbSeasonPosters = {
  1: svgDataUrl('TMDB-SEASON-POSTER-1', '#7c3aed'),
  2: svgDataUrl('TMDB-SEASON-POSTER-2', '#2563eb'),
  3: svgDataUrl('TMDB-SEASON-POSTER-3', '#059669'),
  4: svgDataUrl('TMDB-SEASON-POSTER-4', '#d97706'),
};
const animeSeasonPoster = svgDataUrl('ANIME-SEASON-POSTER', '#9333ea');
const stills = {
  1: svgDataUrl('TMDB-STILL-1', '#ef4444'),
  2: svgDataUrl('TMDB-STILL-2', '#f59e0b'),
  3: svgDataUrl('TMDB-STILL-3', '#10b981'),
  4: svgDataUrl('TMDB-STILL-4', '#3b82f6'),
};

const tv = {
  id: 84,
  name: 'Fixture Anime',
  original_name: 'Fixture Anime',
  overview: 'Fixture pour les miniatures individuelles des épisodes.',
  poster_path: tmdbSeriesPoster,
  backdrop_path: '',
  first_air_date: '2024-01-01',
  vote_average: 8.4,
  genres: [{ id: 16, name: 'Animation' }],
  origin_country: ['JP'],
  original_language: 'ja',
  number_of_seasons: 1,
  number_of_episodes: 5,
  seasons: [1, 2, 3, 4].map((season_number) => ({
    season_number,
    name: `Saison ${season_number}`,
    poster_path: tmdbSeasonPosters[season_number],
    air_date: '2024-01-01',
    episode_count: 5,
  })),
  status: 'Returning Series',
  type: 'Scripted',
  external_ids: {},
  networks: [],
  production_companies: [{ id: 1, name: 'MAPPA', logo_path: null }],
  credits: { cast: [], crew: [] },
  videos: { results: [] },
  content_ratings: { results: [] },
  alternative_titles: { results: [] },
  keywords: { results: [] },
};

// Ordre volontairement NON numérique : 3, 1, 4, 2, 5.
const seasonFixture = {
  id: 1,
  season_number: 1,
  name: 'Saison 1',
  poster_path: tmdbSeasonPoster,
  air_date: '2024-01-01',
  episode_count: 5,
  episodes: [
    { episode_number: 3, season_number: 1, name: 'Épisode 3', overview: '', still_path: stills[3], air_date: '2024-01-03' },
    { episode_number: 1, season_number: 1, name: 'Épisode 1', overview: '', still_path: stills[1], air_date: '2024-01-01' },
    { episode_number: 4, season_number: 1, name: 'Épisode 4', overview: '', still_path: stills[4], air_date: '2024-01-04' },
    { episode_number: 2, season_number: 1, name: 'Épisode 2', overview: '', still_path: stills[2], air_date: '2024-01-02' },
    { episode_number: 5, season_number: 1, name: 'Épisode 5', overview: '', still_path: null, air_date: '2024-01-05' },
  ],
};

const animeFixture = {
  name: 'Fixture Anime',
  url: 'https://anime-sama.test/catalogue/fixture/',
  image: svgDataUrl('ANIME-SERIES', '#be123c'),
  seasons: [
    {
      number: 1,
      name: 'Saison Anime 1',
      poster_path: animeSeasonPoster,
      episodes: [
        { index: 11, name: 'Episode 1', streaming_links: [{ language: 'vf', players: ['fixture-vf-1'] }] },
        { index: 12, name: 'Episode 2', streaming_links: [{ language: 'vostfr', players: ['fixture-vostfr-2'] }] },
        { index: 13, name: 'Episode 3', streaming_links: [{ language: 'vf', players: ['fixture-vf-3'] }, { language: 'vostfr', players: ['fixture-vostfr-3'] }] },
        { index: 14, name: 'Episode 4', streaming_links: [{ language: 'vf', players: ['fixture-vf-4'] }] },
        { index: 15, name: 'Episode 5', streaming_links: [{ language: 'vostfr', players: ['fixture-vostfr-5'] }] },
        { index: 16, name: 'Episode 0', streaming_links: [{ language: 'vf', players: ['fixture-vf-6'] }] },
      ],
    },
    ...[2, 3, 4].map((number) => ({
      number,
      name: `Saison Anime ${number}`,
      poster_path: animeSeasonPoster,
      episodes: [{ index: number * 10, name: `Episode saison ${number}`, streaming_links: [{ language: 'vf', players: ['fixture-extra'] }] }],
    })),
  ],
};

const expectedAnimeSources = [
  ['Episode 1', ['VF']],
  ['Episode 2', ['VOSTFR']],
  ['Episode 3', ['VF', 'VOSTFR']],
  ['Episode 4', ['VF']],
  ['Episode 5', ['VOSTFR']],
  ['Episode 0', ['VF']],
];

const expectedStillByEpisode = {
  'Episode 1': 'TMDB-STILL-1',
  'Episode 2': 'TMDB-STILL-2',
  'Episode 3': 'TMDB-STILL-3',
  'Episode 4': 'TMDB-STILL-4',
};

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import TVDetails from ${JSON.stringify(repo + '/src/pages/TVDetails')};

localStorage.removeItem('anti_spoiler');

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/tv/84']}>
    <Routes><Route path="/tv/:id" element={<TVDetails/>}/></Routes>
  </MemoryRouter>
);
`;

const stubSources = {
  axios: `
    const tv = ${JSON.stringify(tv)};
    const season = ${JSON.stringify(seasonFixture)};
    const anime = ${JSON.stringify(animeFixture)};
    export default {
      get: async (url) => {
        const u = new URL(String(url), 'https://details.test');
        if (u.hostname === 'main-api.test' && /\\/anime\\/tmdb\\/tv\\/84/.test(u.pathname)) return { data: [anime] };
        if (u.hostname === 'main-api.test' && u.pathname.includes('/anime/search/')) return { data: [anime] };
        if (/\\/tv\\/84\\/season\\/1$/.test(u.pathname)) return { data: season };
        if (/\\/tv\\/84\\/season\\//.test(u.pathname)) return { data: { episodes: [] } };
        if (/\\/tv\\/84$/.test(u.pathname)) return { data: tv };
        if (/\\/tv\\/84\\/images$/.test(u.pathname)) return { data: { posters: [], backdrops: [], logos: [] } };
        return { data: { results: [], cast: [], crew: [] } };
      },
    };
  `,
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:false,carouselAutoplay:false,bgAnimations:false}});`,
  reactI18next: `
    import fr from ${JSON.stringify(repo + '/src/i18n/locales/fr.json')};
    const lookup = (key) => key.split('.').reduce((value, part) => value?.[part], fr) ?? key;
    export const useTranslation=()=>({t:lookup,i18n:{language:'fr-FR'}});
  `,
  i18n: `export const getTmdbLanguage=()=> 'fr-FR'; export default {language:'fr-FR'};`,
  AddToListButton: `export default ()=>null;`,
  AddToListMenu: `export default ()=>null;`,
  DetailsSkeleton: `export default ()=> <div data-testid="details-skeleton"/>`,
  ShareButtons: `export default ()=>null;`,
  EmblaCarousel: `export default ()=>null;`,
  CommentsSection: `export default ()=>null;`,
  LikeDislikeButton: `export const calculateLikeDislikeRating=()=>null; export default ()=>null;`,
  MovixRatingInfoModal: `export default ()=>null;`,
  LazySection: `export default ({children})=><>{children}</>;`,
  SEO: `export default ()=>null;`,
  CharactersSection: `export default ()=>null;`,
  DetailExtraMetadata: `export default ()=>null;`,
  AlertButton: `export default ()=>null;`,
  AntiSpoilerSettingsModal: `export default ()=>null;`,
  CustomDropdown: `export default ()=>null;`,
  useWrappedTracker: `export const useWrappedTracker=()=>{};`,
  useMovieReleaseWarnings: `export const useMovieReleaseWarnings=()=>false;`,
  useTvAiringSchedule: `export const useTvAiringSchedule=()=>({schedule:null,now:Date.now()});`,
  detailCharacters: `export const loadDetailCharacters=async()=>({source:'tmdb',total:0,groups:[],themes:[]});`,
  dialog: `export const Dialog=({children})=><>{children}</>; export const DialogContent=({children})=><div>{children}</div>; export const DialogDescription=({children})=><p>{children}</p>; export const DialogHeader=({children})=><div>{children}</div>; export const DialogTitle=({children})=><h2>{children}</h2>;`,
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
    name: 'anime-episode-thumbnails-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /^axios$|^react-i18next$|(?:^|\/)i18n$|PrefetchLink$|AdFreePopupContext$|ProfileContext$|LightModeContext$|AddToListButton$|AddToListMenu$|DetailsSkeleton$|ShareButtons$|EmblaCarousel$|CommentsSection$|LikeDislikeButton$|MovixRatingInfoModal$|LazySection$|(?:^|\/)SEO$|CharactersSection$|DetailExtraMetadata$|AlertButton$|components\/AntiSpoilerSettings$|CustomDropdown$|useWrappedTracker$|useMovieReleaseWarnings$|useTvAiringSchedule$|detailCharacters$|components\/ui\/dialog$/,
      }, ({ path: name }) => {
        const key = name === 'react-i18next' ? 'reactI18next'
          : /components\/ui\/dialog$/.test(name) ? 'dialog'
            : /components\/AntiSpoilerSettings$/.test(name) ? 'AntiSpoilerSettingsModal'
              : /(?:^|\/)i18n$/.test(name) ? 'i18n'
                : Object.keys(stubSources).sort((left, right) => right.length - left.length)
                  .find(candidate => name === candidate || name.endsWith(candidate));
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
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body class="bg-[#0a0a0a]"><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === 'details.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    await route.fulfill({
      contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
      body: await readFile(path.join(work, name)),
    });
    return;
  }
  await route.fulfill({ contentType: 'application/json', body: '{}' });
});

const pageErrors = [];
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto('http://details.test/', { waitUntil: 'load' });
await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
await page.getByText('Saison Anime 1', { exact: true }).first().evaluate((element) => {
  const clickable = element.closest('button') || element.closest('[role="tab"]') || element;
  clickable.click();
});
await page.locator('.seasons-section').getByRole('button').nth(1).waitFor({ state: 'visible', timeout: 15000 });

async function cardSnapshot() {
  return page.locator('.seasons-section').evaluate((section) => {
    const animeMode = Boolean(section.querySelector('[class*="ring-rose-500"]'));
    const cards = animeMode
      ? [...section.querySelectorAll('button')].filter((button) => button.querySelector('h4'))
      : [...section.querySelectorAll('h4')].map((heading) => heading.closest('div.group') ?? heading.parentElement?.parentElement?.parentElement);
    return cards.map((card) => ({
      name: card?.querySelector('h4')?.textContent?.trim() ?? '',
      languages: [...(card?.querySelectorAll('span') ?? [])]
        .map((span) => span.textContent?.trim())
        .filter((text) => text === 'VF' || text === 'VOSTFR'),
      src: card?.querySelector('img')?.getAttribute('src') ?? null,
    }));
  });
}

const animeCards = await cardSnapshot();
// Les affiches TMDB de chaque saison doivent primer sur l'affiche Anime-Sama
// commune aux quatre saisons : aucune association par position n'est utilisée.
for (const seasonNumber of [1, 2, 3, 4]) {
  const seasonImage = page.locator(`.seasons-section img[alt="Saison Anime ${seasonNumber}"]`).first();
  await seasonImage.waitFor({ state: 'visible', timeout: 15000 });
  const src = await seasonImage.getAttribute('src');
  assert.ok(
    src?.includes(`TMDB-SEASON-POSTER-${seasonNumber}`),
    `La saison ${seasonNumber} doit afficher son affiche TMDB dédiée, reçu : ${src}`,
  );
}
observations.push('4 affiches de saisons TMDB distinctes priment sur l’affiche Anime-Sama commune.');
await page.screenshot({ path: path.join(artifactDir, `${label}-anime.png`), fullPage: true });

await page.goto('http://details.test/', { waitUntil: 'load' });
await page.getByRole('button', { name: 'Retour au mode standard', exact: true }).first().click();
await page.getByText('Saison 1', { exact: true }).first().waitFor({ state: 'visible' });
await page.getByText('Saison 1', { exact: true }).first().evaluate((element) => {
  const clickable = element.closest('button') || element.closest('[role="tab"]') || element;
  clickable.click();
});
await page.locator('.seasons-section').getByRole('button').nth(1).waitFor({ state: 'visible', timeout: 15000 });
await page.locator('.seasons-section img').first().waitFor({ state: 'visible', timeout: 15000 });
const standardCards = await cardSnapshot();
await page.screenshot({ path: path.join(artifactDir, `${label}-standard.png`), fullPage: true });

const observations = [];
assert.deepEqual(
  animeCards.map(({ name, languages }) => [name, languages]),
  expectedAnimeSources,
  'Les noms, langues et sources des épisodes Anime ne doivent pas changer',
);
observations.push('Sources Anime inchangées : 6 épisodes avec leurs langues VF/VOSTFR d’origine.');

for (const [name, marker] of Object.entries(expectedStillByEpisode)) {
  const card = animeCards.find((item) => item.name === name);
  assert.ok(card, `Carte Anime ${name} absente`);
  assert.ok(card.src?.includes(marker), `La carte Anime ${name} doit afficher ${marker}, reçu : ${card.src}`);
}
const distinctAnimeStills = animeCards
  .filter((item) => item.name in expectedStillByEpisode)
  .map((item) => item.src)
  .filter(Boolean);
assert.equal(new Set(distinctAnimeStills).size, 4, 'Les 4 épisodes doivent afficher 4 miniatures distinctes');
observations.push('4 miniatures TMDB distinctes, associées par numéro d’épisode malgré l’ordre désordonné du tableau TMDB.');

const episodeFive = animeCards.find((item) => item.name === 'Episode 5');
const specialEpisode = animeCards.find((item) => item.name === 'Episode 0');
assert.ok(episodeFive?.src?.includes('ANIME-SEASON-POSTER'), 'L’épisode sans still TMDB doit replier sur l’affiche de saison');
assert.ok(specialEpisode?.src?.includes('ANIME-SEASON-POSTER'), 'L’épisode spécial sans correspondance TMDB doit replier sur l’affiche de saison');
observations.push('Replis corrects : épisode sans miniature et épisode spécial affichent l’affiche de saison.');

assert.deepEqual(
  standardCards.map(({ name }) => name).sort(),
  ['1. Épisode 1', '2. Épisode 2', '3. Épisode 3', '4. Épisode 4', '5. Épisode 5'].sort(),
  'La liste standard doit rester inchangée',
);
for (const [name, marker] of Object.entries(expectedStillByEpisode)) {
  const number = name.replace('Épisode ', '');
  const card = standardCards.find((item) => item.name === `${number}. ${name}`);
  assert.ok(card?.src?.includes(marker), `La carte standard ${number} doit afficher ${marker}, reçu : ${card?.src}`);
}
const episodeFiveStandard = standardCards.find((item) => item.name === '5. Épisode 5');
assert.ok(episodeFiveStandard?.src?.includes('TMDB-SEASON-POSTER'), 'L’épisode standard sans still doit replier sur l’affiche TMDB');
observations.push('Mode standard inchangé : mêmes numéros et mêmes miniatures TMDB, y compris le repli sur l’affiche de saison.');
assert.deepEqual(pageErrors, [], `Aucune erreur JavaScript non capturée n'est attendue : ${pageErrors.join(' | ')}`);

await writeFile(path.join(artifactDir, `report-${label}.json`), JSON.stringify({
  label,
  result: 'PASS',
  observations,
  animeCards,
  standardCards,
  pageErrors,
}, null, 2));

await browser.close();
console.log(`anime episode thumbnails E2E OK (${label}) — artifacts: ${artifactDir}`);
