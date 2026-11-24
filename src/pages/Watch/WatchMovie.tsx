import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getFrembedBase } from '../../utils/frembedConfig';
import { openInNewTab } from '../../utils/openInNewTab';
import { safeEmbedUrl } from '../../utils/safeEmbedUrl';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import VidRiftPlayer from '../../components/VidRiftPlayer';
import { useAdFreePopup } from '../../context/AdFreePopupContext';
import AdFreePlayerAds from '../../components/AdFreePlayerAds';
import AdWaitingScreen from '@/components/AdWaitingScreen';
import { getAdPopupMode } from '../../utils/adPopupMode';
import { registerServerResolvedSources } from '../../utils/extractM3u8';
import type { SeekStreamingHlsSource } from '../../utils/seekStreamingCandidates';
import { runExtractionPass } from '../../utils/runExtractionPass';
import { sortHostersByPriority, hosterKeyOf } from '../../utils/sourceAutoSelect';


import { getSourcePriorityPrefs, subscribeToPriorityChanges } from '../../utils/sourcePriorityPrefs';
import { detectHoster } from '../../utils/hosterRegistry';
import { setLastPlayer } from '../../utils/lastPlayerPref';
import { encodeId, getTmdbId } from '../../utils/idEncoder';
import { buildWatchMoviePath, getMovieVersion, getVersionForRetiredId } from '../../config/movieVersions';
import { useWrappedTracker } from '../../hooks/useWrappedTracker';
import { useTmdbImages, withTmdbImageSize } from '../../hooks/useTmdbImages';
import { isUserVip } from '../../utils/authUtils';
import { serverResolveRequest } from '../../utils/serverResolveRequest';
import { isExtensionAvailable } from '../../utils/extensionProxy';
import { getTmdbLanguage } from '../../i18n';
import { useProfile } from '../../context/ProfileContext';
import { isContentAllowed, getClassificationLabel } from '../../utils/certificationUtils';
import { getCoflixPreferredUrl } from '../../utils/coflix';

import { type SwiftfluxEntry, type SwiftfluxPlayback } from '../../services/swiftfluxService';

import type { KisskhSource, KisskhSubtitleTrack } from '../../types/kisskh';
import { createHlsAutoFallbackGuard, resolveAcceptedWatchSource, resolveRenderedWatchSource, syncHlsActiveSource } from '../../utils/hlsAutoFallbackGuard';
import { readLocalStorage, writeLocalStorage } from '../../utils/browserStorage';



const MAIN_API = import.meta.env.VITE_MAIN_API;
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

const normalizeUqloadEmbedUrl = (url: string): string => {
  return url
    .replace(/uqload\.[a-z0-9-]+/gi, 'uqload.is')
    .replace(/uqload%2e[a-z0-9-]+/gi, 'uqload%2eis');
};

interface NextMovieType {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  poster_path: string;
  runtime: number;
}

interface OmegaMovieResponse {
  player_links: Array<{
    player: string;
    link: string;
    is_hd: boolean;
    label?: string;
  }>;
  version: string;
}

interface CoflixResponse {
  tmdb_details: {
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    poster_path: string;
    backdrop_path: string;
    overview: string;
    vote_average: number;
  };
  iframe_src: string;
  player_links: Array<{
    decoded_url: string;
    clone_url?: string;
    quality: string;
    language: string;
  }>;
}

interface WiflixMovieResponse {
  success: boolean;
  tmdb_id: string;
  title: string;
  original_title: string;
  wiflix_url: string;
  players: {
    vf: Array<{
      name: string;
      url: string;
      episode: number;
      type: string;
    }>;
    vostfr: Array<{
      name: string;
      url: string;
      episode: number;
      type: string;
    }>;
  };
  cache_timestamp: string;
}

// Interface pour la source 1jour1film (J1F) — meme forme que Wiflix
interface J1fMovieResponse {
  success: boolean;
  tmdb_id: string;
  title: string;
  original_title: string;
  source: '1jour1film';
  j1f_url: string;
  players: {
    vf: Array<{ name: string; url: string; type: string; label?: string; source?: string }>;
    vostfr: Array<{ name: string; url: string; type: string; label?: string; source?: string }>;
  };
  cache_timestamp: string;
}

// Interface pour la source SwiftFlow — meme forme que J1F (1jour1film)
interface SwiftflowMovieResponse {
  success: boolean;
  tmdb_id: number;
  title: string;
  year: number;
  source: 'swiftflow';
  players: {
    vf: Array<{ name: string; url: string; type: string; label?: string }>;
    vostfr: Array<{ name: string; url: string; type: string; label?: string }>;
  };
  cache_timestamp: string;
}

// Interface pour la source Viper (Cpasmal)
interface ViperMovieResponse {
  title: string;
  year: string;
  cpasmalUrl: string;
  links: {
    vf: Array<{ server: string; url: string }>;
    vostfr: Array<{ server: string; url: string }>;
  };
}

interface DarkinoResult {
  available: boolean;
  sources: NightflixSource[];
  darkinoId: string;
}

interface NightflixSource {
  src: string;
  m3u8: string;
  quality?: string;
  language?: string;
  sub?: string;
  label?: string;
}

type PlayerSourceType = 'vidy' | 'primary' | 'vostfr' | 'videasy' | 'vidsrccc' | 'vidsrcsu' | 'vidsrcwtf1' | 'vidsrcwtf5' | 'multi' | 'omega' | 'darkino' | 'mp4' | 'coflix' | 'frembed' | 'custom' | 'nexus_hls' | 'nexus_file' | 'wiflix' | 'j1f' | 'swiftflow' | 'swiftflux' | 'viper' | 'vidmoly' | 'dropload' | 'adfree' | 'bravo' | 'kisskh' | number;

function formatPremidSourceDetail(...parts: Array<string | null | undefined>) {
  const normalizedParts = parts
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .filter((part, index, array) =>
      array.findIndex(entry => entry.toLowerCase() === part.toLowerCase()) === index
    );

  return normalizedParts.length > 0 ? normalizedParts.join(' - ') : undefined;
}

// Helper functions - Check custom links from MySQL API
// Config commune des appels catalogue en contexte de lecture, pilotée par la
// méthode d'extraction choisie : en méthode serveur `resolve=1` + clé VIP, en
// méthode extension/userscript ni l'un ni l'autre (extraction 100 % locale).
//
// Une fonction et non une constante : `checkMovieAvailability` vit au niveau
// module, hors du composant, et la clé VIP comme la méthode doivent être
// relues à chaque appel plutôt que figées au chargement.
const resolveRequest = () => serverResolveRequest();

