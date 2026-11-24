import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

type VidRiftPlayerProps = {
  kind: 'movie' | 'tv';
  tmdbId: string;
  title?: string;
  posterPath?: string;
  season?: number;
  episode?: number;
};

type ContinueWatchingEntry = {
  id: number;
  lastAccessed?: string;
  progress?: number;
  duration?: number;
  completed?: boolean;
  currentEpisode?: {
    season: number;
    episode: number;
    progress?: number;
    duration?: number;
    completed?: boolean;
  };
};

type ContinueWatchingHistory = {
  movies: Array<number | ContinueWatchingEntry>;
  tv: ContinueWatchingEntry[];
};

const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';
const VIDRIFT_BRAND_COLOR = 'DC2626';

function readContinueWatching(): ContinueWatchingHistory {
  try {
    const raw = window.localStorage.getItem('continueWatching');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      movies: Array.isArray(parsed?.movies) ? parsed.movies : [],
      tv: Array.isArray(parsed?.tv) ? parsed.tv : [],
    };
  } catch {
    return { movies: [], tv: [] };
  }
}

function getSavedProgress(
  kind: 'movie' | 'tv',
  tmdbId: string,
  season?: number,
  episode?: number,
): number {
  if (typeof window === 'undefined') return 0;

  try {
    if (window.localStorage.getItem('settings_disable_history') === 'true') return 0;
  } catch {
    return 0;
  }

  const id = Number(tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;

  const history = readContinueWatching();
  if (kind === 'tv') {
    const entry = history.tv.find((item) => item?.id === id);
    const current = entry?.currentEpisode;
    if (current?.season !== season || current?.episode !== episode) return 0;
    return Number.isFinite(current.progress) ? Math.max(0, current.progress ?? 0) : 0;
  }

  const entry = history.movies.find((item) => (typeof item === 'number' ? item : item?.id) === id);
  return typeof entry === 'object' && entry && Number.isFinite(entry.progress)
    ? Math.max(0, entry.progress ?? 0)
    : 0;
}

/**
 * VidRift replaces Vidy for films and TV. Anime keeps its dedicated HLS player.
 * The embed is intentionally not sandboxed: VidRift documents that sandboxing
 * prevents playback. All messages are restricted to its exact origin and iframe.
 */
const VidRiftPlayer: React.FC<VidRiftPlayerProps> = ({
  kind,
  tmdbId,
  title,
  posterPath,
  season,
  episode,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSavedAtRef = useRef(0);
  const navigate = useNavigate();
  const savedProgress = getSavedProgress(kind, tmdbId, season, episode);

  const src = useMemo(() => {
    const path = kind === 'movie'
      ? `/embed/movie/${encodeURIComponent(tmdbId)}`
      : `/embed/tv/${encodeURIComponent(tmdbId)}/${season ?? 1}/${episode ?? 1}`;
    const url = new URL(path, VIDRIFT_ORIGIN);
    url.searchParams.set('brand', 'Movix');
    url.searchParams.set('brandColor', VIDRIFT_BRAND_COLOR);
    url.searchParams.set('showTitle', '1');
    url.searchParams.set('exit', '1');
    if (title) url.searchParams.set('title', title);
    if (posterPath?.startsWith('https://')) url.searchParams.set('poster', posterPath);
    return url.toString();
  }, [kind, tmdbId, season, episode, title, posterPath]);

  const sendToPlayer = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, VIDRIFT_ORIGIN);
  }, []);

  const persistProgress = useCallback((
    currentTime: number,
    duration: number,
    completed: boolean,
    activeSeason?: number,
    activeEpisode?: number,
  ) => {
    const numericId = Number(tmdbId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return;

    try {
      if (window.localStorage.getItem('settings_disable_history') === 'true') return;
      const history = readContinueWatching();
      const now = new Date().toISOString();

      if (kind === 'tv') {
        const activeS = Number.isSafeInteger(activeSeason) ? activeSeason! : (season ?? 1);
        const activeE = Number.isSafeInteger(activeEpisode) ? activeEpisode! : (episode ?? 1);
        const existingIndex = history.tv.findIndex((item) => item?.id === numericId);
        const previous = existingIndex >= 0 ? history.tv[existingIndex] : { id: numericId };
        const updated: ContinueWatchingEntry = {
          ...previous,
          id: numericId,
          lastAccessed: now,
          currentEpisode: {
            season: activeS,
            episode: activeE,
            progress: completed ? 0 : Math.max(0, currentTime),
            duration: Math.max(0, duration),
            completed,
          },
        };
        if (existingIndex >= 0) history.tv.splice(existingIndex, 1);
        history.tv.unshift(updated);
      } else {
        const existingIndex = history.movies.findIndex(
          (item) => (typeof item === 'number' ? item : item?.id) === numericId,
        );
        const previous = existingIndex >= 0 && typeof history.movies[existingIndex] === 'object'
          ? history.movies[existingIndex] as ContinueWatchingEntry
          : { id: numericId };
        const updated: ContinueWatchingEntry = {
          ...previous,
          id: numericId,
          lastAccessed: now,
          progress: completed ? 0 : Math.max(0, currentTime),
          duration: Math.max(0, duration),
          completed,
        };
        if (existingIndex >= 0) history.movies.splice(existingIndex, 1);
        history.movies.unshift(updated);
      }

      window.localStorage.setItem('continueWatching', JSON.stringify(history));
    } catch {
      // Storage failures must never interrupt playback.
    }
  }, [kind, tmdbId, season, episode]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      sendToPlayer({ type: 'vidrift:get-state' });
      if (savedProgress > 0) {
        sendToPlayer({ type: 'vidrift:resume', currentTime: Math.floor(savedProgress) });
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== VIDRIFT_ORIGIN) return;
      if (event.source !== iframe.contentWindow) return;
      if (!event.data || typeof event.data !== 'object' || typeof event.data.type !== 'string') return;

      const data = event.data as {
        type: string;
        tmdbId?: number | string;
        currentTime?: number;
        duration?: number;
        season?: number;
        episode?: number;
      };

      if (data.type === 'vidrift:exit') {
        navigate(-1);
        return;
      }

      if (data.type === 'vidrift:episode') {
        if (kind !== 'tv') return;
        // The embed switches episodes itself; mirror the episode in Movix history.
        persistProgress(0, 0, false, data.season, data.episode);
        return;
      }

      if (data.type === 'vidrift:ended') {
        persistProgress(
          Number(data.currentTime) || 0,
          Number(data.duration) || 0,
          true,
          data.season,
          data.episode,
        );
        return;
      }

      if (data.type === 'vidrift:progress' || data.type === 'vidrift:paused') {
        const currentTime = Number(data.currentTime);
        const duration = Number(data.duration);
        if (!Number.isFinite(currentTime) || currentTime < 0) return;
        const now = Date.now();
        if (data.type === 'vidrift:paused' || now - lastSavedAtRef.current >= 5000) {
          persistProgress(
            currentTime,
            Number.isFinite(duration) && duration > 0 ? duration : 0,
            false,
            data.season,
            data.episode,
          );
          lastSavedAtRef.current = now;
        }
      }
    };

    iframe.addEventListener('load', handleLoad);
    window.addEventListener('message', handleMessage);
    return () => {
      iframe.removeEventListener('load', handleLoad);
      window.removeEventListener('message', handleMessage);
    };
  }, [kind, navigate, persistProgress, savedProgress, sendToPlayer]);

  return (
    <main className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
      <iframe
        ref={iframeRef}
        key={src}
        src={src}
        title={title ? `VidRift — ${title}` : 'Lecteur VidRift'}
        className="h-full w-full flex-1 border-0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
        allowFullScreen
        loading="eager"
      />
    </main>
  );
};

export default VidRiftPlayer;
