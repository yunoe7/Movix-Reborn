import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import axios from 'axios';
import { Loader, Video, Star, Calendar, List, Check, ChevronRight, AlertTriangle, Play, X, Download, Shield, EyeOff, Sparkles, Tv, Search, ArrowDownUp, LayoutGrid } from '../components/icons/Icons8';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import AddToListButton from '../components/AddToListButton';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';

import CustomDropdown from '../components/CustomDropdown';
import { useAdFreePopup } from '../context/AdFreePopupContext';
import AlertButton from '../components/AlertButton';
import {
  searchWithFallback,
  getSearchNameForId,
  getAnimeMatcherForId,
  shouldHideAnimeModeForId,
  shouldDefaultAnimeModeToOff,
} from '../utils/searchUtils';
import { isLikelyAnime, type TmdbKeywordsResponse } from '../utils/animeSignals';
import { loadDetailCharacters, type DetailCharacters } from '../services/detailCharacters';
import { normalizeAlternateTitles, normalizeKeywords } from '../utils/tmdbMetadata';
import { rememberMedia } from '../utils/mediaSearchIndex';
import {
  pickBestAnimeMatch,
  collectTmdbNames,
  type AnimeSamaCandidate,
} from '../utils/animeMatcher';
import { fetchAnimeByTmdb } from '../services/animeSamaService';
import { encodeId, getTmdbId } from '../utils/idEncoder';
import AntiSpoilerSettingsModal from '../components/AntiSpoilerSettings';
import { useAntiSpoilerSettings } from '../hooks/useAntiSpoilerSettings';
import { buildSiteUrl } from '../config/runtime';
import LikeDislikeButton, { type LikeDislikeStats } from '../components/LikeDislikeButton';
import MovixRatingInfoModal from '../components/MovixRatingInfoModal';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import SEO from '../components/SEO';
import { getTmdbLanguage } from '../i18n';
import i18n from '../i18n';
import { useProfile } from '../context/ProfileContext';
import DetailHero from '../components/details/DetailHero';
import DetailCastRail from '../components/details/DetailCastRail';
import DetailRecommendations from '../components/details/DetailRecommendations';
import DetailComments from '../components/details/DetailComments';
import CompleteImage from '../components/media/CompleteImage';
import type { Media } from '../components/EmblaCarousel';
import { getClassificationLabel as getClassificationLabelUtil, isContentAllowed } from '../utils/certificationUtils';
import { useTvAiringSchedule } from '@/hooks/useTvAiringSchedule';
import {
  EPISODE_LIST_SOURCE_EVENT,
  episodeListChoice,
  getDefaultEpisodeListSource,
  getShowEpisodeList,
  resolveEpisodeList,
  groupTvmazeSeasons,
  isTvmazeListDifferent,
  setEpisodeListSource,
  type EpisodeListKind,
  type ShowEpisodeLists,
} from '@/utils/tvmazeEpisodes';
import { formatAiringDate, getAiringLabel, getEpisodeTimeline, resolveEpisodeAiring, resolveShowAiring } from '@/utils/tvAiring';
import type { TvEpisodeDate, TvExternalIds } from '@/types/tvAiring';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useImageQuality, useImageViewport } from '../hooks/useImageQuality';
import { useImageSlot } from '../hooks/useImageSlot';
import { getCoverImageWidth, getTmdbImageProps, getTmdbImageUrl } from '../utils/tmdbImages';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { useTitleHistory } from '../hooks/useTitleHistory';
import { mergeEpisode, seedProgress, serverEpisodeMap, seriesFullyMarked, seriesResume } from '../utils/titleHistoryMerge';

const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

