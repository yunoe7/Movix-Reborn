/**
 * LOT 0 — scénario assets, cache et réseau.
 *
 * Relance :
 *   $env:SEASONAL_THEME_ASSETS_DIR='<hors-depot>'
 *   node tests/seasonalThemeAssets.browser.mjs
 *
 * Mesure les requêtes réellement émises par les anciens thèmes et vérifie les
 * garde-fous existants du Service Worker et du repli domaine. Les polices
 * locales et l'absence d'initialisation sur route exclue sont documentées
 * comme écarts.
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

const command = "$env:SEASONAL_THEME_ASSETS_DIR='<hors-depot>'; node tests/seasonalThemeAssets.browser.mjs";
const isFontRequest = (entry) => /fonts\.googleapis\.com|fonts\.gstatic\.com|\.woff2?($|\?)/.test(entry.url);

await runScenario({
  key: 'assets',
  title: 'Référence — assets, polices, cache et réseau',
  command,
  prerequisites: commonPrerequisites(),
  fixtures: [
    'Réseau intercepté : toute origine autre que seasonal.test est bloquée et journalisée.',
    'Trois états : thème éteint, thème actif, thème actif sur route suspendue.',
  ],
}, async (report) => {
  const off = await createAtmosphereFixture(report, {
    date: '2026-09-15T12:00:00+02:00',
    storage: { settings_light_mode: 'off', settings_halloween_theme: '0', settings_christmas_theme: '0' },
  });
  const offFonts = off.requests.filter(isFontRequest);
  report.pass('ASSET-01', 'Zéro requête de police quand le thème est éteint', 'aucune requête de police ou feuille distante', offFonts);
  assert.deepEqual(offFonts, []);
  await off.context.close();
  await off.browser.close();

  const on = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: { settings_light_mode: 'off', settings_halloween_theme: '1' },
  });
  const onFonts = on.requests.filter(isFontRequest);
  const remoteStylesheets = on.requests.filter((entry) => /fonts\.googleapis\.com/.test(entry.url));
  const linkCount = await on.page.locator('#halloween-font').count();
  report.fail('ASSET-02', 'Aucune police distante au runtime', 'requêtes de police uniquement sur l’origine locale', {
    onFonts,
    remoteStylesheets,
    linkCount,
  }, 'Le chargeur injecte une feuille https://fonts.googleapis.com/css2?family=Creepster.', 'high');
  assert.equal(linkCount, 1);
  await report.screenshot(on.page, '01-halloween-assets', { fullPage: true });

  const loaderSource = await readRepoFile('src/utils/halloweenThemeAssets.ts');
  const hasIdempotence = loaderSource.includes('if (requested) return');
  report.pass('ASSET-03', 'Chargement idempotent de l’habillage', 'gardeRequested et link id unique', { hasIdempotence, linkCount });
  assert.ok(hasIdempotence);
  assert.equal(linkCount, 1);
  await on.context.close();
  await on.browser.close();

  const excluded = await createAtmosphereFixture(report, {
    date: '2026-10-28T12:00:00+02:00',
    storage: { settings_light_mode: 'off', settings_halloween_theme: '1' },
    query: '?suspended=1',
  });
  const excludedFonts = excluded.requests.filter(isFontRequest);
  const excludedAtmosphere = await excluded.page.locator('.halloween-atmosphere').count();
  report.fail('ASSET-04', 'Aucune initialisation sur route exclue', 'zéro requête de police et zéro décor sur /watch/*', {
    fontRequests: excludedFonts,
    atmosphereCount: excludedAtmosphere,
  }, 'main.tsx charge la police avant que App.tsx ne connaisse la route.', 'high');
  assert.equal(excludedAtmosphere, 0);
  await excluded.context.close();
  await excluded.browser.close();

  const sw = await readRepoFile('public/sw.js');
  const assetPrefix = sw.includes("const ASSET_PATH_PREFIX = '/assets/'");
  const maxEntries = /ASSET_CACHE_MAX_ENTRIES\s*=\s*160/.test(sw);
  const fifo = sw.includes('keys.slice(0, keys.length - ASSET_CACHE_MAX_ENTRIES)');
  report.pass('ASSET-05', 'Cache Service Worker existing', '/assets/, limite 160 et éviction FIFO', { assetPrefix, maxEntries, fifo });
  assert.ok(assetPrefix && maxEntries && fifo);

  const blockDetection = await readRepoFile('src/services/blockDetection.ts');
  const guards = {
    threshold: /THRESHOLD\s*=\s*5/.test(blockDetection),
    span: /MIN_ERROR_SPAN_MS\s*=\s*2_000/.test(blockDetection),
    grace: /RESUME_GRACE_MS\s*=\s*8_000/.test(blockDetection),
    swAuthority: blockDetection.includes('MOVIX_FORCE_REDIRECT'),
  };
  report.pass('ASSET-06', 'Repli domaine existant', 'seuil 5, étalement 2 s, grâce 8 s, autorité SW', guards);
  assert.ok(Object.values(guards).every(Boolean));

  // main.tsx enregistre blockDetection pour l'application entière, pas pour
  // le thème : il est exclu de cette mesure ciblée.
  const themeSources = [
    'src/hooks/useHalloweenTheme.ts',
    'src/hooks/useChristmasTheme.ts',
    'src/utils/halloweenThemeAssets.ts',
    'src/components/HalloweenAtmosphere.tsx',
    'src/components/ChristmasAtmosphere.tsx',
  ];
  const importsBlockDetection = {};
  for (const source of themeSources) {
    importsBlockDetection[source] = /blockDetection|MOVIX_FORCE_REDIRECT/.test(await readRepoFile(source));
  }
  const noRedirect = Object.values(importsBlockDetection).every((value) => value === false);
  report.pass('ASSET-07', 'Le thème ne déclenche pas de repli domaine', 'aucun import de blockDetection dans les modules de thème', importsBlockDetection);
  assert.ok(noRedirect);

  const localFontDirs = ['src/assets/fonts', 'public/fonts'].filter((candidate) => existsSync(path.join(REPO, candidate)));
  const fontsourceCreepster = existsSync(path.join(REPO, 'node_modules/@fontsource/creepster'));
  report.blocked('ASSET-08', 'Polices self-hostées versionnées', 'bundles locaux pour Inter/Creepster/Archivo Black', { localFontDirs, fontsourceCreepster }, 'LOT 6 : vendorser Creepster et conserver OFL.txt/CREDITS.md.');
  report.blocked('ASSET-09', 'Cache SW des chunks de police', 'polices du thème servies depuis /assets/ avec FIFO', 'aucun chunk de police dédié au thème', 'LOT 6.');

  report.risk('Le fallback domaine reste sous l’autorité exclusive du Service Worker ; le moteur ne doit jamais appeler window.location.replace.');
  report.setContext('observedRemoteFonts', onFonts.map((entry) => entry.url));
});
