/**
 * E2E de la refonte de la page VIP / Soutiens Movix.
 *
 * Vérifie les icônes SVG locales (aucun carré vide, aucun logo distant),
 * le calcul 5 € = 1 an, les montants prédéfinis et personnalisés,
 * « Pour moi » / « Pour offrir », les moyens de paiement, la soumission
 * simulée sans transaction réelle, les traductions FR/EN, les états de
 * pause, le responsive et prefers-reduced-motion.
 *
 * Relance :
 *   node tests/vipPageRedesign.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss disponibles via
 * NODE_PATH ou node_modules. L'artefact est écrit dans
 * VIP_ARTIFACT_DIR ou dans <workspace>/movix-artifacts/vip-page.
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

const artifactDir = process.env.VIP_ARTIFACT_DIR
  ? path.resolve(process.env.VIP_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'vip-page');
const work = path.join(await mkdtemp(path.join(tmpdir(), 'movix-vip-fixture-')));
await mkdir(artifactDir, { recursive: true });
await mkdir(work, { recursive: true });

const pagePath = path.join(repo, 'src', 'pages', 'VipPage').replace(/\\/g, '/');

const readJson = async (name) => JSON.parse(await readFile(path.join(repo, 'src', 'i18n', 'locales', name), 'utf8'));
const frLocale = await readJson('fr.json');
const enLocale = await readJson('en.json');
const flatten = (value, prefix = '', target = {}) => {
  for (const [key, child] of Object.entries(value || {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, next, target);
    else target[next] = String(child);
  }
  return target;
};
const flatFr = flatten(frLocale);
const flatEn = flatten(enLocale);

// Parité des traductions utilisées par la page et ses sections d'aide.
const namespaceKeys = (locale, namespace) => Object.keys(flatten(namespace.split('.').reduce(
  (node, part) => node?.[part], locale,
))).sort();
const frVipKeys = namespaceKeys(frLocale, 'vipDonations');
const enVipKeys = namespaceKeys(enLocale, 'vipDonations');
const frHelpKeys = namespaceKeys(frLocale, 'help.vip');
const enHelpKeys = namespaceKeys(enLocale, 'help.vip');
assert.deepEqual(frVipKeys, enVipKeys, 'vipDonations : mêmes clés FR/EN');
assert.deepEqual(frHelpKeys, enHelpKeys, 'help.vip : mêmes clés FR/EN');

const settings = {
  donationsEnabled: true,
  pausedMessage: '',
  giftOptionEnabled: true,
  freeAmountEnabled: true,
  minAmountEur: 5,
  maxAmountEur: 500,
  eurosPerVipYear: 5,
  suggestedAmounts: [5, 10, 20],
  defaultAmountEur: 5,
  defaultMethod: 'cryptogate',
  methods: {
    cryptogate: { enabled: true },
    giftcard: { enabled: true },
    btc: { enabled: true },
    ltc: { enabled: true },
  },
  giftCards: {
    google_play: { enabled: true, url: 'https://example.test/google-play' },
    amazon: { enabled: true, url: 'https://example.test/amazon' },
    paysafecard: { enabled: true, url: 'https://example.test/paysafecard' },
    eneba: { enabled: true, url: 'https://example.test/eneba' },
  },
  contacts: {
    email: 'vip-fixture@example.test',
    discordUsername: 'vip-fixture',
    discordUrl: 'https://discord.example.test/vip',
    telegramUsername: 'VipFixture',
    matrixUserId: '@vip:example.test',
    matrixRoomUrl: 'https://matrix.to/#/%23vip:example.test',
  },
};

const stubSources = {
  vipService: `
    const settings = ${JSON.stringify(settings)};
    export const VIP_GIFT_CARD_IDS = ['google_play', 'amazon', 'paysafecard', 'eneba'];
    export const DEFAULT_VIP_DONATION_SETTINGS = settings;
    export const ALL_DONATION_METHODS_AVAILABLE = {
      cryptogate: true, giftcard: true, btc: true, ltc: true,
    };
    export async function getVipDonationSettings() {
      const paused = localStorage.getItem('vip-paused') === '1';
      return {
        settings: paused
          ? { ...settings, donationsEnabled: false, pausedMessage: 'Dons en pause (fixture)' }
          : JSON.parse(JSON.stringify(settings)),
        availability: { ...ALL_DONATION_METHODS_AVAILABLE },
      };
    }
    export async function createVipInvoice(amount, method, recipient, extra) {
      window.__invoicePayloads = window.__invoicePayloads || [];
      window.__invoicePayloads.push({ amount, method, recipient, ...extra });
      return {
        publicId: 'fixture-invoice',
        status: 'awaiting_payment',
        paymentMethod: method,
        coin: method === 'btc' || method === 'ltc' ? method : null,
        amountEur: amount,
        packEur: amount,
        recipientMode: recipient,
        checkoutUrl: null,
        invoicePath: '/vip/invoice/fixture-invoice',
        invoiceUrl: 'https://vip.test/vip/invoice/fixture-invoice',
        giftPath: null,
        giftUrl: null,
        vipKey: null,
        supportTelegramUrl: 'https://t.me/VipFixture',
      };
    }
  `,
  i18n: `
    const translations = ${JSON.stringify({ fr: flatFr, en: flatEn })};
    const render = (language, key, options) => {
      const value = translations[language]?.[key] ?? translations.fr?.[key] ?? String(key);
      return value
        .replace(/<\\/?\\d+>/g, '')
        .replace(/\\{\\{\\s*(\\w+)\\s*\\}\\}/g, (_, name) => String(options?.[name] ?? ''));
    };
    export const useTranslation = () => {
      const language = localStorage.getItem('vip-lang') || 'fr';
      const t = (key, options) => render(language, key, typeof options === 'string' ? {} : options);
      return { t, i18n: { language, resolvedLanguage: language } };
    };
  `,
  sonner: `
    const push = (type) => (message) => {
      window.__toasts = window.__toasts || [];
      window.__toasts.push({ type, message: String(message) });
    };
    export const toast = { success: push('success'), error: push('error'), info: push('info'), warning: push('warning') };
  `,
  turnstileKeys: `export const TURNSTILE_SITE_KEY = '';`,
  turnstileBypass: `export function useTurnstileBypass() { return 'bypass'; }`,
  turnstileWidget: `export default function TurnstileWidget() { return null; }`,
  prefetchLink: `
    import React from 'react';
    export const PrefetchLink = React.forwardRef(({ to, children, ...rest }, ref) => (
      <a ref={ref} href={to} {...rest}>{children}</a>
    ));
  `,
  vipModal: `
    export function useVipModal() {
      return { openVipModal: () => { window.__vipModalOpened = true; } };
    }
  `,
  lightMode: `
    export function useLightMode() {
      return {
        isLightMode: false,
        effectivePrefs: { transitions: true, bgAnimations: true },
      };
    }
  `,
  bgPreferences: `
    export function useBgPrefs() {
      return { forceColor: false, forceSquareSize: false, squareSize: 48 };
    }
    export function getBgAccentRgb() { return '234, 179, 8'; }
  `,
  halloween: `export function useHalloweenTheme() { return false; }`,
  community: `
    export const IX_MATRIX_URL = 'https://matrix.example.test/vip';
    export const IX_DISCORD_URL = 'https://discord.example.test/vip';
  `,
  browserStorage: `export function readLocalStorage(key) { return localStorage.getItem(key); }`,
};

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { MemoryRouter } from 'react-router-dom';
  import VipPage from ${JSON.stringify(pagePath)};

  createRoot(document.getElementById('root')).render(
    <MemoryRouter initialEntries={['/vip']}>
      <VipPage />
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
  define: { 'import.meta.env': JSON.stringify({}) },
  plugins: [{
    name: 'vip-page-fixture',
    setup(builder) {
      builder.onResolve({
        filter: /^(react-i18next|sonner)$|services\/vipDonationsService$|turnstileKeys$|hooks\/useTurnstileBypass$|components\/TurnstileWidget$|routing\/PrefetchLink$|context\/VipModalContext$|context\/LightModeContext$|utils\/bgPreferences$|hooks\/useHalloweenTheme$|config\/community$|utils\/browserStorage$/,
      }, ({ path: name }) => {
        const key = name === 'react-i18next' ? 'i18n'
          : name === 'sonner' ? 'sonner'
            : name.endsWith('vipDonationsService') ? 'vipService'
              : name.endsWith('turnstileKeys') ? 'turnstileKeys'
                : name.endsWith('useTurnstileBypass') ? 'turnstileBypass'
                  : name.endsWith('TurnstileWidget') ? 'turnstileWidget'
                    : name.endsWith('PrefetchLink') ? 'prefetchLink'
                      : name.endsWith('VipModalContext') ? 'vipModal'
                        : name.endsWith('LightModeContext') ? 'lightMode'
                          : name.endsWith('bgPreferences') ? 'bgPreferences'
                            : name.endsWith('useHalloweenTheme') ? 'halloween'
                              : name.endsWith('community') ? 'community'
                                : 'browserStorage';
        return { path: key, namespace: 'vipfixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'vipfixture' }, ({ path: key }) => ({
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
  '--input', path.join(repo, 'src', 'index.css'),
  '--output', path.join(work, 'tailwind.css'),
]);
const tailwindCss = await readFile(path.join(work, 'tailwind.css'), 'utf8');
const vipCss = await readFile(path.join(repo, 'src', 'components', 'vipDonation', 'vip-page.css'), 'utf8');
await writeFile(path.join(work, 'app.css'), `${tailwindCss}\n${vipCss}\n`);
await writeFile(
  path.join(work, 'index.html'),
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
);

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const apiCalls = [];

async function routeFixture(route) {
  const url = new URL(route.request().url());

  if (url.hostname === 'vip.test') {
    if (url.pathname === '/favicon.ico') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
      return;
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(path.join(work, name)).catch(() => null);
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: name.endsWith('.js') ? 'text/javascript'
        : name.endsWith('.css') ? 'text/css'
          : 'text/html',
      body: body ?? 'not found',
      headers: corsHeaders,
    });
    return;
  }

  if (url.pathname.startsWith('/api/vip/')) {
    apiCalls.push({ method: route.request().method(), path: url.pathname });
    await route.fulfill({ status: 200, headers: corsHeaders, json: { success: false, error: 'fixture: aucun appel réel attendu' } });
    return;
  }

  await route.fulfill({ status: 404, headers: corsHeaders, json: { error: 'not found' } });
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
    reducedMotion = 'no-preference',
    waitFor = '[data-testid="vip-submit"], [data-testid="vip-paused-card"]',
  } = options;
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript((values) => {
    window.__invoicePayloads = [];
    window.__toasts = [];
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
  }, init);
  await context.route('**/*', routeFixture);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  try {
    await page.goto('http://vip.test/');
    try {
      await page.locator(waitFor).waitFor({ timeout: 10000 });
    } catch (error) {
      console.error(`[${name}] page errors:`, errors);
      console.error(`[${name}] body:`, (await page.locator('body').innerText()).slice(0, 2500));
      throw error;
    }
    const result = await scenario(page);
    assert.deepEqual(errors, [], `${name} : aucune erreur navigateur`);
    observations.push({ name, viewport, reducedMotion, ...result, errors });
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
const iconAudit = (page) => page.locator('[data-vip-icon]').evaluateAll((nodes) => nodes.map((node) => {
  const svg = node.matches('svg') ? node : node.querySelector('svg');
  const geometry = svg
    ? svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse').length
    : 0;
  const box = svg?.getBoundingClientRect();
  return {
    name: node.getAttribute('data-vip-icon'),
    hasSvg: Boolean(svg),
    geometry,
    hasImg: Boolean(node.querySelector('img')),
    width: Math.round(box?.width ?? 0),
    height: Math.round(box?.height ?? 0),
    visible: Boolean(svg && box && box.width > 7 && box.height > 7),
  };
}));
const assertIcons = (icons, label) => {
  assert.ok(icons.length >= 20, `${label} : suffisamment d'icônes auditées (${icons.length})`);
  for (const icon of icons) {
    assert.ok(icon.hasSvg, `${label} : ${icon.name} rend un SVG`);
    assert.ok(icon.geometry > 0, `${label} : ${icon.name} a un pictogramme`);
    assert.equal(icon.hasImg, false, `${label} : ${icon.name} n'utilise pas d'image distante`);
    assert.ok(icon.visible, `${label} : ${icon.name} est visible (${icon.width}x${icon.height})`);
  }
};

