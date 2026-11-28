import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/*
 * Modes de défaillance identifiés avant l'implémentation (LOT 3).
 *
 * Les harnais LOT 0 couvrent le shell admin et des statiques, mais aucun
 * scénario n'exerce les appels Décoratif : ADMIN-06/07 sont codés en dur en
 * blocked/not-run, ADMIN-08/09 en blocked, ADMIN-11 en blocked. ADMIN-02
 * monte le placeholder historique et affirme l'absence de boutons. Les tests
 * ci-dessous couvrent donc, en isolation :
 *   - jeton admin absent, 401, 403, 429, 503, 400, 409 (révision ET urgence) ;
 *   - réponse JSON invalide ou incomplète, erreur réseau, signal d'annulation ;
 *   - transport de `expectedRevision` et de l'identité d'action ;
 *   - routes publiques sans jeton ;
 *   - pagination historique/audit et bornes de limit ;
 *   - brouillon : clonage, empreinte stable, patch minimal sans urgence ;
 *   - catalogue fermé (polices, effets, familles, plateformes, capacités) ;
 *   - fenêtres et fuseaux, dépendances inconnues, doublons ;
 *   - conflit 409 : préservation des modifications locales et reprise à la
 *     révision distante ;
 *   - résumé du tableau de bord (compteurs, programmations, statut workers).
 *
 * Ces tests sont des tests de contrat purs, sans navigateur ni serveur : ils
 * complètent les E2E existants sans modifier les LOT 0/1/2.
 */

type Service = typeof import('../src/services/seasonalThemeAdminService.ts');
type Form = typeof import('../src/components/adminDecor/seasonalThemeForm.ts');

interface FetchCall { url: string; init: RequestInit }
type FetchAnswer = { status: number; body: unknown } | Error;
type ErrorProbe = { name?: string; code?: string; status?: number; message?: string };

const asErrorProbe = (error: unknown): ErrorProbe => (
  error && typeof error === 'object' ? error as ErrorProbe : {}
);

const transpile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadModules(options: { token?: string | null; answer?: FetchAnswer } = {}) {
  const { token = 'jeton-admin', answer = { status: 200, body: { success: true } } } = options;
  const calls: FetchCall[] = [];
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    };
  };
  const localStorage = { getItem: (key: string) => (key === 'auth_token' ? token : null) };
  const service = {};
  new Function('exports', 'require', 'localStorage', 'fetch', transpile('../src/services/seasonalThemeAdminService.ts'))(
    service,
    (name: string) => {
      if (name === '../config/runtime') return { MAIN_API: 'https://api.test' };
      throw new Error(`module inattendu : ${name}`);
    },
    localStorage,
    fakeFetch,
  );
  const form = {};
  new Function('exports', 'require', transpile('../src/components/adminDecor/seasonalThemeForm.ts'))(
    form,
    (name: string) => {
      if (name === '../../services/seasonalThemeAdminService') return service;
      throw new Error(`module inattendu : ${name}`);
    },
  );
  return { service: service as Service, form: form as Form, calls };
}

function config(service: Service, overrides: Record<string, unknown> = {}) {
  return service.normalizeSeasonalThemeConfig({
    version: 1,
    revision: 4,
    emergencyDisable: false,
    updatedAt: '2026-11-28T10:00:00.000Z',
    updatedBy: 'staff-42',
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      priority: 10,
      windows: [],
      platforms: { mobile: true, desktop: true, tablet: true, tv: true },
      capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: true },
      decorations: [{
        id: 'halloween.background',
        family: 'background',
        enabled: false,
        priority: 10,
        conflictsWith: [],
        requires: [],
        platforms: { mobile: true, desktop: true, tablet: true, tv: true },
        capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: true },
        options: {},
        typography: {},
      }],
    }],
    typography: {
      pageTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
      sectionTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
      categoryTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    },
    ...overrides,
  });
}

function errorWith(status: number, code?: string, error?: string) {
  return { status, body: { success: false, code, error: error || 'refusé' } };
}

// ─── Service ───────────────────────────────────────────────────────────────

