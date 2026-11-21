import React, { createContext, useContext, useEffect, useMemo, useRef, useCallback, useState } from 'react';

interface HapticsContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  triggerHaptic: (pattern?: string | number | number[]) => void;
}

const HapticsContext = createContext<HapticsContextValue>({
  enabled: true,
  setEnabled: () => {},
  triggerHaptic: () => {},
});

export const useHaptics = () => useContext(HapticsContext);

const STORAGE_KEY = 'settings_haptics_enabled';

// Selectors for interactive elements that should trigger haptic feedback
const INTERACTIVE_SELECTOR = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a[href], input[type="checkbox"], input[type="radio"], select, .haptic-trigger';

export const HapticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [enabled, setEnabledState] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  });
  const enabledRef = useRef(enabled);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    enabledRef.current = v;
    localStorage.setItem(STORAGE_KEY, String(v));
    window.dispatchEvent(new CustomEvent('haptics_settings_changed'));
  }, []);

  // Do not use web-haptics here: its deferred vibration calls can run after
  // transient user activation has expired, which Chrome blocks in embedded
  // frames. Call the native API synchronously from the originating click only.
  const triggerHaptic = useCallback((pattern?: string | number | number[]) => {
    if (!enabledRef.current || typeof navigator === 'undefined') return;
    if (typeof navigator.vibrate !== 'function') return;

    // Chrome requires a fresh user gesture for vibration in embedded contexts.
    // When the browser exposes UserActivation, refuse calls outside that gesture.
    const activation = (navigator as Navigator & {
      userActivation?: { isActive: boolean };
    }).userActivation;
    if (activation && !activation.isActive) return;

    const vibrationPattern: number | number[] =
      typeof pattern === 'number' || Array.isArray(pattern)
        ? pattern
        : pattern === 'error'
          ? [24, 36, 24]
          : pattern === 'success'
            ? [12, 28, 18]
            : [10];

    try {
      navigator.vibrate(vibrationPattern);
    } catch {
      // Vibration is optional; unsupported devices must never affect the UI.
    }
  }, []);

  // Global click interceptor for all interactive elements
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: MouseEvent) => {
      if (!enabledRef.current) return;
      const target = e.target as HTMLElement;
      if (!target) return;

      const interactive = target.closest(INTERACTIVE_SELECTOR);
      if (!interactive) return;

      // Don't haptic on disabled elements
      if ((interactive as HTMLButtonElement).disabled) return;

      // Choose pattern based on element type
      const tag = interactive.tagName.toLowerCase();
      const role = interactive.getAttribute('role');

      if (tag === 'select' || role === 'option') {
        triggerHaptic('nudge');
      } else if (interactive.classList.contains('destructive') || interactive.getAttribute('data-variant') === 'destructive') {
        triggerHaptic('error');
      } else {
        triggerHaptic('nudge');
      }
    };

    document.addEventListener('click', handler, { passive: true, capture: true });
    return () => document.removeEventListener('click', handler, true);
  }, [enabled, triggerHaptic]);

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const v = e.newValue !== 'false';
        setEnabledState(v);
        enabledRef.current = v;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({ enabled, setEnabled, triggerHaptic }),
    [enabled, setEnabled, triggerHaptic]
  );

  return (
    <HapticsContext.Provider value={value}>
      {children}
    </HapticsContext.Provider>
  );
};
