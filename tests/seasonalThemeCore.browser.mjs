/**
 * LOT 0 — scénario de référence « cœur » du moteur décoratif.
 *
 * Relance :
 *   $env:SEASONAL_THEME_CORE_DIR='<hors-depot>'
 *   node tests/seasonalThemeCore.browser.mjs
 *
 * Mesure les deux systèmes existants (Halloween, Noël), leur activation
 * saisonnière, la coexistence et la désactivation indépendante. Les
 * fonctionnalités du futur moteur sont marquées `blocked`, jamais simulées.
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

const command = "$env:SEASONAL_THEME_CORE_DIR='<hors-depot>'; node tests/seasonalThemeCore.browser.mjs";

await runScenario({
  key: 'core',
  title: 'Référence — cœur du moteur décoratif saisonnier',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'tests/seasonalThemeFixtures/atmosphere.tsx (hooks et atmosphères réels, CSS injecté par le harnais)',
    'Horloge figée : 15 septembre 2026, 28 octobre 2026, 20 décembre 2026 et 15 juillet 2026.',
    'Aucune donnée de production, aucun compte, aucun secret.',
  ],
}, async (report) => {
  const base = { settings_light_mode: 'off' };

  const off = await createAtmosphereFixture(report, {
    date: '2026-09-15T12:00:00+02:00',
    storage: { ...base, settings_halloween_theme: '0', settings_christmas_theme: '0' },
    trace: true,
  });
  const offState = await off.page.evaluate(() => window.__seasonal.state());
  report.pass('CORE-01', 'Hors saison et choix explicite off', 'aucune classe de thème, aucun attribut, aucune police saisonnière', offState);
  assert.equal(offState.halloweenEnabled, false);
  assert.equal(offState.christmasEnabled, false);
  assert.equal(offState.fontLink, null);
  await report.screenshot(off.page, '01-theme-off', { fullPage: true });
  await report.stopTrace(off.context);
  await off.context.close();
  await off.browser.close();

  const halloween = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
  });
  const halloweenState = await halloween.page.evaluate(() => window.__seasonal.state());
  report.pass('CORE-02', 'Défaut Halloween (25–31 octobre)', 'classe halloween-theme, attribut data-halloween-enabled et police chargée', halloweenState);
  assert.match(halloweenState.htmlClass, /halloween-theme/);
  assert.equal(halloweenState.halloweenEnabled, true);
  assert.ok(halloweenState.fontLink);
  await report.screenshot(halloween.page, '02-halloween-default', { fullPage: true });
  await halloween.context.close();
  await halloween.browser.close();

  const christmas = await createAtmosphereFixture(report, {
    date: '2026-12-20T12:00:00+01:00',
    storage: base,
  });
  const christmasState = await christmas.page.evaluate(() => window.__seasonal.state());
  report.pass('CORE-03', 'Défaut Noël (1er décembre–6 janvier)', 'classe christmas-theme et attribut data-christmas-enabled', christmasState);
  assert.match(christmasState.htmlClass, /christmas-theme/);
  assert.equal(christmasState.christmasEnabled, true);
  await christmas.context.close();
  await christmas.browser.close();

  const july = await createAtmosphereFixture(report, {
    date: '2026-07-15T12:00:00+02:00',
    storage: { ...base, settings_halloween_theme: '1', settings_christmas_theme: '1' },
  });
  const bothState = await july.page.evaluate(() => window.__seasonal.state());
  const linkCount = await july.page.locator('#halloween-font').count();
  report.pass('CORE-04', 'Choix explicite hors saison', 'deux thèmes peuvent être actifs simultanément', bothState);
  assert.match(bothState.htmlClass, /halloween-theme/);
  assert.match(bothState.htmlClass, /christmas-theme/);
  report.pass('CORE-05', 'Décorations simultanées (anciens systèmes)', 'deux classes, deux attributs, une seule feuille de police', {
    ...bothState,
    fontLinkCount: linkCount,
  });
  assert.equal(linkCount, 1, 'le chargeur Halloween reste idempotent');

  const beforeText = await july.page.locator('#fixture-root').evaluate((node) => node.textContent);
  await july.page.evaluate(() => window.__seasonal.setHalloween(false));
  await july.page.waitForFunction(() => !document.documentElement.classList.contains('halloween-theme'));
  const afterState = await july.page.evaluate(() => window.__seasonal.state());
  const afterText = await july.page.locator('#fixture-root').evaluate((node) => node.textContent);
  report.pass('CORE-06', 'Désactivation indépendante', 'Halloween éteint, Noël intact, texte identique', {
    afterState,
    textIdentical: beforeText === afterText,
  });
  assert.equal(afterState.halloweenEnabled, false);
  assert.equal(afterState.christmasEnabled, true);
  assert.equal(beforeText, afterText);
  assert.deepEqual(july.errors, [], 'aucune erreur de page');

  const publicStatus = await july.page.evaluate(async () => {
    try { return (await fetch('/api/seasonal-theme')).status; } catch (error) { return String(error); }
  });
  report.blocked('CORE-07', 'Configuration centrale multi-décorations', 'GET /api/seasonal-theme exposing plusieurs décorations actives', `statut HTTP ${publicStatus}`, 'Le backend du moteur n’existe pas encore (LOT 1/2).');
  report.blocked('CORE-08', 'Priorités, compatibilités et résolution déterministe', 'registre unique avec priority/conflictsWith et tiebreak par id', 'src/themes/registry.ts et resolveSeasonalTheme.ts absents', 'LOT 2.');
  report.blocked('CORE-09', 'Arrêt d’urgence global', 'emergencyDisable coupe toutes les familles', `statut HTTP ${publicStatus}`, 'Aucune route ni table dédiée dans ce checkout.');

  const registrySource = await readRepoFile('src/routing/registry.tsx');
  const hasSeasonalScope = registrySource.includes('seasonalDecor');
  report.blocked('CORE-10', 'Exclusions centralisées du futur moteur', 'seasonalDecor dans le registre de routes', hasSeasonalScope ? 'présent' : 'absent', 'Le futur moteur devra utiliser la métadonnée prévue au LOT 5.');

  report.risk('Le bootstrap applique les thèmes avant React sans connaître la route : une route exclue peut déjà charger la police Halloween (voir scénario assets).');
  report.risk('Les deux hooks utilisent un stockage local par utilisateur ; la priorité d’une publication admin globale reste à arbitrer au LOT 2.');
  report.setContext('frozenDates', ['2026-09-15', '2026-10-28', '2026-12-20', '2026-07-15']);
  await july.context.close();
  await july.browser.close();
});
