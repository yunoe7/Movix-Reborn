/**
 * E2E de la refonte de la page Profil / Mon compte Movix.
 *
 * Vérifie le rendu desktop et mobile, les contrastes, le sélecteur d'avatars,
 * les onglets et leurs compteurs, les actions du profil (renommage, liens,
 * retirer/annuler) et la carte de parrainage (copier, partager, saisir un code).
 * La fixture est compilée avec esbuild et servie par routage Playwright : aucun
 * serveur de développement n'est lancé.
 *
 * Relance :
 *   node tests/profileRedesign.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss. Sur ce poste,
 *   $env:NODE_PATH='<workspace>\node_modules' rend Playwright disponible.
 * L'artefact est écrit dans PROFILE_REDESIGN_ARTIFACT_DIR ou dans
 * <workspace>/../movix-artifacts/profile-redesign.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  throw new Error('Playwright introuvable : définir NODE_PATH vers un node_modules qui contient playwright.');
}

const artifactDir = process.env.PROFILE_REDESIGN_ARTIFACT_DIR
  ? path.resolve(process.env.PROFILE_REDESIGN_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'profile-redesign');
const work = path.join(artifactDir, 'fixture');
await rm(artifactDir, { recursive: true, force: true });
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const fr = JSON.parse(await readFile(path.join(repo, 'src/i18n/locales/fr.json'), 'utf8'));
const en = JSON.parse(await readFile(path.join(repo, 'src/i18n/locales/en.json'), 'utf8'));

const importPath = (relative) => JSON.stringify(path.join(repo, 'src', relative).replace(/\\/g, '/'));
const uiPath = importPath('components/profile/ui');
const iconsPath = importPath('components/icons/Icons8');

const i18nStub = `
const translations = ${JSON.stringify(fr)};
const interpolate = (value, options) => typeof value === 'string'
  ? value.replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(options?.[name] ?? ''))
  : value;
const lookup = (key) => key.split('.').reduce(
  (value, part) => (value && typeof value === 'object' ? value[part] : undefined),
  translations,
);
const t = (key, options) => {
  if (typeof options === 'string') return interpolate(options, {});
  const raw = lookup(key) ?? options?.defaultValue ?? key;
  return interpolate(typeof raw === 'string' ? raw : key, options ?? {});
};
export const useTranslation = () => ({ t, i18n: { language: 'fr' } });
`;

const stubSources = {
  reactI18next: i18nStub,
  prefetchLink: `
import React from 'react';
import { Link } from 'react-router-dom';
export const PrefetchLink = ({ to, children, ...props }) => (
  <Link to={typeof to === 'string' ? to : '/'} {...props}>{children}</Link>
);
`,
  profileContext: `
import React from 'react';
const state = {
  profile: {
    id: 'p-1',
    name: 'Alex Martin',
    avatar: '/avatars/disney/disney_avatar_1.png',
    createdAt: '2022-05-01T00:00:00Z',
  },
};
export const useProfile = () => {
  const [, force] = React.useState(0);
  return {
    currentProfile: state.profile,
    profiles: [state.profile, { id: 'p-2', name: 'Enfant', avatar: '', createdAt: '2024-01-01T00:00:00Z' }],
    updateProfile: async (id, patch) => {
      window.__profileUpdates.push({ id, patch });
      state.profile = { ...state.profile, ...patch };
      force((value) => value + 1);
      window.dispatchEvent(new Event('storage'));
    },
  };
};
`,
  accountAuth: `
export const getResolvedAccountProvider = () => 'google';
export const getResolvedAccountContext = () => ({ userType: 'oauth', userId: 'u-1' });
`,
  authUtils: `
export const isUserAuthenticated = () => true;
export const isUserVip = () => localStorage.getItem('fixture_vip') === '1';
`,
  alertService: `export const AlertService = { getAllAlerts: () => ({}) };`,
  sonner: `
const host = () => {
  let node = document.getElementById('fixture-toasts');
  if (!node) {
    node = document.createElement('div');
    node.id = 'fixture-toasts';
    document.body.appendChild(node);
  }
  return node;
};
const render = (level, message, options) => {
  window.__toasts.push({ level, message, actionLabel: options?.action?.label });
  const row = document.createElement('div');
  row.dataset.testid = 'toast';
  row.dataset.level = level;
  row.textContent = String(message);
  if (options?.action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = 'toast-action';
    button.textContent = options.action.label;
    button.addEventListener('click', options.action.onClick);
    row.appendChild(button);
  }
  host().appendChild(row);
};
export const toast = Object.assign(
  (message, options) => render('default', message, options),
  {
    success: (message, options) => render('success', message, options),
    error: (message, options) => render('error', message, options),
  },
);
`,
  filterSystem: `
import React from 'react';
export default function FilterSystem() {
  return <div data-testid="filter-system" />;
}
`,
  useOptimizedFilter: `
const updateFilters = () => {};
export function useOptimizedFilter({ items }) {
  return {
    filteredItems: items,
    stats: { filtered: items.length },
    isSorting: false,
    updateFilters,
  };
}
`,
  useProfileLibrary: `
import React from 'react';
const initial = {
  watchlist: [
    { id: 101, type: 'movie', title: 'Film à voir', poster_path: '/poster-a.jpg', addedAt: '2026-11-20T10:00:00Z' },
    { id: 102, type: 'tv', title: 'Série à voir', poster_path: '/poster-b.jpg', addedAt: '2026-11-21T10:00:00Z' },
    { id: 103, type: 'collection', title: 'Saga à voir', poster_path: '/poster-c.jpg', addedAt: '2026-11-22T10:00:00Z' },
  ],
  favorites: [
    { id: 201, type: 'movie', title: 'Film favori', poster_path: '/poster-d.jpg', addedAt: '2026-11-10T10:00:00Z' },
  ],
  watched: [
    { id: 301, type: 'movie', title: 'Film vu', poster_path: '/poster-e.jpg', addedAt: '2026-11-01T10:00:00Z' },
  ],
};
export function useProfileLibrary() {
  const [lists, setLists] = React.useState(initial);
  const removeItem = (item, listType) => {
    setLists((prev) => ({ ...prev, [listType]: prev[listType].filter((entry) => entry.id !== item.id) }));
    return () => setLists((prev) => ({ ...prev, [listType]: [...prev[listType], item] }));
  };
  return { ...lists, loading: false, removeItem };
}
`,
  useCustomLists: `
export function useCustomLists() {
  return {
    lists: [{ id: 'l-1', name: 'Ma liste', items: [], isPublic: false }],
    saveLists: () => {},
    loading: false,
  };
}
`,
  useResumeItem: `
export function useResumeItem() {
  const none = new URLSearchParams(location.search).get('resume') === 'none';
  return {
    loading: false,
    item: none ? null : {
      id: 401,
      type: 'tv',
      title: 'Dune : Prophétie',
      backdrop: '/backdrop.jpg',
      poster: '/poster-f.jpg',
      season: 1,
      episode: 4,
      progress: 42,
      remainingMinutes: 91,
      watchPath: '/watch/tv/401?season=1&episode=4',
      detailsPath: '/tv/401',
    },
  };
}
`,
  storage: `
export function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export function backdropUrl(value, width) {
  return value ? \`/tmdb/backdrop\${width}\${value}\` : '';
}
export function posterUrl(value) {
  return value ? \`/tmdb/poster\${value}\` : '';
}
export function getWatchItemKey(item) {
  return \`\${item.type}-\${item.id}\`;
}
export function getWatchItemTitle(item) {
  return item.name || item.title || 'Sans titre';
}
export function isTmdbWatchItem(item) {
  return ['movie', 'tv', 'collection'].includes(item.type);
}
export async function fetchTmdb() {
  return null;
}
`,
  axios: `
const empty = { data: {} };
export default {
  get: async () => ({ data: { shared: {} } }),
  post: async () => empty,
  delete: async () => empty,
};
`,
  newListModal: `
import React from 'react';
export default function NewListModal({ onCreateList }) {
  return (
    <div data-testid="new-list-modal">
      <button type="button" data-testid="new-list-create" onClick={() => onCreateList('Liste créée')}>Créer</button>
    </div>
  );
}
`,
  ageRestrictedMedia: `export default function AgeRestrictedMedia({ children }) { return children; }`,
  turnstileWidget: `export default function TurnstileWidget() { return <div data-testid="turnstile-widget" />; }`,
  useTurnstileBypass: `export function useTurnstileBypass() { return 'bypass'; }`,
  turnstileBypass: `export const ADMIN_BYPASS_TOKEN = 'fixture-bypass-token';`,
  turnstileKeys: `export const TURNSTILE_SITE_KEY = '';`,
  alertsTab: `
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from ${iconsPath};
import { EmptyState } from ${uiPath};
export default function AlertsTab() {
  const { t } = useTranslation();
  return (
    <div data-testid="alerts-tab">
      <EmptyState
        icon={<Bell aria-hidden="true" />}
        title={t('profilePage.alerts.noAlerts')}
        description={t('profilePage.emptyStates.noAlertsDesc')}
        action={{ label: t('profilePage.alerts.browseSeries'), to: '/tv-shows' }}
      />
    </div>
  );
}
`,
  historyTab: `export default function HistoryTab() { return <div data-testid="history-tab">Historique</div>; }`,
  sessionsTab: `export default function SessionsTab() { return <div data-testid="sessions-tab">Appareils</div>; }`,
  customListsTab: `
import React from 'react';
export default function CustomListsTab({ lists = [] }) {
  return <div data-testid="custom-lists-tab">Listes : {lists.length}</div>;
}
`,
  overlayPortal: `export const getOverlayPortalRoot = () => document.body;`,
  i18n: `export const getTmdbLanguage = () => 'fr-FR'; export default { language: 'fr-FR' };`,
  clipboard: `
export async function copyText(text) {
  window.__copied.push(text);
  return true;
}
`,
  referralService: `
const params = new URLSearchParams(location.search);
const mode = params.get('referral');
export function hasAccountSession() { return true; }
export function buildReferralLink(code) { return \`https://movix.test/r/\${code}\`; }
export function formatWatchDuration(minutes) { return \`\${minutes} min\`; }
export function normalizeReferralCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export async function getReferralMe() {
  if (mode === 'off') return { enabled: false };
  return {
    enabled: true,
    code: 'MOVIX7X42',
    rewardDays: 7,
    requiredMinutes: 240,
    requiredDays: 3,
    codeActiveAt: null,
    claimDeadline: null,
    canEnterCode: true,
    stats: { invited: 4, rewarded: 2, daysEarned: 14 },
    referee: mode === 'progress' ? {
      status: 'pending',
      watchMinutes: 120,
      watchDays: 1,
      requiredMinutes: 240,
      requiredDays: 3,
    } : null,
  };
}
export async function claimReferralCode(code) {
  window.__claimedCodes.push(code);
}
export function isDataCollectionAllowed() { return true; }
`,
  referralActions: `
export function describeReferralError() { return 'Erreur de parrainage'; }
export function formatDays(t, days) { return \`\${days} jours\`; }
export function formatDistinctDays(t, days) { return \`\${days} jours distincts\`; }
export function requestReferralRefresh() { window.__referralRefresh += 1; }
`,
  useAgeRestrictedContent: `export function useAgeRestrictedContent(items) { return { items }; }`,
  idEncoder: `export function encodeId(id) { return String(id); }`,
  tvEpisodePanel: `export default function TvEpisodePanel() { return <div data-testid="tv-episode-panel" />; }`,
  runtime: `export const MAIN_API = 'https://main-api.test';`,
};

const stubSuffixes = {
  reactI18next: 'react-i18next',
  prefetchLink: 'PrefetchLink',
  profileContext: 'ProfileContext',
  accountAuth: 'accountAuth',
  authUtils: 'authUtils',
  alertService: 'alertService',
  sonner: 'sonner',
  filterSystem: 'FilterSystem',
  useOptimizedFilter: 'useOptimizedFilter',
  useProfileLibrary: 'useProfileLibrary',
  useCustomLists: 'useCustomLists',
  useResumeItem: 'useResumeItem',
  storage: 'storage',
  axios: 'axios',
  newListModal: 'NewListModal',
  ageRestrictedMedia: 'AgeRestrictedMedia',
  turnstileWidget: 'TurnstileWidget',
  useTurnstileBypass: 'useTurnstileBypass',
  turnstileBypass: 'turnstileBypass',
  turnstileKeys: 'turnstileKeys',
  alertsTab: 'AlertsTab',
  historyTab: 'HistoryTab',
  sessionsTab: 'SessionsTab',
  customListsTab: 'CustomListsTab',
  overlayPortal: 'overlayPortal',
  i18n: 'i18n',
  clipboard: 'clipboard',
  referralService: 'referralService',
  referralActions: 'referralActions',
  useAgeRestrictedContent: 'useAgeRestrictedContent',
  idEncoder: 'idEncoder',
  tvEpisodePanel: 'TvEpisodePanel',
  runtime: 'config/runtime',
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stubPattern = new RegExp(`${Object.values(stubSuffixes).map(escapeRegex).join('|')}$`);
const resolveStubKey = (specifier) => {
  const normalized = String(specifier).replace(/\\/g, '/');
  return Object.keys(stubSuffixes)
    .sort((left, right) => stubSuffixes[right].length - stubSuffixes[left].length)
    .find((key) => normalized.endsWith(stubSuffixes[key]));
};

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Profile from ${importPath('pages/Profile')};
import { avatarCategories } from ${importPath('data/avatars')};
import { platformAvatars, platforms } from ${importPath('data/new_avatars')};

window.__avatarData = {
  classicKeys: Object.keys(avatarCategories),
  classicCount: Object.values(avatarCategories).reduce((total, list) => total + list.length, 0),
  platforms,
  platformCategories: Object.fromEntries(
    platforms.map((platform) => [platform, Object.keys(platformAvatars[platform] || {})]),
  ),
  platformCounts: Object.fromEntries(
    platforms.map((platform) => [
      platform,
      Object.values(platformAvatars[platform] || {}).reduce((sum, list) => sum + list.length, 0),
    ]),
  ),
  platformCount: Object.values(platformAvatars).reduce(
    (total, categories) => total + Object.values(categories).reduce((sum, list) => sum + list.length, 0),
    0,
  ),
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="router-location" data-path={location.pathname} data-search={location.search} />;
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/profile' + location.search]}>
    <LocationProbe />
    <Profile />
  </MemoryRouter>,
);
`;

const polishEntry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import CustomListsTab from ${importPath('components/profile/CustomListsTab')};
import HistoryRowActions from ${importPath('components/profile/HistoryRowActions')};

const initialLists = [
  { id: 1, name: 'Liste vide', items: [] },
  {
    id: 2,
    name: 'Liste remplie',
    items: [
      { type: 'movie', id: 11, title: 'Film A', poster_path: '/poster-a.jpg', name: 'Film A' },
      { type: 'tv', id: 12, title: 'Série B', poster_path: '/poster-b.jpg', name: 'Série B' },
      { type: 'movie', id: 13, title: 'Film C', poster_path: '/poster-c.jpg', name: 'Film C' },
      { type: 'movie', id: 14, title: 'Film D', poster_path: '/poster-d.jpg', name: 'Film D' },
      { type: 'movie', id: 15, title: 'Film E', poster_path: '/poster-e.jpg', name: 'Film E' },
    ],
  },
];

function PolishHarness() {
  const [lists, setLists] = React.useState(initialLists);
  return (
    <main className="profile-console mx-auto w-full max-w-[1100px] px-4 py-6" data-testid="polish-harness">
      <div data-testid="custom-lists-harness">
        <CustomListsTab lists={lists} saveLists={setLists} loading={false} />
      </div>
      <div style={{ position: 'fixed', top: 8, right: 8 }}>
        <span data-testid="edge-menu-trigger">
          <HistoryRowActions
            rowKey="movie-11"
            title="Film A"
            actions={['markMovie']}
            onAction={() => {}}
            onDelete={() => {}}
          />
        </span>
      </div>
      <div style={{ position: 'fixed', bottom: 8, right: 8 }}>
        <span data-testid="bottom-menu-trigger">
          <HistoryRowActions
            rowKey="movie-12"
            title="Film B"
            actions={['unmark']}
            onAction={() => {}}
            onDelete={() => {}}
          />
        </span>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/polish']}>
    <PolishHarness />
  </MemoryRouter>,
);
`;

const checks = {};
const screenshots = [];
const pageErrors = [];
const browserOptions = {
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
};
let browser;
let runError = null;

const parseColor = (value) => {
  const numbers = (String(value).match(/[\d.]+/g) || []).map(Number);
  return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0, a: numbers[3] ?? 1 };
};

const relativeLuminance = ({ r, g, b }) => {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrastOf = async (page, selector) => page.locator(selector).first().evaluate((element) => {
  const parse = (value) => {
    const numbers = (String(value).match(/[\d.]+/g) || []).map(Number);
    return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0, a: numbers[3] ?? 1 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const foreground = parse(getComputedStyle(element).color);
  let node = element;
  let background = { r: 8, g: 8, b: 8, a: 1 };
  while (node) {
    const candidate = parse(getComputedStyle(node).backgroundColor);
    if (candidate.a >= 0.95) {
      background = candidate;
      break;
    }
    node = node.parentElement;
  }
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
});

const fontSizeOf = (page, selector) => page.locator(selector).first().evaluate(
  (element) => Number.parseFloat(getComputedStyle(element).fontSize),
);

const overflowOf = (page) => page.evaluate(() => (
  document.documentElement.scrollWidth - document.documentElement.clientWidth
));

const visibleAndEnabled = async (page, selector) => {
  const locator = page.locator(selector).first();
  assert.equal(await locator.isVisible(), true, `${selector} visible`);
  assert.equal(await locator.isEnabled(), true, `${selector} actif`);
};

const svgPlaceholder = (width, height, color, label) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${color}"/>
  <text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="18" text-anchor="middle" dominant-baseline="middle">${label}</text>
</svg>
`;

async function routeFixture(route) {
  const request = route.request();
  const url = new URL(request.url());
  const headers = { 'access-control-allow-origin': '*' };

  if (url.pathname.startsWith('/tmdb/') || url.pathname.startsWith('/avatars/')) {
    const color = url.pathname.includes('avatar') ? '#3a2c46' : '#243746';
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'image/svg+xml',
      body: svgPlaceholder(400, 600, color, 'MOVIX'),
    });
    return;
  }

  if (url.hostname === 'movix.test') {
    if (url.pathname === '/favicon.ico') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    const requested = url.pathname.slice(1);
    const name = !requested || !path.posix.extname(requested) ? 'index.html' : requested;
    const body = await readFile(path.join(work, name)).catch(() => null);
    await route.fulfill({
      status: body ? 200 : 404,
      headers,
      contentType: name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css'
          : 'text/html',
      body: body ?? 'not found',
    });
    return;
  }

  if (url.hostname === 'img.icons8.com') {
    await route.fulfill({
      status: 200,
      headers,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/></svg>',
    });
    return;
  }

  await route.fulfill({ status: 404, headers, body: '' });
}

async function withScenario(name, options, run) {
  const page = await browser.newPage({
    viewport: options.viewport ?? { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await page.addInitScript((config) => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'fixture-token');
    localStorage.setItem('selected_profile_id', 'p-1');
    localStorage.setItem('google_auth', 'true');
    localStorage.setItem('google_user', JSON.stringify({ name: 'Alex Martin', picture: '/avatars/disney/disney_avatar_1.png' }));
    localStorage.setItem('auth', JSON.stringify({ userProfile: { username: 'Alex Martin', avatar: '/avatars/disney/disney_avatar_1.png' } }));
    if (config.vip) localStorage.setItem('fixture_vip', '1');
    window.__profileUpdates = [];
    window.__toasts = [];
    window.__copied = [];
    window.__claimedCodes = [];
    window.__shared = [];
    window.__referralRefresh = 0;
    if (config.share) {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => { window.__shared.push(data); },
      });
    }
  }, options);
  await page.route('**/*', routeFixture);
  page.on('pageerror', (error) => {
    pageErrors.push(`${name}: pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`${name}: console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) pageErrors.push(`${name}: HTTP ${response.status()}: ${response.url()}`);
  });

  const query = new URLSearchParams({ tab: options.tab ?? 'watchlist' });
  if (options.resume) query.set('resume', options.resume);
  if (options.referral) query.set('referral', options.referral);
  await page.goto(`https://movix.test/profile?${query.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="profile-page"]').waitFor();

  const result = await run(page);
  checks[name] = result ?? true;
  await page.close();
}

const withPolishScenario = async (name, run) => {
  const viewport = { width: 900, height: 600 };
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('auth_token', 'fixture-token');
    localStorage.setItem('selected_profile_id', 'p-1');
    window.__toasts = [];
    window.__copied = [];
  });
  await page.route('**/*', routeFixture);
  page.on('pageerror', (error) => {
    pageErrors.push(`${name}: pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`${name}: console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) pageErrors.push(`${name}: HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto('https://movix.test/polish.html', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="polish-harness"]').waitFor();
  const result = await run(page, viewport);
  checks[name] = result ?? true;
  await page.close();
};