const checkMovieAvailability = async (movieId: string) => {
  try {
    const customLinks: string[] = [];
    const mp4Links: { url: string; label?: string; language?: string; isVip?: boolean }[] = [];

    // Fetch custom links from MySQL API
    try {
      // `resolve=1` : le serveur résout les m3u8 des liens communautaires de ce
      // film (ils viennent de sa base, pas du client). Enregistré tout de suite,
      // la table `m3u8ByPlayer` serait perdue en aval.
      const response = await axios.get(`${MAIN_API}/api/links/movie/${movieId}`, resolveRequest());
      registerServerResolvedSources(response.data);

      if (response.data && response.data.success && response.data.data && response.data.data.links) {
        const rawLinks = response.data.data.links;
        console.log('Raw API links:', rawLinks);

        const uniqueUrls = new Set<string>();

        rawLinks.forEach((item: any) => {
          if (typeof item === 'string') {
            if (item.toLowerCase().endsWith('.mp4') && !uniqueUrls.has(item)) {
              uniqueUrls.add(item);
              mp4Links.push({
                url: item,
                label: "Viblix",
                language: 'Français',
                isVip: false
              });
            } else {
              customLinks.push(item);
            }
          } else if (typeof item === 'object' && item !== null && typeof item.url === 'string') {
            if (item.url.toLowerCase().endsWith('.mp4') && !uniqueUrls.has(item.url)) {
              uniqueUrls.add(item.url);
              mp4Links.push({
                url: item.url,
                label: item.label || "Viblix",
                language: item.language || 'Français',
                isVip: item.isVip || false
              });
            } else {
              customLinks.push(item.url);
            }
          }
        });

        console.log('Processed API links - customLinks:', customLinks, 'mp4Links:', mp4Links);
      }
    } catch (apiError) {
      console.error('Error fetching custom links from API:', apiError);
    }

    // Check Frembed availability
    try {
      const frembedResponse = await axios.get(`${getFrembedBase()}/api/public/v1/movies/${movieId}`, { timeout: 1000 });
      console.log(`Checking Frembed for ID ${movieId}:`, frembedResponse.data);
      const result = frembedResponse.data?.result;
      const isFrembedAvailable = frembedResponse.data?.status === 200
        && (result?.total ?? result?.totalItems ?? result?.items?.length ?? 0) > 0;

      return {
        isAvailable: true,
        customLinks: customLinks || [],
        frembedAvailable: isFrembedAvailable,
        mp4Links: mp4Links || []
      };
    } catch (frembedError) {
      console.error('Error checking Frembed availability:', frembedError);
      return {
        isAvailable: true,
        customLinks: customLinks || [],
        frembedAvailable: false,
        mp4Links: mp4Links || []
      };
    }
  } catch (error) {
    console.error('Error checking availability:', error);
    return {
      isAvailable: true,
      customLinks: [],
      frembedAvailable: false,
      mp4Links: []
    };
  }
};

const checkDarkinoAvailability = async (
  _movieTitle: string,
  _releaseDate: string,
  _movieId: string,
  _updateRetryMessage?: (message: string) => void,
  _retryCount = 0
): Promise<DarkinoResult | false> => {
  // Source Darkino/Nightflix retiree : endpoints api.movix.chat/api/search + /api/films/download desactives.
  return false;
};

// Helper to pick Supervideo from Omega
function getSupervideoFromOmega(omegaData: OmegaMovieResponse | null) {
  if (!omegaData || !omegaData.player_links) return null;
  return omegaData.player_links.find(
    (p: { player: string; link: string; is_hd: boolean; label?: string }) => p.player && p.player.toLowerCase().includes('supervideo')
  );
}
// Helper to pick Multi (lecteur6.com) from Coflix
function getMultiFromCoflix(coflixData: CoflixResponse | null) {
  if (!coflixData || !coflixData.player_links) return null;
  return coflixData.player_links.find(
    (p: { decoded_url: string; clone_url?: string; quality: string; language: string }) => getCoflixPreferredUrl(p).includes('lecteur6.com')
  );
}

