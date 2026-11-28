/**
 * LOT 4B — scénario navigateur du moteur typographique saisonnier.
 *
 * Relance : la commande exacte, avec le runtime Playwright hors dépôt et le
 * mode strict, est écrite dans le rapport généré depuis l'environnement courant.
 *
 * Monte le vrai provider LOT 4A avec un resolver local déterministe, les
 * marqueurs audités et les polices réellement servies depuis public/. Aucun
 * serveur, aucun compte, aucun secret et aucune configuration de production.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  REPO,
  buildFixtureBundle,
  buildFixtureCss,
  commonPrerequisites,
  createAtmosphereFixture,
  fixtureHtml,
  freezeDateInit,
  instrumentationInit,
  launchBrowser,
  mountFixture,
  readRepoFile,
  relaunchCommand,
  runScenario,
  trackResource,
  writeFixtureFiles,
} from './seasonalThemeHarness.mjs';

const command = relaunchCommand(
  'SEASONAL_THEME_TYPOGRAPHY_DIR',
  'tests/seasonalThemeTypography.browser.mjs',
  'SEASONAL_THEME_STRICT_GAPS',
);
const legacyIds = ['page-title', 'section-title', 'category-title', 'card-title', 'action-button', 'nav', 'badge', 'explore-title'];
const publicIds = ['page-title', 'section-title', 'category-title', 'untitled-heading', 'action'];

const isFontRequest = (entry) => /fonts\.googleapis\.com|fonts\.gstatic\.com|\.woff2?($|\?)/.test(entry.url);
const isRemoteFontRequest = (entry) => isFontRequest(entry) && entry.hostname !== 'seasonal.test';
const fontPath = (entry) => entry.pathname;

function failFontInit(family) {
  return `(() => {
    const OriginalFontFace = window.FontFace;
    window.FontFace = class extends OriginalFontFace {
      load() {
        if (String(this.family).includes(${JSON.stringify(family)})) {
          return Promise.reject(new Error('police bloquée par la fixture'));
        }
        return super.load();
      }
    };
  })();`;
}

async function createTypographyFixture(report, options = {}) {
  const {
    query = '',
    viewport = { width: 1280, height: 900 },
    reducedMotion = 'no-preference',
    instrument = false,
    storage = {},
    failFamily = null,
  } = options;

  const workDir = path.join(report.artifactDir, `fixture-${report.checks.length}-${query.replace(/[^a-z0-9]/gi, '_') || 'root'}`);
  await writeFixtureFiles(workDir, { html: fixtureHtml({ title: 'Typographie LOT 4B' }) });
  await buildFixtureBundle(workDir, path.join(REPO, 'tests/seasonalThemeFixtures/typography.tsx'));
  await buildFixtureCss(workDir, { contentFiles: ['src/index.css', 'tests/seasonalThemeFixtures/typography.tsx'] });

  const browser = await trackResource(await launchBrowser());
  const context = await trackResource(await browser.newContext({ viewport, reducedMotion }));
  await context.addInitScript(freezeDateInit('2026-10-28T12:00:00Z'));
  if (Object.keys(storage).length > 0) await context.addInitScript(storageInitFor(storage));
  if (instrument) await context.addInitScript(instrumentationInit());
  if (failFamily) await context.addInitScript(failFontInit(failFamily));

  const requests = [];
  await mountFixture(context, { workDir, requests });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`https://seasonal.test/${query}`);
  await page.waitForFunction(() => Boolean(window.__typography));
  return { browser, context, page, requests, errors, workDir };
}

function storageInitFor(values) {
  return `(() => {
    const values = ${JSON.stringify(values)};
    for (const [key, value] of Object.entries(values)) {
      try { localStorage.setItem(key, value); } catch {}
    }
  })();`;
}

const state = (page) => page.evaluate(() => window.__typography.state());
const calls = (page) => page.evaluate(() => window.__typography.calls());

const readStyles = (page, ids) => page.evaluate((selectors) => Object.fromEntries(selectors.map((id) => {
  const element = document.getElementById(id);
  if (!element) return [id, null];
  const style = getComputedStyle(element);
  return [id, {
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    visibility: style.visibility,
    textShadow: style.textShadow,
    contentBefore: getComputedStyle(element, '::before').content,
    contentAfter: getComputedStyle(element, '::after').content,
    textContent: element.textContent,
  }];
})), ids);

const texts = (page) => page.evaluate((selectors) => Object.fromEntries(
  selectors.map((id) => [id, document.getElementById(id)?.textContent ?? null]),
), publicIds);

async function waitForTypography(page, expectedFamily = null) {
  await page.waitForFunction((family) => {
    const style = document.getElementById('seasonal-typography-styles');
    return document.documentElement.dataset.seasonalTypography === 'active'
      && Boolean(style)
      && (!family || style.textContent.includes(family));
  }, expectedFamily, { timeout: 5000 });
}

async function waitForFont(page, family) {
  await page.waitForFunction((name) => Array.from(document.fonts).some((face) => {
    const loadedFamily = face.family.replace(/^['"]|['"]$/g, '');
    return loadedFamily === name && face.status === 'loaded';
  }), family, { timeout: 5000 });
}

await runScenario({
  key: 'typography',
  title: 'LOT 4B — typographie publiée, polices locales, routes exclues et aperçu isolé',
  command,
  prerequisites: [
    ...commonPrerequisites(),
    'Polices WOFF2 et licences déjà présentes sous public/fonts/seasonal-theme/.',
    'Aucune installation, aucun build préalable hors fixture esbuild/tailwind.',
  ],
  fixtures: [
    'tests/seasonalThemeFixtures/typography.tsx : vrai SeasonalGraphicsProvider, resolver déterministe local, aucune API réelle.',
    'tests/seasonalThemeFixtures/typographyPreview.tsx : aperçu de brouillon local, sans moteur public.',
    'Horloge figée au 28 octobre 2026 ; requêtes réseau interceptées et enregistrées.',
  ],
}, async (report) => {
  // ─── Contrats statiques ────────────────────────────────────────────────────
  const registrySource = await readRepoFile('src/seasonalThemeGraphics/typography/registry.ts');
  const catalogOk = ['inter', 'creepster', 'archivo-black'].every((key) => registrySource.includes(`'${key}'`))
    && registrySource.includes("'pageTitle', 'sectionTitle', 'categoryTitle'")
    && !registrySource.includes('comic-sans');
  report.pass('TYPO-07', 'Catalogue fermé de fontKey', 'trois polices et trois catégories uniquement', {
    catalogOk,
  });
  assert.ok(catalogOk);

  const packageJson = JSON.parse(await readRepoFile('package.json'));
  const dependencies = packageJson.dependencies || {};
  report.pass('TYPO-10', 'Dépendances de polices déclarées', '@fontsource/inter, archivo-black et creepster', {
    inter: dependencies['@fontsource/inter'] || null,
    archivoBlack: dependencies['@fontsource/archivo-black'] || null,
    creepster: dependencies['@fontsource/creepster'] || null,
  });
  assert.ok(dependencies['@fontsource/inter']);
  assert.ok(dependencies['@fontsource/archivo-black']);
  assert.ok(dependencies['@fontsource/creepster']);

  const fontRoot = path.join(REPO, 'public/fonts/seasonal-theme');
  const requiredFonts = [
    'inter-latin-400-normal.woff2', 'inter-latin-700-normal.woff2',
    'creepster-latin-400-normal.woff2', 'archivo-black-latin-400-normal.woff2',
    'licenses/INTER-LICENSE.txt', 'licenses/CREEPSTER-LICENSE.txt',
    'licenses/ARCHIVO-BLACK-LICENSE.txt', 'CREDITS.md',
  ];
  const missingFonts = requiredFonts.filter((file) => !existsSync(path.join(fontRoot, file)));
  const credits = await readRepoFile('public/fonts/seasonal-theme/CREDITS.md');
  const remoteSourceFiles = ['src/utils/halloweenThemeAssets.ts', 'src/main.tsx'];
  const remoteSources = [];
  for (const file of remoteSourceFiles) {
    const source = await readRepoFile(file);
    if (source.includes('fonts.googleapis.com') || source.includes('fonts.gstatic.com')) remoteSources.push(file);
  }
  const localFontsOk = missingFonts.length === 0 && remoteSources.length === 0
    && !credits.includes('fonts.googleapis.com') && !credits.includes('fonts.gstatic.com');
  report.pass('TYPO-11', 'Polices auto-hébergées et licences', 'WOFF2 locaux, licences OFL-1.1 et aucune URL distante', {
    missingFonts, remoteSources, creditsHasRemote: credits.includes('fonts.googleapis.com'),
  });
  assert.ok(localFontsOk);

  const indexCss = await readRepoFile('src/index.css');
  report.pass('TYPO-06', 'Synthèse de graisse', 'font-synthesis: none avec graisses réellement chargées', {
    sourceHasNone: indexCss.includes('font-synthesis: none'),
  });
  assert.ok(indexCss.includes('font-synthesis: none'));

  // ─── Ambiance historique : migration de la police sans Google Fonts ───────
  const base = { settings_light_mode: 'off' };
  const neutral = await createAtmosphereFixture(report, {
    date: '2026-09-15T12:00:00+02:00',
    storage: { ...base, settings_halloween_theme: '0', settings_christmas_theme: '0' },
  });
  const neutralFonts = await readStyles(neutral.page, legacyIds);
  const neutralOk = Object.values(neutralFonts).every((value) => value.fontFamily.includes('Inter'));
  report.pass('TYPO-01', 'Police par défaut', 'Inter sur toutes les catégories de la fixture', neutralFonts);
  assert.ok(neutralOk);
  assert.deepEqual(neutral.requests.filter(isFontRequest).map(fontPath), []);
  await neutral.context.close();
  await neutral.browser.close();

  const halloween = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
  });
  await halloween.page.waitForFunction(() => Array.from(document.fonts)
    .some((face) => face.family === 'Creepster' && face.status === 'loaded'), null, { timeout: 5000 });
  const halloweenFonts = await readStyles(halloween.page, legacyIds);
  const decorated = ['page-title', 'section-title', 'category-title', 'explore-title'];
  const decoratedOk = decorated.every((id) => halloweenFonts[id].fontFamily.includes('Creepster'));
  const untouched = ['card-title', 'action-button', 'nav', 'badge'];
  const untouchedOk = untouched.every((id) => !halloweenFonts[id].fontFamily.includes('Creepster'));
  report.pass('TYPO-02', 'Habillage Halloween des grands titres', 'Creepster sur grands titres, Inter ailleurs', halloweenFonts);
  assert.ok(decoratedOk);
  assert.ok(untouchedOk);
  await report.screenshot(halloween.page, '01-halloween-typography-desktop', { fullPage: true });

  const halloweenFontRequests = halloween.requests.filter(isFontRequest).map(fontPath);
  const halloweenRemote = halloween.requests.filter(isRemoteFontRequest);
  const linkCount = await halloween.page.locator('#halloween-font').count();
  report.pass('TYPO-03', 'Polices hébergées localement', 'bundle local versionné, aucune feuille distante', {
    halloweenFontRequests, halloweenRemote, linkCount,
  });
  assert.equal(linkCount, 0);
  assert.deepEqual(halloweenRemote, []);
  assert.ok(halloweenFontRequests.includes('/fonts/seasonal-theme/creepster-latin-400-normal.woff2'));

  const mixedFont = halloweenFonts['page-title'].fontFamily;
  const noAccidentalMix = !/Archivo Black/.test(mixedFont) && mixedFont.indexOf('Creepster') === 0;
  report.pass('TYPO-04', 'Absence de mélange accidentel', 'une seule police décorative par catégorie', {
    resolvedPageTitle: mixedFont, noAccidentalMix,
  });
  assert.ok(noAccidentalMix);

  const beforeText = await halloween.page.locator('#fixture-root').evaluate((node) => node.textContent);
  await halloween.page.evaluate(() => window.__seasonal.setHalloween(false));
  await halloween.page.waitForFunction(() => !document.documentElement.classList.contains('halloween-theme'));
  const reverted = await readStyles(halloween.page, legacyIds);
  const afterText = await halloween.page.locator('#fixture-root').evaluate((node) => node.textContent);
  const revertedOk = legacyIds.every((id) => reverted[id].fontFamily.includes('Inter'));
  report.pass('TYPO-08', 'Réversibilité immédiate', 'retour à Inter sans rechargement, texte inchangé', {
    revertedOk, textIdentical: beforeText === afterText,
  });
  assert.ok(revertedOk);
  assert.equal(beforeText, afterText);
  assert.deepEqual(halloween.errors, []);
  await halloween.context.close();
  await halloween.browser.close();

  const fallback = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
    extraInit: [failFontInit('Creepster')],
  });
  await fallback.page.waitForTimeout(250);
  const fallbackState = await fallback.page.evaluate(() => {
    const title = document.getElementById('page-title');
    const style = getComputedStyle(title);
    return {
      text: title.textContent,
      visibility: style.visibility,
      fontFamily: style.fontFamily,
      fontLoaded: Array.from(document.fonts).some((face) => face.family === 'Creepster' && face.status === 'loaded'),
      fontLinkInserted: Boolean(document.getElementById('halloween-font')),
    };
  });
  const fallbackRemote = fallback.requests.filter(isRemoteFontRequest);
  report.pass('TYPO-09', 'Fallback immédiat si la police échoue', 'texte visible avec Inter, aucune feuille distante', {
    ...fallbackState, fallbackRemote,
  });
  assert.equal(fallbackState.text, 'Titre de page');
  assert.notEqual(fallbackState.visibility, 'hidden');
  assert.match(fallbackState.fontFamily, /Inter|Impact|system-ui/);
  assert.equal(fallbackState.fontLoaded, false);
  assert.equal(fallbackState.fontLinkInserted, false);
  assert.deepEqual(fallbackRemote, []);
  await report.screenshot(fallback.page, '02-font-fallback-desktop', { fullPage: true });
  await fallback.context.close();
  await fallback.browser.close();

  // L'ambiance historique peut être activée globalement : Creepster ne doit
  // tout de même pas être téléchargé sur une route exclue par le LOT 4A.
  const excludedLegacyRoutes = [];
  for (const route of ['/auth/google', '/vip/don']) {
    const legacyExcluded = await createAtmosphereFixture(report, {
      date: '2026-10-28T12:00:00+02:00',
      storage: base,
      query: `?route=${encodeURIComponent(route)}`,
    });
    await legacyExcluded.page.waitForTimeout(250);
    const legacyState = await legacyExcluded.page.evaluate(() => window.__seasonal.state());
    excludedLegacyRoutes.push({
      route,
      halloweenEnabled: legacyState.halloweenEnabled,
      themed: legacyState.htmlClass.includes('halloween-theme'),
      fontLink: legacyState.fontLink,
      fontRequests: legacyExcluded.requests.filter(isFontRequest).map(fontPath),
    });
    // LOT 5 : la politique d'exclusion s'applique aussi aux marqueurs des
    // ambiances historiques, avant même le chargement de la police.
    assert.equal(legacyState.halloweenEnabled, false);
    assert.equal(legacyState.htmlClass.includes('halloween-theme'), false);
    assert.equal(legacyState.fontLink, null);
    assert.deepEqual(legacyExcluded.requests.filter(isFontRequest), []);
    assert.deepEqual(legacyExcluded.errors, []);
    await legacyExcluded.context.close();
    await legacyExcluded.browser.close();
  }
  report.pass('TYPO-03B', 'Ambiance Halloween absente des routes exclues',
    'aucun marqueur, classe ni police sur auth et paiement', { excludedLegacyRoutes });

  // ─── Moteur public : configuration publiée uniquement ─────────────────────
  const published = await createTypographyFixture(report, {
    query: '?ambiance=halloween&route=%2F',
    storage: { settings_halloween_theme: '1', settings_christmas_theme: '1' },
  });
  await report.startTrace(published.context);
  await published.page.waitForFunction(() => window.__typography.state().active === true);
  await waitForTypography(published.page, 'Creepster');
  await waitForFont(published.page, 'Creepster');
  const publishedState = await state(published.page);
  const publishedStyles = await readStyles(published.page, publicIds);
  const publishedTexts = await texts(published.page);
  assert.equal(publishedState.typographyAttr, 'active');
  assert.equal(publishedState.styleCount, 1);
  assert.equal(publishedState.markers, 3);
  assert.match(publishedStyles['page-title'].fontFamily, /Creepster/);
  assert.equal(publishedStyles['page-title'].fontWeight, '400');
  assert.notEqual(publishedStyles['page-title'].textShadow, 'none');
  assert.match(publishedStyles['section-title'].fontFamily, /Creepster/);
  assert.match(publishedStyles['category-title'].fontFamily, /Inter/);
  assert.equal(publishedStyles['category-title'].fontWeight, '700');
  assert.equal(publishedStyles['category-title'].textShadow, 'none');
  assert.equal(publishedStyles['untitled-heading'].fontFamily.includes('Creepster'), false);
  for (const id of publicIds) {
    assert.equal(publishedStyles[id].contentBefore, 'none');
    // `.catalog-section-title` possède déjà un `::after` vide : le moteur ne
    // doit pas y ajouter de texte visible, mais il n'a pas à le supprimer.
    assert.ok(['none', '""'].includes(publishedStyles[id].contentAfter));
  }

  const creepsterRequests = published.requests.filter(isFontRequest).map(fontPath);
  report.pass('TYPO-05', 'Catégories publiées appliquées aux seuls marqueurs audités',
    'trois règles data-seasonal-typography, texte et contrôles inchangés', {
      styleText: publishedState.styleText,
      styles: publishedStyles,
      texts: publishedTexts,
      fontRequests: creepsterRequests,
    });
  assert.ok(publishedState.styleText.includes('[data-seasonal-typography="pageTitle"]'));
  assert.ok(publishedState.styleText.includes('[data-seasonal-typography="sectionTitle"]'));
  assert.ok(publishedState.styleText.includes('[data-seasonal-typography="categoryTitle"]'));
  assert.equal(publishedState.styleText.includes('content:'), false);
  assert.equal(publishedState.styleText.includes('http'), false);
  assert.equal(/h[123]\b/.test(publishedState.styleText), false);
  assert.deepEqual(creepsterRequests, ['/fonts/seasonal-theme/creepster-latin-400-normal.woff2']);
  assert.ok(published.requests.filter(isRemoteFontRequest).length === 0);
  await report.screenshot(published.page, '03-published-halloween', { fullPage: true });

  // Nouvelle publication : seul le gagnant du resolver est appliqué.
  await published.page.evaluate(() => {
    window.__typography.setRevision(5);
    window.__typography.setAmbiance('christmas');
  });
  await waitForTypography(published.page, 'Archivo Black');
  await waitForFont(published.page, 'Archivo Black');
  const christmasStyles = await readStyles(published.page, publicIds);
  const christmasRequests = published.requests.filter(isFontRequest).map(fontPath);
  report.pass('TYPO-12', 'Changement de publication sans rerank client',
    'Archivo Black appliqué après résolution, Creepster non rechargé', {
      pageTitle: christmasStyles['page-title'], fontRequests: christmasRequests,
    });
  assert.match(christmasStyles['page-title'].fontFamily, /Archivo Black/);
  assert.equal(christmasRequests.filter((entry) => entry.includes('creepster')).length, 1);
  assert.equal(christmasRequests.filter((entry) => entry.includes('archivo-black')).length, 1);
  assert.deepEqual(await texts(published.page), publishedTexts);

  // Catégorie invalide : repli Inter pour cette catégorie seulement.
  await published.page.evaluate(() => {
    window.__typography.setRevision(6);
    window.__typography.setAmbiance('mixed');
  });
  await published.page.waitForFunction(() => {
    const style = document.getElementById('seasonal-typography-styles');
    return Boolean(style) && !style.textContent.includes('categoryTitle');
  });
  const mixedStyles = await readStyles(published.page, publicIds);
  report.pass('TYPO-13', 'Effet interdit sur categoryTitle rejeté', 'repli Inter sans casser les autres catégories', {
    categoryTitle: mixedStyles['category-title'], pageTitle: mixedStyles['page-title'],
  });
  assert.match(mixedStyles['category-title'].fontFamily, /Inter/);
  assert.equal(mixedStyles['category-title'].textShadow, 'none');
  assert.match(mixedStyles['page-title'].fontFamily, /Archivo Black/);

  // Urgence puis réactivation : restauration et réapplication complètes.
  const requestsBeforeEmergency = published.requests.filter(isFontRequest).length;
  await published.page.evaluate(() => window.__typography.setAmbiance('emergency'));
  await published.page.waitForFunction(() => {
    const style = document.getElementById('seasonal-typography-styles');
    return !style && !document.documentElement.dataset.seasonalTypography;
  });
  const emergencyStyles = await readStyles(published.page, publicIds);
  report.pass('TYPO-14', 'Arrêt d’urgence : styles retirés et texte intact', 'aucune feuille, Inter partout, aucune requête supplémentaire', {
    style: await state(published.page), styles: emergencyStyles,
    fontRequests: published.requests.filter(isFontRequest).length - requestsBeforeEmergency,
  });
  assert.ok(publicIds.every((id) => emergencyStyles[id].fontFamily.includes('Inter')));
  assert.deepEqual(await texts(published.page), publishedTexts);
  assert.equal(published.requests.filter(isFontRequest).length, requestsBeforeEmergency);
  await report.screenshot(published.page, '04-emergency', { fullPage: true });

  await published.page.evaluate(() => {
    window.__typography.setRevision(9);
    window.__typography.setAmbiance('halloween');
  });
  await waitForTypography(published.page, 'Creepster');
  const reactivatedStyles = await readStyles(published.page, publicIds);
  assert.match(reactivatedStyles['page-title'].fontFamily, /Creepster/);
  assert.equal(published.requests.filter(isFontRequest).length, requestsBeforeEmergency, 'les polices restent en cache');

  // Navigation hors périmètre : aucun marqueur appliqué, aucune requête.
  const requestsBeforeExit = published.requests.filter(isFontRequest).length;
  await published.page.evaluate(() => window.__typography.navigate('/watch/movie/1'));
  await published.page.waitForFunction(() => {
    const style = document.getElementById('seasonal-typography-styles');
    return !style && window.__typography.state().pathname === '/watch/movie/1';
  });
  const afterExit = await state(published.page);
  const afterExitFontRequests = published.requests.filter(isFontRequest).length - requestsBeforeExit;
  report.pass('TYPO-15', 'Sortie vers lecteur : nettoyage typographique', 'feuille retirée, aucun appel resolver, aucune police demandée', {
    state: afterExit, fontRequests: afterExitFontRequests,
  });
  assert.equal(afterExit.styleCount, 0);
  assert.equal(afterExit.typographyAttr, null);
  assert.equal(afterExitFontRequests, 0);
  await published.page.evaluate(() => window.__typography.navigate('/'));
  await waitForTypography(published.page, 'Creepster');
  assert.deepEqual(published.errors, []);
  await report.stopTrace(published.context);
  await published.context.close();
  await published.browser.close();

  // ─── Routes exclues : fail-closed avant même la résolution ────────────────
  for (const route of [
    '/watch/movie/123', '/ftv/watch/1', '/watchparty/room/abc', '/admin/decor',
    '/auth/google', '/oauth/consent', '/vip/don', '/payment/checkout',
    '/settings/security', '/account/delete', '/wrapped', '/link-bip39',
    '/profile-selection', '/login', '/logout', '/register', '/password/reset',
    '/login-bip39', '/create-account',
  ]) {
    const excluded = await createTypographyFixture(report, {
      query: `?ambiance=halloween&route=${encodeURIComponent(route)}`,
      storage: { settings_halloween_theme: '1', settings_christmas_theme: '1' },
    });
    await excluded.page.waitForFunction(() => Object.keys(window.__typography.state()).length > 0);
    const excludedState = await state(excluded.page);
    const excludedCalls = await calls(excluded.page);
    const excludedFonts = excluded.requests.filter(isFontRequest);
    report.pass(`TYPO-16-${route}`, `Route exclue ${route}`,
      'aucun appel resolver, aucune feuille, aucune requête de police', {
        reason: excludedState.reason, styleCount: excludedState.styleCount,
        typographyAttr: excludedState.typographyAttr, calls: excludedCalls.length,
        fontRequests: excludedFonts.map(fontPath),
      });
    assert.equal(excludedState.styleCount, 0);
    assert.equal(excludedState.typographyAttr, null);
    assert.equal(excludedCalls.length, 0);
    assert.deepEqual(excludedFonts, []);
    await excluded.context.close();
    await excluded.browser.close();
  }

  // ─── TV / reduced motion : identité statique ──────────────────────────────
  const tv = await createTypographyFixture(report, {
    query: '?ambiance=christmas&platform=tv&route=%2F',
    viewport: { width: 1920, height: 1080 },
    instrument: true,
  });
  await waitForTypography(tv.page, 'Archivo Black');
  await tv.page.waitForTimeout(250);
  const tvState = await state(tv.page);
  const tvStyles = await readStyles(tv.page, publicIds);
  const tvFrames = await tv.page.evaluate(() => window.__seasonalMetrics?.().animationFrames ?? null);
  report.pass('TYPO-17', 'TV : typographie statique', 'effet conservé, aucune animation ni frame', {
    textShadow: tvStyles['page-title'].textShadow,
    styleHasAnimation: /@keyframes|animation/.test(tvState.styleText),
    frames: tvFrames,
  });
  assert.notEqual(tvStyles['page-title'].textShadow, 'none');
  assert.equal(/@keyframes|animation/.test(tvState.styleText), false);
  assert.equal(tvFrames, 0);
  await report.screenshot(tv.page, '05-tv-static-typography', { fullPage: true });
  await tv.context.close();
  await tv.browser.close();

  const reduced = await createTypographyFixture(report, {
    query: '?ambiance=christmas&route=%2F',
    reducedMotion: 'reduce',
    instrument: true,
  });
  await waitForTypography(reduced.page, 'Archivo Black');
  await reduced.page.waitForTimeout(250);
  const reducedState = await state(reduced.page);
  const reducedFrames = await reduced.page.evaluate(() => window.__seasonalMetrics?.().animationFrames ?? null);
  report.pass('TYPO-18', 'prefers-reduced-motion : typographie statique', 'aucune animation ni frame', {
    styleHasAnimation: /@keyframes|animation/.test(reducedState.styleText), frames: reducedFrames,
  });
  assert.equal(/@keyframes|animation/.test(reducedState.styleText), false);
  assert.equal(reducedFrames, 0);
  await reduced.context.close();
  await reduced.browser.close();

  // ─── Échec réseau local : repli Inter sans style global ───────────────────
  const failed = await createTypographyFixture(report, {
    query: '?ambiance=christmas&route=%2F',
    failFamily: 'Archivo Black',
  });
  await failed.page.waitForFunction(() => window.__typography.state().ready === true);
  await failed.page.waitForTimeout(250);
  const failedState = await state(failed.page);
  const failedStyles = await readStyles(failed.page, publicIds);
  const failedTexts = await texts(failed.page);
  report.pass('TYPO-19', 'Échec de chargement : repli sans style', 'Inter visible, aucune feuille injectée, texte intact', {
    state: failedState, styles: failedStyles, texts: failedTexts,
  });
  assert.equal(failedState.styleCount, 0);
  assert.equal(failedState.typographyAttr, null);
  assert.match(failedStyles['page-title'].fontFamily, /Inter/);
  assert.equal(failedStyles['page-title'].fontFamily.includes('Archivo Black'), false);
  assert.notEqual(failedStyles['page-title'].visibility, 'hidden');
  assert.deepEqual(failedTexts, publishedTexts);
  assert.deepEqual(failed.errors, []);
  await failed.context.close();
  await failed.browser.close();

  // ─── Aperçu administratif : isolé, comparatif, restauré à la fermeture ────
  const previewWorkDir = path.join(report.artifactDir, `fixture-${report.checks.length}-preview`);
  await writeFixtureFiles(previewWorkDir, { html: fixtureHtml({ title: 'Aperçu typographique isolé' }) });
  await buildFixtureBundle(previewWorkDir, path.join(REPO, 'tests/seasonalThemeFixtures/typographyPreview.tsx'));
  await buildFixtureCss(previewWorkDir, { contentFiles: [
    'src/index.css', 'src/components/adminDecor/SeasonalTypographySample.tsx',
    'tests/seasonalThemeFixtures/typographyPreview.tsx',
  ] });
  const previewBrowser = await trackResource(await launchBrowser());
  const previewContext = await trackResource(await previewBrowser.newContext({ viewport: { width: 1280, height: 900 } }));
  await previewContext.addInitScript(freezeDateInit('2026-10-28T12:00:00Z'));
  const previewRequests = [];
  await mountFixture(previewContext, { workDir: previewWorkDir, requests: previewRequests });
  const previewPage = await previewContext.newPage();
  const previewErrors = [];
  previewPage.on('pageerror', (error) => previewErrors.push(error.message));
  await previewPage.goto('https://seasonal.test/');
  await previewPage.waitForFunction(() => Boolean(window.__typographyPreview));
  await waitForFont(previewPage, 'Creepster');
  await waitForFont(previewPage, 'Archivo Black');
  const previewRows = await previewPage.evaluate(() => Object.fromEntries(
    ['pageTitle', 'sectionTitle', 'categoryTitle'].map((category) => {
      const node = document.querySelector(`[data-testid="admin-decor-preview-${category}"]`);
      const style = getComputedStyle(node);
      return [category, {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        textShadow: style.textShadow,
        textContent: node.textContent,
      }];
    }),
  ));
  const previewState = await previewPage.evaluate(() => window.__typographyPreview.state());
  const previewRemote = previewRequests.filter(isRemoteFontRequest);
  const previewResolveCalls = previewRequests.filter((entry) => entry.pathname.includes('/api/seasonal-theme/resolve'));
  report.pass('TYPO-20', 'Aperçu de brouillon isolé et comparatif',
    'trois catégories chargées localement, aucun resolver, aucun style public', {
      rows: previewRows, state: previewState,
      fontRequests: previewRequests.filter(isFontRequest).map(fontPath),
      previewResolveCalls: previewResolveCalls.length, previewRemote,
    });
  assert.match(previewRows.pageTitle.fontFamily, /Creepster/);
  assert.match(previewRows.sectionTitle.fontFamily, /Archivo Black/);
  assert.match(previewRows.categoryTitle.fontFamily, /Inter/);
  assert.equal(previewRows.categoryTitle.fontWeight, '700');
  assert.equal(previewState.rows, 3);
  assert.equal(previewState.typographyMarkers, 0);
  assert.equal(previewState.globalStyle, false);
  assert.equal(previewState.graphicsAttr, null);
  assert.equal(previewResolveCalls.length, 0);
  assert.deepEqual(previewRemote, []);
  assert.deepEqual(previewErrors, []);

  const heroPreview = await previewPage.evaluate(() => ({
    markers: document.querySelectorAll('#hero-promo-preview [data-seasonal-typography]').length,
    title: document.querySelector('#hero-promo-preview h1')?.textContent ?? null,
  }));
  report.pass('TYPO-20B', 'Aperçu HeroPromo sans marqueur public',
    'le composant partagé rendu avec preview ne dépose aucun marqueur', {
      heroPreview, state: previewState,
    });
  assert.equal(previewState.previewHeroMarkers, 0);
  assert.equal(heroPreview.markers, 0);
  assert.equal(heroPreview.title, 'Titre promo aperçu');
  await report.screenshot(previewPage, '06-preview-draft', { fullPage: true });

  await previewPage.evaluate(() => window.__typographyPreview.unmount());
  await previewPage.waitForFunction(() => window.__typographyPreview.state().rows === 0);
  const restored = await previewPage.evaluate(() => window.__typographyPreview.state());
  report.pass('TYPO-21', 'Fermeture de l’aperçu : restauration complète',
    'aucun nœud ni style en ligne ne subsiste après démontage', {
      restored,
    });
  assert.equal(restored.rows, 0);
  assert.equal(restored.inlineStyles, 0);
  assert.equal(restored.globalStyle, false);
  await previewContext.close();
  await previewBrowser.close();

  report.risk('Creepster ne couvre que le sous-ensemble latin : les glyphes hors plage conservent Inter conformément à CREDITS.md.');
  report.risk('L’aperçu partage le cache FontFace du moteur public ; seuls ses styles en ligne sont démontés à la fermeture.');
  report.setContext('categories', ['pageTitle', 'sectionTitle', 'categoryTitle']);
  report.setContext('fonts', ['inter', 'creepster', 'archivo-black']);
  report.setContext('effects', ['none', 'glow', 'frost']);
});
