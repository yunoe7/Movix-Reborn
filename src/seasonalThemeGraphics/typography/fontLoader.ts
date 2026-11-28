import {
  fontFamilyFor,
  fontSourcesFor,
  isSeasonalFontKey,
  type SeasonalFontKey,
} from './registry';

/**
 * Chargement différé des seules polices sélectionnées par une publication.
 *
 * `inter` est déjà servi localement au démarrage par `main.tsx` : le moteur ne
 * génère aucun `FontFace` supplémentaire pour lui. Les autres familles sont
 * chargées une seule fois via l'API `FontFace`, puis réutilisées lors des
 * changements de route. Une promesse rejetée reste en cache : un réseau en
 * échec ne provoque pas une boucle de requêtes.
 */

export type SeasonalFontStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface SeasonalFontFaceLike {
  readonly family: string;
  load(): Promise<unknown>;
}

export interface SeasonalFontEnvironment {
  createFontFace(family: string, source: string, weight: number, unicodeRange: string): SeasonalFontFaceLike;
  addFontFace(face: SeasonalFontFaceLike): void;
}

const MISSING_ENVIRONMENT: SeasonalFontEnvironment = {
  createFontFace: () => ({ family: '', load: () => Promise.reject(new Error('FontFace indisponible')) }),
  addFontFace: () => undefined,
};

export function createBrowserFontEnvironment(): SeasonalFontEnvironment | null {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) return null;
  return {
    createFontFace: (family, source, weight, unicodeRange) => new FontFace(
      family,
      `url("${source}") format("woff2")`,
      { weight: String(weight), style: 'normal', display: 'swap', unicodeRange },
    ),
    addFontFace: (face) => { document.fonts.add(face as FontFace); },
  };
}

export interface SeasonalFontLoader {
  load(fontKey: string, weight: number): Promise<boolean>;
  status(fontKey: string): SeasonalFontStatus;
}

let sharedBrowserLoader: SeasonalFontLoader | null = null;

/** Chargeur navigateur unique : l'aperçu et le moteur public partagent le cache. */
export function getBrowserSeasonalFontLoader(): SeasonalFontLoader {
  if (!sharedBrowserLoader) {
    sharedBrowserLoader = createSeasonalFontLoader(createBrowserFontEnvironment() ?? MISSING_ENVIRONMENT);
  }
  return sharedBrowserLoader;
}

export function createSeasonalFontLoader(environment: SeasonalFontEnvironment): SeasonalFontLoader {
  const cache = new Map<string, Promise<boolean>>();
  const states = new Map<string, SeasonalFontStatus>();

  const load = (fontKey: string, weight: number): Promise<boolean> => {
    if (!isSeasonalFontKey(fontKey)) return Promise.resolve(false);
    if (fontKey === 'inter') return Promise.resolve(true);
    const key = `${fontKey}:${weight}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const sources = fontSourcesFor(fontKey as SeasonalFontKey, weight);
    const source = sources[0];
    if (!source) {
      states.set(fontKey, 'failed');
      const failed = Promise.resolve(false);
      cache.set(key, failed);
      return failed;
    }

    states.set(fontKey, 'loading');
    const pending = (async () => {
      try {
        const face = environment.createFontFace(
          fontFamilyFor(fontKey as SeasonalFontKey),
          source.url,
          weight,
          source.unicodeRange,
        );
        await face.load();
        environment.addFontFace(face);
        states.set(fontKey, 'loaded');
        return true;
      } catch {
        states.set(fontKey, 'failed');
        return false;
      }
    })();
    cache.set(key, pending);
    return pending;
  };

  return {
    load,
    status: (fontKey) => states.get(fontKey) ?? 'idle',
  };
}
