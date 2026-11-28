import {
  createSeasonalFontLoader,
  getBrowserSeasonalFontLoader,
  type SeasonalFontEnvironment,
  type SeasonalFontLoader,
} from './fontLoader';
import { resolveTypographySelections } from './resolve';
import {
  applyTypography,
  type TypographyDocument,
} from './styles';

/**
 * Cycle de vie de la typographie publique : chargement des polices nécessaires,
 * application de la feuille temporaire, restauration immédiate sur désactivation,
 * urgence, erreur de chargement, changement de route ou démontage.
 */

export interface SeasonalTypographyControllerOptions {
  doc?: TypographyDocument;
  environment?: SeasonalFontEnvironment | null;
  staticOnly?: boolean;
}

export class SeasonalTypographyController {
  private readonly doc: TypographyDocument;
  private readonly loader: SeasonalFontLoader;
  private readonly staticOnly: boolean;
  private restore: () => void = () => undefined;
  private generation = 0;
  private destroyed = false;

  constructor(options: SeasonalTypographyControllerOptions = {}) {
    this.doc = options.doc ?? (document as unknown as TypographyDocument);
    this.loader = options.environment
      ? createSeasonalFontLoader(options.environment)
      : getBrowserSeasonalFontLoader();
    this.staticOnly = options.staticOnly ?? false;
  }

  /** Retourne `false` si une police requise n'a pas pu être chargée. */
  async apply(rawTypography: unknown): Promise<boolean> {
    if (this.destroyed) return false;
    const generation = ++this.generation;
    const selections = resolveTypographySelections(rawTypography);

    const needed = new Map<string, number>();
    for (const selection of Object.values(selections)) {
      if (!selection || selection.fontKey === 'inter') continue;
      needed.set(selection.fontKey, selection.weight);
    }

    let loaded = true;
    for (const [fontKey, weight] of needed) {
      const ok = await this.loader.load(fontKey, weight);
      if (!ok) loaded = false;
    }

    if (this.destroyed || generation !== this.generation) return false;
    if (!loaded) {
      this.clear();
      return false;
    }

    this.restore();
    this.restore = applyTypography(this.doc, selections, { staticOnly: this.staticOnly });
    return true;
  }

  clear(): void {
    this.generation += 1;
    this.restore();
    this.restore = () => undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
  }
}
