import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'settings_hide_hero';
const HERO_VISIBILITY_EVENT = 'hero_visibility_changed';

const readHidden = () => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
};

// Plusieurs composants (hero, réglages, squelette, couleurs) observent le même
// réglage. Un seul jeu de listeners DOM suffit, comme pour les couleurs média.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const onStorage = (event: StorageEvent) => {
  if (event.key === STORAGE_KEY || event.key === null) notify();
};

function subscribe(sync: () => void) {
  if (!listeners.size) {
    window.addEventListener('storage', onStorage);
    window.addEventListener('sync_storage_updated', notify);
    window.addEventListener(HERO_VISIBILITY_EVENT, notify);
  }
  listeners.add(sync);
  return () => {
    listeners.delete(sync);
    if (!listeners.size) {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sync_storage_updated', notify);
      window.removeEventListener(HERO_VISIBILITY_EVENT, notify);
    }
  };
}

export const useHeroHidden = () => useSyncExternalStore(subscribe, readHidden, () => false);
