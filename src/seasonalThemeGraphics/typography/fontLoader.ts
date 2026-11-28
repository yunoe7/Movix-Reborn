import {
  fontFamilyFor,
  fontSourcesFor,
  isSeasonalFontKey,
  type SeasonalFontKey,
} from './registry';

/**
 * Chargement différé des seules polices sélectionnées par une publication.
 *
 * Inter est déjà servi localement au démarrage. Les autres familles partagent
 * un cache navigateur. Après un échec, un nouvel essai est autorisé après un
 * délai borné : cela évite à la fois les échecs permanents et les boucles de
 * requêtes lors des rafraîchissements périodiques du resolver.
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

const RETRY_DELAY_MS = 60_000;

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
  const retryAfter = new Map<string, number>();

  const load = (fontKey: string, weight: number): Promise<boolean> => {
    if (!isSeasonalFontKey(fontKey)) return Promise.resolve(false);
    if (fontKey === 'inter') return Promise.resolve(true);
    const key = `${fontKey}:${weight}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if ((retryAfter.get(key) ?? 0) > Date.now()) return Promise.resolve(false);

    const source = fontSourcesFor(fontKey as SeasonalFontKey, weight)[0];
    if (!source) {
      states.set(fontKey, 'failed');
      retryAfter.set(key, Number.POSITIVE_INFINITY);
      return Promise.resolve(false);
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
        retryAfter.delete(key);
        return true;
      } catch {
        states.set(fontKey, 'failed');
        retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
        cache.delete(key);
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
