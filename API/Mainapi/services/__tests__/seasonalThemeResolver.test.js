'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefaultConfig,
  mergeConfig,
  validateConfig,
} = require('../seasonalThemeConfig');
const { resolveSeasonalTheme, isThemeWindowActive } = require('../seasonalThemeResolver');

const NOW = new Date('2026-10-28T12:00:00.000Z');

function configFrom(patch) {
  const config = mergeConfig(buildDefaultConfig(), patch);
  validateConfig(config);
  return config;
}

function ids(result) {
  return result.decorations.map((entry) => entry.id).sort();
}

// ---------------------------------------------------------------------------

test('sans publication, aucune décoration ni police thématique n’est résolue', () => {
  const result = resolveSeasonalTheme(buildDefaultConfig(), { now: NOW });
  assert.deepEqual(result.decorations, []);
  assert.equal(result.themes.length, 0);
  assert.deepEqual(result.families, {
    screenDecor: [],
    background: [],
    components: [],
    lights: [],
    particles: [],
    typography: [],
  });
  assert.equal(Object.values(result.typography).every((entry) => entry.decorationId === null), true);
});

test('plusieurs thèmes et plusieurs décorations compatibles coexistent', () => {
  const config = configFrom({
    themes: [
      {
        id: 'halloween-2026',
        enabled: true,
        decorations: [
          { id: 'halloween.background', enabled: true },
          { id: 'halloween.background.fog', enabled: true },
          { id: 'halloween.lights.candles', enabled: true },
        ],
      },
      {
        id: 'christmas-2026',
        enabled: true,
        decorations: [
          { id: 'christmas.background', enabled: true },
          { id: 'christmas.background.snow', enabled: true },
          { id: 'christmas.components', enabled: true },
        ],
      },
    ],
  });
  const result = resolveSeasonalTheme(config, { now: NOW });
  assert.deepEqual(ids(result), [
    'christmas.background',
    'christmas.background.snow',
    'christmas.components',
    'halloween.background',
    'halloween.background.fog',
    'halloween.lights.candles',
  ]);
  assert.deepEqual(result.families.background.sort(), [
    'christmas.background',
    'christmas.background.snow',
    'halloween.background',
    'halloween.background.fog',
  ]);
});

test('un conflit explicite est tranché par priorité, puis par identifiant', () => {
  const highPriority = configFrom({
    themes: [
      { id: 'halloween-2026', enabled: true, decorations: [{ id: 'halloween.screenDecor', enabled: true }] },
      { id: 'christmas-2026', enabled: true, decorations: [{ id: 'christmas.screenDecor', enabled: true }] },
    ],
  });
  assert.deepEqual(ids(resolveSeasonalTheme(highPriority, { now: NOW })), ['christmas.screenDecor']);

  const tie = configFrom({
    themes: [
      {
        id: 'halloween-2026',
        enabled: true,
        priority: 10,
        decorations: [{ id: 'halloween.screenDecor', enabled: true, priority: 10 }],
      },
      {
        id: 'christmas-2026',
        enabled: true,
        priority: 10,
        decorations: [{ id: 'christmas.screenDecor', enabled: true, priority: 10 }],
      },
    ],
  });
  assert.deepEqual(ids(resolveSeasonalTheme(tie, { now: NOW })), ['christmas.screenDecor']);

  const reversed = { ...tie, themes: [...tie.themes].reverse() };
  assert.deepEqual(ids(resolveSeasonalTheme(reversed, { now: NOW })), ids(resolveSeasonalTheme(tie, { now: NOW })));
});

