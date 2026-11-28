/**
 * LOT 0 — scénario synchronisation et périmètre utilisateur.
 *
 * Relance :
 *   $env:SEASONAL_THEME_SYNC_DIR='<hors-depot>'
 *   node tests/seasonalThemeSync.browser.mjs
 *
 * Vérifie que les préférences des anciens thèmes restent dans le préfixe
 * `settings_` et n'écrivent ni jetons ni statut VIP, puis documente les tests
 * de profils et dePublication centrale absents du checkout.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  REPO,
  commonPrerequisites,
  buildFixtureBundle,
  fixtureHtml,
  freezeDateInit,
  launchBrowser,
  mountFixture,
  readRepoFile,
  runScenario,
  storageInit,
  trackResource,
  writeFixtureFiles,
} from './seasonalThemeHarness.mjs';

const command = "$env:SEASONAL_THEME_SYNC_DIR='<hors-depot>'; node tests/seasonalThemeSync.browser.mjs";

await runScenario({
  key: 'sync',
  title: 'Référence — synchronisation, profils et périmètre sensible',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'tests/seasonalThemeFixtures/sync.tsx (classification réelle via src/utils/syncStorage.ts).',
    'Horloge figée au 15 juillet 2026, aucune donnée d’authentification réelle.',
  ],
}, async (report) => {
  const workDir = path.join(report.artifactDir, 'fixture-sync');
  await writeFixtureFiles(workDir, { html: fixtureHtml() });
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/sync.tsx'));

  const browser = await launchBrowser();
  const context = trackResource(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await context.addInitScript(freezeDateInit('2026-07-15T12:00:00+02:00'));
  await context.addInitScript(storageInit({ settings_light_mode: 'off' }));
  await mountFixture(context, { workDir });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://seasonal.test/');
  await page.waitForFunction(() => Boolean(window.__seasonalSync));

  const classification = await page.evaluate(() => window.__seasonalSync.keys());
  report.pass('SYNC-01', 'Clés settings_ synchronisables', 'les deux préférences de thème suivent le compte', classification);
  assert.equal(classification.settings_halloween_theme, 'syncable');
  assert.equal(classification.settings_christmas_theme, 'syncable');
  assert.equal(classification.is_vip, 'not_allowlisted');
  assert.equal(classification.auth_token, 'blocked');
  assert.equal(classification.access_token, 'blocked');
  assert.equal(classification.discord_token, 'blocked');
  assert.equal(classification.google_token, 'blocked');

  const serverManaged = await page.evaluate(() => window.__seasonalSync.serverManaged);
  report.pass('SYNC-02', 'Statut VIP géré par le serveur', 'is_vip listé comme clé serveur', serverManaged);
  assert.ok(serverManaged.includes('is_vip'));

  await page.evaluate(() => {
    window.__seasonalSync.setHalloween(true);
    window.__seasonalSync.setChristmas(false);
  });
  const stored = await page.evaluate(() => window.__seasonalSync.localStorage());
  const written = {
    halloween: stored.settings_halloween_theme,
    christmas: stored.settings_christmas_theme,
    forbidden: ['auth_token', 'access_token', 'discord_token', 'google_token', 'is_admin'].filter((key) => key in stored),
  };
  report.pass('SYNC-03', 'Écriture limitée aux préférences', 'seules settings_* changent, aucun secret écrit', written);
  assert.equal(written.halloween, '1');
  assert.equal(written.christmas, '0');
  assert.deepEqual(written.forbidden, []);
  assert.deepEqual(errors, []);
  await report.screenshot(page, '01-sync-preferences', { fullPage: true });

  const vipSource = await readRepoFile('src/context/VipModalContext.tsx');
  const vipClean = !/halloween|christmas|seasonal[-_ ]?theme|movix-font/i.test(vipSource);
  report.pass('SYNC-04', 'Modale VIP isolée', 'aucune référence au thème dans VipModalContext', { vipClean });
  assert.ok(vipClean);

  const bridgeFiles = [
    'extension/Chrome/content.js',
    'extension/Firefox/content.js',
    'userscript/movix.user.js',
  ];
  const bridgeMentions = {};
  for (const file of bridgeFiles) {
    const text = await readRepoFile(file);
    bridgeMentions[file] = (text.match(/seasonal[-_ ]?theme|settings_halloween_theme|settings_christmas_theme|movix-font/gi) || []).length;
  }
  const bridgeClean = Object.values(bridgeMentions).every((count) => count === 0);
  report.pass('SYNC-05', 'Bridge extension/userscript isolé', 'zéro clé ou variable de thème dans les bridges', bridgeMentions);
  assert.ok(bridgeClean);

  report.blocked('SYNC-06', 'Isolation des profils pour la config centrale', 'deux profils avec deux configurations indépendantes', 'aucun backend seasonal-theme', 'LOT 2/5 : scénario à compléter avec deux profils et une API factice.');
  report.blocked('SYNC-07', 'Priorité publication admin vs préférence utilisateur', 'règle définie et testée', 'arbitrage non implémenté', 'Décision produit toujours ouverte.');
  report.risk('Les hooks gardent une valeur mémoire par onglet : une synchronisation cross-tab doit rester vérifiée lors de l’intégration.');

  await context.close();
  await browser.close();
});
