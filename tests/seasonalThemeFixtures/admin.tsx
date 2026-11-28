/** Fixture LOT 0 : console « Décoratif » réelle, sans backend. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import AdminDecorPlaceholder from '@/components/admin/AdminDecorPlaceholder';
import fr from '@/i18n/locales/fr.json';
import en from '@/i18n/locales/en.json';

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
      <AdminDecorPlaceholder />
    </div>
  </I18nextProvider>,
);
