import axios from 'axios';

/**
 * Classification d'une erreur de la route Cpasmal film.
 *
 * Cpasmal utilise le même statut 404 pour « film absent » et, historiquement,
 * pour « fournisseur désactivé ». Le backend distingue désormais ces cas avec
 * des codes, mais les anciens messages restent reconnus pour ne pas casser un
 * déploiement encore en place.
 */
export type CpasmalErrorKind =
  | 'disabled'
  | 'not_found'
  | 'invalid_id'
  | 'route_missing'
  | 'upstream_error'
  | 'failure';

export interface CpasmalErrorInfo {
  kind: CpasmalErrorKind;
  status?: number;
  code?: string;
}

const CODES: Record<string, CpasmalErrorKind> = {
  PROVIDER_DISABLED: 'disabled',
  CONTENT_NOT_FOUND: 'not_found',
  INVALID_TMDB_ID: 'invalid_id',
  ROUTE_NOT_FOUND: 'route_missing',
  UPSTREAM_ERROR: 'upstream_error',
};

function classifyLegacy(error: unknown): CpasmalErrorInfo | null {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const message = typeof (error as Record<string, unknown>).error === 'string'
    ? (error as Record<string, unknown>).error as string
    : '';
  if (message === 'Cpasmal désactivé') return { kind: 'disabled', code: 'LEGACY_DISABLED' };
  if (/not found/i.test(message)) return { kind: 'not_found', code: 'LEGACY_NOT_FOUND' };
  return null;
}

export function classifyCpasmalError(error: unknown): CpasmalErrorInfo {
  if (!axios.isAxiosError(error)) return { kind: 'failure' };
  const status = error.response?.status;
  const data = error.response?.data;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    if (code && CODES[code]) return { kind: CODES[code], status, code };
    const legacy = classifyLegacy(data);
    if (legacy) return { ...legacy, status };
  }

  if (status === 404) return { kind: 'route_missing', status };
  if (status === 503) return { kind: 'upstream_error', status };
  return { kind: 'failure', status };
}
