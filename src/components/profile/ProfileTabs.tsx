// Barre d'onglets de la bibliothèque : défile au doigt sur téléphone,
// soulignement rouge qui glisse d'un onglet à l'autre, flèches au clavier.
// Les identifiants ARIA et la navigation clavier sont conservés tels quels.

import React, { useEffect, useRef } from 'react';
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
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === active));

  useEffect(() => {
    buttons.current[activeIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next < 0) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    onChange(tabs[next].id);
  };

  return (
    <div className="profile-tabs-shell -mx-1 px-1 sm:mx-0 sm:px-0" data-testid="profile-tabs">
      <div role="tablist" aria-label={label} className="profile-tab-list">
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
              data-testid={`tab-${tab.id}`}
              className="profile-tab"
            >
              <span className="whitespace-nowrap">{tab.label}</span>
              {typeof tab.count === 'number' && (
                <span className="profile-tab-count">{tab.count}</span>
              )}
              {selected && (
                <motion.span
                  layoutId="profile-tab-underline"
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
                  className="profile-tab-underline"
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
