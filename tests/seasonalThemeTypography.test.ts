import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

/*
 * LOT 4B — modes de défaillance consignés dans docs/seasonal-theme-typography-plan.md
 * avant l'implémentation. Les E2E LOT 0/3/4A ne chargent aucune police et ne
 * comparent pas le textContent des titres : ces tests de contrat purs verrouillent
 * le catalogue fermé, la résolution sans rerank public, le chargement local, la
 * restauration des styles et la parité de l'aperçu de brouillon avec LOT 2.
 *
 * Aucun test ne publie de configuration, ne lit une préférence locale comme
 * autorité et ne modifie le resolver backend.
 */

const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

type LoadedModule = Record<string, unknown>;

function load<T>(path: string, dependencies: Record<string, LoadedModule> = {}): T {
  const module: LoadedModule = {};
  new Function('exports', 'require', transpile(path))(module, (request: string) => {
    if (dependencies[request]) return dependencies[request];
    throw new Error(`module inattendu dans ${path}: ${request}`);
  });
  return module as T;
}

type Registry = typeof import('../src/seasonalThemeGraphics/typography/registry.ts');
type Resolve = typeof import('../src/seasonalThemeGraphics/typography/resolve.ts');
type FontLoader = typeof import('../src/seasonalThemeGraphics/typography/fontLoader.ts');
type Styles = typeof import('../src/seasonalThemeGraphics/typography/styles.ts');
type DraftPreview = typeof import('../src/seasonalThemeGraphics/typography/draftPreview.ts');

const registry = load<Registry>('../src/seasonalThemeGraphics/typography/registry.ts');
const resolve = load<Resolve>('../src/seasonalThemeGraphics/typography/resolve.ts', { './registry': registry as LoadedModule });
const fontLoader = load<FontLoader>('../src/seasonalThemeGraphics/typography/fontLoader.ts', { './registry': registry as LoadedModule });
const styles = load<Styles>('../src/seasonalThemeGraphics/typography/styles.ts', { './registry': registry as LoadedModule });
const draftPreview = load<DraftPreview>('../src/seasonalThemeGraphics/typography/draftPreview.ts', {
  './resolve': resolve as LoadedModule,
  './registry': registry as LoadedModule,
});

const require = createRequire(import.meta.url);
const backendResolver = require('../API/Mainapi/services/seasonalThemeResolver.js') as {
  resolveSeasonalTheme: (config: unknown, context: unknown, catalog: unknown) => { typography: Record<string, Record<string, unknown>> };
};
const backendConfig = require('../API/Mainapi/services/seasonalThemeConfig.js') as {
  SEASONAL_THEME_CATALOG: unknown;
  buildDefaultConfig: () => Record<string, unknown> & {
    themes: Array<Record<string, unknown> & { decorations: Array<Record<string, unknown>> }>;
  };
};

const payload = (entries: Record<string, unknown>) => entries;
const entry = (fontKey: string, weight = 400, effect = 'none', enabled = true) => ({
  decorationId: 'halloween.typography', themeId: 'halloween-2026', enabled, fontKey, weight, effect,
});

// ─── Catalogue fermé ────────────────────────────────────────────────────────

test('le registry de polices est fermé et aligné sur le catalogue LOT 2', () => {
  assert.deepEqual(registry.SEASONAL_FONT_KEYS, ['inter', 'creepster', 'archivo-black']);
  assert.deepEqual(registry.SEASONAL_TYPOGRAPHY_CATEGORIES, ['pageTitle', 'sectionTitle', 'categoryTitle']);
  assert.deepEqual(registry.SEASONAL_FONT_REGISTRY.inter.weights, [400, 500, 600, 700, 800, 900]);
  assert.deepEqual(registry.SEASONAL_FONT_REGISTRY.creepster.weights, [400]);
  assert.deepEqual(registry.SEASONAL_FONT_REGISTRY['archivo-black'].weights, [400]);
  assert.equal(registry.isSeasonalFontKey('comic-sans'), false);
  assert.equal(registry.isSeasonalFontKey('Creepster'), false);
  assert.equal(registry.isSeasonalTypographyCategory('heroTitle'), false);
  for (const font of Object.values(registry.SEASONAL_FONT_REGISTRY)) {
    assert.equal(font.license, 'OFL-1.1');
  }
});