const screenshot = async (page, name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(artifactDir, file), fullPage: true });
  screenshots.push(file);
  return file;
};

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
      name: 'profile-redesign-fixture',
      setup(builder) {
        builder.onResolve({ filter: stubPattern }, ({ path: specifier, importer }) => {
          const key = resolveStubKey(specifier);
          if (!key) return undefined;
          // La page Profil garde son stub léger ; le harnais de finition utilise
          // le vrai composant pour tester aperçus et menus.
          if (key === 'customListsTab' && !String(importer).replace(/\\/g, '/').endsWith('/src/pages/Profile.tsx')) return undefined;
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
    '--output', path.join(work, 'tailwind.css'),
  ]);
  const tailwindCss = await readFile(path.join(work, 'tailwind.css'), 'utf8');
  const profileCss = await readFile(path.join(repo, 'src/components/profile/profile-console.css'), 'utf8');
  await writeFile(path.join(work, 'app.css'), `${tailwindCss}\n${profileCss}\n`);
  await writeFile(
    path.join(work, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>html,body{margin:0;background:#000;color:#fff}</style></head><body><div id="root"></div><div id="fixture-toasts"></div><script type="module" src="/app.js"></script></body></html>',
  );

  await writeFile(path.join(work, 'polish-entry.tsx'), polishEntry);
  await build({
    entryPoints: [path.join(work, 'polish-entry.tsx')],
    outfile: path.join(work, 'polish.js'),
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
      name: 'profile-polish-fixture',
      setup(builder) {
        builder.onResolve({ filter: stubPattern }, ({ path: specifier, importer }) => {
          const key = resolveStubKey(specifier);
          if (!key) return undefined;
          // La page Profil garde son stub léger ; le harnais de finition utilise
          // le vrai composant pour tester aperçus et menus.
          if (key === 'customListsTab' && !String(importer).replace(/\\/g, '/').endsWith('/src/pages/Profile.tsx')) return undefined;
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
  await writeFile(
    path.join(work, 'polish.html'),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><style>html,body{margin:0;background:#000;color:#fff}</style></head><body><div id="root"></div><div id="fixture-toasts"></div><script type="module" src="/polish.js"></script></body></html>',
  );

  browser = await chromium.launch(browserOptions);

  await withScenario('desktop-profile', {}, async (page) => {
    await page.locator('[data-testid="member-card"]').waitFor();
    await page.locator('[data-testid="resume-card"]').waitFor();
    await page.locator('[data-testid="referral-card"]').waitFor();

    assert.equal(await page.getByTestId('member-name').innerText(), 'Alex Martin');
    assert.equal(await page.getByTestId('resume-title').innerText(), 'Dune : Prophétie');
    assert.equal(await page.getByTestId('profile-page-title').innerText(), 'Mon profil');

    for (const testId of ['member-edit', 'member-change-avatar', 'member-vip', 'member-switch', 'member-settings']) {
      await visibleAndEnabled(page, `[data-testid="${testId}"]`);
    }
    for (const testId of ['resume-watch', 'resume-details', 'referral-copy', 'referral-claim-submit']) {
      if (testId === 'referral-claim-submit') {
        await page.getByTestId('referral-claim-input').fill('ABC');
      }
      await visibleAndEnabled(page, `[data-testid="${testId}"]`);
    }

    const contrasts = {
      pageSubtitle: await contrastOf(page, '.profile-page-subtitle'),
      memberMeta: await contrastOf(page, '.profile-member-meta'),
      referralPitch: await contrastOf(page, '.profile-referral-pitch'),
      statLabel: await contrastOf(page, '.profile-stat-label'),
      inactiveTab: await contrastOf(page, '[data-testid="tab-favorites"]'),
      emptyReady: await contrastOf(page, '.profile-section-title'),
    };
    for (const [label, ratio] of Object.entries(contrasts)) {
      assert.ok(ratio >= 4.5, `${label}: contraste ${ratio} < 4.5`);
    }

    const typography = {
      name: await fontSizeOf(page, '[data-testid="member-name"]'),
      resume: await fontSizeOf(page, '[data-testid="resume-title"]'),
      section: await fontSizeOf(page, '.profile-section-title'),
    };
    assert.ok(typography.name >= 28, `nom trop petit (${typography.name}px)`);
    assert.ok(typography.resume >= 28, `titre Reprendre trop petit (${typography.resume}px)`);
    assert.ok(typography.section >= 24, `titre de section trop petit (${typography.section}px)`);

    const overflow = await overflowOf(page);
    assert.ok(overflow <= 1, `desktop: débordement horizontal ${overflow}px`);
    const shot = await screenshot(page, '01-desktop-profile');
    return { contrasts, typography, overflow, screenshot: shot };
  });

  await withScenario('mobile-profile', {
    viewport: { width: 390, height: 844 },
  }, async (page) => {
    await page.locator('[data-testid="member-card"]').waitFor();
    await page.locator('[data-testid="profile-tabs"]').waitFor();
    const overflow = await overflowOf(page);
    assert.ok(overflow <= 1, `mobile: débordement horizontal ${overflow}px`);
    const tabs = await page.locator('[data-testid="profile-tabs"]').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    assert.ok(tabs.scrollWidth > tabs.clientWidth, 'mobile: barre d’onglets défilable au doigt');
    for (const testId of ['member-edit', 'member-change-avatar', 'member-vip', 'member-switch', 'member-settings']) {
      await visibleAndEnabled(page, `[data-testid="${testId}"]`);
    }
    const tabOverflow = {};
    for (const tab of ['favorites', 'watched', 'history', 'alerts', 'custom-lists']) {
      await page.getByTestId(`tab-${tab}`).click();
      tabOverflow[tab] = await overflowOf(page);
      assert.ok(tabOverflow[tab] <= 1, `mobile ${tab}: débordement horizontal ${tabOverflow[tab]}px`);
    }
    const shot = await screenshot(page, '02-mobile-profile');
    return { overflow, tabs, tabOverflow, screenshot: shot };
  });

  await withScenario('avatar-selector', {}, async (page) => {
    const expected = await page.evaluate(() => window.__avatarData);
    await page.getByTestId('member-avatar-button').click();
    await page.getByTestId('avatar-modal').waitFor();

    const platforms = await page.locator('.avatar-platform-button').allInnerTexts();
    assert.deepEqual(platforms, [...expected.platforms, 'Classiques']);
    assert.ok(expected.classicCount + expected.platformCount > 100, 'fixture: catalogue d’avatars complet');

    await page.getByRole('button', { name: 'Classiques', exact: true }).click();
    await page.waitForFunction(
      (wanted) => JSON.stringify([...document.querySelectorAll('[data-testid="avatar-category"] h4')].map((node) => node.textContent)) === JSON.stringify(wanted),
      expected.classicKeys,
    );
    const categories = await page.locator('[data-testid="avatar-category"] h4').allTextContents();
    assert.deepEqual(categories, expected.classicKeys, 'toutes les catégories classiques conservées');
    const avatarCount = await page.locator('[data-testid="avatar-option"]').count();
    assert.equal(avatarCount, expected.classicCount, 'tous les avatars classiques conservés');

    const selected = page.locator('[data-avatar="/avatars/disney/disney_avatar_1.png"]');
    assert.equal(await selected.getAttribute('aria-pressed'), 'true', 'avatar courant marqué comme actif');
    assert.equal(await selected.locator('.profile-avatar-check').isVisible(), true, 'coche de sélection visible');

    const boxes = await page.locator('[data-testid="avatar-option"]').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    assert.ok(boxes[0].width >= 64, `avatar trop petit (${boxes[0].width}px)`);
    const gap = boxes[1].x - (boxes[0].x + boxes[0].width);
    assert.ok(gap >= 10, `avatars trop serrés (${gap}px)`);

    const platformCatalog = {};
    for (const platform of expected.platforms) {
      await page.getByRole('button', { name: platform, exact: true }).click();
      await page.waitForFunction(
        (wanted) => JSON.stringify([...document.querySelectorAll('[data-testid="avatar-category"] h4')].map((node) => node.textContent)) === JSON.stringify(wanted),
        expected.platformCategories[platform],
      );
      const keys = await page.locator('[data-testid="avatar-category"] h4').allTextContents();
      assert.deepEqual(keys, expected.platformCategories[platform], `catégories ${platform} conservées`);
      const count = await page.locator('[data-testid="avatar-option"]').count();
      assert.equal(count, expected.platformCounts[platform], `avatars ${platform} conservés`);
      platformCatalog[platform] = { categories: keys.length, avatars: count };
    }

    const shot = await screenshot(page, '03-avatar-selector');

    await page.getByTestId('avatar-close').click();
    await page.getByTestId('avatar-modal').waitFor({ state: 'detached' });
    await page.getByTestId('member-avatar-button').click();
    await page.getByTestId('avatar-modal').waitFor();
    await page.getByRole('button', { name: 'Classiques', exact: true }).click();
    await page.waitForFunction(
      (wanted) => JSON.stringify([...document.querySelectorAll('[data-testid="avatar-category"] h4')].map((node) => node.textContent)) === JSON.stringify(wanted),
      expected.classicKeys,
    );
    const next = page.locator('[data-avatar="/avatars/disney/disney_avatar_2.png"]');
    await next.click();
    await page.getByTestId('avatar-modal').waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => window.__profileUpdates.some((entry) => entry.patch?.avatar === '/avatars/disney/disney_avatar_2.png'),
    );

    const updates = await page.evaluate(() => window.__profileUpdates);
    assert.equal(
      updates.at(-1)?.patch?.avatar,
      '/avatars/disney/disney_avatar_2.png',
      `mise à jour profil: ${JSON.stringify(updates)}`,
    );
    const avatarSrc = await page.getByTestId('member-avatar').getAttribute('src');
    assert.ok(avatarSrc.endsWith('/avatars/disney/disney_avatar_2.png'), `avatar affiché: ${avatarSrc}`);

    return {
      platforms: platforms.length,
      categories: categories.length,
      avatarCount,
      platformCatalog,
      selectedAvatarGap: gap,
      screenshot: shot,
    };
  });

  await withScenario('mobile-avatar-selector', { viewport: { width: 390, height: 844 } }, async (page) => {
    await page.getByTestId('member-avatar-button').click();
    await page.getByTestId('avatar-modal').waitFor();
    const dialog = await page.locator('.avatar-dialog').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });
    assert.ok(dialog.left >= 0 && dialog.right <= 390, `modale mobile dans le cadre: ${JSON.stringify(dialog)}`);
    assert.ok(dialog.width >= 350 && dialog.height <= 844, `modale mobile lisible: ${JSON.stringify(dialog)}`);
    assert.equal(await page.getByTestId('avatar-close').isVisible(), true, 'fermeture visible sur mobile');
    const columns = await page.locator('.avatar-grid').first().evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    assert.equal(columns, 4, `grille mobile à 4 colonnes: ${columns}`);
    const overflow = await overflowOf(page);
    assert.ok(overflow <= 1, `modale mobile: débordement horizontal ${overflow}px`);
    const shot = await screenshot(page, '07-mobile-avatar-selector');
    return { dialog, columns, overflow, screenshot: shot };
  });

  await withScenario('tabs-and-empty-states', {}, async (page) => {
    await page.locator('[data-testid="profile-tabs"]').waitFor();
    assert.equal(await page.getByTestId('tab-watchlist').getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByTestId('tab-watchlist').locator('.profile-tab-count').innerText(), '3');

    await page.getByTestId('tab-favorites').click();
    assert.equal(await page.getByTestId('tab-favorites').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-testid="router-location"]').getAttribute('data-search'), '?tab=favorites');

    await page.getByTestId('tab-favorites').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByTestId('tab-watched').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('[data-testid="router-location"]').getAttribute('data-search'), '?tab=watched');

    await page.getByTestId('tab-alerts').click();
    await page.getByTestId('alerts-tab').waitFor();
    assert.equal(await page.locator('[data-testid="alerts-tab"] .profile-empty').count(), 1);
    assert.equal(await page.locator('[data-testid="profile-tab-panel"]').getAttribute('aria-labelledby'), 'profile-tab-alerts');

    const shot = await screenshot(page, '04-tabs-empty-state');
    return { keyboard: 'ArrowRight → Déjà vu', emptyState: '.profile-empty', screenshot: shot };
  });

  await withScenario('profile-actions', {}, async (page) => {
    await page.getByTestId('member-edit').click();
    const input = page.locator('#profile-name-input');
    await input.waitFor();
    await input.fill('Nouveau Nom');
    await page.locator('[data-testid="member-card"] form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="member-name"]')?.textContent === 'Nouveau Nom');
    const updates = await page.evaluate(() => window.__profileUpdates);
    assert.equal(updates.at(-1)?.patch?.name, 'Nouveau Nom');

    await page.getByTestId('member-vip').click();
    assert.equal(await page.locator('[data-testid="router-location"]').getAttribute('data-path'), '/vip');
    await page.getByTestId('member-switch').click();
    assert.equal(await page.locator('[data-testid="router-location"]').getAttribute('data-path'), '/profile-selection');
    await page.getByTestId('member-settings').click();
    assert.equal(await page.locator('[data-testid="router-location"]').getAttribute('data-path'), '/settings');

    const before = await page.getByTestId('tab-watchlist').locator('.profile-tab-count').innerText();
    assert.equal(before, '3');
    await page.locator('[data-testid="poster-ticket"] button[aria-label^="Retirer"]').first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid="tab-watchlist"] .profile-tab-count')?.textContent === '2');
    const undo = page.locator('[data-testid="toast-action"]').last();
    assert.equal(await undo.innerText(), 'Annuler');
    await undo.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="tab-watchlist"] .profile-tab-count')?.textContent === '3');
    return { renamedTo: 'Nouveau Nom', links: ['/vip', '/profile-selection', '/settings'], undo: '3 → 2 → 3' };
  });

  await withScenario('referral-actions', { share: true }, async (page) => {
    await page.locator('[data-testid="referral-card"]').waitFor();
    const codeText = await page.getByTestId('referral-code').innerText();
    assert.ok(codeText.includes('MOVI X7X42'), `code lisible: ${JSON.stringify(codeText)}`);
    assert.equal(await page.getByTestId('referral-stat-invited').locator('.profile-stat-value').innerText(), '4');
    assert.equal(await page.getByTestId('referral-stat-rewarded').locator('.profile-stat-value').innerText(), '2');
    assert.equal(await page.getByTestId('referral-stat-days').locator('.profile-stat-value').innerText(), '14');

    const codeFont = await fontSizeOf(page, '.profile-code-value');
    const statFont = await fontSizeOf(page, '.profile-stat-value');
    assert.ok(codeFont > statFont, `code du parrainage mis en avant (${codeFont}px vs ${statFont}px)`);
    const referralGap = await page.locator('.profile-referral-row').evaluate(
      (element) => Number.parseFloat(getComputedStyle(element).columnGap),
    );
    assert.ok(referralGap <= 20, `espacement parrainage maîtrisé (${referralGap}px)`);

    await page.getByTestId('referral-copy').click();
    const copied = await page.evaluate(() => window.__copied);
    assert.deepEqual(copied, ['https://movix.test/r/MOVIX7X42']);

    await page.getByTestId('referral-share').click();
    const shared = await page.evaluate(() => window.__shared);
    assert.equal(shared[0].url, 'https://movix.test/r/MOVIX7X42');

    await page.getByTestId('referral-claim-input').fill(' ab-12 ');
    await page.getByTestId('referral-claim-submit').click();
    const claimed = await page.evaluate(() => window.__claimedCodes);
    assert.deepEqual(claimed, ['AB12']);
    const refresh = await page.evaluate(() => window.__referralRefresh);
    assert.ok(refresh >= 1, 'rafraîchissement global demandé après réclamation');

    const shot = await screenshot(page, '05-referral-card');
    return { copied: copied.length, shared: shared.length, claimed, refresh, screenshot: shot };
  });

  await withScenario('referral-progress', { referral: 'progress' }, async (page) => {
    await page.getByTestId('referral-progress').waitFor();
    assert.equal(await page.getByTestId('referral-claim').count(), 0);
    return { progressVisible: true, claimHidden: true };
  });

  await withScenario('referral-disabled', { referral: 'off' }, async (page) => {
    await page.locator('[data-testid="profile-page"]').waitFor();
    assert.equal(await page.getByTestId('referral-card').count(), 0);
    return { hidden: true };
  });

  await withPolishScenario('list-previews-and-empty-state', async (page) => {
    await page.locator('[data-testid="list-card"]').first().waitFor();
    assert.equal(await page.getByTestId('list-preview-empty').count(), 1, 'carte vide: aperçu vide élégant');
    assert.equal(await page.getByTestId('list-preview').count(), 1, 'carte remplie: aperçu avec affiches');
    assert.ok(await page.getByTestId('list-preview').locator('img').count() >= 4, 'quatre affiches d’aperçu');
    assert.equal(await page.getByTestId('list-preview').locator('.profile-list-preview-count').innerText(), '+1', 'badge des éléments supplémentaires');

    const overflow = await overflowOf(page);
    assert.ok(overflow <= 1, `listes: débordement horizontal ${overflow}px`);
    const shot = await screenshot(page, '08-list-previews');

    const emptyCard = page.getByTestId('list-card').filter({ hasText: 'Liste vide' });
    await emptyCard.locator('button[aria-label^="Ouvrir"]').click();
    await page.locator('[data-testid="custom-lists-harness"] .profile-empty').waitFor();
    assert.ok((await page.locator('[data-testid="custom-lists-harness"] .profile-empty').innerText()).includes('Cette liste est vide'));
    await page.locator('button[aria-label="Retour"]').first().click();

    const filledCard = page.getByTestId('list-card').filter({ hasText: 'Liste remplie' });
    await filledCard.getByTestId('list-actions').click();
    const menu = page.locator('[data-profile-menu="list"]');
    await menu.waitFor();
    const labels = await menu.getByRole('menuitem').allInnerTexts();
    for (const label of ['Renommer', 'Partager par code', 'Supprimer']) {
      assert.ok(labels.some((value) => value.includes(label)), `action « ${label} » conservée`);
    }
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });

    return { overflow, previewImages: 4, menuLabels: labels, screenshot: shot };
  });

  await withPolishScenario('menus-near-viewport-edges', async (page, viewport) => {
    const results = {};
    for (const [name, testId, expectedSide] of [
      ['top-right', 'edge-menu-trigger', 'bottom'],
      ['bottom-right', 'bottom-menu-trigger', 'top'],
    ]) {
      await page.getByTestId(testId).locator('button').click();
      const menu = page.locator('[data-profile-menu="history"]');
      await menu.waitFor();
      await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      const box = await menu.boundingBox();
      assert.ok(box, `${name}: menu visible`);
      const side = await menu.getAttribute('data-side');
      assert.equal(side, expectedSide, `${name}: ouverture ${side}`);
      assert.ok(box.x >= 8, `${name}: bord gauche ${box.x}`);
      assert.ok(box.x + box.width <= viewport.width - 8, `${name}: bord droit ${box.x + box.width}`);
      assert.ok(box.y >= 8, `${name}: bord haut ${box.y}`);
      assert.ok(box.y + box.height <= viewport.height - 8, `${name}: bord bas ${box.y + box.height}`);
      results[name] = {
        side,
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    }
    const shot = await screenshot(page, '09-menus-edge-positioning');
    return { viewport, results, screenshot: shot };
  });

  await withScenario('resume-empty', { resume: 'none' }, async (page) => {
    await page.getByTestId('resume-empty').waitFor();
    assert.equal(await page.getByTestId('resume-card').count(), 0);
    await visibleAndEnabled(page, '[data-testid="resume-empty"] a');
    const shot = await screenshot(page, '06-resume-empty');
    return { empty: true, screenshot: shot };
  });
} catch (error) {
  runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
} finally {
  if (browser) await browser.close();
}

