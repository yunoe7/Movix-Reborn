/**
 * LOT 0 — scénario lecteur vidéo.
 *
 * Relance :
 *   $env:SEASONAL_THEME_PLAYER_DIR='<hors-depot>'
 *   node tests/seasonalThemePlayer.browser.mjs
 *
 * Mesure la suspension actuelle des atmosphères sur une route lecteur et
 * documente les deux contradictions déjà identifiées : attribut conservé et
 * citrouille de progression dans HLSPlayer.
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

const command = "$env:SEASONAL_THEME_PLAYER_DIR='<hors-depot>'; node tests/seasonalThemePlayer.browser.mjs";

await runScenario({
  key: 'player',
  title: 'Référence — exclusion des lecteurs vidéo',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Atmosphères réelles avec suspended=true (équivalent des routes /watch/*).',
    'Zone de lecture factice avec progression et citrouille réelle issue de HalloweenIcons.',
    'Horloge figée au 28 octobre 2026, préférence Halloween activée.',
  ],
}, async (report) => {
  const player = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: { settings_light_mode: 'off', settings_halloween_theme: '1' },
    query: '?suspended=1&showPumpkin=1',
    instrument: true,
  });

  const state = await player.page.evaluate(() => window.__seasonal.state());
  const atmosphereCount = await player.page.locator('.halloween-atmosphere, .movix-christmas-atmosphere').count();
  report.pass('PLAYER-01', 'Suspension des atmosphères', 'classe de palette retirée et aucun décor monté', { ...state, atmosphereCount });
  assert.equal(state.htmlClass.includes('halloween-theme'), false);
  assert.equal(atmosphereCount, 0);

  report.fail('PLAYER-02', 'Attribut Halloween conservé sur lecteur', 'aucun marqueur de thème dans le lecteur', state.halloweenEnabled, 'Divergence historique conservée : le scénario exigeait encore le marqueur pour la popup pub ; LOT 5 le retire désormais sur les routes exclues.', 'high');

  const pumpkinCount = await player.page.locator('#player-pumpkin').count();
  const hlsSource = await readRepoFile('src/components/HLSPlayer.tsx');
  const hlsUsesPumpkin = hlsSource.includes('HalloweenProgressPumpkin');
  report.fail('PLAYER-03', 'Progression du lecteur non modifiée', 'boule de progression standard même avec le thème actif', { pumpkinCount, hlsUsesPumpkin }, 'HLSPlayer remplace la boule par HalloweenProgressPumpkin ; les descriptions FR/EN affirment l’inverse.', 'high');

  const hit = await player.page.evaluate(() => {
    const center = document.getElementById('player-center');
    center.scrollIntoView({ block: 'center' });
    const rect = center.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const element = document.elementFromPoint(x, y);
    return {
      x,
      y,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hitId: element?.id || null,
      hitTag: element?.tagName || null,
      ariaHiddenAncestor: Boolean(element?.closest('[aria-hidden="true"]')),
    };
  });
  const focusableDecor = await player.page.locator('#player-pumpkin button, #player-pumpkin a, #player-pumpkin [tabindex]').count();
  report.pass('PLAYER-04', 'Décoration non interactive dans le lecteur', 'citrouille aria-hidden sans contrôle focalisable', { ...hit, focusableDecor });
  assert.equal(hit.ariaHiddenAncestor, true);
  assert.equal(focusableDecor, 0);

  const metrics = await player.page.evaluate(() => window.__seasonalMetrics());
  report.pass('PLAYER-05', 'Aucune boucle de décor ajoutée au lecteur', 'canvas et intervalles restent nuls dans la fixture suspendue', metrics);
  assert.equal(metrics.canvases, 0);
  assert.equal(metrics.intervals, 0);

  await player.page.evaluate(() => document.getElementById('player').classList.add('is-fullscreen'));
  const afterFullscreen = await player.page.evaluate(() => window.__seasonal.state());
  report.pass('PLAYER-06', 'Plein écran sans réinitialisation du thème', 'état du thème stable après passage en plein écran', afterFullscreen);
  assert.equal(afterFullscreen.halloweenEnabled, true);

  const scopeExists = existsSync(path.join(REPO, 'src/routing/seasonalScope.ts'));
  report.blocked('PLAYER-07', 'Exclusion déclarative seasonalDecor', 'métadonnée centrally définie pour /watch/*', scopeExists ? 'fichier présent' : 'src/routing/seasonalScope.ts absent', 'LOT 5.');
  assert.deepEqual(player.errors, []);
  await report.screenshot(player.page, '01-player-suspended', { fullPage: true });

  const fr = JSON.parse(await readRepoFile('src/i18n/locales/fr.json'));
  const en = JSON.parse(await readRepoFile('src/i18n/locales/en.json'));
  const frDescription = fr.settings?.halloweenThemeDesc || '';
  const enDescription = en.settings?.halloweenThemeDesc || '';
  report.fail('PLAYER-08', 'Cohérence des descriptions FR/EN', 'les textes « lecteur non modifié » correspondent au rendu', {
    fr: frDescription,
    en: enDescription,
  }, 'Les deux locales affirment que le lecteur n’est pas modifié alors que la progression est remplacée.');

  report.risk('Arbitrage à prendre : suppression totale du marqueur/citrouille ou micro-accent explicitement toléré et documenté.');
  await player.context.close();
  await player.browser.close();
});
