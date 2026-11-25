/**
 * E2E de la refonte de « Sélection de l'équipe » dans l'administration.
 *
 * Vérifie la recherche TMDB (films + séries, titres français et originaux),
 * la récupération des détails (synopsis long, classifications FR/US, genres,
 * durées), l'édition manuelle, l'aperçu en direct, l'activation, la
 * sauvegarde/rechargement, les états d'erreur et le responsive.
 *
 * Relance :
 *   node tests/adminTeamSelection.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss disponibles via
 * NODE_PATH ou node_modules. L'artefact est écrit dans
 * TEAM_SELECTION_ARTIFACT_DIR ou dans <workspace>/movix-artifacts/admin-team-selection.
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

const artifactDir = process.env.TEAM_SELECTION_ARTIFACT_DIR
  ? path.resolve(process.env.TEAM_SELECTION_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'admin-team-selection');
const work = path.join(await mkdtemp(path.join(tmpdir(), 'movix-team-fixture-')));
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const componentPath = path.join(repo, 'src', 'components', 'AdminTeamSelection').replace(/\\/g, '/');

const longOverview = [
  'Maomao mène une vie paisible avec son père, un apothicaire de quartier.',
  'Kidnappée par des bandits, elle est vendue comme servante au palais impérial.',
  'Grâce à son esprit vif et à sa connaissance très précise de la médecine et des poisons,',
  'elle résout les mystères et les complots les plus improbables de la cour.',
  'Chaque affaire l’entraîne un peu plus loin dans les secrets du palais,',
  'entre rites anciens, rivalités de factions et découvertes scientifiques inattendues.',
  'Elle y gagne la confiance de personnages hauts en couleur,',
  'tout en gardant son indépendance et sa curiosité intactes.',
  'Cette aventure mêle enquête, humour, sciences et vie de cour dans un univers',
  'aussi documenté que divertissant, avec une galerie de personnages mémorables.',
  'Le récit avance par petites énigmes qui s’imbriquent en un grand complot',
  'et laisse suffisamment de respirations pour apprécier chaque décor et chaque geste.',
].join(' ');

const savedSelection = {
  enabled: true,
  mediaType: 'tv',
  tmdbId: 215160,
  badge: "🔥 LA SÉLECTION DE L'ÉQUIPE",
  title: "Les Carnets de l'apothicaire",
  description: 'Synopsis initial, court.',
  backdropUrl: 'https://image.tmdb.org/t/original/default-backdrop.jpg',
  detailsUrl: '/tv/apothecary',
  ageRating: '12+',
  rating: '8,6/10',
  genres: 'Animation,Mystère',
  duration: '24 min / épisode',
};

const stubSources = {
  heroPromoService: `
    const KEY = 'team-selection-fixture';
    const base = ${JSON.stringify({ settings: { enabled: true, carousels: {}, promos: [], teamSelection: savedSelection }, updatedAt: null, updatedBy: null, stats: null })};
    export async function getAdminHeroPromos() {
      if (localStorage.getItem('team-selection-load-error') === '1') throw new Error('fixture load error');
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : base;
    }
    export async function updateAdminHeroPromos(settings) {
      window.__savePayloads = (window.__savePayloads || []);
      window.__savePayloads.push(JSON.parse(JSON.stringify(settings)));
      if (localStorage.getItem('team-selection-save-error') === '1') throw new Error('fixture save error');
      const payload = { ...base, settings: JSON.parse(JSON.stringify(settings)) };
      localStorage.setItem(KEY, JSON.stringify(payload));
      return payload;
    }
  `,
  config: `
    export const TMDB_API_KEY = 'fixture-key';
    export const TMDB_API_URL = 'https://tmdb.test/3';
    export const TMDB_IMAGE_URL = 'https://image.tmdb.org/t/p';
  `,
  sonner: `
    const push = (type) => (message) => {
      window.__toasts = (window.__toasts || []);
      window.__toasts.push({ type, message: String(message) });
    };
    export const toast = {
      success: push('success'),
      error: push('error'),
      info: push('info'),
      warning: push('warning'),
    };
  `,
  reactI18next: `
    const t = (key, fallback) => typeof fallback === 'string' ? fallback : String(key);
    export const useTranslation = () => ({ t, i18n: { language: 'fr' } });
  `,
  skeleton: `
    export const Skeleton = ({ height }) => (
      <div data-testid="team-skeleton" style={{ height: typeof height === 'number' ? height + 'px' : height }} />
    );
  `,
};

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import AdminTeamSelection from ${JSON.stringify(componentPath)};

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/admin?section=team-selection']}>
    <div className="admin-console min-h-screen bg-black text-white">
      <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="admin-section-content">
          <AdminTeamSelection />
        </div>
      </main>
    </div>
  </MemoryRouter>
);
`;

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
  plugins: [{
    name: 'team-selection-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /services\/heroPromoService$|config\/config$|ui\/Skeleton$|^(sonner|react-i18next)$/,
      }, ({ path: name }) => {
        const key = name.endsWith('heroPromoService') ? 'heroPromoService'
          : name.endsWith('config/config') ? 'config'
            : name.endsWith('ui/Skeleton') ? 'skeleton'
              : name === 'sonner' ? 'sonner' : 'reactI18next';
        return { path: key, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({
        contents: stubSources[key === 'reactI18next' ? 'reactI18next' : key],
        loader: 'tsx',
        resolveDir: repo,
      }));
    },
  }],
});

await execFileAsync(process.execPath, [
  require.resolve('tailwindcss/lib/cli/index.js'),
  '--config', path.join(repo, 'tailwind.config.js'),
  '--input', path.join(repo, 'src', 'index.css'),
  '--output', path.join(work, 'tailwind.css'),
]);
const tailwindCss = await readFile(path.join(work, 'tailwind.css'), 'utf8');
const adminCss = await readFile(path.join(repo, 'src', 'components', 'admin', 'admin-console.css'), 'utf8');
await writeFile(path.join(work, 'app.css'), `${tailwindCss}\n${adminCss}\n`);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const movieResult = {
  id: 438631,
  mediaType: 'movie',
  title: 'Dune',
  original_title: 'Dune',
  release_date: '2021-10-15',
  overview: 'Un désert, une prophétie et une famille.',
  poster_path: '/movie-poster.jpg',
  backdrop_path: '/movie-backdrop.jpg',
  vote_average: 8.1,
  popularity: 120,
};
const tvResult = {
  id: 215160,
  mediaType: 'tv',
  name: "Les Carnets de l'apothicaire",
  original_name: 'Kusuriya no Hitorigoto',
  first_air_date: '2023-01-10',
  overview: 'Une apothicaire à la cour impériale.',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  vote_average: 8.6,
  popularity: 140,
};
const onePieceResult = {
  id: 100088,
  mediaType: 'tv',
  name: 'One Piece',
  original_name: 'One Piece',
  first_air_date: '1999-10-20',
  overview: 'Un pirate à la recherche du trésor légendaire.',
  poster_path: '/tv-poster.jpg',
  backdrop_path: '/tv-backdrop.jpg',
  vote_average: 8.8,
  popularity: 260,
};

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
const tmdbRequests = [];
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function routeFixture(route) {
  const request = route.request();
  const url = new URL(request.url());

  if (url.hostname === 'team.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(path.join(work, name)).catch(() => null);
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css'
          : 'text/html',
      body: body ?? 'not found',
    });
    return;
  }

  if (url.hostname === 'image.tmdb.org') {
    await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
    return;
  }

  if (url.hostname === 'tmdb.test') {
    tmdbRequests.push({ path: url.pathname, query: url.searchParams.get('query'), language: url.searchParams.get('language') });
    if (localStorageUnavailable(route)) {
      await route.fulfill({ status: 500, headers: corsHeaders, json: { status_message: 'fixture failure' } });
      return;
    }
    if (url.pathname === '/3/search/movie') {
      const query = (url.searchParams.get('query') || '').toLowerCase();
      const results = 'dune'.includes(query) || query.includes('dune') || query.length <= 3
        ? [movieResult]
        : 'carnets'.includes(query) || query.includes('apothicaire') ? [movieResult] : [];
      await route.fulfill({ headers: corsHeaders, json: { page: 1, total_pages: 2, results } });
      return;
    }
    if (url.pathname === '/3/search/tv') {
      const query = (url.searchParams.get('query') || '').toLowerCase();
      const results = query.includes('one') || query.includes('piece')
        ? [onePieceResult]
        : query.includes('carnet') || query.includes('apothicaire') || query.includes('kusuriya') || query.length <= 3
          ? [tvResult]
          : [];
      await route.fulfill({ headers: corsHeaders, json: { page: 1, total_pages: 1, results } });
      return;
    }
    if (url.pathname === '/3/movie/438631') {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          ...movieResult,
          genres: [{ id: 878, name: 'Science-fiction' }, { id: 18, name: 'Drame' }],
          runtime: 155,
          release_dates: {
            results: [
              { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
              { iso_3166_1: 'FR', release_dates: [{ certification: '-12' }] },
            ],
          },
        },
      });
      return;
    }
    if (url.pathname === '/3/tv/215160' || url.pathname === '/3/tv/100088') {
      const isOnePiece = url.pathname.endsWith('100088');
      await route.fulfill({
        headers: corsHeaders,
        json: {
          ...(isOnePiece ? onePieceResult : tvResult),
          overview: longOverview,
          genres: isOnePiece
            ? [{ id: 10759, name: 'Action & Adventure' }, { id: 16, name: 'Animation' }]
            : [{ id: 16, name: 'Animation' }, { id: 9648, name: 'Mystère' }, { id: 18, name: 'Drame' }],
          episode_run_time: isOnePiece ? [22] : [24],
          content_ratings: {
            results: [
              { iso_3166_1: 'US', rating: 'TV-14' },
              { iso_3166_1: 'FR', rating: '-10' },
            ],
          },
        },
      });
      return;
    }
  }

  await route.fulfill({ status: 404, headers: corsHeaders, json: { error: 'not found' } });
}

// L'état d'erreur de recherche est piloté par un cookie lu côté serveur de fixture.
function localStorageUnavailable() {
  return globalThis.__teamSearchError === true;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});

const observations = [];
let runError = null;

async function withScenario(name, options, scenario) {
  const {
    viewport = { width: 1440, height: 900 },
    init = {},
    searchError = false,
    waitForHeading = true,
  } = options;
  const context = await browser.newContext({ viewport });
  globalThis.__teamSearchError = searchError;
  await context.addInitScript((values) => {
    window.__toasts = [];
    window.__savePayloads = [];
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
  }, init);
  await context.route('**/*', routeFixture);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://team.test/');
    if (waitForHeading) {
      try {
        await page.locator('[data-testid="team-heading"]').waitFor({ timeout: 10000 });
      } catch (error) {
        console.error(`[${name}] page errors:`, errors);
        console.error(`[${name}] body:`, (await page.locator('body').innerText()).slice(0, 2000));
        throw error;
      }
    }
    const result = await scenario(page);
    assert.deepEqual(errors, [], `${name}: aucune erreur JavaScript`);
    observations.push({ name, viewport, ...result, errors, searchError });
  } finally {
    await context.tracing.stop({ path: path.join(artifactDir, `trace-${name}.zip`) }).catch(() => {});
    await context.close();
  }
}

