import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/*
 * LOT 4A — modes de défaillance consignés dans docs/seasonal-theme-graphics-plan.md
 * avant l'implémentation. Les E2E LOT 0/3 couvrent l'admin et des statiques,
 * mais aucun scénario n'exerce le rendu public : ces tests de contrat purs
 * verrouillent le catalogue fermé, le fail-closed du resolver, la politique
 * plateforme/mouvement, les budgets canvas et le cycle de vie de la boucle.
 *
 * Le backend reste l'unique source de vérité : aucun test ne recompose une
 * priorité, ne publie une configuration et ne lit une préférence localStorage.
 */

const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function load<T>(path: string): T {
  const module = {};
  new Function('exports', 'require', transpile(path))(module, () => {
    throw new Error(`module inattendu dans ${path}`);
  });
  return module as T;
}

type Registry = typeof import('../src/seasonalThemeGraphics/registry.ts');
type Loader = typeof import('../src/seasonalThemeGraphics/loader.ts');
type Platform = typeof import('../src/seasonalThemeGraphics/platform.ts');
type Performance = typeof import('../src/seasonalThemeGraphics/performance.ts');
type Routes = typeof import('../src/seasonalThemeGraphics/routes.ts');

const registry = load<Registry>('../src/seasonalThemeGraphics/registry.ts');
const loader = load<Loader>('../src/seasonalThemeGraphics/loader.ts');
const platform = load<Platform>('../src/seasonalThemeGraphics/platform.ts');
const performance = load<Performance>('../src/seasonalThemeGraphics/performance.ts');
const routes = load<Routes>('../src/seasonalThemeGraphics/routes.ts');

const decoration = (id: string, family: string, enabled = true) => ({ id, family, enabled });

// ─── Registry ───────────────────────────────────────────────────────────────

test('le registry est fermé et ne contient que les décorations du catalogue LOT 2', () => {
  const ids = Object.keys(registry.SEASONAL_GRAPHICS_REGISTRY).sort();
  assert.equal(ids.length, 15);
  assert.ok(ids.includes('halloween.screenDecor'));
  assert.ok(ids.includes('christmas.background.snow'));
  assert.ok(ids.includes('halloween.typography'));
  assert.equal(registry.getGraphicsDefinition('inconnu.2026'), null);
  for (const id of ids) {
    const definition = registry.getGraphicsDefinition(id);
    assert.ok(definition);
    assert.equal(definition.id, id);
    assert.ok(['screenDecor', 'background', 'components', 'lights', 'particles', 'typography'].includes(definition.family));
  }
});

test('la sélection filtre inconnus, désactivés, doublons et effets animés en mode statique', () => {
  const input = [
    decoration('halloween.background', 'background'),
    decoration('halloween.particles', 'particles'),
    decoration('inconnu.2026', 'background'),
    decoration('christmas.lights', 'lights', false),
    decoration('halloween.screenDecor', 'screenDecor'),
    decoration('halloween.background', 'background'),
  ];
  const full = registry.selectGraphicsDecorations(input, { motion: 'full' });
  assert.deepEqual(full.map((item) => item.id), [
    'halloween.background',
    'halloween.particles',
    'halloween.screenDecor',
  ]);
  const staticOnly = registry.selectGraphicsDecorations(input, { motion: 'static' });
  assert.deepEqual(staticOnly.map((item) => item.id), [
    'halloween.background',
    'halloween.screenDecor',
  ]);
  const reduced = registry.selectGraphicsDecorations(input, { motion: 'reduced' });
  assert.deepEqual(reduced.map((item) => item.id), [
    'halloween.background',
    'halloween.screenDecor',
  ]);
  // L'ordre vient du resolver : le registry ne recalcule aucune priorité.
  const reordered = registry.selectGraphicsDecorations([
    decoration('halloween.particles', 'particles'),
    decoration('halloween.background', 'background'),
  ], { motion: 'full' });
  assert.deepEqual(reordered.map((item) => item.id), ['halloween.particles', 'halloween.background']);
});

