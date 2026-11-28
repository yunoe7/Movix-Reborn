import { SEASONAL_TYPOGRAPHY_CATEGORIES } from './registry';
import { resolveTypographySelections, type SeasonalTypographyMap } from './resolve';
import type {
  SeasonalThemeConfig,
  SeasonalThemeDecoration,
  SeasonalThemeTheme,
  SeasonalThemeTypographySetting,
} from '../../services/seasonalThemeAdminService';

/**
 * Aperçu administratif uniquement.
 *
 * Il reproduit fidèlement la résolution LOT 2 sur un brouillon local afin que
 * l'aperçu montre le vrai gagnant par catégorie. Ce calcul n'est JAMAIS utilisé
 * par le moteur public, ne lit aucune configuration publiée et ne remplace pas
 * le resolver backend : il sert seulement à ne pas afficher une police que la
 * publication ne retiendrait pas.
 */

interface Candidate {
  id: string;
  themeId: string;
  family: string;
  themePriority: number;
  priority: number;
  conflictsWith: string[];
  requires: string[];
  typography: SeasonalThemeDecoration['typography'];
}

export interface DraftPreviewContext {
  platform: string;
  capabilities: string[];
  at: string;
}

function compareDecorations(a: Candidate, b: Candidate): number {
  if (b.themePriority !== a.themePriority) return b.themePriority - a.themePriority;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}

function dateInTimeZone(now: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

function isWindowActive(theme: SeasonalThemeTheme, now: Date): boolean {
  if (!Array.isArray(theme.windows) || theme.windows.length === 0) return true;
  return theme.windows.some((window) => {
    const day = dateInTimeZone(now, window.timezone);
    return day !== null && day >= window.start && day < window.end;
  });
}

function collectCandidates(config: SeasonalThemeConfig, context: DraftPreviewContext): Candidate[] {
  const now = new Date(context.at);
  const candidates: Candidate[] = [];
  for (const theme of config.themes) {
    if (!theme.enabled || !isWindowActive(theme, now)) continue;
    for (const decoration of theme.decorations) {
      if (!decoration.enabled) continue;
      if (decoration.platforms[context.platform] !== true) continue;
      if (context.capabilities.some((capability) => decoration.capabilities[capability] !== true)) continue;
      candidates.push({
        id: decoration.id,
        themeId: theme.id,
        family: decoration.family,
        themePriority: theme.priority,
        priority: decoration.priority,
        conflictsWith: [...decoration.conflictsWith],
        requires: [...decoration.requires],
        typography: { ...decoration.typography },
      });
    }
  }
  return candidates;
}

function resolveConflicts(candidates: Candidate[]): Candidate[] {
  const accepted: Candidate[] = [];
  for (const candidate of [...candidates].sort(compareDecorations)) {
    const conflict = accepted.some((entry) => (
      candidate.conflictsWith.includes(entry.id) || entry.conflictsWith.includes(candidate.id)
    ));
    if (!conflict) accepted.push(candidate);
  }
  return accepted;
}

function applyRequirements(candidates: Candidate[]): Candidate[] {
  const ids = new Set(candidates.map((entry) => entry.id));
  return candidates.filter((entry) => entry.requires.every((required) => ids.has(required)));
}

function sameIds(a: Candidate[], b: Candidate[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry.id === b[index].id);
}

export function resolveDraftTypography(
  draft: SeasonalThemeConfig,
  context: DraftPreviewContext,
): SeasonalTypographyMap {
  const empty: SeasonalTypographyMap = {
    pageTitle: null,
    sectionTitle: null,
    categoryTitle: null,
  };
  if (draft.emergencyDisable === true) return empty;

  let active = collectCandidates(draft, context);
  for (let pass = 0; pass <= active.length; pass += 1) {
    const next = resolveConflicts(applyRequirements(active));
    if (sameIds(next, active)) break;
    active = next;
  }

  const winners = active
    .filter((entry) => entry.family === 'typography')
    .sort(compareDecorations);
  const raw: Record<string, unknown> = {};

  for (const category of SEASONAL_TYPOGRAPHY_CATEGORIES) {
    const draftSetting = draft.typography[category] as Partial<SeasonalThemeTypographySetting> | undefined;
    const fallback = {
      enabled: draftSetting?.enabled ?? false,
      fontKey: draftSetting?.fontKey ?? 'inter',
      weight: draftSetting?.weight ?? 400,
      effect: draftSetting?.effect ?? 'none',
    };
    const winner = winners.find((entry) => (
      entry.typography[category] && entry.typography[category].enabled !== false
    ));
    raw[category] = winner
      ? {
        ...winner.typography[category],
        decorationId: winner.id,
        themeId: winner.themeId,
        enabled: true,
      }
      : { ...fallback, decorationId: null };
  }

  return resolveTypographySelections(raw);
}