try {
  await withScenario('presentation-et-icones', {}, async (page) => {
    assert.equal(await page.locator('[data-testid="vip-heading"]').innerText(), frLocale.vipDonations.donate.heroTitle);
    assert.match(await page.locator('[data-testid="vip-badge"]').innerText(), /VIP/i);
    assert.match(await page.locator('[data-testid="vip-rule"]').innerText(), /5\s*€/);
    assert.match(await page.locator('[data-testid="vip-rule"]').innerText(), /1 an/i);

    const icons = await iconAudit(page);
    assertIcons(icons, 'présentation');
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'desktop : pas de débordement horizontal');
    await screenshot(page, '01-desktop-presentation');
    return { iconCount: icons.length, iconsOk: true, overflow };
  });

  await withScenario('montants-et-duree', {}, async (page) => {
    const duration = page.locator('[data-testid="vip-duration"]');
    const expected = {
      5: frLocale.vipDonations.donate.thankYou.replace('{{duration}}', frLocale.vipDonations.common.oneYear),
      10: frLocale.vipDonations.donate.thankYou.replace('{{duration}}', frLocale.vipDonations.common.manyYears.replace('{{count}}', '2')),
      20: frLocale.vipDonations.donate.thankYou.replace('{{duration}}', frLocale.vipDonations.common.manyYears.replace('{{count}}', '4')),
    };
    const durations = {};
    for (const amount of [5, 10, 20]) {
      await page.locator(`[data-testid="vip-amount-${amount}"]`).click();
      await page.waitForFunction(
        (wanted) => document.querySelector('[data-testid="vip-duration"]')?.textContent?.includes(wanted),
        amount === 5 ? '1 an' : amount === 10 ? '2 ans' : '4 ans',
      );
      assert.equal(await page.locator(`[data-testid="vip-amount-${amount}"]`).getAttribute('data-selected'), 'true');
      durations[amount] = (await duration.innerText()).trim();
      assert.match(durations[amount], new RegExp(expected[amount].split(':')[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    const selectedColor = await page.locator('[data-testid="vip-amount-20"]').evaluate((node) => getComputedStyle(node).borderTopColor);
    const otherColor = await page.locator('[data-testid="vip-amount-5"]').evaluate((node) => getComputedStyle(node).borderTopColor);
    assert.notEqual(selectedColor, otherColor, 'le montant sélectionné est visuellement distinct');

    await page.locator('[data-testid="vip-custom-amount"]').fill('7');
    await page.waitForFunction(() => document.querySelector('[data-testid="vip-duration"]')?.textContent?.includes('17 mois'));
    durations.custom7 = (await duration.innerText()).trim();
    assert.equal(await page.locator('[data-testid="vip-amount-20"]').getAttribute('data-selected'), 'false');

    await screenshot(page, '02-desktop-montants');
    return { durations, selectedColor, otherColor, overflow: await noOverflow(page) };
  });

  await withScenario('destinataire-et-moyens', {}, async (page) => {
    await page.locator('[data-testid="vip-recipient-gift"]').click();
    assert.equal(await page.locator('[data-testid="vip-recipient-gift"]').getAttribute('data-selected'), 'true');
    assert.equal(await page.locator('[data-testid="vip-method-giftcard"]').count(), 0, 'carte cadeau retirée pour offrir');
    assert.match(await page.locator('[data-testid="vip-gift-not-available"]').innerText(), /carte cadeau/i);

    await page.locator('[data-testid="vip-recipient-self"]').click();
    await page.locator('[data-testid="vip-method-giftcard"]').waitFor();
    await page.locator('[data-testid="vip-method-giftcard"]').click();
    await page.locator('[data-testid="vip-giftcard-guide"]').waitFor();
    assert.equal(await page.locator('[data-testid="vip-method-giftcard"]').getAttribute('data-selected'), 'true');
    const giftIcons = await iconAudit(page);
    assertIcons(giftIcons, 'carte cadeau');
    assert.ok(giftIcons.some((icon) => icon.name.startsWith('vip-giftcard-contact-')), 'contacts de carte cadeau iconographiés');

    const methods = {};
    for (const id of ['cryptogate', 'btc', 'ltc']) {
      await page.locator(`[data-testid="vip-method-${id}"]`).click();
      assert.equal(await page.locator(`[data-testid="vip-method-${id}"]`).getAttribute('data-selected'), 'true');
      methods[id] = {
        icon: await page.locator(`[data-testid="vip-method-icon-${id}"]`).evaluate((node) => Boolean(node.querySelector('svg'))),
      };
      assert.equal(methods[id].icon, true, `${id} : icône SVG visible`);
    }
    assert.equal(await page.locator('[data-testid="vip-giftcard-guide"]').count(), 0);

    await screenshot(page, '03-desktop-destinataire-moyens');
    return { methods, giftIconCount: giftIcons.length, overflow: await noOverflow(page) };
  });

  await withScenario('soumission-simulee', {}, async (page) => {
    await page.locator('[data-testid="vip-amount-10"]').click();
    await page.locator('[data-testid="vip-method-btc"]').click();
    await page.locator('[data-testid="vip-submit"]').click();
    await page.waitForFunction(() => window.__invoicePayloads.length === 1);
    const payloads = await page.evaluate(() => window.__invoicePayloads);
    assert.equal(payloads[0].amount, 10);
    assert.equal(payloads[0].method, 'btc');
    assert.equal(payloads[0].recipient, 'self');
    assert.deepEqual(apiCalls, [], 'aucun appel API réel');
    assert.equal(await page.locator('[data-testid="vip-submit"]').getAttribute('aria-busy'), 'true', 'bouton maintenu en chargement jusqu’au changement de page');
    await screenshot(page, '04-desktop-soumission-simulee');
    return { payload: payloads[0], apiCalls: apiCalls.length, overflow: await noOverflow(page) };
  });

  await withScenario('anglais', { init: { 'vip-lang': 'en' } }, async (page) => {
    assert.equal(await page.locator('[data-testid="vip-heading"]').innerText(), enLocale.vipDonations.donate.heroTitle);
    assert.match(await page.locator('[data-testid="vip-rule"]').innerText(), /of VIP/i);
    assert.match(await page.locator('[data-testid="vip-duration"]').innerText(), /year/i);
    assert.match(await page.locator('[data-testid="vip-recipient-self"]').innerText(), /For me/i);
    const icons = await iconAudit(page);
    assertIcons(icons, 'anglais');
    await screenshot(page, '05-desktop-anglais');
    return { locale: 'en', iconCount: icons.length, overflow: await noOverflow(page) };
  });

  await withScenario('dons-en-pause', { init: { 'vip-paused': '1' } }, async (page) => {
    await page.locator('[data-testid="vip-paused-card"]').waitFor();
    assert.equal(await page.locator('[data-testid="vip-submit"]').count(), 0);
    assert.match(await page.locator('[data-testid="vip-paused-card"]').innerText(), /pause/i);
    const icons = await iconAudit(page);
    assertIcons(icons, 'pause');
    await screenshot(page, '06-desktop-pause');
    return { iconCount: icons.length, overflow: await noOverflow(page) };
  });

  await withScenario('mobile', { viewport: { width: 390, height: 844 } }, async (page) => {
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'mobile : pas de débordement horizontal');
    const columns = await page.locator('[data-testid="vip-layout"]').evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    assert.equal(columns.trim().split(/\s+/).length, 1, 'mobile : une seule colonne');
    const icons = await iconAudit(page);
    assertIcons(icons, 'mobile');
    await screenshot(page, '07-mobile');
    return { overflow, columns, iconCount: icons.length };
  });

  await withScenario('tablette', { viewport: { width: 820, height: 1180 } }, async (page) => {
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'tablette : pas de débordement horizontal');
    await screenshot(page, '08-tablette');
    return { overflow };
  });

  await withScenario('mouvement-reduit', { reducedMotion: 'reduce' }, async (page) => {
    const motion = await page.locator('[data-testid="vip-header"]').evaluate((node) => {
      const style = getComputedStyle(node);
      return { animationName: style.animationName, animationDuration: style.animationDuration };
    });
    assert.equal(motion.animationName, 'none', 'prefers-reduced-motion : aucune animation d’apparition');
    assert.equal(motion.animationDuration, '0s');
    await screenshot(page, '09-mouvement-reduit');
    return { motion, overflow: await noOverflow(page) };
  });
} catch (error) {
  runError = error;
} finally {
  await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  command: 'node tests/vipPageRedesign.browser.mjs',
  generatedAt: new Date().toISOString(),
  prerequisites: {
    dependencies: 'Playwright/Chromium, esbuild et tailwindcss via node_modules ou NODE_PATH',
    browser: process.env.CHROMIUM_EXECUTABLE_PATH || 'Chromium Playwright par défaut',
    server: 'Aucun serveur : CLI Tailwind local et service VIP simulé ; aucun appel API réel',
  },
  fixtureData: {
    settings,
    rule: frLocale.vipDonations.donate.rule,
    translations: { vipDonationsKeys: frVipKeys.length, helpVipKeys: frHelpKeys.length },
  },
  expected: [
    'Icônes SVG locales visibles partout, sans image distante ni carré vide',
    '5 € = 1 an, 10 € = 2 ans, 20 € = 4 ans, 7 € = 17 mois',
    'Pour offrir retire la carte cadeau et affiche une explication',
    'Soumission simulée sans appel API réel',
    'FR/EN, pause, responsive et prefers-reduced-motion',
  ],
  observations,
  error: runError ? String(runError.stack || runError) : null,
};
await writeFile(path.join(artifactDir, 'vip-page-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(artifactDir, 'REPORT.md'), [
  '# Page VIP — E2E refonte',
  '',
  `- Statut : **${report.status}**`,
  `- Commande : \`${report.command}\``,
  `- Prérequis : ${report.prerequisites.dependencies} ; ${report.prerequisites.browser}.`,
  `- Données : règle ${frLocale.vipDonations.donate.rule}, montants ${settings.suggestedAmounts.join(' / ')}, ${frVipKeys.length} clés vipDonations et ${frHelpKeys.length} clés help.vip par langue.`,
  '',
  '| Scénario | Résultat | Capture |',
  '| --- | --- | --- |',
  ...observations.map((entry) => `| ${entry.name} | ${report.status} | \`${entry.name === 'presentation-et-icones' ? '01-desktop-presentation' : entry.name === 'montants-et-duree' ? '02-desktop-montants' : entry.name === 'destinataire-et-moyens' ? '03-desktop-destinataire-moyens' : entry.name === 'soumission-simulee' ? '04-desktop-soumission-simulee' : entry.name === 'anglais' ? '05-desktop-anglais' : entry.name === 'dons-en-pause' ? '06-desktop-pause' : entry.name === 'mobile' ? '07-mobile' : entry.name === 'tablette' ? '08-tablette' : '09-mouvement-reduit'}.png\` |`),
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