test('aucune asset hors catalogue ne peut être chargée', () => {
  assert.equal(registry.isAllowedSeasonalAsset('/assets/seasonal-theme/halloween/fog.webp'), '/assets/seasonal-theme/halloween/fog.webp');
  for (const value of [
    '/assets/seasonal-theme/../secret.png',
    '/assets/seasonal-theme/halloween/../../secret.png',
    '/assets/seasonal-theme/halloween//fog.webp',
    'https://cdn.test/assets/seasonal-theme/fog.webp',
    '/assets/autre/fog.webp',
    '/assets/seasonal-theme/A.png',
    42,
    undefined,
  ]) {
    assert.equal(registry.isAllowedSeasonalAsset(value), null, String(value));
  }
});

// ─── Chargement fail-closed ─────────────────────────────────────────────────

const resolvedPayload = {
  emergencyDisable: false,
  revision: 7,
  resolvedAt: '2026-10-28T10:00:00.000Z',
  platform: 'desktop',
  capabilities: ['reducedMotion'],
  themes: [{ id: 'halloween-2026' }],
  families: ['background', 'particles'],
  decorations: [
    decoration('halloween.background', 'background'),
    decoration('halloween.particles', 'particles'),
  ],
  typography: {},
};

test('le chargeur consomme le resolver avec le contexte plateforme sans jeton admin', async () => {
  const calls: unknown[] = [];
  const resolve = async (context: unknown) => {
    calls.push(context);
    return resolvedPayload;
  };
  const snapshot = await loader.loadSeasonalGraphics(resolve, {
    platform: 'mobile',
    capabilities: ['reducedMotion'],
    at: '2026-10-28T10:00:00Z',
  });
  assert.equal(snapshot.active, true);
  assert.equal(snapshot.reason, 'published');
  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.decorations.length, 2);
  assert.deepEqual(calls, [{
    platform: 'mobile',
    capabilities: ['reducedMotion'],
    at: '2026-10-28T10:00:00Z',
  }]);
});

test('urgence, resolver indisponible et payload invalide désactivent toute décoration', async () => {
  const emergency = await loader.loadSeasonalGraphics(async () => ({
    ...resolvedPayload,
    emergencyDisable: true,
    revision: undefined,
    decorations: [],
  }), { platform: 'desktop', capabilities: [] });
  assert.equal(emergency.active, false);
  assert.equal(emergency.reason, 'emergency');
  assert.deepEqual(emergency.decorations, []);

  const unavailable = await loader.loadSeasonalGraphics(async () => {
    throw new Error('503');
  }, { platform: 'desktop', capabilities: [] });
  assert.equal(unavailable.active, false);
  assert.equal(unavailable.reason, 'unavailable');
  assert.equal(unavailable.revision, null);

  const invalid = await loader.loadSeasonalGraphics(async () => ({
    emergencyDisable: false,
    revision: Number.NaN,
    decorations: decoration('halloween.background', 'background'),
  }), { platform: 'desktop', capabilities: [] });
  assert.equal(invalid.active, false);
  assert.equal(invalid.reason, 'invalid');
  assert.deepEqual(invalid.decorations, []);
});

test('une référence localStorage ne peut pas activer une décoration non résolue', async () => {
  const snapshot = await loader.loadSeasonalGraphics(async () => ({
    emergencyDisable: false,
    revision: 3,
    decorations: [],
    themes: [],
    families: [],
  }), { platform: 'desktop', capabilities: [] });
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.reason, 'unavailable');
  assert.deepEqual(snapshot.decorations, []);
});

// ─── Plateforme et mouvement ────────────────────────────────────────────────

test('la plateforme est détectée sans substituer une préférence utilisateur', () => {
  assert.equal(platform.detectPlatform({ viewportWidth: 390, userAgent: 'iPhone' }), 'mobile');
  assert.equal(platform.detectPlatform({ viewportWidth: 820, userAgent: 'iPad' }), 'tablet');
  assert.equal(platform.detectPlatform({ viewportWidth: 1440, userAgent: 'Mozilla/5.0' }), 'desktop');
  assert.equal(platform.detectPlatform({ viewportWidth: 1920, tv: true }), 'tv');
  assert.equal(platform.motionPolicy('tv', false), 'static');
  assert.equal(platform.motionPolicy('desktop', true), 'reduced');
  assert.equal(platform.motionPolicy('mobile', false), 'full');
});

// ─── Budgets et boucle ──────────────────────────────────────────────────────

