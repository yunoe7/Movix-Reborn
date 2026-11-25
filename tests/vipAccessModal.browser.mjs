/**
 * E2E de la finition « Accès Movix VIP » et de la suppression d'Espace Matrix.
 *
 * Vérifie l'ouverture depuis « Devenir VIP », la validation réelle simulée
 * (clé valide/invalide, chargement, Entrée), la fermeture (croix, Échap,
 * fond), la redirection vers /vip, le FR/EN, le responsive et l'absence de
 * toute référence Matrix dans le parcours VIP rendu.
 *
 * Relance :
 *   node tests/vipAccessModal.browser.mjs
 * Prérequis : Playwright/Chromium, esbuild et tailwindcss via node_modules ou
 * NODE_PATH. Artefact : VIP_MODAL_ARTIFACT_DIR ou
 * <workspace>/movix-artifacts/vip-access-modal.
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

const artifactDir = process.env.VIP_MODAL_ARTIFACT_DIR
  ? path.resolve(process.env.VIP_MODAL_ARTIFACT_DIR)
  : path.resolve(repo, '..', 'movix-artifacts', 'vip-access-modal');
const work = await mkdtemp(path.join(tmpdir(), 'movix-vip-modal-fixture-'));
await mkdir(artifactDir, { recursive: true });

const readJson = (name) => readFile(path.join(repo, 'src', 'i18n', 'locales', name), 'utf8').then(JSON.parse);
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

const keySet = (locale, namespace) => Object.keys(flatten(
  namespace.split('.').reduce((node, part) => node?.[part], locale),
)).sort();
for (const namespace of [
  'vip.accessModal',
  'vipDonations.donate.links',
  'vipDonations.donate.giftCard.contacts',
  'vipDonations.gift',
  'vipDonations.track.help',
  'help.vip',
]) {
  assert.deepEqual(keySet(frLocale, namespace), keySet(enLocale, namespace), `${namespace} : parité FR/EN`);
}
for (const locale of [frLocale, enLocale]) {
  for (const namespace of [
    locale.vipDonations.donate.links,
    locale.vipDonations.donate.giftCard.contacts,
    locale.vipDonations.gift,
    locale.vipDonations.track.help,
    locale.help.vip,
  ]) {
    assert.equal(/\bmatrix\b/i.test(JSON.stringify(namespace)), false, 'aucune référence Matrix dans le parcours VIP');
  }
}

const stubSources = {
  auth: `
    import React, { useState } from 'react';
    export function useAuth() {
      const [error, setError] = useState(null);
      const checkAccessCode = async (code, alreadyAuthenticated) => {
        window.__vipChecks = window.__vipChecks || [];
        window.__vipChecks.push({ code, alreadyAuthenticated });
        const delay = Number(localStorage.getItem('vip-delay') || '0');
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const mode = localStorage.getItem('vip-mode') || 'valid';
        if (mode === 'invalid') {
          setError(localStorage.getItem('vip-error') || 'Clé invalide (fixture)');
          return false;
        }
        setError(null);
        return true;
      };
      return { checkAccessCode, error };
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
  prefetchLink: `
    import React from 'react';
    export const PrefetchLink = React.forwardRef(({ to, onClick, children, ...rest }, ref) => (
      <a
        ref={ref}
        href={to}
        {...rest}
        onClick={(event) => {
          if (typeof to === 'string' && to.startsWith('/')) event.preventDefault();
          onClick?.(event);
        }}
      >{children}</a>
    ));
  `,
  overlayPortal: `export function getOverlayPortalRoot() { return document.body; }`,
  community: `
    export const DISCORD_INVITE_URL = 'https://discord.gg/fixture';
    export const IX_MATRIX_URL = DISCORD_INVITE_URL;
    export const IX_MATRIX_ADDRESS = '#fixture';
    export const MOVIX_ONLINE_URL = 'https://movix.online';
  `,
};

const contextPath = path.join(repo, 'src', 'context', 'VipModalContext').replace(/\\/g, '/');
const linksPath = path.join(repo, 'src', 'components', 'vipDonation', 'DonationLinks').replace(/\\/g, '/');

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { VipModalProvider, useVipModal } from ${JSON.stringify(contextPath)};
  import DonationLinks from ${JSON.stringify(linksPath)};

  const Harness = () => {
    const { openVipModal } = useVipModal();
    return (
      <div className="min-h-screen bg-black p-6 text-white">
        <button
          type="button"
          data-testid="profile-become-vip"
          onClick={openVipModal}
          className="rounded-xl bg-red-600 px-4 py-2"
        >${flatFr['vip.becomeVip']}</button>
        <div className="mt-6">
          <DonationLinks discordUrl="https://discord.gg/fixture" />
        </div>
      </div>
    );
  };

  createRoot(document.getElementById('root')).render(
    <VipModalProvider><Harness /></VipModalProvider>
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
    name: 'vip-modal-fixture',
    setup(builder) {
      builder.onResolve({ filter: /^react-i18next$|context\/AuthContext$|utils\/overlayPortal$|config\/community$|routing\/PrefetchLink$/ }, ({ path: name }) => {
        const key = name === 'react-i18next' ? 'i18n'
          : name.endsWith('AuthContext') ? 'auth'
            : name.endsWith('overlayPortal') ? 'overlayPortal'
              : name.endsWith('PrefetchLink') ? 'prefetchLink'
                : 'community';
        return { path: key, namespace: 'vipmodalfixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'vipmodalfixture' }, ({ path: key }) => ({
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
const modalCss = await readFile(path.join(repo, 'src', 'components', 'vip-access-modal.css'), 'utf8');
await writeFile(path.join(work, 'app.css'), `${tailwindCss}\n${modalCss}\n`);
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
await writeFile(path.join(work, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');

const headers = { 'access-control-allow-origin': '*' };
async function routeFixture(route) {
  const url = new URL(route.request().url());
  if (url.pathname === '/movix-mark.png') {
    await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng, headers });
    return;
  }
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const body = await readFile(path.join(work, name)).catch(() => null);
  await route.fulfill({
    status: body ? 200 : 404,
    contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
    body: body ?? 'not found',
    headers,
  });
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
  } = options;
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript((values) => {
    window.__vipChecks = [];
    window.__storageEvents = 0;
    window.__authStateEvents = 0;
    window.addEventListener('storage', () => { window.__storageEvents += 1; });
    window.addEventListener('authStateChanged', () => { window.__authStateEvents += 1; });
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
    await page.locator('[data-testid="profile-become-vip"]').waitFor({ timeout: 10000 });
    const result = await scenario(page);
    assert.deepEqual(errors, [], `${name} : aucune erreur navigateur`);
    observations.push({ name, viewport, reducedMotion, ...result, errors });
  } catch (error) {
    console.error(`[${name}] body:`, (await page.locator('body').innerText()).slice(0, 2000));
    throw error;
  } finally {
    await context.tracing.stop({ path: path.join(artifactDir, `trace-${name}.zip`) }).catch(() => {});
    await context.close();
  }
}

const openModal = async (page) => {
  await page.locator('[data-testid="profile-become-vip"]').click();
  await page.locator('[data-testid="vip-modal"]').waitFor();
};
const capturedScreenshots = new Set();
const screenshot = async (page, name) => {
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
  capturedScreenshots.add(name);
};
const noOverflow = (page) => page.evaluate(() => ({
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
const visualAudit = async (page) => {
  // Laisser l'animation d'ouverture finir avant de mesurer la géométrie.
  await page.waitForTimeout(300);
  const panel = page.locator('[data-testid="vip-modal"]');
  const styles = await page.evaluate(() => {
    const get = (selector) => getComputedStyle(document.querySelector(selector));
    const panelStyle = get('[data-testid="vip-modal"]');
    return {
      backdrop: get('[data-testid="vip-modal-backdrop"]').backgroundColor,
      panelRadius: Number.parseFloat(panelStyle.borderRadius),
      panelShadow: panelStyle.boxShadow,
      submitBackground: get('[data-testid="vip-access-submit"]').backgroundImage,
      inputHeight: Number.parseFloat(get('[data-testid="vip-access-code"]').height),
      closeSize: Number.parseFloat(get('[data-testid="vip-modal-close"]').width),
    };
  });
  const box = await panel.boundingBox();
  const backdropBox = await page.locator('[data-testid="vip-modal-backdrop"]').boundingBox();
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  return {
    ...styles,
    viewport,
    panelBox: box,
    backdropBox,
    centeredDeltaX: Math.abs(
      box.x + box.width / 2 - (backdropBox.x + backdropBox.width / 2),
    ),
    centeredDeltaY: Math.abs(
      box.y + box.height / 2 - (backdropBox.y + backdropBox.height / 2),
    ),
  };
};
const assertVisualDesign = (visual, label) => {
  assert.match(visual.backdrop, /rgba\(2, 2, 3, 0\.86\)/, `${label} : fond assombri`);
  assert.ok(visual.panelRadius >= 20, `${label} : rayons arrondis`);
  assert.notEqual(visual.panelShadow, 'none', `${label} : ombre de la surface`);
  assert.match(visual.submitBackground, /237, 38, 55/, `${label} : bouton rouge Movix`);
  assert.ok(visual.inputHeight >= 56, `${label} : champ de code généreux`);
  assert.ok(visual.closeSize >= 36, `${label} : croix visible`);
  assert.ok(
    visual.centeredDeltaX <= 2 && visual.centeredDeltaY <= 2,
    `${label} : fenêtre centrée (dx=${visual.centeredDeltaX}, dy=${visual.centeredDeltaY}, viewport=${JSON.stringify(visual.viewport)}, panel=${JSON.stringify(visual.panelBox)})`,
  );
};
const iconAudit = (page) => page.locator('[data-testid="vip-modal"] [data-vip-icon]').evaluateAll((nodes) => nodes.map((node) => {
  const svg = node.matches('svg') ? node : node.querySelector('svg');
  const geometry = svg ? svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse').length : 0;
  const box = svg?.getBoundingClientRect();
  return {
    name: node.getAttribute('data-vip-icon'),
    hasSvg: Boolean(svg),
    geometry,
    hasImg: Boolean(node.querySelector('img')),
    visible: Boolean(svg && box && box.width > 7 && box.height > 7),
  };
}));
const assertIcons = (icons, label) => {
  assert.ok(icons.length >= 3, `${label} : icônes auditées (${icons.length})`);
  for (const icon of icons) {
    assert.ok(icon.hasSvg, `${label} : ${icon.name} SVG`);
    assert.ok(icon.geometry > 0, `${label} : ${icon.name} pictogramme`);
    assert.equal(icon.hasImg, false, `${label} : ${icon.name} sans image distante`);
    assert.ok(icon.visible, `${label} : ${icon.name} visible`);
  }
};
const assertNoMatrix = async (page, label) => {
  const text = await page.locator('body').innerText();
  assert.equal(/\bmatrix\b/i.test(text), false, `${label} : aucun texte Matrix`);
  const hrefs = await page.locator('a[href]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  assert.equal(hrefs.some((href) => /matrix/i.test(href || '')), false, `${label} : aucun lien Matrix`);
};

try {
  await withScenario('ouverture-et-liens', {}, async (page) => {
    assert.equal(await page.locator('[data-testid="vip-link-donations"]').innerText(), flatFr['vipDonations.donate.links.myDonations']);
    assert.equal(await page.locator('[data-testid="vip-link-key"]').innerText(), flatFr['vipDonations.donate.links.haveKey']);
    assert.match(await page.locator('[data-testid="vip-link-discord"]').getAttribute('href'), /discord/i);
    assert.equal(await page.locator('[data-testid="vip-link-help"]').count(), 1);

    await openModal(page);
    assert.equal(await page.locator('[data-testid="vip-modal-title"]').innerText(), flatFr['vip.accessMovixVip']);
    assert.equal(await page.locator('[data-testid="vip-modal-subtitle"]').innerText(), flatFr['vip.accessModal.subtitle']);
    assert.equal(await page.locator('[data-testid="vip-access-submit"]').innerText(), flatFr['vip.accessModal.submit']);
    assert.equal(await page.locator('[data-testid="vip-modal-no-key"]').innerText(), flatFr['vip.noVipKey']);
    assert.equal(await page.locator('[data-testid="vip-modal-discover"]').innerText(), flatFr['vip.discoverBenefits']);
    assert.equal(await page.locator('[data-testid="vip-modal-discover"]').getAttribute('href'), '/vip');
    assert.match(await page.locator('[data-testid="vip-modal-mark"]').getAttribute('src'), /\/movix-mark\.png$/);
    assert.ok(await page.locator('[data-testid="vip-modal-close"]').isVisible());

    const icons = await iconAudit(page);
    assertIcons(icons, 'ouverture');
    const visual = await visualAudit(page);
    assertVisualDesign(visual, 'ouverture');
    const remoteImages = await page.locator('img[src^="http"]').count();
    assert.equal(remoteImages, 0, 'aucune image distante');
    await assertNoMatrix(page, 'ouverture');
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'desktop : pas de débordement');
    await screenshot(page, 'ouverture-et-liens');
    return { iconCount: icons.length, remoteImages, overflow, visual, linksOk: true };
  });

  await withScenario('cle-valide', { init: { discord_auth: 'true' } }, async (page) => {
    await openModal(page);
    await page.locator('[data-testid="vip-access-code"]').fill('VIP-VALIDE-123');
    await page.locator('[data-testid="vip-access-submit"]').click();
    await page.locator('[data-testid="vip-access-success"]').waitFor();
    assert.equal(await page.locator('[data-testid="vip-access-success"]').innerText(), flatFr['vip.accessModal.success']);
    await page.locator('[data-testid="vip-modal"]').waitFor({ state: 'detached' });
    const checks = await page.evaluate(() => window.__vipChecks);
    assert.deepEqual(checks, [{ code: 'VIP-VALIDE-123', alreadyAuthenticated: true }]);
    const stored = await page.evaluate(() => ({
      vip: localStorage.getItem('is_vip'),
      uuid: localStorage.getItem('guest_uuid'),
      storageEvents: window.__storageEvents,
      authEvents: window.__authStateEvents,
    }));
    assert.equal(stored.vip, 'true');
    assert.match(stored.uuid || '', /^vip_/);
    assert.ok(stored.storageEvents >= 1, 'événement storage émis');
    assert.ok(stored.authEvents >= 1, 'événement authStateChanged émis');
    return { checks, stored };
  });

  await withScenario('cle-invalide', { init: { 'vip-mode': 'invalid', 'vip-error': 'Clé refusée (fixture)' } }, async (page) => {
    await openModal(page);
    await page.locator('[data-testid="vip-access-code"]').fill('VIP-INVALIDE');
    await page.locator('[data-testid="vip-access-submit"]').click();
    await page.locator('[data-testid="vip-access-error"]').waitFor();
    assert.equal(await page.locator('[data-testid="vip-access-error"]').innerText(), 'Clé refusée (fixture)');
    assert.equal(await page.locator('[data-testid="vip-modal"]').isVisible(), true, 'la fenêtre reste ouverte');
    assert.equal(await page.locator('[data-testid="vip-access-submit"]').isDisabled(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('is_vip')), null);
    await screenshot(page, 'cle-invalide');
    return { error: 'Clé refusée (fixture)', checks: await page.evaluate(() => window.__vipChecks.length) };
  });

  await withScenario('chargement', { init: { 'vip-mode': 'valid', 'vip-delay': '900' } }, async (page) => {
    await openModal(page);
    await page.locator('[data-testid="vip-access-code"]').fill('VIP-LENTE');
    await page.locator('[data-testid="vip-access-submit"]').click();
    const submit = page.locator('[data-testid="vip-access-submit"]');
    assert.equal(await submit.getAttribute('aria-busy'), 'true');
    assert.equal(await submit.isDisabled(), true);
    assert.match(await submit.innerText(), new RegExp(flatFr['vip.accessModal.submitting'].replace(/…/g, '…')));
    await page.locator('[data-testid="vip-access-success"]').waitFor();
    return { loadingState: 'aria-busy + bouton désactivé', checks: await page.evaluate(() => window.__vipChecks.length) };
  });

  await withScenario('validation-entree', {}, async (page) => {
    await openModal(page);
    await page.locator('[data-testid="vip-access-code"]').fill('VIP-ENTREE');
    await page.locator('[data-testid="vip-access-code"]').press('Enter');
    await page.locator('[data-testid="vip-access-success"]').waitFor();
    const checks = await page.evaluate(() => window.__vipChecks);
    assert.deepEqual(checks, [{ code: 'VIP-ENTREE', alreadyAuthenticated: false }]);
    return { checks };
  });

  await withScenario('redirection', {}, async (page) => {
    await openModal(page);
    await page.locator('[data-testid="vip-modal-discover"]').click();
    await page.locator('[data-testid="vip-modal"]').waitFor({ state: 'detached' });
    assert.equal(new URL(page.url()).pathname, '/', 'navigation interne simulée sans rechargement');
    return { destination: '/vip', closed: true };
  });

  await withScenario('fermetures', {}, async (page) => {
    await openModal(page);
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="vip-modal"]').waitFor({ state: 'detached' });

    await openModal(page);
    await page.mouse.click(8, 8);
    await page.locator('[data-testid="vip-modal"]').waitFor({ state: 'detached' });

    await openModal(page);
    await page.locator('[data-testid="vip-modal-close"]').click();
    await page.locator('[data-testid="vip-modal"]').waitFor({ state: 'detached' });
    return { escape: true, backdrop: true, closeButton: true };
  });

  await withScenario('anglais', { init: { 'vip-lang': 'en' } }, async (page) => {
    await openModal(page);
    assert.equal(await page.locator('[data-testid="vip-modal-title"]').innerText(), flatEn['vip.accessMovixVip']);
    assert.equal(await page.locator('[data-testid="vip-modal-subtitle"]').innerText(), flatEn['vip.accessModal.subtitle']);
    assert.equal(await page.locator('[data-testid="vip-access-submit"]').innerText(), flatEn['vip.accessModal.submit']);
    assert.equal(await page.locator('[data-testid="vip-modal-no-key"]').innerText(), flatEn['vip.noVipKey']);
    assert.equal(await page.locator('[data-testid="vip-modal-discover"]').innerText(), flatEn['vip.discoverBenefits']);
    await assertNoMatrix(page, 'anglais');
    await screenshot(page, 'anglais');
    return { locale: 'en' };
  });

  await withScenario('mobile', { viewport: { width: 390, height: 844 } }, async (page) => {
    await openModal(page);
    const overflow = await noOverflow(page);
    assert.equal(overflow.horizontal, false, 'mobile : pas de débordement');
    const box = await page.locator('[data-testid="vip-modal"]').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0, 'mobile : fenêtre dans le viewport');
    assert.ok(box.x + box.width <= 391 && box.y + box.height <= 845, 'mobile : aucun élément coupé');
    const inputBox = await page.locator('[data-testid="vip-access-code"]').boundingBox();
    assert.ok(inputBox.width >= 250, 'mobile : champ confortable');
    const buttonBox = await page.locator('[data-testid="vip-access-submit"]').boundingBox();
    assert.ok(buttonBox.height >= 44, 'mobile : bouton comfortable');
    const icons = await iconAudit(page);
    assertIcons(icons, 'mobile');
    await screenshot(page, 'mobile');
    return { overflow, box, iconCount: icons.length };
  });

  await withScenario('mouvement-reduit', { reducedMotion: 'reduce' }, async (page) => {
    await openModal(page);
    assert.equal(await page.locator('[data-testid="vip-modal-backdrop"]').getAttribute('data-reduced-motion'), 'true');
    return { reducedMotion: 'respecté' };
  });
} catch (error) {
  runError = error;
} finally {
  await browser.close();
}

const report = {
  status: runError ? 'FAIL' : 'PASS',
  command: 'node tests/vipAccessModal.browser.mjs',
  generatedAt: new Date().toISOString(),
  prerequisites: {
    dependencies: 'Playwright/Chromium, esbuild et tailwindcss via node_modules ou NODE_PATH',
    browser: process.env.CHROMIUM_EXECUTABLE_PATH || 'Chromium Playwright par défaut',
    server: 'Aucun serveur : CLI Tailwind local, contexte Auth simulé, aucune requête réseau',
  },
  fixtureData: {
    validKey: 'VIP-VALIDE-123',
    invalidKey: 'VIP-INVALIDE',
    authError: 'Clé refusée (fixture)',
    translations: { accessModalKeys: keySet(frLocale, 'vip.accessModal').length },
  },
  expected: [
    'Ouverture depuis « Devenir VIP » et fenêtre centrée sans Matrix',
    'Clé valide : événements émis, guest_uuid créé, succès puis fermeture',
    'Clé invalide : erreur lisible, fenêtre ouverte, aucun flag VIP',
    'Chargement, Entrée, croix/Échap/fond et lien /vip',
    'FR/EN, responsive et mouvement réduit',
  ],
  observations,
  error: runError ? String(runError.stack || runError) : null,
};
await writeFile(path.join(artifactDir, 'vip-access-modal-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(artifactDir, 'REPORT.md'), [
  '# Accès VIP — E2E finition',
  '',
  `- Statut : **${report.status}**`,
  `- Commande : \`${report.command}\``,
  `- Prérequis : ${report.prerequisites.dependencies} ; ${report.prerequisites.browser}.`,
  '- Données : clés de fixture, aucun appel réseau ni modification de localStorage réelle.',
  '',
  '| Scénario | Résultat | Capture |',
  '| --- | --- | --- |',
  ...observations.map((entry) => `| ${entry.name} | ${report.status} | ${capturedScreenshots.has(entry.name) ? `\`${entry.name}.png\`` : '—'} |`),
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
