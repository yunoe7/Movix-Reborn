/**
 * Contrôle navigateur final, sans serveur de dev, compte ni production.
 *
 * Relance : node tests/finalVisual.browser.mjs
 * Prérequis : playwright-core + Chrome local, esbuild et tailwindcss installés.
 *
 * Monte les vrais Header, SearchContext, HLSPlayer et HLSPlayerSettingsPanel
 * dans une fixture locale. TMDB et les images sont simulés. Produit des captures
 * et un rapport dans movix-artifacts/final-visual.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoPosix = repo.replace(/\\/g, '/');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const work = await mkdtemp(path.join(tmpdir(), 'movix-final-visual-'));
const artifactDir = process.env.VISUAL_E2E_ARTIFACT_DIR
  || path.resolve(repo, '..', 'movix-artifacts', 'final-visual');
await mkdir(artifactDir, { recursive: true });

const src = (file) => JSON.stringify(`${repoPosix}/src/${file}`);
const mocks = {
  ProfileContext: `
    import React from 'react';
    export const useProfile = () => ({ currentProfile: null, profiles: [], isLoading: false });
    export const ProfileProvider = ({ children }) => React.createElement(React.Fragment, null, children);
  `,
  ProfileMenu: 'export default () => null;',
  NotificationsPopup: 'export default () => null;',
  apiNotificationService: 'export const getUnreadNotificationsCount=async()=>0; export const getNotificationsDisabled=async()=>false;',
  authUtils: 'export const isUserVip=()=>false;',
  vipUtils: 'export const checkVipStatus=async()=>false; export const getVipHeaders=()=>({});',
  useAgeRestrictedContent: 'export const useAgeRestrictedContent=items=>({items});',
  registry: 'export const ROUTES=[]; export const isHiddenOnTv=()=>false;',
};

const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {MemoryRouter} from 'react-router-dom';
  import i18next from 'i18next';
  import {I18nextProvider} from 'react-i18next';
  import {LightModeProvider} from ${src('context/LightModeContext')};
  import Header from ${src('components/Header')};
  import {SearchProvider} from ${src('context/SearchContext')};
  import HLSPlayer from ${src('components/HLSPlayer')};
  import fr from ${src('i18n/locales/fr.json')};
  import '@fontsource/inter/400.css';
  import '@fontsource/inter/500.css';
  import '@fontsource/inter/600.css';
  import '@fontsource/inter/700.css';
  import '@fontsource/inter/800.css';
  import '@fontsource/inter/900.css';

  function App() {
    return <>
      <Header />
      <main style={{paddingTop: 110, paddingBottom: 40}}>
        <section data-visual="player" style={{maxWidth: 900, margin: '0 auto'}}>
          <h2>Lecteur vidéo</h2>
          <div className="player-frame" style={{height: 360, background: '#111'}}>
            <HLSPlayer src="" autoPlay={false} controls />
          </div>
        </section>
        <section data-visual="quality" style={{maxWidth: 900, margin: '32px auto'}}>
          <h2>Réglages du lecteur</h2>
          <HLSPlayer
            src="fixture://media/source-a.mp4"
            autoPlay={false}
            onlyQualityMenu
            mp4Sources={[
              {url: 'fixture://media/source-a.mp4', label: '1080p', language: 'FR'},
              {url: 'fixture://media/source-b.mp4', label: '720p', language: 'FR'},
            ]}
          />
        </section>
      </main>
    </>;
  }

  await i18next.init({lng: 'fr', resources: {fr: {translation: fr}}, interpolation: {escapeValue: false}});
  createRoot(document.getElementById('root')).render(
    <MemoryRouter><I18nextProvider i18n={i18next}><LightModeProvider><SearchProvider><App /></SearchProvider></LightModeProvider></I18nextProvider></MemoryRouter>
  );
`;

await writeFile(path.join(work, 'entry.tsx'), entry);
await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'app.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MAIN_API: 'http://visual.test',
      VITE_PROXIES_EMBED_API: 'http://visual.test/proxy',
      VITE_SITE_URL: 'http://visual.test',
      VITE_TMDB_API_KEY: 'fixture-key',
    }),
  },
  loader: {
    '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl',
    '.jpg': 'dataurl', '.jpeg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl',
  },
  plugins: [{
    name: 'final-visual-mocks',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const basename = args.path.split('/').pop();
        if (Object.prototype.hasOwnProperty.call(mocks, basename)) {
          return { path: basename, namespace: 'final-visual-fixture' };
        }
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'final-visual-fixture' }, (args) => ({
        contents: mocks[args.path],
        loader: 'tsx',
        resolveDir: repo,
      }));
    },
  }],
});

await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
execFileSync(process.execPath, [
  path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'),
  '-i', path.join(work, 'base.css'),
  '-o', path.join(work, 'ui.css'),
  '--content', [
    'src/components/Header.tsx',
    'src/components/header/*.tsx',
    'src/components/HLSPlayer.tsx',
    'src/components/HLSPlayerSettingsPanel.tsx',
    'src/components/LikeDislikeButton.tsx',
    'src/components/ui/PinButton.tsx',
    'src/components/ui/counter.tsx',
  ].join(','),
], { cwd: repo, stdio: 'pipe' });

await writeFile(path.join(work, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body style="margin:0;background:#050505;color:#fff;font-family:Inter,sans-serif"><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);

const chromePath = process.env.VISUAL_E2E_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const results = [];
let failure = null;

async function open(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 }, hasTouch: Boolean(options.touch) });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'visual.test') {
      const name = url.pathname.slice(1) || 'index.html';
      const contentType = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      let body;
      try {
        body = await readFile(path.join(work, name));
      } catch {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
        return;
      }
      await route.fulfill({ contentType, body });
      return;
    }
    if (url.hostname === 'api.themoviedb.org') {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: {
          results: [{
            id: 42,
            media_type: 'movie',
            title: 'Film visuel',
            poster_path: '/poster.jpg',
            overview: 'Résumé local',
            popularity: 99,
            vote_average: 8,
            release_date: '2024-01-01',
          }],
        },
      });
      return;
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('https://visual.test/index.html');
  await page.waitForSelector('header');
  return { context, page, pageErrors };
}

try {
  {
    const { context, page, pageErrors } = await open();
    await page.evaluate(() => document.fonts.ready);

    const headerBox = await page.locator('header').boundingBox();
    assert.ok(headerBox && headerBox.width >= 1200, 'le header desktop doit occuper la largeur');
    assert.ok((await page.locator('header a[href="/"]').count()) >= 1, 'le logo doit être présent');

    const fonts = await page.evaluate(() => ({
      regular: document.fonts.check('400 16px Inter'),
      semibold: document.fonts.check('600 16px Inter'),
      black: document.fonts.check('900 16px Inter'),
      family: getComputedStyle(document.body).fontFamily,
    }));
    assert.ok(fonts.regular && fonts.semibold && fonts.black, 'les weights Inter 400/600/900 doivent être disponibles');
    assert.match(fonts.family, /Inter/, 'le corps doit utiliser Inter');

    await page.screenshot({ path: path.join(artifactDir, 'header-desktop.png') });
    results.push({
      cas: 'Header desktop et polices Inter',
      attendu: { headerLarge: true, logo: true, inter400_600_900: true },
      observe: { largeurHeader: headerBox?.width, logo: await page.locator('header a[href="/"]').count(), fonts, erreursPage: pageErrors },
    });

    const trigger = page.getByRole('button', { name: 'Rechercher un film, une série...' }).first();
    await trigger.click();
    const field = page.locator('header input[type="text"]').first();
    await field.waitFor({ state: 'visible' });
    await field.pressSequentially('Film', { delay: 100 });
    const suggestion = page.getByRole('button', { name: /Film visuel/ }).first();
    await suggestion.waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(artifactDir, 'autocomplete-desktop.png') });
    results.push({
      cas: 'Autocomplete desktop',
      attendu: { suggestionVisible: true },
      observe: { suggestionVisible: await suggestion.isVisible(), erreursPage: pageErrors },
    });

    const video = page.locator('[data-visual="player"] video').first();
    await video.waitFor({ state: 'attached' });
    const qualityMenu = page.locator('[data-visual="quality"] [data-source-menu]').first();
    await qualityMenu.waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-visual="quality"]').screenshot({ path: path.join(artifactDir, 'player-settings.png') });
    await page.screenshot({ path: path.join(artifactDir, 'player-desktop.png'), fullPage: true });
    results.push({
      cas: 'Lecteur vidéo et réglages du lecteur',
      attendu: { videoMonte: true, menuSourcesVisible: true },
      observe: { videoMonte: await video.count(), menuSourcesVisible: await qualityMenu.isVisible(), erreursPage: pageErrors },
    });
    await context.close();
  }

  {
    const { context, page, pageErrors } = await open({ viewport: { width: 390, height: 844 }, touch: true });
    const trigger = page.getByRole('button', { name: 'Rechercher un film, une série...' }).first();
    await trigger.tap();
    const field = page.locator('header input[type="text"]').first();
    await field.waitFor({ state: 'visible' });
    await field.pressSequentially('Film', { delay: 100 });
    await page.screenshot({ path: path.join(artifactDir, 'header-mobile.png') });
    const visible = await field.isVisible();
    const box = await field.boundingBox();
    assert.ok(visible && box && box.width > 100, 'le champ mobile doit être visible et utilisable');
    results.push({
      cas: 'Header mobile',
      attendu: { champRechercheVisible: true },
      observe: { visible, largeur: box?.width, erreursPage: pageErrors },
    });
    await context.close();
  }

  console.log('OK: header desktop/mobile, autocomplete, Inter, lecteur et réglages');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify({
    commande: 'node tests/finalVisual.browser.mjs',
    date: new Date().toISOString(),
    prerequis: ['playwright-core disponible localement', 'Chrome local', 'esbuild et tailwindcss installés'],
    donnees: 'Header, SearchContext, HLSPlayer et HLSPlayerSettingsPanel réels ; TMDB et images simulés ; aucun compte ni secret',
    limites: 'Fixture isolée : la route WatchMovie complète et le SDK Cast réel ne sont pas montés',
    resultats: results,
    echec: failure,
    succes: failure === null,
  }, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}