test('les polices sont auto-hébergées, optimisées et accompagnées de leurs licences', () => {
  const root = new URL('../public/fonts/seasonal-theme/', import.meta.url);
  const files = [
    'inter-latin-400-normal.woff2',
    'inter-latin-700-normal.woff2',
    'creepster-latin-400-normal.woff2',
    'archivo-black-latin-400-normal.woff2',
    'licenses/INTER-LICENSE.txt',
    'licenses/CREEPSTER-LICENSE.txt',
    'licenses/ARCHIVO-BLACK-LICENSE.txt',
    'CREDITS.md',
  ];
  for (const file of files) {
    assert.equal(existsSync(new URL(file, root)), true, `fichier manquant: ${file}`);
  }
  for (const file of files.filter((name) => name.endsWith('.woff2'))) {
    const bytes = readFileSync(new URL(file, root));
    assert.ok(bytes.length > 5000, `${file} est vide`);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'wOF2', `${file} n'est pas du WOFF2`);
  }
  const credits = readFileSync(new URL('CREDITS.md', root), 'utf8');
  for (const family of ['Inter', 'Creepster', 'Archivo Black']) assert.ok(credits.includes(family));
  for (const url of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
    assert.equal(registry.fontSourceFor('creepster', 400)?.includes(url), false);
    assert.equal(credits.includes(url), false);
  }
  const creepsterLicense = readFileSync(new URL('licenses/CREEPSTER-LICENSE.txt', root), 'utf8');
  assert.ok(creepsterLicense.includes('SIL OPEN FONT LICENSE Version 1.1'));
});

// ─── Résolution des catégories ──────────────────────────────────────────────

test('les trois catégories sont résolues avec une seule police gagnante chacune', () => {
  const map = resolve.resolveTypographySelections(payload({
    pageTitle: entry('creepster', 400, 'glow'),
    sectionTitle: entry('archivo-black', 400, 'none'),
    categoryTitle: entry('inter', 700, 'none'),
  }));
  assert.deepEqual(map.pageTitle, {
    fontKey: 'creepster', weight: 400, effect: 'glow', decorationId: 'halloween.typography', themeId: 'halloween-2026',
  });
  assert.equal(map.sectionTitle?.fontKey, 'archivo-black');
  assert.equal(map.categoryTitle?.fontKey, 'inter');
  assert.equal(map.categoryTitle?.weight, 700);
});

test('une catégorie invalide revient à la typographie de référence sans affecter les autres', () => {
  const map = resolve.resolveTypographySelections(payload({
    pageTitle: entry('comic-sans'),
    sectionTitle: entry('archivo-black', 700),
    categoryTitle: entry('inter', 400, 'glow'),
    heroTitle: entry('creepster'),
  }));
  assert.equal(map.pageTitle, null);
  assert.equal(map.sectionTitle, null, 'une graisse absente du catalogue doit être rejetée');
  assert.equal(map.categoryTitle, null, 'un effet est interdit sur categoryTitle');
  assert.equal((map as Record<string, unknown>).heroTitle, undefined);
});

test('une entrée désactivée, absente ou dans une charge utile invalide n’applique rien', () => {
  assert.deepEqual(resolve.resolveTypographySelections(payload({
    pageTitle: entry('creepster', 400, 'none', false),
    sectionTitle: { enabled: true, fontKey: 'creepster' },
    categoryTitle: null,
  })), { pageTitle: null, sectionTitle: null, categoryTitle: null });
  assert.deepEqual(resolve.resolveTypographySelections(null), {
    pageTitle: null, sectionTitle: null, categoryTitle: null,
  });
  assert.deepEqual(resolve.resolveTypographySelections([]), {
    pageTitle: null, sectionTitle: null, categoryTitle: null,
  });
});

// ─── Chargement local des polices ──────────────────────────────────────────

test('le chargeur ne demande que la police sélectionnée et met la promesse en cache', async () => {
  const loads: string[] = [];
  const added: string[] = [];
  const loader = fontLoader.createSeasonalFontLoader({
    createFontFace: (family, source, weight) => {
      loads.push(`${family}:${weight}:${source}`);
      return { family, load: async () => undefined };
    },
    addFontFace: (face) => { added.push(String(face.family)); },
  });
  assert.equal(await loader.load('inter', 700), true);
  assert.deepEqual(loads, [], 'Inter est déjà local au démarrage');
  assert.equal(await loader.load('creepster', 400), true);
  assert.equal(await loader.load('creepster', 400), true);
  assert.equal(loads.length, 1, 'un seul chargement réseau pour la même police');
  assert.deepEqual(added, ['Creepster']);
  assert.equal(loader.status('archivo-black'), 'idle');
  assert.equal(loader.status('creepster'), 'loaded');
});

test('un échec de chargement expose un repli sans requêter à nouveau', async () => {
  let calls = 0;
  const loader = fontLoader.createSeasonalFontLoader({
    createFontFace: () => {
      calls += 1;
      return { load: async () => { throw new Error('réseau indisponible'); } };
    },
    addFontFace: () => undefined,
  });
  assert.equal(await loader.load('archivo-black', 400), false);
  assert.equal(await loader.load('archivo-black', 400), false);
  assert.equal(calls, 1);
  assert.equal(loader.status('archivo-black'), 'failed');
});

// ─── Application et restauration ───────────────────────────────────────────