const gitUnchanged = async (paths) => {
  try {
    await execFileAsync('git', ['diff', '--quiet', '--', ...paths], { cwd: repo });
    return true;
  } catch {
    return false;
  }
};

const flattenKeys = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
  value && typeof value === 'object'
    ? flattenKeys(value, prefix ? `${prefix}.${key}` : key)
    : [prefix ? `${prefix}.${key}` : key]
));

const profileSource = await Promise.all([
  'src/components/profile/storage.ts',
  'src/components/profile/watchMarks.ts',
  'src/components/profile/useProfileLibrary.ts',
].map((file) => readFile(path.join(repo, file), 'utf8'))).then((parts) => parts.join('\n'));
const tabsSource = await readFile(path.join(repo, 'src/components/profile/ProfileTabs.tsx'), 'utf8');
const polishSources = (await Promise.all([
  'src/components/profile/HistoryRow.tsx',
  'src/components/profile/HistoryTab.tsx',
  'src/components/profile/HistoryStatusSwitch.tsx',
  'src/components/profile/CustomListsTab.tsx',
  'src/components/profile/AlertsTab.tsx',
  'src/components/profile/SessionsTab.tsx',
  'src/components/profile/TvEpisodePanel.tsx',
].map((file) => readFile(path.join(repo, file), 'utf8')))).join('\n');
const menuSources = (await Promise.all([
  'src/components/profile/HistoryRowActions.tsx',
  'src/components/profile/CustomListsTab.tsx',
].map((file) => readFile(path.join(repo, file), 'utf8')))).join('\n');

