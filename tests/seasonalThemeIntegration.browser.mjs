/**
 * LOT 5 — scénario navigateur d'intégration des moteurs LOT 4A/4B.
 *
 * Relance : la commande exacte est écrite dans le rapport généré depuis
 * l'environnement courant (runtime Playwright hors dépôt inclus).
 *
 * Monte le vrai provider, les deux vrais moteurs et les vraies atmosphères
 * historiques. Le resolver est local et déterministe : aucun serveur, aucun
 * compte, aucun secret, aucune configuration de production.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  REPO,
  buildFixtureBundle,
  buildFixtureCss,
  commonPrerequisites,
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
  'SEASONAL_THEME_INTEGRATION_DIR',
  'tests/seasonalThemeIntegration.browser.mjs',
  'SEASONAL_THEME_STRICT',
);

// Aucune feuille de style n'est liée par défaut : les routes exclues ne doivent
// générer aucune requête d'asset, y compris une feuille de test.
const fixtureHtml = () => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Intégration saisonnière</title></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

/** Compte les listeners posés/retirés par type, sans toucher aux handlers. */
function listenerInit() {
  return `(() => {
    const added = Object.create(null);
    const removed = Object.create(null);
    const patch = (target) => {
      const add = target.addEventListener;
      target.addEventListener = function (type, ...args) {
        added[type] = (added[type] || 0) + 1;
        return Reflect.apply(add, this, [type, ...args]);
      };
      const remove = target.removeEventListener;
      target.removeEventListener = function (type, ...args) {
        removed[type] = (removed[type] || 0) + 1;
        return Reflect.apply(remove, this, [type, ...args]);
      };
    };
    patch(window);
    patch(document);
    window.__listenerCounts = () => ({
      added: { ...added },
      removed: { ...removed },
    });
  })();`;
}

function failFontInit() {
  return `(() => {
    if (typeof FontFace !== 'undefined' && FontFace.prototype.load) {
      const original = FontFace.prototype.load;
      FontFace.prototype.load = function (...args) {
        if (String(this.family).includes('Creepster')) {
          return Promise.reject(new Error('police Creepster indisponible'));
        }
        return Reflect.apply(original, this, args);
      };
    }
  })();`;
}

const isFontRequest = (entry) => /\/fonts\/seasonal-theme\/|fonts\.(googleapis|gstatic)\.com|\.woff2?($|\?)/.test(entry.url);
const isLegacyAsset = (entry) => /halloween-decor|christmas-atmosphere|halloween-ui/.test(entry.url);

