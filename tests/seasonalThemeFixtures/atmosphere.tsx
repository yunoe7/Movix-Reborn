/**
 * Fixture LOT 0 : reproduit le bootstrap et les deux atmosphères existantes
 * sans modifier l'application. Les composants hooks et atmosphères sont les
 * vrais modules du dépôt ; seules les feuilles CSS sont injectées séparément
 * par le harnais pour rendre le rendu déterministe.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { LightModeProvider } from '@/context/LightModeContext';
import { HalloweenAtmosphere } from '@/components/HalloweenAtmosphere';
import { ChristmasAtmosphere } from '@/components/ChristmasAtmosphere';
import { HalloweenProgressPumpkin } from '@/components/halloween/HalloweenIcons';
import {
  HALLOWEEN_ENABLED_ATTR,
  HALLOWEEN_THEME_CLASS,
  readHalloweenTheme,
  setHalloweenTheme,
  useHalloweenTheme,
} from '@/hooks/useHalloweenTheme';
import {
  CHRISTMAS_ENABLED_ATTR,
  CHRISTMAS_THEME_CLASS,
  readChristmasTheme,
  setChristmasTheme,
  useChristmasTheme,
} from '@/hooks/useChristmasTheme';
import { loadHalloweenTheme } from '@/utils/halloweenThemeAssets';
import { getTvPlatform, persistTvPlatformFromUrl } from '@/utils/tvPlatform';

const root = document.documentElement;
const params = new URLSearchParams(window.location.search);
const suspended = params.get('suspended') === '1';
const showPumpkin = params.get('showPumpkin') === '1';

// Même ordre que src/main.tsx : préférence explicite, puis saison par défaut.
// Le bootstrap reste exécuté même sur route « suspendue » : c'est un écart
// attendu que les E2E doivent mesurer, pas corriger dans ce lot.
if (readHalloweenTheme()) {
  root.classList.add(HALLOWEEN_THEME_CLASS);
  root.setAttribute(HALLOWEEN_ENABLED_ATTR, '');
  loadHalloweenTheme();
}
if (readChristmasTheme()) {
  root.classList.add(CHRISTMAS_THEME_CLASS);
  root.setAttribute(CHRISTMAS_ENABLED_ATTR, '');
}
persistTvPlatformFromUrl();

const Fixture = () => {
  const halloween = useHalloweenTheme();
  const christmas = useChristmasTheme();

  return (
    <>
      <div id="fixture-root">
        <h1 id="page-title" data-typography="pageTitle">Titre de page</h1>
        <h2 id="section-title" className="text-xl" data-typography="sectionTitle">Titre de section</h2>
        <p id="category-title" className="section-title" data-typography="categoryTitle">Titre de catégorie</p>
        <div id="explore-title" data-explore-group-title>Explorer</div>
        <div id="card-title" className="fixture-card" data-halloween-frame="orange" data-typography="cardTitle">Film de test</div>
        <button id="action-button" className="fixture-focus" data-typography="button">Lire</button>
        <nav id="nav" data-typography="nav">
          <button id="nav-1" className="fixture-focus">Accueil</button>
          <button id="nav-2" className="fixture-focus">Films</button>
        </nav>
        <span id="badge" data-typography="smallLabelBadge">NOUVEAU</span>
        <div id="player">
          <div id="player-center" className="fixture-focus" tabIndex={0}>Zone de lecture</div>
          {showPumpkin && halloween ? (
            <span id="player-pumpkin" data-player-pumpkin>
              <HalloweenProgressPumpkin left="50%" />
            </span>
          ) : null}
        </div>
      </div>
      <output id="theme-state">{JSON.stringify({ halloween, christmas, suspended })}</output>
      <HalloweenAtmosphere suspended={suspended} />
      <ChristmasAtmosphere suspended={suspended} />
    </>
  );
};

(window as unknown as { __seasonal: unknown }).__seasonal = {
  setHalloween: setHalloweenTheme,
  setChristmas: setChristmasTheme,
  state: () => ({
    htmlClass: root.className,
    halloweenEnabled: root.hasAttribute(HALLOWEEN_ENABLED_ATTR),
    christmasEnabled: root.hasAttribute(CHRISTMAS_ENABLED_ATTR),
    fontLink: document.getElementById('halloween-font')?.getAttribute('href') || null,
    tvPlatform: getTvPlatform(),
  }),
};

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[window.location.pathname + window.location.search]}>
    <LightModeProvider>
      <Fixture />
    </LightModeProvider>
  </MemoryRouter>,
);
