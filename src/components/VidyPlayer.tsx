import React, { useEffect, useMemo, useRef } from 'react';

type VidyPlayerProps = {
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

const VIDY_ORIGINS = new Set(['https://www.vidy.st', 'https://vidy.st']);

function readContinueWatching(): { movies: Array<number | ContinueWatchingEntry>; tv: ContinueWatchingEntry[] } {
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

function getSavedProgress(kind: 'movie' | 'tv', tmdbId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    if (window.localStorage.getItem('settings_disable_history') === 'true') return 0;
  } catch {
    return 0;
  }

  // Vidy's documented PLAYER_EVENT payload contains time/duration but no
  // season/episode identity. Never replay a TV timestamp against an episode
  // that may have changed inside the cross-origin iframe.
  if (kind === 'tv') return 0;

  const id = Number(tmdbId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;

  const history = readContinueWatching();
  const entry = history.movies.find((item) => (typeof item === 'number' ? item : item?.id) === id);
  return typeof entry === 'object' && entry && Number.isFinite(entry.progress) ? Math.max(0, entry.progress ?? 0) : 0;
}

/** Lecteur unique Vidy pour les films et séries. Anime conserve son lecteur dédié. */
const VidyPlayer: React.FC<VidyPlayerProps> = ({
  kind,
  tmdbId,
  title,
  season,
  episode,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSavedAtRef = useRef(0);
  const savedProgress = getSavedProgress(kind, tmdbId);

  const src = useMemo(() => {
    const path = kind === 'movie'
      ? `/movie/${encodeURIComponent(tmdbId)}`
      : `/tv/${encodeURIComponent(tmdbId)}/${season ?? 1}/${episode ?? 1}`;
    const url = new URL(path, 'https://www.vidy.st');
    url.searchParams.set('color', 'DC2626');
    url.searchParams.set('autoplay', 'true');

    if (savedProgress > 0) {
      url.searchParams.set('progress', String(Math.floor(savedProgress)));
    }

    if (kind === 'tv') {
      url.searchParams.set('nextEpisode', 'true');
      url.searchParams.set('episodeSelector', 'true');
      url.searchParams.set('autoplayNextEpisode', 'true');
    }

    return url.toString();
  }, [kind, tmdbId, season, episode, savedProgress]);

  useEffect(() => {
    const numericId = Number(tmdbId);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) return;

    const persistProgress = (currentTime: number, duration: number, completed: boolean) => {
      try {
        if (window.localStorage.getItem('settings_disable_history') === 'true') return;

        // PLAYER_EVENT does not identify the active TV episode. Only persist
        // movie timestamps until Vidy exposes a documented episode identifier.
        if (kind !== 'movie') return;

        const history = readContinueWatching();
        const now = new Date().toISOString();

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

        window.localStorage.setItem('continueWatching', JSON.stringify(history));
      } catch {
        // Un problème de stockage ne doit jamais interrompre la lecture.
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (!VIDY_ORIGINS.has(event.origin)) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (typeof event.data !== 'string') return;

      let payload: { type?: string; event?: string; currentTime?: number; duration?: number };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      // MEDIA_DATA contient l'historique interne de Vidy ; PLAYER_EVENT expose
      // les événements de lecture documentés et leurs temps de lecture.
      if (payload.type === 'MEDIA_DATA') return;
      const playerEvent = payload.event;
      if (!['timeupdate', 'play', 'pause', 'ended'].includes(playerEvent ?? '')) return;

      const currentTime = Number(payload.currentTime);
      const duration = Number(payload.duration);
      if (!Number.isFinite(currentTime) || currentTime < 0) return;

      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const completed = playerEvent === 'ended';
      const now = Date.now();
      const shouldPersist = completed || playerEvent === 'pause' || now - lastSavedAtRef.current >= 5000;

      if (shouldPersist) {
        persistProgress(currentTime, safeDuration, completed);
        lastSavedAtRef.current = now;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [kind, tmdbId]);

  return (
    <main className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <a href="/" className="text-sm text-white/70 hover:text-white" aria-label="Retour à Movix">←</a>
        <span className="min-w-0 truncate text-sm font-medium">{title || 'Lecture'}</span>
        <span className="ml-auto text-xs text-white/45">Vidy</span>
      </header>
      <section className="min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          key={src}
          src={src}
          title={title ? `Vidy — ${title}` : 'Lecteur Vidy'}
          className="h-full w-full border-0"
          allow="encrypted-media; autoplay *; fullscreen *"
          allowFullScreen
          loading="eager"
        />
      </section>
    </main>
  );
};

export default VidyPlayer;
