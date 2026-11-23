import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Film, X, Download } from '../components/icons/Icons8';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import AddToListButton from '../components/AddToListButton';
import DetailsSkeleton from '../components/skeletons/DetailsSkeleton';

import { useAdFreePopup } from '../context/AdFreePopupContext';
import { encodeId, getTmdbId } from '../utils/idEncoder';
import { buildWatchMoviePath, getVersionForRetiredId } from '../config/movieVersions';
import LikeDislikeButton, { type LikeDislikeStats } from '../components/LikeDislikeButton';
import MovixRatingInfoModal from '../components/MovixRatingInfoModal';
import { useWrappedTracker } from '../hooks/useWrappedTracker';
import { buildSiteUrl } from '../config/runtime';
import SEO from '../components/SEO';
import { getTmdbLanguage } from '../i18n';
import i18n from '../i18n';
import { useProfile } from '../context/ProfileContext';
import { getClassificationLabel as getClassificationLabelUtil, isContentAllowed } from '../utils/certificationUtils';
import { isLikelyAnime } from '../utils/animeSignals';
import { loadDetailCharacters, type DetailCharacters } from '../services/detailCharacters';
import { normalizeAlternateTitles, normalizeKeywords, type AlternateTitle } from '../utils/tmdbMetadata';
import { rememberMedia } from '../utils/mediaSearchIndex';
import { formatMovieReleaseDate, getMovieReleaseLabel, isMovieReleaseDatePending, needsMovieReleaseWarning, parseMovieReleases } from '@/utils/movieRelease';
import { useMovieReleaseWarnings } from '@/hooks/useMovieReleaseWarnings';
import { useImageQuality, useImageViewport } from '../hooks/useImageQuality';
import { getCoverImageWidth, getTmdbImageUrl } from '../utils/tmdbImages';
import { readLocalStorage, writeLocalStorage } from '../utils/browserStorage';
import { useTitleHistory } from '../hooks/useTitleHistory';
import { movieResume, seedProgress } from '../utils/titleHistoryMerge';
import { EstimateInfoDialog } from '../components/profile/EstimateInfo';
import DetailHero from '../components/details/DetailHero';
import DetailCastRail from '../components/details/DetailCastRail';
import DetailRecommendations from '../components/details/DetailRecommendations';
import DetailComments from '../components/details/DetailComments';
import type { Media } from '../components/EmblaCarousel';


const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

const parseStoredMediaList = (stored: string | null): any[] | null => {
  if (stored === null) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readStoredMediaList = (key: string): any[] | null => {
  try {
    return parseStoredMediaList(window.localStorage.getItem(key));
  } catch {
    return null;
  }
};


interface Movie {
  title: string;
  overview: string;
  poster_path: string;
  release_date: string;
  vote_average: number;
  genres: { id: number; name: string }[];
  runtime: number;
  backdrop_path?: string;
}

interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface CrewMember {
  id: number;
  name: string;
  job: string;
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
}

interface MovieExtended extends Movie {
  production_companies?: { id: number; name: string; logo_path: string | null }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; name: string }[];
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  budget?: number;
  revenue?: number;
  status?: string;
  original_language?: string;
  original_title?: string;
  /** Arrivent par `append_to_response`, d'où les deux formes propres à TMDB. */
  keywords?: { keywords?: Array<{ id: number; name: string }> };
  alternative_titles?: { titles?: Array<{ iso_3166_1?: string; title?: string; type?: string }> };
}

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

// Ajout de l'interface Collection manquante
interface Collection {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Array<{
    id: number;
    title: string;
    poster_path: string | null;
    release_date: string;
    vote_average: number;
    overview?: string;
  }>;
}

// Constante pour activer/désactiver la vérification VIP pour le bouton download
const ENABLE_VIP_DOWNLOAD_CHECK = false;

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

const DEFAULT_IMAGE = 'https://via.placeholder.com/185x278/1F2937/FFFFFF?text=Aucune+image';

// Composant pour une image avec lazy loading

// Composant pour la section Images

// Définir une interface NextMovieType pour le film suivant
interface NextMovieType {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  poster_path: string;
  runtime: number;
}

