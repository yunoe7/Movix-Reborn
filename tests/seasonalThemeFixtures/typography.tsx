/* eslint-disable react-refresh/only-export-components -- point d'entrée de fixture, pas un module de composants réutilisables */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { changeLanguage } from '../../src/i18n';
import { LightModeProvider } from '../../src/context/LightModeContext';
import { SeasonalGraphicsProvider } from '../../src/seasonalThemeGraphics/SeasonalGraphicsProvider';
import { useSeasonalGraphics } from '../../src/seasonalThemeGraphics/context';
import type { SeasonalResolvedPayload } from '../../src/seasonalThemeGraphics/loader';

/**
 * Fixture LOT 4B : vrai provider du moteur avec un resolver local déterministe.
 * Les titres portent les marqueurs audités ; aucune API, donnée de production
 * ou préférence locale n'est consultée.
 */

const params = new URLSearchParams(window.location.search);
const initialRoute = params.get('route') || '/';
const unavailable = params.get('resolver') === 'unavailable';
if (params.get('platform') === 'tv') document.documentElement.classList.add('tv-mode');

type Ambiance = 'none' | 'halloween' | 'christmas' | 'emergency' | 'invalid' | 'draft' | 'mixed' | 'unknown';

const decoration = (id: string, family: string) => ({
  id, family, enabled: true, priority: 10, conflictsWith: [], requires: [],
  platforms: {}, capabilities: {}, options: {}, typography: {},
});

function typographyFor(fontKey: 'creepster' | 'archivo-black', effect: 'glow' | 'frost') {
  const decorationId = `${fontKey === 'creepster' ? 'halloween' : 'christmas'}.typography`;
  const themeId = `${fontKey === 'creepster' ? 'halloween' : 'christmas'}-2026`;
  return {
    pageTitle: { decorationId, themeId, enabled: true, fontKey, weight: 400, effect },
    sectionTitle: { decorationId, themeId, enabled: true, fontKey, weight: 400, effect },
    categoryTitle: {
      decorationId, themeId, enabled: true, fontKey: 'inter', weight: 700, effect: 'none',
    },
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
  if (ambiance === 'none') {
    return { ...base, decorations: [], typography: typographyFor('creepster', 'glow') };
  }

  // `mixed` garde la publication de Noël et injecte uniquement un effet interdit
  // sur categoryTitle : c'est le cas de repli partiel attendu par TYPO-13.
  const prefix = ambiance === 'halloween' || ambiance === 'unknown'
    ? 'halloween' : 'christmas';
  const typography = typographyFor(prefix === 'halloween' ? 'creepster' : 'archivo-black',
    prefix === 'halloween' ? 'glow' : 'frost');
  if (ambiance === 'mixed') {
    typography.categoryTitle = { ...typography.categoryTitle, effect: 'glow' };
  }
  if (ambiance === 'unknown') {
    typography.pageTitle = { ...typography.pageTitle, fontKey: 'comic-sans' };
  }

  return {
    ...base,
    themes: [{ id: `${prefix}-2026` }],
    decorations: [decoration(`${prefix}.background`, 'background')],
    families: { background: [`${prefix}.background`] },
    typography,
  };
}

interface TypographyApi {
  state(): Record<string, unknown>;
  setAmbiance(next: Ambiance): void;
  setRevision(next: number): void;
  navigate(path: string): void;
  setLanguage(lang: string): void;
  calls(): unknown[];
}

declare global {
  interface Window { __typography: TypographyApi }
}

const api: TypographyApi = {
  state: () => ({}),
  setAmbiance: () => undefined,
  setRevision: () => undefined,
  navigate: () => undefined,
  setLanguage: () => undefined,
  calls: () => [],
};
window.__typography = api;

const Probe = ({ ambiance, revision, calls }: {
  ambiance: Ambiance;
  revision: number;
  calls: unknown[];
}) => {
  const { state } = useSeasonalGraphics();
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    api.state = () => {
      const style = document.getElementById('seasonal-typography-styles');
      return {
        ...state,
        pathname: location.pathname,
        callsCount: calls.length,
        typographyAttr: document.documentElement.dataset.seasonalTypography ?? null,
        htmlAttr: document.documentElement.dataset.seasonalGraphics ?? null,
        styleCount: style ? 1 : 0,
        styleText: style?.textContent ?? '',
        markers: document.querySelectorAll([
          '[data-seasonal-typography="pageTitle"]',
          '[data-seasonal-typography="sectionTitle"]',
          '[data-seasonal-typography="categoryTitle"]',
        ].join(',')).length,
      };
    };
    api.navigate = (path: string) => navigateRef.current(path);
    api.calls = () => [...calls];
  }, [state, location.pathname, calls, ambiance, revision]);

  return (
    <main id="fixture-root">
      <h1 id="page-title" data-seasonal-typography="pageTitle" className="text-2xl md:text-3xl font-bold">Titre de page</h1>
      <h2 id="section-title" data-seasonal-typography="sectionTitle" className="section-title text-xl">Titre de section</h2>
      <span id="category-title" data-seasonal-typography="categoryTitle" className="catalog-section-title">Titre de catégorie</span>
      <h3 id="untitled-heading" className="section-title">Titre non ciblé</h3>
      <button type="button" id="action">Lire</button>
    </main>
  );
};

const App = () => {
  const [ambiance, setAmbiance] = useState<Ambiance>((params.get('ambiance') as Ambiance) || 'none');
  const [revision, setRevision] = useState(4);
  const callsRef = useRef<unknown[]>([]);
  const calls = callsRef.current;

  const resolve = useCallback(async (context: { platform: string; capabilities: string[] }, signal?: AbortSignal) => {
    callsRef.current.push({ ...context, ambiance, revision, aborted: signal?.aborted ?? false });
    if (signal?.aborted) throw new Error('aborted');
    if (unavailable) throw new Error('resolver indisponible');
    return buildPayload(ambiance, revision, context.platform);
  }, [ambiance, revision]);

  useEffect(() => {
    api.setAmbiance = setAmbiance;
    api.setRevision = setRevision;
    api.setLanguage = (lang: string) => {
      void changeLanguage(lang === 'en' ? 'en' : 'fr');
      document.documentElement.lang = lang === 'en' ? 'en' : 'fr';
    };
  }, []);

  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <LightModeProvider>
        <SeasonalGraphicsProvider resolve={resolve}>
          <Probe ambiance={ambiance} revision={revision} calls={calls} />
        </SeasonalGraphicsProvider>
      </LightModeProvider>
    </MemoryRouter>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