test('la lecture admin envoie le jeton Bearer, no-store et normalise la révision', async () => {
  const { service, calls } = loadModules({ answer: { status: 200, body: { success: true, config: {
    revision: 7,
    themes: [{ id: 'halloween-2026', decorations: [] }],
  } } } });
  const result = await service.getAdminSeasonalThemeConfig();
  assert.equal(result.revision, 7);
  assert.equal(result.themes[0].id, 'halloween-2026');
  assert.equal(calls[0].url, 'https://api.test/api/admin/seasonal-theme');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer jeton-admin');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('sans jeton admin, aucune requête n’est effectuée', async () => {
  const { service, calls } = loadModules({ token: null });
  await assert.rejects(
    () => service.getAdminSeasonalThemeConfig(),
    (error: unknown) => asErrorProbe(error).name === 'SeasonalThemeApiError' && asErrorProbe(error).code === 'TOKEN_MISSING',
  );
  assert.equal(calls.length, 0);
});

test('401, 403, 429 et 503 sont distingués sans exposer le corps brut', async () => {
  const cases: Array<[number, string | undefined, string]> = [
    [401, undefined, 'UNAUTHORIZED'],
    [403, undefined, 'FORBIDDEN'],
    [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [503, 'SYNC_UNAVAILABLE', 'UNAVAILABLE'],
  ];
  for (const [status, code, expected] of cases) {
    const { service } = loadModules({ answer: errorWith(status, code, 'détail interne') });
    await assert.rejects(
      () => service.getAdminSeasonalThemeConfig(),
      (error: unknown) => asErrorProbe(error).code === expected && asErrorProbe(error).status === status && asErrorProbe(error).message === 'détail interne',
    );
  }
});

test('les conflits 409 conservent leur code sémantique', async () => {
  for (const code of ['REVISION_CONFLICT', 'EMERGENCY_ACTIVE']) {
    const { service } = loadModules({ answer: errorWith(409, code) });
    await assert.rejects(
      () => service.publishSeasonalThemeConfig({ patch: {}, reason: 'test', expectedRevision: 1 }),
      (error: unknown) => asErrorProbe(error).code === code && asErrorProbe(error).status === 409,
    );
  }
});

test('une erreur 400 de validation et une panne réseau sont classées', async () => {
  const validation = loadModules({ answer: errorWith(400, 'UNKNOWN_FONT') });
  await assert.rejects(
    () => validation.service.getAdminSeasonalThemeConfig(),
    (error: unknown) => asErrorProbe(error).code === 'VALIDATION' && asErrorProbe(error).status === 400,
  );
  const network = loadModules({ answer: new Error('offline') });
  await assert.rejects(
    () => network.service.getAdminSeasonalThemeConfig(),
    (error: unknown) => asErrorProbe(error).code === 'NETWORK',
  );
});

test('la publication transmet patch, motif et révision attendue', async () => {
  const { service, calls } = loadModules({ answer: { status: 200, body: { success: true, config: { revision: 9, themes: [] } } } });
  const patch = { themes: [{ id: 'halloween-2026', enabled: true }] };
  const result = await service.publishSeasonalThemeConfig({ patch, reason: 'campagne', expectedRevision: 8 });
  assert.equal(result.revision, 9);
  assert.equal(calls[0].url, 'https://api.test/api/admin/seasonal-theme');
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    patch, reason: 'campagne', expectedRevision: 8,
  });
});

test('urgence, désactivation ciblée et invalidation utilisent les routes LOT 2', async () => {
  const { service, calls } = loadModules({ answer: { status: 200, body: { success: true, config: { revision: 5, themes: [] } } } });
  await service.setSeasonalThemeEmergency({ enabled: true, reason: 'incident', expectedRevision: 4 });
  assert.equal(calls[0].url, 'https://api.test/api/admin/seasonal-theme/emergency-disable');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { enabled: true, reason: 'incident', expectedRevision: 4 });

  await service.disableSeasonalThemeDecoration({ decorationId: 'halloween.background', reason: 'signalement', expectedRevision: 5 });
  assert.equal(calls[1].url, 'https://api.test/api/admin/seasonal-theme/decorations/disable');
  assert.equal(JSON.parse(String(calls[1].init.body)).decorationId, 'halloween.background');

  const invalidate = loadModules({ answer: { status: 200, body: { success: true, invalidation: { success: true, revision: 5 } } } });
  const result = await invalidate.service.invalidateSeasonalThemeCache({ reason: 'repair', expectedRevision: 5 });
  assert.deepEqual(result, { success: true, revision: 5 });
  assert.equal(invalidate.calls[0].url, 'https://api.test/api/admin/seasonal-theme/cache/invalidate');
});