test('les budgets sont mesurés : 42 desktop, réduction mobile, zéro TV/reduced', () => {
  assert.equal(performance.particleBudget('desktop', 'full'), 42);
  assert.equal(performance.particleBudget('mobile', 'full'), 18);
  assert.equal(performance.particleBudget('tablet', 'full'), 28);
  assert.equal(performance.particleBudget('tv', 'full'), 0);
  assert.equal(performance.particleBudget('desktop', 'reduced'), 0);
  assert.equal(performance.particleBudget('desktop', 'static'), 0);
  assert.equal(performance.clampDpr(4, 'desktop'), 2);
  assert.equal(performance.clampDpr(4, 'mobile'), 1.5);
  assert.equal(performance.canvasBytes(1920, 1080, 1), 1920 * 1080 * 4);
  assert.equal(
    performance.canAllocateCanvas([], performance.canvasBytes(1920, 1080, 2)),
    false,
    '12 MiB maximum',
  );
  assert.equal(
    performance.canAllocateCanvas([], performance.canvasBytes(1920, 1080, 1)),
    true,
  );
});

test('une erreur de rendu ne désarme pas définitivement la boucle RAF', () => {
  let scheduled: ((time: number) => void) | null = null;
  let requests = 0;
  let now = 0;
  const scheduler = performance.createFrameScheduler({
    requestFrame: (callback) => { requests += 1; scheduled = callback; return requests; },
    cancelFrame: () => { scheduled = null; },
    now: () => now,
  }, () => {
    throw new Error('canvas context lost');
  });

  scheduler.start();
  assert.throws(() => scheduled?.(16), /canvas context lost/);
  assert.equal(requests, 2, 'la frame suivante doit être planifiée dans finally');
  assert.equal(scheduler.isRunning(), true);
  scheduler.stop();
});

test('la boucle se suspend quand la page est masquée et libère ses ressources', () => {
  let scheduled: ((time: number) => void) | null = null;
  let cancelled = 0;
  let now = 0;
  const deltas: number[] = [];
  const scheduler = performance.createFrameScheduler({
    requestFrame: (callback) => { scheduled = callback; return 1; },
    cancelFrame: () => { cancelled += 1; scheduled = null; },
    now: () => now,
  }, (delta) => { deltas.push(delta); });

  scheduler.start();
  now = 10;
  scheduled?.(10);
  now = 5000;
  scheduled?.(5000);
  assert.deepEqual(deltas, [10, 50], 'delta borné à 50 ms');

  scheduler.pause();
  assert.equal(scheduler.isRunning(), false);
  assert.equal(cancelled, 1);
  const framesAfterPause = deltas.length;
  scheduled?.(6000);
  assert.equal(deltas.length, framesAfterPause);

  scheduler.resume();
  now = 6010;
  scheduled?.(6010);
  assert.equal(scheduler.isRunning(), true);
  assert.equal(deltas.length, framesAfterPause + 1);

  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
  assert.ok(cancelled >= 2);
  const finalFrames = deltas.length;
  scheduled?.(9000);
  assert.equal(deltas.length, finalFrames);
});

// ─── Routes ─────────────────────────────────────────────────────────────────

test('les routes exclues ne lancent aucun moteur, même avec allow implicite', () => {
  for (const path of [
    '/watch/123', '/watch?server=0', '/watch/movie/123', '/ftv/watch/123',
    '/watchparty/salon', '/admin', '/admin/decor', '/admin-control-center',
    '/login', '/auth/callback', '/login-bip39', '/create-account', '/link-bip39',
    '/payment/checkout', '/checkout', '/vip', '/wrapped', '/profile-selection',
    '/settings/security', '/account/delete',
  ]) {
    assert.equal(routes.resolveSeasonalRouteMode(path), 'none', path);
  }
  assert.equal(routes.resolveSeasonalRouteMode('/', {}), 'full');
  assert.equal(routes.resolveSeasonalRouteMode('/catalogue/film', {}), 'full');
  assert.equal(routes.resolveSeasonalRouteMode('/catalogue/film', { minimal: true }), 'minimal');
  assert.equal(routes.resolveSeasonalRouteMode('/catalogue/film', { suppress: true }), 'none');
  assert.equal(routes.resolveSeasonalRouteMode('/catalogue/film', { allow: false }), 'none');
  assert.equal(routes.resolveSeasonalRouteMode('/admin', { allow: true, minimal: true }), 'none',
    'les exclusions strictes priment sur les métadonnées');
});