test('la feuille injectée cible uniquement les marqueurs autorisés', () => {
  const map = resolve.resolveTypographySelections(payload({
    pageTitle: entry('creepster', 400, 'glow'),
    sectionTitle: entry('archivo-black'),
    categoryTitle: entry('inter', 700),
  }));
  const css = styles.buildTypographyCss(map, { staticOnly: false });
  assert.ok(css.includes('[data-seasonal-typography="pageTitle"]'));
  assert.ok(css.includes('[data-seasonal-typography="sectionTitle"]'));
  assert.ok(css.includes('[data-seasonal-typography="categoryTitle"]'));
  assert.ok(css.includes("font-family: 'Creepster'"));
  assert.ok(css.includes("font-family: 'Archivo Black'"));
  assert.equal(css.includes('content:'), false, 'aucun texte ne doit être remplacé');
  assert.equal(css.includes('http'), false);
  assert.equal(css.includes('h1') || css.includes('h2') || css.includes('h3'), false);
  const staticCss = styles.buildTypographyCss(map, { staticOnly: true });
  assert.equal(staticCss.includes('@keyframes'), false);
  assert.equal(staticCss.includes('animation'), false);
  assert.equal(staticCss.includes('text-shadow'), true, 'l’effet autorisé reste statique sur TV/reduced-motion');
});

test('apply/restore retire intégralement la feuille et les indicateurs', () => {
  const documentElement = { dataset: {} as Record<string, string> };
  const head = {
    children: [] as Array<{ id?: string; remove(): void }>,
    appendChild(node: { id?: string; remove(): void }) {
      this.children.push(node);
      this.children[this.children.length - 1].remove = () => {
        this.children = this.children.filter((item) => item !== node);
      };
      return node;
    },
  };
  const doc = {
    documentElement,
    head,
    getElementById: (id: string) => head.children.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '', remove() {} }),
  };
  const restore = styles.applyTypography(doc, resolve.resolveTypographySelections(payload({
    pageTitle: entry('creepster', 400, 'glow'),
  })), { staticOnly: false });
  assert.equal(head.children.length, 1);
  assert.equal(documentElement.dataset.seasonalTypography, 'active');
  restore();
  assert.equal(head.children.length, 0);
  assert.equal(documentElement.dataset.seasonalTypography, undefined);
});

// ─── Aperçu de brouillon ───────────────────────────────────────────────────

test('l’aperçu de brouillon produit les mêmes gagnants que le resolver LOT 2', () => {
  const config = backendConfig.buildDefaultConfig();
  config.revision = 42;
  config.emergencyDisable = false;
  for (const theme of config.themes) {
    theme.enabled = true;
    theme.windows = [];
    for (const decoration of theme.decorations) decoration.enabled = true;
  }
  const context = { platform: 'desktop', capabilities: [] as string[], at: '2026-10-28T12:00:00Z' };
  const backend = backendResolver.resolveSeasonalTheme(
    config,
    { ...context, now: new Date(context.at) },
    backendConfig.SEASONAL_THEME_CATALOG,
  );
  const preview = draftPreview.resolveDraftTypography(config, context);
  for (const category of registry.SEASONAL_TYPOGRAPHY_CATEGORIES) {
    const expected = backend.typography[category];
    const actual = preview[category];
    assert.equal(actual?.fontKey, expected.fontKey, category);
    assert.equal(actual?.weight, expected.weight, category);
    assert.equal(actual?.effect, expected.effect, category);
    assert.equal(actual?.decorationId, expected.decorationId ?? null, category);
  }
  assert.equal(preview.pageTitle?.fontKey, 'archivo-black');
  assert.equal(preview.pageTitle?.effect, 'frost');
});

test('l’aperçu respecte la fenêtre, la plateforme et l’urgence du brouillon', () => {
  const config = backendConfig.buildDefaultConfig();
  config.emergencyDisable = false;
  for (const theme of config.themes) {
    theme.enabled = true;
    theme.windows = [{ start: '2026-01-01', end: '2026-02-01', timezone: 'UTC' }];
    for (const decoration of theme.decorations) decoration.enabled = true;
  }
  const outside = draftPreview.resolveDraftTypography(config, {
    platform: 'desktop', capabilities: [], at: '2026-10-28T12:00:00Z',
  });
  assert.equal(outside.pageTitle, null);
  assert.equal(outside.categoryTitle, null);

  const tv = draftPreview.resolveDraftTypography(config, {
    platform: 'tv', capabilities: ['tvStaticEffects'], at: '2026-01-15T12:00:00Z',
  });
  assert.equal(tv.pageTitle?.fontKey, 'archivo-black');

  config.emergencyDisable = true;
  const emergency = draftPreview.resolveDraftTypography(config, {
    platform: 'desktop', capabilities: [], at: '2026-01-15T12:00:00Z',
  });
  assert.deepEqual(emergency, { pageTitle: null, sectionTitle: null, categoryTitle: null });
});