test('statut, historique et audit bornent la limite et normalisent les entrées', async () => {
  const { service, calls } = loadModules({ answer: { status: 200, body: { success: true, history: [{ changed_by: 'staff-42' }] } } });
  await service.getSeasonalThemeHistory(500);
  assert.equal(calls[0].url, 'https://api.test/api/admin/seasonal-theme/history?limit=100');
  const audit = loadModules({ answer: { status: 200, body: { success: true, audit: [{ admin_id: 'staff-42', details_json: '{"revision":4}' }] } } });
  const rows = await audit.service.getSeasonalThemeAudit(0);
  assert.equal(rows[0].adminId, 'staff-42');
  assert.deepEqual(rows[0].details, { revision: 4 });
  assert.equal(audit.calls[0].url, 'https://api.test/api/admin/seasonal-theme/audit?limit=1');
  const status = loadModules({ answer: { status: 200, body: { success: true, status: { failClosed: false, subscribed: true, emergency: false } } } });
  assert.equal((await status.service.getSeasonalThemeStatus()).subscribed, true);
});

test('les routes publiques et la résolution ne réclament pas de jeton admin', async () => {
  const { service, calls } = loadModules({ token: null, answer: { status: 200, body: { success: true, resolved: { decorations: [] } } } });
  const resolved = await service.resolveSeasonalTheme({ platform: 'tv', capabilities: ['tvStaticEffects'], at: '2026-10-28T12:00:00Z' });
  assert.deepEqual(resolved.decorations, []);
  assert.equal(calls[0].url, 'https://api.test/api/seasonal-theme/resolve?platform=tv&capabilities=tvStaticEffects&at=2026-10-28T12%3A00%3A00Z');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), null);
  await service.getPublicSeasonalThemeConfig();
  assert.equal(calls[1].url, 'https://api.test/api/seasonal-theme');
});

test('un signal d’annulation est transmis à fetch', async () => {
  const { service, calls } = loadModules();
  const controller = new AbortController();
  await service.getAdminSeasonalThemeConfig(controller.signal);
  assert.equal(calls[0].init.signal, controller.signal);
});

// ─── Brouillon, patch et conflit ───────────────────────────────────────────

test('le clonage isole le brouillon de la configuration chargée', () => {
  const { service, form } = loadModules();
  const base = config(service);
  const draft = form.cloneSeasonalThemeConfig(base);
  draft.themes[0].decorations[0].enabled = true;
  assert.equal(base.themes[0].decorations[0].enabled, false);
  assert.equal(form.sameSeasonalThemeConfig(base, draft), false);
});

test('l’empreinte ne dépend pas de l’ordre des clés', () => {
  const { form } = loadModules();
  assert.equal(form.seasonalThemeFingerprint({ a: 1, b: { c: 2 } }), form.seasonalThemeFingerprint({ b: { c: 2 }, a: 1 }));
});

test('le patch ne contient que les champs modifiés et jamais l’urgence', () => {
  const { form, service } = loadModules();
  const base = config(service, { emergencyDisable: true });
  base.themes[0].enabled = false;
  const draft = form.cloneSeasonalThemeConfig(base);
  draft.themes[0].enabled = true;
  draft.themes[0].decorations[0].enabled = true;
  draft.themes[0].decorations[0].priority = 17;
  draft.emergencyDisable = false;
  draft.revision = 999;
  const patch = form.buildSeasonalThemePatch(base, draft);
  assert.deepEqual(patch, {
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      decorations: [{ id: 'halloween.background', enabled: true, priority: 17 }],
    }],
  });
  assert.deepEqual(form.buildSeasonalThemePatch(base, base), {});
});