test('requires exclut une décorations dont le prérequis n’est pas publié', () => {
  const config = configFrom({
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      decorations: [{ id: 'halloween.lights.candles', enabled: true }],
    }],
  });
  assert.deepEqual(ids(resolveSeasonalTheme(config, { now: NOW })), []);

  const withPrerequisite = mergeConfig(config, {
    themes: [{
      id: 'halloween-2026',
      decorations: [{ id: 'halloween.background', enabled: true }],
    }],
  });
  assert.deepEqual(ids(resolveSeasonalTheme(withPrerequisite, { now: NOW })), [
    'halloween.background',
    'halloween.lights.candles',
  ]);
});

test('plateformes et capacités filtrent les décorations', () => {
  const config = configFrom({
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      decorations: [
        { id: 'halloween.background', enabled: true },
        { id: 'halloween.lights', enabled: true, capabilities: { reducedMotion: false } },
      ],
    }],
  });

  assert.deepEqual(ids(resolveSeasonalTheme(config, { now: NOW, platform: 'tv' })), ['halloween.background']);
  assert.deepEqual(ids(resolveSeasonalTheme(config, { now: NOW, platform: 'desktop' })), [
    'halloween.background',
    'halloween.lights',
  ]);
  assert.deepEqual(ids(resolveSeasonalTheme(config, {
    now: NOW,
    platform: 'desktop',
    capabilities: ['reducedMotion'],
  })), ['halloween.background']);
});

test('la programmation et l’expiration suivent le fuseau de la fenêtre', () => {
  const config = configFrom({
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      windows: [{ start: '2026-10-01', end: '2026-11-01', timezone: 'Europe/Paris' }],
      decorations: [{ id: 'halloween.background', enabled: true }],
    }],
  });
  assert.equal(isThemeWindowActive(config.themes[0], new Date('2026-10-31T21:30:00.000Z')), true);
  assert.equal(isThemeWindowActive(config.themes[0], new Date('2026-10-31T23:30:00.000Z')), false);
  assert.deepEqual(ids(resolveSeasonalTheme(config, { now: new Date('2026-10-31T21:30:00.000Z') })), ['halloween.background']);
  assert.deepEqual(ids(resolveSeasonalTheme(config, { now: new Date('2026-10-31T23:30:00.000Z') })), []);
});

test('une seule décoration typographique gagne par catégorie', () => {
  const patch = {
    themes: [
      {
        id: 'halloween-2026',
        enabled: true,
        decorations: [{ id: 'halloween.typography', enabled: true }],
      },
      {
        id: 'christmas-2026',
        enabled: true,
        decorations: [{ id: 'christmas.typography', enabled: true }],
      },
    ],
  };
  const config = configFrom(patch);
  const result = resolveSeasonalTheme(config, { now: NOW });

  assert.deepEqual(Object.keys(result.typography), ['pageTitle', 'sectionTitle', 'categoryTitle']);
  for (const entry of Object.values(result.typography)) {
    assert.equal(entry.decorationId, 'christmas.typography');
    assert.equal(Array.isArray(entry.fontKey), false);
    assert.equal(typeof entry.fontKey, 'string');
  }
  assert.equal(result.typography.pageTitle.fontKey, 'archivo-black');
  assert.equal(result.typography.categoryTitle.effect, 'none');
  assert.deepEqual(ids(resolveSeasonalTheme({ ...config, themes: [...config.themes].reverse() }, { now: NOW })), ids(result));
});

test('l’arrêt d’urgence désactive immédiatement toutes les familles', () => {
  const config = configFrom({
    emergencyDisable: true,
    themes: [{
      id: 'halloween-2026',
      enabled: true,
      decorations: [
        { id: 'halloween.background', enabled: true },
        { id: 'halloween.typography', enabled: true },
      ],
    }],
  });
  const result = resolveSeasonalTheme(config, { now: NOW });
  assert.equal(result.emergencyDisable, true);
  assert.deepEqual(result.decorations, []);
  assert.deepEqual(result.themes, []);
  assert.equal(Object.values(result.families).every((list) => list.length === 0), true);
  assert.equal(Object.values(result.typography).every((entry) => entry.decorationId === null && !entry.enabled), true);
});
