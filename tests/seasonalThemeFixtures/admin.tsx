/** Fixture LOT 3 : console « Décoratif » réelle, API simulée localement. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import AdminDecor from '@/components/adminDecor/AdminDecor';
import { AdminConfirmProvider } from '@/components/admin/AdminConfirmProvider';
import { LightModeProvider } from '@/context/LightModeContext';
import fr from '@/i18n/locales/fr.json';
import en from '@/i18n/locales/en.json';

interface AdminCall {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
  cache: string | undefined;
}

interface AdminWindow {
  __seasonalAdminCalls: AdminCall[];
  __seasonalFetchConfig: () => unknown;
}

const declaredWindow = window as unknown as AdminWindow;
declaredWindow.__seasonalAdminCalls = [];
const conflictMode = new URLSearchParams(window.location.search).get('conflict') === '1';
let conflictSeen = false;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const config = {
  version: 1,
  revision: 4,
  emergencyDisable: false,
  updatedAt: '2026-10-27T10:00:00.000Z',
  updatedBy: 'staff-42',
  themes: [{
    id: 'halloween-2026',
    enabled: true,
    priority: 10,
    windows: [{ start: '2026-10-20', end: '2026-11-05', timezone: 'Europe/Paris' }],
    platforms: { mobile: true, desktop: true, tablet: true, tv: true },
    capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: true },
    decorations: [
      {
        id: 'halloween.screenDecor',
        family: 'screenDecor',
        enabled: true,
        priority: 10,
        conflictsWith: ['christmas.screenDecor'],
        requires: [],
        platforms: { mobile: true, desktop: true, tablet: true, tv: false },
        capabilities: { lightMode: true, reducedMotion: true, tvStaticEffects: false },
        options: { opacity: 0.8 },
        typography: {},
      },
      {
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
      },
    ],
  }],
  typography: {
    pageTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    sectionTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
    categoryTitle: { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' },
  },
};

const status = {
  failClosed: false,
  subscribed: true,
  localRevision: 4,
  emergency: false,
  channel: 'seasonal-theme:changes',
};

const history = [{
  id: 1,
  config: config,
  changedBy: 'staff-42',
  reason: 'campagne Halloween',
  changedAt: '2026-10-27T10:00:00.000Z',
}];

const audit = [{
  id: 1,
  adminId: 'staff-42',
  adminAuthType: 'staff',
  action: 'publish',
  target: 'seasonal-theme',
  details: { revision: 4 },
  createdAt: '2026-10-27T10:00:00.000Z',
}];

declaredWindow.__seasonalFetchConfig = () => clone(config);

const jsonResponse = (body: unknown, statusCode = 200) => ({
  ok: statusCode >= 200 && statusCode < 300,
  status: statusCode,
  json: async () => body,
});

window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
  declaredWindow.__seasonalAdminCalls.push({
    url,
    method,
    body,
    authorization: headers.get('Authorization'),
    cache: init.cache,
  });

  if (url.endsWith('/api/admin/seasonal-theme') && method === 'GET') {
    if (conflictMode && conflictSeen) {
      const remote = clone(config);
      remote.revision = 6;
      remote.themes[0].priority = 42;
      return jsonResponse({ success: true, config: remote });
    }
    return jsonResponse({ success: true, config: clone(config) });
  }
  if (url.includes('/api/admin/seasonal-theme/status')) {
    return jsonResponse({ success: true, status: clone(status) });
  }
  if (url.includes('/api/admin/seasonal-theme/history')) {
    return jsonResponse({ success: true, history: clone(history) });
  }
  if (url.includes('/api/admin/seasonal-theme/audit')) {
    return jsonResponse({ success: true, audit: clone(audit) });
  }
  if (url.endsWith('/api/admin/seasonal-theme') && method === 'PUT') {
    if (conflictMode) {
      conflictSeen = true;
      return jsonResponse({ success: false, code: 'REVISION_CONFLICT', error: 'Conflit de révision simulé' }, 409);
    }
    const next = clone(config);
    next.revision = 5;
    next.updatedAt = '2026-10-28T10:00:00.000Z';
    const patchThemes = (body.patch as { themes?: unknown[] } | undefined)?.themes;
    if (Array.isArray(patchThemes)) {
      for (const entry of patchThemes) {
        const target = next.themes.find((theme) => theme.id === (entry as { id?: string }).id);
        if (target) Object.assign(target, entry);
      }
    }
    Object.assign(config, next);
    return jsonResponse({ success: true, config: next });
  }
  if (url.includes('/api/admin/seasonal-theme/emergency-disable')) {
    const next = clone(config);
    next.emergencyDisable = Boolean(body.enabled);
    next.revision = 6;
    Object.assign(config, next);
    return jsonResponse({ success: true, config: next });
  }
  if (url.includes('/api/admin/seasonal-theme/decorations/disable')) {
    const next = clone(config);
    const decoration = next.themes[0].decorations.find((item) => item.id === body.decorationId);
    if (decoration) decoration.enabled = false;
    next.revision = 5;
    Object.assign(config, next);
    return jsonResponse({ success: true, config: next });
  }
  if (url.includes('/api/admin/seasonal-theme/cache/invalidate')) {
    return jsonResponse({ success: true, invalidation: { success: true, revision: Number(body.expectedRevision) } });
  }
  return jsonResponse({ success: false, code: 'REQUEST_FAILED', error: 'route de fixture inconnue' }, 404);
};

try {
  localStorage.setItem('auth_token', 'fixture-admin-token');
} catch {
  // Stockage indisponible : le service signalera TOKEN_MISSING.
}

const language = new URLSearchParams(window.location.search).get('lng') === 'en' ? 'en' : 'fr';
await i18next.init({
  lng: language,
  fallbackLng: 'fr',
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
});

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18next}>
    <div className="admin-console" id="fixture-root">
      <div className="admin-section-content">
        <LightModeProvider>
          <AdminConfirmProvider>
            <AdminDecor />
          </AdminConfirmProvider>
        </LightModeProvider>
      </div>
    </div>
  </I18nextProvider>,
);
