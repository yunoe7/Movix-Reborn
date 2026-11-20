// Barre d'onglets de la bibliothèque : défile au doigt sur téléphone,
// soulignement rouge qui glisse d'un onglet à l'autre, flèches au clavier.

import React, { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { nextTabIndex } from './tabNavigation';
import type { ProfileTabId } from './types';

export interface ProfileTab {
  id: ProfileTabId;
  label: string;
  /** Absent : pas de compteur (l'onglet ne connaît son total qu'une fois ouvert). */
  count?: number;
}

interface ProfileTabsProps {
  tabs: ProfileTab[];
  active: ProfileTabId;
  onChange: (id: ProfileTabId) => void;
  label: string;
}

export const tabButtonId = (id: ProfileTabId) => `profile-tab-${id}`;
export const tabPanelId = 'profile-tab-panel';

export default function ProfileTabs({ tabs, active, onChange, label }: ProfileTabsProps) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next < 0) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(tabs[next].id);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.18)] sm:gap-2">
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              id={tabButtonId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={tabPanelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`relative flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 ${selected ? 'text-white' : 'text-white/55 hover:text-white'}`}
            >
              <span className="whitespace-nowrap">{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className={`tabular-nums text-sm ${selected ? 'text-white/70' : 'text-white/35'}`}>{tab.count}</span>
              )}
              {selected && (
                <motion.span
                  layoutId="profile-tab-underline"
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
                  className="absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