const WatchMovie: React.FC = () => {
  const { tmdbid: encodedId, version: versionKey } = useParams<{ tmdbid: string; version?: string }>();

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useProfile();

  const id = encodedId ? getTmdbId(encodedId) : null;
  // Version alternative (ex. Encore) : infos du film parent, liens de la
  // version seulement (voir src/config/movieVersions.ts).
  const movieVersion = getMovieVersion(id, versionKey);
  const linksId = movieVersion?.linksId ?? id;
  const autoFallbackGuard = useMemo(() => createHlsAutoFallbackGuard(2), [id]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingText, setLoadingText] = useState(t('watch.loadingSources'));
  const [movieTitle, setMovieTitle] = useState<string>('');
  const [backdropPath, setBackdropPath] = useState<string | null>(null);
  const [posterPath, setPosterPath] = useState<string | null>(null);
  // Poster localisé (langue d'interface > EN > sans langue) via l'endpoint
  // /images — le poster_path des détails TMDB retombe sur le poster par
  // défaut (souvent VO) quand la langue demandée n'a pas de poster.
  const { posterUrl: localizedPosterUrl } = useTmdbImages('movie', id ? Number(id) : undefined);
  const playerPoster = localizedPosterUrl
    ? withTmdbImageSize(localizedPosterUrl, 'w500')
    : (posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : undefined);
  const [contentCert, setContentCert] = useState<string>('');
  const [isBlocked, setIsBlocked] = useState(false);

  // Source states
  const [selectedSource, setSelectedSource] = useState<PlayerSourceType | null>(null);
  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [customSources, setCustomSources] = useState<string[]>([]);
  const [frembedAvailable, setFrembedAvailable] = useState(true);
  const [coflixData, setCoflixData] = useState<CoflixResponse | null>(null);
  const [, setSelectedPlayerLink] = useState<number>(0);
  const [omegaData, setOmegaData] = useState<OmegaMovieResponse | null>(null);
  const [, setSelectedOmegaPlayer] = useState<number>(0);
  const [darkinoAvailable, setDarkinoAvailable] = useState(false);
  const [darkinoSources, setDarkinoSources] = useState<any[]>([]);
  const [, setDarkinoId] = useState<string | null>(null);
  const [selectedDarkinoSource, setSelectedDarkinoSource] = useState<number>(0);
  const [mp4Sources, setMp4Sources] = useState<{ url: string; label?: string; language?: string; isVip?: boolean }[]>([]);
  const [selectedMp4Source, setSelectedMp4Source] = useState<number>(0);

  // SwiftFlux (MP4 direct du catalogue SwiftFlow). Trois états distincts :
  // ce qu'on sait exister (`entries`, sans URL), et ce qui a été débloqué
  // (`playback`, avec URL) — la porte d'entrée s'intercale entre les deux.
  const [swiftfluxEntries, setSwiftfluxEntries] = useState<SwiftfluxEntry[]>([]);
  const [swiftfluxPlayback, setSwiftfluxPlayback] = useState<SwiftfluxPlayback | null>(null);
  // La porte se pose par-dessus ce qui joue : tant qu'elle n'a rien résolu, la
  // source courante reste en place et visible derrière, et la refermer ne coûte
  // rien à l'utilisateur.
  const [swiftfluxGateOpen, setSwiftfluxGateOpen] = useState(false);
  const [watchProgress] = useState<number>(0);
  const [, setLoadingError] = useState<boolean>(false);
  const [nextMovie, setNextMovie] = useState<NextMovieType | null>(null);
  const [, setLoadingNextMovie] = useState<boolean>(false);

  // Nexus source states (Extracted)
  const [nexusHlsSources, setNexusHlsSources] = useState<SeekStreamingHlsSource[]>([]);
  const [nexusFileSources, setNexusFileSources] = useState<{ url: string; label: string }[]>([]);
  const [selectedNexusHlsSource, setSelectedNexusHlsSource] = useState<number>(0);
  const [selectedNexusFileSource, setSelectedNexusFileSource] = useState<number>(0);


  // Wiflix source states
  const [, setWiflixData] = useState<WiflixMovieResponse | null>(null);
  const [wiflixSources, setWiflixSources] = useState<{ url: string; label: string; category: string }[]>([]);

  const [selectedWiflixSource, setSelectedWiflixSource] = useState<number>(0);

  // J1F (1jour1film) source states
  const [, setJ1fData] = useState<J1fMovieResponse | null>(null);
  const [j1fSources, setJ1fSources] = useState<{ url: string; label: string; category: string }[]>([]);
  const [selectedJ1fSource, setSelectedJ1fSource] = useState<number>(0);

  // SwiftFlow source states
  const [, setSwiftflowData] = useState<SwiftflowMovieResponse | null>(null);
  const [swiftflowSources, setSwiftflowSources] = useState<{ url: string; label: string; category: string }[]>([]);
  const [selectedSwiftflowSource, setSelectedSwiftflowSource] = useState<number>(0);

  // Viper source states
  const [, setViperData] = useState<ViperMovieResponse | null>(null);
  const [viperSources, setViperSources] = useState<{ url: string; label: string; quality: string; language: string }[]>([]);
  const [selectedViperSource, setSelectedViperSource] = useState<number>(0);

  // Loading states
  const [loadingDarkino, setLoadingDarkino] = useState(true);
  const [loadingCoflix, setLoadingCoflix] = useState(true);
  const [loadingOmega, setLoadingOmega] = useState(true);
  const [loadingFrembed, setLoadingFrembed] = useState(true);

  const [loadingWiflix, setLoadingWiflix] = useState(true);
  const [loadingJ1f, setLoadingJ1f] = useState(true);
  const [loadingSwiftflow, setLoadingSwiftflow] = useState(true);
  const [loadingViper, setLoadingViper] = useState(true);
  const [loadingExtractions, setLoadingExtractions] = useState(true); // Nouvel état pour les extractions
  const [, setVipRetryMessage] = useState<string | null>(null);
  const [onlyVostfrAvailable, setOnlyVostfrAvailable] = useState<boolean>(false);

  // KissKH resolution is movie-scoped. Abort plus generation checks keep a
  // late response from a previous route from replacing the current movie.
  const [kisskhSources, setKisskhSources] = useState<KisskhSource[]>([]);
  const [kisskhSubtitles, setKisskhSubtitles] = useState<KisskhSubtitleTrack[]>([]);
  const [loadingKisskh, setLoadingKisskh] = useState(true);
  const kisskhRequestGenerationRef = useRef(0);
  const kisskhRequestAbortRef = useRef<AbortController | null>(null);

  // PurStream (Bravo) HLS states
  const [purstreamSources, setPurstreamSources] = useState<{ url: string; label: string }[]>([]);
  const canUseBravo = isUserVip() || isExtensionAvailable();

  // Bump à chaque changement de prefs de priorité pour re-trier les sortedX.
  const [prefsVersion, setPrefsVersion] = useState<number>(0);
  useEffect(() => {
    return subscribeToPriorityChanges(() => setPrefsVersion((v) => v + 1));
  }, []);

  // Listes triées par priorité hoster utilisateur (avec override par top-level).
  // On annote chaque source avec son `type` détecté via `detectHoster` puis on
  // trie avec `sortHostersByPriority`. Les listes d'origine restent inchangées.
  const sortedWiflix = useMemo(() => {
    const prefs = getSourcePriorityPrefs();
    const annotated = wiflixSources.map((s) => ({
      ...s,
      type: detectHoster(s.url, {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'wiflix' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiflixSources]);

  const sortedJ1f = useMemo(() => {
    const prefs = getSourcePriorityPrefs();
    const annotated = j1fSources.map((s) => ({
      ...s,
      type: detectHoster(s.url, {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'j1f' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j1fSources]);

  const sortedSwiftflow = useMemo(() => {
    const prefs = getSourcePriorityPrefs();
    const annotated = swiftflowSources.map((s) => ({
      ...s,
      type: detectHoster(s.url, {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'swiftflow' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swiftflowSources]);

  // Omega / Coflix : les listes viennent de champs dérivés (`omegaData` / `coflixData`).
  // On annote via detectHoster sur l'URL (`.link` pour omega, URL préférée pour coflix)
  // puis on trie.
  type OmegaPlayer = { player: string; link: string; is_hd: boolean; label?: string };
  type CoflixPlayer = { decoded_url: string; clone_url?: string; quality: string; language: string };
  const sortedOmega = useMemo<Array<OmegaPlayer & { type: string }>>(() => {
    const players: OmegaPlayer[] = omegaData?.player_links ?? [];
    if (!players || players.length === 0) return [];
    const prefs = getSourcePriorityPrefs();
    const annotated = players.map((p) => ({
      ...p,
      type: detectHoster(p.link ?? '', {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'omega' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omegaData]);

  const sortedCoflix = useMemo<Array<CoflixPlayer & { type: string }>>(() => {
    const links: CoflixPlayer[] = coflixData?.player_links ?? [];
    if (!links || links.length === 0) return [];
    const prefs = getSourcePriorityPrefs();
    const annotated = links.map((p) => ({
      ...p,
      type: detectHoster(getCoflixPreferredUrl(p), {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'coflix' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coflixData]);

  // Viper : items `{ url, label, quality, language }`. Le champ `language`
  // active le tri langue primaire dans sortHostersByPriority.
  const sortedViper = useMemo(() => {
    const prefs = getSourcePriorityPrefs();
    const annotated = viperSources.map((s) => ({
      ...s,
      type: detectHoster(s.url, {
        patternOverrides: prefs.patternOverrides,
        customHosters: prefs.customHosters,
      }) ?? 'unknown',
    }));
    return sortHostersByPriority(annotated, { category: 'moviesTv', topLevel: 'viper' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viperSources]);

  const currentSourceRef = useRef<string>('darkino');

  // Ref tracking the URL currently active in the player (videoSource or embedUrl).
  // Used to reject stale auto-fallback sourceChange events from an unmounted/previous player.
  const currentActiveUrlRef = useRef<string>('');

  useEffect(() => {
    autoFallbackGuard.activate();
    if (currentActiveUrlRef.current) {
      autoFallbackGuard.syncActiveSource(currentActiveUrlRef.current);
    }
    return () => autoFallbackGuard.invalidate();
  }, [autoFallbackGuard]);

  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [embedType, setEmbedType] = useState<string | null>(null);

  // Ajouter un état pour afficher le menu qualité embed
  const [showEmbedQuality, setShowEmbedQuality] = useState(false);
  const [hasConfirmedInitialSource, setHasConfirmedInitialSource] = useState(false);

  // A route can reuse this component when navigating from one film to another.
  // Re-open the initial source picker for the new film without changing source logic.
  useEffect(() => {
    setHasConfirmedInitialSource(false);
    setOnlyVostfrAvailable(false);
    setShowEmbedQuality(false);
  }, [encodedId]);

  useEffect(() => {
    if (!embedUrl) return;
    const normalizedEmbedUrl = normalizeUqloadEmbedUrl(embedUrl);
    if (normalizedEmbedUrl !== embedUrl) {
      setEmbedUrl(normalizedEmbedUrl);
    }
  }, [embedUrl]);

  useEffect(() => {
    let directSourceUrl = '';
    if (selectedSource === 'darkino') {
      directSourceUrl =
        darkinoSources[selectedDarkinoSource]?.m3u8
        || darkinoSources[0]?.m3u8
        || '';
    } else if (selectedSource === 'mp4') {
      directSourceUrl = videoSource || mp4Sources[selectedMp4Source]?.url || '';
    } else if (selectedSource === 'nexus_hls') {
      directSourceUrl =
        videoSource
        || nexusHlsSources[selectedNexusHlsSource]?.url
        || '';
    } else if (selectedSource === 'nexus_file') {
      directSourceUrl =
        videoSource
        || nexusFileSources[selectedNexusFileSource]?.url
        || '';
    } else if (selectedSource === 'bravo' || selectedSource === 'kisskh') {
      directSourceUrl = videoSource || '';
    }

    syncHlsActiveSource(
      autoFallbackGuard,
      currentActiveUrlRef,
      resolveRenderedWatchSource(selectedSource, directSourceUrl, embedUrl),
    );
  }, [
    autoFallbackGuard,
    darkinoSources,
    embedUrl,
    mp4Sources,
    nexusFileSources,
    nexusHlsSources,
    selectedDarkinoSource,
    selectedMp4Source,
    selectedNexusFileSource,
    selectedNexusHlsSource,
    selectedSource,
    videoSource,
  ]);

  const {
    showAdFreePopup,
    adType,
    shouldLoadIframe,
    showPopupForPlayer,
    handlePopupClose,
    handlePopupAccept
  } = useAdFreePopup();
  const [adPopupTriggered, setAdPopupTriggered] = useState(false);
  const [adPopupBypass, setAdPopupBypass] = useState(false);

  // Ajout de l'état pour savoir si l'utilisateur a cliqué sur la pub
  const [hasClickedAd, setHasClickedAd] = useState(false);

  // Movix Wrapped 2026 - Track movie viewing time
  useWrappedTracker({
    mode: 'viewing',
    viewingData: id ? {
      contentType: 'movie',
      contentId: id,
    } : undefined,
    isActive: !isLoading && !!id,
  });

  useEffect(() => {
    // Vidy est le lecteur unique des Films : ne pas lancer de résolution KissKH.
    kisskhRequestAbortRef.current?.abort();
    kisskhRequestAbortRef.current = null;
    setKisskhSources([]);
    setKisskhSubtitles([]);
    setLoadingKisskh(false);
  }, [id]);

  useEffect(() => {
    let isCurrentRoute = true;
    const isCurrentRequest = () => isCurrentRoute;

    // Reset page-scoped state when React Router reuses this component for
    // another movie or version.
    setIsLoading(Boolean(id));
    setSelectedSource(null);
    setIsBlocked(false);
    setContentCert('');
    setAdPopupTriggered(false);
    setAdPopupBypass(false);
    setHasClickedAd(false);
    setLoadingError(false);
    setLoadingDarkino(true);
    setLoadingCoflix(true);
    setLoadingOmega(true);
    setLoadingFrembed(true);
    setLoadingWiflix(true);
    setLoadingJ1f(true);
    setLoadingSwiftflow(true);
    setLoadingViper(true);
    setLoadingExtractions(true);
    setDarkinoSources([]);
    setMp4Sources([]);
    setWiflixSources([]);
    setJ1fSources([]);
    setSwiftflowSources([]);
    setViperSources([]);
    setCoflixData(null);
    setOmegaData(null);
    setEmbedUrl(null);

    if (!id) {
      setIsLoading(false);
      return () => {
        isCurrentRoute = false;
      };
    }

    const getVideoSources = async () => {
      try {
        await fetchVideoSources(isCurrentRequest);
        if (isCurrentRoute) {
          // Fetch next movie only after the current movie metadata has loaded.
          await fetchNextMovie();
        }
      } catch (error) {
        if (isCurrentRoute) setIsLoading(false);
      }
    };

    void getVideoSources();
    return () => {
      isCurrentRoute = false;
    };
    // The route key owns this request lifecycle; the functions below close over
    // the current render and are intentionally invoked only from this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, versionKey, currentProfile?.ageRestriction]);

  // Function to update VIP retry message
  const updateVipRetryMessage = (message: string) => {
    console.log("Updating retry message:", message);
    setVipRetryMessage(message);
    setLoadingText(message);
  };

  // Reset VIP retry message when loading finishes
  useEffect(() => {
    console.log("Loading states changed:", {
      loadingDarkino,
      loadingCoflix,
      loadingOmega,
      loadingFrembed,
      loadingWiflix,
      loadingViper
    });

    if (!loadingDarkino && !loadingCoflix && !loadingOmega && !loadingFrembed && !loadingWiflix && !loadingJ1f && !loadingSwiftflow && !loadingViper && !loadingExtractions) {
      setVipRetryMessage(null);
      setIsLoading(false);
    }
  }, [loadingDarkino, loadingCoflix, loadingOmega, loadingFrembed, loadingWiflix, loadingJ1f, loadingSwiftflow, loadingViper, loadingExtractions]);

  // Fetch video sources
  const fetchVideoSources = async (isCurrentRequest: () => boolean = () => true) => {
    if (!id || !isCurrentRequest()) {
      return;
    }

    setVipRetryMessage(null);
    setIsLoading(true);
    setLoadingText(t('watch.loadingSources'));


    try {
      // Get movie details for title (needed for ad-free search and Darkino)
      const tmdbResponse = await axios.get(`https://api.themoviedb.org/3/movie/${id}`, {
        params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() },
      }).catch(error => {
        console.error('Error fetching TMDB data:', error);
        return { data: { title: '', backdrop_path: null, release_date: '' } };
      });
      if (!isCurrentRequest()) return;

      setMovieTitle(movieVersion && tmdbResponse.data.title
        ? `${tmdbResponse.data.title} — ${t(movieVersion.labelKey)}`
        : tmdbResponse.data.title);
      setBackdropPath(tmdbResponse.data.backdrop_path);
      setPosterPath(tmdbResponse.data.poster_path);

      // Age restriction check
      const profileAge = currentProfile?.ageRestriction ?? 0;
      if (profileAge > 0) {
        try {
          const certResponse = await axios.get(`https://api.themoviedb.org/3/movie/${id}/release_dates`, {
            params: { api_key: TMDB_API_KEY },
          });
          if (!isCurrentRequest()) return;
          const results = certResponse.data.results;
          let cert = '';
          const frRelease = results.find((r: any) => r.iso_3166_1 === 'FR');
          if (frRelease?.release_dates) {
            const theatrical = frRelease.release_dates.find((rd: any) => rd.type === 3 || rd.type === 2);
            if (theatrical?.certification) cert = theatrical.certification;
          }
          if (!cert) {
            const usRelease = results.find((r: any) => r.iso_3166_1 === 'US');
            if (usRelease?.release_dates) {
              const found = usRelease.release_dates.find((rd: any) => rd.certification !== '');
              if (found?.certification) cert = found.certification;
            }
          }
          if (!isContentAllowed(cert, profileAge)) {
            setContentCert(cert || 'Non classé');
            setIsBlocked(true);
            setIsLoading(false);
            return;
          }
        } catch (e) {
          if (!isCurrentRequest()) return;
          console.warn('Could not verify movie certification; blocking restricted profile');
          setContentCert('Non classé');
          setIsBlocked(true);
          setIsLoading(false);
          return;
        }
      }

      if (!isCurrentRequest()) return;

      // Add movie to continueWatching (if history is enabled)
      try {
        const storage = window.localStorage;
        if (storage.getItem('settings_disable_history') !== 'true') {
          const continueWatching = JSON.parse(storage.getItem('continueWatching') ?? '{"movies": [], "tv": []}');
          if (!continueWatching || typeof continueWatching !== 'object' || Array.isArray(continueWatching)) {
            throw new Error('Invalid continueWatching data');
          }

          // Ensure structure exists
          if (continueWatching.movies === undefined) continueWatching.movies = [];
          else if (!Array.isArray(continueWatching.movies)) throw new Error('Invalid continueWatching movies');
          if (continueWatching.tv === undefined) continueWatching.tv = [];
          else if (!Array.isArray(continueWatching.tv)) throw new Error('Invalid continueWatching tv');

          const movieIdInt = parseInt(id);

          // Check if movie already exists (handle both old and new format)
          const existingIndex = continueWatching.movies.findIndex((item: any) => {
            const itemId = typeof item === 'number' ? item : item?.id;
            return itemId === movieIdInt;
          });

          const existingEntry = existingIndex !== -1 && typeof continueWatching.movies[existingIndex] === 'object'
            ? continueWatching.movies[existingIndex]
            : null;

          if (existingIndex !== -1) {
            // Move the existing entry to the front without losing Vidy progress.
            continueWatching.movies.splice(existingIndex, 1);
          }

          continueWatching.movies.unshift({
            ...(existingEntry || {}),
            id: movieIdInt,
            lastAccessed: new Date().toISOString()
          });

          writeLocalStorage('continueWatching', JSON.stringify(continueWatching));
        }
      } catch {
        // Un historique invalide ou indisponible ne doit pas bloquer la lecture.
      }

      // Vidy est le lecteur unique des Films : aucun ancien fournisseur n'est interrogé.
      // Libérer les états des anciens fournisseurs pour ne pas laisser l'UI en chargement.
      setLoadingDarkino(false);
      setLoadingCoflix(false);
      setLoadingOmega(false);
      setLoadingFrembed(false);
      setLoadingWiflix(false);
      setLoadingViper(false);
      setLoadingExtractions(false);
      setSelectedSource('vidy');
      setIsLoading(false);
      return;

    } catch (error) {
      if (!isCurrentRequest()) return;
      console.error('Error in fetchVideoSources:', error);

      // Default to VOSTFR when no sources are available
      setSelectedSource('vostfr');
      setOnlyVostfrAvailable(true);
      setLoadingError(false);

      // Make sure to set all loading states to false in case of a top-level error
      setLoadingCoflix(false);
      setLoadingOmega(false);
      setLoadingDarkino(false);
      setLoadingFrembed(false);
      setLoadingWiflix(false);
      setLoadingJ1f(false);
      setLoadingSwiftflow(false);
      setLoadingViper(false);
      setLoadingExtractions(false);
      setIsLoading(false);
    }
  };

  // Function to fetch next movie recommendation
  const fetchNextMovie = useCallback(async () => {
    if (!id) return;

    try {
      setLoadingNextMovie(true);
      const response = await axios.get(
        `https://api.themoviedb.org/3/movie/${id}/recommendations`,
        {
          params: {
            api_key: TMDB_API_KEY,
            language: getTmdbLanguage(),
            page: 1
          }
        }
      );

      if (response.data.results && response.data.results.length > 0) {
        // Ne plus vérifier la disponibilité sur frembed, prendre directement le premier film recommandé
        const firstRecommendation = response.data.results[0];
        setNextMovie({
          id: firstRecommendation.id,
          title: firstRecommendation.title,
          overview: firstRecommendation.overview,
          release_date: firstRecommendation.release_date,
          vote_average: firstRecommendation.vote_average,
          poster_path: firstRecommendation.poster_path,
          runtime: 0 // Default value
        });
      }
    } catch (error) {
    } finally {
      setLoadingNextMovie(false);
    }
  }, [id]);


  // Function to handle next movie navigation
  const handleNextMovie = async (movieId: number) => {
    window.location.href = `/watch/movie/${movieId}`;
  };

  // Listener pour l'événement showSourcesMenu (déclenché par HLSPlayer en cas d'erreur 403)
  useEffect(() => {
    const handleShowSourcesMenu = () => {
      setShowEmbedQuality(true);
    };
    window.addEventListener('showSourcesMenu', handleShowSourcesMenu);
    return () => {
      window.removeEventListener('showSourcesMenu', handleShowSourcesMenu);
    };
  }, []);

  // Progress saving functionality removed

  useEffect(() => {
    // Renamed inner function to avoid confusion with any other handleSourceChange
    const processSourceSelectionFromMenu = (event: CustomEvent) => {
      const { type: rawType, url, origin, fromSrc } = event.detail;
      const type = typeof rawType === 'number' ? String(rawType) : rawType;
      const isAutomaticFallback =
        typeof origin === 'string' && origin.includes('auto-fallback');
      const isKisskhFallbackCompletion = origin === 'kisskh-fallback';

      // Reject stale auto-fallback events whose originating src no longer matches
      // the currently-active player URL. This prevents a late error handler from
      // a previously-selected player (e.g. darkino) reverting a user's manual
      // switch to another source (e.g. fsvid).
      if ((isAutomaticFallback || isKisskhFallbackCompletion) && typeof fromSrc === 'string' && fromSrc) {
        if (fromSrc !== currentActiveUrlRef.current) {
          console.log(
            `[WatchMovie] Ignoring stale auto-fallback sourceChange (from=${fromSrc.substring(0, 80)} current=${currentActiveUrlRef.current.substring(0, 80)})`
          );
          return;
        }
      }

      // SwiftFlux se sélectionne sans URL : elle n'existe pas encore côté
      // client à cet instant. On repasse par la porte d'entrée, qui la
      // demandera au serveur une fois la pub vue et le Turnstile validé.
      if (type === 'swiftflux') {
        if (!isAutomaticFallback) {
          setLastPlayer('swiftflux');
          setHasConfirmedInitialSource(true);
        }
        setShowEmbedQuality(false);
        // Déjà débloquée pour ce film : rien à redemander, on bascule.
        if (swiftfluxPlayback) {
          setOnlyVostfrAvailable(false);
          setEmbedUrl(null);
          setEmbedType(null);
          setVideoSource('');
          currentSourceRef.current = 'swiftflux';
          setSelectedSource('swiftflux');
          return;
        }
        // Sinon on ouvre la porte SANS toucher à la source courante : ce qui
        // joue continue derrière, et refermer la porte n'a rien cassé.
        setSwiftfluxGateOpen(true);
        return;
      }

      const bravoAllowed = type !== 'bravo' || canUseBravo;

      const acceptedPlaybackUrl = (() => {
        switch (type) {
          case 'darkino':
            return resolveAcceptedWatchSource({
              requestedSource: url,
              availableSources: darkinoSources.map(source => source.m3u8),
              fallback: 'first',
            });
          case 'mp4':
            return resolveAcceptedWatchSource({
              requestedSource: url,
              availableSources: mp4Sources.map(source => source.url),
              fallback: 'first',
            });
          case 'nexus_hls':
            return resolveAcceptedWatchSource({
              requestedSource: url,
              availableSources: nexusHlsSources.map(source => source.url),
              fallback: 'first',
            });
          case 'nexus_file':
            return resolveAcceptedWatchSource({
              requestedSource: url,
              availableSources: nexusFileSources.map(source => source.url),
              fallback: 'first',
            });
          case 'bravo':
            return resolveAcceptedWatchSource({
              requestedSource: url,
              availableSources: purstreamSources.map(source => source.url),
              allowed: bravoAllowed,
              fallback: 'last',
            });
          case 'kisskh_main':
            return isKisskhFallbackCompletion
              ? resolveAcceptedWatchSource({ requestedSource: url })
              : resolveAcceptedWatchSource({
                  requestedSource: url,
                  availableSources: kisskhSources.map(source => source.url),
                  fallback: 'first',
                });
          case 'frembed':
          case 'custom':
          case 'vostfr':
          case 'omega':
          case 'coflix':
          case 'wiflix':
          case 'j1f':
          case 'swiftflow':
          case 'viper':
            return resolveAcceptedWatchSource({ requestedSource: url });
          default:
            return null;
        }
      })();

      if (!acceptedPlaybackUrl) return;

      if (!isAutomaticFallback) setHasConfirmedInitialSource(true);

      if (acceptedPlaybackUrl) {
        syncHlsActiveSource(
          autoFallbackGuard,
          currentActiveUrlRef,
          acceptedPlaybackUrl,
        );
      }

      // M11 — track last manually-picked player for "remember last player".
      // Filtre les events auto-fallback (sélection involontaire) ; setLastPlayer
      // valide en interne contre TOP_LEVEL_SOURCE_IDS et ignore les ids hors-liste.
      if (
        !isAutomaticFallback
        && typeof type === 'string'
      ) {
        // Retrouve la ligne cliquée pour mémoriser le lecteur précis (Lulu,
        // Vidara…) et pas seulement la source qui le contient.
        const pickedItem = type === 'nexus_hls'
          ? nexusHlsSources.find(source => source.url === acceptedPlaybackUrl)
          : type === 'nexus_file'
            ? nexusFileSources.find(source => source.url === acceptedPlaybackUrl)
            : type === 'bravo'
              ? purstreamSources.find(source => source.url === acceptedPlaybackUrl)
              : type === 'darkino'
                ? (() => {
                    const dk = darkinoSources.find(source => source.m3u8 === acceptedPlaybackUrl);
                    return dk ? { url: dk.m3u8, label: dk.label || dk.quality } : undefined;
                  })()
                : undefined;
        setLastPlayer(
          type === 'kisskh_main' ? 'kisskh' : type,
          hosterKeyOf(pickedItem ?? { url: acceptedPlaybackUrl }),
        );
      }

      // When any source is picked from the menu, hide the "no content" message and the menu itself.
      setOnlyVostfrAvailable(false);
      setShowEmbedQuality(false);

      // Handle HLS source selections
      if (type === 'darkino' || type === 'mp4' || type === 'nexus_hls' || type === 'nexus_file' || type === 'bravo' || type === 'kisskh_main') {
        setEmbedUrl(null); // Hide iframe
        setEmbedType(null);
        currentSourceRef.current = type;

        if (type === 'darkino') {
          const index = darkinoSources.findIndex(s => s.m3u8 === acceptedPlaybackUrl);
          if (index !== -1) {
            setSelectedDarkinoSource(index);
            setSelectedSource('darkino');
          } else if (darkinoSources.length > 0) { // Fallback to first darkino if specific URL not found
            setSelectedDarkinoSource(0);
            setSelectedSource('darkino');
          }
        } else if (type === 'mp4') {
          const index = mp4Sources.findIndex(s => s.url === acceptedPlaybackUrl);
          if (index !== -1) {
            setSelectedMp4Source(index);
            setSelectedSource('mp4');
            setVideoSource(mp4Sources[index].url);
          } else if (mp4Sources.length > 0) { // Fallback to first mp4
            setSelectedMp4Source(0);
            setSelectedSource('mp4');
            setVideoSource(mp4Sources[0].url);
          }
        } else if (type === 'nexus_hls') {
          const index = nexusHlsSources.findIndex(s => s.url === acceptedPlaybackUrl);
          if (index !== -1) {
            setSelectedNexusHlsSource(index);
            setSelectedSource('nexus_hls');
            setVideoSource(nexusHlsSources[index].url);
          } else if (nexusHlsSources.length > 0) { // Fallback to first nexus hls
            setSelectedNexusHlsSource(0);
            setSelectedSource('nexus_hls');
            setVideoSource(nexusHlsSources[0].url);
          }
        } else if (type === 'nexus_file') {
          const index = nexusFileSources.findIndex(s => s.url === acceptedPlaybackUrl);
          if (index !== -1) {
            setSelectedNexusFileSource(index);
            setSelectedSource('nexus_file');
            setVideoSource(nexusFileSources[index].url);
          } else if (nexusFileSources.length > 0) { // Fallback to first nexus file
            setSelectedNexusFileSource(0);
            setSelectedSource('nexus_file');
            setVideoSource(nexusFileSources[0].url);
          }
        } else if (type === 'bravo') {
          // Sélection d'une source Bravo (PurStream) depuis le menu déroulant
          console.log('🎬 [WatchMovie] Bravo source selected:', url);
          const chosenBravoUrl = acceptedPlaybackUrl;
          if (chosenBravoUrl) {
            setSelectedSource('bravo');
            setVideoSource(chosenBravoUrl);
            setEmbedUrl(null);
            setEmbedType(null);
            currentSourceRef.current = 'bravo';
            console.log(`✅ [WatchMovie] Playing Bravo via HLS: ${chosenBravoUrl}`);
          }
        } else if (type === 'kisskh_main' && acceptedPlaybackUrl) {
          setSelectedSource('kisskh');
          setVideoSource(acceptedPlaybackUrl);
          setEmbedUrl(null);
          setEmbedType(null);
          currentSourceRef.current = 'kisskh';
          if (isKisskhFallbackCompletion) {
            setKisskhSources(current => current.map(source => (
              source.id === event.detail.id
                ? { ...source, url: acceptedPlaybackUrl, fallbackToken: '' }
                : source
            )));
          }
        }
      }
      // Handle Embed source selections
      else if (['frembed', 'custom', 'vostfr', 'omega', 'coflix', 'wiflix', 'j1f', 'swiftflow', 'viper'].includes(type)) {
        const finalEmbedUrl = acceptedPlaybackUrl!;
        setEmbedUrl(finalEmbedUrl);
        setEmbedType(type);
        setSelectedSource(type as PlayerSourceType); // Type assertion, as 'type' is a confirmed string literal
        setVideoSource(null); // Explicitly clear HLS video source
        currentSourceRef.current = type; // 'type' is a string here from the includes check

        // Handle Wiflix source selection
        if (type === 'wiflix') {
          const index = sortedWiflix.findIndex(s => s.url === url);
          if (index !== -1) {
            setSelectedWiflixSource(index);
          } else if (sortedWiflix.length > 0) {
            setSelectedWiflixSource(0);
            setEmbedUrl(sortedWiflix[0].url);
          }
        }
        // Handle J1F source selection
        else if (type === 'j1f') {
          const index = sortedJ1f.findIndex(s => s.url === url);
          if (index !== -1) {
            setSelectedJ1fSource(index);
          } else if (sortedJ1f.length > 0) {
            setSelectedJ1fSource(0);
            setEmbedUrl(sortedJ1f[0].url);
          }
        }
        // Handle SwiftFlow source selection
        else if (type === 'swiftflow') {
          const index = sortedSwiftflow.findIndex(s => s.url === url);
          if (index !== -1) {
            setSelectedSwiftflowSource(index);
          } else if (sortedSwiftflow.length > 0) {
            setSelectedSwiftflowSource(0);
            setEmbedUrl(sortedSwiftflow[0].url);
          }
        }
        // Handle Viper source selection
        else if (type === 'viper') {
          const index = viperSources.findIndex(s => s.url === url);
          if (index !== -1) {
            setSelectedViperSource(index);
            console.log(`✅ [WatchMovie] Playing Viper source #${index}: ${viperSources[index].label}`);
          } else if (viperSources.length > 0) {
            setSelectedViperSource(0);
            setEmbedUrl(viperSources[0].url);
          }
        }
      }
      // Handle dropdown toggles (no state change needed here for player, currentSourceRef remains)
      else if (typeof type === 'string' && type.endsWith('_main')) {
        // console.log(`[WatchMovie] Dropdown toggle ignored for player state: ${type}`);
      }
      // Handle unknown types (currentSourceRef remains unchanged or could be set to a default/null string if necessary)
      else {
        // console.warn(`[WatchMovie] Unknown source type received for player state: ${type}`);
      }
    };

    window.addEventListener('sourceChange', processSourceSelectionFromMenu as EventListener);
    return () => {
      window.removeEventListener('sourceChange', processSourceSelectionFromMenu as EventListener);
    };
  }, [
    // State values used in logic
    darkinoSources, mp4Sources, darkinoAvailable, nexusHlsSources, nexusFileSources, wiflixSources, j1fSources, swiftflowSources, sortedWiflix, sortedJ1f, sortedSwiftflow, viperSources, purstreamSources, kisskhSources, canUseBravo, swiftfluxPlayback,
    // State setters
    setOnlyVostfrAvailable, setShowEmbedQuality, setEmbedUrl, setEmbedType, setSwiftfluxGateOpen,
    setSelectedSource, setSelectedDarkinoSource, setSelectedMp4Source, setSelectedNexusHlsSource,  setSelectedWiflixSource, setSelectedViperSource, setVideoSource,
    // Refs (currentSourceRef.current is mutated, so the ref object itself is a dependency)
    currentSourceRef, autoFallbackGuard
  ]);

  useEffect(() => {
    // On ne fait rien si VIP activé
    if (import.meta.env.is_vip === 'true' || import.meta.env.is_vip === true || readLocalStorage('is_vip') === 'true') {
      console.log('🚫 VIP activé - popup ads désactivé');
      return;
    }
    // On ne fait rien si déjà passé le popup ou si popup déjà affiché
    if (adPopupTriggered || adPopupBypass) {
      console.log('🚫 Popup déjà déclenché ou bypassé:', { adPopupTriggered, adPopupBypass });
      return;
    }

    console.log('🔍 États de chargement:', {
      loadingDarkino,
      loadingCoflix,
      loadingOmega,
      loadingFrembed,
      loadingExtractions
    });

    // Quand tous les chargements sont terminés (y compris les extractions)
    if (!loadingDarkino && !loadingCoflix && !loadingOmega && !loadingFrembed && !loadingExtractions) {
      console.log('✅ Tous les chargements terminés - vérification des sources pour popup ads');
      console.log('📊 Sources disponibles:', {
        selectedSource,
        nexusHlsSources: nexusHlsSources.length,
        nexusFileSources: nexusFileSources.length,
        darkinoSources: darkinoSources.length,
        mp4Sources: mp4Sources.length,
        omegaData: omegaData?.player_links?.length || 0,
        coflixData: coflixData?.player_links?.length || 0,
        wiflixSources: wiflixSources.length,
        embedUrl
      });

      // NOUVEAU: Déclencher le popup pour TOUS les lecteurs dès qu'une source est sélectionnée
      if (selectedSource && !adPopupTriggered) {
        console.log('🎭 Déclenchement popup pour source:', selectedSource);

        // Vérifier s'il n'y a que des sources VO/VOSTFR disponibles
        const hasVfSources = darkinoSources.length > 0 || mp4Sources.length > 0 ||
          (omegaData?.player_links && omegaData.player_links.length > 0) ||
          (coflixData?.player_links && coflixData.player_links.length > 0) ||
          (wiflixSources.length > 0 && wiflixSources.some(source =>
            source.category === 'VF' || source.category === 'VFQ'
          )) ||
          (j1fSources.length > 0 && j1fSources.some(source =>
            source.category === 'VF' || source.category === 'VFQ'
          )) ||
          (swiftflowSources.length > 0 && swiftflowSources.some(source =>
            source.category === 'VF' || source.category === 'VFQ'
          )) ||
          (viperSources.length > 0 && viperSources.some(source =>
            source.language === 'VF'
          ));

        const isVoVostfrOnly = !hasVfSources;

        // Déclencher le popup avec le type de lecteur approprié
        let playerType = selectedSource;
        let additionalInfo: any = { isVoVostfrOnly };

        // Mapper les types de sources aux types de lecteurs pour le popup
        switch (selectedSource) {
          case 'vidy':
            // Vidy n'a pas de lecteur publicitaire dédié : réutiliser le flux générique.
            playerType = 'adfree';
            break;
          case 'nexus_hls':
          case 'nexus_file':
            playerType = 'nexus_' + selectedSource.split('_')[1];
            break;
          case 'darkino':
          case 'mp4':
            playerType = 'darkino';
            break;
          case 'omega':
            playerType = 'omega';
            additionalInfo = { omegaData, isVoVostfrOnly };
            break;
          case 'coflix':
            playerType = 'multi';
            additionalInfo = { coflixData, isVoVostfrOnly };
            break;
          case 'wiflix':
            playerType = 'wiflix';
            break;
          case 'j1f':
            playerType = 'j1f';
            break;
          case 'swiftflow':
            playerType = 'swiftflow';
            break;
          case 'swiftflux':
            playerType = 'swiftflux';
            break;
          case 'viper':
            playerType = 'viper';
            break;
          case 'frembed':
            playerType = 'frembed';
            break;
          default:
            // Pour les autres types (custom, embed URLs, etc.)
            if (embedUrl) {
              if (embedUrl.toLowerCase().includes('vidmoly')) {
                playerType = 'vidmoly';
              } else if (embedUrl.toLowerCase().includes('dropload')) {
                playerType = 'dropload';
              } else {
                playerType = 'adfree'; // Type générique pour les embeds
              }
            } else {
              playerType = 'adfree'; // Type par défaut
            }
            break;
        }

        console.log(`🎭 Popup déclenché pour ${playerType} (source: ${selectedSource})`);
        showPopupForPlayer(String(playerType), additionalInfo);
        setAdPopupTriggered(true);
        return;
      }

      console.log('⚠️ Aucune source sélectionnée ou popup déjà déclenché');
    } else {
      console.log('⏳ Chargements en cours - popup ads en attente');
    }
  }, [loadingDarkino, loadingCoflix, loadingOmega, loadingFrembed, loadingWiflix, loadingExtractions, selectedSource, darkinoSources, mp4Sources, omegaData, coflixData, wiflixSources, j1fSources, swiftflowSources, embedUrl, adPopupTriggered, adPopupBypass, showPopupForPlayer]);

  // Si on ferme le popup (croix) ET qu'on n'a PAS cliqué sur la pub, on bloque l'accès au lecteur
  useEffect(() => {
    if (!showAdFreePopup && adPopupTriggered && !shouldLoadIframe && !hasClickedAd) {
      setAdPopupBypass(true); // On bloque l'accès au lecteur
    }
  }, [showAdFreePopup, adPopupTriggered, shouldLoadIframe, hasClickedAd]);

  useEffect(() => {
    const setVh = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    return () => window.removeEventListener('resize', setVh);
  }, []);

  useEffect(() => {
    const body = document.body;
    if (!body) return;
    body.style.overflow = 'hidden';
    body.style.height = '100vh';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100vh';
    return () => {
      body.style.overflow = '';
      body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    };
  }, []);

  // Age restriction blocking screen
  if (isBlocked) {
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
            {t('details.contentBlockedDesc', { rating: getClassificationLabel(contentCert, t), age: currentProfile?.ageRestriction ?? 0 })}
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

  // Respect the ad gate before mounting the VidRift iframe.
  // In click-anywhere mode the iframe is preloaded and the ad catcher is an overlay.
  if (
    showAdFreePopup
    && adPopupTriggered
    && !adPopupBypass
    && getAdPopupMode() !== 'click-anywhere'
  ) {
    return (
      <div className="fixed inset-0 bg-black">
        {!shouldLoadIframe && !hasClickedAd && <AdWaitingScreen />}
        <AdFreePlayerAds
          onClose={handlePopupClose}
          onAccept={handlePopupAccept}
          adType={adType}
          onAdClick={() => setHasClickedAd(true)}
        />
      </div>
    );
  }

  if (adPopupBypass) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-black">
        <div className="text-white text-2xl font-bold mb-4">{t('watch.mustWatchAd')}</div>
        <div className="text-gray-400 text-lg">{t('watch.reloadToRetry')}</div>
      </div>
    );
  }

  if (adPopupTriggered && !shouldLoadIframe && !hasClickedAd) {
    return <AdWaitingScreen />;
  }

  if (!isLoading && id) {
    return (
      <div className="fixed inset-0 bg-black">
        <VidRiftPlayer kind="movie" tmdbId={id} title={movieTitle} posterPath={playerPoster} />
        {showAdFreePopup && adPopupTriggered && !adPopupBypass && (
          <AdFreePlayerAds
            onClose={handlePopupClose}
            onAccept={handlePopupAccept}
            adType={adType}
            onAdClick={() => setHasClickedAd(true)}
          />
        )}
      </div>
    );
  }

  return (
    <main className="fixed inset-0 flex items-center justify-center bg-black text-white" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-red-500" />
        <p className="text-sm text-white/70">{loadingText || t('watch.loadingSources')}</p>
      </div>
    </main>
  );
};

// Redirige les anciens ID TMDB supprimés (liens partagés, historique) vers
// la version qui les remplace, et une version inconnue vers le film seul.
const WatchMovieRoute: React.FC = () => {
  const { tmdbid: encodedId, version: versionKey } = useParams<{ tmdbid: string; version?: string }>();
  const id = encodedId ? getTmdbId(encodedId) : null;
  if (!id || !/^\d+$/.test(id)) {
    return <Navigate replace to="/" />;
  }
  const retired = getVersionForRetiredId(id);
  if (retired) {
    return <Navigate replace to={buildWatchMoviePath(encodeId(retired.tmdbId), retired.key)} />;
  }
  if (encodedId && versionKey && !getMovieVersion(id, versionKey)) {
    return <Navigate replace to={buildWatchMoviePath(encodedId)} />;
  }
  return <WatchMovie />;
};

export default WatchMovieRoute;