interface TVShow {
  id?: string | number;
  name: string;
  original_name?: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  first_air_date: string;
  external_ids?: TvExternalIds;
  vote_average: number;
  genres: { id: number; name: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: Array<{
    season_number: number;
    name: string;
    poster_path: string | null;
    air_date: string | null;
    episode_count: number;
  }>;
  status?: string;
  type?: string;
  episode_run_time?: number[];
  networks?: { id: number; name: string; logo_path: string | null }[];
  popularity?: number;
  in_production?: boolean;
  last_air_date?: string;
  last_episode_to_air?: {
    air_date: string;
    episode_number: number;
    season_number: number;
    name: string;
  };
  next_episode_to_air?: {
    air_date: string;
    episode_number: number;
    season_number: number;
    name: string;
  } | null;
  onIgnore?: () => void;
  tvShow?: {
    name: string;
    backdrop_path: string;
  } | null;
  nextEpisode?: {
    seasonNumber: number;
    episodeNumber: number;
    name?: string;
    overview?: string;
  } | null;
  onNextEpisode?: (seasonNumber: number, episodeNumber: number) => void;
  movieId?: string;  // ID TMDB du film
  tvShowId?: string; // ID TMDB de la série
  seasonNumber?: number;
  episodeNumber?: number;
}

interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface GroupedCrewMember {
  id: number;
  name: string;
  jobs: string[];
  profile_path: string | null;
}

interface WatchStatus {
  watchlist: boolean;
  favorite: boolean;
  watched: boolean;
  episodeWatchlist: { [key: string]: boolean };
  episodeWatched: { [key: string]: boolean };
}

interface CrewMember {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}

interface Episode {
  sa: string | number;
  epi: string | number;
  link?: string;
}

const DEFAULT_IMAGE = 'https://www.shutterstock.com/image-vector/default-image-icon-vector-missing-600nw-2079504220.jpg';

// Constante pour activer/désactiver la vérification VIP pour le bouton download
const ENABLE_VIP_DOWNLOAD_CHECK = false;

interface TMDBImage {
  aspect_ratio: number;
  file_path: string;
  height: number;
  iso_639_1: string | null;
  vote_average: number;
  vote_count: number;
  width: number;
}

// Use shared certification utility
const getClassificationLabel = getClassificationLabelUtil;

const getAnimeLanguageLabel = (language: string, t: TFunction): string =>
  t(`details.languages.${language.toLowerCase()}`, { defaultValue: language.toUpperCase() });

interface AnimeEpisodeImageData {
  name?: string | null;
  streaming_links?: Array<{ language?: string | null }> | null;
  still_path?: string | null;
  still_url?: string | null;
  tmdb_episode_number?: number | string | null;
  tmdbEpisodeNumber?: number | string | null;
  episode_number?: number | string | null;
  episodeNumber?: number | string | null;
  index?: number | string | null;
}

interface AnimeSeasonImageData {
  name?: string | null;
  poster_path?: string | null;
  posterPath?: string | null;
  image?: string | null;
  available?: boolean;
  status?: string;
  number?: number | string | null;
  season_number?: number | string | null;
  seasonNumber?: number | string | null;
  episodes?: AnimeEpisodeImageData[];
}

interface AnimeImageData {
  seasons?: readonly unknown[];
}

const getSeasonDisplayName = (
  seasonNumber: number,
  t: TFunction,
  originalName?: string
) => originalName || `${t('details.season')} ${seasonNumber}`;

// 1. Update DEFAULT_IMAGE to a custom SVG string for fallback
const getSeasonFallbackSvg = (label: string) =>
  `data:image/svg+xml;utf8,<svg width="500" height="750" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="%23222"/><g><rect x="80" y="180" width="340" height="260" rx="32" fill="%23333" stroke="%23555" stroke-width="8"/><rect x="120" y="220" width="260" height="180" rx="16" fill="%23444"/><rect x="180" y="420" width="140" height="20" rx="8" fill="%23555"/></g><text x="50%" y="70%" fill="%23777" font-size="48" font-family="Arial, sans-serif" text-anchor="middle" dy=".3em">${encodeURIComponent(label)}</text></svg>`;

type SeasonPosterSource = {
  number?: number;
  poster_path?: string | null;
  posterPath?: string | null;
  image?: string | null;
};

/** Première source d'image utilisable, sans confondre les chemins TMDB et les URL complètes. */
const firstNonEmptyImage = (...sources: Array<string | null | undefined>): string | null =>
  sources.find((source) => typeof source === 'string' && source.trim().length > 0)?.trim() ?? null;

// Résumé d'épisode replié sur deux lignes. « Voir plus » n'apparaît que si
// le texte dépasse vraiment ces deux lignes (mesuré, pas deviné).
const EpisodeOverview = ({ text, expanded, onToggle, t }: {
  text: string;
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  t: TFunction;
}) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
      setOverflows(el.offsetHeight > lineHeight * 2 + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div className="mt-2 relative">
      <motion.div
        initial={false}
        animate={{ height: expanded || !overflows ? 'auto' : '2.5rem' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="overflow-hidden"
      >
        <p ref={textRef} className="text-sm leading-5 text-white/70">{text}</p>
      </motion.div>
      {overflows && (
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-red-400 hover:text-red-300 mt-1 flex items-center"
        >
          {expanded ? t('details.seeLess') : t('details.seeMore')}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 h-3 w-3">
            <polyline points={expanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}></polyline>
          </svg>
        </button>
      )}
    </div>
  );
};

// Composant pour une image avec lazy loading

// Composant pour la section Images des séries TV

// Episode progress functionality removed

const groupCrewMembers = (crew: CrewMember[]): GroupedCrewMember[] => {
  const groupedMap = crew.reduce((acc, member) => {
    if (!acc.has(member.id)) {
      acc.set(member.id, {
        id: member.id,
        name: member.name,
        jobs: [member.job],
        profile_path: member.profile_path
      });
    } else {
      const existing = acc.get(member.id)!;
      if (!existing.jobs.includes(member.job)) {
        existing.jobs.push(member.job);
      }
    }
    return acc;
  }, new Map<number, GroupedCrewMember>());

  return Array.from(groupedMap.values());
};

// Sur certains réseaux (proxy FAI / cache CloudFront), la réponse fr-FR d'une
// saison arrive corrompue : le corps n'est ni du JSON ni du gzip valide, donc
// `episodes` est absent (symptôme : "Pas d'épisodes" sur PC, OK sur mobile).
// On bascule alors sur l'objet en-US — clé de cache CDN différente, donc
// généralement saine. Numéros d'épisode et dates sont indépendants de la langue.
const fetchSeasonDetails = async (
  showId: string | number | null | undefined,
  season: number
): Promise<any | null> => {
  const base = `https://api.themoviedb.org/3/tv/${showId}/season/${season}?api_key=${TMDB_API_KEY}`;
  const langs = [...new Set([getTmdbLanguage(), 'en-US'])];
  for (const lang of langs) {
    try {
      const { data } = await axios.get(`${base}&language=${lang}`);
      if (data && Array.isArray(data.episodes)) return data;
    } catch (error) {
      // Un 404 signifie que cette saison n'existe pas pour la série :
      // changer de langue ne peut pas rendre la ressource disponible.
      if (axios.isAxiosError(error) && error.response?.status === 404) return null;
      // erreur réseau / décodage : on tente la langue suivante
    }
  }
  return null;
};

const TVDetails: React.FC = () => {
  const { t } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const { width: viewportWidth, height: viewportHeight, dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, effectiveImageQuality === 'high' ? 3 : 2);
  const [, setShow] = useState<any>(null);
  const [, setIsLoading] = useState(true);
  const { id: encodedId } = useParams<{ id: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProfile } = useProfile();

  // Track page visit for Movix Wrapped
  useWrappedTracker({
    mode: 'page',
    pageData: id ? { pageName: 'tv-details', contentId: id } : undefined,
  });
  const [searchParams] = useSearchParams();
  const [tvShow, setTVShow] = useState<TVShow | null>(null);
  const { schedule: airingSchedule, now: airingNow } = useTvAiringSchedule(
    id, String(tvShow?.id) === id ? tvShow?.external_ids : undefined,
  );
  const [, setMovixVoteStats] = useState<LikeDislikeStats>({ likes: 0, dislikes: 0 });
  const [showMovixRatingInfo, setShowMovixRatingInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bestBackdrop, setBestBackdrop] = useState<TMDBImage | null>(null);
  const [showTrailerPopup, setShowTrailerPopup] = useState(false);
  const [trailerVideo, setTrailerVideo] = useState<any>(null);
  const [isClosingTrailer, setIsClosingTrailer] = useState(false);

  useEffect(() => {
    setMovixVoteStats({ likes: 0, dislikes: 0 });
  }, [id]);

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  // const [_trailerVideoId, _setTrailerVideoId] = useState<string | null>(null);

  // Refs replacing document.getElementById/querySelector lookups for season/episode UI
  const seasonsSectionRef = useRef<HTMLDivElement | null>(null);
  const episodesSectionRef = useRef<HTMLDivElement | null>(null);
  const dropdownToggleButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleCloseTrailer = () => {
    setIsClosingTrailer(true);
    setTimeout(() => {
      setShowTrailerPopup(false);
      setIsClosingTrailer(false);
    }, 300);
  };

  const handleCloseVideo = () => {
    setIsClosingVideo(true);
    setTimeout(() => {
      setShowVideoPopup(false);
      setIsClosingVideo(false);
    }, 300);
  };
  const [cast, setCast] = useState<CastMember[]>([]);
  const [, setCrew] = useState<GroupedCrewMember[]>([]);
  const [, setShowCast] = useState(false);
  const [, setShowCrew] = useState(false);
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({
    watchlist: false,
    favorite: false,
    watched: false,
    episodeWatchlist: {},
    episodeWatched: {}
  });

  const cinemaMode = true;

  // Anti-spoiler settings
  const {
    settings: antiSpoilerSettings,
    updateSettings: updateAntiSpoilerSettings,
    shouldHide,
    getMaskedContent,
    hasActiveSpoilerProtection: _hasActiveSpoilerProtection
  } = useAntiSpoilerSettings();
  const [showAntiSpoilerModal, setShowAntiSpoilerModal] = useState(false);
  // Add this effect to initialize watchlist state from localStorage
  useEffect(() => {
    // Check if the current TV show ID is in the watchlist_tv localStorage
    if (id) {
      try {
        const storageKey = 'watchlist_tv';
        const typeWatchlist = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const exists = typeWatchlist.some((media: any) => media.id === Number(id));

        if (exists) {
          // Update watchStatus if the show is in the watchlist
          setWatchStatus(prev => ({
            ...prev,
            watchlist: true
          }));
        }
      } catch (error) {
        console.error('Error checking watchlist status:', error);
      }
    }
  }, [id]);

  const [, setIsAvailable] = useState<boolean>(true);
  const [recommendations, setRecommendations] = useState<(TVShow & { isAvailable?: boolean })[]>([]);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [recommendationsLoaded, setRecommendationsLoaded] = useState<boolean>(false);
  const [animeMode, setAnimeMode] = useState<boolean>(false);
  // Anime presentation controls are separate from the optional Anime-Sama playback mode.
  const [animeEpisodeSearchOpen, setAnimeEpisodeSearchOpen] = useState(false);
  const [animeEpisodeSearch, setAnimeEpisodeSearch] = useState('');
  const [animeEpisodeSortDescending, setAnimeEpisodeSortDescending] = useState(false);
  const [animeEpisodeView, setAnimeEpisodeView] = useState<'list' | 'grid'>('list');
  const [seasonPickerOpen, setSeasonPickerOpen] = useState(false);
  const seasonPickerMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!seasonPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (seasonPickerMenuRef.current && !seasonPickerMenuRef.current.contains(event.target as Node)) {
        setSeasonPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [seasonPickerOpen]);
  const [animeData, setAnimeData] = useState<any>(null);
  const [loadingAnimeData, setLoadingAnimeData] = useState<boolean>(false);
  const [tmdbKeywords, setTmdbKeywords] = useState<TmdbKeywordsResponse | null>(null);
  const [characters, setCharacters] = useState<DetailCharacters | null>(null);
  const [, setCharactersLoading] = useState(false);
  const [fullCast, setFullCast] = useState<Array<{ id: number; name: string; character?: string; profile_path?: string | null }>>([]);
  const [tmdbEnglishName, setTmdbEnglishName] = useState<string | null>(null);
  const [tmdbAlternativeTitles, setTmdbAlternativeTitles] = useState<
    Array<{ iso_3166_1?: string; title?: string }>
  >([]);
  const [, setSelectedAnimeEpisode] = useState<any>(null);
  const [, setSelectedLanguage] = useState<string | null>(null);
  const [, setSelectedPlayer] = useState<string | null>(null);
  // Ajout de l'état pour stocker les détails complets des saisons et épisodes
  const [tmdbSeasonsDetails, setSeasonsDetails] = useState<Record<number, any>>({});
  // Liste TVmaze (ex. 21 chapitres au lieu de 10 épisodes) ou découpage
  // Netflix (ex. les 5 parties de La Casa de Papel) selon le choix. Le reste
  // de la page lit `seasonsDetails`.
  const [episodeListChoiceVersion, setEpisodeListChoiceVersion] = useState(0);
  useEffect(() => {
    const sync = () => setEpisodeListChoiceVersion((version) => version + 1);
    window.addEventListener(EPISODE_LIST_SOURCE_EVENT, sync);
    return () => window.removeEventListener(EPISODE_LIST_SOURCE_EVENT, sync);
  }, []);
  const tmdbEpisodeCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const season of tvShow?.seasons ?? []) counts[season.season_number] = season.episode_count ?? 0;
    return counts;
  }, [tvShow]);
  const scheduleMatches = String(tvShow?.id) === id;
  const tvmazeEpisodeList = scheduleMatches ? airingSchedule?.episodeList : undefined;
  const netflixEpisodeList = scheduleMatches ? airingSchedule?.netflixEpisodeList : undefined;
  const episodeLists = useMemo<ShowEpisodeLists>(() => ({
    tmdbCounts: tmdbEpisodeCounts,
    tvmaze: tvmazeEpisodeList,
    netflix: netflixEpisodeList,
    onNetflix: scheduleMatches && !!airingSchedule?.onNetflix,
  }), [tmdbEpisodeCounts, tvmazeEpisodeList, netflixEpisodeList, scheduleMatches, airingSchedule]);
  // Relu à chaque rendu : `episodeListChoiceVersion` en provoque un quand le choix change.
  void episodeListChoiceVersion;
  const episodeListKind = getShowEpisodeList(id, episodeLists);
  const tvmazeSeasons = useMemo(
    () => tvmazeEpisodeList?.length ? groupTvmazeSeasons(tvmazeEpisodeList) : null,
    [tvmazeEpisodeList],
  );
  const netflixSeasons = useMemo(
    () => netflixEpisodeList?.length ? groupTvmazeSeasons(netflixEpisodeList) : null,
    [netflixEpisodeList],
  );
  // Deux sélecteurs, chacun visible seulement si sa liste diffère de TMDB :
  // au-dessus des saisons, TMDB ou Netflix ; au-dessus des épisodes (hors
  // Netflix), TVmaze ou TMDB, même quand le filtre écarte TVmaze.
  const hasNetflixLayout = !!netflixSeasons && isTvmazeListDifferent(tmdbEpisodeCounts, netflixEpisodeList);
  const usesNetflixLayout = episodeListKind === 'netflix';
  const episodeListOptions = useMemo<EpisodeListKind[]>(
    () => !usesNetflixLayout && tvmazeSeasons && isTvmazeListDifferent(tmdbEpisodeCounts, tvmazeEpisodeList)
      ? ['tvmaze', 'tmdb'] : [],
    [usesNetflixLayout, tvmazeSeasons, tmdbEpisodeCounts, tvmazeEpisodeList],
  );
  const chooseEpisodeList = (kind: EpisodeListKind) => {
    if (!id) return;
    // Si le choix global donne déjà ce résultat, on retire l'exception.
    setEpisodeListSource(id, episodeListChoice(kind, episodeLists));
  };
  // Quitter Netflix revient à la liste du choix global (TVmaze ou TMDB).
  const chooseSeasonLayout = (netflix: boolean) =>
    chooseEpisodeList(netflix ? 'netflix' : resolveEpisodeList(getDefaultEpisodeListSource(), episodeLists));
  const activeListSeasons = episodeListKind === 'netflix' ? netflixSeasons : episodeListKind === 'tvmaze' ? tvmazeSeasons : null;
  const seasonsDetails = useMemo<Record<number, any>>(() => {
    if (!activeListSeasons) return tmdbSeasonsDetails;
    // Le découpage Netflix remplace toutes les saisons TMDB (ex. la saison 0
    // de La Casa de Papel reprend les parties 1 et 2).
    const merged: Record<number, any> = episodeListKind === 'netflix' ? {} : { ...tmdbSeasonsDetails };
    for (const [season, episodes] of Object.entries(activeListSeasons)) {
      const number = Number(season);
      const tmdbSeason = tmdbSeasonsDetails[number];
      merged[number] = episodeListKind === 'netflix'
        ? { season_number: number, poster_path: tmdbSeason?.poster_path ?? null, air_date: episodes[0]?.air_date, episodes }
        : { ...(tmdbSeason ?? { season_number: number }), episodes };
    }
    return merged;
  }, [tmdbSeasonsDetails, activeListSeasons, episodeListKind]);
  // Cartes de saison : celles de TMDB, ou les parties Netflix.
  const seasonCards = useMemo<Array<{ season_number: number } & Record<string, any>>>(
    () => episodeListKind === 'netflix' && netflixSeasons
      ? Object.keys(netflixSeasons).map((season) => ({ season_number: Number(season) }))
      : tvShow?.seasons ?? [],
    [episodeListKind, netflixSeasons, tvShow],
  );
  const availableEpisodes = useMemo<Episode[]>(() => Object.entries(seasonsDetails).flatMap(([season, details]) =>
    (details.episodes ?? []).filter((episode: { episode_number: number; air_date?: string | null }) =>
      resolveEpisodeAiring({ ...episode, season_number: Number(season) }, airingSchedule, airingNow).kind === 'aired',
    ).map((episode: { episode_number: number }) => ({ sa: Number(season), epi: episode.episode_number })),
  ).sort((a, b) => Number(a.sa) - Number(b.sa) || Number(a.epi) - Number(b.epi)), [seasonsDetails, airingSchedule, airingNow]);
  // Ajoute ce state dans le composant principal, avant le return :
  // const [_collapsed, _setCollapsed] = useState(true);
  // Ajoute un état pour la gestion du popup "à venir"
  const [pendingEpisode, setPendingEpisode] = useState<{ season: number; episode: number } | null>(null);
  // Radix garde le contenu monté pendant la fermeture : conserver l'épisode affiché.
  const [isEpisodeWarningOpen, setEpisodeWarningOpen] = useState(false);
  // Ajoute les états pour les tabs et le scroll des tabs comme dans MovieDetails
  const [activeTab] = useState<'overview' | 'details' | 'videos' | 'images' | 'cast' | 'characters' | 'crew'>('overview');
  const detailsMediaSlot = useImageSlot(
    seasonsSectionRef,
    !loading && Boolean(tvShow) && activeTab === 'overview',
  );
  const [, setIsTabsScrollable] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  // Dans les états, ajoute un état pour le chargement des vidéos
  const [, setVideos] = useState<any[]>([]);
  const [, setLoadingVideos] = useState(false);
  const [selectedVideo] = useState<any | null>(null);
  const [showVideoPopup, setShowVideoPopup] = useState<boolean>(false);
  const [isClosingVideo, setIsClosingVideo] = useState(false);

  // États pour les vidéos multi-langues
  // États pour les vidéos multi-langues par saison
  const [, setSeasonMultiLangVideos] = useState<{ [key: number]: any[] }>({});  const [, setShowSeasonMultiLangView] = useState<{ [key: number]: boolean }>({});
  const [, setSeasonAutoMultiLang] = useState<{ [key: number]: boolean }>({});
  const [, setShowAnimeNotFoundMessage] = useState(false);
  // Ajoute ce state en haut du composant TVDetails, avec les autres useState :
  const [dropdownMode, setDropdownMode] = useState<boolean | null>(null); // null = utiliser le mode par défaut basé sur le nombre d'épisodes
  const [certifications, setCertifications] = useState<{ [key: string]: string }>({});
  // Ajout d'un état pour les vidéos par saison
  const [, setSeasonVideos] = useState<Record<number, any[]>>({});
  // Nouvel état pour suivre les images échouées
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  // Ajout de l'état pour le mode des statistiques financières  // Ajout de l'état pour gérer le survol des cartes de séries similaires
  const [isSimilarCardHovered] = useState(false);
  // Ajout d'une référence pour stocker le timeout d'unhover
  const hoverTimeoutRef = useRef<number | null>(null);
  // Ajout d'une référence pour le conteneur de cartes similaires
  const similarRowRef = useRef<HTMLDivElement>(null);
  // Référence pour la section commentaires
  const commentsRef = useRef<HTMLDivElement>(null);
  // État pour tracker quelle carte est survolée
  // const [_hoveredSimilarIndex, _setHoveredSimilarIndex] = useState<number | null>(null);
  // Ajout du state pour les cartes d'épisode élargies
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  // Mode cinéma toujours activé

  // Add resetVipStatus hook for the main component
  const { resetVipStatus } = useAdFreePopup();

  // Reset VIP status when the TV show ID changes
  useEffect(() => {
    resetVipStatus();
  }, [id, resetVipStatus]);

  // Fonction pour basculer l'état d'expansion d'une carte
  const toggleCardExpansion = (episodeKey: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCards(prev => ({
      ...prev,
      [episodeKey]: !prev[episodeKey]
    }));
  };

  // Fonction pour annuler le timeout existant si nécessaire
  const _clearHoverTimeout = () => {
    if (hoverTimeoutRef.current !== null) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };
  void _clearHoverTimeout;

  // Ajout du useEffect pour empêcher le scroll quand une carte est survolée
  useEffect(() => {
    const container = similarRowRef.current;
    if (!container) return;
    if (!isSimilarCardHovered) return; // Only applies when hovered

    // Prevent horizontal scroll but allow vertical scroll
    const preventScroll = (e: Event) => {
      if (e instanceof WheelEvent && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Prevent default only if the wheel event is predominantly horizontal
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      // If predominantly vertical or not a WheelEvent, allow default behavior (page scroll)
    };

    // Prevent keyboard scroll
    const preventKey = (e: KeyboardEvent) => {
      const keys = ['ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown', 'Home', 'End'];
      if (keys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    container.addEventListener('wheel', preventScroll, { passive: false });
    container.addEventListener('keydown', preventKey, { passive: false });

    return () => {
      container.removeEventListener('wheel', preventScroll);
      container.removeEventListener('keydown', preventKey);
    };
  }, [isSimilarCardHovered]); // Re-run when hover state changes

  useEffect(() => {
    const savedSeason = searchParams.get('season');
    const savedEpisode = searchParams.get('episode');

    if (savedSeason && savedEpisode) {
      setSelectedSeason(Number(savedSeason));
      setSelectedEpisode(Number(savedEpisode));
    }
  }, [searchParams]);

  // Watch status localStorage functionality removed

  useEffect(() => {
    const checkIfScrollable = () => {
      if (tabsContainerRef.current) {
        const { scrollWidth, clientWidth } = tabsContainerRef.current;
        setIsTabsScrollable(scrollWidth > clientWidth);
      }
    };
    checkIfScrollable();
    window.addEventListener('resize', checkIfScrollable);
    return () => window.removeEventListener('resize', checkIfScrollable);
  }, [tvShow]);

  const fetchTVShowDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVideos([]); // Reset general videos
    setSeasonVideos({}); // Reset season videos
    setLoadingVideos(true); // Start loading videos
    try {
      const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}`, {
        params: {
          api_key: TMDB_API_KEY,
          language: getTmdbLanguage(),
          append_to_response: 'credits,keywords,alternative_titles,external_ids'
          // Fetch videos separately now
        }
      });

      setTVShow(tmdbResponse.data);
      // Générique complet, pour la galerie de personnages.
      setFullCast(tmdbResponse.data?.credits?.cast ?? []);

      // Signaux pour la détection anime (keywords + alternative_titles viennent de append_to_response)
      setTmdbKeywords(tmdbResponse.data?.keywords ?? null);
      setTmdbAlternativeTitles(tmdbResponse.data?.alternative_titles?.results || []);

      // Nom anglais pour nourrir le matching anime (original_name est souvent en japonais/kanji)
      if (getTmdbLanguage() !== 'en-US') {
        axios
          .get(`https://api.themoviedb.org/3/tv/${id}`, {
            params: { api_key: TMDB_API_KEY, language: 'en-US' },
          })
          .then((r) => setTmdbEnglishName(r.data?.name ?? null))
          .catch(() => setTmdbEnglishName(null));
      } else {
        setTmdbEnglishName(tmdbResponse.data?.name ?? null);
      }

      // Récupérer les content ratings pour la classification
      try {
        const contentRatingsResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/content_ratings?api_key=${TMDB_API_KEY}`);
        const contentRatingsData = contentRatingsResponse.data.results;
        const newCertifications: { [key: string]: string } = {};

        // Chercher d'abord la classification française
        const frRating = contentRatingsData.find((r: any) => r.iso_3166_1 === 'FR');
        if (frRating && frRating.rating) {
          newCertifications['FR'] = frRating.rating;
        }

        // Si pas de classification française, chercher la classification américaine
        if (!newCertifications['FR']) {
          const usRating = contentRatingsData.find((r: any) => r.iso_3166_1 === 'US');
          if (usRating && usRating.rating) {
            newCertifications['US'] = usRating.rating;
          }
        }

        setCertifications(newCertifications);
      } catch (error) {
        console.error('Error fetching content ratings:', error);
        setCertifications({});
      }

      const newSeasonsDetails: Record<number, any> = {};
      const newSeasonVideos: Record<number, any[]> = {}; // Temporary storage for season videos

      // TMDB fournit la liste exacte des saisons disponibles. La saison 0
      // correspond aux spéciaux et n'existe pas pour toutes les séries.
      // Ne jamais fabriquer son numéro à partir de number_of_seasons.
      const listedSeasonNumbers = Array.from(new Set<number>(
        (Array.isArray(tmdbResponse.data.seasons) ? tmdbResponse.data.seasons : [])
          .map((season: { season_number?: unknown }) => season?.season_number)
          .filter((seasonNumber: unknown): seasonNumber is number =>
            typeof seasonNumber === 'number'
            && Number.isInteger(seasonNumber)
            && seasonNumber >= 0,
          ),
      )).sort((a, b) => a - b);

      // Filet de sécurité pour une réponse TMDB sans métadonnées de saisons :
      // number_of_seasons compte les saisons normales, qui commencent à 1.
      const seasonCount = Math.max(0, Number(tmdbResponse.data.number_of_seasons) || 0);
      const seasonNumbersToFetch = listedSeasonNumbers.length > 0
        ? listedSeasonNumbers
        : Array.from({ length: seasonCount }, (_, index) => index + 1);

      // Fetch general videos
      try {
        const generalVideosResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/videos`, {
          params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
        });
        let results = generalVideosResponse.data.results || [];
        if (results.length === 0) {
          const generalVideosResponseEN = await axios.get(`https://api.themoviedb.org/3/tv/${id}/videos`, {
            params: { api_key: TMDB_API_KEY, language: 'en-US' }
          });
          results = generalVideosResponseEN.data.results || [];
        }
        setVideos(results);
      } catch (error) {
        console.error('Error fetching general videos:', error);
        setVideos([]);
      }

      // Fetch season details and videos only for seasons actually listed by TMDB.
      const seasonPromises = [];
      for (const season of seasonNumbersToFetch) {
        seasonPromises.push(
          (async () => {
            try {
              // Fetch season details (bascule sur en-US si la réponse fr-FR est corrompue)
              const seasonData = await fetchSeasonDetails(id, season);
              if (!seasonData) {
                newSeasonVideos[season] = [];
                return;
              }
              newSeasonsDetails[season] = seasonData;

              // Fetch season videos
              try {
                // First try French only
                const seasonVideosResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}/videos`, {
                  params: {
                    api_key: TMDB_API_KEY,
                    language: getTmdbLanguage()
                  }
                });

                const frenchResults = seasonVideosResponse.data.results || [];

                // If no French videos, get all languages
                if (frenchResults.length === 0) {
                  const seasonVideosResponseAll = await axios.get(`https://api.themoviedb.org/3/tv/${id}/season/${season}/videos`, {
                    params: {
                      api_key: TMDB_API_KEY
                      // No language parameter = all languages
                    }
                  });
                  const allResults = seasonVideosResponseAll.data.results || [];
                  newSeasonVideos[season] = allResults;

                  // Mark this season as auto multi-lang if it has videos
                  if (allResults.length > 0) {
                    setSeasonAutoMultiLang(prev => ({ ...prev, [season]: true }));
                    setShowSeasonMultiLangView(prev => ({ ...prev, [season]: true }));
                    // Also store the multi-lang videos for immediate display
                    setSeasonMultiLangVideos(prev => ({ ...prev, [season]: allResults }));
                  }
                } else {
                  // Use French videos
                  newSeasonVideos[season] = frenchResults;
                  setSeasonAutoMultiLang(prev => ({ ...prev, [season]: false }));
                }
              } catch (videoError) {
                console.error(`Error fetching videos for season ${season}:`, videoError);
                newSeasonVideos[season] = []; // Default to empty array on error
              }

            } catch (error) {
              console.error(`Error fetching season ${season} details:`, error);
            }
          })()
        );
      }
      await Promise.all(seasonPromises); // Wait for all season fetches

      setSeasonsDetails(newSeasonsDetails);
      setSeasonVideos(newSeasonVideos); // Update season videos state
      setIsAvailable(true);

    } catch (error) {
      console.error('Error fetching TV show details:', error);
      setError(t('details.loadError'));
      setIsAvailable(true); // Assume available on error? Or false?
    } finally {
      setLoading(false);
      setLoadingVideos(false); // Finish loading videos
    }
  }, [id]);

  const checkAvailability = useCallback(async () => {
    if (!id) return;

    try {
      // Ne pas vérifier chaque épisode au chargement de la page pour des raisons de performance
      // La vérification se fera quand l'utilisateur sélectionne un épisode spécifique
      setIsAvailable(true);
    } catch (error) {
      console.error('Error checking series availability:', error);
      setIsAvailable(false);
    }
  }, [id]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      // Reset state when ID changes
      setSelectedSeason(null);
      setSelectedEpisode(null);
      setSeasonsDetails({});
      setEpisodeWarningOpen(false);
      setPendingEpisode(null);
      setAnimeMode(false);
      setAnimeEpisodeSearchOpen(false);
      setAnimeEpisodeSearch('');
      setAnimeEpisodeSortDescending(false);
      setAnimeEpisodeView('list');
      setAnimeData(null);
      setSelectedAnimeEpisode(null);
      setSelectedLanguage(null);
      setSelectedPlayer(null);
      setRecommendationsLoaded(false);
      setRecommendations([]);
      setShowCast(false);
      setShowCrew(false);
      setError(null);

      // BUG 2 & 3 FIX: Load initial watch status from localStorage
      if (id) { // id is the showId from params
        const initialWatchStatus: WatchStatus = {
          watchlist: false,
          favorite: false,
          watched: false,
          episodeWatchlist: {},
          episodeWatched: {}
        };

        try {
          const watchlistTv = JSON.parse(localStorage.getItem('watchlist_tv') || '[]');
          const favoritesTv = JSON.parse(localStorage.getItem('favorites_tv') || '[]');
          const watchedTv = JSON.parse(localStorage.getItem('watched_tv') || '[]');

          initialWatchStatus.watchlist = watchlistTv.some((item: any) => item.id === Number(id));
          initialWatchStatus.favorite = favoritesTv.some((item: any) => item.id === Number(id));
          initialWatchStatus.watched = watchedTv.some((item: any) => item.id === Number(id));

          const episodeWatchlistKey = `watchlist_episodes_tv_${id}`;
          const episodeWatchedKey = `watched_episodes_tv_${id}`;

          // Récupérer les données d'épisodes depuis localStorage
          const watchlistEpisodes = JSON.parse(localStorage.getItem(episodeWatchlistKey) || '{}');
          const watchedEpisodes = JSON.parse(localStorage.getItem(episodeWatchedKey) || '{}');

          // Convertir les clés de format "S1E1" vers "s1e1"
          const convertKeys = (episodeObj: Record<string, boolean>) => {
            const result: Record<string, boolean> = {};
            Object.keys(episodeObj).forEach(key => {
              // Convertir de "S1E1" vers "s1e1"
              const lowerCaseKey = key.toLowerCase();
              result[lowerCaseKey] = episodeObj[key];
            });
            return result;
          };

          initialWatchStatus.episodeWatchlist = convertKeys(watchlistEpisodes);
          initialWatchStatus.episodeWatched = convertKeys(watchedEpisodes);

          console.log("Chargement des statuts d'épisodes:", {
            original: { watchlist: watchlistEpisodes, watched: watchedEpisodes },
            converted: {
              watchlist: initialWatchStatus.episodeWatchlist,
              watched: initialWatchStatus.episodeWatched
            }
          });

        } catch (e) {
          console.error("Error loading watch status from localStorage:", e);
        }
        setWatchStatus(initialWatchStatus);
      }
      // End of BUG 2 & 3 FIX

      try {
        await Promise.all([
          fetchTVShowDetails(),
          checkAvailability()
        ]);
      } catch (error) {
        console.error('Error fetching data on ID change:', error);
        setError(t('details.loadError'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    return () => {
    };
  }, [id, fetchTVShowDetails, checkAvailability]);

  const availableSeasons = useMemo(() => {
    return [...new Set(availableEpisodes.map((ep) => Number(ep.sa)))].sort((a, b) => a - b);
  }, [availableEpisodes]);

  // Saison de départ par défaut : préférer la saison 1 si elle existe (pour éviter de commencer par les spéciaux / saison 0)
  // Si la saison 1 n'est pas disponible, on prend la première disponible
  const defaultStartSeason = useMemo(() => {
    if (availableSeasons.length === 0) return 1;
    if (availableSeasons.includes(1)) return 1;
    return availableSeasons[0];
  }, [availableSeasons]);
  const _episodesForSeason = availableEpisodes
    .filter((ep) => Number(ep.sa) === selectedSeason)
    .sort((a, b) => Number(a.epi) - Number(b.epi));
  void _episodesForSeason;

  const handleSeasonChange = (season: number) => {
    setSelectedSeason(season);
    setSelectedEpisode(null);
    setDropdownMode(null);
    setAnimeEpisodeSearch('');
    setAnimeEpisodeSearchOpen(false);
    setSeasonPickerOpen(false);

    // Scroll vers le bouton de menu déroulant pour qu'il soit au centre de l'écran
    setTimeout(() => {
      // Chercher d'abord le bouton de toggle du menu déroulant
      const toggleButton = dropdownToggleButtonRef.current;
      if (toggleButton) {
        toggleButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // Fallback vers la section des épisodes si le bouton n'est pas trouvé
        const episodesSection = episodesSectionRef.current;
        if (episodesSection) {
          episodesSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }, 100);
  };

  const getEpisodeAiring = (season: number, episode: number, now = airingNow) => {
    const data = seasonsDetails[season]?.episodes?.find((item: { episode_number: number }) => item.episode_number === episode);
    return resolveEpisodeAiring({
      season_number: season, episode_number: episode, air_date: data?.air_date,
    }, airingSchedule, now);
  };

  const handleEpisodeChange = (episodeNumber: number | string, season = selectedSeason) => {
    if (!id || season === null) return;
    const epNumber = Number(episodeNumber);
    if (getEpisodeAiring(season, epNumber, Date.now()).needsWarning) {
      setPendingEpisode({ season, episode: epNumber });
      setEpisodeWarningOpen(true);
      return;
    }
    navigate(`/watch/tv/${encodeId(id)}/s/${season}/e/${epNumber}`);
  };
  const _scrollLeft = (elementId: string) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };
  void _scrollLeft;

  const _scrollRight = (elementId: string) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };
  void _scrollRight;

  const updateWatchStatus = (type: keyof WatchStatus, value: boolean, episodeKey?: string) => {
    setWatchStatus(prev => {
      let newStatus;
      let persisted = true;
      const showId = id; // Assuming 'id' is the tvShowId from params

      if (episodeKey && showId) { // episodeKey is like "s1e1"
        const episodeField = type === 'episodeWatchlist' ? 'episodeWatchlist' : 'episodeWatched';
        newStatus = {
          ...prev,
          [episodeField]: {
            ...prev[episodeField],
            [episodeKey]: value
          }
        };

        // Convertir episodeKey de "s1e1" vers "S1E1" pour localStorage
        // Extraire les numéros de saison et d'épisode
        const [s, e] = episodeKey.replace('s', '').split('e');
        const seasonNum = parseInt(s, 10);
        const episodeNum = parseInt(e, 10);

        // Clé au format attendu par localStorage: "S1E1"
        const storageEpisodeKey = `S${seasonNum}E${episodeNum}`;

        // Update localStorage for individual episodes
        const itemType = type === 'episodeWatchlist' ? 'watchlist' : 'watched';
        const storageKey = `${itemType}_episodes_tv_${showId}`;
        try {
          const episodeData = JSON.parse(localStorage.getItem(storageKey) || '{}');
          if (value) {
            episodeData[storageEpisodeKey] = true;

            // On vérifie si la série elle-même est déjà dans la liste principale
            // Si non, on n'ajoute pas la série entière automatiquement, uniquement
            // l'épisode individuel. L'objectif est d'avoir une distinction claire
            // entre "série entière marquée" et "quelques épisodes marqués"
            const seriesListKey = `${itemType}_tv`;
            let seriesList = JSON.parse(localStorage.getItem(seriesListKey) || '[]');

            // On s'assure que seriesList est bien un array
            if (!Array.isArray(seriesList)) seriesList = [];

            // Vérifie si cette série est déjà présente dans la liste principale
            seriesList.some((media: any) => media.id === Number(showId));

            // On ne l'ajoute PAS automatiquement à la liste principale
            // car l'utilisateur veut marquer les épisodes individuellement

            // Si on voulait l'ajouter automatiquement après un certain seuil,
            // on pourrait implémenter cette logique ici
          } else {
            delete episodeData[storageEpisodeKey];
            // Optional: Check if this was the last episode and remove series from main list if so
            // This might be complex if series can be in list for other reasons (e.g. manually added)
          }
          localStorage.setItem(storageKey, JSON.stringify(episodeData));
        } catch (error) {
          persisted = false;
          console.error(`Error updating ${itemType} episodes in localStorage:`, error);
        }

      } else if (tvShow && showId) { // For series-level status
        newStatus = { ...prev, [type]: value };

        // Update localStorage for series watchlist, favorites, watched
        // For watchlist, favorite, watched
        let storageKey = '';
        if (type === 'watchlist') storageKey = 'watchlist_tv';
        else if (type === 'favorite') storageKey = 'favorites_tv';
        else if (type === 'watched') storageKey = 'watched_tv';

        if (storageKey) {
          try {
            let currentList = JSON.parse(localStorage.getItem(storageKey) || '[]');
            // Ensure currentList is an array
            if (!Array.isArray(currentList)) {
              currentList = [];
            }

            if (value) {
              // Add to list if not already there
              if (!currentList.some((media: any) => media.id === Number(showId))) {
                currentList.push({
                  id: Number(showId),
                  type: 'tv',
                  title: tvShow.name,
                  poster_path: tvShow.poster_path,
                  addedAt: new Date().toISOString()
                  // We might want to store last watched episode or progress here later
                });
                localStorage.setItem(storageKey, JSON.stringify(currentList));
              }
            } else {
              // Remove from list
              const updatedList = currentList.filter((media: any) => media.id !== Number(showId));
              localStorage.setItem(storageKey, JSON.stringify(updatedList));
            }
          } catch (error) {
            persisted = false;
            console.error(`Error updating ${type} in localStorage:`, error);
          }
        }
      } else {
        // Fallback or if tvShow or showId is not available yet
        newStatus = { ...prev };
        if (!episodeKey) { // if it's a series-level action but tvShow is not loaded
          // Ensure 'type' is one of the boolean properties of WatchStatus
          if (type === 'watchlist' || type === 'favorite' || type === 'watched') {
            newStatus = {
              ...prev,
              [type]: value
            };
          } else {
            // This case should ideally not be reached if !episodeKey
            // but as a safe-guard, we don't modify the status for episodeWatchlist/episodeWatched types here
            // without an episodeKey.
            console.warn('Attempted to update episode status without episodeKey in fallback');
          }
        } else {
          // If episodeKey exists but tvShow/showId doesn't, we can't update localStorage,
          // but we can update the local state for episode specific status
          const episodeField = type === 'episodeWatchlist' ? 'episodeWatchlist' : 'episodeWatched';
          newStatus = {
            ...prev,
            [episodeField]: {
              ...prev[episodeField],
              [episodeKey]: value
            }
          };
        }
      }
      return persisted ? newStatus as WatchStatus : prev;
    });
  };

  // Continue watching data functionality removed

  // Format time from seconds to MM:SS or HH:MM:SS
  const formatTime = (timeInSeconds: number) => {
    if (!timeInSeconds || isNaN(timeInSeconds)) return "00:00";
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = Math.floor(timeInSeconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Check the continue watching data
  const [continueWatchingData, setContinueWatchingData] = useState<{
    seasonNumber: number,
    episodeNumber: number,
    position: number,
    duration: number,
    hasProgress: boolean
  }>({
    seasonNumber: 1,
    episodeNumber: 1,
    position: 0,
    duration: 0,
    hasProgress: false
  });

  type ContinueWatchingTvEntry = {
    id: number;
    currentEpisode?: {
      season: number;
      episode: number;
    };
    lastAccessed?: string;
  };

  useEffect(() => {
    // Load any existing watch progress
    if (id) {
      try {
        let latestTimestamp = -1;
        let latestSeason = 1;
        let latestEpisode = 1;
        let latestPosition = 0;
        let latestDuration = 0;

        const considerCandidate = (
          seasonNumber: number,
          episodeNumber: number,
          timestampMs: number,
          position = 0,
          duration = 0
        ) => {
          if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) return;
          if (seasonNumber <= 0 || episodeNumber <= 0) return;
          if (!Number.isFinite(timestampMs)) return;

          if (timestampMs > latestTimestamp) {
            latestTimestamp = timestampMs;
            latestSeason = seasonNumber;
            latestEpisode = episodeNumber;
            latestPosition = Number(position) || 0;
            latestDuration = Number(duration) || 0;
          }
        };

        // First, check the continueWatching localStorage data
        const continueWatching = JSON.parse(localStorage.getItem('continueWatching') || '{"movies": [], "tv": []}') as {
          tv?: ContinueWatchingTvEntry[];
        };

        if (continueWatching.tv && Array.isArray(continueWatching.tv)) {
          const showIdInt = parseInt(id);
          const tvShow = continueWatching.tv.find((show) => show.id === showIdInt);

          if (tvShow && tvShow.currentEpisode) {
            const seasonFromContinue = Number(tvShow.currentEpisode.season);
            const episodeFromContinue = Number(tvShow.currentEpisode.episode);
            const continueTs = tvShow.lastAccessed ? Date.parse(tvShow.lastAccessed) : NaN;

            // Try to get detailed progress data for this specific episode
            const progressKey = `progress_tv_${id}_s${seasonFromContinue}_e${episodeFromContinue}`;
            const progressValue = Number.isFinite(seasonFromContinue) && Number.isFinite(episodeFromContinue)
              ? localStorage.getItem(progressKey)
              : null;
            let position = 0;
            let duration = 0;
            let progressTs = NaN;

            if (progressValue) {
              try {
                const progressData = JSON.parse(progressValue);
                position = Number(progressData.position) || 0;
                duration = Number(progressData.duration) || 0;
                progressTs = progressData.timestamp ? Date.parse(progressData.timestamp) : NaN;
              } catch (error) {
                console.error('Error parsing progress data:', error);
              }
            }

            const effectiveTimestamp = Number.isFinite(progressTs)
              ? progressTs
              : Number.isFinite(continueTs)
                ? continueTs
                : NaN;

            considerCandidate(seasonFromContinue, episodeFromContinue, effectiveTimestamp, position, duration);
          }
        }

        // Also check all progress_tv_* keys and keep the most recent by timestamp
        const keyPrefix = `progress_tv_${id}_s`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(keyPrefix)) continue;
          // Expected pattern: progress_tv_<id>_s<season>_e<episode>
          const match = key.match(/^progress_tv_\d+_s(\d+)_e(\d+)$/);
          if (!match) continue;
          const season = Number(match[1]);
          const episode = Number(match[2]);
          const value = localStorage.getItem(key);
          if (!value) continue;
          try {
            const progressData = JSON.parse(value);
            const ts = progressData.timestamp ? Date.parse(progressData.timestamp) : NaN;
            if (!Number.isFinite(ts)) continue;
            considerCandidate(
              season,
              episode,
              ts,
              Number(progressData.position) || 0,
              Number(progressData.duration) || 0
            );
          } catch (_) {
            // ignore malformed entries
          }
        }

        if (latestTimestamp !== -1) {
          // Validation de la disponibilité de la saison (si exclue, par exemple)
          let effectiveSeason = latestSeason;
          let effectiveEpisode = latestEpisode;

          if (!animeMode && availableSeasons.length > 0 && !availableSeasons.includes(effectiveSeason)) {
            effectiveSeason = defaultStartSeason;
            effectiveEpisode = 1;
          }

          setContinueWatchingData({
            seasonNumber: effectiveSeason,
            episodeNumber: effectiveEpisode,
            position: latestPosition,
            duration: latestDuration,
            hasProgress: true
          });
          return;
        }

        // No valid progress found, reset to default
        setContinueWatchingData({
          seasonNumber: defaultStartSeason,
          episodeNumber: 1,
          position: 0,
          duration: 0,
          hasProgress: false
        });
      } catch (error) {
        console.error('Error parsing continue watching data:', error);
      }
    }
  }, [id, animeMode, availableSeasons, defaultStartSeason]);

  // Historique serveur de la série (autre appareil, lecteurs web, « Déjà vu ») :
  // le stockage local gagne toujours, le serveur comble ce qui manque.
  const titleHistory = useTitleHistory('tv', id);
  const serverEpisodes = useMemo(() => serverEpisodeMap(titleHistory), [titleHistory]);
  const seriesMarked = seriesFullyMarked(titleHistory);
  const resumeData = seriesResume(continueWatchingData, titleHistory, {
    pageAnimeMode: animeMode,
    availableSeasons,
    defaultStartSeason,
  });

  // Fonction pour continuer le visionnage
  const handleContinueWatching = () => {
    // Use the progress data if available, otherwise start from the first episode
    // (reprise du serveur si le stockage local n'en a pas : resumeData).
    let seasonToWatch = resumeData.hasProgress || resumeData.fromServer ? resumeData.seasonNumber : defaultStartSeason;
    let episodeToWatch = resumeData.hasProgress || resumeData.fromServer ? resumeData.episodeNumber : 1;

    // En mode anime, la reprise et la navigation ne considèrent que les
    // saisons qui possèdent réellement des épisodes lisibles.
    const animeSeasonNumbers = animeMode && animeData?.seasons
      ? (animeData.seasons as any[])
          .map((season, index) => ({ season, index }))
          .filter(({ season }) =>
            season?.available !== false &&
            season?.status !== 'unavailable' &&
            Array.isArray(season?.episodes) &&
            season.episodes.length > 0
          )
          .map(({ season, index }) => Number(season?.number ?? (index + 1)))
      : null;

    if (animeSeasonNumbers && animeSeasonNumbers.length > 0) {
      if (!animeSeasonNumbers.includes(seasonToWatch)) {
        seasonToWatch = animeSeasonNumbers[0];
        episodeToWatch = 1;
      }
    } else if (availableSeasons.length > 0 && !availableSeasons.includes(seasonToWatch)) {
      seasonToWatch = defaultStartSeason;
      episodeToWatch = 1;
    }

    setSelectedSeason(seasonToWatch);
    setSelectedEpisode(episodeToWatch);

    // Reprise venue du serveur : le lecteur ne lit que progress_tv_ local, on
    // y recopie la position exacte de cet épisode (jamais un estimé).
    if (id && resumeData.fromServer && seasonToWatch === resumeData.seasonNumber && episodeToWatch === resumeData.episodeNumber) {
      const progressKey = `progress_tv_${id}_s${seasonToWatch}_e${episodeToWatch}`;
      const seed = seedProgress(resumeData, new Date().toISOString());
      // Stockage plein ou refusé : writeLocalStorage rend false, le lecteur repartira du début.
      if (seed && !readLocalStorage(progressKey)) writeLocalStorage(progressKey, seed);
    }

    // Check if Cinema Mode is active
    if (cinemaMode && id) {
      // Check if it's Anime Mode
      if (animeMode) {
        navigate(`/watch/anime/${encodeId(id)}/season/${seasonToWatch}/episode/${episodeToWatch}`);
      } else {
        // Navigate to the dedicated TV watch page
        handleEpisodeChange(episodeToWatch, seasonToWatch);
      }
      return;
    }

  };
  const WatchButtons = () => {
    return (
      <div className="mt-5 flex w-full max-w-full flex-col gap-3 bg-transparent p-0">
        <div className="flex w-fit max-w-full flex-wrap items-center gap-2.5">
          <motion.button
            whileHover={{ y: -2, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            onClick={handleContinueWatching}
            className="group relative inline-flex min-h-11 min-w-[138px] flex-row items-center justify-center gap-2.5 overflow-hidden rounded-lg border border-white bg-white px-5 py-2.5 text-sm font-bold text-[#151515] shadow-[0_8px_22px_rgba(0,0,0,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90"
          >
            <img src="/icons/play-button-icon.png" alt="" aria-hidden="true" className="h-5 w-5 flex-shrink-0 object-contain transition-transform duration-300 group-hover:scale-110" />
            <div className="text-left">
              {resumeData.hasProgress ? (
                <div className="flex min-w-0 flex-col items-start text-left">
                      {/* Estimé seul : le lecteur repartira du début de l'épisode, donc « Regarder ». */}
                      <span>{resumeData.estimated
                        ? t('details.watchBtn')
                        : t('details.resumeEpisode', { episode: resumeData.episodeNumber, season: getSeasonDisplayName(resumeData.seasonNumber, t) })}</span>
                  <span className="mt-1 rounded-md bg-black/[0.07] px-2 py-0.5 text-[11px] font-semibold text-black/75">
                    {resumeData.estimated
                      ? t('profilePage.progress.estimated', { percent: Math.round((resumeData.position / resumeData.duration) * 100), defaultValue: '≈ {{percent}} % · estimé' })
                      : `${formatTime(resumeData.position)}/${formatTime(resumeData.duration)}`}
                  </span>
                </div>
              ) : (availableSeasons.length > 0 && resumeData.seasonNumber !== defaultStartSeason) || resumeData.episodeNumber !== 1 ? (
                      <span>{t('details.continueEpisode', { episode: resumeData.episodeNumber, season: getSeasonDisplayName(resumeData.seasonNumber, t) })}</span>
              ) : (
                <>
                    {t('details.startEpisode', { season: getSeasonDisplayName(defaultStartSeason, t) })}
                </>
              )}
            </div>
          </motion.button>
          <AddToListButton
            mediaId={Number(id)}
            mediaType="tv"
            title={tvShow?.name || ''}
            posterPath={tvShow?.poster_path || ''}
          />
          {(!ENABLE_VIP_DOWNLOAD_CHECK || readLocalStorage('is_vip') === 'true') && (
            <motion.button
              whileHover={{ y: -2, scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              onClick={() => navigate(`/download/tv/${tvShow?.id}?season=${resumeData.seasonNumber || defaultStartSeason}&episode=${resumeData.episodeNumber || 1}`, { state: { backgroundLocation: location } })}
              className="inline-flex min-h-11 min-w-[138px] flex-row items-center justify-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.19] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(0,0,0,0.18)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.27]"
            >
              <Download className="h-5 w-5 flex-shrink-0 text-white" />
              <span className="text-left">{t('details.downloadBtn')}</span>
            </motion.button>
          )}
        </div>
        {showAntiSpoilerModal && (
          <AntiSpoilerSettingsModal
            isOpen={showAntiSpoilerModal}
            onClose={() => setShowAntiSpoilerModal(false)}
            onSettingsChange={updateAntiSpoilerSettings}
            currentSettings={antiSpoilerSettings}
          />
        )}
      </div>
    );
  };

  useEffect(() => {
    const fetchShow = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get(
          `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&append_to_response=credits,videos,content_ratings,networks,external_ids&language=${getTmdbLanguage()}`
        );
        setShow(response.data);
        // Set cast state
        if (response.data.credits && response.data.credits.cast) {
          setCast(response.data.credits.cast);
        }
        // Set crew state (using the grouping function)
        if (response.data.credits && response.data.credits.crew) {
          setCrew(groupCrewMembers(response.data.credits.crew));
        }
      } catch (error) {
        console.error('Error fetching TV show:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchShow();
  }, [id]);

  const checkFrembedAvailability = async () => {
    setLoadingSimilar(true);
    try {
      // Simplement définir tous les shows comme disponibles
      const availableShows = recommendations.map(show => ({ ...show, isAvailable: true }));
      setRecommendations(availableShows);
    } catch (error) {
      console.error('Error checking availability:', error);
    } finally {
      setLoadingSimilar(false);
    }
  };

  const fetchRecommendations = async () => {
    if (recommendationsLoaded) return; // Éviter de refaire la requête si déjà chargé

    setLoadingSimilar(true);
    try {
      const response = await axios.get(
        `https://api.themoviedb.org/3/tv/${id}/recommendations?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
      );

      const results = response.data.results || [];
      setRecommendations(results.slice(0, 20));
      setRecommendationsLoaded(true); // Marquer comme chargé même si vide
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      setRecommendationsLoaded(true); // Marquer comme chargé même en cas d'erreur
    } finally {
      setLoadingSimilar(false);
    }
  };

  const _handleShowSimilar = async () => {
    // Charge les recommandations mais n'ouvre plus la modale
    if (!recommendationsLoaded) {
      await fetchRecommendations();
      await checkFrembedAvailability();
    }
  };
  void _handleShowSimilar;

  // Charger automatiquement les séries similaires lors du chargement de la page
  useEffect(() => {
    if (id && tvShow && !recommendationsLoaded) {
      fetchRecommendations();
    }
  }, [id, tvShow, recommendationsLoaded]);


  useEffect(() => {
    if (tvShow) {
      // Simple TV show title
      document.title = `${tvShow.name} - Movix`;
    } else {
      document.title = t('details.tvShowDefaultTitle');
    }
  }, [tvShow, id]);

  const isAnime = useCallback(() => {
    if (!tvShow) return false;
    // Exclure spécifiquement certaines séries du mode anime
    if (shouldHideAnimeModeForId(id || '')) return false;
    // Scoring multi-signaux TMDB: origin_country, original_language, studio japonais,
    // keywords "anime"/"manga" (avec garde JP/ja), genre Animation. Seuil 40.
    return isLikelyAnime(tvShow as unknown as Parameters<typeof isLikelyAnime>[0], tmdbKeywords);
  }, [tvShow, id, tmdbKeywords]);

  /**
   * Les personnages de la fiche. AniList quand la série a le profil d'un anime
   * — elle rend les personnages eux-mêmes, là où TMDB ne rend que des
   * comédiens — et le générique TMDB sinon, ou si AniList ne connaît pas
   * l'œuvre. Les titres sont proposés du plus prometteur au moins : l'original
   * japonais, puis l'anglais, tous deux mieux indexés chez eux que le titre
   * traduit affiché.
   */
  useEffect(() => {
    if (!tvShow) return;
    let stale = false;
    setCharactersLoading(true);

    void loadDetailCharacters({
      looksLikeAnime: isAnime(),
      anilistTitles: [tvShow.original_name, tmdbEnglishName, tvShow.name]
        .filter((title): title is string => Boolean(title)),
      cast: fullCast,
    })
      .then((result) => { if (!stale) setCharacters(result); })
      .catch(() => { if (!stale) setCharacters(null); })
      .finally(() => { if (!stale) setCharactersLoading(false); });

    return () => { stale = true; };
  }, [tvShow, tmdbEnglishName, fullCast, isAnime]);

  /** Mots-clés et titres alternatifs, mis à plat pour l'affichage. */
  const extraKeywords = useMemo(
    () => normalizeKeywords(tmdbKeywords, getTmdbLanguage()),
    [tmdbKeywords],
  );
  const extraAlternateTitles = useMemo(
    () => normalizeAlternateTitles(
      { results: tmdbAlternativeTitles },
      [tvShow?.name, tvShow?.original_name, tmdbEnglishName],
    ),
    [tmdbAlternativeTitles, tvShow?.name, tvShow?.original_name, tmdbEnglishName],
  );

  /**
   * Ce que la fiche vient de récupérer alimente le catalogue local de
   * recherche. Titres alternatifs, mots-clés, thèmes et noms de personnages
   * sont exactement ce que `search/multi` ne sait pas trouver : les garder
   * rend la fiche retrouvable par ces mots-là (voir `utils/mediaSearchIndex`).
   */
  useEffect(() => {
    if (!tvShow || !id) return;
    rememberMedia({
      mediaType: 'tv',
      id: Number(id),
      title: tvShow.name,
      posterPath: tvShow.poster_path,
      backdropPath: tvShow.backdrop_path,
      date: tvShow.first_air_date,
      voteAverage: tvShow.vote_average,
      genreIds: tvShow.genres?.map((genre) => genre.id),
      overview: tvShow.overview,
      terms: [
        tvShow.original_name,
        tmdbEnglishName,
        ...extraAlternateTitles.map((entry) => entry.title),
        ...extraKeywords,
        ...(characters?.themes ?? []),
        ...(characters?.groups.flatMap((group) => group.characters.map((item) => item.name)) ?? []),
      ].filter((term): term is string => Boolean(term)),
    });
  }, [tvShow, id, tmdbEnglishName, extraAlternateTitles, extraKeywords, characters]);


  /**
   * Enrichit les épisodes anime avec la vignette TMDB du même épisode.
   *
   * La correspondance se fait uniquement par identifiants explicites : ID TMDB
   * de la série, numéro de saison et numéro d'épisode. Les listes anime-sama et
   * TMDB n'ont ni le même ordre ni le même nombre d'entrées (épisodes spéciaux,
   * chapitres découpés, etc.) : une association par position est interdite.
   * Une fiche sans numéro d'épisode exploitable est laissée telle quelle pour
   * éviter d'attribuer une image à un épisode spécial non correspondant.
   */
  const attachTmdbStillsToAnime = useCallback((data: AnimeImageData | null | undefined) => {
    if (!data || !Array.isArray(data.seasons) || !tvShow?.id) return data;
    const animeSeasons = data.seasons as AnimeSeasonImageData[];

    const tmdbSeriesId = String(tvShow.id);
    const stillBySeasonAndEpisode = new Map<string, string>();
    for (const [seasonNumber, details] of Object.entries(seasonsDetails)) {
      if (String(seasonNumber) === '0' || !Array.isArray(details?.episodes)) continue;
      for (const episode of details.episodes) {
        const still = firstNonEmptyImage(episode?.still_path, episode?.still_url);
        const episodeNumber = Number(episode?.episode_number);
        if (!still || !Number.isInteger(episodeNumber) || episodeNumber <= 0) continue;
        stillBySeasonAndEpisode.set(`${seasonNumber}:${episodeNumber}`, still);
      }
    }

    const normalizeStillKey = (source: string) => source
      .trim()
      .split(/[?#]/, 1)[0]
      .replace(/\/t\/p\/(?:w\d+|original)\//, '/t/p/{size}/');

    const seasons = animeSeasons.map((season, seasonIndex) => {
      if (!Array.isArray(season.episodes)) return season;
      const seasonNameNumber = /(?:season|saison)\s*(\d+)/i.exec(String((season as { name?: unknown }).name ?? ''))?.[1];
      const seasonNumber = Number(
        season.number ?? season.season_number ?? season.seasonNumber ?? seasonNameNumber ?? (seasonIndex + 1)
      );
      if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return season;

      // Anime-Sama may repeat a single still_url for a whole run of episodes.
      // Keep each genuine unique still, then fill duplicates only with the TMDB
      // still matched by an explicit season/episode number. Never guess by index.
      const usedStillKeys = new Set<string>();
      const episodes = season.episodes.map((episode) => {
        const currentStill = firstNonEmptyImage(episode.still_path, episode.still_url);
        const currentKey = currentStill ? normalizeStillKey(currentStill) : null;

        const explicitEpisodeNumber =
          episode.tmdb_episode_number ?? episode.tmdbEpisodeNumber ??
          episode.episode_number ?? episode.episodeNumber;
        const labelEpisodeNumber = /(?:episode|épisode|ep\.?)[\s:#-]*(\d{1,4})\b/i
          .exec(String((episode as { name?: unknown }).name ?? ''))?.[1];
        const animeEpisodeNumber = Number(explicitEpisodeNumber ?? labelEpisodeNumber);
        const hasReliableEpisodeNumber = Number.isInteger(animeEpisodeNumber) && animeEpisodeNumber > 0;
        const tmdbStill = hasReliableEpisodeNumber
          ? stillBySeasonAndEpisode.get(`${seasonNumber}:${animeEpisodeNumber}`) ?? null
          : null;
        const tmdbStillKey = tmdbStill ? normalizeStillKey(tmdbStill) : null;

        const currentIsUnique = Boolean(currentStill && currentKey && !usedStillKeys.has(currentKey));
        const tmdbIsUnique = Boolean(tmdbStill && tmdbStillKey && !usedStillKeys.has(tmdbStillKey));

        if (currentIsUnique) {
          usedStillKeys.add(currentKey!);
          return { ...episode, duplicate_still: false };
        }

        if (tmdbIsUnique) {
          usedStillKeys.add(tmdbStillKey!);
          return {
            ...episode,
            still_path: tmdbStill,
            still_url: null,
            duplicate_still: false,
            tmdbSeriesId,
            tmdbSeasonNumber: seasonNumber,
            tmdbEpisodeNumber: animeEpisodeNumber,
          };
        }

        // Better a clean episode placeholder than showing the exact same frame
        // repeatedly when no correctly matched still exists.
        if (currentStill && currentKey && usedStillKeys.has(currentKey)) {
          return { ...episode, still_path: null, still_url: null, duplicate_still: true };
        }
        return episode;
      });
      return { ...season, number: seasonNumber, episodes };
    });

    return { ...data, seasons };
  }, [tvShow?.id, seasonsDetails]);

  // Recalcule les vignettes quand les détails TMDB arrivent, même si les données
  // anime ont été chargées avant eux. La sélection et la lecture gardent leur
  // source d'origine : seul le tableau affiché est enrichi.
  const animeSeasonsWithStills = useMemo<AnimeSeasonImageData[]>(() => {
    const enriched = attachTmdbStillsToAnime(animeData);
    return Array.isArray(enriched?.seasons) ? enriched.seasons as AnimeSeasonImageData[] : [];
  }, [animeData, attachTmdbStillsToAnime]);

  const availableAnimeSeasons = useMemo(
    () => animeSeasonsWithStills.filter((season) =>
      season?.available !== false &&
      season?.status !== 'unavailable' &&
      Array.isArray(season?.episodes) &&
      season.episodes.length > 0
    ),
    [animeSeasonsWithStills],
  );

  // Anime season posters must be season-specific. Reusing the series poster for
  // every missing season image was making entire grids look like duplicates.
  const animeSeasonCards = useMemo(() => {
    const usedArtwork = new Set<string>();
    const seriesArtwork = [
      animeData?.poster_path,
      animeData?.posterPath,
      animeData?.image,
      tvShow?.poster_path,
    ]
      .filter((source): source is string => typeof source === 'string' && source.trim().length > 0)
      .map((source) => source.trim().split(/[?#]/, 1)[0]);

    return availableAnimeSeasons.map((season, index) => {
      const seasonNumber = Number(season.number ?? season.season_number ?? season.seasonNumber ?? (index + 1));
      const matchingTmdbSeason = tvShow?.seasons?.find(
        (tmdbSeason) => Number(tmdbSeason.season_number) === seasonNumber
      );
      const candidate = firstNonEmptyImage(
        matchingTmdbSeason?.poster_path,
        season.poster_path,
        season.posterPath,
        season.image,
      );
      const imageKey = candidate?.trim().split(/[?#]/, 1)[0] ?? null;
      const isSeriesPoster = Boolean(imageKey && seriesArtwork.includes(imageKey));
      const isRepeatedPoster = Boolean(imageKey && usedArtwork.has(imageKey));
      const posterPath = imageKey && !isSeriesPoster && !isRepeatedPoster ? candidate : null;
      if (posterPath && imageKey) usedArtwork.add(imageKey);

      return {
        season,
        seasonNumber,
        seasonTitle: getSeasonDisplayName(seasonNumber, t, season.name ?? undefined),
        posterPath,
      };
    });
  }, [availableAnimeSeasons, animeData?.poster_path, animeData?.posterPath, animeData?.image, tvShow?.poster_path, tvShow?.seasons, t]);

  // The Anime catalog is a presentation choice. The Anime playback toggle only
  // controls the source/player; it must not decide which season/episode UI is shown.
  const useAnimeSeasonLayout = animeSeasonCards.length > 0;

  useEffect(() => {
    if (!useAnimeSeasonLayout || animeSeasonCards.length === 0) return;
    const validSeasonNumbers = animeSeasonCards
      .map((card) => Number(card.seasonNumber))
      .filter((value) => Number.isFinite(value));
    if (selectedSeason === null || !validSeasonNumbers.includes(Number(selectedSeason))) {
      setSelectedSeason(validSeasonNumbers[0]);
      setSelectedEpisode(null);
      setAnimeEpisodeSearch('');
      setAnimeEpisodeSearchOpen(false);
    }
  }, [useAnimeSeasonLayout, animeSeasonCards, selectedSeason]);

  // Les séries classiques doivent afficher leur première saison dès l'ouverture
  // de la fiche. Auparavant selectedSeason restait null jusqu'au clic sur
  // « Lecture », ce qui masquait toute la liste des épisodes.
  // On attend les détails TMDB pour respecter les saisons réellement disponibles
  // et on conserve la saison demandée dans l'URL lorsqu'elle existe.
  useEffect(() => {
    if (useAnimeSeasonLayout) return;

    const seasonNumbers = Object.entries(seasonsDetails)
      .filter(([, details]) => Array.isArray(details?.episodes) && details.episodes.length > 0)
      .map(([seasonNumber]) => Number(seasonNumber))
      .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
      .sort((a, b) => a - b);

    if (seasonNumbers.length === 0) return;
    if (selectedSeason !== null && seasonNumbers.includes(Number(selectedSeason))) return;

    const nextSeason = seasonNumbers.includes(defaultStartSeason)
      ? defaultStartSeason
      : seasonNumbers.find((seasonNumber) => seasonNumber > 0) ?? seasonNumbers[0];

    setSelectedSeason(nextSeason);
    setSelectedEpisode(null);
  }, [useAnimeSeasonLayout, seasonsDetails, selectedSeason, defaultStartSeason]);

  const loadAnimeData = useCallback(async () => {
    if (!tvShow?.name) return;

    setLoadingAnimeData(true);
    try {
      // Use the new utility function for search name logic
      const searchName = getSearchNameForId(tvShow.id || '', tvShow.name);

      // Utiliser la nouvelle logique de recherche avec fallback
      const searchFunction = async (term: string) => {
        const response = await axios.get(`${MAIN_API}/anime/search/${encodeURIComponent(term)}?includeSeasons=true&includeEpisodes=true`);
        return response.data || [];
      };

      // D'abord l'œuvre que la fiche d'anime-sama relie à cet ID TMDB : aucun
      // nom à comparer. Les œuvres réglées à la main (getAnimeMatcherForId) et
      // celles sans fiche liée gardent la recherche par nom.
      const specialMatcher = getAnimeMatcherForId(tvShow.id || '');
      const linkedResults = specialMatcher
        ? []
        : (await fetchAnimeByTmdb<AnimeSamaCandidate>('tv', tvShow.id))
          .filter((anime) => Array.isArray(anime.seasons) && anime.seasons.length > 0);
      const results = linkedResults.length > 0
        ? linkedResults
        : await searchWithFallback(searchFunction, searchName, 'TVDetails');

      if (results.length > 0) {
        // --- PATCH SPECIAL ANIMES (cas fixés par TMDB id) ---
        let bestMatch: AnimeSamaCandidate | null = null;
        if (linkedResults.length > 0) {
          // Trouvée par son ID TMDB : rien à départager.
          bestMatch = linkedResults[0];
        } else if (specialMatcher) {
          bestMatch = (results as AnimeSamaCandidate[]).find((anime) =>
            specialMatcher({ name: anime.name || '', seasons: anime.seasons })
          ) || null;
        } else {
          // Scoring unifié : on compare CHAQUE candidat contre tous les noms TMDB
          // (titre localisé, titre anglais, original_name, alternative_titles FR/US/GB/JP).
          const tmdbNames = collectTmdbNames(
            { name: tvShow.name, original_name: (tvShow as { original_name?: string }).original_name },
            tmdbEnglishName ? { name: tmdbEnglishName } : null,
            tmdbAlternativeTitles,
          );
          // Toujours inclure le searchName (cas spécial override)
          if (searchName && !tmdbNames.includes(searchName)) tmdbNames.push(searchName);

          const { match, score, reason } = pickBestAnimeMatch(
            results as AnimeSamaCandidate[],
            tmdbNames,
          );
          if (match) {
            console.log(`[anime-match] ${reason} score=${score.toFixed(3)} -> ${match.name}`);
            bestMatch = match;
          } else {
            console.log(`[anime-match] ${reason}`);
          }
        }

        if (bestMatch && Array.isArray(bestMatch.seasons) && bestMatch.seasons.length > 0) {
          const enrichedMatch = attachTmdbStillsToAnime(bestMatch);
          setAnimeData(enrichedMatch);
          return enrichedMatch;
        } else {
          setAnimeData(null);
          setShowAnimeNotFoundMessage(true);
          setTimeout(() => {
            setShowAnimeNotFoundMessage(false);
          }, 5000);
          return null;
        }
      } else {
        console.log("Aucun résultat trouvé dans la source anime, passage en mode normal");
        setAnimeData(null);

        // Afficher un message temporaire
        setShowAnimeNotFoundMessage(true);
        setTimeout(() => {
          setShowAnimeNotFoundMessage(false);
        }, 5000);
        return null;
      }
    } catch (error) {
      console.error('Error loading anime data:', error);
      setAnimeData(null);
      return null;
    } finally {
      setLoadingAnimeData(false);
    }
  }, [tvShow?.id, tvShow?.name, tvShow, tmdbEnglishName, tmdbAlternativeTitles, MAIN_API, attachTmdbStillsToAnime]);

  const syncSelectedAnimeEpisode = useCallback((nextAnimeData: any) => {
    if (selectedSeason === null || !selectedEpisode || !nextAnimeData?.seasons) {
      setSelectedAnimeEpisode(null);
      setSelectedLanguage(null);
      setSelectedPlayer(null);
      return;
    }

    const currentSeason = nextAnimeData.seasons.find(
      (season: any, index: number) => (season.number || (index + 1)) === selectedSeason
    );
    const currentEpisode = currentSeason?.episodes?.find((episode: any) => episode.index === selectedEpisode);

    if (!currentEpisode) {
      setSelectedAnimeEpisode(null);
      setSelectedLanguage(null);
      setSelectedPlayer(null);
      return;
    }

    setSelectedAnimeEpisode(currentEpisode);

    const hasVf = currentEpisode.streaming_links?.some((link: any) => link.language === 'vf');
    const hasVostfr = currentEpisode.streaming_links?.some((link: any) => link.language === 'vostfr');

    if (hasVf) {
      setSelectedLanguage('vf');
    } else if (hasVostfr) {
      setSelectedLanguage('vostfr');
    } else {
      setSelectedLanguage(currentEpisode.streaming_links?.[0]?.language || null);
    }

    setSelectedPlayer('0');
  }, [selectedEpisode, selectedSeason]);

  const handleAnimeModeToggle = useCallback(async () => {
    if (animeMode) {
      setAnimeMode(false);
      setSelectedAnimeEpisode(null);
      setSelectedLanguage(null);
      setSelectedPlayer(null);
      // Si la saison sélectionnée en mode anime n'existe pas côté TMDB,
      // revenir sur une saison/épisode valide pour éviter le message
      // "Pas d'épisodes disponibles pour cette saison".
      if (availableSeasons.length > 0 && (selectedSeason === null || !availableSeasons.includes(selectedSeason))) {
        setSelectedSeason(defaultStartSeason);
        const firstEpisode = availableEpisodes
          .filter((ep) => Number(ep.sa) === defaultStartSeason)
          .sort((a, b) => Number(a.epi) - Number(b.epi))[0];
        setSelectedEpisode(firstEpisode ? Number(firstEpisode.epi) : 1);
      }
      return;
    }

    const resolvedAnimeData = attachTmdbStillsToAnime(animeData || await loadAnimeData());
    if (!resolvedAnimeData?.seasons?.length) {
      return;
    }

    syncSelectedAnimeEpisode(resolvedAnimeData);
    setAnimeMode(true);
  }, [animeData, animeMode, loadAnimeData, attachTmdbStillsToAnime, syncSelectedAnimeEpisode, availableSeasons, selectedSeason, defaultStartSeason, availableEpisodes]);

  useEffect(() => {
    let isCancelled = false;

    const checkAndLoadAnime = async () => {
      if (isAnime()) {
        const resolvedAnimeData = await loadAnimeData();
        if (isCancelled) {
          return;
        }

        const defaultToStandardMode = shouldDefaultAnimeModeToOff(id || '');
        setAnimeMode(Boolean(resolvedAnimeData?.seasons?.length) && !defaultToStandardMode);
      }
    };

    checkAndLoadAnime();

    return () => {
      isCancelled = true;
    };
  }, [id, isAnime, loadAnimeData]);

  const _scrollToSeasons = () => {
    const seasonsSection = seasonsSectionRef.current;
    if (seasonsSection) {
      seasonsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  void _scrollToSeasons;

  const fetchBackdropAndTrailer = async () => {
    try {
      console.log('Fetching backdrop and trailer for TV show:', id);

      // Récupérer les images
      const imagesResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/images`, {
        params: { api_key: TMDB_API_KEY }
      });

      // Trouver la meilleure image de fond
      const backdrops = imagesResponse.data.backdrops;
      if (backdrops && backdrops.length > 0) {
        const largestBackdrop = backdrops.sort((a: TMDBImage, b: TMDBImage) => b.width - a.width)[0];
        setBestBackdrop(largestBackdrop);
      }

      // Récupérer la bande-annonce
      const videosResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/videos`, {
        params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
      });

      console.log('French videos response:', videosResponse.data.results);
      let trailer = videosResponse.data.results.find((video: any) => video.type === 'Trailer');

      // Si pas de bande-annonce en français, essayer en anglais
      if (!trailer) {
        console.log('No French trailer found, trying English...');
        const enVideosResponse = await axios.get(`https://api.themoviedb.org/3/tv/${id}/videos`, {
          params: { api_key: TMDB_API_KEY, language: 'en-US' }
        });
        console.log('English videos response:', enVideosResponse.data.results);
        trailer = enVideosResponse.data.results.find((video: any) => video.type === 'Trailer');
      }

      if (trailer) {
        console.log('Trailer found:', trailer);
        setTrailerVideo(trailer);
      } else {
        console.log('No trailer found for this TV show');
        setTrailerVideo(null);
      }
    } catch (error) {
      console.error('Error fetching backdrop and trailer:', error);
      setTrailerVideo(null);
    }
  };

  // Function to fetch multi-language videos for TV shows

  // Function to fetch multi-language videos for a specific season

  useEffect(() => {
    setBestBackdrop(null);
    if (id) {
      fetchBackdropAndTrailer();
    }
  }, [id]);

  if (loading) {
    return <DetailsSkeleton mediaType="tv" />;
  }

  if (error) return <div className="text-center text-red-500">{error}</div>;
  if (!tvShow) return <div className="text-left">{t('details.tvNotFound')}</div>;

  // Age restriction check
  const contentCert = certifications['FR'] || certifications['US'] || '';
  const profileAgeRestriction = currentProfile?.ageRestriction ?? 0;
  if (contentCert && profileAgeRestriction > 0 && !isContentAllowed(contentCert, profileAgeRestriction)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">{t('details.contentBlocked')}</h2>
          <p className="text-gray-400 mb-6">
            {t('details.contentBlockedDesc', { rating: getClassificationLabel(contentCert, t), age: profileAgeRestriction })}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
          >
            {t('details.goBack')}
          </button>
        </div>
      </div>
    );
  }

  // Function to render episodes (either dropdown or grid)
  const renderEpisodes = (episodes: any[], type: 'anime' | 'standard') => {
    // Filter out empty episodes first to avoid issues
    const isAnime = type === 'anime';
    const nonEmptyEpisodes = episodes.filter((episode) => Boolean(episode));
    const episodeQuery = animeEpisodeSearch.trim().toLocaleLowerCase();
    const visibleEpisodes = [...nonEmptyEpisodes]
      .filter((episode: any) => {
        if (!episodeQuery) return true;
        return [episode.name, episode.index, episode.episode_number]
          .some((value) => String(value ?? '').toLocaleLowerCase().includes(episodeQuery));
      })
      .sort((left: any, right: any) => {
        const leftNumber = Number(left.index ?? left.episode_number ?? 0);
        const rightNumber = Number(right.index ?? right.episode_number ?? 0);
        return animeEpisodeSortDescending ? rightNumber - leftNumber : leftNumber - rightNumber;
      });

    if (nonEmptyEpisodes.length === 0) {
      return (
        <div className="text-center p-4 bg-gray-800/50 border border-gray-700 rounded-lg">
          <p>{t('details.noEpisodesForSeason')}</p>
        </div>
      );
    }

    const showToggle = !isAnime; // Les anime restent sur la liste de streaming, quel que soit le mode de lecture.

    // Le fallback affiche de saison/série reste réservé aux séries classiques.
    // Pour un anime, une vignette absente reste un placeholder : aucune fausse image répétée.
    const currentAnimeSeason = type === 'anime'
      ? animeData?.seasons?.find((season: SeasonPosterSource & { season_number?: number | string | null; seasonNumber?: number | string | null }, index: number) =>
        Number(season.number ?? season.season_number ?? season.seasonNumber ?? (index + 1)) === Number(selectedSeason))
      : null;
    const currentAnimeTmdbSeason = type === 'anime'
      ? tvShow?.seasons?.find((season) => Number(season.season_number) === Number(selectedSeason))
      : null;
    const currentStandardSeason = type === 'standard'
      ? (seasonsDetails[selectedSeason as number] || seasonCards.find((item) => item.season_number === selectedSeason))
      : null;
    const episodeSeasonPoster = firstNonEmptyImage(
      currentAnimeTmdbSeason?.poster_path,
      currentAnimeSeason?.poster_path,
      currentAnimeSeason?.posterPath,
      currentAnimeSeason?.image,
      currentStandardSeason?.poster_path,
      currentStandardSeason?.posterPath,
    );
    const episodeSeriesPoster = type === 'standard' ? firstNonEmptyImage(tvShow?.poster_path) : null;
    const episodeFallbackPoster = type === 'standard'
      ? (episodeSeasonPoster || episodeSeriesPoster)
      : null;

    // Déterminer le mode par défaut basé sur le nombre d'épisodes
    const defaultDropdownMode = false;

    const dropdownOptions = nonEmptyEpisodes.map((ep: any) => {
      if (type === 'anime') {
        const allLanguages = (Array.isArray(ep.streaming_links) ? ep.streaming_links : []).map((link: any) => {
          return getAnimeLanguageLabel(link.language, t);
        }).join(', ');
        return {
          value: String(ep.index ?? ep.episode_number ?? ''),
          // Le nom vient d'Anime-Sama (« Episode 62 ») : pas de rang devant.
          label: `${ep.name || ep.index} ${allLanguages ? `(${allLanguages})` : ''}`,
        };
      } else {
        const airing = getEpisodeAiring(selectedSeason!, ep.episode_number);
        const name = shouldHide('episodeNames')
          ? getMaskedContent(ep.name, 'episodeNames', undefined, ep.episode_number)
          : `${ep.episode_number}. ${ep.name}`;
        return {
          value: ep.episode_number.toString(),
          label: airing.kind !== 'aired' && (airing.date || airing.timestamp !== null)
            ? `${name} — ${getAiringLabel(airing, t, i18n.language, airingNow)}` : name,
        };
      }
    });

    const handleDropdownChange = (valueStr: string) => {
      if (type === 'anime') {
        const episode = nonEmptyEpisodes.find((ep: any) => ep.index === Number(valueStr));
        if (episode) {
          setSelectedEpisode(episode.index);
          setSelectedAnimeEpisode(episode);
          const episodeLinks = Array.isArray(episode.streaming_links) ? episode.streaming_links : [];
          const hasVf = episodeLinks.some((link: any) => link.language === 'vf');
          const hasVostfr = episodeLinks.some((link: any) => link.language === 'vostfr');

          if (hasVf) {
            setSelectedLanguage('vf');
          } else if (hasVostfr) {
            setSelectedLanguage('vostfr');
          } else {
            setSelectedLanguage(episodeLinks[0]?.language || null);
          }
          setSelectedPlayer(episodeLinks.length > 0 ? '0' : null);

          if (cinemaMode && id && selectedSeason) {
            navigate(`/watch/anime/${encodeId(id)}/season/${selectedSeason}/episode/${episode.index}`);
            return;
          }

        }
      } else {
        handleEpisodeChange(Number(valueStr));
      }
    };

    const handleAnimeGridClick = (episode: any) => {
      setSelectedEpisode(episode.index);
      setSelectedAnimeEpisode(episode);

      const episodeLinks = Array.isArray(episode.streaming_links) ? episode.streaming_links : [];
      const hasVf = episodeLinks.some((link: any) => link.language === 'vf');
      const hasVostfr = episodeLinks.some((link: any) => link.language === 'vostfr');

      if (hasVf) {
        setSelectedLanguage('vf');
      } else if (hasVostfr) {
        setSelectedLanguage('vostfr');
      } else {
        setSelectedLanguage(episodeLinks[0]?.language || null);
      }
      setSelectedPlayer(episodeLinks.length > 0 ? '0' : null);

      if (cinemaMode && id && selectedSeason) {
        // Rediriger vers la page de visionnage anime en mode cinéma
        navigate(`/watch/anime/${encodeId(id)}/season/${selectedSeason}/episode/${episode.index}`);
        return;
      }

    };

    // Bascule immédiate menu ↔ grille : un AnimatePresence « wait » laissait
    // un instant vide (sortie puis entrée) qui faisait clignoter la section.
    return (
      <>
        {(
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div ref={seasonPickerMenuRef} className="relative inline-flex" onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSeasonPickerOpen(false);
              }}>
                <button
                  ref={dropdownToggleButtonRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={seasonPickerOpen}
                  aria-label={t('details.season')}
                  data-testid="season-picker-trigger"
                  onClick={() => setSeasonPickerOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setSeasonPickerOpen(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-md text-left text-xl font-bold tracking-tight text-white transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <span>{t('details.season')} {selectedSeason ?? 1}</span>
                  <ChevronRight className={`h-4 w-4 rotate-90 text-white/55 transition-transform ${seasonPickerOpen ? 'rotate-[270deg]' : ''}`} aria-hidden="true" />
                </button>
                {seasonPickerOpen && (
                  <div
                    role="listbox"
                    aria-label={t('details.seasonsLabel')}
                    data-testid="season-picker-options"
                    className="absolute left-0 top-full z-40 mt-2 max-h-64 min-w-40 overflow-y-auto rounded-xl border border-white/[0.09] bg-[#181818] p-1 shadow-2xl"
                  >
                    {(isAnime
                      ? animeSeasonCards.map(({ seasonNumber }) => Number(seasonNumber))
                      : Object.keys(seasonsDetails).map((season) => Number(season))
                    ).sort((a, b) => a - b).filter((seasonNumber, index, seasons) => seasons.indexOf(seasonNumber) === index).map((seasonNumber) => (
                      <button
                        key={seasonNumber}
                        type="button"
                        role="option"
                        aria-selected={Number(selectedSeason) === seasonNumber}
                        data-testid={`season-option-${seasonNumber}`}
                        onClick={() => {
                          handleSeasonChange(seasonNumber);
                          setSeasonPickerOpen(false);
                        }}
                        className={`flex min-h-9 w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${Number(selectedSeason) === seasonNumber ? 'bg-[#303033] text-white font-semibold' : 'text-white/70 hover:bg-white/[0.07] hover:text-white'}`}
                      >
                        <span>{t('details.season')} {seasonNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-0.5 text-xs font-medium text-white/45">
                {nonEmptyEpisodes.length} {t('details.episodes').toLocaleLowerCase()}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {episodeListOptions.length > 0 && id && !isAnime && (
                <div
                  className="flex items-center rounded-full bg-white/[0.07] p-0.5"
                  role="group"
                  aria-label={t('details.episodeListSource')}
                  title={episodeListKind === 'tvmaze' && tvmazeSeasons ? t('details.episodeListTvmazeHint', {
                    count: tvmazeSeasons[selectedSeason as number]?.length ?? 0,
                    tmdb: tmdbSeasonsDetails[selectedSeason as number]?.episodes?.length ?? 0,
                  }) : undefined}
                >
                  {episodeListOptions.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={episodeListKind === kind}
                      onClick={() => chooseEpisodeList(kind)}
                      className={`h-8 rounded-full px-3 text-xs font-semibold transition-colors ${episodeListKind === kind ? 'bg-white text-[#171719]' : 'text-white/55 hover:text-white'}`}
                    >
                      {t(kind === 'tvmaze' ? 'details.episodeListTvmaze' : 'details.episodeListTmdb')}
                    </button>
                  ))}
                </div>
              )}
              {hasNetflixLayout && !isAnime && id && (
                <div className="hidden items-center rounded-full bg-white/[0.07] p-0.5 sm:flex" role="group" aria-label={t('details.seasonLayout')}>
                  {([false, true] as const).map((netflix) => (
                    <button
                      key={netflix ? 'netflix' : 'tmdb'}
                      type="button"
                      aria-pressed={usesNetflixLayout === netflix}
                      onClick={() => chooseSeasonLayout(netflix)}
                      className={`h-8 rounded-full px-3 text-xs font-semibold transition-colors ${usesNetflixLayout === netflix ? 'bg-white text-[#171719]' : 'text-white/55 hover:text-white'}`}
                    >
                      {t(netflix ? 'details.episodeListNetflix' : 'details.episodeListTmdb')}
                    </button>
                  ))}
                </div>
              )}
              {animeEpisodeSearchOpen ? (
                <div className="flex h-9 w-52 items-center gap-2 rounded-lg border border-white/10 bg-[#19191b] px-2.5 focus-within:border-white/25 sm:w-64">
                  <Search className="h-4 w-4 shrink-0 text-white/45" />
                  <input
                    autoFocus
                    value={animeEpisodeSearch}
                    onChange={(event) => setAnimeEpisodeSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setAnimeEpisodeSearch('');
                        setAnimeEpisodeSearchOpen(false);
                      }
                    }}
                    placeholder={t('details.selectEpisode')}
                    aria-label={t('details.selectEpisode')}
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setAnimeEpisodeSearch('');
                      setAnimeEpisodeSearchOpen(false);
                    }}
                    aria-label={t('common.close')}
                    className="rounded p-0.5 text-white/45 transition-colors hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAnimeEpisodeSearchOpen(true)}
                  aria-label={t('details.selectEpisode')}
                  title={t('details.selectEpisode')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07] text-white/75 transition-colors hover:bg-white/[0.13] hover:text-white"
                >
                  <Search className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setAnimeEpisodeSortDescending((value) => !value)}
                aria-label={animeEpisodeSortDescending ? t('common.sortAscending', 'Tri croissant') : t('common.sortDescending', 'Tri décroissant')}
                title={animeEpisodeSortDescending ? t('common.sortAscending', 'Tri croissant') : t('common.sortDescending', 'Tri décroissant')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.07] text-white/75 transition-colors hover:bg-white/[0.13] hover:text-white"
              >
                <ArrowDownUp className="h-4 w-4" />
              </button>
              <div className="flex h-9 items-center rounded-full bg-white/[0.07] p-0.5" role="group" aria-label={t('details.episodeListSource')}>
                <button
                  type="button"
                  aria-pressed={animeEpisodeView === 'list'}
                  onClick={() => setAnimeEpisodeView('list')}
                  title={t('details.episodeListTmdb')}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${animeEpisodeView === 'list' ? 'bg-white text-[#171719]' : 'text-white/55 hover:text-white'}`}
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-pressed={animeEpisodeView === 'grid'}
                  onClick={() => setAnimeEpisodeView('grid')}
                  title={t('details.showEpisodeGrid')}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${animeEpisodeView === 'grid' ? 'bg-white text-[#171719]' : 'text-white/55 hover:text-white'}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
        {visibleEpisodes.length === 0 && animeEpisodeSearch.trim() ? (
          <p className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-8 text-center text-sm text-white/50">
            {t('details.noEpisodesForSeason')}
          </p>
        ) : showToggle && (dropdownMode !== null ? dropdownMode : defaultDropdownMode) ? (
          // Dropdown mode (si > 15 épisodes par défaut, ou si activé manuellement)
          <motion.div
            key="dropdown"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex justify-start mb-6">  {/* Alignement à gauche */}
              <div className="w-full max-w-md">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  {t('details.selectEpisode')}
                </label>
                <CustomDropdown
                  options={dropdownOptions}
                  value={selectedEpisode ? selectedEpisode.toString() : ""}
                  onChange={handleDropdownChange}
                  placeholder={t('details.chooseEpisode')}
                  searchable={false}
                  className="w-full"
                />
              </div>
            </div>
          </motion.div>
        ) : (
          // Grid mode (mode par défaut ou si toggle activé)
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            <div className={animeEpisodeView === 'grid'
              ? "mb-6 grid grid-cols-1 gap-3 xl:grid-cols-2"
              : "mb-6 flex flex-col gap-2"}>
              {visibleEpisodes.map((ep: any, index: number) => {
                // ... grid item rendering ...
                if (isAnime) {
                  const isSelected = selectedEpisode === ep.index;
                  const episodeKey = `s${selectedSeason}e${ep.index}`;
                  const episodeNumber = Number(ep.index);
                  const availableLanguages: string[] = Array.isArray(ep.streaming_links)
                    ? Array.from(new Set(ep.streaming_links.map((link: any) => String(link?.language ?? '')).filter(Boolean)))
                    : [];
                  const episodeStillSource = firstNonEmptyImage(ep.still_path, ep.still_url);
                  const imageSource = isAnime ? episodeStillSource : (episodeStillSource || episodeFallbackPoster);
                  const fallbackSvg = getSeasonFallbackSvg(`${t('details.episode').toUpperCase()} ${episodeNumber}`.trim());
                  const sourceKey = episodeStillSource
                    ? (ep.still_path ? 'tmdb-still' : 'tvmaze-still')
                    : (isAnime ? 'no-still' : (episodeSeasonPoster ? 'season-poster' : 'series-poster'));
                  const episodeImageKey = `anime-episode-s${selectedSeason || 'unknown'}-e${ep.index}-${sourceKey}`;
                  const episodeImageFailed = failedImages[episodeImageKey];
                  const imageUrl = detailsMediaSlot.width > 0 && imageSource
                    ? getTmdbImageUrl(imageSource, {
                      kind: episodeStillSource ? 'still' : 'poster',
                      quality: effectiveImageQuality,
                      width: Math.ceil(episodeCardCssWidth * imageDpr),
                      role: 'card',
                      fallback: fallbackSvg,
                    })
                    : fallbackSvg;
                  const retryUrl = episodeImageFailed ? `${imageUrl}?retry=${Date.now()}` : imageUrl;
                  const episodeLabel = shouldHide('episodeNames')
                    ? `${t('details.episode')} ${episodeNumber}`
                    : (ep.name || `${t('details.episode')} ${episodeNumber}`);
                  const episodeTitle = shouldHide('episodeNames')
                    ? getMaskedContent(ep.name || `${t('details.episode')} ${episodeNumber}`, 'episodeNames', undefined, episodeNumber)
                    : (ep.name || `${t('details.episode')} ${episodeNumber}`);

                  // Progression locale/serveur : même format de clé que les épisodes standard.
                  let progressPercentage = 0;
                  let hasProgress = false;
                  try {
                    if (typeof window !== 'undefined' && id) {
                      const progressKey = `progress_tv_${id}_s${selectedSeason}_e${episodeNumber}`;
                      const saved = localStorage.getItem(progressKey);
                      if (saved) {
                        const parsed = JSON.parse(saved);
                        if (parsed && parsed.position && parsed.duration && parsed.duration > 0) {
                          progressPercentage = Math.round((parsed.position / parsed.duration) * 100);
                          hasProgress = parsed.position > 0 && progressPercentage > 0;
                        }
                      }
                    }
                  } catch {
                    // ignore localStorage/parsing errors
                  }
                  const mergedEpisode = mergeEpisode(
                    { percent: progressPercentage, hasProgress, watched: Boolean(watchStatus?.episodeWatched?.[episodeKey]) },
                    serverEpisodes.get(`${selectedSeason}:${episodeNumber}`),
                    seriesMarked,
                  );
                  progressPercentage = mergedEpisode.percent;
                  hasProgress = mergedEpisode.hasProgress;
                  const isEpisodeWatched = mergedEpisode.watched;
                  const seenOnServer = mergedEpisode.serverWatched;
                  const displayProgress = isEpisodeWatched || seenOnServer ? 100 : progressPercentage;

                  return (
                    <motion.div
                      key={`anime-${selectedSeason}-${ep.index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(index * 0.025, 0.2), duration: 0.22 } }}
                      className={`group relative flex min-h-[104px] flex-row items-stretch overflow-hidden rounded-xl border border-white/[0.075] bg-[#151517] font-sans transition-[background,border-color,box-shadow] duration-200 hover:border-white/20 hover:bg-[#1b1b1e] md:min-h-[122px] ${isSelected ? 'border-white/25 ring-1 ring-white/10' : ''}`}
                      whileHover={{ y: -2, transition: { duration: 0.18 } }}
                      layout={false}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex w-full min-w-0 flex-1 flex-row items-center gap-2.5 p-2 text-left cursor-pointer sm:gap-3 md:p-2.5"
                        onClick={() => handleAnimeGridClick(ep)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            handleAnimeGridClick(ep);
                          }
                        }}
                      >
                        <div className="flex min-w-0 flex-1 flex-row items-center gap-3 md:gap-4">
                          <span className="hidden w-7 shrink-0 text-center text-xl font-semibold text-white/45 sm:inline-flex">{episodeNumber}</span>
                          <div className="relative aspect-video w-[34%] min-w-[108px] max-w-[192px] shrink-0 overflow-hidden rounded-lg bg-black/30 sm:w-[190px] sm:min-w-[150px]">
                            {shouldHide('episodeImages') ? (
                              <div className="flex h-full w-full items-center justify-center bg-white/[0.035]">
                                <div className="flex flex-col items-center gap-2 text-gray-400">
                                  <EyeOff className="w-8 h-8" />
                                  <span className="text-sm">{t('details.imageMasked')}</span>
                                </div>
                              </div>
                            ) : imageSource ? (
                              <CompleteImage
                                src={episodeImageFailed ? fallbackSvg : retryUrl}
                                alt={episodeLabel}
                                fit="cover"
                                ambient={false}
                                className="absolute inset-0"
                                onError={() => {
                                  if (!episodeImageFailed) {
                                    setFailedImages(prev => ({ ...prev, [episodeImageKey]: true }));
                                  }
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#24242a] via-[#17171b] to-[#0f0f11] text-white/40">
                                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                                  <Play className="ml-0.5 h-4 w-4" />
                                </span>
                                <span className="text-[9px] font-semibold uppercase tracking-[0.16em]">
                                  {t('details.episode')} {episodeNumber}
                                </span>
                              </div>
                            )}
                            {Number(ep.vote_average) > 0 && (
                              <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                                {Number(ep.vote_average).toFixed(1)}
                              </span>
                            )}

                            {((isEpisodeWatched) || (hasProgress && displayProgress >= 95)) ? (
                              <span className="px-3 py-1.5 absolute top-2 right-2 rounded-lg whitespace-nowrap text-xs font-medium flex gap-1 items-center bg-green-500 text-green-900">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                </svg>
                                {t('details.alreadyWatched')}
                              </span>
                            ) : (hasProgress && displayProgress > 0 && displayProgress < 95 && (
                              <span className="px-3 py-1.5 absolute top-2 right-2 rounded-lg whitespace-nowrap text-xs font-medium flex gap-1 items-center bg-yellow-500 text-yellow-900">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                </svg>
                                {t('details.currentlyWatching')}
                              </span>
                            ))}

                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-red-600/90 rounded-full p-3 transform scale-0 group-hover:scale-100 transition-transform duration-300">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-play h-6 w-6 text-white"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
                                </div>
                              </div>
                            </div>

                            {displayProgress > 0 && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
                                <div
                                  className={`h-full ${displayProgress >= 95 ? 'bg-green-500' : 'bg-red-600'} transition-all`}
                                  style={{ width: `${displayProgress}%` }}
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1 md:gap-4 md:px-3">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <h4 className="h-6 line-clamp-1 text-base font-semibold leading-6 text-white transition-colors group-hover:text-red-400 sm:text-[17px]" title={shouldHide('episodeNames') ? undefined : ep.name}>
                                  {episodeTitle}
                                </h4>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/55">
                                  {tvShow?.episode_run_time?.[0] ? `${tvShow.episode_run_time[0]} min` : ''}
                                  {(ep.air_date || ep.airDate) && <span>· {ep.air_date || ep.airDate}</span>}
                                </div>
                                {ep.overview && (
                                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-white/65">{shouldHide('episodeOverviews') ? getMaskedContent(ep.overview, 'episodeOverviews') : ep.overview}</p>
                                )}

                              </div>
                            </div>
                            <div className="ml-2 flex shrink-0 items-center gap-1 self-center justify-end">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (watchStatus && watchStatus.episodeWatchlist) {
                                    updateWatchStatus('episodeWatchlist', !watchStatus.episodeWatchlist[episodeKey], episodeKey);
                                  }
                                }}
                                className={`rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] ${watchStatus?.episodeWatchlist?.[episodeKey] ? 'text-red-400' : 'text-white/45'}`}
                                title={t('details.addToWatchlistTitle')}
                              >
                                <List className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (watchStatus && watchStatus.episodeWatched) {
                                    updateWatchStatus('episodeWatched', !watchStatus.episodeWatched[episodeKey], episodeKey);
                                  }
                                }}
                                className={`rounded-lg p-1.5 transition-colors hover:bg-white/[0.08] ${isEpisodeWatched ? 'text-red-400' : 'text-white/45'}`}
                                title={t('details.markAsWatched')}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              {seenOnServer && (
                                <span
                                  role="img"
                                  aria-label={seenOnServer === 'estimated' ? t('details.watchedEstimatedBtn', 'Vu (estimé)') : t('details.watchedOtherDevice', 'Vu sur un autre appareil')}
                                  title={seenOnServer === 'estimated' ? t('details.watchedEstimatedBtn', 'Vu (estimé)') : t('details.watchedOtherDevice', 'Vu sur un autre appareil')}
                                  className="inline-flex h-8 items-center gap-1 self-center rounded border border-dashed border-white/25 px-1.5 text-[11px] text-white/60"
                                >
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                  {seenOnServer === 'estimated' ? t('details.estimatedShort', 'estimé') : t('details.otherDeviceShort', 'autre appareil')}
                                </span>
                              )}

                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                              {availableLanguages.map((language: string, languageIndex: number) => (
                                <span
                                  key={`anime-language-${language}-${languageIndex}`}
                                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/85 ${language === 'vf' ? 'border-emerald-400/20 bg-emerald-500/15' : language === 'vostfr' ? 'border-sky-400/20 bg-sky-500/15' : 'border-white/10 bg-white/[0.06]'}`}
                                >
                                  {language === 'vf' ? 'DUB' : language === 'vostfr' ? 'SUB' : language.toUpperCase().slice(0, 4)}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`${t('download.episode')} ${episodeNumber}`}
                        title={`${t('download.episode')} ${episodeNumber}`}
                        data-testid={`episode-download-${selectedSeason}-${episodeNumber}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/download/tv/${encodeURIComponent(String(tvShow?.id ?? id))}?season=${selectedSeason}&episode=${episodeNumber}`, { state: { backgroundLocation: location } });
                        }}
                        className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.08] text-white/75 transition-colors hover:bg-white/[0.16] hover:text-white"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </motion.div>
                  );
                } else {
                  const episodeKey = `s${selectedSeason}e${ep.episode_number}`;
                  const isSelected = selectedEpisode === ep.episode_number;
                  const airing = getEpisodeAiring(selectedSeason!, ep.episode_number);

                  // Compute per-episode progress from localStorage if present
                  let progressPercentage = 0;
                  let hasProgress = false;
                  try {
                    if (typeof window !== 'undefined' && id) {
                      const progressKey = `progress_tv_${id}_s${selectedSeason}_e${ep.episode_number}`;
                      const saved = localStorage.getItem(progressKey);
                      if (saved) {
                        const parsed = JSON.parse(saved);
                        if (parsed && parsed.position && parsed.duration && parsed.duration > 0) {
                          progressPercentage = Math.round((parsed.position / parsed.duration) * 100);
                          // consider progress only if at least 1% watched
                          hasProgress = parsed.position > 0 && progressPercentage > 0;
                        }
                      }
                    }
                  } catch (err) {
                    // ignore localStorage/parsing errors
                  }
                  // Serveur (autre appareil, lecteur web, série marquée en entier) :
                  // comble seulement ce que le stockage local n'a pas.
                  const mergedEpisode = mergeEpisode(
                    { percent: progressPercentage, hasProgress, watched: Boolean(watchStatus?.episodeWatched?.[episodeKey]) },
                    serverEpisodes.get(`${selectedSeason}:${ep.episode_number}`),
                    seriesMarked,
                  );
                  progressPercentage = mergedEpisode.percent;
                  hasProgress = mergedEpisode.hasProgress;
                  // Coche : la marque locale seule. Vu d'après le serveur seulement :
                  // indication à part (seenOnServer), la coche n'est pas allumée.
                  const isEpisodeWatched = mergedEpisode.watched;
                  const seenOnServer = mergedEpisode.serverWatched;
                  // If watched, show a full green bar; otherwise show actual progress
                  const displayProgress = isEpisodeWatched || seenOnServer ? 100 : progressPercentage;

                  return (
                    <motion.div
                      key={`${selectedSeason}-${ep.episode_number}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{
                        opacity: 1,
                        scale: 1,
                        // Délai plafonné : sans ça, la 21e carte d'une liste
                        // TVmaze attendait plus d'une seconde avant d'apparaître.
                        transition: { delay: Math.min(index * 0.03, 0.25), duration: 0.25 }
                      }}
                      className={`group relative flex min-h-[112px] flex-row items-stretch overflow-hidden rounded-xl border border-white/[0.075] bg-[#151517] transition-[background,border-color] duration-200 hover:border-white/20 hover:bg-[#1b1b1e] md:min-h-[132px] ${isSelected ? 'border-white/25 ring-1 ring-white/10' : ''}`}
                      whileHover={{ y: -2, transition: { duration: 0.18 } }}
                      layout={false}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        className="flex w-full min-w-0 flex-1 flex-row items-center gap-3 p-2 text-left cursor-pointer md:gap-4 md:p-3"
                        onClick={() => handleEpisodeChange(ep.episode_number)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            handleEpisodeChange(ep.episode_number);
                          }
                        }}
                      >
                        {/* ... Grid item content for standard episodes ... */}
                        <div className="flex min-w-0 flex-1 flex-row items-center gap-3 md:gap-4"><span className="hidden w-7 shrink-0 text-center text-xl font-semibold text-white/45 sm:inline-flex">{ep.episode_number}</span>
                          <div className="relative aspect-video w-[36%] min-w-[108px] max-w-[220px] shrink-0 overflow-hidden rounded-lg bg-black/30">
                            {(() => {
                              if (shouldHide('episodeImages')) {
                                return (
                                  <div className="w-full h-full bg-white/5 flex items-center justify-center min-h-[150px]">
                                    <div className="flex flex-col items-center gap-2 text-gray-400">
                                      <EyeOff className="w-8 h-8" />
                                      <span className="text-sm">{t('details.imageMasked')}</span>
                                    </div>
                                  </div>
                                );
                              }

                              const stillSource = firstNonEmptyImage(ep.still_path, ep.still_url);
                              const imageSource = stillSource || episodeFallbackPoster;
                              const fallbackSvg = getSeasonFallbackSvg(`${t('details.season').toUpperCase()} ${selectedSeason || ''}`.trim());
                              if (!imageSource) {
                                return (
                                  <div className="w-full h-full bg-white/5 flex items-center justify-center min-h-[150px]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-tv h-8 w-8 text-white opacity-20"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>
                                  </div>
                                );
                              }

                              // `still_url` : image TVmaze complète, laissée telle quelle.
                              // Le repli utilise la même logique TMDB/URL que les affiches.
                              const imageUrl = detailsMediaSlot.width > 0
                                ? getTmdbImageUrl(imageSource, {
                                  kind: stillSource ? 'still' : 'poster',
                                  quality: effectiveImageQuality,
                                  width: Math.ceil(episodeCardCssWidth * imageDpr),
                                  role: 'card',
                                  fallback: fallbackSvg,
                                })
                                : fallbackSvg;
                              // Source dans la clé : un échec TVmaze ne doit pas masquer l'image TMDB.
                              const sourceKey = stillSource
                                ? (ep.still_path ? 'tmdb-still' : 'tvmaze-still')
                                : (episodeSeasonPoster ? 'season-poster' : 'series-poster');
                              const imageKey = `episode-s${selectedSeason || 'unknown'}-e${ep.episode_number}-${sourceKey}`;
                              const hasFailed = failedImages[imageKey];
                              const retryUrl = hasFailed ? `${imageUrl}?retry=${Date.now()}` : imageUrl;
                              const episodeLabel = shouldHide('episodeNames')
                                ? `${t('details.episode')} ${ep.episode_number}`
                                : (ep.name || `${t('details.episode')} ${ep.episode_number}`);
                              return (
                                <CompleteImage
                                  src={hasFailed ? fallbackSvg : retryUrl}
                                  alt={episodeLabel}
                                  fit="cover"
                                  ambient={false}
                                  className="absolute inset-0"
                                  onError={() => {
                                    if (!hasFailed) {
                                      setFailedImages(prev => ({ ...prev, [imageKey]: true }));
                                    }
                                  }}
                                />
                              );
                            })()}
                            {Number(ep.vote_average) > 0 && (
                              <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                                {Number(ep.vote_average).toFixed(1)}
                              </span>
                            )}
                            {airing.kind !== 'unconfirmed' && (
                              <div className={`absolute top-2 left-2 max-w-[calc(100%-1rem)] text-xs px-2 py-1 rounded-full ${airing.kind === 'aired' ? 'bg-green-700 text-white' : 'bg-yellow-800 text-yellow-50'}`}>
                                {t(`details.airing.${airing.kind}`)}
                              </div>
                            )}

                            {/* Progress badges */}
                            {((isEpisodeWatched) || (hasProgress && displayProgress >= 95)) ? (
                              <span className="px-3 py-1.5 absolute top-2 right-2 rounded-lg whitespace-nowrap text-xs font-medium flex gap-1 items-center bg-green-500 text-green-900">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                                </svg>
                                {t('details.alreadyWatched')}
                              </span>
                            ) : (hasProgress && displayProgress > 0 && displayProgress < 95 && (
                              <span className="px-3 py-1.5 absolute top-2 right-2 rounded-lg whitespace-nowrap text-xs font-medium flex gap-1 items-center bg-yellow-500 text-yellow-900">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                </svg>
                                {t('details.currentlyWatching')}
                              </span>
                            ))}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="bg-red-600/90 rounded-full p-3 transform scale-0 group-hover:scale-100 transition-transform duration-300">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-play h-6 w-6 text-white"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
                                </div>
                              </div>
                            </div>

                            {/* Add progress bar */}
                            {displayProgress > 0 && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
                                <div
                                  className={`h-full ${displayProgress >= 95 ? 'bg-green-500' : 'bg-red-600'} transition-all`}
                                  style={{ width: `${displayProgress}%` }}
                                />
                              </div>
                            )}

                          </div>
                          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 p-2 md:gap-5 md:p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                {/* Hauteur fixe de deux lignes : la date reste au même niveau sur toutes les cartes. */}
                                <h4 className="text-lg leading-7 h-14 line-clamp-2 font-medium group-hover:text-white/85 transition-colors" title={shouldHide('episodeNames') ? undefined : ep.name}>
                                  {shouldHide('episodeNames') ? getMaskedContent(ep.name, 'episodeNames', undefined, ep.episode_number) : `${ep.episode_number}. ${ep.name}`}
                                </h4>
                                <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-white/60">
                                  {(airing.date || airing.timestamp !== null) && (
                                    <div className="flex items-start gap-1.5">
                                      <Calendar className="h-3.5 w-3.5 shrink-0 mt-1 text-white/35" />
                                      <span>{airing.kind === 'aired' ? formatAiringDate(airing, i18n.language) : getAiringLabel(airing, t, i18n.language, airingNow)}</span>
                                    </div>
                                  )}
                                  {ep.runtime && (
                                    <div className="flex items-center gap-1.5">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock h-3.5 w-3.5 text-white/35"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                      <span>{Math.floor(ep.runtime / 60)}h {ep.runtime % 60}m</span>
                                    </div>
                                  )}
                                </div>
                                {ep.overview && (
                                  <EpisodeOverview
                                    text={shouldHide('episodeOverviews') ? getMaskedContent(ep.overview, 'episodeOverviews') : ep.overview}
                                    expanded={!!expandedCards[`s${selectedSeason}e${ep.episode_number}`]}
                                    onToggle={toggleCardExpansion(`s${selectedSeason}e${ep.episode_number}`)}
                                    t={t}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2 mt-auto pt-3 justify-end opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (watchStatus && watchStatus.episodeWatchlist) {
                                    updateWatchStatus('episodeWatchlist', !watchStatus.episodeWatchlist[episodeKey], episodeKey);
                                  }
                                }}
                                className={`p-2 rounded ${watchStatus?.episodeWatchlist?.[episodeKey] ? 'text-red-600' : 'text-gray-400'} hover:bg-gray-800`}
                                title={t('details.addToWatchlistTitle')}
                              >
                                <List className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (watchStatus && watchStatus.episodeWatched) {
                                    updateWatchStatus('episodeWatched', !watchStatus.episodeWatched[episodeKey], episodeKey);
                                  }
                                }}
                                className={`p-2 rounded ${isEpisodeWatched ? 'text-red-600' : 'text-gray-400'} hover:bg-gray-800`}
                                title={t('details.markAsWatched')}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              {seenOnServer && (
                                // Indication, pas un bouton : cocher reste le geste qui marque pour de vrai.
                                <span
                                  role="img"
                                  aria-label={seenOnServer === 'estimated' ? t('details.watchedEstimatedBtn', 'Vu (estimé)') : t('details.watchedOtherDevice', 'Vu sur un autre appareil')}
                                  title={seenOnServer === 'estimated' ? t('details.watchedEstimatedBtn', 'Vu (estimé)') : t('details.watchedOtherDevice', 'Vu sur un autre appareil')}
                                  className="inline-flex h-8 items-center gap-1 self-center rounded border border-dashed border-white/25 px-1.5 text-[11px] text-white/60"
                                >
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                  {seenOnServer === 'estimated' ? t('details.estimatedShort', 'estimé') : t('details.otherDeviceShort', 'autre appareil')}
                                </span>
                              )}
                              {(() => {
                                const reminderAt = airing.timestamp ?? (airing.date ? Date.parse(`${airing.date}T00:00:00Z`) : NaN);
                                // Ne pas proposer un rappel dont l'instant est déjà passé.
                                if (reminderAt > airingNow && airing.date && id && tvShow?.name) {
                                  return (
                                    <AlertButton
                                      showId={id}
                                      showName={tvShow.name}
                                      season={selectedSeason!}
                                      episode={ep.episode_number}
                                      episodeName={ep.name}
                                      airDate={airing.timestamp !== null ? new Date(airing.timestamp).toISOString() : airing.date}
                                    />
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`${t('download.episode')} ${ep.episode_number}`}
                        title={`${t('download.episode')} ${ep.episode_number}`}
                        data-testid={`episode-download-${selectedSeason}-${ep.episode_number}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/download/tv/${encodeURIComponent(String(tvShow?.id ?? id))}?season=${selectedSeason}&episode=${ep.episode_number}`, { state: { backgroundLocation: location } });
                        }}
                        className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.08] text-white/75 transition-colors hover:bg-white/[0.16] hover:text-white"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </motion.div>
                  );
                }
              })}
            </div>
          </motion.div>
        )}
      </>
    );
  };
  const tvYear = tvShow.first_air_date && !isNaN(new Date(tvShow.first_air_date).getTime())
    ? Number(tvShow.first_air_date.slice(0, 4))
    : null;
  const showAiring = resolveShowAiring(tvShow.first_air_date, airingSchedule, airingNow);
  const pendingAiring = pendingEpisode ? getEpisodeAiring(pendingEpisode.season, pendingEpisode.episode) : null;
  const timelineEpisodes: Array<TvEpisodeDate & { name: string }> = Object.entries(seasonsDetails).flatMap(([season, details]) =>
    (details.episodes ?? []).map((episode: TvEpisodeDate & { name: string }) => ({ ...episode, season_number: Number(season) })),
  );
  if (tvShow.last_episode_to_air) timelineEpisodes.push(tvShow.last_episode_to_air);
  if (tvShow.next_episode_to_air) timelineEpisodes.push(tvShow.next_episode_to_air);
  getEpisodeTimeline(timelineEpisodes,airingSchedule,airingNow);
  const tvTitle = tvYear ? `${tvShow.name} (${tvYear}) - Movix` : `${tvShow.name} - Movix`;
  const tvCanonicalUrl = buildSiteUrl(`/tv/${encodedId || id}`);
  const tvSocialImage = tvShow.backdrop_path || tvShow.poster_path
    ? `https://image.tmdb.org/t/p/original${tvShow.backdrop_path || tvShow.poster_path}`
    : undefined;
  const tvDescription = tvShow.overview?.trim() || `Découvrez ${tvShow.name} sur Movix.`;
  const posterCssWidth = viewportWidth < 768
    ? viewportWidth - 32
    : viewportWidth < 1024
      ? (viewportWidth - 128) / 3
      : (viewportWidth - 192) / 3;
  const mainPosterUrl = getTmdbImageUrl(tvShow.poster_path, {
    kind: 'poster',
    quality: effectiveImageQuality,
    width: Math.ceil(Math.max(1, posterCssWidth) * imageDpr),
    role: 'detail',
    fallback: DEFAULT_IMAGE,
  });
  const backdropImage = bestBackdrop
    ? getTmdbImageUrl(bestBackdrop.file_path, {
      kind: 'backdrop',
      quality: effectiveImageQuality,
      width: getCoverImageWidth(viewportWidth, viewportHeight, bestBackdrop.aspect_ratio, imageDpr),
      role: 'background',
    })
    : null;
  const measuredDetailsWidth = Math.max(1, detailsMediaSlot.width);
  const gridCardWidth = (columns: number) => Math.max(1, (measuredDetailsWidth - 16 * (columns - 1)) / columns);
  const episodeCardCssWidth = gridCardWidth(viewportWidth < 768 ? 1 : viewportWidth < 1024 ? 3 : 4);

  return (
    <MotionConfig reducedMotion="user">
      <SEO
        title={tvTitle}
        description={tvDescription}
        ogType="video.tv_show"
        ogUrl={tvCanonicalUrl}
        ogImage={tvSocialImage}
        canonical={tvCanonicalUrl}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="detail-page relative z-10 min-h-screen bg-black text-white px-4 md:px-8 lg:px-16 py-6"
      >
        <style>{`
        /* Netflix-style poster hover effects - COPIED FROM MovieDetails.tsx */
        .content-row-container {
          padding: 5px 0px 40px 0px;
          margin-top: -30px;
          overflow: visible !important;
          position: relative;
          z-index: 1;
        }
        .poster-row {
          display: flex;
          gap: 10px;
          transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          padding: 5rem 0.5rem;
          margin: 0 -0.5rem -5rem -0.5rem;
          overflow-x: auto !important;
          overflow-y: visible !important;
          scrollbar-width: none;
          -ms-overflow-style: none;
          position: relative;
          z-index: 5;
        }
        .poster-row::-webkit-scrollbar {
          display: none;
        }
        .poster-container {
          position: relative;
          transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          margin: 0;
          flex-shrink: 0;
          z-index: 10;
          overflow: visible;
          padding: 0;
        }
        .poster-container:hover {
          z-index: 50;
          overflow: visible;
          transform: translateZ(0);
        }
        .poster-container:hover ~ .poster-container {
          transform: translateX(0);
        }
        .poster-card {
          position: relative;
          transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
          transform-origin: 0% 0%;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
          overflow: visible;
          cursor: pointer;
          z-index: 10;
          margin-bottom: 3rem;
          margin-top: 1rem;
        }
        .poster-card:hover {
          transform: scale(1.5);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          z-index: 100;
          overflow: visible;
          transform-style: preserve-3d;
          position: relative;
        }
        .poster-container:has(.poster-card:hover) ~ .poster-container {
          transform: translateX(100px);
        }
        .poster-container:hover ~ .poster-container {
          transition-delay: 0.12s;
          transform: translateX(100px);
        }
        .poster-card .hover-content {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #141414;
          opacity: 0;
          display: flex;
          flex-direction: column;
          border-radius: 8px;
          transition: opacity 0.3s ease;
          overflow: hidden;
        }
        .poster-card:hover .hover-content {
          opacity: 1;
        }
        .poster-card:hover img.poster {
          opacity: 0;
        }
        .section-title {
          font-size: 1.5rem;
          font-weight: 700;
          position: relative;
          background: linear-gradient(90deg, #ffffff, #e2e2e2);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-shadow: 0px 2px 4px rgba(0, 0, 0, 0.3);
          letter-spacing: 0.5px;
          padding-bottom: 0.5rem;
          text-transform: uppercase;
          display: inline-block;
          animation: fadeInTitle 0.8s ease-out forwards;
          transition: all 0.3s ease;
        }
        .section-title:hover {
          background: linear-gradient(90deg, #ff3333, #ff9999);
          -webkit-background-clip: text;
          background-clip: text;
          transform: translateY(-2px);
          text-shadow: 0px 4px 8px rgba(255, 51, 51, 0.4);
        }
        .section-title::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: 0;
          width: 40px;
          height: 3px;
          background: linear-gradient(90deg, #f11 0%, #f66 100%);
          border-radius: 3px;
          animation: expandWidth 0.6s ease-out forwards 0.3s;
          transform-origin: left;
          transition: all 0.3s ease;
        }
        .section-title:hover::after {
          width: 100%;
          background: linear-gradient(90deg, #ff3333, #ff9999);
        }
        @keyframes fadeInTitle {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes expandWidth {
          0% { width: 0; }
          100% { width: 40px; }
        }
        
        /* Styles pour no-scroll (copié de MovieDetails) */
        .no-scroll {
          overflow: hidden !important; /* Cache TOUT overflow, pas seulement horizontal */
          pointer-events: none !important; /* Désactive TOUS les événements de souris sur le conteneur */
          touch-action: none !important; /* Désactive les événements tactiles */
          user-select: none !important; /* Empêche la sélection de texte */
          isolation: isolate; /* Crée un nouveau contexte d'empilement */
        }
        /* Réactiver uniquement pour les enfants directs (les poster-container) */
        .no-scroll > * {
          pointer-events: auto !important;
        }
        
      `}</style>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="text-white px-4 md:px-8 lg:px-16 py-6"
      >
        {/* Titre sémantique conservé pour l'accessibilité ; le titre visible est dans le hero. */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="hidden"
        >
          <h1 className="section-title text-4xl md:text-5xl font-bold">
            {tvShow.name} {tvYear && <>({tvYear})</>}
          </h1>
          {(showAiring.kind !== 'unconfirmed' || showAiring.date) && (
            <p className="mt-3">
              <span className={`inline-block max-w-full text-sm font-medium ${showAiring.kind === 'unconfirmed' ? 'text-gray-300' : `px-2 py-1 rounded-md ${showAiring.kind === 'aired' ? 'bg-green-700 text-white' : 'bg-yellow-800 text-yellow-50'}`}`}>
                {getAiringLabel(showAiring, t, i18n.language, airingNow)}
              </span>
            </p>
          )}
          {airingSchedule && (
            <p className="mt-2 text-xs text-gray-400">
              {t('details.airing.source')}{' '}
              <a href={airingSchedule.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                TVmaze
              </a>
            </p>
          )}
        </motion.div>
        {/* Hero Série / Anime pleine largeur, puis synopsis, saisons et épisodes en dessous. */}
        <div className="grid grid-cols-1 gap-8">
          <DetailHero
            title={tvShow.name}
            year={tvYear}
            rating={tvShow.vote_average}
            seasons={tvShow.number_of_seasons}
            episodes={tvShow.number_of_episodes}
            runtime={tvShow.episode_run_time?.[0] ? `${tvShow.episode_run_time[0]} ${t('details.minutesLabel')}` : null}
            classification={contentCert ? getClassificationLabel(contentCert, t) : null}
            seasonLabel={t('details.seasonsLabel')}
            episodeLabel={t('details.episodesLabel')}
            genres={(tvShow.genres || []).map((genre) => ({
              id: genre.id,
              name: t('genres.id_' + genre.id, { defaultValue: String(genre.id) }),
            }))}
            synopsis={shouldHide('episodeOverviews')
              ? getMaskedContent(tvShow.overview || '', 'episodeOverviews')
              : tvShow.overview}
            imageUrl={backdropImage}
            fallbackImageUrl={mainPosterUrl}
            genreHref={(genreId) => `/genre/tv/${genreId}`}
            badges={
              <>
                {animeMode && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-rose-300/40 bg-rose-600/25 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-rose-100 backdrop-blur-sm">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('details.animeModeActiveBadge')}
                  </span>
                )}
                {(showAiring.kind !== 'unconfirmed' || showAiring.date) && (
                  <span className={showAiring.kind === 'unconfirmed'
                    ? 'inline-flex max-w-full rounded-md bg-black/40 px-2.5 py-1 text-xs font-semibold text-white/80'
                    : showAiring.kind === 'aired'
                      ? 'inline-flex max-w-full rounded-md bg-emerald-600/90 px-2.5 py-1 text-xs font-bold text-white'
                      : 'inline-flex max-w-full rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-bold text-black'}>
                    {getAiringLabel(showAiring, t, i18n.language, airingNow)}
                  </span>
                )}
              </>
            }
            note={airingSchedule ? (
              <p>
                {t('details.airing.source')}{' '}
                <a href={airingSchedule.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">TVmaze</a>
              </p>
            ) : undefined}
            actions={<WatchButtons />}
          />


        <div className="detail-content-shell mx-auto w-full max-w-[1720px] px-0 sm:px-2">
          <div className="detail-section flex flex-wrap items-center gap-3 border-b border-white/[0.08] pb-4">
            <LikeDislikeButton
              contentType="tv"
              contentId={id || ''}
              onStatsChange={setMovixVoteStats}
            />
            <motion.button
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => setShowAntiSpoilerModal(true)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/[0.12] sm:text-sm"
              title={t('details.antiSpoilConfig')}
            >
              <Shield className="h-4 w-4" aria-hidden="true" />
              <span>{t('details.antiSpoil')}</span>
            </motion.button>
            {isAnime() && (
              <motion.button
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.985 }}
                onClick={handleAnimeModeToggle}
                disabled={loadingAnimeData}
                aria-pressed={animeMode}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-bold transition-all sm:text-sm ${animeMode
                  ? 'border-rose-300/40 bg-gradient-to-r from-rose-600 to-red-600 text-white'
                  : 'border-white/15 bg-white/[0.06] text-white/90 hover:bg-white/[0.12]'}${loadingAnimeData ? ' cursor-wait opacity-70' : ''}`}
              >
                {animeMode ? <Video className="h-4 w-4" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                <span>{animeMode ? t('details.backToStandardMode') : t('details.animeModeLabel')}</span>
              </motion.button>
            )}
          </div>
          {animeMode && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3 text-xs leading-relaxed text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t('details.standardModeAvailable')}
            </p>
          )}

                  {/* Saisons et épisodes : choix direct dans l'en-tête, sans galerie de posters. */}
                  <motion.div
                    ref={seasonsSectionRef}
                    className="seasons-section mb-7 w-full border-0 bg-transparent p-0 shadow-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                  >
                    {/* Compact episode list for Anime and standard series. */}
                    <AnimatePresence mode="wait">
                      {selectedSeason !== null && (
                        <motion.div
                          key={`season-${selectedSeason}`}
                          ref={episodesSectionRef}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ duration: 0.4 }}
                          className="w-full episodes-section"
                        >
                          {/* AnimatePresence pour la transition anime/standard */}
                          <AnimatePresence mode="wait">
                            {useAnimeSeasonLayout ? (
                              <motion.div
                                key="anime-view"
                                initial={{ opacity: 0, y: -10 }} // Départ légèrement au-dessus
                                animate={{ opacity: 1, y: 0 }}   // Arrivée à la position normale
                                exit={{ opacity: 0, y: 10 }}    // Sortie légèrement vers le bas
                                transition={{ duration: 0.3 }}
                              >
                                {renderEpisodes(
                                  animeSeasonCards.find((seasonCard) => seasonCard.seasonNumber === Number(selectedSeason))?.season.episodes || [],
                                  'anime'
                                )}
                              </motion.div>
                            ) : (
                              <motion.div
                                key="standard-view"
                                initial={{ opacity: 0, y: -10 }} // Départ légèrement au-dessus
                                animate={{ opacity: 1, y: 0 }}   // Arrivée à la position normale
                                exit={{ opacity: 0, y: 10 }}    // Sortie légèrement vers le bas
                                transition={{ duration: 0.3 }}
                              >
                                {/* Render the same episode rows for every season source. */}
                                {renderEpisodes(seasonsDetails[selectedSeason]?.episodes || [], 'standard')}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                </AnimatePresence>
                </motion.div>
          </div>
          <DetailCastRail
            items={cast}
            imageUrl={(posterPath, width) => getTmdbImageUrl(posterPath, {
              kind: 'profile',
              quality: effectiveImageQuality,
              width,
              role: 'card',
            })}
          />
        </div>
      </motion.div>
      </motion.div>

      {/* Modal pour les vidéos */}
      {showVideoPopup && selectedVideo && (
        <AnimatePresence mode="wait">
          {!isClosingVideo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/90 flex items-center justify-center p-2 sm:p-4 z-[100000]"
              onClick={handleCloseVideo}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-6xl bg-gray-900 rounded-2xl overflow-hidden relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-4 flex justify-between items-center border-b border-gray-800">
                  <h3 className="text-xl font-semibold text-white">{selectedVideo.name}</h3>
                  <motion.button
                    onClick={handleCloseVideo}
                    className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <X className="h-6 w-6" />
                  </motion.button>
                </div>
                <div className="aspect-w-16 aspect-h-9">
                  <iframe
                    src={`https://www.youtube.com/embed/${selectedVideo.key}?autoplay=1`}
                    title={selectedVideo.name}
                    className="w-full h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px]"
                    allowFullScreen
                    allow="autoplay"
                  ></iframe>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <DetailRecommendations
        items={recommendations.map((show) => ({
          id: Number(show.id),
          title: show.name,
          name: show.name,
          poster_path: show.poster_path || '',
          backdrop_path: show.backdrop_path || '',
          overview: show.overview || '',
          vote_average: show.vote_average || 0,
          first_air_date: show.first_air_date,
          media_type: 'tv' as const,
        })) as Media[]}
        mediaType="tv-similar"
        loading={loadingSimilar}
      />

      <DetailComments contentType="tv" contentId={id!} anchorRef={commentsRef} />

      {showSimilarModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-black rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">{t('details.similarSeries')}</h2>
              <button
                onClick={() => setShowSimilarModal(false)}
                className="p-2 hover:bg-black/80 rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
            {loadingSimilar ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-4 bg-black/50">
                <Loader className="animate-spin h-8 w-8" />
                <p className="text-gray-400">{t('details.searchingSimilarSeries')}</p>
              </div>
            ) : recommendations.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {recommendations.map((item) => (
                  <Link
                    key={item.id}
                    to={`/tv/${encodeId(item.id || '')}`}
                    onClick={() => setShowSimilarModal(false)}
                    className="block group/item relative rounded-lg overflow-hidden"
                  >
                    <img
                      {...getTmdbImageProps(item.poster_path, {
                        kind: 'poster',
                        quality: effectiveImageQuality,
                        sizes: '(max-width: 639px) calc(50vw - 3rem), (max-width: 767px) calc(33.333vw - 2.333rem), (max-width: 927px) calc(25vw - 2rem), 12.5rem',
                        role: 'card',
                        fallback: DEFAULT_IMAGE,
                      })}
                      alt={item.name}
                      className="w-full aspect-[2/3] object-cover rounded-lg transition-transform duration-300 group-hover/item:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <h3 className="text-sm font-bold text-white line-clamp-2">
                          {item.name}
                        </h3>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-400" />
                            <span className="text-xs text-gray-300">
                              {item.vote_average.toFixed(1)}
                            </span>
                          </div>
                          {item.first_air_date && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-gray-400" />
                              <span className="text-xs text-gray-300">
                                {new Date(item.first_air_date).getFullYear()}
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-gray-300 line-clamp-2">
                          {item.overview || t('details.noSummaryAvailable')}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400">
                {t('details.noSimilarSeriesFound')}
              </div>
            )}
          </div>
        </div>
      )}




      <Dialog open={isEpisodeWarningOpen && pendingAiring?.needsWarning === true} onOpenChange={setEpisodeWarningOpen}>
          <DialogContent className="max-w-md w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto flex flex-col items-center gap-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-tv h-12 w-12 text-yellow-500 mb-4"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>
            <DialogTitle className="text-2xl text-center mb-2">
              {t(pendingAiring?.kind === 'aired' ? 'details.airing.aired' : 'details.airing.warningTitle')}
            </DialogTitle>
            {pendingAiring && (
              <p className="text-yellow-200 text-center mb-3">
                {getAiringLabel(pendingAiring, t, i18n.language, airingNow)}
              </p>
            )}
            <DialogDescription className="text-gray-300 text-center mb-6">
              {t(pendingAiring?.kind === 'aired' ? 'details.airing.availabilityNote' : 'details.airing.warningDescription')}
            </DialogDescription>
            <div className="flex flex-wrap justify-center gap-4 mt-2">
              <button
                className="px-6 py-3 bg-gray-700 text-white rounded-lg font-medium hover:bg-gray-600 transition-colors"
                onClick={() => {
                  setEpisodeWarningOpen(false);
                }}
              >
                {t('details.cancel')}
              </button>
              <button
                className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
                onClick={() => {
                  setEpisodeWarningOpen(false);
                  if (pendingEpisode && id) {
                    navigate(`/watch/tv/${encodeId(id)}/s/${pendingEpisode.season}/e/${pendingEpisode.episode}`);
                  }
                }}
              >
                {t('details.continueAnyway')}
              </button>
            </div>
          </DialogContent>
      </Dialog>

      {/* Popup de la bande-annonce */}
      {showTrailerPopup && trailerVideo && (
        <AnimatePresence mode="wait">
          {!isClosingTrailer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/90 flex items-center justify-center p-2 sm:p-4 z-[100000]"
              onClick={handleCloseTrailer}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-6xl bg-gray-900 rounded-2xl overflow-hidden relative"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-4 flex justify-between items-center border-b border-gray-800">
                  <h3 className="text-xl font-semibold text-white">{t('details.bandeAnnonce')} - {tvShow?.name}</h3>
                  <motion.button
                    onClick={handleCloseTrailer}
                    className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <X className="h-6 w-6" />
                  </motion.button>
                </div>
                <div className="aspect-w-16 aspect-h-9">
                  <iframe
                    src={`https://www.youtube.com/embed/${trailerVideo.key}?autoplay=1`}
                    title={trailerVideo.name}
                    className="w-full h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px]"
                    allowFullScreen
                    allow="autoplay"
                  ></iframe>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <MovixRatingInfoModal
        isOpen={showMovixRatingInfo}
        onClose={() => setShowMovixRatingInfo(false)}
      />
    </MotionConfig>
  );
};

export default TVDetails;