const staticChecks = {
  storageKeysPreserved: [
    'favorite_movie',
    'favorites_tv',
    'watched_movie',
    'watched_tv',
    'watched_episodes_tv_',
    'custom_lists',
  ].every((key) => profileSource.includes(key)),
  ariaContractsPreserved: ['profile-tab-', 'profile-tab-panel', 'aria-controls', 'role="tab"'].every((needle) => tabsSource.includes(needle)),
  navyBackgroundsRemoved: !/#111827|bg-gray-900/.test(polishSources),
  menuCollisionGuardsPreserved: ['collisionPadding={12}', 'data-profile-menu="history"', 'data-profile-menu="list"']
    .every((needle) => menuSources.includes(needle)),
  generatedAvatarDataUntouched: await gitUnchanged(['src/data/new_avatars.ts']),
  playersUntouched: await gitUnchanged([
    'src/components/VideoJS.tsx',
    'src/components/VideoJSPlayer.tsx',
    'src/components/VideoPlayer.tsx',
    'src/components/HLSPlayer.tsx',
    'src/components/LiveTVPlayer.tsx',
    'src/components/VidRiftPlayer.tsx',
  ]),
  i18nKeysSynchronized: (() => {
    const frKeys = new Set(flattenKeys(fr));
    const enKeys = new Set(flattenKeys(en));
    return [...frKeys].every((key) => enKeys.has(key)) && [...enKeys].every((key) => frKeys.has(key));
  })(),
};

