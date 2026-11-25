import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  getAdminHeroPromos,
  updateAdminHeroPromos,
  type HeroPromoSettings,
  type TeamSelectionSettings,
} from '../services/heroPromoService';
import { TMDB_API_KEY, TMDB_API_URL, TMDB_IMAGE_URL } from '../config/config';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  EyeOff,
  Film,
  ImageOff,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Star,
  Tv,
  X,
} from './icons/Icons8';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Skeleton } from './ui/Skeleton';

const inputClass = [
  'w-full min-w-0 rounded-xl border border-white/10 bg-[#0d0d0f] px-3.5 py-3 text-sm leading-6 text-white',
  'placeholder:text-white/30 outline-none transition',
  'hover:border-white/20 focus-visible:border-red-500/50 focus-visible:ring-2 focus-visible:ring-red-500/25',
].join(' ');
const labelClass = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-white/50';
const hintClass = 'mt-1.5 text-xs leading-5 text-white/40';
const DEFAULT_LOAD_ERROR = 'Impossible de charger la sélection de l’équipe. Vérifie la connexion à l’API puis recharge la page.';

type TmdbSearchResult = {
  id: number;
  mediaType: 'movie' | 'tv';
  popularity?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
};

type TmdbDetails = TmdbSearchResult & {
  genres?: Array<{ id: number; name: string }>;
  runtime?: number | null;
  episode_run_time?: number[];
  content_ratings?: { results?: Array<{ iso_3166_1: string; rating: string }> };
  release_dates?: { results?: Array<{ iso_3166_1: string; release_dates?: Array<{ certification?: string }> }> };
};

const cleanRating = (value?: string): string => {
  const rating = String(value || '').trim();
  if (!rating) return '';
  const map: Record<string, string> = {
    G: 'Tous publics', U: 'Tous publics', '-10': '10+', '-12': '12+', '-16': '16+', '-18': '18+', 'TV-Y': 'Tous publics', 'TV-G': 'Tous publics',
    PG: '10+', 'TV-PG': '10+', 'PG-13': '13+', 'TV-14': '14+',
    R: '16+', 'TV-MA': '18+', 'NC-17': '18+'
  };
  if (/^\d{1,2}\+?$/.test(rating)) return rating.endsWith('+') ? rating : `${rating}+`;
  return map[rating.toUpperCase()] || rating;
};

/** Classification française d'abord, classification américaine en secours. */
const getFrenchAgeRating = (details: TmdbDetails, mediaType: 'movie' | 'tv'): string => {
  if (mediaType === 'tv') {
    const rows = details.content_ratings?.results || [];
    const french = rows.find((row) => row.iso_3166_1 === 'FR' && row.rating);
    const fallback = rows.find((row) => row.iso_3166_1 === 'US' && row.rating);
    return cleanRating(french?.rating || fallback?.rating);
  }
  const rows = details.release_dates?.results || [];
  const french = rows.find((row) => row.iso_3166_1 === 'FR');
  const fallback = rows.find((row) => row.iso_3166_1 === 'US');
  const certification = [...(french?.release_dates || []), ...(fallback?.release_dates || [])]
    .map((row) => row.certification).find(Boolean);
  return cleanRating(certification);
};

const resultKey = (item: TmdbSearchResult) => `${item.mediaType}-${item.id}`;

