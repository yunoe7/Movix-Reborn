/**
 * LOT 3 — scénario navigateur de la console « Décoratif » réelle.
 *
 * Relance :
 *   $env:SEASONAL_THEME_ADMIN_DIR='<hors-depot>'
 *   node tests/seasonalThemeAdmin.browser.mjs
 *
 * Le composant est monté avec i18next, le fournisseur de confirmation et une
 * fetch locale déterministe. Aucun serveur, aucun compte, aucun secret et
 * aucune donnée simulée présentée comme réelle : la fixture décrit
 * explicitement les réponses d'API qu'elle remplace.
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

const mountAdmin = async (report, language, query = '') => {
  const workDir = path.join(report.artifactDir, `fixture-admin-${language}-${query ? 'conflict' : 'nominal'}`);
  await writeFixtureFiles(workDir, {
    html: fixtureHtml({ title: 'Console Décoratif', body: '<div id="root"></div>' }),
  });
  const shellCss = await readRepoFile('src/components/admin/admin-console.css');
  const decorCss = await readRepoFile('src/components/adminDecor/adminDecor.css');
  await writeFile(path.join(workDir, 'app.css'), [
    'html,body,#root{min-height:100%;background:#07070a;color:#f8fafc}',
    shellCss,
    decorCss,
  ].join('\n'), 'utf8');
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/admin.tsx'));

  const browser = await launchBrowser();
  const context = trackResource(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await context.addInitScript(freezeDateInit('2026-10-28T12:00:00+02:00'));
  await mountFixture(context, { workDir });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const suffix = query ? `${query}&` : '';
  await page.goto(`https://seasonal.test/?${suffix}lng=${language}`);
  await page.waitForSelector('[data-testid="admin-decor"]');
  await page.waitForSelector('[data-testid="admin-decor-stat-themes"]');
  return { browser, context, page, errors, workDir };
};

const readTabLabels = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('.admin-decor-tab'),
  (node) => node.textContent.trim(),
).filter(Boolean));

const adminCalls = (page) => page.evaluate(() => window.__seasonalAdminCalls);

await runScenario({
  key: 'admin',
  title: 'LOT 3 — console Décoratif réelle : publication, conflit, urgence et aperçu',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Composant AdminDecor réel monté avec AdminConfirmProvider, i18next et les locales FR/EN du dépôt.',
    'Fetch local déterministe : GET config/status/history/audit, PUT et POST LOT 2 ; mode ?conflict=1 simule un 409.',
    'Horloge figée au 28 octobre 2026 ; aucun serveur, aucun compte admin, aucun secret.',
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
  const frTabs = await readTabLabels(fr.page);
  const frText = await fr.page.locator('[data-testid="admin-decor"]').innerText();
  const frCalls = await adminCalls(fr.page);
  const frSummary = {
    tabs: frTabs,
    stats: await fr.page.evaluate(() => ({
      themes: document.querySelector('[data-testid="admin-decor-stat-themes"] .admin-stat-value')?.textContent,
      active: document.querySelector('[data-testid="admin-decor-stat-active"] .admin-stat-value')?.textContent,
      decorations: document.querySelector('[data-testid="admin-decor-stat-decorations"] .admin-stat-value')?.textContent,
      revision: document.querySelector('[data-testid="admin-decor-stat-revision"] .admin-stat-value')?.textContent,
    })),
    calls: frCalls.map((call) => `${call.method} ${new URL(call.url).pathname}`),
    bearer: frCalls.every((call) => call.authorization === 'Bearer fixture-admin-token'),
    noStore: frCalls.every((call) => call.cache === 'no-store'),
    forms: await fr.page.locator('form').count(),
  };
  report.pass('ADMIN-02', 'Tableau de bord réel et catalogue fermé', 'six onglets, compteurs issus des endpoints, jeton Bearer, no-store, aucune donnée simulée', frSummary, {
    statuts: 'réel',
  });
  assert.deepEqual(frTabs, ['Tableau de bord', 'Thèmes & décorations', 'Programmation', 'Publication', 'Historique & audit', 'Aperçu']);
  assert.deepEqual(frSummary.stats, { themes: '1', active: '1', decorations: '1', revision: '4' });
  assert.equal(frCalls.length, 4);
  assert.ok(frText.includes('Canal de publication'));
  assert.ok(frText.includes('Le canal signale l’abonnement du worker courant'));
  assert.ok(frSummary.bearer);
  assert.ok(frSummary.noStore);
  assert.equal(frSummary.forms, 0);
  assert.deepEqual(fr.errors, []);
  await report.screenshot(fr.page, '01-admin-decor-dashboard-fr', { fullPage: true });

  await fr.page.locator('#admin-decor-tab-themes').click();
  const themeText = await fr.page.locator('[data-testid="admin-decor"]').innerText();
  const addThemeLabel = await fr.page.getByRole('button', { name: /Ajouter un thème du catalogue/ }).count();
  assert.ok(themeText.includes('halloween-2026'));
  assert.ok(themeText.includes('halloween.screenDecor'));
  assert.equal(addThemeLabel, 1);
  await report.screenshot(fr.page, '02-admin-decor-themes-fr', { fullPage: true });

  const en = await mountAdmin(report, 'en');
  const enTabs = await readTabLabels(en.page);
  report.pass('ADMIN-03', 'Localisation FR/EN synchronisée', 'les six onglets sont traduits en anglais', enTabs);
  assert.deepEqual(enTabs, ['Dashboard', 'Themes & decorations', 'Scheduling', 'Publishing', 'History & audit', 'Preview']);
  assert.deepEqual(en.errors, []);
  await report.screenshot(en.page, '03-admin-decor-dashboard-en', { fullPage: true });

  const frLocale = JSON.parse(await readRepoFile('src/i18n/locales/fr.json'));
  const enLocale = JSON.parse(await readRepoFile('src/i18n/locales/en.json'));
  const decorKeys = Object.keys(frLocale.admin.decor);
  const missingInEn = decorKeys.filter((key) => !(key in enLocale.admin.decor));
  const emptyInEn = decorKeys.filter((key) => typeof enLocale.admin.decor[key] !== 'string' || enLocale.admin.decor[key].trim() === '');
  const staleConsole = ['decorDesc', 'decorEyebrow', 'decorIntroTitle', 'decorIntroDesc', 'decorEmptyTitle', 'decorEmptyDesc'];
  const staleFr = staleConsole.filter((key) => /préparation|pas encore|arriveront/i.test(frLocale.admin.console[key]));
  report.pass('ADMIN-04', 'Parité i18n et textes périmés', 'toutes les clés admin.decor existent en EN, aucun texte de placeholder restant', {
    keyCount: decorKeys.length,
    missingInEn,
    emptyInEn,
    staleFr,
  });
  assert.deepEqual(missingInEn, []);
  assert.deepEqual(emptyInEn, []);
  assert.deepEqual(staleFr, []);

  const routes = await readRepoFile('API/Mainapi/routes/seasonalTheme.js');
  const appSource = await readRepoFile('API/Mainapi/app.js');
  const expectedRoutes = [
    "router.get('/seasonal-theme'",
    "router.get('/seasonal-theme/resolve'",
    "router.get('/admin/seasonal-theme'",
    "router.put('/admin/seasonal-theme'",
    "router.post('/admin/seasonal-theme/decorations/disable'",
    "router.post('/admin/seasonal-theme/emergency-disable'",
    "router.post('/admin/seasonal-theme/cache/invalidate'",
    "router.get('/admin/seasonal-theme/status'",
    "router.get('/admin/seasonal-theme/history'",
    "router.get('/admin/seasonal-theme/audit'",
  ];
  const routeChecks = expectedRoutes.map((route) => ({ route, present: routes.includes(route) }));
  const mountedAtApi = appSource.includes("app.use('/api', require('./routes/seasonalTheme').router)");
  report.pass('ADMIN-05', 'Toutes les actions reposent sur les routes LOT 2', 'les dix routes du routeur sont présentes et montées sous /api', {
    mountedAtApi,
    routeChecks,
  });
  assert.ok(mountedAtApi);
  assert.ok(routeChecks.every((entry) => entry.present));

  await fr.page.locator('#theme-enabled-halloween-2026').click();
  await fr.page.locator('#admin-decor-tab-publish').click();
  const patchText = await fr.page.locator('[data-testid="admin-decor-patch"]').innerText();
  assert.ok(patchText.includes('"enabled": false'));
  const publishButton = fr.page.locator('[data-testid="admin-decor-publish"]');
  assert.equal(await publishButton.isEnabled(), true);
  await fr.page.locator('#admin-decor-reason').fill('vérification E2E LOT 3');
  await publishButton.click();
  const publishDialog = fr.page.getByRole('dialog');
  await publishDialog.waitFor();
  await publishDialog.getByRole('button', { name: 'Publier', exact: true }).click();
  await fr.page.waitForFunction(() => window.__seasonalAdminCalls.some((call) => call.method === 'PUT'));
  const publishCall = (await adminCalls(fr.page)).find((call) => call.method === 'PUT');
  report.pass('ADMIN-06', 'Publication confirmée et versionnée', 'PUT avec patch minimal, motif et révision attendue, aucune publication automatique', {
    url: publishCall.url,
    body: publishCall.body,
    callsBeforeConfirm: frCalls.length,
  });
  assert.equal(publishCall.url, 'https://main-api.test/api/admin/seasonal-theme');
  assert.equal(publishCall.body.expectedRevision, 4);
  assert.equal(publishCall.body.reason, 'vérification E2E LOT 3');
  assert.deepEqual(publishCall.body.patch.themes, [{ id: 'halloween-2026', enabled: false }]);
  await report.screenshot(fr.page, '04-admin-decor-publish-fr', { fullPage: true });

  await fr.page.locator('#admin-decor-tab-dashboard').click();
  await fr.page.getByRole('button', { name: 'Arrêter', exact: true }).click();
  const emergencyDialog = fr.page.getByRole('dialog');
  await emergencyDialog.waitFor();
  await emergencyDialog.getByRole('button', { name: 'Arrêter', exact: true }).click();
  await fr.page.waitForFunction(() => window.__seasonalAdminCalls.some((call) => call.url.includes('/emergency-disable')));
  const emergencyCall = (await adminCalls(fr.page)).find((call) => call.url.includes('/emergency-disable'));
  report.pass('ADMIN-07', 'Arrêt d’urgence distinct et confirmé', 'POST emergency-disable avec enabled=true et révision courante', emergencyCall);
  assert.equal(emergencyCall.method, 'POST');
  assert.equal(emergencyCall.body.enabled, true);
  assert.equal(emergencyCall.body.expectedRevision, 5);

  await fr.page.locator('#admin-decor-tab-preview').click();
  const beforePreview = (await adminCalls(fr.page)).length;
  await fr.page.locator('#preview-platform').selectOption('tv');
  await fr.page.locator('#preview-capabilities-tvStaticEffects').check();
  const previewText = await fr.page.locator('[data-testid="admin-decor"]').innerText();
  const afterPreview = (await adminCalls(fr.page)).length;
  report.pass('ADMIN-08', 'Aperçu isolé et honnête', 'brouillon local, aucun appel de publication, mention explicite LOT 4', {
    beforePreview,
    afterPreview,
    hasNotice: previewText.includes('Aperçu administratif — non public'),
    hasDraftBadge: previewText.includes('Brouillon — non publié'),
    hasLot4Boundary: previewText.includes('Les moteurs graphiques du LOT 4 ne sont pas disponibles'),
  });
  assert.equal(beforePreview, afterPreview);
  assert.ok(previewText.includes('Aperçu administratif — non public'));
  assert.ok(previewText.includes('Brouillon — non publié'));
  assert.ok(previewText.includes('Les moteurs graphiques du LOT 4 ne sont pas disponibles'));
  assert.deepEqual(fr.errors, []);
  await report.screenshot(fr.page, '05-admin-decor-preview-fr', { fullPage: true });

  await fr.page.locator('#admin-decor-tab-dashboard').focus();
  await fr.page.keyboard.press('ArrowRight');
  const keyboard = await fr.page.evaluate(() => ({
    activeId: document.activeElement?.id,
    selected: document.querySelector('[aria-selected="true"]')?.id,
  }));
  const reducedMotionCss = await readRepoFile('src/components/adminDecor/adminDecor.css');
  report.pass('ADMIN-09', 'Navigation clavier et mouvement réduit', 'ArrowRight déplace le focus et le choix des onglets ; CSS reduced-motion présent', {
    keyboard,
    reducedMotionRule: reducedMotionCss.includes('@media (prefers-reduced-motion: reduce)'),
  });
  assert.equal(keyboard.activeId, 'admin-decor-tab-themes');
  assert.equal(keyboard.selected, 'admin-decor-tab-themes');
  assert.ok(reducedMotionCss.includes('@media (prefers-reduced-motion: reduce)'));

  const conflict = await mountAdmin(report, 'fr', 'conflict=1');
  await conflict.page.locator('#admin-decor-tab-themes').click();
  await conflict.page.locator('#theme-enabled-halloween-2026').click();
  await conflict.page.locator('#admin-decor-tab-publish').click();
  await conflict.page.locator('[data-testid="admin-decor-publish"]').click();
  await conflict.page.getByRole('dialog').getByRole('button', { name: 'Publier', exact: true }).click();
  await conflict.page.waitForSelector('[data-state="warning"]');
  const conflictText = await conflict.page.locator('[data-testid="admin-decor"]').innerText();
  const conflictPatch = await conflict.page.locator('[data-testid="admin-decor-patch"]').innerText();
  report.pass('ADMIN-10', 'Conflit 409 : révision distante reprise sans perte', 'avertissement affiché, modifications locales conservées dans le patch', {
    hasWarning: conflictText.includes('Conflit de révision détecté'),
    remoteMention: conflictText.includes('La révision distante est 6'),
    preserved: conflictPatch.includes('"enabled": false'),
  });
  assert.ok(conflictText.includes('Conflit de révision détecté'));
  assert.ok(conflictText.includes('La révision distante est 6'));
  assert.ok(conflictPatch.includes('"enabled": false'));
  assert.deepEqual(conflict.errors, []);
  await report.screenshot(conflict.page, '06-admin-decor-conflict-fr', { fullPage: true });

  await fr.page.locator('#admin-decor-tab-history').click();
  const historyText = await fr.page.locator('[data-testid="admin-decor"]').innerText();
  const auditCells = await fr.page.locator('.admin-decor-table').count();
  report.pass('ADMIN-11', 'Historique et audit réels', 'deux tableaux alimentés par les endpoints, aucun faux journal', {
    history: historyText.includes('campagne Halloween'),
    audit: historyText.includes('staff-42'),
    tableCount: auditCells,
  });
  assert.ok(historyText.includes('campagne Halloween'));
  assert.ok(historyText.includes('staff-42'));
  assert.equal(auditCells, 2);

  report.blocked(
    'ADMIN-12',
    'Arrêt d’urgence multi-workers < 1 s',
    '3 workers abonnés, Redis périmé sur 1 worker, propagation < 1000 ms mesurée sur les 3',
    'Le LOT 2 fournit le canal et la priorité d’urgence, mais aucun worker de rendu ni Redis de production n’est démarré dans ce test.',
    'Procédure de rejeu : démarrer 3 workers, injecter une valeur Redis périmée sur le worker B, publier emergencyDisable=true, horodater la réception sur A/B/C et exiger max − min < 1000 ms.',
  );
  report.blocked(
    'ADMIN-13',
    'Migration des anciens systèmes sans double affichage',
    'registre unique avec alias halloween/christmas vers une seule source de vérité',
    'LOT 5 : les hooks historiques restent indépendants dans ce checkout.',
    'Vérifier après migration qu’une seule atmosphère et une seule feuille de police sont actives.',
  );
  report.risk('La console n’affiche pas « workers synchronisés » : le statut dérive de subscribed, failClosed et emergency, sans mesurer chaque worker.');
  report.setContext('publishing', {
    expectedRevisionSent: publishCall.body.expectedRevision,
    automaticPublish: false,
    previewWrites: afterPreview - beforePreview,
    conflictMode: '?conflict=1',
  });
});