const screenshot = (page, name) => page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
const noOverflow = (page) => page.evaluate(() => ({
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));

try {
  await withScenario('recherche-et-selection', {}, async (page) => {
    assert.match(await page.locator('[data-testid="team-heading"]').innerText(), /Sélection de l’équipe/);
    assert.match(await page.locator('[data-testid="team-status"]').innerText(), /Activée/);

    const search = page.locator('[data-testid="team-search-input"]');
    await search.fill('Carnets');
    await page.locator('[data-testid="team-search-result-tv-215160"]').waitFor();

    const searchRequests = tmdbRequests.filter((entry) => entry.path.includes('/search/'));
    assert.ok(searchRequests.some((entry) => entry.path.endsWith('/search/movie')), 'recherche films lancée');
    assert.ok(searchRequests.some((entry) => entry.path.endsWith('/search/tv')), 'recherche séries lancée');
    assert.equal(searchRequests[0]?.language, 'fr-FR', 'recherche en français');

    const cardText = await page.locator('[data-testid="team-search-result-tv-215160"]').innerText();
    assert.match(cardText, /2023/);
    assert.match(cardText, /SÉRIE/i);
    assert.match(cardText, /8,6|8.6/);

    await page.locator('[data-testid="team-search-result-tv-215160"]').click();
    await page.locator('[data-testid="team-field-description"]').waitFor();
    await page.waitForFunction(() => {
      const value = document.querySelector('[data-testid="team-field-description"]')?.value || '';
      return value.length > 600;
    });
    const overview = await page.locator('[data-testid="team-field-description"]').inputValue();
    assert.ok(overview.length > 600, 'synopsis TMDB conservé intégralement');
    assert.equal(await page.locator('[data-testid="team-field-tmdb-id"]').inputValue(), '215160');
    assert.equal(await page.locator('[data-testid="team-field-type"]').inputValue(), 'tv');
    assert.equal(await page.locator('[data-testid="team-field-age"]').inputValue(), '10+');
    assert.equal(await page.locator('[data-testid="team-field-duration"]').inputValue(), '24 min / épisode');
    assert.match(await page.locator('[data-testid="team-field-genres"]').inputValue(), /Mystère/);
    assert.match(await page.locator('[data-testid="team-field-details-url"]').inputValue(), /^\/tv\/215160$/);
    assert.equal(await page.locator('[data-testid="team-search-result-tv-215160"]').getAttribute('data-selected'), 'true');

    assert.match(await page.locator('[data-testid="team-preview-title"]').innerText(), /Carnets/);
    assert.match(await page.locator('[data-testid="team-preview-description"]').innerText(), /.{600,}/s);
    assert.match(await page.locator('[data-testid="team-preview-cta"]').innerText(), /fiche|Voir/i);
    assert.match(await page.locator('[data-testid="team-dirty"]').innerText(), /non enregistrées/i);

    await screenshot(page, '01-desktop-selection');
    return { overviewLength: overview.length, overflow: await noOverflow(page) };
  });

  await withScenario('titre-original-et-film', {}, async (page) => {
    const search = page.locator('[data-testid="team-search-input"]');
    await search.fill('Dune');
    await page.locator('[data-testid="team-search-result-movie-438631"]').waitFor();
    const card = page.locator('[data-testid="team-search-result-movie-438631"]');
    assert.match(await card.innerText(), /Dune/);
    assert.match(await card.innerText(), /FILM/i);
    await card.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="team-field-duration"]')?.value !== '');
    assert.equal(await page.locator('[data-testid="team-field-duration"]').inputValue(), '155 min');
    assert.equal(await page.locator('[data-testid="team-field-age"]').inputValue(), '12+');
    assert.equal(await page.locator('[data-testid="team-field-type"]').inputValue(), 'movie');

    await search.fill('Kusuriya');
    await page.locator('[data-testid="team-search-result-tv-215160"]').waitFor();
    assert.match(await page.locator('[data-testid="team-search-result-tv-215160"]').innerText(), /Carnets/, 'titre original retrouvé');

    await search.fill('One Piece');
    await page.locator('[data-testid="team-search-result-tv-100088"]').waitFor();
    await page.locator('[data-testid="team-search-result-tv-100088"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="team-field-title"]')?.value === 'One Piece');
    assert.equal(await page.locator('[data-testid="team-field-type"]').inputValue(), 'tv');
    assert.equal(await page.locator('[data-testid="team-field-duration"]').inputValue(), '22 min / épisode');
    await screenshot(page, '02-desktop-original-et-serie');
    return { overflow: await noOverflow(page) };
  });

  await withScenario('edition-apercu-activation-sauvegarde', {}, async (page) => {
    await page.locator('[data-testid="team-field-title"]').fill('Titre modifié à la main');
    await page.locator('[data-testid="team-field-badge"]').fill('NOUVEAU BADGE');
    const longText = `${'Une description très longue et détaillée. '.repeat(30)}Fin.`;
    await page.locator('[data-testid="team-field-description"]').fill(longText);
    await page.locator('[data-testid="team-field-backdrop"]').fill('https://image.tmdb.org/t/p/original/custom.jpg');
    assert.equal(await page.locator('[data-testid="team-preview-title"]').innerText(), 'Titre modifié à la main');
    assert.match(await page.locator('[data-testid="team-preview-badge"]').innerText(), /NOUVEAU BADGE/);
    assert.match(await page.locator('[data-testid="team-preview-description"]').innerText(), /.{600,}/s);

    await page.getByRole('switch').click();
    assert.match(await page.locator('[data-testid="team-status"]').innerText(), /Désactivée/);
    assert.match(await page.locator('[data-testid="team-preview"]').innerText(), /masquée/i);

    await page.locator('[data-testid="team-save"]').click();
    await page.locator('[data-testid="team-saved"]').waitFor();
    const payloads = await page.evaluate(() => window.__savePayloads);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].teamSelection.enabled, false);
    assert.equal(payloads[0].teamSelection.title, 'Titre modifié à la main');
    assert.equal(payloads[0].teamSelection.description, longText);
    assert.ok(payloads[0].teamSelection.description.length > 600);
    assert.equal(await page.locator('[data-testid="team-save"]').isDisabled(), true);

    await page.reload();
    await page.locator('[data-testid="team-heading"]').waitFor();
    assert.equal(await page.locator('[data-testid="team-field-title"]').inputValue(), 'Titre modifié à la main');
    assert.equal(await page.locator('[data-testid="team-field-description"]').inputValue(), longText);
    assert.match(await page.locator('[data-testid="team-status"]').innerText(), /Désactivée/);
    assert.equal(await page.locator('[data-testid="team-save"]').isDisabled(), true);

    await page.getByRole('switch').click();
    await page.locator('[data-testid="team-field-title"]').fill('Temporaire');
    await page.locator('[data-testid="team-reset"]').click();
    assert.equal(await page.locator('[data-testid="team-field-title"]').inputValue(), 'Titre modifié à la main');
    assert.match(await page.locator('[data-testid="team-status"]').innerText(), /Désactivée/);
    await screenshot(page, '03-desktop-sauvegarde');
    return { savedDescriptionLength: longText.length, overflow: await noOverflow(page) };
  });

  await withScenario('erreurs', { init: { 'team-selection-save-error': '1' } }, async (page) => {
    await page.locator('[data-testid="team-field-title"]').fill('Échec contrôlé');
    await page.locator('[data-testid="team-save"]').click();
    await page.locator('[data-testid="team-save-error"]').waitFor();
    assert.match(await page.locator('[data-testid="team-save-error"]').innerText(), /fixture save error|enregistrement/i);
    await screenshot(page, '04-erreur-sauvegarde');
    return { overflow: await noOverflow(page) };
  });

  await withScenario('chargement-en-erreur', { init: { 'team-selection-load-error': '1' }, waitForHeading: false }, async (page) => {
    await page.locator('[data-testid="team-load-error"]').waitFor();
    assert.match(await page.locator('[data-testid="team-load-error"]').innerText(), /impossible|recharg/i);
    await screenshot(page, '05-erreur-chargement');
    return { overflow: await noOverflow(page) };
  });

  await withScenario('recherche-sans-resultat-et-erreur', {}, async (page) => {
    const search = page.locator('[data-testid="team-search-input"]');
    await search.fill('zzzzintrouvable');
    await page.locator('[data-testid="team-search-empty"]').waitFor();
    await search.fill('Dune');
    await page.locator('[data-testid="team-search-result-movie-438631"]').waitFor();
    globalThis.__teamSearchError = true;
    await search.fill('One Piece');
    await page.locator('[data-testid="team-search-error"]').waitFor();
    await screenshot(page, '06-etats-recherche');
    globalThis.__teamSearchError = false;
    return { overflow: await noOverflow(page) };
  });

  await withScenario('mobile', { viewport: { width: 390, height: 844 } }, async (page) => {
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'mobile: pas de défilement horizontal');
    const columns = await page.locator('[data-testid="team-fields-grid"]').evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    assert.equal(columns.split(' ').length, 1, 'mobile: une seule colonne');
    await page.locator('[data-testid="team-search-input"]').fill('Dune');
    await page.locator('[data-testid="team-search-result-movie-438631"]').waitFor();
    await screenshot(page, '07-mobile');
    return { overflow, columns };
  });

  await withScenario('tablette', { viewport: { width: 820, height: 1180 } }, async (page) => {
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'tablette: pas de défilement horizontal');
    await screenshot(page, '08-tablette');
    return { overflow };
  });
} catch (error) {
  runError = error;
} finally {
  await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  command: 'node tests/adminTeamSelection.browser.mjs',
  generatedAt: new Date().toISOString(),
  prerequisites: {
    dependencies: 'Playwright/Chromium, esbuild et tailwindcss via node_modules ou NODE_PATH',
    browser: process.env.CHROMIUM_EXECUTABLE_PATH || 'Chromium Playwright par défaut',
    server: 'Aucun serveur : les appels TMDB et Admin API sont simulés par Playwright route',
  },
  fixtureData: {
    movie: movieResult,
    tv: tvResult,
    overviewLength: longOverview.length,
    savedSelection,
  },
  observations,
  error: runError ? String(runError.stack || runError) : null,
};
await writeFile(path.join(artifactDir, 'admin-team-selection-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(artifactDir, 'REPORT.md'), [
  '# Sélection de l’équipe — E2E refonte',
  '',
  `- Statut : **${report.status}**`,
  `- Commande : \`${report.command}\``,
  `- Prérequis : ${report.prerequisites.dependencies} ; ${report.prerequisites.browser}.`,
  '- Données : film français, titre original, série, synopsis de plus de 600 caractères, classifications FR/US.',
  '',
  '| Scénario | Résultat | Capture |',
  '| --- | --- | --- |',
  ...observations.map((entry) => `| ${entry.name} | ${report.status} | \`${entry.name}.png\` |`),
  '',
  '## Résultats observés',
  '',
  '```json',
  JSON.stringify(observations, null, 2),
  '```',
  '',
  report.error ? `## Erreur\n\n\`\`\`\n${report.error}\n\`\`\`\n` : '',
].join('\n'));

if (runError) {
  console.error(runError);
  process.exitCode = 1;
} else {
  console.log(`${report.status} — ${artifactDir}`);
}
