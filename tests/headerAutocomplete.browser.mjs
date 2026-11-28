/**
 * E2E navigateur ciblé de l'autocomplete du header et de SearchContext.
 *
 * Relance : node tests/headerAutocomplete.browser.mjs
 * Prérequis : playwright-core + Chrome local (comme syncReliability.browser.mjs).
 * Aucun serveur de dev, aucun compte ni appel réel : TMDB est simulé.
 *
 * Couvre :
 *  - debounce 300 ms du header (une seule requête pour une frappe rapide) ;
 *  - annulation du timer sur Enter / clic extérieur (aucune requête fantôme) ;
 *  - garde de séquence de SearchContext (réponse lente ignorée, spinner éteint) ;
 *  - nettoyage explicite des suggestions pendant une requête en vol.
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
const work = await mkdtemp(path.join(tmpdir(), 'movix-autocomplete-'));
const artifactDir = process.env.AUTOCOMPLETE_E2E_ARTIFACT_DIR
  || path.resolve(repo, '..', 'movix-artifacts', 'header-autocomplete');

const headerMocks = {
  ProfileMenu: 'export default () => null;',
  NotificationsPopup: 'export default () => null;',
  apiNotificationService: 'export const getUnreadNotificationsCount=async()=>0; export const getNotificationsDisabled=async()=>false;',
  authUtils: 'export const isUserVip=()=>false;',
  vipUtils: 'export const checkVipStatus=async()=>false;',
  SearchContext: `
    import React, {createContext, useCallback, useContext, useState} from 'react';
    const Ctx = createContext(null);
    const calls = [];
    window.__calls = calls;
    window.__clears = 0;
    window.__resetCalls = () => { calls.length = 0; };
    export const SearchProvider = ({children}) => {
      const [suggestions, setSuggestions] = useState([]);
      const [loading, setLoading] = useState(false);
      window.__resolveSuggestions = (items) => { setSuggestions(items); setLoading(false); };
      const fetch = useCallback((query) => {
        calls.push(query);
        setLoading(true);
        setSuggestions([{ id: 99, media_type: 'movie', title: 'Suggestion', poster_path: null, overview: '' }]);
      }, []);
      const clear = useCallback(() => {
        setSuggestions([]);
        setLoading(false);
        window.__clears += 1;
      }, []);
      return <Ctx.Provider value={{autocompleteSuggestions:suggestions, loadingAutocomplete:loading, fetchAutocompleteSuggestions:fetch, clearAutocompleteSuggestions:clear}}>{children}</Ctx.Provider>;
    };
    export const useSearch = () => useContext(Ctx);
  `,
  useAgeRestrictedContent: 'export const useAgeRestrictedContent=items=>({items});',
  registry: 'export const ROUTES=[];',
};

const searchMocks = {
  i18n: "export const getTmdbLanguage=()=> 'fr-FR'; export default {t:key=>key, language:'fr'};",
  mediaSearchIndex: 'export const searchIndexedMedia=()=>[];',
  tmdbKeywords: 'export const fetchTmdbMediaKeywordIds=async()=>[]; export const searchTmdbKeywords=async()=>[];',
  searchResultFilters: 'export const hasUsefulContent=()=>true; export const isReleased=()=>true;',
};

const headerEntry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {BrowserRouter,useLocation} from 'react-router-dom';
  import i18next from 'i18next';
  import {I18nextProvider} from 'react-i18next';
  import {LightModeProvider} from ${JSON.stringify(repoPosix + '/src/context/LightModeContext')};
  import Header from ${JSON.stringify(repoPosix + '/src/components/Header')};
  import {SearchProvider} from ${JSON.stringify(repoPosix + '/src/context/SearchContext')};
  import fr from ${JSON.stringify(repoPosix + '/src/i18n/locales/fr.json')};
  import ${JSON.stringify(repoPosix + '/src/styles/light-mode.css')};
  await i18next.init({lng:'fr',resources:{fr:{translation:fr}}});
  function Fixture() {
    const location=useLocation();
    return <><Header/><main style={{paddingTop:100,minHeight:1500}}>
      <output id="route">{location.pathname + location.search}</output>
      <button id="outside" style={{position:'fixed',bottom:10,right:10}}>Outside</button>
    </main></>;
  }
  createRoot(document.getElementById('root')).render(
    <React.StrictMode><I18nextProvider i18n={i18next}><BrowserRouter><LightModeProvider><SearchProvider><Fixture/></SearchProvider></LightModeProvider></BrowserRouter></I18nextProvider></React.StrictMode>
  );
`;

const searchEntry = `
  import React, {useEffect} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SearchProvider,useSearch} from ${JSON.stringify(repoPosix + '/src/context/SearchContext')};
  function Probe() {
    const search = useSearch();
    useEffect(() => {
      window.__state = {
        suggestions: search.autocompleteSuggestions.map(item => item.title),
        loading: search.loadingAutocomplete,
      };
    }, [search.autocompleteSuggestions, search.loadingAutocomplete]);
    window.__search = search;
    return <output id="state">{JSON.stringify(window.__state || {})}</output>;
  }
  createRoot(document.getElementById('root')).render(<SearchProvider><Probe/></SearchProvider>);
`;

async function buildCase(name, entry, mocks) {
  const entryPath = path.join(work, `${name}.tsx`);
  await writeFile(entryPath, entry);
  await build({
    entryPoints: [entryPath],
    outfile: path.join(work, `${name}.js`),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    nodePaths: [path.join(repo, 'node_modules')],
    alias: { '@': path.join(repo, 'src') },
    define: { 'import.meta.env': '{}' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl' },
    plugins: [{ name: `fixture-${name}`, setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        const basename = args.path.split('/').pop();
        if (Object.prototype.hasOwnProperty.call(mocks, basename)) {
          return { path: basename, namespace: 'fixture' };
        }
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
        contents: mocks[args.path],
        loader: 'tsx',
        resolveDir: repo,
      }));
    } }],
  });
  await writeFile(
    path.join(work, `${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body style="background:#000;color:white"><div id="root"></div><script type="module" src="/${name}.js"></script></body></html>`
  );
}

await buildCase('header', headerEntry, headerMocks);
await buildCase('search', searchEntry, searchMocks);
await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
execFileSync(process.execPath, [path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'), '-i', path.join(work, 'base.css'), '-o', path.join(work, 'ui.css'),
  '--content', 'src/components/Header.tsx,src/components/header/*.tsx,src/components/ui/hover-highlight.tsx',
], { cwd: repo, stdio: 'pipe' });

const chromePath = process.env.AUTOCOMPLETE_E2E_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ headless: true, executablePath: chromePath });

async function open(caseName, routeTmdb) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'autocomplete.test') {
      const name = url.pathname.slice(1) || 'header.html';
      const file = path.join(work, name);
      const contentType = name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css' : 'text/html';
      let body;
      try {
        body = await readFile(file);
      } catch {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
        return;
      }
      await route.fulfill({ contentType, body });
      return;
    }
    if (url.hostname === 'api.themoviedb.org' && routeTmdb) {
      const query = url.searchParams.get('query') || '';
      const language = url.searchParams.get('language') || '';
      const slow = query === 'slow';
      await new Promise((resolve) => setTimeout(resolve, slow ? 420 : 20));
      const primary = language === 'fr-FR';
      await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: {
        results: primary ? [{
          id: slow ? 1 : 2,
          media_type: 'movie',
          title: slow ? 'SLOW' : 'FAST',
          poster_path: '/poster.jpg',
          overview: 'Résumé',
          popularity: 10,
        }] : [],
      } });
      return;
    }
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://autocomplete.test/${caseName}.html`);
  return { context, page, errors };
}

await mkdir(artifactDir, { recursive: true });
const results = [];
let failure = null;

try {
  {
    const { context, page, errors } = await open('header');
    const openSearch = async () => {
      const trigger = page.getByRole('button', { name: 'Rechercher un film, une série...' }).first();
      await trigger.click();
      const field = page.locator('header input[type="text"]').first();
      await field.waitFor({ state: 'visible' });
      return field;
    };
    let field = await openSearch();

    await field.pressSequentially('Film', { delay: 100 });
    await page.waitForTimeout(600);
    const debounceCalls = await page.evaluate(() => window.__calls);
    assert.deepEqual(debounceCalls, ['Film'], 'une frappe rapide ne doit déclencher qu une requête');

    await field.fill('');
    await page.evaluate(() => window.__resetCalls());
    await field.pressSequentially('Matrix', { delay: 20 });
    await field.press('Enter');
    await page.waitForTimeout(450);
    const afterEnterCalls = await page.evaluate(() => window.__calls);
    const route = await page.locator('#route').textContent();
    const clearsAfterEnter = await page.evaluate(() => window.__clears);
    assert.deepEqual(afterEnterCalls, [], 'Enter doit annuler le timer de debounce');
    assert.equal(route, '/search?q=Matrix');
    assert.ok(clearsAfterEnter >= 1, 'Enter doit effacer les suggestions');

    await page.evaluate(() => window.__resetCalls());
    field = await openSearch();
    await field.fill('');
    await page.evaluate(() => window.__resetCalls());
    await field.pressSequentially('Paris', { delay: 20 });
    await page.locator('#outside').click();
    await page.waitForTimeout(450);
    const afterOutsideCalls = await page.evaluate(() => window.__calls);
    assert.deepEqual(afterOutsideCalls, [], 'un clic extérieur doit annuler le timer');
    assert.deepEqual(errors, [], errors);
    await page.screenshot({ path: path.join(artifactDir, 'header.png') });
    results.push({
      cas: 'header debounce et annulation',
      attendu: { debounce: ['Film'], apresEntree: [], route: '/search?q=Matrix', apresClicExterieur: [] },
      observe: { debounce: debounceCalls, apresEntree: afterEnterCalls, route, apresClicExterieur: afterOutsideCalls, clears: clearsAfterEnter, erreursConsole: errors },
    });
    await context.close();
  }

  {
    const { context, page, errors } = await open('search', true);
    await page.waitForFunction(() => Boolean(window.__search));

    await page.evaluate(() => {
      void window.__search.fetchAutocompleteSuggestions('slow');
      void window.__search.fetchAutocompleteSuggestions('fast');
    });
    await page.waitForTimeout(800);
    const latestState = await page.evaluate(() => window.__state);
    let state = latestState;
    assert.deepEqual(state.suggestions, ['FAST'], 'la réponse lente ne doit pas écraser la plus récente');
    assert.equal(state.loading, false, 'le spinner doit être éteint après la réponse courante');

    await page.evaluate(() => {
      void window.__search.fetchAutocompleteSuggestions('slow');
      window.__search.clearAutocompleteSuggestions();
    });
    await page.waitForTimeout(800);
    state = await page.evaluate(() => window.__state);
    assert.deepEqual(state.suggestions, [], 'un clear doit rester vide malgré une réponse tardive');
    assert.equal(state.loading, false, 'un clear doit éteindre le spinner');
    assert.deepEqual(errors, [], errors);
    await page.screenshot({ path: path.join(artifactDir, 'search-context.png') });
    results.push({
      cas: 'ordre des réponses et clear SearchContext',
      attendu: { apresReponses: { suggestions: ['FAST'], chargement: false }, apresClear: { suggestions: [], chargement: false } },
      observe: { apresReponses: { suggestions: latestState.suggestions, chargement: latestState.loading }, apresClear: { suggestions: state.suggestions, chargement: state.loading }, erreursConsole: errors },
    });
    await context.close();
  }

  console.log('OK: debounce header, annulation Enter/clic extérieur, ordre des réponses et clear SearchContext');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await browser.close();
  await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify({
    commande: 'node tests/headerAutocomplete.browser.mjs',
    date: new Date().toISOString(),
    prerequis: ['playwright-core disponible localement', 'Chrome local', 'esbuild et tailwindcss installés'],
    donnees: 'Header et SearchContext réels, SearchContext/API TMDB simulés, aucun compte ni secret',
    resultats: results,
    echec: failure,
    succes: failure === null,
  }, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}
