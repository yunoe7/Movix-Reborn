import React, { useMemo } from 'react';

type VidyPlayerProps = {
  kind: 'movie' | 'tv';
  tmdbId: string;
  title?: string;
  posterPath?: string;
  season?: number;
  episode?: number;
};

/** Lecteur iframe Vidy pour les Films et Séries uniquement. Anime reste sur AnimeSama. */
const VidyPlayer: React.FC<VidyPlayerProps> = ({
  kind,
  tmdbId,
  title,
  season,
  episode,
}) => {
  const src = useMemo(() => {
    const path = kind === 'movie'
      ? `/movie/${encodeURIComponent(tmdbId)}`
      : `/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`;
    const url = new URL(path, 'https://vidy.st');
    url.searchParams.set('color', 'DC2626');
    url.searchParams.set('autoplay', 'true');
    if (kind === 'tv') {
      url.searchParams.set('nextEpisode', 'true');
      url.searchParams.set('episodeSelector', 'true');
    }
    return url.toString();
  }, [kind, tmdbId, season, episode]);

  return (
    <main className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-black text-white">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <a href="/" className="text-sm text-white/70 hover:text-white" aria-label="Retour à Movix">←</a>
        <span className="min-w-0 truncate text-sm font-medium">{title || 'Lecture'}</span>
        <span className="ml-auto text-xs text-white/45">Vidy</span>
      </header>
      <section className="min-h-0 flex-1">
        <iframe
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
