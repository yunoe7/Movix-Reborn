/**
 * LOT 4A — scénario navigateur du moteur graphique saisonnier.
 *
 * Relance : la commande exacte, avec le runtime Playwright hors dépôt et le
 * mode strict, est écrite dans le rapport généré depuis l'environnement courant.
 *
 * Monte le vrai provider du moteur avec un resolver déterministe local.
 * Aucun serveur, aucun compte, aucun secret, aucune configuration de production.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  REPO,
  buildFixtureBundle,
  commonPrerequisites,
  fixtureHtml,
  instrumentationInit,
  launchBrowser,
  mountFixture,
  readRepoFile,
  relaunchCommand,
  runScenario,
  storageInit,
  trackResource,
  writeFixtureFiles,
} from './seasonalThemeHarness.mjs';

const command = relaunchCommand(
  'SEASONAL_THEME_GRAPHICS_DIR',
  'tests/seasonalThemeGraphics.browser.mjs',
  'SEASONAL_THEME_STRICT',
);

async function createGraphicsFixture(report, options = {}) {
  const {
    query = '',
    viewport = { width: 1280, height: 900 },
    reducedMotion = 'no-preference',
    instrument = false,
    storage = {},
  } = options;

  const workDir = path.join(report.artifactDir, `fixture-${report.checks.length}-${query.replace(/[^a-z0-9]/gi, '_') || 'root'}`);
  await writeFixtureFiles(workDir, { html: fixtureHtml() });
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/graphics.tsx'));

  const browser = await trackResource(await launchBrowser());
  const context = await trackResource(await browser.newContext({ viewport, reducedMotion }));
  if (instrument) await context.addInitScript(instrumentationInit());
  if (Object.keys(storage).length > 0) await context.addInitScript(storageInit(storage));
  const requests = [];
  await mountFixture(context, { workDir, requests });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://seasonal.test/${query}`);
  await page.waitForFunction(() => Boolean(window.__graphics));
  await page.addStyleTag({ content: await readRepoFile('src/seasonalThemeGraphics/seasonalGraphics.css') });
  return { browser, context, page, requests, errors, workDir };
}

const state = (page) => page.evaluate(() => window.__graphics.state());
const metrics = (page) => page.evaluate(() => window.__seasonalMetrics?.() ?? null);

await runScenario({
  key: 'graphics',
  title: 'LOT 4A — moteur graphique saisonnier rendu, routes exclues et budgets',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'tests/seasonalThemeFixtures/graphics.tsx : vrai SeasonalGraphicsProvider avec resolver local déterministe.',
    'Resolver simulé : halloween, christmas, coexistence, conflit déjà tranché, urgence, payload invalide et indisponible.',
    'Aucun asset distant, aucune donnée de production, aucun secret ; CSS du moteur injecté depuis la source.',
  ],
}, async (report) => {
  // 1. Configuration publiée : rendu réel, non interactif.
  const published = await createGraphicsFixture(report, {
    query: '?ambiance=halloween',
    instrument: true,
    storage: { settings_halloween_theme: '0', settings_christmas_theme: '0' },
  });
  await published.page.waitForFunction(() => window.__graphics.state().active === true);
  const publishedState = await state(published.page);
  report.pass('GRAPH-01', 'Configuration publiée rendue sur page autorisée',
    'calques pour background/screenDecor/lights/particles/components, canvas, aria-hidden et zéro focus', publishedState);
  assert.equal(publishedState.active, true);
  assert.equal(publishedState.htmlAttr, 'active');
  assert.equal(publishedState.componentsAttr, 'halloween');
  assert.equal(publishedState.suppressLegacy, true);
  assert.ok(publishedState.layers >= 4);
  assert.equal(publishedState.canvas, 1);
  assert.equal(publishedState.focusableInLayer, 0);
  assert.ok(publishedState.decorations.includes('halloween.background'));
  await report.screenshot(published.page, '01-halloween-published', { fullPage: true });

  const layerAria = await published.page.locator('[data-seasonal-graphics-layer]').getAttribute('aria-hidden');
  const pointerEvents = await published.page.locator('[data-seasonal-graphics-layer]').evaluate(
    (node) => getComputedStyle(node).pointerEvents,
  );
  report.pass('GRAPH-02', 'Calque décoratif non interactif', 'aria-hidden=true et pointer-events=none', { layerAria, pointerEvents });
  assert.equal(layerAria, 'true');
  assert.equal(pointerEvents, 'none');

  // 2. Déclenchement d'une action sous le calque : aucun détournement de clic.
  const clicks = [];
  await published.page.exposeFunction('__recordClick', () => clicks.push(true));
  await published.page.locator('#action').evaluate((node) => node.addEventListener('click', () => window.__recordClick()));
  await published.page.locator('#action').click();
  await published.page.locator('#action').focus();
  const hit = await published.page.locator('#action').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { isButton: node.contains(target), focused: document.activeElement === node, scrollY: window.scrollY };
  });
  report.pass('GRAPH-03', 'Contrôles, focus et scroll préservés', 'clic reçu, bouton focalisé, aucune couche au-dessus', {
    clicks: clicks.length, ...hit,
  });
  assert.equal(clicks.length, 1);
  assert.equal(hit.isButton, true);
  assert.equal(hit.focused, true);
  await published.page.mouse.wheel(0, 400);
  assert.ok((await published.page.evaluate(() => window.scrollY)) >= 0);

  // 3. Coexistence et conflit déjà résolu par le backend.
  await published.page.evaluate(() => window.__graphics.setAmbiance('both'));
  await published.page.waitForFunction(() => window.__graphics.state().decorations.includes('christmas.background'));
  const bothState = await state(published.page);
  const ids = await published.page.locator('[data-sg-decoration]').evaluateAll((nodes) => nodes.map((node) => node.dataset.sgDecoration));
  report.pass('GRAPH-04', 'Plusieurs thèmes et décorations simultanés', 'décorations des deux thèmes, aucun doublon rendu', {
    decorations: bothState.decorations, ids,
  });
  assert.ok(bothState.decorations.includes('halloween.background'));
  assert.ok(bothState.decorations.includes('christmas.particles'));
  assert.equal(new Set(ids).size, ids.length);
  await report.screenshot(published.page, '02-both-themes', { fullPage: true });

  await published.page.evaluate(() => window.__graphics.setAmbiance('conflict'));
  await published.page.waitForFunction(() => window.__graphics.state().decorations.length === 1);
  const conflictState = await state(published.page);
  const conflictIds = await published.page.locator('[data-sg-decoration]').evaluateAll(
    (nodes) => nodes.filter((node) => node.dataset.sgDecoration?.includes('screenDecor')).map((node) => node.dataset.sgDecoration),
  );
  report.pass('GRAPH-05', 'Conflit tranché par le resolver, pas par le frontend', 'un seul screenDecor, celui transmis par le backend', {
    decorations: conflictState.decorations, conflictIds,
  });
  assert.deepEqual(conflictState.decorations, ['christmas.screenDecor']);
  assert.deepEqual(conflictIds, ['christmas.screenDecor']);

  // 4. Urgence puis réactivation depuis une nouvelle publication.
  await published.page.evaluate(() => window.__graphics.setAmbiance('emergency'));
  await published.page.waitForFunction(() => window.__graphics.state().reason === 'emergency' && !window.__graphics.state().active);
  const emergencyState = await state(published.page);
  await published.page.waitForTimeout(80);
  const framesAtEmergency = (await metrics(published.page)).animationFrames;
  await published.page.waitForTimeout(300);
  const framesAfterWait = (await metrics(published.page)).animationFrames;
  report.pass('GRAPH-06', 'Arrêt d’urgence : effets retirés et boucle arrêtée',
    'zéro calque, attribut emergency, aucune frame RAF supplémentaire', {
      layers: emergencyState.layers, particles: emergencyState.particles,
      htmlAttr: emergencyState.htmlAttr, framesAtEmergency, framesAfterWait,
    });
  assert.equal(emergencyState.layers, 0);
  assert.equal(emergencyState.particles, 0);
  assert.equal(emergencyState.htmlAttr, 'emergency');
  assert.equal(emergencyState.suppressLegacy, true);
  assert.equal(framesAfterWait, framesAtEmergency);
  await report.screenshot(published.page, '03-emergency', { fullPage: true });

  await published.page.evaluate(() => { window.__graphics.setRevision(9); window.__graphics.setAmbiance('halloween'); });
  await published.page.waitForFunction(() => window.__graphics.state().active && window.__graphics.state().revision === 9);
  const reactivated = await state(published.page);
  report.pass('GRAPH-07', 'Reprise après réactivation', 'nouvelle révision publiée, décorations rendues à nouveau', {
    revision: reactivated.revision, layers: reactivated.layers, active: reactivated.active,
  });
  assert.equal(reactivated.revision, 9);
  assert.ok(reactivated.layers > 0);
  assert.deepEqual(published.errors, []);

  // 5. Onglet masqué : la boucle RAF s'arrête sans libérer le contexte.
  // La référence est prise après la propagation de visibilitychange pour ne
  // pas compter une frame déjà programmée avant la pause.
  await published.page.evaluate(() => window.__graphics.setHidden(true));
  await published.page.waitForTimeout(80);
  const framesWhileHiddenStart = (await metrics(published.page)).animationFrames;
  await published.page.waitForTimeout(250);
  const framesWhileHidden = (await metrics(published.page)).animationFrames;
  await published.page.evaluate(() => window.__graphics.setHidden(false));
  await published.page.waitForTimeout(250);
  const framesAfterShow = (await metrics(published.page)).animationFrames;
  report.pass('GRAPH-08', 'Pause onglet masqué et reprise', 'aucune frame pendant le masque, reprise ensuite', {
    framesWhileHiddenStart, framesWhileHidden, framesAfterShow,
  });
  assert.equal(framesWhileHidden, framesWhileHiddenStart);
  assert.ok(framesAfterShow > framesWhileHidden);

  await published.context.close();
  await published.browser.close();

  // 6. Routes exclues : aucun moteur, aucun canvas, aucun appel resolver.
  for (const route of [
    '/watch/movie/123', '/ftv/watch/1', '/watchparty/room/abc', '/admin',
    '/auth/google', '/vip/don', '/link-bip39', '/wrapped',
  ]) {
    const excluded = await createGraphicsFixture(report, { query: `?route=${encodeURIComponent(route)}&ambiance=halloween` });
    const excludedState = await state(excluded.page);
    const calls = await excluded.page.evaluate(() => window.__graphics.calls());
    report.pass(`GRAPH-09-${route}`, `Route exclue ${route}`,
      'aucun calque, aucun canvas, aucun appel au resolver', {
        layerRoot: excludedState.layerRoot, canvas: excludedState.canvas,
        htmlAttr: excludedState.htmlAttr, calls: calls.length,
      });
    assert.equal(excludedState.layerRoot, 0);
    assert.equal(excludedState.canvas, 0);
    assert.equal(excludedState.htmlAttr, null);
    assert.equal(calls.length, 0);
    await excluded.context.close();
    await excluded.browser.close();
  }

  // 7. Navigation autorisée -> exclue -> autorisée : nettoyage puis reprise.
  const navigation = await createGraphicsFixture(report, { query: '?ambiance=halloween', instrument: true });
  await navigation.page.waitForFunction(() => window.__graphics.state().active === true);
  await navigation.page.evaluate(() => window.__graphics.navigate('/watch/movie/1'));
  await navigation.page.waitForFunction(() => document.querySelectorAll('[data-seasonal-graphics-layer]').length === 0);
  const afterExit = await state(navigation.page);
  report.pass('GRAPH-10', 'Sortie vers lecteur : nettoyage complet',
    'calque, canvas et attribut supprimés avant toute initialisation lecteur', afterExit);
  assert.equal(afterExit.layers, 0);
  assert.equal(afterExit.canvas, 0);
  assert.equal(afterExit.htmlAttr, null);

  await navigation.page.evaluate(() => window.__graphics.navigate('/'));
  await navigation.page.waitForFunction(() => window.__graphics.state().active === true);
  const afterReturn = await state(navigation.page);
  assert.ok(afterReturn.layers > 0);
  report.pass('GRAPH-11', 'Retour sur page autorisée', 'moteur réinitialisé proprement', afterReturn);
  await navigation.context.close();
  await navigation.browser.close();

  // 8. Fail-closed : préférence locale, payload invalide et resolver indisponible.
  const draft = await createGraphicsFixture(report, {
    query: '?ambiance=draft',
    storage: { settings_halloween_theme: '1', settings_christmas_theme: '1' },
  });
  await draft.page.waitForFunction(() => window.__graphics.state().ready === true);
  const draftState = await state(draft.page);
  report.pass('GRAPH-12', 'Préférence localStorage non publiée ignorée',
    'zéro décoration malgré les deux thèmes locaux activés', draftState);
  assert.equal(draftState.active, false);
  assert.equal(draftState.layers, 0);
  assert.equal(draftState.suppressLegacy, false);
  await draft.context.close();
  await draft.browser.close();

  for (const [ambiance, expectedReason] of [['invalid', 'invalid'], ['none', 'unavailable']]) {
    const invalid = await createGraphicsFixture(report, { query: `?ambiance=${ambiance}` });
    await invalid.page.waitForFunction(() => window.__graphics.state().ready === true);
    const invalidState = await state(invalid.page);
    report.pass(`GRAPH-13-${ambiance}`, `Configuration ${ambiance} fail-closed`,
      `raison ${expectedReason}, aucune décoration`, invalidState);
    assert.equal(invalidState.reason, expectedReason);
    assert.equal(invalidState.active, false);
    assert.equal(invalidState.layers, 0);
    await invalid.context.close();
    await invalid.browser.close();
  }

  const unavailable = await createGraphicsFixture(report, { query: '?ambiance=halloween&resolver=unavailable' });
  await unavailable.page.waitForFunction(() => window.__graphics.state().ready === true);
  const unavailableState = await state(unavailable.page);
  report.pass('GRAPH-14', 'Resolver indisponible fail-closed', 'raison unavailable, aucune décoration', unavailableState);
  assert.equal(unavailableState.reason, 'unavailable');
  assert.equal(unavailableState.layers, 0);
  await unavailable.context.close();
  await unavailable.browser.close();

  // 9. TV : styles statiques conservés, zéro frame demandée.
  const tv = await createGraphicsFixture(report, {
    query: '?ambiance=halloween&platform=tv', instrument: true,
    viewport: { width: 1920, height: 1080 },
  });
  await tv.page.waitForFunction(() => window.__graphics.state().active === true);
  await tv.page.waitForTimeout(300);
  const tvState = await state(tv.page);
  const tvMetrics = await metrics(tv.page);
  const tvCanvasDisplay = await tv.page.locator('canvas.sg-particles').evaluate((node) => getComputedStyle(node).display);
  report.pass('GRAPH-15', 'TV : identité statique sans animation',
    'calques statiques présents, zéro particule, zéro frame RAF, canvas masqué', {
      layers: tvState.layers, particles: tvState.particles, frames: tvMetrics.animationFrames, tvCanvasDisplay,
    });
  assert.equal(tvState.particles, 0);
  assert.equal(tvMetrics.animationFrames, 0);
  assert.equal(tvCanvasDisplay, 'none');
  assert.ok(tvState.layers >= 3);
  await report.screenshot(tv.page, '04-tv-static', { fullPage: true });
  await tv.context.close();
  await tv.browser.close();

  // 10. Reduced motion : mêmes styles statiques, aucune particule.
  const reduced = await createGraphicsFixture(report, {
    query: '?ambiance=halloween', reducedMotion: 'reduce', instrument: true,
  });
  await reduced.page.waitForFunction(() => window.__graphics.state().active === true);
  await reduced.page.waitForTimeout(300);
  const reducedState = await state(reduced.page);
  const reducedMetrics = await metrics(reduced.page);
  report.pass('GRAPH-16', 'prefers-reduced-motion : mouvement supprimé',
    'calques statiques conservés, zéro particule, zéro frame RAF', {
      layers: reducedState.layers, particles: reducedState.particles, frames: reducedMetrics.animationFrames,
    });
  assert.equal(reducedState.particles, 0);
  assert.equal(reducedMetrics.animationFrames, 0);
  assert.ok(reducedState.layers >= 3);
  await report.screenshot(reduced.page, '05-reduced-motion', { fullPage: true });
  await reduced.context.close();
  await reduced.browser.close();

  // 11. Mobile : budget réduit et canvas borné.
  const mobile = await createGraphicsFixture(report, {
    query: '?ambiance=halloween', instrument: true,
    viewport: { width: 390, height: 844 },
  });
  await mobile.page.waitForFunction(() => window.__graphics.state().active === true);
  const mobileState = await state(mobile.page);
  const mobileMetrics = await metrics(mobile.page);
  report.pass('GRAPH-17', 'Mobile : budget particules et canvas mesurés',
    '18 particules maximum, canvas <= 12 MiB', {
      particles: mobileState.particles, canvasBytes: mobileMetrics.canvasBytes,
    });
  assert.equal(mobileState.particles, 18);
  assert.ok(mobileMetrics.canvasBytes > 0);
  assert.ok(mobileMetrics.canvasBytes <= 12 * 1024 * 1024);
  await report.screenshot(mobile.page, '06-mobile', { fullPage: true });
  await mobile.context.close();
  await mobile.browser.close();

  // 12. FR/EN : le moteur ne modifie ni les textes ni la langue de la page.
  const locale = await createGraphicsFixture(report, {
    query: '?ambiance=christmas',
    storage: { user_language: 'fr' },
  });
  await locale.page.waitForFunction(() => window.__graphics.state().active === true);
  await locale.page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.textContent === 'Accueil');
  const frText = await locale.page.locator('[data-testid="content"]').textContent();
  const frState = await state(locale.page);
  await report.screenshot(locale.page, '07-fr', { fullPage: true });

  await locale.page.evaluate(() => window.__graphics.setLanguage('en'));
  await locale.page.waitForFunction(() => document.querySelector('[data-testid="content"]')?.textContent === 'Home');
  const enText = await locale.page.locator('[data-testid="content"]').textContent();
  const enState = await state(locale.page);
  const htmlLang = await locale.page.locator('html').getAttribute('lang');
  report.pass('GRAPH-18', 'FR/EN : effets identiques et textes traduits préservés',
    'Accueil/Home rendus avec le même jeu de calques actif', {
      frText, enText, htmlLang, frLayers: frState.layers, enLayers: enState.layers,
      frActive: frState.active, enActive: enState.active,
    });
  assert.equal(frText, 'Accueil');
  assert.equal(enText, 'Home');
  assert.equal(htmlLang, 'en');
  assert.equal(frState.active, true);
  assert.equal(enState.active, true);
  assert.equal(frState.layers, enState.layers);
  await report.screenshot(locale.page, '08-en', { fullPage: true });
  await locale.context.close();
  await locale.browser.close();

  report.risk('La propagation d’urgence multi-workers en moins d’une seconde reste non mesurable sans Redis de production : le polling public est de 20 s et le rafraîchissement est immédiat au retour de l’onglet.');
  report.risk('La prévisualisation d’administration affiche encore la structure du brouillon sans rendu graphique LOT 4A (limitée au LOT 3).');
  report.risk('Les systèmes Halloween/Noël historiques pilotés par localStorage restent actifs hors configuration publiée ; leur migration complète relève du LOT 5.');
  report.setContext('limits', {
    particlesDesktop: 42, particlesMobile: 18, particlesTv: 0,
    maxCanvasBytes: 12 * 1024 * 1024, refreshMs: 20000,
  });
});
