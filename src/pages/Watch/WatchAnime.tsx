import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import VidRiftPlayer from '../../components/VidRiftPlayer';
import useWatchStatus from '../../hooks/useWatchStatus';
import { useWrappedTracker } from '../../hooks/useWrappedTracker';
import { getTmdbId, encodeId } from '../../utils/idEncoder';
import { getTmdbLanguage } from '../../i18n';
import { useProfile } from '../../context/ProfileContext';
import { isContentAllowed } from '../../utils/certificationUtils';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';

interface AnimeShow {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  genres: Array<{ id: number; name: string }>;
  seasons: Array<{ id: number; name: string; season_number: number; episode_count: number }>;
}

interface AnimeEpisode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  air_date?: string;
  still_path?: string | null;
}

const WatchAnime: React.FC = () => {
  const { id: encodedId, season: seasonParam, episode: episodeParam } =
    useParams<{ id: string; season: string; episode: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  const parsedSeason = Number(seasonParam);
  const season = Number.isInteger(parsedSeason) && parsedSeason >= 0 ? parsedSeason : 1;
  const episode = Math.max(1, Number(episodeParam) || 1);
  const [activeSeason, setActiveSeason] = useState(season);
  const [activeEpisode, setActiveEpisode] = useState(episode);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { currentProfile } = useProfile();
  const [show, setShow] = useState<AnimeShow | null>(null);
  const [episodes, setEpisodes] = useState<AnimeEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [certificate, setCertificate] = useState('');

  useEffect(() => {
    setActiveSeason(season);
    setActiveEpisode(episode);
  }, [season, episode]);

  const { isWatched, toggleWatched } = useWatchStatus({
    id: id ? Number(id) : 0,
    type: 'tv',
    title: show?.name || '',
    poster_path: show?.poster_path || '',
    episodeInfo: { season: activeSeason, episode: activeEpisode },
  });

  useWrappedTracker({
    mode: 'viewing',
    viewingData: id ? {
      contentType: 'tv',
      contentId: id,
      contentTitle: show?.name,
      seasonNumber: activeSeason,
      episodeNumber: activeEpisode,
    } : undefined,
    isActive: !loading && !!id && !blocked,
  });

  useEffect(() => {
    if (!id || !TMDB_API_KEY) {
      setError(t('watch.cannotLoadAnimeDetails'));
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setBlocked(false);
      try {
        const [showResponse, seasonResponse] = await Promise.all([
          axios.get<AnimeShow>(`https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}`, {
            params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() },
          }),
          axios.get<{ episodes: AnimeEpisode[] }>(
            `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/season/${season}`,
            { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } },
          ),
        ]);
        if (cancelled) return;
        setShow(showResponse.data);
        setEpisodes(Array.isArray(seasonResponse.data.episodes) ? seasonResponse.data.episodes : []);

        const profileAge = currentProfile?.ageRestriction ?? 0;
        if (profileAge > 0) {
          try {
            const ratingsResponse = await axios.get<{ results: Array<{ iso_3166_1: string; rating: string }> }>(
              `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/content_ratings`,
              { params: { api_key: TMDB_API_KEY } },
            );
            if (cancelled) return;
            const ratings = ratingsResponse.data.results || [];
            const rating = ratings.find((item) => item.iso_3166_1 === 'FR')?.rating
              || ratings.find((item) => item.iso_3166_1 === 'US')?.rating
              || '';
            if (rating && !isContentAllowed(rating, profileAge)) {
              setCertificate(rating);
              setBlocked(true);
            }
          } catch {
            // A rating lookup failure must not prevent otherwise valid playback.
          }
        }
      } catch (loadError) {
        if (!cancelled) setError(t('watch.cannotLoadAnimeDetails'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [id, season, currentProfile?.ageRestriction, t]);

  useEffect(() => {
    if (!id || blocked) return;
    try {
      if (localStorage.getItem('settings_disable_history') === 'true') return;
      const parsed = JSON.parse(localStorage.getItem('continueWatching') || '{"movies":[],"tv":[]}');
      if (!Array.isArray(parsed.movies) || !Array.isArray(parsed.tv)) return;
      const numericId = Number(id);
      const previous = parsed.tv.find((entry: { id?: number }) => entry?.id === numericId) || {};
      parsed.tv = parsed.tv.filter((entry: { id?: number }) => entry?.id !== numericId);
      parsed.tv.unshift({
        ...previous,
        id: numericId,
        currentEpisode: { season: activeSeason, episode: activeEpisode },
        lastAccessed: new Date().toISOString(),
      });
      localStorage.setItem('continueWatching', JSON.stringify(parsed));
    } catch {
      // Playback should continue even when browser history storage is unavailable.
    }
  }, [id, activeSeason, activeEpisode, blocked]);

  const goToEpisode = (nextSeason: number, nextEpisode: number) => {
    if (!id) return;
    navigate(`/watch/anime/${encodeId(id)}/season/${nextSeason}/episode/${nextEpisode}`);
  };

  const currentSeason = show?.seasons.find((item) => item.season_number === activeSeason);
  const previousEpisode = activeEpisode > 1
    ? { season: activeSeason, episode: activeEpisode - 1 }
    : (() => {
        const previousSeason = [...(show?.seasons || [])]
          .filter((item) => item.season_number < activeSeason && item.episode_count > 0)
          .sort((a, b) => b.season_number - a.season_number)[0];
        return previousSeason ? { season: previousSeason.season_number, episode: previousSeason.episode_count } : null;
      })();
  const nextEpisode = activeEpisode < (currentSeason?.episode_count || 0)
    ? { season: activeSeason, episode: activeEpisode + 1 }
    : (() => {
        const nextSeason = [...(show?.seasons || [])]
          .filter((item) => item.season_number > activeSeason && item.episode_count > 0)
          .sort((a, b) => a.season_number - b.season_number)[0];
        return nextSeason ? { season: nextSeason.season_number, episode: 1 } : null;
      })();

  if (loading) {
    return <main className="fixed inset-0 flex items-center justify-center bg-black text-white" role="status">
      <div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-red-500" />
        <p>{t('watch.loadingSources')}</p></div>
    </main>;
  }

  if (blocked) {
    return <main className="fixed inset-0 flex items-center justify-center bg-black px-6 text-center text-white">
      <div><h1 className="mb-2 text-xl font-bold">{t('watch.cannotLoadAnimeDetails')}</h1>
        <p className="text-white/70">Accès bloqué par la restriction d’âge du profil ({certificate}).</p>
        <button className="mt-5 rounded bg-red-700 px-4 py-2" onClick={() => navigate(-1)}>{t('watch.back')}</button>
      </div>
    </main>;
  }

  if (error || !id || !show) {
    return <main className="fixed inset-0 flex items-center justify-center bg-black px-6 text-center text-white">
      <div><p className="mb-4">{error || t('watch.cannotLoadAnimeDetails')}</p>
        <button className="rounded bg-gray-700 px-4 py-2" onClick={() => navigate(-1)}>{t('watch.back')}</button>
      </div>
    </main>;
  }

  const posterPath = show.poster_path ? `${TMDB_IMAGE_BASE}w500${show.poster_path}` : undefined;

  return <main className="fixed inset-0 bg-black text-white">
    <VidRiftPlayer
      kind="tv"
      tmdbId={id}
      title={show.name}
      posterPath={posterPath}
      season={season}
      episode={episode}
      onEpisodeChange={(nextSeason, nextEpisode) => {
        setActiveSeason(nextSeason);
        setActiveEpisode(nextEpisode);
        window.history.replaceState(window.history.state, '', `/watch/anime/${encodeId(id)}/season/${nextSeason}/episode/${nextEpisode}`);
        void axios.get<{ episodes: AnimeEpisode[] }>(
          `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/season/${nextSeason}`,
          { params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() } },
        ).then((response) => setEpisodes(Array.isArray(response.data.episodes) ? response.data.episodes : [])).catch(() => setEpisodes([]));
      }}
    />
    <div className="pointer-events-none fixed left-4 top-4 z-[60] flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2">
      <button className="pointer-events-auto rounded-lg bg-black/75 px-3 py-2 text-sm shadow" onClick={() => navigate(`/tv/${encodeId(id)}`)}>
        ← {t('watch.back')}
      </button>
      <span className="rounded-lg bg-black/75 px-3 py-2 text-sm shadow">{show.name} · S{activeSeason} E{activeEpisode}</span>
      <button className="pointer-events-auto rounded-lg bg-black/75 px-3 py-2 text-sm shadow" onClick={toggleWatched}>
        {isWatched ? 'Déjà vu' : 'Marquer comme vu'}
      </button>
      {previousEpisode && <button className="pointer-events-auto rounded-lg bg-black/75 px-3 py-2 text-sm shadow" onClick={() => goToEpisode(previousEpisode.season, previousEpisode.episode)}>‹ Épisode précédent</button>}
      {nextEpisode && <button className="pointer-events-auto rounded-lg bg-black/75 px-3 py-2 text-sm shadow" onClick={() => goToEpisode(nextEpisode.season, nextEpisode.episode)}>Épisode suivant ›</button>}
      <select aria-label={t('watch.seasonLabel')} className="pointer-events-auto max-w-40 rounded-lg bg-black/80 px-3 py-2 text-sm" value={activeSeason} onChange={(event) => goToEpisode(Number(event.target.value), 1)}>
        {show.seasons.filter((item) => item.episode_count > 0).map((item) =>
          <option key={item.id} value={item.season_number}>{item.name}</option>
        )}
      </select>
      <select aria-label={t('watch.episodes')} className="pointer-events-auto max-w-48 rounded-lg bg-black/80 px-3 py-2 text-sm" value={activeEpisode} onChange={(event) => goToEpisode(activeSeason, Number(event.target.value))}>
        {episodes.map((item) => <option key={item.id} value={item.episode_number}>E{item.episode_number} · {item.name}</option>)}
      </select>
    </div>
  </main>;
};

export default WatchAnime;