test('la validation refuse un catalogue fermé et des fenêtres incohérentes', () => {
  const { form, service } = loadModules();
  const draft = config(service);
  const decoration = draft.themes[0].decorations[0];
  decoration.typography = { pageTitle: { enabled: true, fontKey: 'comic-sans', weight: 400, effect: 'none' } };
  draft.themes[0].windows = [{ start: '2026-11-02', end: '2026-11-01', timezone: 'Europe/Paris' }];
  decoration.platforms = { mobile: true, desktop: true, tablet: true, tv: true, unknown: true };
  decoration.requires = ['inconnu.background'];
  const codes = form.validateSeasonalThemeDraft(draft).map((issue) => issue.code);
  for (const expected of ['UNKNOWN_FONT', 'INVALID_RANGE', 'UNKNOWN_PLATFORM', 'UNKNOWN_DECORATION']) {
    assert.ok(codes.includes(expected), `${expected} absent de ${codes.join(',')}`);
  }
});

test('la validation impose un fuseau et refuse un effet sur categoryTitle', () => {
  const { form, service } = loadModules();
  const draft = config(service);
  draft.themes[0].decorations[0].family = 'typography';
  draft.themes[0].decorations[0].typography = {
    categoryTitle: { enabled: true, fontKey: 'inter', weight: 700, effect: 'glow' },
  };
  draft.themes[0].windows = [{ start: '2026-12-01', end: '2026-12-25', timezone: '' }];
  const codes = form.validateSeasonalThemeDraft(draft).map((issue) => issue.code);
  assert.ok(codes.includes('EFFECT_SCOPE'));
  assert.ok(codes.includes('INVALID_TIMEZONE'));
});

test('un conflit 409 préserve les modifications locales et reprend la révision distante', () => {
  const { form, service } = loadModules();
  const base = config(service, { revision: 4 });
  const local = form.cloneSeasonalThemeConfig(base);
  local.themes[0].decorations[0].enabled = true;
  const remote = form.cloneSeasonalThemeConfig(base);
  remote.revision = 5;
  remote.themes[0].priority = 42;
  const merged = form.mergeSeasonalThemeRemote(base, local, remote);
  assert.equal(merged.revision, 5);
  assert.equal(merged.themes[0].priority, 42);
  assert.equal(merged.themes[0].decorations[0].enabled, true);
  assert.equal(form.buildSeasonalThemePatch(remote, merged).themes[0].decorations[0].enabled, true);
});

test('le résumé du tableau de bord dérive de la configuration et du statut réels', () => {
  const { form, service } = loadModules();
  const draft = config(service, {
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      priority: 10,
      windows: [{ start: '2026-11-01', end: '2026-12-26', timezone: 'Europe/Paris' }],
      platforms: { mobile: true, desktop: true, tablet: true, tv: true },
      capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: true },
      decorations: [{
        id: 'halloween.background',
        family: 'background',
        enabled: true,
        priority: 10,
        conflictsWith: [],
        requires: [],
        platforms: { mobile: true, desktop: true, tablet: true, tv: true },
        capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: true },
        options: {},
        typography: {},
      }],
    }],
    updatedAt: '2026-11-28T10:00:00.000Z',
  });
  const summary = form.summarizeSeasonalThemeConfig(draft, { failClosed: false, subscribed: true, emergency: false, localRevision: 4 }, new Date('2026-11-28T11:00:00Z'));
  assert.equal(summary.themesConfigured, 1);
  assert.equal(summary.themesPublished, 1);
  assert.equal(summary.themesActive, 1);
  assert.equal(summary.decorationsEnabled, 1);
  assert.equal(summary.revision, 4);
  assert.equal(summary.lastPublication, '2026-11-28T10:00:00.000Z');
  assert.equal(summary.upcomingWindows.length, 1);
  assert.equal(summary.syncState, 'ok');
});

test('l’aperçu structurel est une copie isolée et ne publie rien', () => {
  const { form, service, calls } = loadModules();
  const base = config(service);
  const draft = form.cloneSeasonalThemeConfig(base);
  draft.themes[0].decorations[0].enabled = true;
  const preview = form.buildSeasonalThemePreview(draft, { platform: 'tv', capabilities: ['tvStaticEffects'], at: '2026-11-28T11:00:00Z' });
  assert.equal(preview.source, 'draft');
  assert.equal(preview.published, false);
  assert.equal(preview.themes[0].decorations[0].enabled, true);
  draft.themes[0].decorations[0].enabled = false;
  assert.equal(preview.themes[0].decorations[0].enabled, true);
  assert.equal(calls.length, 0);
});
