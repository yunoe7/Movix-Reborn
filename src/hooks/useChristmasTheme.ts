import { useSyncExternalStore } from 'react';
import { readLocalStorage, writeLocalStorage } from '@/utils/browserStorage';

/** Thème de Noël : actif automatiquement du 1er décembre au 6 janvier,
 * sauf si la personne a enregistré un choix explicite dans les paramètres. */
export const CHRISTMAS_THEME_STORAGE_KEY = 'settings_christmas_theme';
export const CHRISTMAS_THEME_CLASS = 'christmas-theme';
export const CHRISTMAS_ENABLED_ATTR = 'data-christmas-enabled';
const CHRISTMAS_THEME_EVENT = 'movix:christmas-theme-changed';

export const isChristmasSeason = (date = new Date()): boolean =>
  date.getMonth() === 11 || (date.getMonth() === 0 && date.getDate() <= 6);

let memoryValue: boolean | null = null;

export const readChristmasTheme = (): boolean => {
  const stored = readLocalStorage(CHRISTMAS_THEME_STORAGE_KEY);
  if (stored !== null) return stored === '1';
  return memoryValue ?? isChristmasSeason();
};

export const setChristmasTheme = (enabled: boolean): void => {
  memoryValue = enabled;
  writeLocalStorage(CHRISTMAS_THEME_STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new Event(CHRISTMAS_THEME_EVENT));
};

const subscribe = (sync: () => void) => {
  window.addEventListener('storage', sync);
  window.addEventListener('sync_storage_updated', sync);
  window.addEventListener(CHRISTMAS_THEME_EVENT, sync);
  return () => {
    window.removeEventListener('storage', sync);
    window.removeEventListener('sync_storage_updated', sync);
    window.removeEventListener(CHRISTMAS_THEME_EVENT, sync);
  };
};

export const useChristmasTheme = () =>
  useSyncExternalStore(subscribe, readChristmasTheme, () => false);
