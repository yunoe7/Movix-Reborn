import React, { useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTrustedVidRiftMessage, postToVidRift, VIDRIFT_ORIGIN } from '../utils/vidriftMessaging';
import { isIpadSafari } from '../utils/deviceDetection';

type VidRiftPlayerProps = {
  kind: 'movie' | 'tv';
  tmdbId: string;
  title?: string;
  posterPath?: string;
  season?: number;
  episode?: number;
  onEpisodeChange?: (season: number, episode: number) => void;
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
 * VidRift is the shared player for films, TV series and anime (via TMDB TV IDs).
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
  onEpisodeChange,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSavedAtRef = useRef(0);
  const lastKnownDurationRef = useRef(0);
  const pendingEpisodeResumeRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const savedProgress = getSavedProgress(kind, tmdbId, season, episode);

  const src = useMemo(() => {
    const numericTmdbId = Number(tmdbId);
    if (!Number.isSafeInteger(numericTmdbId) || numericTmdbId <= 0) return '';
    const path = kind === 'movie'
      ? `/embed/movie/${encodeURIComponent(tmdbId)}`
      : `/embed/tv/${encodeURIComponent(tmdbId)}/${season ?? 1}/${episode ?? 1}`;
    const url = new URL(path, VIDRIFT_ORIGIN);
    url.searchParams.set('brand', 'Movix');
    url.searchParams.set('brandColor', VIDRIFT_BRAND_COLOR);
    // Keep VidRift's native server, quality/settings, audio and subtitle controls visible.
    // Download remains available; no native player controls are hidden.
    url.searchParams.set('download', '1');
    if (title) url.searchParams.set('title', title);
    if (posterPath?.startsWith('https://')) url.searchParams.set('poster', posterPath);
    // Sur iPadOS, le player distant choisit par défaut HLS.js/MSE alors que
    // Safari peut lire le master en natif. `pref` ne réordonne la cascade que
    // si le serveur est réellement disponible : la couverture reste intacte
    // ailleurs. Aucun `provider` n'est forcé.
    if (isIpadSafari()) {
      url.searchParams.set('pref', kind === 'tv' ? 'evion' : 'vexon');
    }
    return url.toString();
  }, [kind, tmdbId, season, episode, title, posterPath]);

  const sendToPlayer = useCallback((message: Record<string, unknown>) => {
    postToVidRift(iframeRef.current, message);
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
            duration: duration > 0 ? duration : Math.max(0, previous.currentEpisode?.duration ?? 0),
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
          duration: duration > 0 ? duration : Math.max(0, previous.duration ?? 0),
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

  const handleIframeLoad = useCallback(() => {
    // Bind through the iframe's React onLoad prop so a fast/cached embed
    // cannot finish loading before the message listener is registered.
    sendToPlayer({ type: 'vidrift:get-state' });
    if (savedProgress > 0) {
      sendToPlayer({ type: 'vidrift:resume', currentTime: Math.floor(savedProgress) });
    }
  }, [savedProgress, sendToPlayer]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (!isTrustedVidRiftMessage(event, iframe)) return;
      if (!event.data || typeof event.data !== 'object' || typeof event.data.type !== 'string') return;

      const data = event.data as {
        type: string;
        tmdbId?: number | string;
        mediaType?: string;
        currentTime?: number;
        duration?: number;
        season?: number;
        episode?: number;
      };

      // VidRift documents these identifiers on every player message.
      // Reject messages without the expected title id rather than accepting
      // an unrelated or malformed event from the same iframe origin.
      const messageTmdbId = Number(data.tmdbId);
      if (!Number.isSafeInteger(messageTmdbId) || messageTmdbId !== Number(tmdbId)) return;
      if (data.mediaType !== kind) return;

      if (data.type === 'vidrift:state') {
        const duration = Number(data.duration);
        if (Number.isFinite(duration) && duration > 0) {
          lastKnownDurationRef.current = duration;
        }
        const episodeKey = `${data.season}:${data.episode}`;
        if (kind === 'tv' && pendingEpisodeResumeRef.current === episodeKey) {
          pendingEpisodeResumeRef.current = null;
          const progress = getSavedProgress(kind, tmdbId, data.season, data.episode);
          if (progress > 0) {
            sendToPlayer({ type: 'vidrift:resume', currentTime: Math.floor(progress) });
          }
        }
        return;
      }

      if (data.type === 'vidrift:exit') {
        navigate(-1);
        return;
      }

      if (data.type === 'vidrift:episode') {
        if (kind !== 'tv') return;
        if (!Number.isInteger(data.season) || data.season! < 0
          || !Number.isInteger(data.episode) || data.episode! < 1) return;
        // The embed switches episodes itself; reset per-episode throttling and duration,
        // then mirror the URL and Movix history without remounting the iframe.
        lastKnownDurationRef.current = 0;
        lastSavedAtRef.current = 0;
        // VidRift emits this immediately before switching episodes. Wait for
        // the next state snapshot for that episode before restoring its saved
        // position, otherwise the resume command could hit the episode ending.
        pendingEpisodeResumeRef.current = `${data.season}:${data.episode}`;
        onEpisodeChange?.(data.season!, data.episode!);
        persistProgress(0, 0, false, data.season, data.episode);
        return;
      }

      if (data.type === 'vidrift:ended') {
        const currentTime = Number(data.currentTime);
        const messageDuration = Number(data.duration);
        if (Number.isFinite(messageDuration) && messageDuration > 0) {
          lastKnownDurationRef.current = messageDuration;
        }
        persistProgress(
          Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : lastKnownDurationRef.current,
          lastKnownDurationRef.current,
          true,
          data.season,
          data.episode,
        );
        return;
      }

      if (data.type === 'vidrift:progress' || data.type === 'vidrift:paused' || data.type === 'vidrift:unpaused') {
        const currentTime = Number(data.currentTime);
        const messageDuration = Number(data.duration);
        if (!Number.isFinite(currentTime) || currentTime < 0) return;
        if (Number.isFinite(messageDuration) && messageDuration > 0) {
          lastKnownDurationRef.current = messageDuration;
        }
        const duration = lastKnownDurationRef.current;
        // A normal pause is not completion. VidRift has a dedicated
        // vidrift:ended event; only that event should mark a title watched.
        const completed = false;
        const now = Date.now();
        if (data.type === 'vidrift:paused' || (data.type === 'vidrift:progress' && now - lastSavedAtRef.current >= 5000)) {
          persistProgress(
            currentTime,
            duration,
            completed,
            data.season,
            data.episode,
          );
          lastSavedAtRef.current = now;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [kind, navigate, onEpisodeChange, persistProgress, tmdbId]);

  return (
    <main className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
      {src ? (
        <iframe
          ref={iframeRef}
          onLoad={handleIframeLoad}
          key={src}
          src={src}
          title={title ? `VidRift — ${title}` : 'Lecteur VidRift'}
          className="h-full w-full flex-1 border-0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
          allowFullScreen
          loading="eager"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-white/60">
          Lecteur indisponible : identifiant VidRift invalide.
        </div>
      )}
    </main>
  );
};

export default VidRiftPlayer;
