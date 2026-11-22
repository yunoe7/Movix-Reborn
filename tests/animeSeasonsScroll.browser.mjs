/**
 * E2E ciblé : fluidité du défilement de la grille des saisons en mode Anime.
 *
 * Le harnais génère 120 saisons (dont 17 annoncées indisponibles), vérifie
 * les invariants d'affichage et mesure les intervalles de frames pendant un
 * scroll réel, avec le pointeur hors de la grille puis sur une carte.
 *
 * Prérequis : Playwright/Chromium via CODEX_PRIMARY_RUNTIME_NODE_MODULES et
 * CHROMIUM_EXECUTABLE_PATH. Relance :
 *   node tests/animeSeasonsScroll.browser.mjs
 *
 * Artefacts : ANIME_SCROLL_E2E_ARTIFACT_DIR (dossier temporaire par défaut).
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
const artifactDir = process.env.ANIME_SCROLL_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.ANIME_SCROLL_E2E_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-anime-scroll-e2e-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(work, { recursive: true });

const svgDataUrl = (label, fill) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="${fill}"/><text x="320" y="480" fill="white" font-family="sans-serif" font-size="72" text-anchor="middle">${label}</text></svg>`,
  )}`;

const seasons = Array.from({ length: 120 }, (_, i) => {
  const number = i + 1;
  const unavailable = number % 7 === 0;
  return {
    number,
    name: `Saison Anime ${number}`,
    poster_path: svgDataUrl(`SEASON-${number}`, i % 2 ? '#7c3aed' : '#be123c'),
    available: !unavailable,
    status: unavailable ? 'unavailable' : 'available',
    episodes: unavailable ? [] : [{ index: 1, name: `Épisode ${number}-1`, streaming_links: [] }],
  };
});

const tv = {
  id: 84,
  name: 'Fixture Anime',
  original_name: 'Fixture Anime',
  overview: 'Fixture de mesure de défilement avec 120 saisons.',
  poster_path: svgDataUrl('SERIES-POSTER', '#be123c'),
  backdrop_path: '',
  first_air_date: '2024-01-01',
  vote_average: 8.4,
  genres: [{ id: 16, name: 'Animation' }],
  origin_country: ['JP'],
  original_language: 'ja',
  number_of_seasons: 120,
  number_of_episodes: 120,
  seasons: seasons.map((s) => ({
    season_number: s.number,
    name: s.name,
    poster_path: s.poster_path,
    episode_count: s.episodes.length,
    air_date: '2024-01-01',
  })),
  status: 'Returning Series',
  type: 'Scripted',
  external_ids: {},
  networks: [],
  production_companies: [],
  credits: { cast: [], crew: [] },
  videos: { results: [] },
  content_ratings: { results: [] },
  alternative_titles: { results: [] },
  keywords: { results: [] },
};
const anime = { name: 'Fixture Anime', image: svgDataUrl('ANIME-SERIES', '#be123c'), seasons };

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import TVDetails from '@/pages/TVDetails';
import SmoothScroll from '@/components/SmoothScroll';
createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/tv/84']}>
    <SmoothScroll/>
    <Routes><Route path="/tv/:id" element={<TVDetails/>}/></Routes>
  </MemoryRouter>
);
`;

const stubSources = {
  axios: `
    const tv = ${JSON.stringify(tv)};
    const anime = ${JSON.stringify(anime)};
    export default {
      get: async (url) => {
        const u = new URL(String(url), 'https://details.test');
        if (u.hostname === 'main-api.test' && /\\/anime\\/tmdb\\/tv\\/84/.test(u.pathname)) return { data: [anime] };
        if (u.hostname === 'main-api.test' && u.pathname.includes('/anime/search/')) return { data: [anime] };
        if (/\\/tv\\/84\\/season\\//.test(u.pathname)) return { data: { episodes: [] } };
        if (/\\/tv\\/84\\/images$/.test(u.pathname)) return { data: { posters: [], backdrops: [], logos: [] } };
        if (/\\/tv\\/84$/.test(u.pathname)) return { data: tv };
        return { data: { results: [], cast: [], crew: [] } };
      },
    };
  `,
  PrefetchLink: `export const PrefetchLink=({to,children,...props})=><a href={typeof to==='string'?to:'#'} {...props}>{children}</a>;`,
  AdFreePopupContext: `export const useAdFreePopup=()=>({resetVipStatus:()=>{}});`,
  ProfileContext: `export const useProfile=()=>({currentProfile:null});`,
  LightModeContext: `export const useLightMode=()=>({isLightMode:false,effectivePrefs:{transitions:true,carouselAutoplay:false,bgAnimations:false}});`,
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
  AntiSpoilerSettingsModal: `export default ({isOpen,onClose})=>isOpen ? <div data-testid="anti-spoiler-modal" role="dialog"><button onClick={onClose}>Fermer</button></div> : null;`,
  CustomDropdown: `export default ()=>null;`,
  useWrappedTracker: `export const useWrappedTracker=()=>{};`,
  useMovieReleaseWarnings: `export const useMovieReleaseWarnings=()=>false;`,
  useTvAiringSchedule: `export const useTvAiringSchedule=()=>({schedule:null,now:Date.now()});`,
  detailCharacters: `export const loadDetailCharacters=async()=>({source:'tmdb',total:0,groups:[],themes:[]});`,
  dialog: `export const Dialog=({children})=><>{children}</>; export const DialogContent=({children})=><div>{children}</div>; export const DialogDescription=({children})=><p>{children}</p>; export const DialogHeader=({children})=><div>{children}</div>; export const DialogTitle=({children})=><h2>{children}</h2>;`,
};

const entry = path.join(work, 'entry.tsx');
await writeFile(entry, fixture);
await build({
  entryPoints: [entry],
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
    name: 'anime-seasons-scroll-fixture',
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
        contents: stubSources[key], loader: 'tsx', resolveDir: repo,
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
await page.goto('http://details.test/?path=/tv/84', { waitUntil: 'load' });
await page.getByText('MODE ANIME ACTIF', { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });

const observations = [];
const cards = page.locator('.anime-season-card');
assert.equal(await cards.count(), 120, 'Les 120 saisons annoncées doivent rester affichées');
const unavailableCards = await cards.filter({ hasText: 'Indisponible' }).count();
assert.equal(unavailableCards, 17, 'Les 17 saisons annoncées indisponibles doivent rester visibles');
observations.push(`120 cartes affichées, dont ${unavailableCards} saisons « Indisponible ».`);

const attrs = await page.locator('.anime-season-card img').evaluateAll((images) => images.map((img) => ({
  lazy: img.getAttribute('loading'),
  decoding: img.getAttribute('decoding'),
  width: img.getAttribute('width'),
  height: img.getAttribute('height'),
})));
assert.ok(attrs.every((a) => a.lazy === 'lazy' && a.decoding === 'async' && a.width === '2' && a.height === '3'), 'Toutes les affiches doivent être lazy, décodées de façon asynchrone et dimensionnées');
observations.push('120 affiches : loading=lazy, decoding=async, dimensions 2/3 explicites.');

const restStyle = await page.locator('.anime-seasons-section').evaluate((el) => getComputedStyle(el).backdropFilter);
assert.equal(restStyle, 'blur(4px)', 'Le fond vitré doit rester inchangé au repos');
await page.evaluate(() => document.body.classList.add('is-scrolling'));
const scrollStyle = await page.locator('.anime-seasons-section').evaluate((el) => ({
  backdrop: getComputedStyle(el).backdropFilter,
  pointer: getComputedStyle(document.querySelector('.anime-season-card')).pointerEvents,
}));
assert.equal(scrollStyle.backdrop, 'none', 'Le backdrop-filter doit être suspendu pendant le scroll');
assert.equal(scrollStyle.pointer, 'none', 'Le hover des cartes doit être neutralisé pendant le scroll');
await page.evaluate(() => document.body.classList.remove('is-scrolling'));
observations.push('Au repos : fond vitré conservé ; pendant le scroll : backdrop-filter désactivé et hover neutralisé.');

const design = await page.evaluate(() => {
  const card = document.querySelector('.anime-season-card');
  const grid = card.parentElement;
  const image = card.querySelector('img');
  const cardStyle = getComputedStyle(card);
  const gridStyle = getComputedStyle(grid);
  const imageStyle = getComputedStyle(image);
  return {
    card: {
      width: +card.getBoundingClientRect().width.toFixed(1),
      height: +card.getBoundingClientRect().height.toFixed(1),
      borderColor: cardStyle.borderTopColor,
      backgroundColor: cardStyle.backgroundColor,
      borderRadius: cardStyle.borderTopLeftRadius,
      transform: cardStyle.transform,
    },
    grid: { gap: gridStyle.gap, columns: gridStyle.gridTemplateColumns },
    image: { objectFit: imageStyle.objectFit, transform: imageStyle.transform },
    order: [...grid.children].slice(0, 5).map((child) => child.innerText.split('\n')[0]),
  };
});
observations.push(`Design au repos : carte ${design.card.width}×${design.card.height}px, bordure ${design.card.borderColor}, gap ${design.grid.gap}, premier ordre ${design.order.join(' → ')}.`);

async function measureOnce(pointer) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    const section = document.querySelector('.anime-seasons-section');
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY - 80);
    window.__frameDeltas = [];
    let previous = performance.now();
    const sample = (now) => {
      window.__frameDeltas.push(now - previous);
      previous = now;
      if (window.__frameDeltas.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const cardBox = await cards.first().boundingBox();
  if (pointer === 'grid') await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  else await page.mouse.move(4, 4);
  for (let i = 0; i < 130; i += 1) {
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(10);
  }
  const deltas = await page.evaluate(() => window.__frameDeltas.slice().sort((a, b) => a - b));
  return {
    frames: deltas.length,
    median: +deltas[Math.floor(deltas.length / 2)].toFixed(2),
    p95: +deltas[Math.floor(deltas.length * 0.95)].toFixed(2),
    max: +deltas[deltas.length - 1].toFixed(2),
    over50: deltas.filter((d) => d > 50).length,
  };
}

async function measure(label, pointer) {
  await measureOnce(pointer); // échauffement : Lenis, images et mise en page
  const runs = [await measureOnce(pointer), await measureOnce(pointer), await measureOnce(pointer)];
  const middle = (values) => values.slice().sort((a, b) => a - b)[1];
  const stats = {
    frames: runs.reduce((sum, run) => sum + run.frames, 0),
    median: middle(runs.map((run) => run.median)),
    p95: middle(runs.map((run) => run.p95)),
    max: Math.max(...runs.map((run) => run.max)),
    over50: runs.reduce((sum, run) => sum + run.over50, 0),
  };
  observations.push(`${label} (3 mesures) : médiane ${stats.median} ms, p95 ${stats.p95} ms, pic ${stats.max} ms, frames >50 ms : ${stats.over50}.`);
  return stats;
}

const outside = await measure('Pointeur hors grille', 'outside');
const overGrid = await measure('Pointeur sur la grille', 'grid');
assert.deepEqual(pageErrors, [], `Aucune erreur JavaScript non capturée : ${pageErrors.join(' | ')}`);

const report = `# E2E — défilement fluide des saisons Anime

- Commande : \`node tests/animeSeasonsScroll.browser.mjs\`
- Prérequis : Playwright/Chromium via \`CODEX_PRIMARY_RUNTIME_NODE_MODULES\` et \`CHROMIUM_EXECUTABLE_PATH\`.
- Données : fiche TMDB fictive (ID 84), 120 saisons Anime-Sama fictives dont 17 annoncées indisponibles, affiches SVG embarquées.
- Résultat : **PASS** — ${observations.length} contrôles réalisés, ${pageErrors.length} erreur JavaScript.

## Observations

${observations.map((line) => `- ${line}`).join('\n')}

## Mesures

| Scénario | Frames | Médiane | p95 | Max | > 50 ms |
| --- | --- | --- | --- | --- | --- |
| Pointeur hors grille | ${outside.frames} | ${outside.median} ms | ${outside.p95} ms | ${outside.max} ms | ${outside.over50} |
| Pointeur sur la grille | ${overGrid.frames} | ${overGrid.median} ms | ${overGrid.p95} ms | ${overGrid.max} ms | ${overGrid.over50} |

Les mesures dépendent de la charge de la machine ; elles servent à comparer les scénarios entre eux et à détecter les frames bloquantes, pas à produire un score absolu.
`;
await writeFile(path.join(artifactDir, 'report.md'), report);
await writeFile(path.join(artifactDir, 'metrics.json'), JSON.stringify({ design, outside, overGrid, pageErrors }, null, 2));
console.log(report);
console.log(`Artefacts : ${artifactDir}`);
await browser.close();
