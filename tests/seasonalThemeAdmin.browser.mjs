/**
 * LOT 0 — scénario console « Décoratif », arrêt d’urgence et migration.
 *
 * Relance :
 *   $env:SEASONAL_THEME_ADMIN_DIR='<hors-depot>'
 *   node tests/seasonalThemeAdmin.browser.mjs
 *
 * Vérifie l'état réel de la console (placeholder explicite, aucune action
 * simulée), l'absence de conflit CSS entre les deux systèmes hérités, puis
 * documente précisément les contrats non encore implémentés : publication
 * centrale, aperçu isolé et arrêt d'urgence multi-workers < 1 s.
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
  trackResource,
  writeFixtureFiles,
} from './seasonalThemeHarness.mjs';
import { writeFile } from 'node:fs/promises';

const command = "$env:SEASONAL_THEME_ADMIN_DIR='<hors-depot>'; node tests/seasonalThemeAdmin.browser.mjs";

const mountAdmin = async (report, language) => {
  const workDir = path.join(report.artifactDir, `fixture-admin-${language}`);
  await writeFixtureFiles(workDir, {
    html: fixtureHtml({ title: 'Console Décoratif', body: '<div id="root"></div>' }),
  });
  await writeFile(path.join(workDir, 'app.css'), 'html,body,#root{min-height:100%;background:#07070a;color:#f8fafc}', 'utf8');
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/admin.tsx'));

  const browser = await launchBrowser();
  const context = trackResource(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await context.addInitScript(freezeDateInit('2026-10-28T12:00:00+02:00'));
  await mountFixture(context, { workDir });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://seasonal.test/?lng=${language}`);
  await page.waitForSelector('[data-testid="admin-decor"]');
  return { browser, context, page, errors, workDir };
};

const readSurfaceLabels = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.admin-quick-action span'),
  (node) => node.textContent.trim(),
).filter(Boolean));

await runScenario({
  key: 'admin',
  title: 'Référence — console Décoratif, arrêt d’urgence et migration',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Composant réel AdminDecorPlaceholder monté avec i18next et les locales FR/EN du dépôt.',
    'Horloge figée au 28 octobre 2026 ; aucun appel API, aucun compte admin, aucun secret.',
    'Lecture statique de adminRegistry.ts et des deux feuilles CSS héritées pour les contrats absents.',
  ],
}, async (report) => {
  const registry = await readRepoFile('src/components/admin/adminRegistry.ts');
  const cardStart = registry.indexOf("titleKey: 'admin.console.decorTitle'");
  const decorCard = cardStart >= 0 ? registry.slice(cardStart, cardStart + 600) : '';
  const registryOk = decorCard.includes("group: 'decor'")
    && decorCard.includes("subgroup: 'decor'")
    && decorCard.includes('allowedRoles: ADMIN');
  report.pass('ADMIN-01', 'Carte « Décoratif » unique dans la console', 'une carte groupe decor réservée aux ADMIN', {
    registryOk,
    decorCard: decorCard.split('\n').slice(0, 14).join('\n'),
  });
  assert.ok(registryOk);

  const fr = await mountAdmin(report, 'fr');
  const surfaces = await readSurfaceLabels(fr.page);
  const interactive = await fr.page.evaluate(() => ({
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input, select, textarea').length,
    forms: document.querySelectorAll('form').length,
    stateBlocks: document.querySelectorAll('[data-testid="admin-decor"] div').length,
  }));
  report.pass('ADMIN-02', 'Placeholder non simulateur', 'cinq familles annoncées, zéro bouton/formulaire de publication', {
    surfaces,
    interactive,
    errors: fr.errors,
  });
  assert.deepEqual(surfaces, ['Animations', 'Effets', 'Arrière-plans', 'Thèmes', 'Éléments graphiques']);
  assert.equal(interactive.buttons, 0);
  assert.equal(interactive.inputs, 0);
  assert.equal(interactive.forms, 0);
  assert.deepEqual(fr.errors, []);
  await report.screenshot(fr.page, '01-admin-decor-fr', { fullPage: true });

  const en = await mountAdmin(report, 'en');
  const enSurfaces = await readSurfaceLabels(en.page);
  report.pass('ADMIN-03', 'Localisation FR/EN synchronisée', 'mêmes cinq familles traduites en anglais', enSurfaces);
  assert.deepEqual(enSurfaces, ['Animations', 'Effects', 'Backgrounds', 'Themes', 'Graphic elements']);
  assert.deepEqual(en.errors, []);
  await report.screenshot(en.page, '02-admin-decor-en', { fullPage: true });

  const frLocale = JSON.parse(await readRepoFile('src/i18n/locales/fr.json'));
  const enLocale = JSON.parse(await readRepoFile('src/i18n/locales/en.json'));
  const frDecor = frLocale.admin.console;
  const enDecor = enLocale.admin.console;
  const decorKeys = Object.keys(frDecor).filter((key) => key.toLowerCase().startsWith('decor'));
  const missingInEn = decorKeys.filter((key) => !(key in enDecor));
  const emptyInEn = decorKeys.filter((key) => typeof enDecor[key] !== 'string' || enDecor[key].trim() === '');
  const identicalValues = decorKeys.filter((key) => enDecor[key] === frDecor[key]);
  report.pass('ADMIN-04', 'Parité des clés i18n decor', 'toutes les clés FR existent en EN avec une valeur non vide', {
    keyCount: decorKeys.length,
    missingInEn,
    emptyInEn,
    identicalValues,
  });
  assert.deepEqual(missingInEn, []);
  assert.deepEqual(emptyInEn, []);

  await fr.context.close();
  await fr.browser.close();
  await en.context.close();
  await en.browser.close();

  const apiSources = [
    'API/Mainapi/server.js',
    'API/Mainapi/shared/syncKeys.json',
  ];
  const emergencyMentions = {};
  for (const source of apiSources) {
    const text = await readRepoFile(source);
    emergencyMentions[source] = (text.match(/emergencyDisable|seasonal[-_ ]?theme|activeThemeId/gi) || []).length;
  }
  const noBackend = Object.values(emergencyMentions).every((count) => count === 0);
  report.pass('ADMIN-05', 'Aucune API fantôme pour l’arrêt d’urgence', 'zéro référence emergencyDisable/activeThemeId dans la Main API', emergencyMentions);
  assert.ok(noBackend);

  report.blocked(
    'ADMIN-06',
    'Arrêt d’urgence multi-workers < 1 s',
    '3 workers abonnés, Redis périmé sur 1 worker, publication emergencyDisable=true, propagation < 1000 ms mesurée sur les 3',
    'Aucune configuration centrale, aucun canal de publication et aucun drapeau emergencyDisable dans HEAD',
    'Contrat LOT 2/3. Procédure de rejeu : démarrer 3 workers, injecter une valeur Redis périmée sur le worker B, publier emergencyDisable=true, horodater la réception sur A/B/C et exiger max − min < 1000 ms avec désactivation effective même si le cache de B est incohérent.',
  );
  report.notRun(
    'ADMIN-07',
    'Mesure de latence d’arrêt sous cache incohérent',
    'p99 < 1000 ms sur 3 workers avec Redis désynchronisé',
    'Non exécutable : le canal d’arrêt et les workers du moteur n’existent pas ; aucun service externe n’est démarré dans ce lot.',
  );
  report.blocked(
    'ADMIN-08',
    'Contrôle admin de publication sans redéploiement',
    'bouton de publication et aperçu isolé dans la console Décoratif',
    'Placeholder explicite : aucun bouton, aucun formulaire, aucune donnée simulée',
    'LOT 3 : publication côté serveur avecatégories animation/effect/background/theme/graphic et validation des rôles.',
  );
  report.blocked(
    'ADMIN-09',
    'Aperçu sans effet utilisateur',
    'textes neutres, environnement isolé, aucune publication accidentelle',
    'Aucun composant de prévisualisation dédié',
    'LOT 3 : aperçu en bac à sable, distinct du rendu public.',
  );

  const halloweenCss = await readRepoFile('src/styles/halloween-ui.css');
  const christmasCss = await readRepoFile('src/components/christmas-atmosphere.css');
  const halloweenFontSelectors = halloweenCss.match(/[^{}]*\{[^}]*font-family[^}]*\}/g) || [];
  const christmasFontDeclarations = (christmasCss.match(/font-family\s*:/g) || []).length;
  report.pass('ADMIN-10', 'Pas de conflit de police CSS hérité', 'Halloween porte font-family, Noël n’en déclare aucun', {
    halloweenFontRules: halloweenFontSelectors.length,
    christmasFontDeclarations,
  });
  assert.ok(halloweenFontSelectors.length > 0);
  assert.equal(christmasFontDeclarations, 0);

  const decorRegistry = await readRepoFile('src/routing/registry.tsx');
  const legacyAliases = /legacyAlias|activeThemeId|seasonalDecor/.test(decorRegistry);
  report.blocked('ADMIN-11', 'Migration des anciens systèmes sans double affichage', 'registre unique avec alias halloween/christmas vers une seule source de vérité', legacyAliases ? 'marqueur présent' : 'aucun alias, aucun activeThemeId, aucune métadonnée seasonalDecor', 'LOT 5 : garantir une seule atmosphère et une seule feuille de police après migration.');
  report.risk('Tant que les deux hooks restent indépendants, une configuration centrale pourrait ajouter une troisième source de vérité : la migration doit les réconcilier.');

  report.setContext('emergencyStopContract', {
    workers: 3,
    staleCacheWorker: 'B',
    deadlineMs: 1000,
    prerequisite: 'canal de publication + emergencyDisable prioritaire sur toute configuration',
  });
});
