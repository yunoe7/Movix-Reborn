/**
 * Chargement à la demande de l'habillage du thème Halloween : la feuille
 * halloween-ui.css (cadres, en-tête, titres…) et la police des titres.
 *
 * Module à part du hook useHalloweenTheme, que l'en-tête et les fonds
 * importent : eux n'ont besoin que de savoir si le thème est actif, pas
 * d'embarquer ce chargement ni la feuille qu'il désigne.
 *
 * LOT 4B : Creepster est désormais servi depuis `/fonts/seasonal-theme/` via
 * le chargeur partagé du moteur typographique. Aucune feuille Google Fonts
 * n'est injectée ; le cache du chargeur évite les téléchargements répétés.
 */
import { getBrowserSeasonalFontLoader } from '../seasonalThemeGraphics/typography/fontLoader';

const LEGACY_FONT_LINK_ID = 'halloween-font';

let requested = false;

/**
 * Lance, une seule fois, le chargement de l'habillage et de la police locale.
 * Appelé au démarrage si le thème est déjà actif (en parallèle du reste de
 * l'application), ou quand on l'active.
 */
export const loadHalloweenTheme = (): void => {
  if (requested) return;
  requested = true;

  import('@/styles/halloween-ui.css').catch(() => {
    // Réseau coupé : on retentera à la prochaine activation.
    requested = false;
  });

  // Nettoie l'ancien lien si une session précédente l'avait injecté avant la
  // migration, sans jamais en créer un nouveau.
  document.getElementById(LEGACY_FONT_LINK_ID)?.remove();
  void getBrowserSeasonalFontLoader().load('creepster', 400);
};
