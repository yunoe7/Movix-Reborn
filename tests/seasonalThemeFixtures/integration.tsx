/* eslint-disable react-refresh/only-export-components -- point d'entrée de fixture, pas un module de composants réutilisables */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { LightModeProvider } from '../../src/context/LightModeContext';
import { ChristmasAtmosphere } from '../../src/components/ChristmasAtmosphere';
import { HalloweenAtmosphere } from '../../src/components/HalloweenAtmosphere';
import { useSeasonalGraphics } from '../../src/seasonalThemeGraphics/context';
import { SeasonalGraphicsProvider } from '../../src/seasonalThemeGraphics/SeasonalGraphicsProvider';
import { changeLanguage } from '../../src/i18n';
import type { SeasonalResolvedPayload } from '../../src/seasonalThemeGraphics/loader';

/**
 * Fixture LOT 5 : vrai provider LOT 4A/4B et vraies atmosphères historiques,
 * avec un resolver local déterministe. Aucun appel réel, aucun compte, aucun
 * secret, aucune préférence publiée en dehors du snapshot injecté.
 */

const params = new URLSearchParams(window.location.search);
const initialRoute = params.get('route') || '/';

if (params.get('platform') === 'tv') document.documentElement.classList.add('tv-mode');

type Ambiance =
  | 'none' | 'halloween' | 'christmas' | 'both' | 'conflict'
  | 'emergency' | 'invalid' | 'draft' | 'graphicsOnly' | 'typographyOnly'
  | 'fontFail';

const decoration = (id: string, family: string) => ({
  id, family, enabled: true, priority: 10, conflictsWith: [], requires: [],
  platforms: {}, capabilities: {}, options: {}, typography: {},
});

function typographyFor(fontKey: 'creepster' | 'archivo-black', effect: 'glow' | 'frost') {
  const themeId = fontKey === 'creepster' ? 'halloween-2026' : 'christmas-2026';
  const decorationId = `${fontKey === 'creepster' ? 'halloween' : 'christmas'}.typography`;
  return {
    pageTitle: { decorationId, themeId, enabled: true, fontKey, weight: 400, effect },
    sectionTitle: { decorationId, themeId, enabled: true, fontKey, weight: 400, effect },
    categoryTitle: { decorationId, themeId, enabled: true, fontKey: 'inter', weight: 700, effect: 'none' },
  };
}

function buildPayload(ambiance: Ambiance, revision: number, platform: string): SeasonalResolvedPayload {
  const base = {
    emergencyDisable: false,
    revision,
    resolvedAt: '2026-10-28T12:00:00.000Z',
    platform,
    capabilities: platform === 'tv' ? ['tvStaticEffects'] : [],
    themes: [] as unknown[],
    families: {} as Record<string, string[]>,
    typography: {} as Record<string, unknown>,
  };

  if (ambiance === 'emergency') {
    return { ...base, emergencyDisable: true, revision: undefined, decorations: [] };
  }
  if (ambiance === 'invalid') {
    return { ...base, revision: Number.NaN, decorations: [decoration('halloween.background', 'background')] };
  }
  if (ambiance === 'draft') {
    return { ...base, decorations: ['inconnu.2027'], typography: typographyFor('creepster', 'glow') };
  }
  if (ambiance === 'none') return { ...base, decorations: [] };

  const halloween = [
    decoration('halloween.background', 'background'),
    decoration('halloween.screenDecor', 'screenDecor'),
    decoration('halloween.lights', 'lights'),
    decoration('halloween.particles', 'particles'),
    decoration('halloween.components', 'components'),
  ];
  const christmas = [
    decoration('christmas.background', 'background'),
    decoration('christmas.screenDecor', 'screenDecor'),
    decoration('christmas.lights', 'lights'),
    decoration('christmas.particles', 'particles'),
    decoration('christmas.components', 'components'),
  ];
  const decorations = {
    halloween,
    christmas,
    fontFail: halloween,
    graphicsOnly: halloween.slice(0, 3),
    typographyOnly: [],
    // Conflit déjà tranché côté serveur : un seul gagnant est transmis.
    conflict: [decoration('christmas.screenDecor', 'screenDecor')],
    both: [
      decoration('halloween.background', 'background'),
      decoration('christmas.background', 'background'),
      decoration('halloween.screenDecor', 'screenDecor'),
      decoration('christmas.particles', 'particles'),
      decoration('christmas.components', 'components'),
    ],
  }[ambiance] ?? [];

  const typography = ambiance === 'graphicsOnly'
    ? {}
    : typographyFor(ambiance === 'christmas' || ambiance === 'conflict' || ambiance === 'both'
      ? 'archivo-black' : 'creepster', ambiance === 'christmas' || ambiance === 'conflict' || ambiance === 'both'
      ? 'frost' : 'glow');

  return {
    ...base,
    themes: [{ id: ambiance === 'christmas' || ambiance === 'conflict' || ambiance === 'both' ? 'christmas-2026' : 'halloween-2026' }],
    decorations,
    families: { background: decorations.map((item) => item.id) },
    typography,
  };
}

