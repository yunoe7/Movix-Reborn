import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/*
 * LOT 5 — modes de défaillance consignés dans
 * docs/seasonal-theme-integration-plan.md avant l'implémentation.
 *
 * Ces contrats purs verrouillent la politique d'exclusion déclarative :
 * catalogue fermé, défaut restrictif, motifs paramétrés, primauté de la liste
 * stricte et indépendance des familles. Aucun resolver ni localStorage n'est
 * simulé : le backend reste l'unique autorité de rendu.
 */

const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function load<T>(path: string, modules: Record<string, unknown> = {}): T {
  const module = {};
  new Function('exports', 'require', transpile(path))(module, (name: string) => {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    throw new Error(`module inattendu dans ${path}: ${name}`);
  });
  return module as T;
}

type Routes = typeof import('../src/seasonalThemeGraphics/routes.ts');
type Scope = typeof import('../src/routing/seasonalScope.ts');

const routes = load<Routes>('../src/seasonalThemeGraphics/routes.ts');
const scope = load<Scope>('../src/routing/seasonalScope.ts', {
  '../seasonalThemeGraphics/routes': routes,
});

// ─── Catalogue fermé ────────────────────────────────────────────────────────

test('le catalogue de scope est fermé et ne contient que des valeurs autorisées', () => {
  const entries = Object.entries(scope.SEASONAL_DECOR_SCOPES);
  assert.ok(entries.length > 20);
  for (const [path, value] of entries) {
    assert.ok(path.startsWith('/'), path);
    assert.ok(['full', 'minimal', 'suppress'].includes(value), `${path}: ${value}`);
  }
  assert.equal(scope.SEASONAL_DECOR_SCOPES['/'], 'full');
  assert.equal(scope.SEASONAL_DECOR_SCOPES['/watch/movie/:tmdbid'], 'suppress');
  assert.equal(scope.SEASONAL_DECOR_SCOPES['/admin'], 'suppress');
});

test('correspondance des segments : paramètres, paramètre final optionnel et query', () => {
  assert.equal(scope.matchesDecorPattern('/provider/:providerId', '/provider/arte'), true);
  assert.equal(scope.matchesDecorPattern('/provider/:providerId/:type/:genreId?', '/provider/arte/movies'), true);
  assert.equal(scope.matchesDecorPattern('/provider/:providerId/:type/:genreId?', '/provider/arte/movies/12'), true);
  assert.equal(scope.matchesDecorPattern('/provider/:providerId/:type/:genreId?', '/provider/arte/movies/12/extra'), false);
  assert.equal(scope.matchesDecorPattern('/movie/:id', '/movie/42'), true);
  assert.equal(scope.matchesDecorPattern('/movie/:id', '/movie/42/autre'), false);
  assert.equal(scope.matchesDecorPattern('/', '/'), true);
});

// ─── Défaut restrictif ──────────────────────────────────────────────────────

test('une route non déclarée est suppress : aucun moteur par défaut', () => {
  assert.deepEqual(scope.seasonalRouteMetadata('/route-inconnue'), { suppress: true });
  assert.equal(scope.resolveSeasonalDecorMode('/route-inconnue'), 'none');
  assert.equal(scope.resolveSeasonalDecorMode('/settings'), 'none');
  assert.equal(scope.resolveSeasonalDecorMode('/live-tv'), 'none');
});

test('la query et le slash final ne changent pas la décision', () => {
  assert.equal(scope.resolveSeasonalDecorMode('/movies?q=matrix'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/movies/'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/watch/movie/12?autoplay=1'), 'none');
});

// ─── Liste stricte et métadonnées ───────────────────────────────────────────

test('la liste stricte gagne toujours sur allow et sur une déclaration publique', () => {
  for (const path of ['/watch/movie/1', '/watchparty/room/ABC', '/auth/google', '/oauth/authorize',
    '/vip/don', '/payment/checkout', '/admin', '/admin-control-center', '/login-bip39',
    '/profile-selection', '/wrapped/2026', '/link-bip39/create']) {
    assert.equal(scope.resolveSeasonalDecorMode(path), 'none', path);
  }
  assert.equal(routes.resolveSeasonalRouteMode('/watch/movie/1', { allow: true }), 'none');
});

test('les routes publiques déclarées gardent leur mode explicite', () => {
  assert.equal(scope.resolveSeasonalDecorMode('/'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/movies'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/provider/arte/movies/12'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/genre/movie/28'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/search'), 'full');
  assert.equal(scope.resolveSeasonalDecorMode('/download/movie/12'), 'minimal');
  assert.deepEqual(scope.seasonalRouteMetadata('/download/movie/12'), { minimal: true });
});

test('le scope ne crée aucune dépendance vers les loaders de page', () => {
  const source = readFileSync(new URL('../src/routing/seasonalScope.ts', import.meta.url), 'utf8');
  assert.equal(/from\s+['"][^'"]*registry/.test(source), false);
  assert.equal(/from\s+['"][^'"]*lazyWithRetry/.test(source), false);
  assert.equal(/from\s+['"]react/.test(source), false);
});
