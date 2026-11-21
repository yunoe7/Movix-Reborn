import type { KisskhErrorCode } from '../types/kisskh';

const KNOWN_CODES = new Set<KisskhErrorCode>([
  'retrieval_in_progress',
  'invalid_input',
  'not_found',
  'route_missing',
  'episode_missing',
  'provider_rate_limited',
  'provider_changed',
  'provider_disabled',
  'proxy_unavailable',
  'subtitle_unsupported',
  'subtitle_decrypt_failed',
  'upstream_unavailable',
]);

/**
 * KissKH garde son contrat 503 `proxy_unavailable`, mais ce code recouvre
 * aussi bien un fournisseur désactivé qu'une panne de relais. Le marqueur
 * HTTP ajouté par Main API permet de les séparer côté lecteur sans changer le
 * corps de réponse consommé par les clients existants.
 */
export function classifyKisskhResponse(
  status: number,
  payload: unknown,
  disabledHeader: string | null,
): { code: KisskhErrorCode } {
  const data = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const code = typeof data?.code === 'string' ? data.code : '';
  const message = typeof data?.message === 'string' ? data.message : '';

  if (status === 503 && (disabledHeader === '1' || message === 'KissKH desactive')) {
    return { code: 'provider_disabled' };
  }
  if (code === 'ROUTE_NOT_FOUND') return { code: 'route_missing' };
  if (typeof code === 'string' && KNOWN_CODES.has(code as KisskhErrorCode)) {
    return { code: code as KisskhErrorCode };
  }
  if (status === 404) return { code: 'not_found' };
  if (status === 429) return { code: 'provider_rate_limited' };
  if (status === 400) return { code: 'invalid_input' };
  if (status === 503) return { code: code === 'proxy_unavailable' ? 'proxy_unavailable' : 'upstream_unavailable' };
  return { code: 'upstream_unavailable' };
}
