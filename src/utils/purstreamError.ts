import axios from 'axios';

/**
 * Classification d'une erreur de la route PurStream film.
 *
 * Le backend répond 404 aussi bien pour « titre absent » que pour
 * « titre connu sans flux ». Ce n'est pas une panne d'extraction : le lecteur
 * doit simplement continuer avec les autres sources. Une 404 qui ne vient pas
 * de notre JSON (par exemple le HTML « Cannot GET » d'Express) signifie en
 * revanche que la route elle-même est introuvable et doit rester une erreur.
 */
export type PurstreamErrorKind = 'absent' | 'no_sources' | 'route_missing' | 'failure';

export interface PurstreamErrorInfo {
  kind: PurstreamErrorKind;
  status?: number;
  code?: string;
}

const ABSENCE_CODES = new Set(['CONTENT_NOT_FOUND', 'NO_SOURCES']);
const LEGACY_ABSENCE_MESSAGES = new Set([
  'Film non trouvé sur PurStream',
  'Série non trouvée sur PurStream',
  'Épisode non trouvé sur PurStream',
]);
const LEGACY_NO_SOURCES_MESSAGES = new Set([
  'Aucun stream disponible pour ce film',
  'Aucun stream disponible pour cet épisode',
]);

export function classifyPurstreamError(error: unknown): PurstreamErrorInfo {
  if (!axios.isAxiosError(error)) return { kind: 'failure' };

  const status = error.response?.status;
  if (status !== 404) return { kind: 'failure', status };

  const data = error.response?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    if (code && ABSENCE_CODES.has(code)) {
      return { kind: code === 'NO_SOURCES' ? 'no_sources' : 'absent', status, code };
    }
    if (typeof data.error === 'string') {
      if (LEGACY_ABSENCE_MESSAGES.has(data.error)) {
        return { kind: 'absent', status, code: 'LEGACY_NOT_FOUND' };
      }
      if (LEGACY_NO_SOURCES_MESSAGES.has(data.error)) {
        return { kind: 'no_sources', status, code: 'LEGACY_NO_SOURCES' };
      }
    }
  }

  return { kind: 'route_missing', status };
}
