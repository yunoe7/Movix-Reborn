/**
 * E2E de la refonte de la console d'administration Movix.
 *
 * Vérifie la coque (navigation groupée, recherche, rôles, responsive), le
 * dashboard alimenté uniquement par /api/admin/stats/overview, les états
 * d'erreur, les confirmations harmonisées et le garde-fou AdminPage.
 *
 * Relance :
 *   node tests/adminConsole.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss disponibles via
 * NODE_PATH ou node_modules. L'artefact est écrit dans
 * ADMIN_CONSOLE_ARTIFACT_DIR ou dans un dossier temporaire.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const execFileAsync = promisify(execFile);
const artifactDir = process.env.ADMIN_CONSOLE_ARTIFACT_DIR
  ? path.resolve(process.env.ADMIN_CONSOLE_ARTIFACT_DIR)
  : await mkdtemp(path.join(tmpdir(), 'movix-admin-console-artifacts-'));
const work = path.join(artifactDir, 'fixture');
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const adminDir = path.join(repo, 'src', 'components', 'admin');
const confirmProviderPath = path.join(adminDir, 'AdminConfirmProvider').replace(/\\/g, '/');
const sectionPairs = [
  ['./AdminComments', 'comments', 'Commentaires'],
  ['./AdminHelpFeedback', 'help-feedback', 'Feedback /help'],
  ['./AdminHeroPromos', 'hero-promos', 'Promos du carrousel'],
  ['./AdminMonetizationSettings', 'monetization', 'Monétisation'],
  ['./Greenlight/AdminLinkSubmissions', 'link-submissions', 'Liens soumis'],
  ['./Greenlight/AdminWishboard', 'wishboard', 'Wishboard / Greenlight'],
  ['./AdminOAuthApps', 'oauth-apps', 'Applications OAuth'],
  ['./AdminReferralSettings', 'referral', 'Parrainage'],
  ['./AdminReports', 'reports', 'Signalements'],
  ['./AdminSharedLists', 'shared-lists', 'Listes partagées'],
  ['./AdminTeam', 'team', 'Équipe'],
  ['./AdminVipDonationSettings', 'vip-donation-settings', 'Paramètres VIP'],
  ['./VipInvoicesManager', 'vip-invoices', 'Factures VIP'],
  ['./VipKeysManager', 'vip-keys', 'Clés VIP'],
];

const genericSectionSource = (testId, label) => `
import React from 'react';
export default function AdminSectionStub() {
  return <div data-testid="section-${testId}">${label}</div>;
}
`;

const sectionSources = new Map(sectionPairs.map(([specifier, testId, label]) => [
  specifier,
  genericSectionSource(testId, label),
]));
sectionSources.set('./StreamingLinksManager', `
import React from 'react';
import { useAdminConfirm } from ${JSON.stringify(confirmProviderPath)};

export default function StreamingLinksManagerStub() {
  const { confirm } = useAdminConfirm();
  const [result, setResult] = React.useState('none');
  const remove = async () => {
    const accepted = await confirm({
      title: 'Supprimer',
      message: 'Confirmer la suppression ?',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    setResult(accepted ? 'accepted' : 'cancelled');
  };
  return (
    <div data-testid="section-links">
      <p>Section liens</p>
      <button type="button" data-testid="confirm-trigger" onClick={remove}>Supprimer</button>
      <span data-testid="confirm-result">{result}</span>
    </div>
  );
}
`);

const stubSources = {
  reactI18next: `
const interpolate = (value, options) => typeof value === 'string'
  ? value.replace(/\\{\\{(\\w+)\\}\\}/g, (_, key) => String(options?.[key] ?? ''))
  : value;
const t = (key, options) => {
  if (typeof options === 'string') return interpolate(options, {});
  if (options && typeof options === 'object') {
    return interpolate(options.defaultValue ?? key, options);
  }
  return key;
};
export const useTranslation = () => ({ t, i18n: { language: 'fr' } });
`,
  runtime: `export const MAIN_API = 'https://main-api.test';`,
  api: `export const API_BASE_URL = 'https://main-api.test';`,
  squareBackground: `
export const SquareBackground = ({ children, className }) => (
  <div className={className}>{children}</div>
);
`,
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sectionFilter = new RegExp(`(?:${[...sectionSources.keys()].map(escapeRegex).join('|')})$`);

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AdminDashboard from ${JSON.stringify(path.join(repo, 'src', 'components', 'AdminDashboard').replace(/\\/g, '/'))};
import AdminPage from ${JSON.stringify(path.join(repo, 'src', 'pages', 'AdminPage').replace(/\\/g, '/'))};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="router-location" data-search={location.search} />;
}

function HomeProbe() {
  return <div data-testid="home-page">Accueil public</div>;
}

const params = new URLSearchParams(location.search);
const gateMode = params.get('mode') === 'gate';
const role = params.get('role') || 'admin';
const section = params.get('section');
const initialEntry = section
  ? \`/admin?section=\${encodeURIComponent(section)}\`
  : '/admin';

createRoot(document.getElementById('root')).render(
  gateMode ? (
    <MemoryRouter initialEntries={['/admin']}>
      <LocationProbe />
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/" element={<HomeProbe />} />
      </Routes>
    </MemoryRouter>
  ) : (
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route path="/admin" element={<AdminDashboard role={role} />} />
        <Route path="/" element={<HomeProbe />} />
      </Routes>
    </MemoryRouter>
  )
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
  define: {
    'import.meta.env': JSON.stringify({
      VITE_MAIN_API: 'https://main-api.test',
      VITE_TMDB_API_KEY: 'fixture-key',
    }),
  },
  plugins: [{
    name: 'admin-console-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /^react-i18next$|config\/runtime$|config\/api$|square-background$/,
      }, ({ path: name }) => {
        const key = name === 'react-i18next'
          ? 'reactI18next'
          : name.endsWith('config/runtime')
            ? 'runtime'
            : name.endsWith('config/api')
              ? 'api'
              : 'squareBackground';
        return { path: key, namespace: 'fixture' };
      });
      builder.onResolve({ filter: sectionFilter }, ({ path: name }) => ({
        path: `section:${name}`,
        namespace: 'fixture',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => {
        if (key.startsWith('section:')) {
          return {
            contents: sectionSources.get(key.slice('section:'.length)),
            loader: 'tsx',
            resolveDir: repo,
          };
        }
        return { contents: stubSources[key], loader: 'tsx', resolveDir: repo };
      });
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
const adminCss = await readFile(path.join(adminDir, 'admin-console.css'), 'utf8');
await writeFile(path.join(work, 'app.css'), `${tailwindCss}\n${adminCss}\n`);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const statsForRange = (range) => {
  const fixtures = {
    7: { registrationsInRange: 12, sessionsInRange: 84, avgDau: 12, commentsInRange: 5, vipInRange: 1 },
    30: { registrationsInRange: 42, sessionsInRange: 321, avgDau: 27, commentsInRange: 15, vipInRange: 3 },
    90: { registrationsInRange: 77, sessionsInRange: 910, avgDau: 31, commentsInRange: 49, vipInRange: 8 },
  };
  return {
    range,
    generatedAt: 1764000000000,
    totals: {
      users: 1234,
      byProvider: { TMDB: 900, local: 334 },
      ...fixtures[range],
    },
    registrationsPerDay: [
      { date: '2026-11-19', count: 1 },
      { date: '2026-11-20', count: 2 },
      { date: '2026-11-21', count: 3 },
      { date: '2026-11-22', count: 2 },
      { date: '2026-11-23', count: 4 },
      { date: '2026-11-24', count: 5 },
      { date: '2026-11-25', count: 3 },
    ],
    sessionsPerDay: [
      { date: '2026-11-19', count: 8 },
      { date: '2026-11-20', count: 11 },
      { date: '2026-11-21', count: 14 },
      { date: '2026-11-22', count: 9 },
      { date: '2026-11-23', count: 15 },
      { date: '2026-11-24', count: 17 },
      { date: '2026-11-25', count: 10 },
    ],
    dauPerDay: [
      { date: '2026-11-19', count: 5 },
      { date: '2026-11-20', count: 7 },
      { date: '2026-11-21', count: 9 },
      { date: '2026-11-22', count: 6 },
      { date: '2026-11-23', count: 10 },
      { date: '2026-11-24', count: 12 },
      { date: '2026-11-25', count: 8 },
    ],
    commentsPerDay: [
      { date: '2026-11-19', count: 0 },
      { date: '2026-11-20', count: 1 },
      { date: '2026-11-21', count: 2 },
      { date: '2026-11-22', count: 0 },
      { date: '2026-11-23', count: 3 },
      { date: '2026-11-24', count: 4 },
      { date: '2026-11-25', count: 2 },
    ],
    sharedListsPerDay: [],
    vipPerDay: [
      { date: '2026-11-19', count: 0 },
      { date: '2026-11-20', count: 0 },
      { date: '2026-11-21', count: 1 },
      { date: '2026-11-22', count: 0 },
      { date: '2026-11-23', count: 0 },
      { date: '2026-11-24', count: 1 },
      { date: '2026-11-25', count: 0 },
    ],
  };
};

const adminResponses = {
  'valid-admin': { success: true, admin: { userId: 'u-1', userType: 'local', adminId: 1, role: 'admin' } },
  'valid-owner': { success: true, admin: { userId: 'u-2', userType: 'local', adminId: 2, role: 'owner' } },
  'valid-moderator': { success: true, admin: { userId: 'u-3', userType: 'local', adminId: 3, role: 'moderator' } },
  'valid-uploader': { success: true, admin: { userId: 'u-4', userType: 'local', adminId: 4, role: 'uploader' } },
  'http-ok-false': { success: false, admin: { userId: 'u-5', userType: 'local', adminId: 5, role: 'admin' } },
  'invalid-role': { success: true, admin: { userId: 'u-6', userType: 'local', adminId: 6, role: 'viewer' } },
};

const apiRequests = [];
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});

async function routeFixture(route) {
  const request = route.request();
  const url = new URL(request.url());

  if (url.hostname === 'admin.test') {
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const fixtureFile = path.join(work, name);
    const body = await readFile(fixtureFile).catch(() => null);
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css'
          : 'text/html',
      body: body ?? 'not found',
    });
    return;
  }

  if (url.hostname !== 'main-api.test') {
    await route.fulfill({ status: 404, headers: corsHeaders, body: '{}' });
    return;
  }

  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    return;
  }

  const authorization = request.headers().authorization || null;
  const token = authorization?.replace(/^Bearer\s+/, '') || '';

  if (url.pathname === '/api/admin/check') {
    apiRequests.push({ path: url.pathname, token, authorization });
    const payload = adminResponses[token];
    await route.fulfill({
      status: payload ? 200 : 401,
      headers: corsHeaders,
      json: payload ?? { success: false, error: 'fixture denied' },
    });
    return;
  }

  if (url.pathname === '/api/admin/stats/overview') {
    const range = Number(url.searchParams.get('range') || 30);
    apiRequests.push({ path: url.pathname, token, authorization, range });
    if (token === 'stats-error') {
      await route.fulfill({
        status: 500,
        headers: corsHeaders,
        json: { success: false, error: 'fixture stats failure' },
      });
      return;
    }
    await route.fulfill({ headers: corsHeaders, json: statsForRange(range) });
    return;
  }

  await route.fulfill({ status: 404, headers: corsHeaders, json: { success: false } });
}

const observations = [];
let runError = null;

async function withScenario(name, options, scenario) {
  const {
    token = null,
    role = 'admin',
    section = null,
    gate = false,
    viewport = { width: 1440, height: 900 },
  } = options;
  const context = await browser.newContext({ viewport });
  const startIndex = apiRequests.length;
  await context.addInitScript((initialToken) => {
    window.__nativeConfirmCalls = 0;
    window.confirm = () => {
      window.__nativeConfirmCalls += 1;
      return true;
    };
    if (initialToken) localStorage.setItem('auth_token', initialToken);
  }, token);
  await context.route('**/*', routeFixture);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const params = new URLSearchParams();
  if (gate) params.set('mode', 'gate');
  else {
    params.set('role', role);
    if (section) params.set('section', section);
  }
  const url = `http://admin.test/?${params}`;
  try {
    await page.goto(url);
    const result = await scenario(page);
    assert.deepEqual(errors, [], `${name}: aucune erreur JavaScript`);
    observations.push({
      name,
      url,
      token,
      viewport,
      ...result,
      errors,
      apiRequests: apiRequests.slice(startIndex),
    });
  } finally {
    await context.tracing.stop({ path: path.join(artifactDir, `trace-${name}.zip`) }).catch(() => {});
    await context.close();
  }
}