async function createFixture(report, options = {}) {
  const {
    query = '',
    viewport = { width: 1280, height: 900 },
    reducedMotion = 'no-preference',
    instrument = false,
    style = false,
    trace = false,
    extraInit = [],
  } = options;

  const slug = query.replace(/[^a-z0-9]/gi, '_') || 'root';
  const workDir = path.join(report.artifactDir, `fixture-${report.checks.length}-${slug}`);
  await writeFixtureFiles(workDir, { html: fixtureHtml() });
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/integration.tsx'));
  let cssPath = null;
  if (style) {
    cssPath = await buildFixtureCss(workDir, {
      contentFiles: [
        'src/index.css',
        'src/styles/halloween-ui.css',
        'src/styles/halloween-decor.css',
        'src/components/christmas-atmosphere.css',
        'tests/seasonalThemeFixtures/integration.tsx',
      ],
    });
  }

  const browser = await trackResource(await launchBrowser());
  const context = await trackResource(await browser.newContext({ viewport, reducedMotion }));
  await context.addInitScript(storageInit({
    settings_halloween_theme: '1',
    settings_christmas_theme: '1',
  }));
  if (instrument) await context.addInitScript(instrumentationInit());
  await context.addInitScript(listenerInit());
  for (const script of extraInit) await context.addInitScript(script);

  const requests = [];
  await mountFixture(context, { workDir, requests });
  if (trace) await report.startTrace(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://seasonal.test/${query}`);
  await page.waitForFunction(() => Boolean(window.__integration));
  if (cssPath) await page.addStyleTag({ path: cssPath });
  return { browser, context, page, requests, errors, workDir };
}

const state = (page) => page.evaluate(() => window.__integration.state());
const metrics = (page) => page.evaluate(() => window.__seasonalMetrics?.() ?? null);
const listeners = (page) => page.evaluate(() => window.__listenerCounts?.() ?? null);

async function navigate(page, route) {
  await page.evaluate((next) => window.__integration.navigate(next), route);
  await page.waitForFunction((expected) => window.__integration.state().pathname === expected, route);
}

await runScenario({
  key: 'integration',
  title: 'LOT 5 — intégration graphique/typographique, exclusions et migration des thèmes',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'tests/seasonalThemeFixtures/integration.tsx : vrai provider LOT 4A/4B, vraies atmosphères Halloween/Noël et resolver local déterministe.',
    'Réglages locaux Halloween et Noël activés dans chaque fixture pour exercer la migration, sans donnée de production.',
    'Aucun serveur de développement, aucun appel réseau externe, aucun secret.',
  ],
}, async (report) => {
  // 1. Coexistence des deux moteurs et absence de double rendu historique.
  const main = await createFixture(report, {
    query: '?ambiance=both',
    instrument: true,
    style: true,
    trace: true,
  });
  await main.page.waitForFunction(() => {
    const current = window.__integration.state();
    return current.active === true && current.styleCount === 1;
  });
  await main.page.waitForFunction(() => Array.from(document.fonts)
    .some((face) => face.family.includes('Archivo Black') && face.status === 'loaded'));
  const coexistence = await state(main.page);
  report.pass('INT-01', 'Coexistence des moteurs et instance unique',
    'un seul provider/canvas, calques et feuille typographique actifs, atmosphères historiques absentes',
    coexistence);
  assert.equal(coexistence.layerRoots, 1);
  assert.equal(coexistence.canvas, 1);
  assert.equal(coexistence.styleCount, 1);
  assert.equal(coexistence.typographyAttr, 'active');
  assert.equal(coexistence.suppressLegacy, true);
  assert.equal(coexistence.legacyHalloween, 0);
  assert.equal(coexistence.legacyChristmas, 0);
  assert.equal(coexistence.halloweenClass, false);
  assert.equal(coexistence.christmasClass, false);
  assert.equal(coexistence.focusableInLayer, 0);
  assert.ok(coexistence.layers >= 3);
  await report.screenshot(main.page, '01-coexistence', { fullPage: true });

  // 2. Cas individuel Halloween.
  await main.page.evaluate(() => window.__integration.setAmbiance('halloween'));
  await main.page.waitForFunction(() => {
    const current = window.__integration.state();
    return current.decorations.length > 0
      && current.decorations.every((id) => id.startsWith('halloween'))
      && current.styleText.includes('Creepster');
  });
  const halloweenOnly = await state(main.page);
  const halloweenTypography = {
    decorations: halloweenOnly.decorations,
    creepster: halloweenOnly.styleText.includes('Creepster'),
    archivo: halloweenOnly.styleText.includes('Archivo Black'),
  };
  report.pass('INT-02', 'Moteur Halloween seul', 'décorations et typographie Halloween uniquement', halloweenTypography);
  assert.equal(halloweenTypography.archivo, false);
  assert.ok(halloweenTypography.creepster);

  // 3. Cas individuel Noël.
  await main.page.evaluate(() => window.__integration.setAmbiance('christmas'));
  await main.page.waitForFunction(() => {
    const current = window.__integration.state();
    return current.decorations.every((id) => id.startsWith('christmas'))
      && current.styleText.includes('Archivo Black');
  });
  const christmasOnly = await state(main.page);
  const christmasTypography = {
    decorations: christmasOnly.decorations,
    creepster: christmasOnly.styleText.includes('Creepster'),
    archivo: christmasOnly.styleText.includes('Archivo Black'),
  };
  report.pass('INT-03', 'Moteur Noël seul', 'décorations et typographie Noël uniquement', christmasTypography);
  assert.equal(christmasTypography.creepster, false);
  assert.ok(christmasTypography.archivo);

  // 4. Conflit déjà tranché par le resolver : aucun rerank local.
  await main.page.evaluate(() => window.__integration.setAmbiance('conflict'));
  await main.page.waitForFunction(() => window.__integration.state().decorations.length === 1);
  const conflict = await state(main.page);
  report.pass('INT-04', 'Conflit et priorité issus du resolver',
    'le seul gagnant transmis est rendu, sans réactivation locale', {
      decorations: conflict.decorations, layers: conflict.layers,
    });
  assert.deepEqual(conflict.decorations, ['christmas.screenDecor']);

  // 5. Arrivée directe sur un lecteur : aucun moteur, aucun asset, aucun thème historique.
  const player = await createFixture(report, { query: '?route=%2Fwatch%2Fmovie%2F12&ambiance=halloween' });
  await player.page.waitForTimeout(250);
  const playerState = await state(player.page);
  const playerFonts = player.requests.filter(isFontRequest).map((entry) => entry.url);
  const playerLegacy = player.requests.filter(isLegacyAsset).map((entry) => entry.pathname);
  report.pass('INT-05', 'Route lecteur exclue avant initialisation',
    'zéro appel resolver, police, canvas, calque ou décor historique', {
      ...playerState, fontRequests: playerFonts, legacyRequests: playerLegacy,
    });
  assert.equal(playerState.callsCount, 0);
  assert.equal(playerState.layerRoots, 0);
  assert.equal(playerState.canvas, 0);
  assert.equal(playerState.styleCount, 0);
  assert.equal(playerState.legacyHalloween, 0);
  assert.equal(playerState.legacyChristmas, 0);
  assert.equal(playerState.halloweenClass, false);
  assert.equal(playerState.christmasClass, false);
  assert.equal(playerState.halloweenAttr, false);
  assert.equal(playerState.christmasAttr, false);
  assert.deepEqual(playerFonts, []);
  assert.deepEqual(playerLegacy, []);
  await report.screenshot(player.page, '02-excluded-player', { fullPage: true });

  // 6. Route non déclarée : défaut restrictif.
  const unknown = await createFixture(report, { query: '?route=%2Froute-inconnue&ambiance=halloween' });
  await unknown.page.waitForTimeout(250);
  const unknownState = await state(unknown.page);
  report.pass('INT-06', 'Défaut restrictif sur route non déclarée',
    'aucune initialisation, comme sur une route explicitement sensible', unknownState);
  assert.equal(unknownState.callsCount, 0);
  assert.equal(unknownState.layerRoots, 0);
  assert.equal(unknownState.canvas, 0);
  assert.equal(unknownState.legacyHalloween, 0);
  assert.equal(unknownState.legacyChristmas, 0);
  assert.deepEqual(unknown.requests.filter(isFontRequest).map((entry) => entry.url), []);

  // 7. Liste stricte : métadonnées et réglages locaux ne peuvent pas réactiver le moteur.
  const sensitive = ['/settings/security', '/admin', '/oauth/authorize', '/vip/don',
    '/wrapped/2026', '/profile-selection', '/login-bip39'];
  const beforeSensitive = (await state(main.page)).callsCount;
  for (const route of sensitive) {
    await navigate(main.page, route);
    const current = await state(main.page);
    assert.equal(current.callsCount, beforeSensitive, `appel resolver sur ${route}`);
    assert.equal(current.layerRoots, 0, `calque sur ${route}`);
    assert.equal(current.legacyHalloween, 0, `Halloween historique sur ${route}`);
  }
  report.pass('INT-07', 'Liste stricte prioritaire sur les métadonnées',
    'aucun appel ni rendu sur les routes sensibles déclarées', {
      routes: sensitive, callsBefore: beforeSensitive, callsAfter: (await state(main.page)).callsCount,
    });

  // 8. Cycle complet route autorisée → exclue : listeners compensés et RAF arrêté.
  await navigate(main.page, '/');
  await main.page.evaluate(() => window.__integration.setAmbiance('halloween'));
  await main.page.waitForFunction(() => window.__integration.state().active === true
    && window.__integration.state().particles > 0);
  await navigate(main.page, '/watchparty/room/ABC');
  await main.page.waitForTimeout(350);
  const beforeCycle = {
    listeners: await listeners(main.page),
    metrics: await metrics(main.page),
  };
  await navigate(main.page, '/');
  await main.page.waitForFunction(() => window.__integration.state().active === true
    && window.__integration.state().particles > 0);
  await navigate(main.page, '/watchparty/room/ABC');
  await main.page.waitForTimeout(350);
  const afterCycle = {
    listeners: await listeners(main.page),
    metrics: await metrics(main.page),
  };
  const engineEvents = ['visibilitychange', 'focus', 'resize', 'online'];
  const listenerDelta = Object.fromEntries(engineEvents.map((type) => [type, {
    added: (afterCycle.listeners.added[type] || 0) - (beforeCycle.listeners.added[type] || 0),
    removed: (afterCycle.listeners.removed[type] || 0) - (beforeCycle.listeners.removed[type] || 0),
  }]));
  const framesAfterFirst = afterCycle.metrics.animationFrames;
  await main.page.waitForTimeout(250);
  const framesAfterWait = (await metrics(main.page)).animationFrames;
  const cleaned = await state(main.page);
  report.pass('INT-08', 'Nettoyage des listeners, timers et canvas à la sortie de route',
    'listeners du moteur compensés sur un cycle complet, RAF arrêté, canvas démonté', {
      listenerDelta, framesAfterFirst, framesAfterWait, cleaned,
    });
  for (const [type, delta] of Object.entries(listenerDelta)) {
    assert.ok(delta.added > 0, `listener ${type} pas exercé`);
    assert.equal(delta.added, delta.removed, `listener ${type} non compensé`);
  }
  assert.equal(framesAfterWait, framesAfterFirst);
  assert.equal(cleaned.layerRoots, 0);
  assert.equal(cleaned.styleCount, 0);

  // 9. Aucune duplication après navigation entre routes autorisées.
  await navigate(main.page, '/movies');
  await navigate(main.page, '/');
  await main.page.waitForFunction(() => window.__integration.state().active === true);
  const unique = await state(main.page);
  report.pass('INT-09', 'Instance unique après navigation',
    'un seul canvas et un seul calque, aucune décorations dupliquée', unique);
  assert.equal(unique.layerRoots, 1);
  assert.equal(unique.canvas, 1);

  // 10. Contrôles du lecteur préservés sur route exclue.
  await navigate(main.page, '/watch/movie/42');
  await main.page.evaluate(() => {
    window.__clicked = 0;
    document.getElementById('action').addEventListener('click', () => { window.__clicked += 1; });
  });
  await main.page.locator('#action').click();
  const playerControls = await main.page.evaluate(() => ({
    clicks: window.__clicked,
    focused: document.activeElement?.id === 'action',
    text: document.getElementById('page-title')?.textContent,
  }));
  const hlsSource = await readRepoFile('src/components/HLSPlayer.tsx');
  const pumpkinPreserved = (hlsSource.match(/halloweenTheme \? \(/g) || []).length === 2;
  report.pass('INT-10', 'Lecteur et WatchParty : contrôles et progression préservés',
    'clic et focus inchangés, citrouille de progression conservée dans HLSPlayer', {
      ...playerControls, pumpkinPreserved,
    });
  assert.equal(playerControls.clicks, 1);
  assert.equal(playerControls.focused, true);
  assert.equal(pumpkinPreserved, true);

  // 11. Urgence : les deux moteurs sont effacés ensemble.
  await navigate(main.page, '/');
  await main.page.evaluate(() => window.__integration.setAmbiance('emergency'));
  await main.page.waitForFunction(() => window.__integration.state().reason === 'emergency');
  const emergency = await state(main.page);
  report.pass('INT-11', 'Arrêt d’urgence des deux moteurs',
    'aucun calque ni feuille typographique, état emergency, atmosphères suspendues', emergency);
  assert.equal(emergency.layers, 0);
  assert.equal(emergency.styleCount, 0);
  assert.equal(emergency.graphicsAttr, 'emergency');
  assert.equal(emergency.legacyHalloween, 0);

  // 12. Mouvement réduit : aucun effet animé, typographie statique conservée.
  const reduced = await createFixture(report, {
    query: '?ambiance=both',
    reducedMotion: 'reduce',
    instrument: true,
  });
  await reduced.page.waitForFunction(() => window.__integration.state().styleCount === 1);
  const reducedBefore = (await metrics(reduced.page)).animationFrames;
  await reduced.page.waitForTimeout(300);
  const reducedAfter = (await metrics(reduced.page)).animationFrames;
  const reducedState = await state(reduced.page);
  report.pass('INT-12', 'prefers-reduced-motion respecté',
    'zéro particule et aucune frame RAF, feuille typographique statique', {
      particles: reducedState.particles, reducedBefore, reducedAfter,
      animatedCss: /@keyframes|animation\s*:/.test(reducedState.styleText),
    });
  assert.equal(reducedState.particles, 0);
  assert.equal(reducedAfter, reducedBefore);
  assert.equal(/@keyframes|animation\s*:/.test(reducedState.styleText), false);

  // 13. TV : capacité tvStaticEffects, effets statiques et navigation conservée.
  const tv = await createFixture(report, { query: '?ambiance=both&platform=tv' });
  await tv.page.waitForFunction(() => window.__integration.state().styleCount === 1);
  const tvState = await state(tv.page);
  report.pass('INT-13', 'TV statique', 'plateforme tv, zéro particule, calques et typographie conservés', {
    platform: tvState.platform, particles: tvState.particles, layers: tvState.layers,
    typographyAttr: tvState.typographyAttr,
  });
  assert.equal(tvState.platform, 'tv');
  assert.equal(tvState.particles, 0);
  assert.ok(tvState.layers > 0);
  assert.equal(tvState.typographyAttr, 'active');

  // 14. Mobile et tablette : aucun débordement ni interception de clic.
  const responsive = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
    const fixture = await createFixture(report, {
      query: '?ambiance=both',
      viewport,
      style: true,
    });
    await fixture.page.waitForFunction(() => window.__integration.state().active === true);
    const geometry = await fixture.page.evaluate(() => {
      const node = document.getElementById('action');
      const rect = node.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hit: node.contains(target),
      };
    });
    responsive.push({ viewport, ...geometry });
    if (viewport.width === 390) {
      await report.screenshot(fixture.page, '03-responsive-mobile', { fullPage: true });
    }
    await fixture.context.close();
  }
  report.pass('INT-14', 'Mobile et tablette',
    'aucun débordement horizontal, bouton cliquable aux deux largeurs', responsive);
  for (const entry of responsive) {
    assert.ok(entry.scrollWidth <= entry.clientWidth + 1, JSON.stringify(entry));
    assert.equal(entry.hit, true);
  }

  // 15. Échec de police : révision non appliquée, nouvel essai possible, repli Inter.
  const fontFail = await createFixture(report, {
    query: '?ambiance=halloween',
    style: true,
    extraInit: [failFontInit()],
  });
  await fontFail.page.waitForTimeout(500);
  const failed = await state(fontFail.page);
  const failedFont = await fontFail.page.locator('#page-title').evaluate(
    (node) => getComputedStyle(node).fontFamily,
  );
  const creepsterLoaded = failed.fonts.some((face) => face.family.includes('Creepster') && face.status === 'loaded');
  await fontFail.page.evaluate(() => window.__integration.setAmbiance('christmas'));
  await fontFail.page.waitForFunction(() => window.__integration.state().styleCount === 1);
  const retried = await state(fontFail.page);
  report.pass('INT-15', 'Échec de police et nouvel essai',
    'aucune feuille appliquée après échec, repli Inter, réussite avec une autre police', {
      styleCountAfterFailure: failed.styleCount, failedFont, creepsterLoaded,
      styleCountAfterRetry: retried.styleCount, retryText: retried.styleText,
    });
  assert.equal(failed.styleCount, 0);
  assert.equal(creepsterLoaded, false);
  assert.match(failedFont, /Inter|system-ui|ui-sans-serif/);
  assert.equal(retried.styleCount, 1);
  assert.ok(retried.styleText.includes('Archivo Black'));

  // 16. Texte réel et i18n inchangés ; aperçu admin isolé du flux public.
  await navigate(main.page, '/');
  await main.page.evaluate(() => window.__integration.setAmbiance('none'));
  await main.page.waitForFunction(() => window.__integration.state().active === false);
  const textBefore = (await state(main.page)).titleText;
  await main.page.evaluate(() => window.__integration.setLanguage('en'));
  await main.page.waitForTimeout(100);
  const textAfter = (await state(main.page)).titleText;
  const adminSource = await readRepoFile('src/components/adminDecor/AdminDecor.tsx');
  const adminIsolated = adminSource.includes('resolveDraftTypography')
    && !adminSource.includes('resolveSeasonalTheme')
    && !adminSource.includes('/api/seasonal-theme/resolve');
  report.pass('INT-16', 'Texte inchangé et aperçu admin isolé',
    'i18n ne modifie pas le texte audité ; le brouillon admin n’appelle pas le resolver public', {
      textBefore, textAfter, adminIsolated,
    });
  assert.equal(textAfter, textBefore);
  assert.equal(adminIsolated, true);

  await report.stopTrace(main.context);

  report.risk('Une salle WatchParty réelle à deux pairs reste hors de portée du harnais : cadence et état réseau non couverts ici.');
  report.risk('Les statuts blocked/not-run hérités de LOT 0/2/3 (worker Redis, hooks, lecteur réel) ne sont pas requalifiés par ce scénario.');
});
