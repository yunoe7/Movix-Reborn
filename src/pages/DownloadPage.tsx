import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { AlertCircle, ArrowLeft, Check, Download, Loader, Search, Star } from 'lucide-react';
import CompleteImage from '@/components/media/CompleteImage';
import { listDownloadLinks, type AdminDownloadLink } from '@/services/downloadLinksService';
import { useExternalSubtitles } from '@/hooks/useExternalSubtitles';
import type { SubtitleTrack } from '@/services/subtitles';
import { getTmdbLanguage } from '@/i18n';
import { getTmdbImageUrl } from '@/utils/tmdbImages';

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
  const [searchParams, setSearchParams] = useSearchParams();

  const [details, setDetails] = useState<TitleDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsError, setDetailsError] = useState('');

  const seasonParam = Number(searchParams.get('season'));
  const episodeParam = Number(searchParams.get('episode'));
  const [season, setSeason] = useState(Number.isFinite(seasonParam) && seasonParam > 0 ? seasonParam : 1);
  const [episode, setEpisode] = useState(Number.isFinite(episodeParam) && episodeParam > 0 ? episodeParam : 1);
  const [fullSeason, setFullSeason] = useState(searchParams.get('fullSeason') === 'true');

  const [videoSources, setVideoSources] = useState<VideoSource[]>([]);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState('');

  const [subtitleSearch, setSubtitleSearch] = useState('');
  const [languageFilter, setLanguageFilter] = useState('all');
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
        setVideoSources(Array.isArray(links) ? links.map(toVideoSource).filter((source) => source.url) : []);
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

  const seasonOptions = useMemo(
    () => (details?.seasons || []).filter((item) => item.season_number > 0),
    [details],
  );
  const selectedSeason = seasonOptions.find((item) => item.season_number === season);
  const episodeCount = selectedSeason?.episode_count || 0;

  const languageOptions = useMemo(
    () => [...new Set(tracks.map((track) => track.lang).filter(Boolean))].sort(),
    [tracks],
  );
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

  const updateParams = useCallback((next: { season?: number; episode?: number; fullSeason?: boolean }) => {
    const params = new URLSearchParams(searchParams);
    if (next.season !== undefined) params.set('season', String(next.season));
    if (next.episode !== undefined) params.set('episode', String(next.episode));
    if (next.fullSeason !== undefined) {
      if (next.fullSeason) params.set('fullSeason', 'true');
      else params.delete('fullSeason');
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

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
  const poster = getTmdbImageUrl(details?.poster_path, {
    kind: 'poster',
    quality: 'high',
    role: 'detail',
    width: 500,
  });
  const year = (details?.release_date || details?.first_air_date || '').slice(0, 4);
  const runtime = type === 'movie' && details?.runtime
    ? `${Math.floor(details.runtime / 60)}h ${String(details.runtime % 60).padStart(2, '0')}min`
    : type === 'tv' && details?.episode_run_time?.[0]
      ? `${details.episode_run_time[0]}${t('details.minutes')}`
      : '';

  return (
    <main className="min-h-screen bg-black px-4 pb-20 pt-6 text-white sm:px-8 lg:px-16" data-testid="download-panel">
      <div className="mx-auto w-full max-w-6xl min-w-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          aria-label={t('download.panel.back')}
          data-testid="download-back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('download.panel.back')}
        </button>

        <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end" data-testid="download-header">
          <div className="h-56 w-40 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#171719] sm:h-64 sm:w-44">
            <CompleteImage src={poster} alt={title} fit="contain" ambient loading="eager" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-white/45">{t('download.panel.eyebrow')}</p>
            <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-5xl">{title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/65">
              {typeof details?.vote_average === 'number' && details.vote_average > 0 && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
                  <Star className="h-4 w-4 fill-amber-400" aria-hidden="true" />
                  {details.vote_average.toFixed(1)}/10
                </span>
              )}
              {year && <span>{year}</span>}
              {runtime && <span>{runtime}</span>}
              {type === 'tv' && details?.number_of_seasons ? <span>{details.number_of_seasons} {t('details.seasonsLabel')}</span> : null}
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/50">{t('download.panel.subtitle')}</p>
          </div>
        </header>

        {detailsLoading && (
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#121214] p-5 text-sm text-white/60">
            <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('download.loadingDetails')}
          </div>
        )}
        {detailsError && (
          <div className="mb-8 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200" role="alert">
            {t('download.errorLoadingDetails')}: {detailsError}
          </div>
        )}

        {type === 'tv' && (
          <section className="mb-8 grid gap-3 rounded-2xl border border-white/10 bg-[#121214] p-4 sm:grid-cols-3" aria-label={t('download.season')}>
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
              {t('download.season')}
              <select
                value={season}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setSeason(value);
                  setEpisode(1);
                  updateParams({ season: value, episode: 1 });
                }}
                className="h-11 rounded-xl border border-white/15 bg-black px-3 text-sm font-normal normal-case tracking-normal text-white"
                data-testid="download-season"
              >
                {(seasonOptions.length ? seasonOptions : [{ season_number: 1 }]).map((item) => (
                  <option key={item.season_number} value={item.season_number}>
                    {item.season_number}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
              {t('download.episode')}
              {episodeCount > 0 && !fullSeason ? (
                <select
                  value={episode}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setEpisode(value);
                    updateParams({ episode: value });
                  }}
                  className="h-11 rounded-xl border border-white/15 bg-black px-3 text-sm font-normal normal-case tracking-normal text-white"
                  data-testid="download-episode"
                >
                  {Array.from({ length: episodeCount }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={episode}
                  disabled={fullSeason}
                  onChange={(event) => {
                    const value = Math.max(1, Number(event.target.value) || 1);
                    setEpisode(value);
                    updateParams({ episode: value });
                  }}
                  className="h-11 rounded-xl border border-white/15 bg-black px-3 text-sm font-normal normal-case tracking-normal text-white disabled:opacity-40"
                  data-testid="download-episode"
                />
              )}
            </label>

            <label className="flex items-end gap-3 pb-3 text-sm text-white/70">
              <input
                type="checkbox"
                checked={fullSeason}
                onChange={(event) => {
                  const value = event.target.checked;
                  setFullSeason(value);
                  updateParams({ fullSeason: value });
                }}
                className="h-4 w-4 accent-white"
                data-testid="download-full-season"
              />
              {t('download.fullSeason')}
            </label>
          </section>
        )}

        <section className="mb-10" aria-labelledby="download-video-heading" data-testid="download-video-section">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="download-video-heading" className="text-xl font-bold">{t('download.panel.videoTitle')}</h2>
            <span className="text-xs text-white/40">{videoSources.length}</span>
          </div>

          {videoLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#121214] p-5 text-sm text-white/60">
              <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('download.fetchingLinks')}
            </div>
          ) : videoSources.length > 0 ? (
            <div className="grid gap-3" data-testid="download-video-list">
              {videoSources.map((source) => {
                const active = selection?.kind === 'video' && selection.id === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelection({ kind: 'video', id: source.id }); setStatus(EMPTY_STATUS); }}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${active ? 'border-white bg-white/[0.09]' : 'border-white/10 bg-[#151517] hover:border-white/25'}`}
                    data-testid="download-video-option"
                    data-quality={source.quality || ''}
                    data-size={source.size || ''}
                    data-codec={source.codec || ''}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        {active && <Check className="h-4 w-4 text-amber-400" aria-hidden="true" />}
                        <span className="truncate">{source.host || t('download.panel.fromSource', { source: 'Movix' })}</span>
                      </span>
                      {source.fullSeason && <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-white/60">{t('download.fullSeason')}</span>}
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-4">
                      <span>{t('download.panel.qualityLabel')} : <b className="text-white/85">{source.quality || t('download.panel.notProvided')}</b></span>
                      <span>{t('download.panel.codecLabel')} : <b className="text-white/85">{source.codec || t('download.panel.notProvided')}</b></span>
                      <span>{t('download.panel.sizeLabel')} : <b className="text-white/85">{source.size || t('download.panel.notProvided')}</b></span>
                      <span>{t('download.panel.languageLabel')} : <b className="text-white/85">{source.language || t('download.panel.notProvided')}</b></span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#121214] p-6" data-testid="download-video-empty">
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
                <div>
                  <h3 className="font-semibold text-white">{t('download.panel.noVideo')}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">{t('download.panel.videoUnavailableDesc')}</p>
                  {videoError && (
                    <p className="mt-3 text-xs text-white/35" data-testid="download-source-error">
                      {t('download.panel.sourceError')} ({videoError})
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="mb-10" aria-labelledby="download-subtitles-heading" data-testid="download-subtitles-section">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="download-subtitles-heading" className="text-xl font-bold">{t('download.panel.subtitlesTitle')}</h2>
            <span className="text-xs text-white/40">{visibleSubtitles.length}/{tracks.length}</span>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <label className="relative block">
              <span className="sr-only">{t('download.panel.subtitlesSearch')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
              <input
                type="search"
                value={subtitleSearch}
                onChange={(event) => setSubtitleSearch(event.target.value)}
                placeholder={t('download.panel.subtitlesSearch')}
                className="h-11 w-full rounded-xl border border-white/15 bg-[#151517] pl-10 pr-3 text-sm text-white placeholder:text-white/35"
                data-testid="download-subtitle-search"
              />
            </label>
            <select
              value={languageFilter}
              onChange={(event) => setLanguageFilter(event.target.value)}
              aria-label={t('download.panel.allLanguages')}
              className="h-11 rounded-xl border border-white/15 bg-[#151517] px-3 text-sm text-white"
              data-testid="download-subtitle-language"
            >
              <option value="all">{t('download.panel.allLanguages')}</option>
              {languageOptions.map((lang) => <option key={lang} value={lang}>{lang.toUpperCase()}</option>)}
            </select>
          </div>

          {providerErrors.length > 0 && (
            <div className="mb-4 space-y-1 text-xs text-white/40">
              {providerErrors.map((error) => (
                <p key={`${error.provider}:${error.message}`} data-testid="download-provider-error">
                  {t('download.panel.providerError', { provider: error.provider, message: error.message })}
                </p>
              ))}
            </div>
          )}

          {subtitlesLoading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#121214] p-5 text-sm text-white/60">
              <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('download.fetchingLinks')}
            </div>
          ) : visibleSubtitles.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2" data-testid="download-subtitle-list">
              {visibleSubtitles.map((track: SubtitleTrack) => {
                const active = selection?.kind === 'subtitle' && selection.id === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setSelection({ kind: 'subtitle', id: track.id }); setStatus(EMPTY_STATUS); }}
                    className={`rounded-xl border p-4 text-left transition-colors ${active ? 'border-white bg-white/[0.09]' : 'border-white/10 bg-[#151517] hover:border-white/25'}`}
                    data-testid="download-subtitle-option"
                    data-language={track.lang}
                  >
                    <div className="flex items-start gap-2">
                      {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{track.label}</p>
                        <p className="mt-1 text-xs text-white/45">
                          {track.lang.toUpperCase()} · {track.format.toUpperCase()} · {track.provider}
                          {typeof track.downloads === 'number' ? ` · ${t('download.panel.downloads', { count: track.downloads })}` : ''}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#121214] p-6 text-sm text-white/50" data-testid="download-subtitle-empty">
              {subtitleSearch || languageFilter !== 'all'
                ? t('download.panel.noSubtitlesFiltered')
                : t('download.panel.noSubtitles')}
            </div>
          )}
        </section>

        <section className="sticky bottom-4 rounded-2xl border border-white/10 bg-[#101012]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur" aria-label={t('download.panel.downloadSelected')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              {selectedItem ? (
                <>
                  <p className="font-semibold text-white">{t('download.panel.selected')}</p>
                  <p className="truncate text-white/50">{selectedSubtitle?.label || selectedVideo?.host || selectedVideo?.id}</p>
                </>
              ) : (
                <p className="text-white/45">{t('download.panel.selectHint')}</p>
              )}
            </div>
            <button
              type="button"
              onClick={startDownload}
              disabled={!selectedItem || status.phase === 'downloading'}
              className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-bold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-black/45"
              data-testid="download-final"
            >
              {status.phase === 'downloading'
                ? <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Download className="h-4 w-4" aria-hidden="true" />}
              {status.phase === 'downloading' ? t('download.panel.downloading') : t('download.panel.downloadSelected')}
            </button>
          </div>

          {status.phase !== 'idle' && (
            <div className="mt-3" aria-live="polite">
              {status.phase === 'downloading' && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" data-testid="download-progress">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-[width] duration-200"
                    style={{ width: status.percent === null ? '45%' : `${status.percent}%` }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={status.percent ?? undefined}
                  />
                </div>
              )}
              {status.percent !== null && status.phase === 'downloading' && (
                <p className="mt-1 text-xs text-white/45">{t('download.panel.progress', { percent: status.percent })}</p>
              )}
              {status.phase === 'done' && <p className="text-xs text-emerald-400" data-testid="download-status">{t('download.panel.downloadDone')}</p>}
              {status.phase === 'error' && (
                <p className="text-xs text-red-300" data-testid="download-status">
                  {t('download.panel.downloadFailed', { message: status.message || '' })}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};

export default DownloadPage;
