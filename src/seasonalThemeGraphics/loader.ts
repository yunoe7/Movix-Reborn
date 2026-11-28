import type { SeasonalResolvedDecoration } from './registry';

/**
 * Chargement fail-closed de la configuration publiée.
 *
 * Le resolver LOT 2 est la seule autorité : ce module ne lit aucune préférence
 * locale, ne recompose aucune priorité et ne tente jamais de réparer une
 * configuration invalide en activant des décorations à partir d'un brouillon.
 */

export interface SeasonalResolveContext {
  platform: string;
  capabilities: string[];
  at?: string;
}

export interface SeasonalResolvedPayload {
  emergencyDisable?: boolean;
  revision?: number;
  resolvedAt?: string;
  platform?: string;
  capabilities?: string[];
  themes?: unknown[];
  decorations?: unknown;
  families?: unknown;
  typography?: unknown;
  [key: string]: unknown;
}

export type SeasonalGraphicsReason = 'published' | 'emergency' | 'unavailable' | 'invalid';

export interface SeasonalGraphicsSnapshot {
  active: boolean;
  reason: SeasonalGraphicsReason;
  revision: number | null;
  emergency: boolean;
  decorations: SeasonalResolvedDecoration[];
  themes: Record<string, unknown>[];
  families: string[];
  typography: Record<string, unknown>;
  resolvedAt: string | null;
}

export type SeasonalResolver = (
  context: SeasonalResolveContext,
  signal?: AbortSignal,
) => Promise<SeasonalResolvedPayload | null | undefined>;

const EMPTY: Omit<SeasonalGraphicsSnapshot, 'reason' | 'revision' | 'emergency'> = {
  active: false,
  decorations: [],
  themes: [],
  families: [],
  typography: {},
  resolvedAt: null,
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeDecorations(value: unknown): SeasonalResolvedDecoration[] {
  if (!Array.isArray(value)) return [];
  const result: SeasonalResolvedDecoration[] = [];
  for (const entry of value) {
    const raw = asPlainObject(entry);
    if (!raw || typeof raw.id !== 'string' || typeof raw.family !== 'string') continue;
    if (raw.enabled === false) continue;
    result.push(raw as unknown as SeasonalResolvedDecoration);
  }
  return result;
}

export async function loadSeasonalGraphics(
  resolve: SeasonalResolver,
  context: SeasonalResolveContext,
  signal?: AbortSignal,
): Promise<SeasonalGraphicsSnapshot> {
  let payload: SeasonalResolvedPayload | null | undefined;
  try {
    payload = await resolve({
      platform: context.platform,
      capabilities: [...context.capabilities],
      ...(context.at ? { at: context.at } : {}),
    }, signal);
  } catch {
    return { ...EMPTY, reason: 'unavailable', revision: null, emergency: false };
  }

  const raw = asPlainObject(payload);
  if (!raw) return { ...EMPTY, reason: 'unavailable', revision: null, emergency: false };

  const emergency = raw.emergencyDisable === true;
  const decorations = normalizeDecorations(raw.decorations);
  const revision = typeof raw.revision === 'number' && Number.isInteger(raw.revision)
    ? raw.revision
    : null;

  // Le resolver désactivé porte explicitement `emergencyDisable: true` et
  // aucune révision. Une révision absente sans ce marqueur est invalide :
  // elle ne doit jamais être confondue avec un arrêt d'urgence.
  if (emergency) {
    return { ...EMPTY, reason: 'emergency', revision: null, emergency: true };
  }
  if (revision === null || !Array.isArray(raw.decorations)) {
    return { ...EMPTY, reason: 'invalid', revision: null, emergency: false };
  }
  if (decorations.length === 0) {
    return { ...EMPTY, reason: 'unavailable', revision, emergency };
  }

  const families = Array.isArray(raw.families)
    ? raw.families.filter((item): item is string => typeof item === 'string')
    : [];
  const themes = Array.isArray(raw.themes)
    ? raw.themes.flatMap((item) => {
      const theme = asPlainObject(item);
      return theme ? [theme] : [];
    })
    : [];

  return {
    active: true,
    reason: 'published',
    revision,
    emergency,
    decorations,
    themes,
    families,
    typography: asPlainObject(raw.typography) ?? {},
    resolvedAt: typeof raw.resolvedAt === 'string' ? raw.resolvedAt : null,
  };
}
