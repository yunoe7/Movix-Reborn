import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { SeasonalTypographySample } from '../../src/components/adminDecor/SeasonalTypographySample';
import { HeroPromoContent } from '../../src/components/hero/HeroPromoContent';
import { LightModeProvider } from '../../src/context/LightModeContext';
import type { HeroPromoDisplay } from '../../src/hooks/useHeroPromos';
import fr from '../../src/i18n/locales/fr.json';
import type { SeasonalThemeConfig } from '../../src/services/seasonalThemeAdminService';
import { resolveDraftTypography } from '../../src/seasonalThemeGraphics/typography/draftPreview';

/**
 * Fixture LOT 4B : monte uniquement l'aperçu administratif isolé, sans moteur
 * public ni resolver distant. Le brouillon est local et ne peut pas être publié.
 */

const draft = {
  revision: 7,
  emergencyDisable: false,
  typography: {
    pageTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    sectionTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    categoryTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
  },
  themes: [{
    id: 'halloween-2026',
    enabled: true,
    priority: 10,
    windows: [],
    decorations: [{
      id: 'halloween.typography',
      family: 'typography',
      enabled: true,
      priority: 10,
      conflictsWith: [],
      requires: [],
      platforms: { desktop: true, tv: true, mobile: true, tablet: true },
      capabilities: {},
      options: {},
      typography: {
        pageTitle: { enabled: true, fontKey: 'creepster', weight: 400, effect: 'glow' },
        sectionTitle: { enabled: true, fontKey: 'archivo-black', weight: 400, effect: 'frost' },
        categoryTitle: { enabled: true, fontKey: 'inter', weight: 700, effect: 'none' },
      },
    }],
  }],
} as unknown as SeasonalThemeConfig;

const selections = resolveDraftTypography(draft, {
  platform: 'desktop',
  capabilities: [],
  at: '2026-10-28T12:00:00Z',
});

await i18next.init({
  lng: 'fr',
  fallbackLng: 'fr',
  resources: { fr: { translation: fr } },
});

// Même chemin que HeroPromoPreview en administration : `preview` doit rendre
// le contenu sans déposer le marqueur public data-seasonal-typography.
const promo = {
  id: 'preview-promo',
  position: 1,
  imageUrl: '',
  mobileImageUrl: null,
  imagePosition: 'center',
  logoUrl: null,
  linkUrl: 'https://example.test',
  internalLink: false,
  openInNewTab: false,
  accentColor: '#ef4444',
  adLabel: { show: false, position: 'top-left' },
  texts: {
    badge: '',
    tagline: '',
    title: 'Titre promo aperçu',
    description: '',
    ctaLabel: 'Voir',
    adLabel: '',
  },
} as unknown as HeroPromoDisplay;

interface PreviewApi {
  unmount(): void;
  state(): Record<string, unknown>;
}

declare global {
  interface Window { __typographyPreview: PreviewApi }
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <I18nextProvider i18n={i18next}>
    <LightModeProvider>
      <div id="fixture-root">
        <SeasonalTypographySample selections={selections} sample="Aperçu du brouillon" />
        <div id="hero-promo-preview" data-testid="hero-promo-preview">
          <HeroPromoContent promo={promo} isActive isMorph={false} frozen preview />
        </div>
      </div>
    </LightModeProvider>
  </I18nextProvider>,
);

window.__typographyPreview = {
  unmount: () => root.unmount(),
  state: () => ({
    rows: document.querySelectorAll([
      '[data-testid="admin-decor-preview-pageTitle"]',
      '[data-testid="admin-decor-preview-sectionTitle"]',
      '[data-testid="admin-decor-preview-categoryTitle"]',
    ].join(',')).length,
    typographyMarkers: document.querySelectorAll('[data-seasonal-typography]').length,
    previewHeroMarkers: document.querySelectorAll('#hero-promo-preview [data-seasonal-typography]').length,
    globalStyle: Boolean(document.getElementById('seasonal-typography-styles')),
    graphicsAttr: document.documentElement.dataset.seasonalGraphics ?? null,
    inlineStyles: document.querySelectorAll('#fixture-root [style*="font-family"]').length,
  }),
};
