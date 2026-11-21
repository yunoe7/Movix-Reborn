/**
 * E2E ciblé : affiches Anime, Anti-Spoil indépendant et visibilité du mode Anime.
 *
 * Prérequis : Playwright/Chromium (CODEX_PRIMARY_RUNTIME_NODE_MODULES peut
 * pointer vers un runtime contenant playwright ; CHROMIUM_EXECUTABLE_PATH peut
 * surcharger le binaire). Relance :
 *   node tests/animeModeVisuals.browser.mjs
 *
 * Un dossier d'artefacts peut être fourni avec ANIME_MODE_E2E_ARTIFACT_DIR.
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
const artifactDir = process.env.ANIME_MODE_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.ANIME_MODE_E2E_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-anime-visual-e2e-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const svgDataUrl = (label, fill) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${fill}"/><text x="320" y="190" fill="white" font-family="sans-serif" font-size="52" text-anchor="middle">${label}</text></svg>`,
  )}`;

const tv = {
  id: 84,
  name: 'Fixture Anime',
  original_name: 'Fixture Anime',
  overview: 'Fixture pour les contrôles visuels du mode Anime.',
  poster_path: svgDataUrl('SERIES-POSTER', '#be123c'),
  backdrop_path: '',
  first_air_date: '2024-01-01',
  vote_average: 8.4,
  genres: [{ id: 16, name: 'Animation' }],
  origin_country: ['JP'],
  original_language: 'ja',
  number_of_seasons: 1,
  number_of_episodes: 2,
  seasons: [{ season_number: 1, name: 'Saison 1', poster_path: svgDataUrl('TMDB-SEASON', '#7c3aed'), air_date: '2024-01-01', episode_count: 2 }],
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

const seasonFixture = {
  id: 1,
  season_number: 1,
  name: 'Saison 1',
  poster_path: svgDataUrl('TMDB-SEASON', '#7c3aed'),
  air_date: '2024-01-01',
  episode_count: 2,
  episodes: [
    {
      episode_number: 1,
      season_number: 1,
      name: 'Épisode avec vignette',
      overview: '',
      still_path: svgDataUrl('TMDB-STILL', '#0369a1'),
      air_date: '2024-01-01',
    },
    {
      episode_number: 2,
      season_number: 1,
      name: 'Épisode sans vignette',
      overview: '',
      still_path: null,
      air_date: '2024-01-02',
    },
  ],
};

const animeFixture = {
  name: 'Fixture Anime',
  image: svgDataUrl('ANIME-SERIES', '#be123c'),
  seasons: [
    {
      number: 1,
      name: 'Saison Anime 1',
      poster_path: svgDataUrl('SEASON-POSTER', '#7c3aed'),
      episodes: [
        {
          index: 1,
          name: 'Épisode Anime 1',
          streaming_links: [{ language: 'vf', players: ['fixture'] }],
          still_path: svgDataUrl('STILL-ANIME', '#0369a1'),
        },
        {
          index: 2,
          name: 'Épisode Anime 2',
          streaming_links: [{ language: 'vostfr', players: ['fixture'] }],
          still_path: null,
        },
      ],
    },
  ],
};

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import TVDetails from ${JSON.stringify(repo + '/src/pages/TVDetails')};

const params = new URLSearchParams(location.search);
if (params.get('spoiler') === '1') {
  localStorage.setItem('anti_spoiler', JSON.stringify({
    seasonImages: true,
    episodeNames: false,
    episodeImages: true,
    episodeOverviews: false,
    nextEpisodeInfo: false,
    enabled: true,
  }));
} else {
  localStorage.removeItem('anti_spoiler');
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[params.get('path') || '/tv/84']}>
    <Routes>
      <Route path="/tv/:id" element={<TVDetails/>}/>
    </Routes>
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
  DetailsSkeleton: `export default ()=> <div data-testid="details-skeleton"/>;`,
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
  AntiSpoilerSettingsModal: `export default ({isOpen,onClose})=>isOpen ? <div data-testid="anti-spoiler-modal" role="dialog"><p>Paramètres Anti-Spoil</p><button onClick={onClose}>Fermer</button></div> : null;`,
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
    name: 'anime-mode-visual-fixture',
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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
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

const base = 'http://details.test/?path=/tv/84';
const observations = [];

async function selectAnimeSeason(target) {
  await target.getByText('Saison Anime 1', { exact: true }).first().click();
}

async function openAndWait(spoiler) {
  await page.goto(`${base}&spoiler=${spoiler ? '1' : '0'}`, { waitUntil: 'load' });
  await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  await selectAnimeSeason(page);
}

await openAndWait(false);

const antiSpoilButton = page.locator('button[title="Configurer les paramètres anti-spoil"]');
const standardButton = page.getByRole('button', { name: 'Retour au mode standard', exact: true }).first();
assert.equal(await antiSpoilButton.count(), 1, 'Le bouton Anti-Spoil doit rester présent');
assert.ok(await antiSpoilButton.isVisible(), 'Le bouton Anti-Spoil doit être visible en mode Anime');
assert.ok(await standardButton.isVisible(), "L'action de retour au mode standard doit être visible");
const antiSpoilTop = await antiSpoilButton.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
const animeTop = await standardButton.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
assert.ok(Math.abs(antiSpoilTop - animeTop) < 40, 'Anti-Spoil et mode Anime doivent être sur la même rangée');
observations.push('Mode Anime actif : badge « MODE ANIME ACTIF », bouton « Retour au mode standard » et bouton Anti-Spoil visibles sur la même rangée.');

const seasonPosterCount = await page.locator('img[src*="SEASON-POSTER"]').count();
assert.ok(seasonPosterCount >= 1, "L'affiche de saison fournie doit être affichée");
const purpleCardCount = await page.locator('.seasons-section [class*="from-purple-900"]').count();
assert.equal(purpleCardCount, 0, 'Aucune carte violette générique ne doit remplacer une affiche disponible');
observations.push(`Saisons : ${seasonPosterCount} image(s) d'affiche réelle(s), aucune carte violette générique.`);

await page.locator('img[src*="STILL-ANIME"]').first().waitFor({ state: 'visible', timeout: 15000 });
assert.ok(await page.locator('img[src*="STILL-ANIME"]').count() >= 1, 'Une vignette d’épisode fournie doit être affichée');
assert.ok(await page.locator('img[src*="SEASON-POSTER"]').count() >= 2, "L'épisode sans vignette doit replier sur l'affiche de saison");
observations.push('Épisodes : vignette fournie affichée, puis repli sur l’affiche de saison quand la vignette manque.');

await page.screenshot({ path: path.join(artifactDir, 'desktop-anime-active.png'), fullPage: true });

await antiSpoilButton.click();
await page.getByTestId('anti-spoiler-modal').waitFor({ state: 'visible' });
assert.ok(await page.getByText('MODE ANIME ACTIF', { exact: true }).first().isVisible(), 'Ouvrir Anti-Spoil ne doit pas désactiver le mode Anime');
observations.push('Ouverture du panneau Anti-Spoil : le mode Anime reste actif.');

await openAndWait(true);
assert.ok(await page.getByText('Image masquée', { exact: true }).first().isVisible(), 'Les images doivent être masquées quand Anti-Spoil est activé');
assert.equal(await page.locator('img[src*="SEASON-POSTER"]').count(), 0, 'Aucune affiche ne doit rester visible avec Anti-Spoil actif');
assert.ok(await page.getByText('MODE ANIME ACTIF', { exact: true }).first().isVisible(), 'Anti-Spoil activé ne doit pas désactiver le mode Anime');
assert.ok(await antiSpoilButton.isVisible(), 'Le bouton Anti-Spoil doit rester accessible');
observations.push('Anti-Spoil activé : images masquées, badge Anime toujours présent et bouton Anti-Spoil accessible.');

await page.screenshot({ path: path.join(artifactDir, 'desktop-anti-spoiler.png'), fullPage: true });

const settingsBeforeToggle = await page.evaluate(() => JSON.parse(localStorage.getItem('anti_spoiler') || 'null'));
assert.equal(settingsBeforeToggle?.seasonImages, true);
assert.equal(settingsBeforeToggle?.episodeImages, true);

await standardButton.click();
await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'detached', timeout: 10000 });
assert.ok(await antiSpoilButton.isVisible(), 'Le bouton Anti-Spoil doit rester accessible en mode standard');
const settingsAfterToggle = await page.evaluate(() => JSON.parse(localStorage.getItem('anti_spoiler') || 'null'));
assert.deepEqual(settingsAfterToggle, settingsBeforeToggle, 'Retour au mode standard ne doit pas modifier les réglages Anti-Spoil');
observations.push('Retour au mode standard : badge masqué, Anti-Spoil inchangé et toujours accessible.');

await page.getByRole('button', { name: 'Mode anime', exact: true }).first().click();
await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('anti_spoiler') || 'null')), settingsBeforeToggle, 'Réactiver le mode Anime ne doit pas modifier Anti-Spoil');
observations.push('Réactivation du mode Anime : badge de nouveau visible, réglages Anti-Spoil préservés.');

await openAndWait(false);
assert.ok(await page.locator('img[src*="SEASON-POSTER"]').count() >= 2, 'Les images doivent revenir après désactivation d’Anti-Spoil');
observations.push('Anti-Spoil désactivé : les affiches et vignettes réapparaissent.');

await standardButton.click();
await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'detached', timeout: 10000 });
assert.equal(await page.locator('.seasons-section [class*="from-purple-900"]').count(), 0, 'Aucune carte violette générique ne doit apparaître en mode standard');
assert.ok(await page.locator('img[src*="TMDB-SEASON"]').count() >= 1, "L'affiche de saison TMDB doit être utilisée en mode standard");
await page.getByText('Saison 1', { exact: true }).first().click();
await page.locator('img[src*="TMDB-STILL"]').first().waitFor({ state: 'visible', timeout: 15000 });
assert.ok(await page.locator('img[src*="TMDB-SEASON"]').count() >= 2, "L'épisode standard sans vignette doit replier sur l'affiche de saison");
observations.push('Mode standard : affiche TMDB sur la carte de saison, vignette fournie puis repli sur l’affiche de saison pour l’épisode sans image.');

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobileContext.route('**/*', async (route) => {
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
const mobilePage = await mobileContext.newPage();
await mobilePage.goto(`${base}&spoiler=0`, { waitUntil: 'load' });
await mobilePage.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
await selectAnimeSeason(mobilePage);
const overflow = await mobilePage.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
assert.ok(overflow.scrollWidth <= overflow.innerWidth + 1, `Aucun débordement horizontal attendu sur mobile (${overflow.scrollWidth} > ${overflow.innerWidth})`);
assert.ok(await mobilePage.getByRole('button', { name: 'Retour au mode standard', exact: true }).first().isVisible());
assert.ok(await mobilePage.locator('button[title="Configurer les paramètres anti-spoil"]').isVisible());
await mobilePage.screenshot({ path: path.join(artifactDir, 'mobile-anime-active.png'), fullPage: true });
observations.push(`Mobile 390px : badge et boutons lisibles, aucun débordement horizontal (${overflow.scrollWidth}px pour ${overflow.innerWidth}px).`);

assert.deepEqual(pageErrors, [], `Aucune erreur JavaScript non capturée n'est attendue : ${pageErrors.join(' | ')}`);

const report = `# E2E — mode Anime visuel et Anti-Spoil indépendant

- Commande : \`node tests/animeModeVisuals.browser.mjs\`
- Prérequis : Playwright/Chromium disponibles via \`CODEX_PRIMARY_RUNTIME_NODE_MODULES\` ou \`CHROMIUM_EXECUTABLE_PATH\`.
- Données : fiche TMDB fictive (ID 84), anime-sama fictif avec affiche de saison, vignette d’épisode et épisode sans vignette.
- Résultat : **PASS** — ${observations.length} contrôles réalisés.

## Observations

${observations.map((line) => `- ${line}`).join('\n')}

## Captures

- \`desktop-anime-active.png\`
- \`desktop-anti-spoiler.png\`
- \`mobile-anime-active.png\`

Erreurs JavaScript non capturées : ${pageErrors.length}.
`;
await writeFile(path.join(artifactDir, 'report.md'), report);

await browser.close();
console.log(`anime visual E2E OK — artifacts: ${artifactDir}`);