const MovieDetails = (): JSX.Element => {
  const { t } = useTranslation();
  const { effectiveImageQuality } = useImageQuality();
  const { width: viewportWidth, height: viewportHeight, dpr } = useImageViewport();
  const imageDpr = Math.min(dpr, effectiveImageQuality === 'high' ? 3 : 2);
  const { id: encodedId } = useParams<{ id: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  const navigate = useNavigate();
  const location = useLocation();
  const { resetVipStatus } = useAdFreePopup(); // Récupérer la fonction reset
  const { currentProfile } = useProfile();

  // Track page visit for Movix Wrapped
  useWrappedTracker({
    mode: 'page',
    pageData: id ? { pageName: 'movie-details', contentId: id } : undefined,
  });

  const [movie, setMovie] = useState<MovieExtended | null>(null);
  const movieReleaseWarningsEnabled = useMovieReleaseWarnings();
  const [releaseDates, setReleaseDates] = useState<{ id: string; data: unknown } | null>(null);
  const [releaseNow, setReleaseNow] = useState(Date.now);
  const releaseWarningRef = useRef<HTMLHeadingElement>(null);
  const movieReleases = useMemo(() => parseMovieReleases(
    releaseDates?.id === id ? releaseDates.data : null, movie?.release_date,
  ), [id, movie?.release_date, releaseDates]);

  useEffect(() => {
    const update = () => setReleaseNow(Date.now());
    update();
    const interval = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const [, setMovixVoteStats] = useState<LikeDislikeStats>({ likes: 0, dislikes: 0 });
  const [showMovixRatingInfo, setShowMovixRatingInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trailerVideoId, setTrailerVideoId] = useState<string | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  // Le générique complet, pour la galerie de personnages : `cast` reste tronqué
  // à vingt pour l'onglet Distribution, qui n'a pas la même vocation.
  const [fullCast, setFullCast] = useState<CastMember[]>([]);
  const [, setCrew] = useState<GroupedCrewMember[]>([]);
  const [characters, setCharacters] = useState<DetailCharacters | null>(null);
  const [, setCharactersLoading] = useState(false);
  const [alternateTitles, setAlternateTitles] = useState<AlternateTitle[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [bestBackdrop, setBestBackdrop] = useState<TMDBImage | null>(null);
  const [showTrailerPopup, setShowTrailerPopup] = useState(false);
  const [isClosingTrailer, setIsClosingTrailer] = useState(false);

  useEffect(() => {
    setMovixVoteStats({ likes: 0, dislikes: 0 });
  }, [id]);


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

  // Mode cinéma toujours activé  // Add new state for financial stats mode
  const [watchProgress, setWatchProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [hasProgress, setHasProgress] = useState(false);  const [, setVideos] = useState<any[]>([]);
  const [, setLoadingVideos] = useState(false);

  // États pour les vidéos multi-langues
  const [, setWatchStatus] = useState<WatchStatus>({
    watchlist: false,
    favorite: false,
    watched: false
  });
  // Historique serveur du film (autre appareil, lecteurs web, « Déjà vu ») :
  // le stockage local gagne toujours, le serveur comble ce qui manque.
  const titleHistory = useTitleHistory('movie', id);
  const [estimateInfoOpen, setEstimateInfoOpen] = useState(false);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [, setLoadingSimilar] = useState(false);
  // Nouvel état pour le film suivant recommandé (film disponible)
  const [, setNextRecommendedMovie] = useState<NextMovieType | null>(null);
  const [collection] = useState<Collection | null>(null);  const [certifications, setCertifications] = useState<{ [key: string]: string }>({});

  // État pour la popup vidéo
  const [showVideoPopup, setShowVideoPopup] = useState(false);
  const [selectedVideo] = useState<any>(null);
  const [isClosingVideo, setIsClosingVideo] = useState(false);

  const [, setIsTabsScrollable] = useState(false);
  const tabsContainerRef = useRef<HTMLDivElement>(null);



  // Ajouter un state pour le hover des cartes de la collection (juste après la déclaration des autres states)
  const [isCollectionCardHovered] = useState(false);
  const [, setShowCollectionLeftButton] = useState(false);
  const [, setShowCollectionRightButton] = useState(true);
  const collectionRowRef = useRef<HTMLDivElement>(null);
  // Référence pour la section commentaires
  const commentsRef = useRef<HTMLDivElement>(null);

  // Vérifier si la barre d'onglets est scrollable
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
  }, [movie?.belongs_to_collection]);

  // Réinitialiser le statut VIP quand l'ID du film change
  useEffect(() => {
    resetVipStatus();
  }, [id, resetVipStatus]);

  /**
   * Les personnages de la fiche. AniList est tentée quand le film a le profil
   * d'un anime — un long-métrage japonais animé y est mieux décrit que par un
   * générique — et le générique TMDB prend le relais sinon, ou si AniList ne
   * connaît pas l'œuvre.
   */
  useEffect(() => {
    if (!movie) return;
    let stale = false;
    setCharactersLoading(true);

    void loadDetailCharacters({
      looksLikeAnime: isLikelyAnime(
        {
          original_language: movie.original_language,
          production_companies: movie.production_companies,
          genres: movie.genres,
        },
        { results: movie.keywords?.keywords ?? [] },
      ),
      anilistTitles: [movie.original_title, movie.title].filter((title): title is string => Boolean(title)),
      cast: fullCast,
    })
      .then((result) => { if (!stale) setCharacters(result); })
      .catch(() => { if (!stale) setCharacters(null); })
      .finally(() => { if (!stale) setCharactersLoading(false); });

    return () => { stale = true; };
  }, [movie, fullCast]);


  // Declare fetchMovieDetails type before using it
  /**
   * Ce que la fiche vient de récupérer alimente le catalogue local de
   * recherche. Titres alternatifs, mots-clés, thèmes et noms de personnages
   * sont exactement ce que `search/multi` ne sait pas trouver : les garder
   * rend la fiche retrouvable par ces mots-là (voir `utils/mediaSearchIndex`).
   */
  useEffect(() => {
    if (!movie || !id) return;
    rememberMedia({
      mediaType: 'movie',
      id: Number(id),
      title: movie.title,
      posterPath: movie.poster_path,
      backdropPath: movie.backdrop_path,
      date: movie.release_date,
      voteAverage: movie.vote_average,
      genreIds: movie.genres?.map((genre) => genre.id),
      overview: movie.overview,
      terms: [
        movie.original_title,
        ...alternateTitles.map((entry) => entry.title),
        ...keywords,
        ...(characters?.themes ?? []),
        ...(characters?.groups.flatMap((group) => group.characters.map((item) => item.name)) ?? []),
      ].filter((term): term is string => Boolean(term)),
    });
  }, [movie, id, alternateTitles, keywords, characters]);


  const fetchMovieDetails = useCallback(async (): Promise<MovieExtended | undefined> => {
    if (!id) return undefined;
    try {
      setLoading(true);
      // `append_to_response` plutôt que deux requêtes de plus : mots-clés et
      // titres alternatifs voyagent avec la fiche, sans aller-retour en sus.
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}&append_to_response=keywords,alternative_titles`
      );
      // TMDB renvoie un résumé vide quand la traduction n'existe pas, alors
      // que son site affiche le texte anglais : on fait pareil.
      if (!response.data?.overview?.trim() && !getTmdbLanguage().startsWith('en')) {
        try {
          const en = await axios.get(`https://api.themoviedb.org/3/movie/${id}`, {
            params: { api_key: TMDB_API_KEY, language: 'en-US' },
          });
          if (en.data?.overview) response.data.overview = en.data.overview;
          if (!response.data.tagline && en.data?.tagline) response.data.tagline = en.data.tagline;
        } catch { /* le résumé reste vide */ }
      }
      setMovie(response.data);
      setKeywords(normalizeKeywords(response.data?.keywords, getTmdbLanguage()));
      setAlternateTitles(normalizeAlternateTitles(response.data?.alternative_titles, [
        response.data?.title, response.data?.original_title,
      ]));

      // Also fetch credits
      const creditsResponse = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}/credits?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
      );
      setCast(creditsResponse.data.cast.slice(0, 20));
      setFullCast(creditsResponse.data.cast || []);
      setCrew(groupCrewMembers(creditsResponse.data.crew));

      const releaseDatesResponse = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}/release_dates?api_key=${TMDB_API_KEY}`
      );
      // La même réponse alimente les dates et les classifications existantes.
      setReleaseDates({ id, data: releaseDatesResponse.data });
      const releaseDatesData = releaseDatesResponse.data.results;
      const newCertifications: { [key: string]: string } = {};
      const frRelease = releaseDatesData.find((r: any) => r.iso_3166_1 === 'FR');
      if (frRelease && frRelease.release_dates) {
        const theatricalRelease = frRelease.release_dates.find((rd: any) => rd.type === 3 || rd.type === 2); // Theatrical or Theatrical (limited)
        if (theatricalRelease && theatricalRelease.certification) {
          newCertifications['FR'] = theatricalRelease.certification;
        }
      }
      if (!newCertifications['FR']) {
        const usRelease = releaseDatesData.find((r: any) => r.iso_3166_1 === 'US');
        if (usRelease && usRelease.release_dates) {
          const theatricalRelease = usRelease.release_dates.find((rd: any) => rd.certification !== "");
          if (theatricalRelease && theatricalRelease.certification) {
            newCertifications['US'] = theatricalRelease.certification;
          }
        }
      }
      setCertifications(newCertifications);

      // Check if movie belongs to a collection (Loaded lazily on tab click)
      // if (response.data.belongs_to_collection) {
      //   fetchCollection(response.data.belongs_to_collection.id);
      // }

      return response.data;
    } catch (error) {
      console.error("Error fetching movie details:", error);
      setError(t('details.movieLoadError'));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Use fetchData to call fetchMovieDetails

  // Ajouter une fonction pour récupérer les détails de la collection

  // Function to fetch movie videos
  const fetchMovieVideos = useCallback(async () => {
    if (!id) return;
    try {
      console.log('Fetching videos for movie:', id);
      setLoadingVideos(true);
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}/videos`,
        {
          params: {
            api_key: TMDB_API_KEY,
            language: getTmdbLanguage()
          }
        }
      );

      // First try to get French videos
      let fetchedVideos = response.data.results;
      console.log('French videos response:', fetchedVideos);

      // If no French videos, try English
      if (fetchedVideos.length === 0) {
        console.log('No French videos found, trying English...');
        const enResponse = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}/videos`,
          {
            params: {
              api_key: TMDB_API_KEY,
              language: 'en-US'
            }
          }
        );
        fetchedVideos = enResponse.data.results;
        console.log('English videos response:', fetchedVideos);
      }

      setVideos(fetchedVideos);

      // Set trailer for the trailer popup
      const trailer = fetchedVideos.find((v: any) => v.type === 'Trailer');
      if (trailer) {
        console.log('Trailer found:', trailer);
        setTrailerVideoId(trailer.key);
      } else {
        console.log('No trailer found for this movie');
        setTrailerVideoId(null);
      }
    } catch (error) {
      console.error('Error fetching videos:', error);
      setTrailerVideoId(null);
    } finally {
      setLoadingVideos(false);
    }
  }, [id]);

  // Function to fetch multi-language videos

  // Fetch trailer on page load so the Bande-annonce button is enabled
  useEffect(() => {
    fetchMovieVideos().then(() => setVideosLoaded(true));
  }, [fetchMovieVideos]);

  // State to track if videos have been loaded (for click-to-load behavior)
  const [, setVideosLoaded] = useState(false);

  // Handler for when Videos tab is clicked - loads videos on demand

  // Function to fetch images

  // Handler for when Images tab is clicked

  // Handler for when Collection tab is clicked

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Only fetch movie details initially - videos are loaded on demand
        await fetchMovieDetails();
      } catch (error) {
        console.error('Error:', error);
        setError(t('details.dataLoadError'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, fetchMovieDetails]);

  useEffect(() => {
    const loadWatchStatus = () => {
      const watchlistItems = readStoredMediaList('watchlist_movie') ?? [];
      const favoriteItems = readStoredMediaList('favorite_movie') ?? [];
      const watchedItems = readStoredMediaList('watched_movie') ?? [];

      setWatchStatus({
        watchlist: watchlistItems.some((item: any) => item?.id === Number(id)),
        favorite: favoriteItems.some((item: any) => item?.id === Number(id)),
        watched: watchedItems.some((item: any) => item?.id === Number(id))
      });
    };

    loadWatchStatus();
  }, [id]);


  // Vu et reprise fusionnés avec le serveur. Une clé progress_ locale, même
  // finie, gagne : le serveur ne sert que s'il n'y en a pas.
  const serverResume = id && !hasProgress && !readLocalStorage(`progress_${id}`) ? movieResume(null, titleHistory) : null;

  // Convert WatchButtons to a regular function to access parent scope variables
  function WatchButtons() {
    // Format time from seconds to MM:SS or HH:MM:SS if hours > 0
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

    return (
      <div className="mt-5 flex w-full max-w-full flex-col gap-3 bg-transparent p-0">
        <div className="flex w-fit max-w-full flex-wrap items-center gap-2.5">
          <motion.button
            whileHover={{ y: -2, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            onClick={handleWatchClick}
            className="group relative inline-flex min-h-11 min-w-[138px] flex-row items-center justify-center gap-2.5 overflow-hidden rounded-lg border border-white bg-white px-5 py-2.5 text-sm font-bold text-[#151515] shadow-[0_8px_22px_rgba(0,0,0,0.22)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90"
          >
            {hasProgress ? (
              <>
                <img src="/icons/play-button-icon.png" alt="" aria-hidden="true" className="h-5 w-5 flex-shrink-0 object-contain transition-transform duration-300 group-hover:scale-110" />
                <div className="flex min-w-0 flex-col items-start text-left">
                  <span>{t('details.continueBtn')}</span>
                  <span className="mt-1 rounded-md bg-black/[0.07] px-2 py-0.5 text-[11px] font-semibold text-black/75">
                    {formatTime(watchProgress)}/{formatTime(videoDuration)}
                  </span>
                </div>
              </>
            ) : serverResume ? (
              <>
                <img src="/icons/play-button-icon.png" alt="" aria-hidden="true" className="h-5 w-5 flex-shrink-0 object-contain" />
                <div className="flex min-w-0 flex-col items-start text-left">
                  {/* Estimé seul : le lecteur repartira du début, donc « Regarder ». */}
                  <span>{serverResume.estimated ? t('details.watchBtn') : t('details.continueBtn')}</span>
                  <span className="mt-1 rounded-md border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] font-medium text-white/85">
                    {serverResume.estimated
                      ? t('profilePage.progress.estimated', { percent: Math.round((serverResume.position / serverResume.duration) * 100), defaultValue: '≈ {{percent}} % · estimé' })
                      : `${formatTime(serverResume.position)}/${formatTime(serverResume.duration)}`}
                  </span>
                </div>
              </>
            ) : (
              <>
                <img src="/icons/play-button-icon.png" alt="" aria-hidden="true" className="h-5 w-5 flex-shrink-0 object-contain" />
                <span className="text-left">{t('details.watchBtn')}</span>
              </>
            )}
          </motion.button>
          <AddToListButton
            mediaId={Number(id)}
            mediaType="movie"
            title={movie?.title || ''}
            posterPath={movie?.poster_path || ''}
          />
          {(!ENABLE_VIP_DOWNLOAD_CHECK || readLocalStorage('is_vip') === 'true') && (
            <motion.button
              whileHover={{ y: -2, scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              onClick={() => navigate(`/download/movie/${id}`, { state: { backgroundLocation: location } })}
              className="inline-flex min-h-11 min-w-[138px] flex-row items-center justify-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.19] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(0,0,0,0.18)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.27]"
            >
              <Download className="h-5 w-5 flex-shrink-0 text-white" />
              <span className="text-left">{t('details.downloadBtn')}</span>
            </motion.button>
          )}
        </div>
      </div>
    );
  }



  // Watch progress tracking functionality removed

  const handleWatchClick = () => startWatching();

  const startWatching = () => {
    if (!id) return;
    if (movieReleaseWarningsEnabled && needsMovieReleaseWarning(movieReleases, Date.now())) {
      scrollToPlayer();
      releaseWarningRef.current?.focus({ preventScroll: true });
      return;
    }
    // Reprise venue du serveur : le lecteur ne lit que progress_ local, on
    // y recopie la position exacte (jamais un estimé de lecteur web).
    // Relu au clic : une position locale apparue depuis le rendu gagne.
    const seed = serverResume && !readLocalStorage(`progress_${id}`)
      ? seedProgress(serverResume, new Date().toISOString())
      : null;
    if (seed) writeLocalStorage(`progress_${id}`, seed);
    // Mode cinéma toujours actif - naviguer vers la page de visionnage
    navigate(buildWatchMoviePath(encodeId(id)));
  };

  const fetchRecommendations = async () => {
    setLoadingSimilar(true);
    try {
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}/recommendations?api_key=${TMDB_API_KEY}&language=${getTmdbLanguage()}`
      );
      console.log('Films recommandés:', response.data.results);
      const movies = response.data.results.slice(0, 20);

      // Ne plus vérifier la disponibilité sur frembed, retourner directement les résultats TMDB
      const availableMovies = movies.map((movie: any) => ({ ...movie, isAvailable: true }));
      console.log('Films disponibles:', availableMovies);
      setRecommendations(availableMovies);

      // Définir le film suivant recommandé s'il y en a un disponible
      if (availableMovies.length > 0) {
        setNextRecommendedMovie(availableMovies[0]);
      }
    } catch (error) {
      console.error('Error fetching recommendations:', error);
    } finally {
      setLoadingSimilar(false);
    }
  };


  useEffect(() => {
    if (id && movie && recommendations.length === 0) {
      fetchRecommendations();
    }
  }, [id, movie]);

  useEffect(() => {
    // Setup SEO and movie data
    if (movie) {

      // Simple movie title
      document.title = `${movie.title} - Movix`;
    } else {
      document.title = 'Film - Movix';
    }
  }, [movie, id]);

  const scrollToPlayer = () => {
    const playerSection = document.getElementById('video-player-section');
    if (playerSection) {
      playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const fetchMovieImages = async () => {
    try {
      const response = await axios.get(`https://api.themoviedb.org/3/movie/${id}/images`, {
        params: { api_key: TMDB_API_KEY },
      });

      // Trouver la meilleure image de fond
      const backdrops = response.data.backdrops;
      if (backdrops && backdrops.length > 0) {
        // Trier par résolution et choisir la meilleure
        const largestBackdrop = backdrops.sort((a: TMDBImage, b: TMDBImage) => b.width - a.width)[0];
        setBestBackdrop(largestBackdrop);
      }
    } catch (error) {
      console.error('Error fetching movie images:', error);
    }
  };

  useEffect(() => {
    setBestBackdrop(null);
    if (id) {
      fetchMovieImages();
    }
  }, [id]);



  // Ajouter les fonctions de gestion de scroll de la collection (juste après les fonctions pour similarRow)
  const handleCollectionRowScroll = () => {
    if (collectionRowRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = collectionRowRef.current;
      setShowCollectionLeftButton(scrollLeft > 0);
      setShowCollectionRightButton(scrollLeft < scrollWidth - clientWidth);
    }
  };


  // Ajouter un useEffect pour gérer le scroll sur hover de la collection
  useEffect(() => {
    const container = collectionRowRef.current;
    if (!container) return;
    if (!isCollectionCardHovered) return;

    // Prevent horizontal scroll but allow vertical scroll
    const preventScroll = (e: Event) => {
      if (e instanceof WheelEvent && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
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
  }, [isCollectionCardHovered]);

  // Ajout de ce useEffect pour définir l'état initial des boutons de la collection
  useEffect(() => {
    // Attendre que la collection soit chargée et que la ref soit définie
    if (collection && collectionRowRef.current) {
      // Appeler la fonction de scroll pour définir l'état initial
      handleCollectionRowScroll();

      // Optionnel: Ajouter un écouteur de redimensionnement pour recalculer si nécessaire
      const handleResize = () => handleCollectionRowScroll();
      window.addEventListener('resize', handleResize);

      // Nettoyage de l'écouteur
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [collection]); // Déclenché lorsque la collection change

  // Progress loading functionality removed

  useEffect(() => {
    // Load watch progress when movie ID changes
    if (id) {
      const progressKey = `progress_${id}`;
      const savedData = readLocalStorage(progressKey);

      if (savedData) {
        try {
          const progressData = JSON.parse(savedData);
          if (progressData.position && progressData.duration) {
            // Only show resume if at least 30 seconds have been watched
            // and if less than 95% of the movie has been watched
            const percentage = (progressData.position / progressData.duration) * 100;
            if (progressData.position > 30 && percentage < 95) {
              setWatchProgress(progressData.position);
              setVideoDuration(progressData.duration);
              setHasProgress(true);
            } else {
              setHasProgress(false);
            }
          }
        } catch (error) {
          console.error("Error parsing progress data:", error);
          setHasProgress(false);
        }
      } else {
        setHasProgress(false);
      }
    }
  }, [id]);

  if (loading) {
    return <DetailsSkeleton />;
  }
  if (error) return <div className="text-center text-red-500">{error}</div>;
  if (!movie) return <div className="text-left">{t('details.movieNotFound')}</div>;

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

  // Trouver le réalisateur, s'il existe
  const movieYear = movie.release_date && !isNaN(new Date(movie.release_date).getTime())
    ? Number(movie.release_date.slice(0, 4))
    : null;
  const movieIsReleased = movieReleases.referenceDate !== null
    && !isMovieReleaseDatePending(movieReleases.referenceDate, releaseNow);
  const movieTitle = movieYear ? `${movie.title} (${movieYear}) - Movix` : `${movie.title} - Movix`;
  const movieCanonicalUrl = buildSiteUrl(`/movie/${encodedId || id}`);
  const movieSocialImage = movie.backdrop_path || movie.poster_path
    ? `https://image.tmdb.org/t/p/original${movie.backdrop_path || movie.poster_path}`
    : undefined;
  const movieDescription = movie.overview?.trim() || `Découvrez ${movie.title} sur Movix.`;
  const posterCssWidth = viewportWidth < 768
    ? viewportWidth - 32
    : viewportWidth < 1024
      ? (viewportWidth - 128) / 3
      : (viewportWidth - 192) / 3;
  const mainPosterUrl = getTmdbImageUrl(movie.poster_path, {
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

  return (
    <MotionConfig reducedMotion="user">
      <SEO
        title={movieTitle}
        description={movieDescription}
        ogType="video.movie"
        ogUrl={movieCanonicalUrl}
        ogImage={movieSocialImage}
        canonical={movieCanonicalUrl}
      />
      <style>
        {`
          /* Netflix-style poster hover effects - COPIED FROM Home.tsx */
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
            margin: 0 -0.5rem -5rem -0.5rem; /* Ajuster la marge inférieure si nécessaire */
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
          /* This pushes all posters after the hovered one to the right */
          .poster-container:hover ~ .poster-container {
            transform: translateX(0); /* Reset previous rule */
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
          /* Décaler les cards suivantes quand l'animation de hover est active */
          .poster-container:has(.poster-card:hover) ~ .poster-container {
            transform: translateX(100px);
          }
          /* Solution de secours pour les navigateurs ne supportant pas :has */
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
          /* Fin des styles copiés de Home.tsx pour le hover */

          /* Styles existants pour section-title et no-scroll (vérifier s'ils sont nécessaires) */
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
          .no-scroll {
            overflow: hidden !important; /* Cache TOUT overflow, pas seulement horizontal */
            pointer-events: none !important; /* Désactive TOUS les événements de souris */
            touch-action: none !important; /* Désactive les événements tactiles */
            user-select: none !important; /* Empêche la sélection de texte */
            isolation: isolate; /* Crée un nouveau contexte d'empilement */
          }
          /* Réactiver uniquement pour les enfants directs */
          .no-scroll > * {
            pointer-events: auto !important;
          }
        `}
      </style>


      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="detail-page relative z-10 min-h-screen bg-black text-white px-4 md:px-8 lg:px-16 py-6"
      >
        {/* Titre sémantique conservé pour l'accessibilité ; le titre visible est dans le hero. */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="hidden"
        >
          <h1 className="section-title text-4xl md:text-5xl font-bold">
            {movie.title} {movieYear && <>({movieYear})</>}
            {!movieReleaseWarningsEnabled && (
              <span className={`inline-block ml-2 align-middle text-sm font-medium px-2 py-1 rounded-md ${movieIsReleased ? 'bg-green-700 text-white' : 'bg-yellow-800 text-yellow-50'}`}>
                {t(movieIsReleased ? 'details.releasedBadge' : 'details.notReleasedBadge')}
              </span>
            )}
          </h1>
          {movieReleaseWarningsEnabled && (
            <>
              <div className="mt-3 flex flex-wrap items-start gap-2 text-sm font-medium">
                <span data-halloween-frame="orange" className={`max-w-full px-2 py-1 rounded-md ${movieReleases.homeVideo && isMovieReleaseDatePending(movieReleases.homeVideo.date, releaseNow) ? 'bg-yellow-800 text-yellow-50' : 'bg-gray-800 text-gray-100'}`}>
                  {getMovieReleaseLabel(movieReleases.homeVideo, 'homeVideo', t, i18n.language, releaseNow)}
                </span>
                {movieReleases.theatrical ? (
                  <span data-halloween-frame="green" className="max-w-full px-2 py-1 rounded-md bg-gray-800 text-gray-100">
                    {getMovieReleaseLabel(movieReleases.theatrical, 'theatrical', t, i18n.language, releaseNow)}
                  </span>
                ) : movieReleases.referenceDate && (
                  <span data-halloween-frame="green" className="max-w-full px-2 py-1 rounded-md bg-gray-800 text-gray-100">
                    {t('details.movieRelease.announcedDate', { date: formatMovieReleaseDate(movieReleases.referenceDate, i18n.language) })}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-400">{t('details.movieRelease.availabilityNote')}</p>
            </>
          )}
        </motion.div>

        {/* Hero cinématique pleine largeur ; synopsis et détails restent en dessous. */}
        <div className="grid grid-cols-1 gap-8">
          <DetailHero
            title={movie.title}
            year={movieYear}
            rating={movie.vote_average}
            runtime={movie.runtime > 0 ? `${Math.floor(movie.runtime / 60)}h ${String(movie.runtime % 60).padStart(2, '0')}min` : null}
            classification={contentCert ? getClassificationLabel(contentCert, t) : null}
            genres={movie.genres || []}
            synopsis={movie.overview}
            imageUrl={backdropImage}
            fallbackImageUrl={mainPosterUrl}
            genreHref={(genreId) => `/genre/movie/${genreId}`}
            seasonLabel={t('details.seasonsLabel')}
            episodeLabel={t('details.episodesLabel')}
            badges={
              <>
                {!movieReleaseWarningsEnabled && (
                  <span className={movieIsReleased ? 'rounded-md bg-emerald-600/90 px-2.5 py-1 text-xs font-bold text-white' : 'rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-bold text-black'}>
                    {t(movieIsReleased ? 'details.releasedBadge' : 'details.notReleasedBadge')}
                  </span>
                )}
                {movieReleaseWarningsEnabled && (
                  <>
                    <span data-halloween-frame="orange" className="rounded-md border border-white/15 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                      {getMovieReleaseLabel(movieReleases.homeVideo, 'homeVideo', t, i18n.language, releaseNow)}
                    </span>
                    {movieReleases.theatrical ? (
                      <span data-halloween-frame="green" className="rounded-md border border-white/15 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        {getMovieReleaseLabel(movieReleases.theatrical, 'theatrical', t, i18n.language, releaseNow)}
                      </span>
                    ) : movieReleases.referenceDate && (
                      <span data-halloween-frame="green" className="rounded-md border border-white/15 bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                        {t('details.movieRelease.announcedDate', { date: formatMovieReleaseDate(movieReleases.referenceDate, i18n.language) })}
                      </span>
                    )}
                  </>
                )}
              </>
            }
            note={movieReleaseWarningsEnabled ? <p>{t('details.movieRelease.availabilityNote')}</p> : undefined}
            actions={
              <>
                <WatchButtons />
                <EstimateInfoDialog open={estimateInfoOpen} onOpenChange={setEstimateInfoOpen} />
              </>
            }
          />


        <div className="detail-content-shell mx-auto w-full max-w-[1720px] px-0 sm:px-2">
          <div className="detail-section flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
            <LikeDislikeButton
              contentType="movie"
              contentId={id || ''}
              onStatsChange={setMovixVoteStats}
            />
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
        </div>

        <DetailRecommendations
          items={recommendations.map((item) => ({
            id: item.id,
            title: item.title,
            poster_path: item.poster_path || '',
            backdrop_path: item.backdrop_path || '',
            overview: item.overview || '',
            vote_average: item.vote_average || 0,
            release_date: item.release_date,
            media_type: 'movie' as const,
          })) as Media[]}
          mediaType="movie-similar"
        />

        <DetailComments contentType="movie" contentId={id!} anchorRef={commentsRef} />

        {/* Modal Rapport */}




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

        {/* Modal pour la bande-annonce */}
        {showTrailerPopup && (
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
                    <h3 className="text-xl font-semibold text-white">{t('details.bandeAnnonce')} - {movie?.title}</h3>
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
                    {trailerVideoId ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${trailerVideoId}?autoplay=1`}
                        title={`${t('details.bandeAnnonce')} - ${movie?.title}`}
                        className="w-full h-[300px] sm:h-[400px] md:h-[500px] lg:h-[600px]"
                        allowFullScreen
                        allow="autoplay"
                      ></iframe>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900">
                        <Film className="w-12 h-12 text-gray-600 mb-4" />
                        <p className="text-gray-400 text-lg">{t('details.noTrailerAvailable')}</p>
                      </div>
                    )}
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


      </motion.div>
    </MotionConfig>
  );
};

// Ancien ID TMDB supprimé (ex. Avengers Endgame: Encore) → fiche du film parent.
const MovieDetailsRoute = (): JSX.Element => {
  const { id: encodedId } = useParams<{ id: string }>();
  const retired = getVersionForRetiredId(encodedId ? getTmdbId(encodedId) : null);
  if (retired) return <Navigate replace to={`/movie/${encodeId(retired.tmdbId)}`} />;
  return <MovieDetails />;
};

export default MovieDetailsRoute;
