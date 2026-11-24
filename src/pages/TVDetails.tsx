import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import axios from 'axios';
import { Loader, Star, Calendar, List, Check, ChevronRight, AlertTriangle, Play, X, Download, EyeOff, Tv, Search, ArrowDownUp, LayoutGrid } from '../components/icons/Icons8';
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
  const [, setLoadingAnimeData] = useState<boolean>(false);
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
          </div>

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
