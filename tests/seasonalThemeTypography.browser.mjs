/**
 * LOT 0 — scénario typographique de référence.
 *
 * Relance :
 *   $env:SEASONAL_THEME_TYPOGRAPHY_DIR='<hors-depot>'
 *   node tests/seasonalThemeTypography.browser.mjs
 *
 * Vérifie l'état réel (Inter, Creepster via Google Fonts, fallback) et marque
 * `blocked` le catalogue fermé, les trois catégories du futur moteur et
 * l'aperçu isolé. Aucun style n'est appliqué pour rendre un test vert.
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

const command = "$env:SEASONAL_THEME_TYPOGRAPHY_DIR='<hors-depot>'; node tests/seasonalThemeTypography.browser.mjs";
const ids = ['page-title', 'section-title', 'category-title', 'card-title', 'action-button', 'nav', 'badge', 'explore-title'];

const readFonts = (page) => page.evaluate((selectors) => Object.fromEntries(selectors.map((id) => {
  const element = document.getElementById(id);
  const style = getComputedStyle(element);
  return [id, { fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontSize: style.fontSize, letterSpacing: style.letterSpacing }];
})), ids);

await runScenario({
  key: 'typography',
  title: 'Référence — typographie saisonnière et polices',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Même fixture d’atmosphère que le scénario core, avec titres et labels explicitement identifiés.',
    'Réseau intercepté : fonts.googleapis.com est soit autorisé, soit bloqué selon le cas.',
    'Textes neutres uniquement ; aucun titre ou traduction de production n’est modifié.',
  ],
}, async (report) => {
  const base = { settings_light_mode: 'off' };

  const neutral = await createAtmosphereFixture(report, {
    date: '2026-09-15T12:00:00+02:00',
    storage: { ...base, settings_halloween_theme: '0', settings_christmas_theme: '0' },
  });
  const neutralFonts = await readFonts(neutral.page);
  const neutralOk = Object.values(neutralFonts).every((value) => value.fontFamily.includes('Inter'));
  report.pass('TYPO-01', 'Police par défaut', 'Inter sur toutes les catégories de la fixture', neutralFonts);
  assert.ok(neutralOk, 'Inter doit rester la police par défaut');
  await neutral.context.close();
  await neutral.browser.close();

  const halloween = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
  });
  const halloweenFonts = await readFonts(halloween.page);
  const decorated = ['page-title', 'section-title', 'category-title', 'explore-title'];
  const decoratedOk = decorated.every((id) => halloweenFonts[id].fontFamily.includes('Creepster'));
  const untouched = ['card-title', 'action-button', 'nav', 'badge'];
  const untouchedOk = untouched.every((id) => !halloweenFonts[id].fontFamily.includes('Creepster'));
  report.pass('TYPO-02', 'Habillage Halloween des grands titres', 'Creepster sur grands titres, Inter ailleurs', halloweenFonts);
  assert.ok(decoratedOk, 'les grands titres doivent utiliser Creepster');
  assert.ok(untouchedOk, 'les petits textes ne doivent pas être habillés');
  await report.screenshot(halloween.page, '01-halloween-typography-desktop', { fullPage: true });

  const fontLink = await halloween.page.locator('#halloween-font').getAttribute('href');
  report.fail('TYPO-03', 'Polices hébergées localement', 'bundle local versionné, aucune feuille distante', fontLink, 'Le checkout utilise Google Fonts (décision validée : self-hosting).', 'high');

  const mixed = halloweenFonts['page-title'].fontFamily;
  const noAccidentalMix = !/Archivo Black/.test(mixed) && mixed.indexOf('Creepster') === 0;
  report.pass('TYPO-04', 'Absence de mélange accidentel', 'une seule police décorative par catégorie', { resolvedPageTitle: mixed, noAccidentalMix });
  assert.ok(noAccidentalMix);

  const cssVars = await halloween.page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return ['page-title', 'section-title', 'category-title'].map((category) => ({
      category,
      value: style.getPropertyValue(`--movix-font-${category}`),
    }));
  });
  report.blocked('TYPO-05', 'Variables typographiques par catégorie', '--movix-font-* résolus par le moteur', cssVars, 'LOT 4B : instrumentation data-typography et feuille dédiée.');

  const synthesis = await halloween.page.evaluate(() => getComputedStyle(document.body).fontSynthesis);
  const indexCss = await readRepoFile('src/index.css');
  report.pass('TYPO-06', 'Synthèse de graisse', 'font-synthesis: none avec graisses réellement chargées', { computed: synthesis, sourceHasNone: indexCss.includes('font-synthesis: none') });
  assert.equal(synthesis, 'none');
  report.blocked('TYPO-07', 'Catalogue fermé de fontKey', 'fontKey validé côté serveur et catalogue local', 'aucun src/themes/typographyCatalog.ts', 'LOT 2/4B.');

  const beforeText = await halloween.page.locator('#fixture-root').evaluate((node) => node.textContent);
  await halloween.page.evaluate(() => window.__seasonal.setHalloween(false));
  await halloween.page.waitForFunction(() => !document.documentElement.classList.contains('halloween-theme'));
  const reverted = await readFonts(halloween.page);
  const afterText = await halloween.page.locator('#fixture-root').evaluate((node) => node.textContent);
  const revertedOk = ids.every((id) => reverted[id].fontFamily.includes('Inter'));
  report.pass('TYPO-08', 'Réversibilité immédiate', 'retour à Inter sans rechargement, texte inchangé', { revertedOk, textIdentical: beforeText === afterText });
  assert.ok(revertedOk);
  assert.equal(beforeText, afterText);
  assert.deepEqual(halloween.errors, []);
  await halloween.context.close();
  await halloween.browser.close();

  const fallback = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: base,
    blockFonts: true,
  });
  const fallbackState = await fallback.page.evaluate(() => {
    const title = document.getElementById('page-title');
    const style = getComputedStyle(title);
    return {
      text: title.textContent,
      visibility: style.visibility,
      fontFamily: style.fontFamily,
      fontLoaded: document.fonts.check('16px Creepster'),
      fontLinkInserted: Boolean(document.getElementById('halloween-font')),
    };
  });
  report.pass('TYPO-09', 'Fallback immédiat si la police échoue', 'aucune feuille distante insérée et texte visible avec la pile de remplacement', fallbackState);
  assert.equal(fallbackState.text, 'Titre de page');
  assert.notEqual(fallbackState.visibility, 'hidden');
  assert.match(fallbackState.fontFamily, /Creepster/);
  assert.equal(fallbackState.fontLinkInserted, false);
  await report.screenshot(fallback.page, '02-font-fallback-desktop', { fullPage: true });
  await fallback.context.close();
  await fallback.browser.close();

  const packageJson = JSON.parse(await readRepoFile('package.json'));
  const dependencies = packageJson.dependencies || {};
  report.pass('TYPO-10', 'Dépendances de polices déjà présentes', '@fontsource/inter et @fontsource/archivo-black déclarés', {
    inter: dependencies['@fontsource/inter'] || null,
    archivoBlack: dependencies['@fontsource/archivo-black'] || null,
    creepster: dependencies['@fontsource/creepster'] || null,
  });
  assert.ok(dependencies['@fontsource/inter']);
  assert.ok(dependencies['@fontsource/archivo-black']);
  assert.ok(!dependencies['@fontsource/creepster']);

  const localFontDirs = ['src/assets/fonts', 'public/fonts'].filter((candidate) => existsSync(path.join(REPO, candidate)));
  const creditsPattern = existsSync(path.join(REPO, 'src/assets/wrapped/CREDITS.md'));
  report.blocked('TYPO-11', 'Self-hosting des polices et licences', 'fichiers locaux + CREDITS.md + OFL.txt', { localFontDirs, creditsPattern }, 'Creepster reste à vendorser via @fontsource avec sa licence OFL-1.1.');

  const previewSource = existsSync(path.join(REPO, 'src/components/adminDecor'))
    ? 'dossier adminDecor présent'
    : 'aucun composant de prévisualisation dédié';
  report.blocked('TYPO-12', 'Aperçu typographique isolé', 'route preview avec textes neutres et aucun effet public', previewSource, 'LOT 3.');

  report.risk('font-synthesis: none empêchera toute graisse non réellement chargée : le catalogue devra déclarer des poids exacts.');
  report.risk('Creepster est sous OFL-1.1 avec Reserved Font Name : toute variante modifiée devra changer de nom.');
  report.setContext('categoriesV1', ['pageTitle', 'sectionTitle', 'categoryTitle']);
  report.setContext('observedCurrentFonts', { default: 'Inter', halloweenDecor: 'Creepster via Google Fonts' });
});
