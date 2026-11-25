export type OptionalStreamSource = 'kisskh' | 'cpasmal';

export interface SourceCapabilities {
  kisskh: { enabled: boolean };
  cpasmal: { enabled: boolean };
}

interface CachedCapabilities {
  value: SourceCapabilities;
  expiresAt: number;
}

const CAPABILITIES_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CachedCapabilities>();

function parseCapabilities(payload: unknown): SourceCapabilities {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('invalid capabilities');
  }
  const value = payload as Record<string, unknown>;
  const read = (source: OptionalStreamSource): boolean => {
    const entry = value[source];
    return !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).enabled === true;
  };
  return { kisskh: { enabled: read('kisskh') }, cpasmal: { enabled: read('cpasmal') } };
}

/**
 * Une capacité absente est considérée activée : un Main API plus ancien ou un
 * endpoint momentanément en panne ne doit pas retirer silencieusement un lecteur.
 */
export function isSourceEnabled(
  capabilities: SourceCapabilities | null | undefined,
  source: OptionalStreamSource,
): boolean {
  return capabilities?.[source]?.enabled !== false;
}

export async function getSourceCapabilities(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<SourceCapabilities | null> {
  const endpoint = new URL('/api/source-capabilities', `${baseUrl.replace(/\/+$/, '')}/`).href;
  const cached = cache.get(endpoint);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await fetch(endpoint, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const value = parseCapabilities(await response.json());
    cache.set(endpoint, { value, expiresAt: Date.now() + CAPABILITIES_TTL_MS });
    return value;
  } catch {
    return null;
  }
}
