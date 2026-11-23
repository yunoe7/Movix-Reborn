import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { AlertCircle, Check, Download, Loader, Search, X } from 'lucide-react';
import { listDownloadLinks, type AdminDownloadLink } from '@/services/downloadLinksService';
import { useExternalSubtitles } from '@/hooks/useExternalSubtitles';
import type { SubtitleTrack } from '@/services/subtitles';
import { getTmdbLanguage } from '@/i18n';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

type MediaKind = 'movie' | 'tv';

interface TitleDetails {
  title: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: Array<{ season_number: number; episode_count?: number; name?: string }>;
}

interface VideoSource {
  id: string;
  url: string;
  quality?: string;
  codec?: string;
  size?: string;
  language?: string;
  host?: string;
  subtitled?: boolean;
  fullSeason?: boolean;
}

type DownloadSelection =
  | { kind: 'video'; id: string }
  | { kind: 'subtitle'; id: string };

interface DownloadStatus {
  phase: 'idle' | 'downloading' | 'done' | 'error';
  percent: number | null;
  message?: string;
}

const EMPTY_STATUS: DownloadStatus = { phase: 'idle', percent: null };

function formatBytes(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const units = ['octets', 'Ko', 'Mo', 'Go'];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    return `${amount.toFixed(amount >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'download';
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = safeFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/**
 * Télécharge réellement l'URL fournie par la source sélectionnée. La progression
 * vient du corps de réponse et de `Content-Length` quand le serveur le fournit ;
 * sans longueur connue, l'interface passe en mode indéterminé plutôt que
 * d'afficher un pourcentage inventé.
 */
async function downloadWithProgress(
  url: string,
  filename: string,
  onProgress: (percent: number | null) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const lengthHeader = response.headers.get('content-length');
  const total = lengthHeader ? Number(lengthHeader) : 0;
  const contentType = response.headers.get('content-type') || 'application/octet-stream';

  if (!response.body) {
    const blob = await response.blob();
    onProgress(100);
    saveBlob(blob, filename);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null);
  }

  onProgress(100);
  saveBlob(new Blob(chunks as BlobPart[], { type: contentType }), filename);
}

function toVideoSource(link: AdminDownloadLink): VideoSource {
  return {
    id: link.url,
    url: link.url,
    quality: link.quality,
    codec: (link as AdminDownloadLink & { codec?: string }).codec,
    size: formatBytes(link.size, ''),
    language: link.language,
    host: link.host,
    subtitled: Boolean(link.sub),
    fullSeason: Boolean(link.full_saison),
  };
}

/** Panneau de téléchargement branché uniquement sur des données de source réelles. */
const DownloadPage: React.FC = () => {
  const { type: rawType, id } = useParams<{ type: string; id: string }>();
  const type: MediaKind = rawType === 'tv' ? 'tv' : 'movie';
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const [details, setDetails] = useState<TitleDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsError, setDetailsError] = useState('');

  const seasonParam = Number(searchParams.get('season'));
  const episodeParam = Number(searchParams.get('episode'));
  const [season, setSeason] = useState(Number.isFinite(seasonParam) && seasonParam > 0 ? seasonParam : 1);
  const [episode, setEpisode] = useState(Number.isFinite(episodeParam) && episodeParam > 0 ? episodeParam : 1);
  const [fullSeason] = useState(searchParams.get('fullSeason') === 'true');

  const [videoSources, setVideoSources] = useState<VideoSource[]>([]);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState('');

  const [subtitleSearch, setSubtitleSearch] = useState('');
  const [selection, setSelection] = useState<DownloadSelection | null>(null);
  const [status, setStatus] = useState<DownloadStatus>(EMPTY_STATUS);
  const downloadController = useRef<AbortController | null>(null);

  const preferredLang = useMemo(() => getTmdbLanguage().split('-')[0] || 'fr', []);
  const subtitleQuery = useMemo(() => ({
    type,
    tmdbId: id,
    ...(type === 'tv'
      ? { season, ...(fullSeason ? {} : { episode }) }
      : {}),
  }), [type, id, season, episode, fullSeason]);
  const { tracks, loading: subtitlesLoading, providerErrors } = useExternalSubtitles(subtitleQuery, preferredLang);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError('');

    const endpoint = `https://api.themoviedb.org/3/${type}/${encodeURIComponent(id)}`
      + `?api_key=${TMDB_API_KEY}&language=${encodeURIComponent(getTmdbLanguage())}`;

    axios.get<TitleDetails>(endpoint, { signal: controller.signal })
      .then(({ data }) => {
        if (!cancelled) setDetails(data);
      })
      .catch((error) => {
        if (cancelled || axios.isCancel(error)) return;
        setDetailsError(error instanceof Error ? error.message : 'TMDB error');
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, type]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setVideoLoading(true);
    setVideoError('');
    setVideoSources([]);
    setSelection((current) => (current?.kind === 'video' ? null : current));

    listDownloadLinks({
      type,
      id,
      ...(type === 'tv'
        ? { season, ...(fullSeason ? { fullSeason: true } : { episode }) }
        : {}),
    })
      .then((links) => {
        if (cancelled) return;
        const sources = Array.isArray(links) ? links.map(toVideoSource).filter((source) => source.url) : [];
        setVideoSources(sources);
        setSelection((current) => current ?? (sources[0] ? { kind: 'video', id: sources[0].id } : null));
      })
      .catch((error) => {
        if (cancelled) return;
        setVideoError(error instanceof Error ? error.message : 'Source error');
      })
      .finally(() => {
        if (!cancelled) setVideoLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, type, season, episode, fullSeason]);

  useEffect(() => () => downloadController.current?.abort(), []);

  const visibleSubtitles = useMemo(() => {
    const query = subtitleSearch.trim().toLowerCase();
    return tracks.filter((track) => {
      if (languageFilter !== 'all' && track.lang !== languageFilter) return false;
      if (!query) return true;
      return `${track.label} ${track.lang} ${track.provider} ${track.source}`.toLowerCase().includes(query);
    });
  }, [tracks, subtitleSearch, languageFilter]);

  const selectedVideo = useMemo(
    () => (selection?.kind === 'video' ? videoSources.find((source) => source.id === selection.id) : undefined),
    [selection, videoSources],
  );
  const selectedSubtitle = useMemo(
    () => (selection?.kind === 'subtitle' ? tracks.find((track) => track.id === selection.id) : undefined),
    [selection, tracks],
  );
  const selectedItem = selectedVideo || selectedSubtitle;

  const startDownload = async () => {
    if (!selectedItem || status.phase === 'downloading') return;
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    setStatus({ phase: 'downloading', percent: 0 });

    const filename = selectedVideo
      ? selectedVideo.id.split('/').pop() || details?.title || 'video'
      : selectedSubtitle?.label || 'subtitles';

    try {
      await downloadWithProgress(selectedItem.url, filename, (percent) => {
        if (!controller.signal.aborted) setStatus({ phase: 'downloading', percent });
      }, controller.signal);
      if (!controller.signal.aborted) setStatus({ phase: 'done', percent: 100 });
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus({
        phase: 'error',
        percent: null,
        message: error instanceof Error ? error.message : 'Download error',
      });
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
    }
  };

  const title = details?.title || (type === 'tv' ? t('details.tvShow') : t('details.movie'));
  return (
    <main
      className="fixed inset-0 z-[120] flex min-h-0 items-center justify-center bg-black/80 p-3 text-white sm:p-5"
      data-testid="download-panel"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) navigate(-1);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-modal-title"
        className="flex max-h-[min(88vh,700px)] w-full max-w-[400px] min-h-0 flex-col overflow-hidden rounded-[18px] border border-white/[0.09] bg-[#1b1b1b] shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
      >
        <header className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4" data-testid="download-header">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/55">
            <Download className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 id="download-modal-title" className="text-[15px] font-semibold leading-5">{t('download.panel.eyebrow')}</h1>
            <p className="mt-1 truncate text-[13px] text-white/45">
              {title}{year ? ` (${year})` : ''}
              {type === 'tv' ? ` · ${t('download.season')} ${season} · ${t('download.episode')} ${episode}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={t('common.close', 'Fermer')}
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white"
            data-testid="download-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {detailsLoading && (
            <div className="mb-3 flex items-center gap-2 text-xs text-white/45">
              <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t('download.loadingDetails')}
            </div>
          )}
          {detailsError && (
            <p className="mb-3 text-xs text-red-300" role="alert">{t('download.errorLoadingDetails')}: {detailsError}</p>
          )}

          <div className="mb-3 flex items-center justify-between">
            <h2 id="download-video-heading" className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{t('download.panel.qualityLabel')}</h2>
            <span className="text-[11px] text-white/35">{videoSources.length}</span>
          </div>

          {videoLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] p-4 text-xs text-white/45">
              <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('download.fetchingLinks')}
            </div>
          ) : videoSources.length > 0 ? (
            <div className="overflow-hidden rounded-[15px] border border-white/[0.09]" data-testid="download-video-list">
              {videoSources.map((source, index) => {
                const active = selection?.kind === 'video' && selection.id === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelection({ kind: 'video', id: source.id }); setStatus(EMPTY_STATUS); }}
                    className={`flex min-h-[62px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${active ? 'bg-white/[0.10]' : 'bg-transparent hover:bg-white/[0.045]'} ${index ? 'border-t border-white/[0.075]' : ''}`}
                    data-testid="download-video-option"
                    data-quality={source.quality || ''}
                    data-size={source.size || ''}
                    data-codec={source.codec || ''}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? 'border-white bg-white text-[#171717]' : 'border-white/25 text-transparent'}`}>
                      {active && <Check className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold leading-5 text-white">{source.quality || t('download.panel.notProvided')}</span>
                      <span className="block truncate text-[10px] font-semibold uppercase leading-4 text-white/35">
                        {[source.host, source.codec].filter(Boolean).join(' · ') || t('download.panel.notProvided')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] font-medium text-white/45">{source.size || t('download.panel.notProvided')}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.08] bg-black/10 p-3.5" data-testid="download-video-empty">
              <div className="flex gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                <div>
                  <p className="text-[13px] font-semibold text-white">{t('download.panel.noVideo')}</p>
                  <p className="mt-1 text-[11px] leading-4 text-white/40">{t('download.panel.videoUnavailableDesc')}</p>
                  {videoError && <p className="mt-2 text-[10px] text-red-300" data-testid="download-source-error">{videoError}</p>}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={startDownload}
              disabled={!selectedItem || status.phase === 'downloading'}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-[13px] font-bold text-[#171717] transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/35"
              data-testid="download-final"
            >
              {status.phase === 'downloading'
                ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Download className="h-4 w-4" aria-hidden="true" />}
              {status.phase === 'downloading' ? t('download.panel.downloading') : t('download.panel.downloadSelected')}
            </button>
            {status.phase === 'downloading' && (
              <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/15" data-testid="download-progress">
                <div
                  className="h-full bg-white transition-[width] duration-200"
                  style={{ width: status.percent === null ? '40%' : `${status.percent}%` }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={status.percent ?? undefined}
                />
              </div>
            )}
            {status.phase === 'done' && <p className="mt-2 text-[11px] text-emerald-400" data-testid="download-status">{t('download.panel.downloadDone')}</p>}
            {status.phase === 'error' && <p className="mt-2 text-[11px] text-red-300" data-testid="download-status">{t('download.panel.downloadFailed', { message: status.message || '' })}</p>}
          </div>

          <div className="mb-2 mt-5 flex items-center justify-between">
            <h2 id="download-subtitles-heading" className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{t('download.panel.subtitlesTitle')}</h2>
            <span className="text-[10px] text-white/35">{visibleSubtitles.length}</span>
          </div>
          <label className="relative block">
            <span className="sr-only">{t('download.panel.subtitlesSearch')}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
            <input
              type="search"
              value={subtitleSearch}
              onChange={(event) => setSubtitleSearch(event.target.value)}
              placeholder={t('download.panel.subtitlesSearch')}
              className="h-10 w-full rounded-t-[14px] border border-white/[0.09] bg-transparent pl-10 pr-3 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-white/20"
              data-testid="download-subtitle-search"
            />
          </label>

          {providerErrors.length > 0 && (
            <div className="border-x border-white/[0.09] px-3 py-2 text-[10px] text-red-300/75">
              {providerErrors.map((error) => <p key={`${error.provider}:${error.message}`}>{error.message}</p>)}
            </div>
          )}

          <div className="max-h-[180px] overflow-y-auto rounded-b-[14px] border-x border-b border-white/[0.09]" data-testid="download-subtitle-list">
            {subtitlesLoading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-white/40">
                <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{t('download.fetchingLinks')}
              </div>
            ) : visibleSubtitles.length > 0 ? (
              visibleSubtitles.map((track: SubtitleTrack, index: number) => {
                const active = selection?.kind === 'subtitle' && selection.id === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelection({ kind: 'subtitle', id: track.id }); setStatus(EMPTY_STATUS); }}
                    className={`flex min-h-[40px] w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-white/[0.045] ${index ? 'border-t border-white/[0.07]' : ''} ${active ? 'bg-white/[0.06]' : ''}`}
                    data-testid="download-subtitle-option"
                    data-language={track.lang}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-white/85">{track.label || track.lang}</span>
                      <span className="block text-[9px] uppercase tracking-wide text-white/30">{track.lang} · {track.format}</span>
                    </span>
                    <Download className="h-3.5 w-3.5 shrink-0 text-white/30" aria-hidden="true" />
                  </button>
                );
              })
            ) : (
              <p className="p-4 text-[11px] text-white/40" data-testid="download-subtitle-empty">
                {subtitleSearch ? t('download.panel.noSubtitlesFiltered') : t('download.panel.noSubtitles')}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};

export default DownloadPage;
