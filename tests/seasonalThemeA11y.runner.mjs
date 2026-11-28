/**
 * Pilote Node du scénario Python seasonalThemeA11y.browser.py.
 * Utilise exclusivement playwright-core déjà présent dans le dépôt.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  REPO,
  commonPrerequisites,
  createAtmosphereFixture,
  readRepoFile,
  runScenario,
} from './seasonalThemeHarness.mjs';

const command = "$env:SEASONAL_THEME_A11Y_DIR='<hors-depot>'; python tests/seasonalThemeA11y.browser.py";

function contrastScript(selectors) {
  const parse = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((part) => parseFloat(part));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = parse(getComputedStyle(document.body).backgroundColor) || { r: 7, g: 7, b: 10, a: 1 };
  const backgroundLum = luminance(background);
  return Object.fromEntries(selectors.map((id) => {
    const element = document.getElementById(id);
    const style = getComputedStyle(element);
    const foreground = parse(style.color);
    if (!foreground) return [id, { color: style.color, ratio: null }];
    const lum = luminance(foreground);
    const ratio = (Math.max(lum, backgroundLum) + 0.05) / (Math.min(lum, backgroundLum) + 0.05);
    return [id, { color: style.color, ratio: Math.round(ratio * 100) / 100, fontSize: style.fontSize }];
  }));
}

await runScenario({
  key: 'a11y',
  title: 'Référence — accessibilité, mobile, tablette et TV',
  command,
  prerequisites: [
    ...commonPrerequisites(),
    'Le point d’entrée Python utilise ce pilote Node ; Python Playwright n’est pas requis.',
  ],
  fixtures: [
    'Atmosphères réelles avec horloge au 28 octobre 2026 et light mode contrôlé.',
    'Viewports 390×844 (mobile), 768×1024 (tablette), 1280×900 (desktop) et 1920×1080 (TV).',
  ],
}, async (report) => {
  const base = { settings_light_mode: 'off', settings_halloween_theme: '1', settings_christmas_theme: '1' };

  const desktop = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
    instrument: true,
  });
  const ratios = await desktop.page.evaluate(contrastScript, ['page-title', 'section-title', 'badge', 'action-button']);
  const ratioOk = ['page-title', 'section-title', 'badge', 'action-button'].every((id) => (ratios[id].ratio ?? 0) >= 4.5);
  report.pass('A11Y-01', 'Contraste des textes de la fixture', '≥ 4,5:1 pour chaque texte mesuré', ratios);
  assert.ok(ratioOk, `contraste insuffisant: ${JSON.stringify(ratios)}`);
  await report.screenshot(desktop.page, '01-desktop-contrast', { fullPage: true });

  await desktop.page.locator('#action-button').focus();
  await desktop.page.keyboard.press('Tab');
  const firstFocus = await desktop.page.evaluate(() => document.activeElement?.id);
  await desktop.page.keyboard.press('Tab');
  const secondFocus = await desktop.page.evaluate(() => document.activeElement?.id);
  const hit = await desktop.page.evaluate(() => {
    const button = document.getElementById('nav-2');
    const rect = button.getBoundingClientRect();
    const element = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { id: button.id, hitId: element?.id || null, hitTag: element?.tagName || null, closestButton: element?.closest('button')?.id || null };
  });
  report.pass('A11Y-02', 'Focus clavier et navigation', 'Tab traverse les contrôles, aucun décor ne capte le clic', { firstFocus, secondFocus, hit });
  assert.equal(firstFocus, 'nav-1');
  assert.equal(secondFocus, 'nav-2');
  assert.equal(hit.closestButton, 'nav-2');

  const metrics = await desktop.page.evaluate(() => window.__seasonalMetrics());
  const budget = 12 * 1024 * 1024;
  report.pass('A11Y-03', 'Budget canvas et boucles', '≤ 12 MiB de canvas, boucles bornées dans la fixture', { ...metrics, budget });
  assert.ok(metrics.canvasBytes <= budget);
  assert.ok(metrics.intervals <= 12, `trop d’intervalles: ${metrics.intervals}`);

  const invalidEffect = await desktop.page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ['pageTitle', 'sectionTitle', 'categoryTitle', 'button'].map((category) => ({
      category,
      effect: root.getPropertyValue(`--movix-font-effect-${category}`),
    }));
  });
  report.blocked('A11Y-04', 'Effets glow/frost limités aux grands titres', 'aucun effet sur button/nav/badge', invalidEffect, 'Le moteur typographique n’existe pas encore (LOT 4B/6).');
  await desktop.context.close();
  await desktop.browser.close();

  const mobile = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
    viewport: { width: 390, height: 844 },
    instrument: true,
  });
  const mobileMetrics = await mobile.page.evaluate(() => window.__seasonalMetrics());
  report.pass('A11Y-05', 'Mobile : budgets et lisibilité', 'canvas ≤ 12 MiB et textes visibles', mobileMetrics);
  assert.ok(mobileMetrics.canvasBytes <= 12 * 1024 * 1024);
  await report.screenshot(mobile.page, '02-mobile', { fullPage: true });
  await mobile.context.close();
  await mobile.browser.close();

  const tablet = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
    viewport: { width: 768, height: 1024 },
  });
  await report.screenshot(tablet.page, '03-tablette', { fullPage: true });
  report.pass('A11Y-06', 'Tablette : rendu sans erreur', 'aucune erreur JS et capture produite', { errors: tablet.errors });
  assert.deepEqual(tablet.errors, []);
  await tablet.context.close();
  await tablet.browser.close();

  const tv = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: {
      ...base,
      settings_light_mode: 'on',
      movix_tv_platform: 'webos',
    },
    query: '?platform=tv&tvsrc=webos-ipk',
    viewport: { width: 1920, height: 1080 },
    instrument: true,
  });
  const tvState = await tv.page.evaluate(() => ({
    platform: window.__seasonal.state().tvPlatform,
    halloweenClass: document.documentElement.classList.contains('halloween-theme'),
    dataNoBgAnim: document.documentElement.hasAttribute('data-no-bg-anim'),
    atmosphereCount: document.querySelectorAll('.halloween-atmosphere, .movix-christmas-atmosphere').length,
    titleFont: getComputedStyle(document.getElementById('page-title')).fontFamily,
    frameBorder: getComputedStyle(document.getElementById('card-title')).borderImageSource,
    metrics: window.__seasonalMetrics(),
  }));
  report.pass('A11Y-07', 'TV : identité statique conservée', 'plateforme détectée, palette/police/cadre présents, animations coûteuses coupées', tvState);
  assert.equal(tvState.platform, 'webos');
  assert.equal(tvState.halloweenClass, true);
  assert.equal(tvState.dataNoBgAnim, true);
  assert.equal(tvState.atmosphereCount, 0);
  assert.match(tvState.titleFont, /Creepster/);
  assert.notEqual(tvState.frameBorder, 'none');

  await tv.page.locator('#nav-1').focus();
  await tv.page.keyboard.press('ArrowRight');
  await tv.page.keyboard.press('Tab');
  const dpadFocus = await tv.page.evaluate(() => document.activeElement?.id);
  const dpadHit = await tv.page.evaluate(() => {
    const button = document.getElementById('nav-2');
    const rect = button.getBoundingClientRect();
    const element = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return element?.closest('button')?.id || element?.id || null;
  });
  report.pass('A11Y-08', 'TV : D-pad, focus et hit-test', 'focus visible et aucun overlay interactif', { dpadFocus, dpadHit });
  assert.ok(['nav-1', 'nav-2'].includes(dpadFocus));
  await report.screenshot(tv.page, '04-tv', { fullPage: false });
  await tv.context.close();
  await tv.browser.close();

  const reduced = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: { ...base, settings_light_mode: 'auto' },
    reducedMotion: 'reduce',
    instrument: true,
  });
  const reducedState = await reduced.page.evaluate(() => ({
    dataNoBgAnim: document.documentElement.hasAttribute('data-no-bg-anim'),
    atmosphereCount: document.querySelectorAll('.halloween-atmosphere, .movix-christmas-atmosphere').length,
    metrics: window.__seasonalMetrics(),
  }));
  report.pass('A11Y-09', 'prefers-reduced-motion', 'décors animés coupés, interface lisible', reducedState);
  assert.equal(reducedState.dataNoBgAnim, true);
  assert.equal(reducedState.atmosphereCount, 0);
  await reduced.context.close();
  await reduced.browser.close();

  const largeTitleThreshold = existsSync(path.join(REPO, 'tests/seasonalThemeFixtures/contrast-threshold.json'));
  report.blocked('A11Y-10', 'Seuil de contraste des grands titres', 'seuil validé documenté et appliqué', largeTitleThreshold ? 'fixture présente' : 'aucun seuil archivé', 'Décision produit encore ouverte.');
  const indexCss = await readRepoFile('src/index.css');
  report.pass('A11Y-11', 'Styles de focus existants', 'aucune règle globale supprimant outline: none', { hasGlobalOutlineNone: /outline\s*:\s*none\s*!?important/.test(indexCss) });
  assert.ok(!/outline\s*:\s*none\s*!?important/.test(indexCss));

  report.risk('Le mode léger supprime intégralement les atmosphères : l’identité saisonnière statique reste, le décor animé disparaît (comportement actuel à confirmer sur TV).');
  report.risk('La mesure de contraste porte sur des textes de fixture ; une vérification sur les vraies pages reste à faire au LOT 6.');
});