if (!runError) {
  for (const [name, value] of Object.entries(staticChecks)) {
    assert.equal(value, true, `contrôle statique ${name}`);
  }
}

const files = await readdir(artifactDir);
const report = {
  status: runError ? 'FAIL' : 'PASS',
  runError,
  pageErrors,
  command: 'node tests/profileRedesign.browser.mjs',
  prerequisites: {
    dependencies: 'playwright, esbuild, tailwindcss (NODE_PATH ou node_modules)',
    browser: 'Chromium Playwright (CHROMIUM_EXECUTABLE_PATH optionnel)',
    server: 'aucun — fixture esbuild servie par routage Playwright',
    artifactDir,
  },
  fixtureData: {
    profile: { name: 'Alex Martin', provider: 'Google', avatar: 'Disney / disney_avatar_1.png' },
    libraryCounts: { watchlist: 3, favorites: 1, watched: 1 },
    resume: { title: 'Dune : Prophétie', season: 1, episode: 4, progress: 42, remainingMinutes: 91 },
    referral: { code: 'MOVIX7X42', stats: { invited: 4, rewarded: 2, daysEarned: 14 }, rewardDays: 7 },
    avatars: {
      classicCategories: checks['avatar-selector']?.categories ?? 0,
      classicCount: checks['avatar-selector']?.avatarCount ?? 0,
      platforms: checks['avatar-selector']?.platforms ?? 0,
    },
  },
  checks,
  staticChecks,
  screenshots: files.filter((name) => name.endsWith('.png')).sort(),
  artifacts: files.sort(),
};

await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

if (runError) {
  console.error(`[profile-redesign] FAIL — ${runError}`);
  if (pageErrors.length) console.error(`[profile-redesign] erreurs page :\n${pageErrors.join('\n')}`);
  console.error(`[profile-redesign] artefact : ${artifactDir}`);
  process.exitCode = 1;
} else {
  console.log(`[profile-redesign] PASS — ${Object.keys(checks).length} scénarios, ${screenshots.length} captures`);
  console.log(`[profile-redesign] artefact : ${artifactDir}`);
}