const AdminTeamSelection: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<HeroPromoSettings | null>(null);
  const [saved, setSaved] = useState<HeroPromoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchNonce, setSearchNonce] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const appendRef = useRef(false);
  const resultsRef = useRef<TmdbSearchResult[]>([]);
  const [backdropFailed, setBackdropFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const payload = await getAdminHeroPromos();
        if (!active) return;
        setSettings(payload.settings);
        setSaved(payload.settings);
      } catch (error) {
        if (active) setLoadError(error instanceof Error && error.message ? error.message : DEFAULT_LOAD_ERROR);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [reloadNonce]);

  const selection = settings?.teamSelection;
  const dirty = Boolean(settings && saved && JSON.stringify(settings.teamSelection) !== JSON.stringify(saved.teamSelection));

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 3500);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    setBackdropFailed(false);
  }, [selection?.backdropUrl]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      setHasMore(false);
      return;
    }

    let active = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const append = appendRef.current;
    const timer = window.setTimeout(async () => {
      if (!TMDB_API_KEY) {
        setSearchError(t('admin.teamSelection.missingKey', 'La clé TMDB du site est absente.'));
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);
      try {
        const params = {
          api_key: TMDB_API_KEY,
          language: 'fr-FR',
          query: text,
          include_adult: false,
          page: searchPage,
        };
        const [movieResponse, tvResponse] = await Promise.all([
          axios.get(`${TMDB_API_URL}/search/movie`, { params, signal: controller?.signal }),
          axios.get(`${TMDB_API_URL}/search/tv`, { params, signal: controller?.signal }),
        ]);

        if (!active) return;
        const movies: TmdbSearchResult[] = (movieResponse.data?.results || [])
          .map((item: Omit<TmdbSearchResult, 'mediaType'>) => ({ ...item, mediaType: 'movie' as const }));
        const series: TmdbSearchResult[] = (tvResponse.data?.results || [])
          .map((item: Omit<TmdbSearchResult, 'mediaType'>) => ({ ...item, mediaType: 'tv' as const }));

        // Aucune troncature arbitraire : tous les résultats des deux pages sont
        // conservés, et « Afficher plus » ajoute les pages suivantes.
        const byKey = new Map<string, TmdbSearchResult>();
        if (append) {
          resultsRef.current.forEach((item) => byKey.set(resultKey(item), item));
        }
        [...movies, ...series].forEach((item) => {
          if (Number.isSafeInteger(item.id) && item.id > 0) byKey.set(resultKey(item), item);
        });
        const combined = [...byKey.values()].sort((a, b) => (b.popularity || b.vote_average || 0) - (a.popularity || a.vote_average || 0));
        setResults(combined);
        const moviePages = Number(movieResponse.data?.total_pages || 1);
        const tvPages = Number(tvResponse.data?.total_pages || 1);
        setHasMore(Math.max(moviePages, tvPages) > searchPage);
      } catch {
        if (active && !controller?.signal.aborted) {
          setResults(append ? resultsRef.current : []);
          setSearchError(t('admin.teamSelection.searchError', 'La recherche TMDB a échoué. Réessaie dans quelques instants.'));
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 350);

    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [query, searchPage, searchNonce, t]);

  const changeQuery = (value: string) => {
    appendRef.current = false;
    setQuery(value);
    setSearchPage(1);
    setResults([]);
    setHasMore(false);
    setSearchError(null);
  };

  const retrySearch = () => {
    appendRef.current = false;
    setSearchPage(1);
    setSearchNonce((nonce) => nonce + 1);
  };

  const loadMore = () => {
    appendRef.current = true;
    setSearchPage((page) => page + 1);
  };

  const update = (key: keyof TeamSelectionSettings, value: string | number | boolean) => {
    setSettings((current) => current ? {
      ...current,
      teamSelection: { ...current.teamSelection, [key]: value }
    } : current);
    setSaveError(null);
  };

  const selectTmdbResult = async (item: TmdbSearchResult) => {
    if (!settings || selectingId !== null) return;
    const key = resultKey(item);
    setSelectingId(key);
    try {
      const response = await axios.get<TmdbDetails>(`${TMDB_API_URL}/${item.mediaType}/${item.id}`, {
        params: {
          api_key: TMDB_API_KEY,
          language: 'fr-FR',
          append_to_response: item.mediaType === 'tv' ? 'content_ratings' : 'release_dates'
        }
      });
      const details = response.data;
      const title = details.title || details.name || item.title || item.name || item.original_title || item.original_name || '';
      const rating = typeof details.vote_average === 'number' && details.vote_average > 0
        ? `${details.vote_average.toFixed(1).replace('.', ',')}/10`
        : '';
      const genres = (details.genres || []).map((genre) => genre.name).filter(Boolean).join(', ');
      const duration = item.mediaType === 'movie'
        ? (details.runtime ? `${details.runtime} min` : '')
        : (details.episode_run_time?.[0] ? `${details.episode_run_time[0]} min / épisode` : '');
      const backdropUrl = details.backdrop_path
        ? `${TMDB_IMAGE_URL}/original${details.backdrop_path}`
        : item.backdrop_path ? `${TMDB_IMAGE_URL}/original${item.backdrop_path}` : '';
      const ageRating = getFrenchAgeRating(details, item.mediaType);

      setSettings((current) => current ? {
        ...current,
        teamSelection: {
          ...current.teamSelection,
          mediaType: item.mediaType,
          tmdbId: details.id,
          title,
          description: details.overview || item.overview || '',
          backdropUrl: backdropUrl || current.teamSelection.backdropUrl,
          rating,
          genres,
          duration,
          ageRating: ageRating || current.teamSelection.ageRating,
          detailsUrl: `/${item.mediaType}/${details.id}`
        }
      } : current);
      setSaveError(null);
      toast.success(t('admin.teamSelection.fetched', 'Informations récupérées depuis TMDB. Vérifie les champs puis enregistre.'));
    } catch {
      toast.error(t('admin.teamSelection.fetchError', 'Impossible de récupérer les détails de ce titre sur TMDB.'));
    } finally {
      setSelectingId(null);
    }
  };

  const save = async () => {
    if (!settings || saving) return;
    if (!Number.isSafeInteger(settings.teamSelection.tmdbId) || settings.teamSelection.tmdbId < 1) {
      const message = t('admin.teamSelection.invalidId', 'Identifiant TMDB invalide.');
      setSaveError(message);
      toast.error(message);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await updateAdminHeroPromos(settings);
      setSettings(result.settings);
      setSaved(result.settings);
      setJustSaved(true);
      toast.success(t('admin.teamSelection.saveSuccess', 'Sélection de l’équipe enregistrée.'));
    } catch (error) {
      const message = error instanceof Error && error.message
        ? `${t('admin.teamSelection.saveErrorPrefix', 'Enregistrement impossible :')} ${error.message}`
        : t('admin.teamSelection.saveError', 'Enregistrement impossible. Réessaie dans quelques instants.');
      setSaveError(message);
      setJustSaved(false);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!saved) return;
    setSettings(saved);
    setSaveError(null);
    setJustSaved(false);
  };

  const fields = useMemo(() => [
    { key: 'tmdbId' as const, testId: 'team-field-tmdb-id', label: t('admin.teamSelection.fieldTmdbId', 'Identifiant TMDB'), type: 'number' },
    { key: 'badge' as const, testId: 'team-field-badge', label: t('admin.teamSelection.fieldBadge', 'Badge affiché') },
    { key: 'ageRating' as const, testId: 'team-field-age', label: t('admin.teamSelection.fieldAge', 'Âge conseillé') },
    { key: 'rating' as const, testId: 'team-field-rating', label: t('admin.teamSelection.fieldRating', 'Note affichée') },
    { key: 'genres' as const, testId: 'team-field-genres', label: t('admin.teamSelection.fieldGenres', 'Genres (séparés par des virgules)') },
    { key: 'duration' as const, testId: 'team-field-duration', label: t('admin.teamSelection.fieldDuration', 'Durée du film / durée d’un épisode') },
  ], [t]);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton variant="button" height={96} />
        <Skeleton variant="button" height={220} />
        <Skeleton variant="button" height={320} />
      </div>
    );
  }

  if (loadError || !settings || !selection) {
    return (
      <div
        data-testid="team-load-error"
        className="flex flex-wrap items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-5 py-4"
      >
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{t('admin.teamSelection.loadTitle', 'Sélection de l’équipe indisponible')}</p>
          <p className="mt-1 text-sm leading-6 text-white/60">
            {t('admin.teamSelection.loadError', DEFAULT_LOAD_ERROR)}
          </p>
          {loadError && loadError !== DEFAULT_LOAD_ERROR && (
            <p className="mt-1 break-words font-mono text-xs leading-5 text-white/40">{loadError}</p>
          )}
        </div>
        <Button type="button" variant="outline" onClick={() => setReloadNonce((nonce) => nonce + 1)}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('admin.teamSelection.retry', 'Réessayer')}
        </Button>
      </div>
    );
  }

  const enabled = selection.enabled;
  const selectedKey = `${selection.mediaType}-${selection.tmdbId}`;
  const backdropUrl = selection.backdropUrl?.trim() || '';
  const meta = [
    selection.ageRating,
    selection.rating,
    ...(selection.genres || '').split(',').map((genre) => genre.trim()).filter(Boolean),
    selection.duration,
  ].filter(Boolean);

  return (
    <div className="space-y-5 pb-2">
      {/* A. En-tête */}
      <section
        data-testid="team-heading"
        className="flex flex-wrap items-start justify-between gap-5 rounded-2xl border border-white/[0.08] bg-[#0a0a0b] px-5 py-5 sm:px-6"
      >
        <div className="min-w-0 max-w-2xl">
          <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
            <Sparkles className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
            {t('admin.teamSelection.eyebrow', 'Catalogue · Configuration')}
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            {t('admin.teamSelection.title', 'Sélection de l’équipe')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/60">
            {t('admin.teamSelection.description', 'Choisis le film ou la série mis en avant sur l’accueil : la recherche TMDB remplit automatiquement les informations de la bannière.')}
          </p>
        </div>
        <div
          data-testid="team-status"
          className={`flex min-w-[220px] items-center gap-3 rounded-xl border px-4 py-3 ${
            enabled ? 'border-red-500/30 bg-red-500/[0.08]' : 'border-white/10 bg-white/[0.03]'
          }`}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${enabled ? 'bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.12)]' : 'bg-white/30'}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">
              {enabled
                ? t('admin.teamSelection.statusActive', 'Activée')
                : t('admin.teamSelection.statusInactive', 'Désactivée')}
            </span>
            <span className="mt-0.5 block text-xs text-white/45">
              {enabled
                ? t('admin.teamSelection.statusActiveHint', 'Bannière visible sur l’accueil')
                : t('admin.teamSelection.statusInactiveHint', 'Bannière masquée sur l’accueil')}
            </span>
          </span>
        </div>
      </section>

      {/* B. Recherche TMDB */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#0a0a0b]">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-white">{t('admin.teamSelection.searchTitle', 'Recherche TMDB')}</h3>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {t('admin.teamSelection.searchDescription', 'Films et séries sont interrogés simultanément, en titre français comme en titre original.')}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/55">
            {t('admin.teamSelection.searchLive', 'TMDB · FR + VO')}
          </span>
        </header>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" aria-hidden="true" />
            <input
              data-testid="team-search-input"
              id="team-search-input"
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              placeholder={t('admin.teamSelection.searchPlaceholder', 'Ex. : Dune, One Piece, Les Carnets de l’apothicaire…')}
              aria-label={t('admin.teamSelection.searchLabel', 'Rechercher un film ou une série sur TMDB')}
              className={`${inputClass} h-14 pl-12 pr-12 text-base`}
            />
            {query && (
              <button
                type="button"
                onClick={() => changeQuery('')}
                aria-label={t('admin.teamSelection.clearSearch', 'Effacer la recherche')}
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className={hintClass}>
            {t('admin.teamSelection.searchHint', 'Deux caractères minimum. Tous les résultats sont affichés ; utilisez « Afficher plus » pour charger les pages suivantes.')}
          </p>

          {searching && (
            <div data-testid="team-search-loading" className="space-y-2.5" aria-live="polite">
              <p className="flex items-center gap-2 text-xs font-semibold text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('admin.teamSelection.searching', 'Recherche sur TMDB…')}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((index) => <Skeleton key={index} variant="button" height={84} />)}
              </div>
            </div>
          )}

          {searchError && !searching && (
            <div data-testid="team-search-error" className="flex flex-wrap items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm leading-6 text-red-100">{searchError}</p>
              <Button type="button" size="sm" variant="outline" onClick={retrySearch}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('admin.teamSelection.retry', 'Réessayer')}
              </Button>
            </div>
          )}

          {!searching && !searchError && query.trim().length >= 2 && results.length === 0 && (
            <div data-testid="team-search-empty" className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
              <Search className="mx-auto h-5 w-5 text-white/30" aria-hidden="true" />
              <p className="mt-2 text-sm text-white/60">{t('admin.teamSelection.searchEmpty', 'Aucun résultat pour cette recherche. Essaie un autre titre.')}</p>
            </div>
          )}

          {results.length > 0 && (
            <div
              data-testid="team-search-results"
              className="grid max-h-[420px] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
            >
              {results.map((item) => {
                const name = item.title || item.name || item.original_title || item.original_name || t('admin.teamSelection.untitled', 'Titre sans nom');
                const date = item.release_date || item.first_air_date || '';
                const isSelected = selectedKey === resultKey(item);
                const isSelecting = selectingId === resultKey(item);
                return (
                  <button
                    key={resultKey(item)}
                    type="button"
                    data-testid={`team-search-result-${resultKey(item)}`}
                    data-selected={isSelected ? 'true' : undefined}
                    disabled={selectingId !== null}
                    onClick={() => void selectTmdbResult(item)}
                    className={`flex min-w-0 items-center gap-3 rounded-xl border p-2.5 text-left transition disabled:opacity-50 ${
                      isSelected
                        ? 'border-red-500/45 bg-red-500/[0.08] ring-1 ring-red-500/30'
                        : 'border-white/[0.08] bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.06]'
                    }`}
                  >
                    {item.poster_path ? (
                      <img
                        src={`${TMDB_IMAGE_URL}/w92${item.poster_path}`}
                        alt=""
                        className="h-[72px] w-12 shrink-0 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-[72px] w-12 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-white/30">
                        {item.mediaType === 'movie' ? <Film className="h-5 w-5" aria-hidden="true" /> : <Tv className="h-5 w-5" aria-hidden="true" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white" title={name}>{name}</span>
                      <span className="mt-1 block truncate text-xs text-white/50">
                        {item.mediaType === 'movie'
                          ? t('admin.teamSelection.movie', 'FILM')
                          : t('admin.teamSelection.series', 'SÉRIE')}
                        {' · '}
                        {date ? date.slice(0, 4) : t('admin.teamSelection.unknownYear', 'année inconnue')}
                        {typeof item.vote_average === 'number' && item.vote_average > 0
                          ? ` · ★ ${item.vote_average.toFixed(1).replace('.', ',')}/10`
                          : ''}
                      </span>
                      {isSelected && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-red-300">
                          <Check className="h-3 w-3" aria-hidden="true" />
                          {t('admin.teamSelection.selected', 'Sélectionné')}
                        </span>
                      )}
                    </span>
                    {isSelecting && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-red-300" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          {hasMore && !searching && results.length > 0 && (
            <div className="flex justify-center">
              <Button type="button" variant="outline" size="sm" data-testid="team-search-more" onClick={loadMore}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                {t('admin.teamSelection.searchMore', 'Afficher plus de résultats')}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* C. Informations du contenu */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#0a0a0b]">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-white">{t('admin.teamSelection.detailsTitle', 'Informations du contenu')}</h3>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {t('admin.teamSelection.detailsDescription', 'Valeurs récupérées depuis TMDB, entièrement modifiables avant enregistrement.')}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/55">
            TMDB #{selection.tmdbId}
          </span>
        </header>
        <div className="space-y-5 p-5 sm:p-6">
          <div data-testid="team-fields-grid" className="grid grid-cols-1 gap-x-5 gap-y-4 lg:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="team-field-type" className={labelClass}>{t('admin.teamSelection.fieldType', 'Type de contenu')}</label>
              <select
                id="team-field-type"
                data-testid="team-field-type"
                value={selection.mediaType}
                onChange={(event) => update('mediaType', event.target.value)}
                className={inputClass}
              >
                <option value="tv">{t('admin.teamSelection.typeSeries', 'Série')}</option>
                <option value="movie">{t('admin.teamSelection.typeMovie', 'Film')}</option>
              </select>
            </div>
            {fields.map(({ key, testId, label, type }) => (
              <div key={key} className="min-w-0">
                <label htmlFor={testId} className={labelClass}>{label}</label>
                <input
                  id={testId}
                  data-testid={testId}
                  type={type || 'text'}
                  min={type === 'number' ? 1 : undefined}
                  value={String(selection[key])}
                  onChange={(event) => update(key, type === 'number' ? Number(event.target.value) : event.target.value)}
                  className={inputClass}
                />
              </div>
            ))}

            <div className="min-w-0 lg:col-span-2">
              <label htmlFor="team-field-title" className={labelClass}>{t('admin.teamSelection.fieldTitle', 'Titre')}</label>
              <input
                id="team-field-title"
                data-testid="team-field-title"
                value={selection.title}
                onChange={(event) => update('title', event.target.value)}
                className={`${inputClass} text-base font-semibold`}
              />
            </div>

            <div className="min-w-0 lg:col-span-2">
              <label htmlFor="team-field-description" className={labelClass}>{t('admin.teamSelection.fieldDescription', 'Description / synopsis')}</label>
              <textarea
                id="team-field-description"
                data-testid="team-field-description"
                rows={8}
                value={selection.description}
                onChange={(event) => update('description', event.target.value)}
                className={`${inputClass} min-h-[176px] resize-y whitespace-normal`}
              />
              <p className={hintClass}>
                {t('admin.teamSelection.descriptionHint', 'Le synopsis TMDB est conservé intégralement, sans limite de caractères ajoutée par l’administration.')}
              </p>
            </div>

            <div className="min-w-0 lg:col-span-2">
              <label htmlFor="team-field-backdrop" className={labelClass}>{t('admin.teamSelection.fieldBackdrop', 'Image de fond (URL ou chemin public)')}</label>
              <input
                id="team-field-backdrop"
                data-testid="team-field-backdrop"
                value={selection.backdropUrl}
                onChange={(event) => update('backdropUrl', event.target.value)}
                placeholder="https://image.tmdb.org/t/p/original/…"
                className={`${inputClass} font-mono text-xs`}
              />
            </div>

            <div className="min-w-0 lg:col-span-2">
              <label htmlFor="team-field-details-url" className={labelClass}>{t('admin.teamSelection.fieldDetailsUrl', 'Lien vers la fiche Movix')}</label>
              <input
                id="team-field-details-url"
                data-testid="team-field-details-url"
                value={selection.detailsUrl}
                onChange={(event) => update('detailsUrl', event.target.value)}
                placeholder="/film/… ou /tv/…"
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-white/50">
              <ImageOff className="h-3.5 w-3.5" aria-hidden="true" />
              {t('admin.teamSelection.backdropPreview', 'Aperçu de l’image de fond')}
            </p>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/[0.08] bg-[#080808]">
              {backdropUrl && !backdropFailed ? (
                <img
                  data-testid="team-backdrop-preview"
                  src={backdropUrl}
                  alt={t('admin.teamSelection.backdropAlt', 'Aperçu de l’image de fond de la bannière')}
                  onError={() => setBackdropFailed(true)}
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                  <ImageOff className="h-7 w-7 text-white/25" aria-hidden="true" />
                  <p className="px-4 text-xs text-white/45">
                    {backdropUrl
                      ? t('admin.teamSelection.backdropInvalid', 'Cette image ne peut pas être affichée. Vérifie l’URL.')
                      : t('admin.teamSelection.backdropMissing', 'Aucune image de fond renseignée.')}
                  </p>
                </div>
              )}
            </div>
            {backdropUrl && <p className="mt-2 break-all font-mono text-[11px] leading-4 text-white/35">{backdropUrl}</p>}
          </div>
        </div>
      </section>

      {/* D. Aperçu en direct */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#0a0a0b]">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight text-white">{t('admin.teamSelection.previewTitle', 'Aperçu en direct')}</h3>
            <p className="mt-1 text-sm leading-6 text-white/60">
              {t('admin.teamSelection.previewDescription', 'Rendu de la bannière de l’accueil. Les modifications sont visibles immédiatement.')}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-red-500/25 bg-red-500/[0.08] px-2.5 py-1 text-[11px] font-semibold text-red-200">
            {t('admin.teamSelection.previewLive', 'Aperçu live')}
          </span>
        </header>
        <div className="p-5 sm:p-6">
          <div
            data-testid="team-preview"
            className="relative min-h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-[#080808] sm:min-h-[400px]"
          >
            {backdropUrl && !backdropFailed ? (
              <img
                data-testid="team-preview-backdrop"
                src={backdropUrl}
                alt=""
                aria-hidden="true"
                onError={() => setBackdropFailed(true)}
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#161618] via-[#0d0d0f] to-black" />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/90" aria-hidden="true" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/30 to-black/60" aria-hidden="true" />

            <div className="relative z-10 flex min-h-[320px] flex-col justify-end gap-3 p-5 sm:min-h-[400px] sm:p-8">
              <span data-testid="team-preview-badge" className="inline-flex w-fit items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/95 backdrop-blur-md">
                {selection.badge}
              </span>
              <h4 data-testid="team-preview-title" className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
                {selection.title || t('admin.teamSelection.previewNoTitle', 'Titre de la sélection')}
              </h4>
              {meta.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {selection.ageRating && (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs text-white/90">{selection.ageRating}</span>
                  )}
                  {selection.rating && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-100">
                      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                      {selection.rating}
                    </span>
                  )}
                  {(selection.genres || '').split(',').map((genre) => genre.trim()).filter(Boolean).map((genre) => (
                    <span key={genre} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white/80">{genre}</span>
                  ))}
                  {selection.duration && (
                    <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white/80">{selection.duration}</span>
                  )}
                </div>
              )}
              <p data-testid="team-preview-description" className="max-h-44 max-w-3xl overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-white/80 sm:text-base">
                {selection.description}
              </p>
              <Link
                data-testid="team-preview-cta"
                to={selection.detailsUrl || '/'}
                onClick={(event) => event.preventDefault()}
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
              >
                <Info className="h-4 w-4" aria-hidden="true" />
                {t('admin.teamSelection.previewCta', 'Voir la fiche')}
              </Link>
            </div>

            {!enabled && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6 text-center backdrop-blur-[2px]">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white">
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                  {t('admin.teamSelection.previewHidden', 'Bannière masquée sur l’accueil')}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* E. Diffusion */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#0a0a0b]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">{t('admin.teamSelection.visibilityTitle', 'Diffusion de la bannière')}</h3>
            <p className="mt-1 text-xs leading-5 text-white/50">
              {t('admin.teamSelection.visibilityHint', 'L’encart disparaît de l’accueil tant que cette option est désactivée.')}
            </p>
          </div>
          <div data-testid="team-toggle" className="flex shrink-0 items-center gap-3">
            <span className="text-xs font-semibold text-white/65">
              {t('admin.teamSelection.visibilityLabel', 'Afficher la sélection')}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => update('enabled', checked)}
              aria-label={t('admin.teamSelection.visibilityLabel', 'Afficher la sélection')}
            />
          </div>
        </div>
      </section>

      {/* E. Actions */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/90 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="min-w-0 flex-1 space-y-1">
          {dirty && (
            <p data-testid="team-dirty" className="flex items-center gap-2 text-xs font-semibold text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
              {t('admin.teamSelection.unsaved', 'Modifications non enregistrées')}
            </p>
          )}
          {justSaved && !dirty && (
            <p data-testid="team-saved" className="flex items-center gap-2 text-xs font-semibold text-white/80">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('admin.teamSelection.saved', 'Enregistré')}
            </p>
          )}
          {!dirty && !justSaved && (
            <p className="text-xs text-white/40">
              {t('admin.teamSelection.upToDate', 'Configuration à jour.')}
            </p>
          )}
          {saveError && (
            <p data-testid="team-save-error" className="flex items-start gap-2 text-xs leading-5 text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{saveError}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button type="button" variant="outline" onClick={reset} disabled={!dirty || saving} data-testid="team-reset">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('admin.teamSelection.reset', 'Réinitialiser')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!dirty || saving} data-testid="team-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {saving
              ? t('admin.teamSelection.saving', 'Enregistrement…')
              : t('admin.teamSelection.save', 'Enregistrer la sélection')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AdminTeamSelection;
