/* eslint-disable react-refresh/only-export-components -- point d'entrée de fixture, pas un module de composants réutilisables */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../../src/i18n';
import { LightModeProvider } from '../../src/context/LightModeContext';
import { SeasonalGraphicsProvider } from '../../src/seasonalThemeGraphics/SeasonalGraphicsProvider';
import { useSeasonalGraphics } from '../../src/seasonalThemeGraphics/context';
import type { SeasonalResolvedPayload } from '../../src/seasonalThemeGraphics/loader';

/**
 * Fixture LOT 4A : monte le vrai provider du moteur avec un resolver local
 * déterministe. Aucune API réelle, aucun compte, aucune donnée de production.
 */

const params = new URLSearchParams(window.location.search);
const initialRoute = params.get('route') || '/';
const platformQuery = params.get('platform');
const unavailable = params.get('resolver') === 'unavailable';

if (platformQuery === 'tv') document.documentElement.classList.add('tv-mode');

type Ambiance = 'none' | 'halloween' | 'christmas' | 'both' | 'conflict' | 'emergency' | 'invalid' | 'draft';

const decoration = (id: string, family: string, options: Record<string, string | number> = {}) => ({
  id, family, enabled: true, priority: 10, conflictsWith: [], requires: [],
  platforms: {}, capabilities: {}, options, typography: {},
});

function buildPayload(ambiance: Ambiance, revision: number, context: { platform: string }): SeasonalResolvedPayload {
  const base = {
    emergencyDisable: false,
    revision,
    resolvedAt: '2026-10-28T12:00:00.000Z',
    platform: context.platform,
    capabilities: [],
    themes: [],
    families: {} as Record<string, string[]>,
    typography: {},
  };
  if (ambiance === 'emergency') return {
    ...base,
    emergencyDisable: true,
    revision: undefined,
    decorations: [],
    themes: [],
  };
  if (ambiance === 'invalid') return {
    ...base,
    revision: Number.NaN,
    decorations: decoration('halloween.background', 'background'),
  };
  if (ambiance === 'draft') return { ...base, decorations: ['inconnu.2027'] };
  if (ambiance === 'none') return { ...base, decorations: [] };

  const decorations = {
    halloween: [
      decoration('halloween.background', 'background'),
      decoration('halloween.screenDecor', 'screenDecor'),
      decoration('halloween.lights', 'lights'),
      decoration('halloween.particles', 'particles', { density: 1 }),
      decoration('halloween.components', 'components'),
    ],
    christmas: [
      decoration('christmas.background', 'background'),
      decoration('christmas.screenDecor', 'screenDecor'),
      decoration('christmas.lights', 'lights'),
      decoration('christmas.particles', 'particles'),
      decoration('christmas.components', 'components'),
    ],
    both: [
      decoration('halloween.background', 'background'),
      decoration('christmas.background', 'background'),
      decoration('halloween.screenDecor', 'screenDecor'),
      decoration('halloween.lights', 'lights'),
      decoration('christmas.particles', 'particles'),
      decoration('christmas.components', 'components'),
    ],
    // Le resolver a déjà tranché : un seul gagnant est transmis au moteur.
    conflict: [decoration('christmas.screenDecor', 'screenDecor')],
  }[ambiance] ?? [];

  return {
    ...base,
    themes: [{ id: ambiance === 'halloween' || ambiance === 'both' ? 'halloween-2026' : 'christmas-2026' }],
    decorations,
    families: { screenDecor: decorations.map((item) => item.id) },
  };
}

interface GraphicsApi {
  state(): unknown;
  setAmbiance(next: Ambiance): void;
  navigate(path: string): void;
  setRevision(next: number): void;
  setHidden(next: boolean): void;
  setLanguage(lang: string): void;
  calls(): unknown[];
}

declare global {
  interface Window { __graphics: GraphicsApi }
}

const api: GraphicsApi = {
  state: () => ({}),
  setAmbiance: () => undefined,
  navigate: () => undefined,
  setRevision: () => undefined,
  setHidden: () => undefined,
  setLanguage: () => undefined,
  calls: () => [],
};
window.__graphics = api;

const Probe = ({ ambiance, revision, calls }: {
  ambiance: Ambiance;
  revision: number;
  calls: unknown[];
}) => {
  const { state, suppressLegacy } = useSeasonalGraphics();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [hidden, setHiddenState] = useState(false);

  useEffect(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, [hidden]);

  useEffect(() => {
    api.state = () => ({
      ...state,
      suppressLegacy,
      pathname: location.pathname,
      layers: document.querySelectorAll('[data-sg-decoration]').length,
      canvas: document.querySelectorAll('canvas.sg-particles').length,
      layerRoot: document.querySelectorAll('[data-seasonal-graphics-layer]').length,
      htmlAttr: document.documentElement.dataset.seasonalGraphics ?? null,
      componentsAttr: document.documentElement.dataset.seasonalComponents ?? null,
      focusableInLayer: document.querySelectorAll('.sg-root button, .sg-root a, .sg-root [tabindex]').length,
    });
    api.navigate = (path: string) => navigate(path);
    api.setHidden = setHiddenState;
    api.calls = () => [...calls];
  }, [state, suppressLegacy, location.pathname, navigate, hidden, calls, ambiance, revision]);

  return (
    <main id="fixture-root">
      <h1 data-testid="content">{t('nav.home')}</h1>
      <p data-testid="secondary">{t('nav.movies')}</p>
      <button type="button" id="action">Ajouter</button>
      <article className="cg-card-media" data-testid="card">Carte</article>
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
    return buildPayload(ambiance, revision, context);
  }, [ambiance, revision]);

  useEffect(() => {
    api.setAmbiance = (next: Ambiance) => setAmbiance(next);
    api.setRevision = (next: number) => setRevision(next);
    api.setLanguage = (lang: string) => {
      void changeLanguage(lang === 'en' ? 'en' : 'fr');
      document.documentElement.lang = lang === 'en' ? 'en' : 'fr';
    };
  }, []);

  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <LightModeProvider>
        <SeasonalGraphicsProvider
          resolve={resolve}
        >
          <Probe ambiance={ambiance} revision={revision} calls={calls} />
        </SeasonalGraphicsProvider>
      </LightModeProvider>
    </MemoryRouter>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