const compactText = (value) => value.replace(/\s/g, '');
const screenshotName = (name) => `admin-${name}.png`;

try {
  await withScenario('desktop-admin', { token: 'valid-admin' }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    const navIds = await page.locator('[data-testid^="admin-nav-"]').evaluateAll((nodes) => (
      nodes.map((node) => node.dataset.testid.replace('admin-nav-', ''))
    ));
    const expectedNavIds = [
      'overview', 'wishboard', 'link-submissions', 'comments', 'reports', 'shared-lists',
      'links', 'vip-keys', 'vip-invoices', 'vip-donation-settings', 'monetization',
      'hero-promos', 'referral', 'oauth-apps', 'team', 'help-feedback',
    ];
    assert.deepEqual(navIds, expectedNavIds, 'admin: navigation groupée complète');

    const usersText = compactText(await page.locator('[data-testid="admin-stat-users"]').innerText());
    const registrationsText = compactText(await page.locator('[data-testid="admin-stat-registrations"]').innerText());
    assert.ok(usersText.includes('1234'), `admin: total utilisateurs réel (${usersText})`);
    assert.ok(registrationsText.includes('42'), `admin: inscriptions réelles sur 30 jours (${registrationsText})`);
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Admin'));

    await page.getByRole('button', { name: '7 jours' }).click();
    await page.waitForFunction(() => {
      const node = document.querySelector('[data-testid="admin-stat-registrations"]');
      return node && node.textContent?.replace(/\s/g, '').includes('12');
    });
    const chartBars = await page.locator('[aria-label="Inscriptions par jour"] > div').count();
    assert.equal(chartBars, 7, 'admin: graphique alimenté par la série serveur');

    const search = page.locator('[data-testid="admin-search"]');
    await page.locator('h1').first().click();
    await page.keyboard.press('/');
    assert.equal(await search.evaluate((node) => node === document.activeElement), true, 'admin: / focus la recherche');
    await search.fill('vip');
    const options = page.locator('[role="option"]');
    await options.first().waitFor();
    const optionTexts = await options.allInnerTexts();
    assert.ok(optionTexts.some((text) => text.includes('Clés VIP')), 'admin: recherche globale trouve Clés VIP');
    await options.filter({ hasText: 'Clés VIP' }).first().click();
    await page.locator('[data-testid="section-vip-keys"]').waitFor();
    assert.equal(
      await page.locator('[data-testid="router-location"]').getAttribute('data-search'),
      '?section=vip-keys',
      'admin: navigation par recherche met à jour ?section=',
    );

    await search.fill('aucune-section-xyz');
    assert.equal(await page.getByText('Aucune section ne correspond à cette recherche.').count(), 1);

    await page.locator('[data-testid="admin-nav-links"]').click();
    await page.locator('[data-testid="section-links"]').waitFor();
    await page.locator('[data-testid="confirm-trigger"]').click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok((await dialog.innerText()).includes('Confirmer la suppression ?'));
    await dialog.getByRole('button', { name: 'Supprimer' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="confirm-result"]')?.textContent === 'accepted');
    assert.equal(await page.evaluate(() => window.__nativeConfirmCalls), 0, 'admin: aucun confirm() natif');

    const screenshot = screenshotName('desktop-admin');
    await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: true });
    return {
      navIds,
      usersText,
      registrationsText,
      chartBars,
      roleText: 'Admin',
      nativeConfirmCalls: 0,
      screenshot,
    };
  });

  await withScenario('mobile-admin', {
    token: 'valid-admin',
    role: 'admin',
    viewport: { width: 390, height: 844 },
  }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    assert.equal(await page.locator('[data-testid="admin-sidebar"]').isVisible(), false, 'mobile: sidebar repliée');
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
    await page.locator('.admin-drawer').waitFor();
    assert.equal(await page.locator('.admin-drawer [data-testid="admin-nav-links"]').isVisible(), true, 'mobile: drawer utilisable');
    await page.locator('.admin-drawer [data-testid="admin-nav-links"]').click();
    await page.locator('[data-testid="section-links"]').waitFor();
    assert.equal(await page.locator('.admin-drawer').count(), 0, 'mobile: drawer fermé après navigation');
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    assert.ok(overflow <= 1, `mobile: aucun débordement horizontal (${overflow}px)`);
    const screenshot = screenshotName('mobile-admin');
    await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: true });
    return { overflow, screenshot };
  });

  await withScenario('tablet-admin', {
    token: 'valid-admin',
    role: 'admin',
    viewport: { width: 768, height: 1024 },
  }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    assert.ok(overflow <= 1, `tablette: aucun débordement horizontal (${overflow}px)`);
    const screenshot = screenshotName('tablet-admin');
    await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: true });
    return { overflow, screenshot };
  });

  await withScenario('uploader', { token: 'valid-uploader', role: 'uploader' }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    const navIds = await page.locator('[data-testid^="admin-nav-"]').evaluateAll((nodes) => (
      nodes.map((node) => node.dataset.testid.replace('admin-nav-', ''))
    ));
    assert.deepEqual(navIds, ['overview', 'wishboard', 'link-submissions', 'links'], 'uploader: périmètre limité');
    assert.equal(await page.locator('[data-testid="admin-nav-comments"]').count(), 0);
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Uploader'));
    assert.ok(await page.getByText('Accès restreint').count() >= 1, 'uploader: alerte de périmètre');
    const screenshot = screenshotName('uploader');
    await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: true });
    return { navIds, screenshot };
  });

  await withScenario('uploader-forbidden-section', {
    token: 'valid-uploader',
    role: 'uploader',
    section: 'comments',
  }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    assert.equal(await page.locator('[data-testid="section-comments"]').count(), 0);
    assert.equal(
      await page.locator('[data-testid="router-location"]').getAttribute('data-search'),
      '',
      'uploader: section interdite ramenée à overview',
    );
    return { fallback: 'overview' };
  });

  await withScenario('moderator', { token: 'valid-moderator', role: 'moderator' }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    const navIds = await page.locator('[data-testid^="admin-nav-"]').evaluateAll((nodes) => (
      nodes.map((node) => node.dataset.testid.replace('admin-nav-', ''))
    ));
    assert.deepEqual(navIds, ['overview', 'links'], 'moderator: périmètre limité');
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Modérateur'));
    return { navIds };
  });

  await withScenario('stats-error', { token: 'stats-error', role: 'admin' }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    if (process.env.ADMIN_E2E_DEBUG) {
      console.log('[stats-error] overview:', (await page.locator('[data-testid="admin-overview"]').innerText()).slice(0, 600));
      console.log('[stats-error] requests:', JSON.stringify(apiRequests.slice(-2)));
    }
    await page.getByText('Erreur de chargement des statistiques').first().waitFor();
    const usersText = compactText(await page.locator('[data-testid="admin-stat-users"]').innerText());
    assert.ok(usersText.includes('—'), `erreur: aucun chiffre fabriqué (${usersText})`);
    const screenshot = screenshotName('stats-error');
    await page.screenshot({ path: path.join(artifactDir, screenshot), fullPage: true });
    return { usersText, screenshot };
  });

  await withScenario('gate-valid-admin', { token: 'valid-admin', gate: true }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Admin'));
    return { granted: true };
  });

  await withScenario('gate-owner-normalized', { token: 'valid-owner', gate: true }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Admin'));
    return { granted: true, role: 'owner normalisé en admin' };
  });

  await withScenario('gate-valid-uploader', { token: 'valid-uploader', gate: true }, async (page) => {
    await page.locator('[data-testid="admin-overview"]').waitFor();
    assert.ok((await page.locator('[data-testid="admin-role"]').innerText()).includes('Uploader'));
    return { granted: true, role: 'uploader' };
  });

  for (const [name, token] of [
    ['gate-http-ok-false', 'http-ok-false'],
    ['gate-unknown-role', 'invalid-role'],
    ['gate-no-token', null],
  ]) {
    await withScenario(name, { token, gate: true }, async (page) => {
      await page.locator('[data-testid="home-page"]').waitFor();
      assert.equal(await page.locator('[data-testid="admin-overview"]').count(), 0, `${name}: console refusée`);
      return { granted: false };
    });
  }
} catch (error) {
  runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  await browser.close();
}

