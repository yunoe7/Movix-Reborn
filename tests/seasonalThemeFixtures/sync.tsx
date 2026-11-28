/** Fixture LOT 0 : préférences de thème et classification des clés sync. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  getStorageKeySyncState,
  isSyncableStorageKey,
  SERVER_MANAGED_SYNC_KEYS,
} from '@/utils/syncStorage';
import { setHalloweenTheme } from '@/hooks/useHalloweenTheme';
import { setChristmasTheme } from '@/hooks/useChristmasTheme';

const keys = [
  'settings_halloween_theme',
  'settings_christmas_theme',
  'is_vip',
  'auth_token',
  'access_token',
  'discord_token',
  'google_token',
];

(window as unknown as { __seasonalSync: unknown }).__seasonalSync = {
  setHalloween: setHalloweenTheme,
  setChristmas: setChristmasTheme,
  keys: () => Object.fromEntries(keys.map((key) => [key, getStorageKeySyncState(key)])),
  syncable: isSyncableStorageKey,
  serverManaged: SERVER_MANAGED_SYNC_KEYS,
  localStorage: () => Object.fromEntries(Object.entries(localStorage)),
};

createRoot(document.getElementById('root')!).render(
  <div id="fixture-root">
    <h1 id="page-title">Synchronisation des préférences</h1>
    <output id="sync-state">prêt</output>
  </div>,
);