interface IntegrationApi {
  state(): Record<string, unknown>;
  navigate(path: string): void;
  setAmbiance(next: Ambiance): void;
  setRevision(next: number): void;
  setLegacy(next: { halloween?: boolean; christmas?: boolean }): void;
  setLanguage(lang: 'fr' | 'en'): void;
  calls(): unknown[];
}

declare global {
  interface Window { __integration: IntegrationApi }
}

const api: IntegrationApi = {
  state: () => ({}),
  navigate: () => undefined,
  setAmbiance: () => undefined,
  setRevision: () => undefined,
  setLegacy: () => undefined,
  setLanguage: () => undefined,
  calls: () => [],
};
window.__integration = api;

const Probe = ({ ambiance, revision, calls }: {
  ambiance: Ambiance;
  revision: number;
  calls: unknown[];
}) => {
  const { state, suppressLegacy } = useSeasonalGraphics();
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    api.state = () => {
      const style = document.getElementById('seasonal-typography-styles');
      const html = document.documentElement;
      return {
        ...state,
        suppressLegacy,
        pathname: location.pathname,
        callsCount: calls.length,
        layerRoots: document.querySelectorAll('[data-seasonal-graphics-layer]').length,
        canvas: document.querySelectorAll('canvas.sg-particles').length,
        layers: document.querySelectorAll('[data-sg-decoration]').length,
        typographyAttr: html.dataset.seasonalTypography ?? null,
        graphicsAttr: html.dataset.seasonalGraphics ?? null,
        componentsAttr: html.dataset.seasonalComponents ?? null,
        halloweenClass: html.classList.contains('halloween-theme'),
        christmasClass: html.classList.contains('christmas-theme'),
        halloweenAttr: html.hasAttribute('data-halloween-enabled'),
        christmasAttr: html.hasAttribute('data-christmas-enabled'),
        legacyHalloween: document.querySelectorAll('.halloween-atmosphere').length,
        legacyChristmas: document.querySelectorAll('.movix-christmas-atmosphere').length,
        styleCount: style ? 1 : 0,
        styleText: style?.textContent ?? '',
        markers: document.querySelectorAll('[data-seasonal-typography]').length,
        focusableInLayer: document.querySelectorAll('.sg-root button, .sg-root a, .sg-root [tabindex]').length,
        fonts: Array.from(document.fonts).map((face) => ({
          family: face.family,
          status: face.status,
        })),
        titleText: document.getElementById('page-title')?.textContent ?? '',
      };
    };
    api.navigate = (path: string) => navigateRef.current(path);
    api.calls = () => [...calls];
  }, [state, suppressLegacy, location.pathname, calls, ambiance, revision]);

  return (
    <main id="fixture-root">
      <h1 id="page-title" data-seasonal-typography="pageTitle" className="text-2xl font-bold">Titre de page</h1>
      <h2 id="section-title" data-seasonal-typography="sectionTitle" className="section-title text-xl">Titre de section</h2>
      <span id="category-title" data-seasonal-typography="categoryTitle" className="catalog-section-title">Catégorie</span>
      <button type="button" id="action" className="fixture-focus">Lire</button>
    </main>
  );
};

const Atmospheres = () => {
  const { suppressLegacy } = useSeasonalGraphics();
  return (
    <>
      <HalloweenAtmosphere suspended={suppressLegacy} />
      <ChristmasAtmosphere suspended={suppressLegacy} />
    </>
  );
};

const App = () => {
  const [ambiance, setAmbiance] = useState<Ambiance>((params.get('ambiance') as Ambiance) || 'none');
  const [revision, setRevision] = useState(4);
  const callsRef = useRef<unknown[]>([]);
  const calls = callsRef.current;

  const resolve = useCallback(async (
    context: { platform: string; capabilities: string[] },
    signal?: AbortSignal,
  ) => {
    callsRef.current.push({ ...context, ambiance, revision, aborted: signal?.aborted ?? false });
    if (signal?.aborted) throw new Error('aborted');
    return buildPayload(ambiance, revision, context.platform);
  }, [ambiance, revision]);

  useEffect(() => {
    api.setAmbiance = setAmbiance;
    api.setRevision = setRevision;
    api.setLegacy = (next) => {
      if (next.halloween !== undefined) {
        localStorage.setItem('settings_halloween_theme', next.halloween ? '1' : '0');
      }
      if (next.christmas !== undefined) {
        localStorage.setItem('settings_christmas_theme', next.christmas ? '1' : '0');
      }
      window.dispatchEvent(new Event('sync_storage_updated'));
      window.dispatchEvent(new Event('movix:halloween-theme-changed'));
      window.dispatchEvent(new Event('movix:christmas-theme-changed'));
    };
    api.setLanguage = (lang) => {
      void changeLanguage(lang);
      document.documentElement.lang = lang;
    };
  }, []);

  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <LightModeProvider>
        <SeasonalGraphicsProvider resolve={resolve}>
          <Atmospheres />
          <Probe ambiance={ambiance} revision={revision} calls={calls} />
        </SeasonalGraphicsProvider>
      </LightModeProvider>
    </MemoryRouter>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