const staticChecks = {
  statsRouterMounted: (await readFile(path.join(repo, 'API', 'Mainapi', 'app.js'), 'utf8'))
    .includes("app.use('/api/admin/stats', require('./routes/adminStats'))"),
  noNativeConfirmInAdminComponents: Promise.all([
    'src/components/AdminComments.tsx',
    'src/components/Greenlight/AdminLinkSubmissions.tsx',
    'src/components/StreamingLinksManager.tsx',
    'src/components/VipKeysManager.tsx',
  ].map(async (file) => !/window\.confirm\s*\(|(?<!await )confirm\s*\(/.test(
    await readFile(path.join(repo, file), 'utf8'),
  ))).then((results) => results.every(Boolean)),
  vidriftPlayerUntouched: execFileAsync(
    'git',
    ['diff', '--quiet', '--', 'src/components/VidRiftPlayer.tsx'],
    { cwd: repo },
  ).then(() => true, () => false),
};
staticChecks.noNativeConfirmInAdminComponents = await staticChecks.noNativeConfirmInAdminComponents;
staticChecks.vidriftPlayerUntouched = await staticChecks.vidriftPlayerUntouched;

const files = await readdir(artifactDir);
const report = {
  status: runError ? 'FAIL' : 'PASS',
  runError,
  command: 'node tests/adminConsole.browser.mjs',
  prerequisites: {
    dependencies: 'playwright, esbuild, tailwindcss (NODE_PATH ou node_modules)',
    browser: 'Chromium Playwright (CHROMIUM_EXECUTABLE_PATH optionnel)',
    server: 'aucun — fixture esbuild servie via routage Playwright',
    staticChecks: 'contrôles de source ajoutés après le scénario navigateur',
  },
  fixtureData: {
    stats: {
      users: 1234,
      byProvider: { TMDB: 900, local: 334 },
      ranges: {
        7: { registrationsInRange: 12, sessionsInRange: 84, avgDau: 12, commentsInRange: 5, vipInRange: 1 },
        30: { registrationsInRange: 42, sessionsInRange: 321, avgDau: 27, commentsInRange: 15, vipInRange: 3 },
        90: { registrationsInRange: 77, sessionsInRange: 910, avgDau: 31, commentsInRange: 49, vipInRange: 8 },
      },
    },
    checkTokens: Object.fromEntries(Object.entries(adminResponses).map(([token, value]) => [token, value.admin.role])),
  },
  expected: {
    adminNavIds: 16,
    uploaderNavIds: ['overview', 'wishboard', 'link-submissions', 'links'],
    moderatorNavIds: ['overview', 'links'],
    statsSource: 'GET /api/admin/stats/overview uniquement',
    deniedGates: ['success=false avec HTTP 200', 'rôle inconnu', 'aucun token'],
  },
  staticChecks,
  observations,
  artifacts: files,
};
await writeFile(path.join(artifactDir, 'admin-console-report.json'), `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# E2E — Refonte console admin Movix',
  '',
  `- Statut : **${report.status}**`,
  `- Commande : \`${report.command}\``,
  `- Prérequis : ${report.prerequisites.dependencies} ; ${report.prerequisites.browser} ; ${report.prerequisites.server}.`,
  `- Données : statistiques fixture ci-dessous ; tokens de contrôle factices (aucun secret).`,
  '',
  '## Données utilisées',
  '',
  '```json',
  JSON.stringify(report.fixtureData, null, 2),
  '```',
  '',
  '## Résultats attendus et observés',
  '',
  '| Scénario | Résultat | Observations |',
  '| --- | --- | --- |',
  ...observations.map((entry) => {
    const summary = Object.entries(entry)
      .filter(([key]) => ['navIds', 'usersText', 'registrationsText', 'overflow', 'fallback', 'granted', 'role', 'nativeConfirmCalls'].includes(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ; ');
    return `| ${entry.name} | ${summary || 'ok'} | ${entry.screenshot ?? `trace-${entry.name}.zip`} |`;
  }),
  '',
  '## Contrôles statiques',
  '',
  ...Object.entries(staticChecks).map(([key, value]) => `- ${key}: ${value ? 'OK' : 'ÉCHEC'}`),
  '',
  '## Artefacts',
  '',
  ...files.map((file) => `- ${file}`),
  '',
  '## Relance',
  '',
  '```powershell',
  "$env:NODE_PATH = '<checkout contenant playwright>'",
  'node tests/adminConsole.browser.mjs',
  '```',
  '',
  runError ? `Erreur : ${runError}` : 'Aucune erreur navigateur ni assertion en échec.',
  '',
].join('\n');
await writeFile(path.join(artifactDir, 'REPORT.md'), markdown);

console.log(`${report.status} — ${artifactDir}`);
if (runError) {
  console.error(runError);
  process.exitCode = 1;
}
