import { fontFamilyFor, type SeasonalTypographyCategory } from './registry';
import type { SeasonalTypographyMap, SeasonalTypographySelection } from './resolve';

/**
 * Feuille temporaire injectée dans la page. Elle ne cible que les marqueurs
 * explicites audités et ne touche ni au texte, ni aux couleurs, ni aux tailles,
 * ni aux espacements. Son retrait restaure immédiatement la cascade d'origine.
 */

export const SEASONAL_TYPOGRAPHY_STYLE_ID = 'seasonal-typography-styles';

const INTER_FALLBACK = "'Inter', ui-sans-serif, system-ui, sans-serif";

function effectDeclaration(effect: SeasonalTypographySelection['effect']): string {
  if (effect === 'glow') return '  text-shadow: 0 0 14px rgba(255, 190, 92, 0.55);\n';
  if (effect === 'frost') return '  text-shadow: 0 0 12px rgba(198, 234, 255, 0.6);\n';
  return '';
}

function categoryRule(category: SeasonalTypographyCategory, selection: SeasonalTypographySelection): string {
  const family = selection.fontKey === 'inter' ? INTER_FALLBACK : `'${fontFamilyFor(selection.fontKey)}', ${INTER_FALLBACK}`;
  const selector = `html[data-seasonal-graphics='active'] [data-seasonal-typography="${category}"]`;
  return `${selector} {\n  font-family: ${family};\n  font-weight: ${selection.weight};\n${effectDeclaration(selection.effect)}}`;
}

export function buildTypographyCss(map: SeasonalTypographyMap, options: { staticOnly: boolean }): string {
  // Le mode statique est appliqué par l'appelant : aucun effet animé n'est
  // jamais généré ici, quelle que soit la plateforme.
  void options;
  const rules: string[] = [];
  for (const category of ['pageTitle', 'sectionTitle', 'categoryTitle'] as const) {
    const selection = map[category];
    if (selection) rules.push(categoryRule(category, selection));
  }
  return rules.join('\n');
}

export interface TypographyDocument {
  readonly documentElement: { readonly dataset: Record<string, string | undefined> };
  readonly head: { appendChild(node: unknown): unknown };
  createElement(tagName: string): { id: string; textContent: string; remove(): void };
  getElementById(id: string): { remove(): void } | null;
}

function removeStyle(doc: TypographyDocument): void {
  doc.getElementById(SEASONAL_TYPOGRAPHY_STYLE_ID)?.remove();
}

/**
 * Applique la feuille et retourne une fonction de restauration idempotente.
 * Aucun attribut n'est ajouté aux titres : seule une feuille identifiée est
 * injectée, puis retirée lors du nettoyage.
 */
export function applyTypography(
  doc: TypographyDocument,
  map: SeasonalTypographyMap,
  options: { staticOnly: boolean },
): () => void {
  removeStyle(doc);
  const css = buildTypographyCss(map, options);
  if (!css) {
    delete doc.documentElement.dataset.seasonalTypography;
    return () => undefined;
  }

  const style = doc.createElement('style');
  style.id = SEASONAL_TYPOGRAPHY_STYLE_ID;
  style.textContent = css;
  doc.head.appendChild(style);
  doc.documentElement.dataset.seasonalTypography = 'active';

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    removeStyle(doc);
    delete doc.documentElement.dataset.seasonalTypography;
  };
}
