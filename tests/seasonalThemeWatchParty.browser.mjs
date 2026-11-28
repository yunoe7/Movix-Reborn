/**
 * LOT 0 — scénario WatchParty.
 *
 * Relance :
 *   $env:SEASONAL_THEME_WATCHPARTY_DIR='<hors-depot>'
 *   node tests/seasonalThemeWatchParty.browser.mjs
 *
 * Vérifie la suspension sur une salle, l'absence de références au thème dans
 * les canaux WatchParty et les mécanismes existants (heartbeat, WASM/repli).
 * Le test de cadence à deux pairs est documenté `not-run` : il nécessite une
 * salle réelle et deux navigateurs, hors périmètre de ce lot.
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

const command = "$env:SEASONAL_THEME_WATCHPARTY_DIR='<hors-depot>'; node tests/seasonalThemeWatchParty.browser.mjs";

await runScenario({
  key: 'watchparty',
  title: 'Référence — exclusion de WatchParty',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Atmosphères réelles avec suspended=true (équivalent /watchparty/room/*).',
    'Lecture statique des canaux socket/WASM existants, sans salle réelle ni compte.',
  ],
}, async (report) => {
  const room = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: { settings_light_mode: 'off', settings_halloween_theme: '1', settings_christmas_theme: '1' },
    query: '?suspended=1',
    instrument: true,
  });

  const state = await room.page.evaluate(() => window.__seasonal.state());
  const atmosphereCount = await room.page.locator('.halloween-atmosphere, .movix-christmas-atmosphere').count();
  report.pass('WP-01', 'Suspension sur salle WatchParty', 'aucune atmosphère montée et palette de thème retirée', { ...state, atmosphereCount });
  assert.equal(atmosphereCount, 0);
  assert.equal(state.htmlClass.includes('halloween-theme'), false);

  await room.page.evaluate(() => {
    self.postMessage({ type: 'seasonal-theme', activeThemeId: 'halloween-2026' });
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'seasonal-theme', emergencyDisable: true } }));
  });
  await room.page.waitForTimeout(100);
  const afterMessage = await room.page.evaluate(() => window.__seasonal.state());
  report.pass('WP-02', 'Aucun message décoratif parasite', 'un message inattendu ne change aucun état de thème', afterMessage);
  assert.deepEqual(afterMessage, state);

  const metrics = await room.page.evaluate(() => window.__seasonalMetrics());
  report.pass('WP-03', 'Aucune boucle de décor ajoutée', 'canvas et intervalles restent nuls', metrics);
  assert.equal(metrics.canvases, 0);
  assert.equal(metrics.intervals, 0);

  const sources = [
    'API/watchpartyAPI/watchparty.js',
    'src/pages/WatchPartyPage.tsx',
    'src/workers/watchpartySync.worker.ts',
    'src/utils/watchpartySync.ts',
    'src/utils/watchparty.ts',
  ];
  const themeMentions = {};
  for (const source of sources) {
    const text = await readRepoFile(source);
    themeMentions[source] = (text.match(/seasonal[-_ ]?theme|halloween|christmas|movix-font/gi) || []).length;
  }
  const clean = Object.values(themeMentions).every((count) => count === 0);
  report.pass('WP-04', 'Canaux WatchParty sans référence de thème', 'zéro mention seasonal/halloween/christmas/movix-font', themeMentions);
  assert.ok(clean);

  const apiSource = await readRepoFile('API/watchpartyAPI/watchparty.js');
  const hasScheduleDelay = apiSource.includes('SYNC_PRO_SCHEDULE_DELAY_MS = 250');
  const hasHeartbeatReason = apiSource.includes("'heartbeat'");
  report.pass('WP-05', 'Mécanismes heartbeat existants', 'délai 250 ms et heartbeats identifiés', { hasScheduleDelay, hasHeartbeatReason });
  assert.ok(hasScheduleDelay);
  assert.ok(hasHeartbeatReason);
  report.notRun('WP-06', 'Cadence 250/1000 ms à deux pairs', 'mesure réelle sur salle avec deux navigateurs', 'Nécessite une salle de test dédiée et deux pairs ; hors périmètre LOT 0.');

  const workerSource = await readRepoFile('src/workers/watchpartySync.worker.ts');
  const wasmEngine = existsSync(path.join(REPO, 'public/wasm/watchparty-sync/watchparty_sync_bg.wasm'));
  const jsFallback = workerSource.includes("implementation: 'js'");
  report.pass('WP-07', 'Moteur WASM et repli JS conservés', 'fichier WASM présent et repli JS déclaré', { wasmEngine, jsFallback });
  assert.ok(wasmEngine);
  assert.ok(jsFallback);

  report.blocked('WP-08', 'Exclusion WatchParty du futur moteur', 'seasonalDecor: suppress sur toutes les routes WatchParty', 'src/routing/seasonalScope.ts absent', 'LOT 5.');
  await report.screenshot(room.page, '01-watchparty-suspended', { fullPage: true });
  await room.context.close();
  await room.browser.close();

  report.risk('Une salle réelle reste nécessaire pour valider que l’ajout du moteur ne décale pas les heartbeats 250/1000 ms.');
});
