import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Check, Loader2, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminHeroPromos, updateAdminHeroPromos, type HeroPromoSettings, type TeamSelectionSettings } from '../services/heroPromoService';
import { TMDB_API_KEY, TMDB_API_URL, TMDB_IMAGE_URL } from '../config/config';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { SettingsSection, SettingsField } from './adminVipDonations/SettingsUi';
import { Skeleton } from './ui/Skeleton';

const fieldClass = 'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none transition focus-visible:ring-2 focus-visible:ring-amber-400/50';

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

const AdminTeamSelection: React.FC = () => {
  const [settings, setSettings] = useState<HeroPromoSettings | null>(null);
  const [saved, setSaved] = useState<HeroPromoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    getAdminHeroPromos().then((payload) => {
      if (!active) return;
      setSettings(payload.settings);
      setSaved(payload.settings);
    }).catch((error) => {
      if (active) toast.error(error instanceof Error ? error.message : 'Impossible de charger la sélection');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selection = settings?.teamSelection;
  const dirty = Boolean(settings && saved && JSON.stringify(settings.teamSelection) !== JSON.stringify(saved.teamSelection));
  const mediaType = selection?.mediaType || 'tv';

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      if (!TMDB_API_KEY) {
        setSearching(false);
        setResults([]);
        toast.error('La clé TMDB du site est absente.');
        return;
      }

      setSearching(true);
      try {
        const searchParams = {
          api_key: TMDB_API_KEY,
          language: 'fr-FR',
          query: text,
          include_adult: false,
          page: 1
        };
        const [movieResponse, tvResponse] = await Promise.all([
          axios.get(`${TMDB_API_URL}/search/movie`, { params: searchParams }),
          axios.get(`${TMDB_API_URL}/search/tv`, { params: searchParams })
        ]);

        if (!active) return;
        const movies: TmdbSearchResult[] = (movieResponse.data?.results || [])
          .map((item: Omit<TmdbSearchResult, 'mediaType'>) => ({ ...item, mediaType: 'movie' as const }));
        const series: TmdbSearchResult[] = (tvResponse.data?.results || [])
          .map((item: Omit<TmdbSearchResult, 'mediaType'>) => ({ ...item, mediaType: 'tv' as const }));

        const combined = [...movies, ...series]
          .filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
          .sort((a, b) => (b.popularity || b.vote_average || 0) - (a.popularity || a.vote_average || 0));
        setResults(combined.slice(0, 16));
      } catch {
        if (active) {
          setResults([]);
          toast.error('La recherche TMDB a échoué. Réessaie dans quelques instants.');
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const update = (key: keyof TeamSelectionSettings, value: string | number | boolean) => {
    setSettings((current) => current ? {
      ...current,
      teamSelection: { ...current.teamSelection, [key]: value }
    } : current);
  };

  const selectTmdbResult = async (item: TmdbSearchResult) => {
    if (!settings || selectingId !== null) return;
    setSelectingId(item.id);
    try {
      const response = await axios.get<TmdbDetails>(`${TMDB_API_URL}/${item.mediaType}/${item.id}`, {
        params: {
          api_key: TMDB_API_KEY,
          language: 'fr-FR',
          append_to_response: item.mediaType === 'tv' ? 'content_ratings' : 'release_dates'
        }
      });
      const details = response.data;
      const title = details.title || details.name || item.title || item.name || '';
      const rating = typeof details.vote_average === 'number' && details.vote_average > 0
        ? `${details.vote_average.toFixed(1).replace('.', ',')}/10`
        : '';
      const genres = (details.genres || []).map((genre) => genre.name).filter(Boolean).join(',');
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
          description: details.overview || '',
          backdropUrl: backdropUrl || current.teamSelection.backdropUrl,
          rating,
          genres,
          duration,
          ageRating: ageRating || current.teamSelection.ageRating,
          detailsUrl: `/${item.mediaType}/${details.id}`
        }
      } : current);
      setQuery(title);
      setResults([]);
      toast.success(`« ${title} » récupéré depuis TMDB. Vérifie les champs puis enregistre.`);
    } catch {
      toast.error('Impossible de récupérer les détails de ce titre sur TMDB.');
    } finally {
      setSelectingId(null);
    }
  };

  const fields = useMemo(() => [
    { key: 'tmdbId' as const, label: 'Identifiant TMDB', type: 'number' },
    { key: 'badge' as const, label: 'Badge affiché' },
    { key: 'title' as const, label: 'Titre' },
    { key: 'description' as const, label: 'Description', multiline: true },
    { key: 'backdropUrl' as const, label: 'Image de fond (URL ou chemin public)' },
    { key: 'detailsUrl' as const, label: 'Lien vers la fiche Movix' },
    { key: 'ageRating' as const, label: 'Âge conseillé' },
    { key: 'rating' as const, label: 'Note affichée' },
    { key: 'genres' as const, label: 'Genres (séparés par des virgules)' },
    { key: 'duration' as const, label: 'Durée / épisode' }
  ], []);

  const save = async () => {
    if (!settings || saving) return;
    if (!Number.isSafeInteger(settings.teamSelection.tmdbId) || settings.teamSelection.tmdbId < 1) {
      toast.error('Identifiant TMDB invalide.');
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminHeroPromos(settings);
      setSettings(result.settings);
      setSaved(result.settings);
      toast.success('Sélection de l’équipe enregistrée.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-3"><Skeleton variant="button" height={64} /><Skeleton variant="button" height={180} /></div>;
  if (!settings || !selection) return <p className="rounded-xl border border-red-500/30 p-5 text-sm text-red-200">Impossible de charger la sélection de l’équipe. Vérifie la connexion à l’API puis recharge la page.</p>;

  return (
    <div className="space-y-5">
      <SettingsSection
        icon={Sparkles}
        title="Sélection de l’équipe"
        description="Recherche un titre : films et séries TMDB sont interrogés ensemble, puis les informations de la bannière sont récupérées automatiquement."
      >
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <SettingsField id="team-selection-search" label="Rechercher un film ou une série" hint="Deux caractères minimum. Films et séries sont recherchés simultanément.">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input id="team-selection-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex. : Dune, One Piece, Les Carnets de l’apothicaire…" className={`${fieldClass} pl-10`} />
            </div>
          </SettingsField>
          {searching && <p className="flex items-center gap-2 text-xs text-white/55"><Loader2 className="h-4 w-4 animate-spin" /> Recherche sur TMDB…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && <p className="text-xs text-white/50">Aucun résultat. Essaie un autre titre.</p>}
          {results.length > 0 && (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {results.map((item) => {
                const name = item.title || item.name || item.original_title || item.original_name || 'Titre sans nom';
                const date = item.release_date || item.first_air_date || '';
                return (
                  <button key={item.id} type="button" onClick={() => void selectTmdbResult(item)} disabled={selectingId !== null} className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-black/25 p-2 text-left transition hover:border-amber-400/50 hover:bg-white/[0.06] disabled:opacity-50">
                    {item.poster_path ? <img src={`${TMDB_IMAGE_URL}/w92${item.poster_path}`} alt="" className="h-16 w-11 rounded object-cover" /> : <div className="flex h-16 w-11 items-center justify-center rounded bg-white/5 text-[10px] text-white/30">Sans affiche</div>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{name}</span>
                      <span className="mt-1 block text-xs text-white/50">{item.mediaType === 'movie' ? 'FILM' : 'SÉRIE'} · {date ? date.slice(0, 4) : 'Date inconnue'}{typeof item.vote_average === 'number' && item.vote_average > 0 ? ` · ★ ${item.vote_average.toFixed(1)}/10` : ''}</span>
                    </span>
                    {selectingId === item.id ? <Loader2 className="h-4 w-4 animate-spin text-amber-300" /> : <Check className="h-4 w-4 text-white/35" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField id="team-selection-type" label="Type de contenu" hint="Choisis un film ou une série TMDB.">
            <select id="team-selection-type" value={selection.mediaType} onChange={(event) => { update('mediaType', event.target.value); setResults([]); }} className={fieldClass}>
              <option value="tv">Série</option>
              <option value="movie">Film</option>
            </select>
          </SettingsField>
          {fields.map(({ key, label, multiline, type }) => (
            <SettingsField key={key} id={`team-selection-${key}`} label={label} className={multiline ? 'md:col-span-2' : undefined}>
              {multiline ? (
                <textarea id={`team-selection-${key}`} rows={4} value={String(selection[key])} onChange={(event) => update(key, event.target.value)} className={fieldClass} />
              ) : (
                <input id={`team-selection-${key}`} type={type || 'text'} min={type === 'number' ? 1 : undefined} value={String(selection[key])} onChange={(event) => update(key, type === 'number' ? Number(event.target.value) : event.target.value)} className={fieldClass} />
              )}
            </SettingsField>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div>
            <p className="text-sm font-semibold text-white">Afficher la sélection</p>
            <p className="mt-1 text-xs text-white/50">Masquer ou afficher entièrement le grand encart sur l’accueil.</p>
          </div>
          <Switch checked={selection.enabled} onCheckedChange={(checked) => update('enabled', checked)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
          <p className="text-xs text-white/45">{dirty ? 'Modifications non enregistrées.' : 'Les réglages sont à jour.'}</p>
          <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Enregistrement…' : 'Enregistrer la sélection'}</Button>
        </div>
      </SettingsSection>
    </div>
  );
};

export default AdminTeamSelection;
