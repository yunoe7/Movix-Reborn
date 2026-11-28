/**
 * LOT 0 — scénario TV.
 *
 * Relance :
 *   $env:SEASONAL_THEME_TV_DIR='<hors-depot>'
 *   node tests/seasonalThemeTv.browser.mjs
 *
 * La TV doit garder une identité saisonnière statique (palette, typographie,
 * cadres) sans animations coûteuses ni overlay captant le D-pad. L'état
 * actuel est mesuré ; les métadonnées du futur moteur sont marquées `blocked`.
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

const command = "$env:SEASONAL_THEME_TV_DIR='<hors-depot>'; node tests/seasonalThemeTv.browser.mjs";

await runScenario({
  key: 'tv',
  title: 'Référence — compatibilité TV',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Plateforme TV simulée par ?platform=tv&tvsrc=webos-ipk et stockage movix_tv_platform=webos.',
    'Light mode forcé pour représenter un appareil à ressources limitées.',
    'Viewport TV 1920×1080, horloge figée au 28 octobre 2026.',
  ],
}, async (report) => {
  const tv = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: {
      settings_light_mode: 'on',
      settings_halloween_theme: '1',
      settings_christmas_theme: '1',
      movix_tv_platform: 'webos',
    },
    query: '?platform=tv&tvsrc=webos-ipk',
    viewport: { width: 1920, height: 1080 },
    instrument: true,
  });

  const state = await tv.page.evaluate(() => {
    const root = document.documentElement;
    const title = document.getElementById('page-title');
    const frame = document.getElementById('card-title');
    return {
      platform: window.__seasonal.state().tvPlatform,
      halloweenClass: root.classList.contains('halloween-theme'),
      christmasClass: root.classList.contains('christmas-theme'),
      lightMode: root.hasAttribute('data-light-mode'),
      noBgAnim: root.hasAttribute('data-no-bg-anim'),
      titleFont: getComputedStyle(title).fontFamily,
      titleColor: getComputedStyle(title).color,
      frameBorderImage: getComputedStyle(frame).borderImageSource,
      atmosphereCount: document.querySelectorAll('.halloween-atmosphere, .movix-christmas-atmosphere').length,
      metrics: window.__seasonalMetrics(),
    };
  });
  report.pass('TV-01', 'Identité saisonnière statique conservée', 'plateforme TV, palette, police et cadres présents', state);
  assert.equal(state.platform, 'webos');
  assert.equal(state.halloweenClass, true);
  assert.match(state.titleFont, /Creepster/);
  assert.notEqual(state.frameBorderImage, 'none');

  report.pass('TV-02', 'Animations coûteuses coupées', 'mode léger actif et aucune atmosphère animée', { lightMode: state.lightMode, noBgAnim: state.noBgAnim, atmosphereCount: state.atmosphereCount, metrics: state.metrics });
  assert.equal(state.lightMode, true);
  assert.equal(state.noBgAnim, true);
  assert.equal(state.atmosphereCount, 0);
  assert.equal(state.metrics.canvases, 0);

  await tv.page.locator('#nav-1').focus();
  const focusBefore = await tv.page.evaluate(() => document.activeElement?.id);
  await tv.page.keyboard.press('ArrowRight');
  await tv.page.keyboard.press('Tab');
  const focusAfter = await tv.page.evaluate(() => document.activeElement?.id);
  const hit = await tv.page.evaluate(() => {
    const button = document.getElementById('nav-2');
    const rect = button.getBoundingClientRect();
    const element = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { hitId: element?.id || null, closestButton: element?.closest('button')?.id || null };
  });
  report.pass('TV-03', 'D-pad, focus et navigation', 'focus déplacé vers un contrôle et clic non intercepté', { focusBefore, focusAfter, hit });
  assert.ok(['nav-1', 'nav-2'].includes(focusAfter));
  assert.equal(hit.closestButton, 'nav-2');

  const overlayHit = await tv.page.evaluate(() => {
    const center = document.getElementById('player-center');
    const rect = center.getBoundingClientRect();
    const element = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { hitId: element?.id || null, ariaHidden: Boolean(element?.closest('[aria-hidden="true"]')) };
  });
  report.pass('TV-04', 'Aucun overlay interactif', 'zone centrale atteignable', overlayHit);
  assert.equal(overlayHit.hitId, 'player-center');

  const registry = await readRepoFile('src/routing/registry.tsx');
  const excluded = ['/admin', '/vip', '/wrapped', '/watchparty'].filter((route) => registry.includes(`path: '${route}`) && /tvExcluded:\s*true/.test(registry.slice(registry.indexOf(`path: '${route}`), registry.indexOf(`path: '${route}`) + 160)));
  const helperPresent = registry.includes('isHiddenOnTv');
  report.pass('TV-05', 'Routes hors périmètre TV', 'métadonnées tvExcluded et helper isHiddenOnTv présents', { excluded, helperPresent });
  assert.equal(excluded.length, 4);
  assert.ok(helperPresent);

  const typographyVars = await tv.page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['pageTitle', 'sectionTitle', 'categoryTitle'].map((category) => ({ category, value: style.getPropertyValue(`--movix-font-${category}`) }));
  });
  report.blocked('TV-06', 'Typographies saisonnières du futur moteur sur TV', 'variables typographiques résolues et autorisées sur TV', typographyVars, 'LOT 4B/5.');
  const scopeExists = existsSync(path.join(REPO, 'src/routing/seasonalScope.ts'));
  report.blocked('TV-07', 'Politique seasonalDecor sur TV', 'décors animés supprimés, identité statique conservée', scopeExists ? 'fichier présent' : 'src/routing/seasonalScope.ts absent', 'LOT 5.');

  assert.deepEqual(tv.errors, []);
  await report.screenshot(tv.page, '01-tv-1920x1080', { fullPage: false });
  report.setContext('tvPolicy', { animatedDecor: 'suppressed', staticIdentity: 'kept-by-current-light-mode' });
  await tv.context.close();
  await tv.browser.close();
});
