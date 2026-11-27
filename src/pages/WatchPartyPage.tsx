import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import axios from 'axios';
import { getTmdbLanguage } from '../i18n';
import Hls from 'hls.js';
import {
  ArrowLeft, Check, Copy, Film, Globe2, KeyRound, Loader2, LockKeyhole,
  MessageCircle, Play, Plus, RefreshCw, Send, Users, Volume2, VolumeX, X,
} from 'lucide-react';
import { clearRoomToken, getRoomToken, storeRoomToken, type PlaybackState, type ScheduledPlaybackEvent, type SyncProbeResult } from '../utils/watchparty';
import { isIpadSafari } from '../utils/deviceDetection';
import { WATCHPARTY_API as CONFIGURED_WATCHPARTY_API } from '../config/runtime';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

// Le fallback historique reste disponible pour les déploiements qui ne
// configurent ni VITE_WATCHPARTY_API ni VITE_MAIN_API.
const WATCHPARTY_API = CONFIGURED_WATCHPARTY_API || 'https://watchparty-api-production.up.railway.app';

type Media = {
  src: string;
  title: string;
  poster?: string | null;
  mediaType: 'movie' | 'tv';
  mediaId?: string;
  playbackType?: 'direct' | 'vidrift';
  isAnime?: boolean;
  seasonNumber?: number;
  episodeNumber?: number;
  position?: number;
};

type Participant = {
  id: string;
  nickname: string;
  isHost: boolean;
  isActive?: boolean;
};

type ChatMessage = {
  id: string;
  senderId: string;
  senderNickname: string;
  text: string;
  replyTo?: { id: string; senderNickname: string; text: string } | null;
  timestamp: number;
  type: 'chat' | 'system' | 'action';
  deleted?: boolean;
};

type FloatingReaction = {
  id: string;
  emoji: string;
  senderId: string;
  senderNickname: string;
  timestamp: number;
};

type PauseVote = {
  requestedBy: string;
  requestedByNickname: string;
  requestedDuration: number;
  endTime: number;
  totalParticipants: number;
  yesVotes?: number;
  noVotes?: number;
  totalVotes?: number;
};

type PauseTimer = { endTime: number; startedBy: string; duration: number; resumeAfterPause?: boolean };

type Room = {
  id: string;
  code: string;
  name?: string;
  hostId: string | null;
  maxParticipants: number;
  isPublic: boolean;
  syncMode: 'classic' | 'pro';
  controlMode: 'host-only' | 'democratic';
  coHosts?: string[];
  chatEnabled: boolean;
  media: Media;
  participants: Participant[];
  playbackState?: PlaybackSnapshot;
  readyState?: Record<string, boolean>;
  countdown?: { startAt: number; startedBy: string } | null;
  pauseTimer?: PauseTimer | null;
  pauseVote?: PauseVote | null;
};

type ControlRequest = { participantId: string; nickname: string; requestedAt?: number };

type PlaybackSnapshot = PlaybackState & {
  reason?: 'play' | 'pause' | 'seek' | 'heartbeat' | 'ended';
};

type TmdbMedia = {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  vote_average?: number;
  genre_ids: number[];
};

type TmdbSeason = {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
};

type TmdbEpisode = {
  id: number;
  episode_number: number;
  name: string;
  still_path?: string | null;
};

type PublicRoom = {
  id: string;
  code: string;
  title: string;
  poster?: string;
  mediaType: 'movie' | 'tv';
  participantCount: number;
  maxParticipants: number;
  syncMode: 'classic' | 'pro';
  playbackType?: 'direct' | 'vidrift';
  mediaId?: string | null;
  mediaTitle?: string;
  hostNickname?: string;
  isAnime?: boolean;
  seasonNumber?: number;
  episodeNumber?: number;
  createdAt: number;
};

const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';

function buildVidRiftEmbedUrl(media: Media): string {
  const tmdbId = String(media.mediaId || '');
  if (!/^\d+$/.test(tmdbId)) return '';
  const season = Number.isInteger(media.seasonNumber) && Number(media.seasonNumber) >= 0 ? Number(media.seasonNumber) : 1;
  const episode = Number.isInteger(media.episodeNumber) && Number(media.episodeNumber) > 0 ? Number(media.episodeNumber) : 1;
  const path = media.mediaType === 'tv'
    ? `/embed/tv/${encodeURIComponent(tmdbId)}/${season}/${episode}`
    : `/embed/movie/${encodeURIComponent(tmdbId)}`;
  const url = new URL(path, VIDRIFT_ORIGIN);
  url.searchParams.set('brand', 'Movix');
  url.searchParams.set('brandColor', 'DC2626');
  url.searchParams.set('download', '1');
  url.searchParams.set('exit', '1');
  if (media.title) url.searchParams.set('title', media.title);
  if (media.poster?.startsWith('https://')) url.searchParams.set('poster', media.poster);
  return url.toString();
}

const panelClass = 'rounded-2xl border border-white/[0.08] bg-[#111214] shadow-[0_18px_60px_rgba(0,0,0,.28)]';
const inputClass = 'h-11 w-full rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-red-500/60 focus:ring-2 focus:ring-red-500/10';
const buttonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${WATCHPARTY_API}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Erreur serveur (${response.status})`);
  }
  return payload as T;
}

const WatchPartyPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { code: routeCode, roomId } = useParams<{ code?: string; roomId?: string }>();
  const [nickname, setNickname] = useState(() => {
    try { return sessionStorage.getItem('watchPartyNickname') || ''; } catch { return ''; }
  });
  const [joinCode, setJoinCode] = useState((routeCode || '').toUpperCase());
  const [roomName, setRoomName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogType, setCatalogType] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');
  const [catalogResults, setCatalogResults] = useState<TmdbMedia[]>([]);
  const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<TmdbMedia | null>(null);
  const [seasons, setSeasons] = useState<TmdbSeason[]>([]);
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [isLoadingSeasons, setIsLoadingSeasons] = useState(false);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState('8');
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(() => {
    const message = (location.state as { message?: string } | null)?.message;
    return typeof message === 'string' ? message : '';
  });
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [controlRequests, setControlRequests] = useState<ControlRequest[]>([]);
  const [readyState, setReadyState] = useState<Record<string, boolean>>({});
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatReply, setChatReply] = useState<ChatMessage | null>(null);
  const [pauseVote, setPauseVote] = useState<PauseVote | null>(null);
  const [pauseTimer, setPauseTimer] = useState<PauseTimer | null>(null);
  const [countdownTarget, setCountdownTarget] = useState<number | null>(null);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [syncStatus, setSyncStatus] = useState<'classic' | 'calibrating' | 'perfect' | 'adjusting' | 'unstable'>('classic');
  const [syncEngine, setSyncEngine] = useState<'js' | 'wasm'>('js');
  const [publicQuery, setPublicQuery] = useState('');
  const [publicTypeFilter, setPublicTypeFilter] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');
  const [publicSort, setPublicSort] = useState<'recent' | 'popular'>('recent');
  const [selfId, setSelfId] = useState('');
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [copyDone, setCopyDone] = useState(false);
  const [requiresUserGesture, setRequiresUserGesture] = useState(false);
  const [controlNotice, setControlNotice] = useState('');
  const [localVolume, setLocalVolume] = useState(0.8);
  const [localMuted, setLocalMuted] = useState(false);
  const [vidRiftActivationOpen, setVidRiftActivationOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const vidriftFrameRef = useRef<HTMLIFrameElement>(null);
  const vidRiftHasReportedStateRef = useRef(false);
  const roomRef = useRef<Room | null>(null);
  const vidriftPlaybackRef = useRef({ currentTime: 0, paused: true, updatedAt: 0, playbackRate: 1 });
  const hlsRef = useRef<Hls | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastHeartbeatRef = useRef(0);
  const pendingPlaybackRef = useRef<PlaybackSnapshot | null>(null);
  const authoritativePlaybackRef = useRef<PlaybackSnapshot | null>(null);
  // Un `playback:getState` déclenché au retour en avant-plan est une resync
  // autoritaire : il doit être appliqué même si le dernier état serveur vient
  // d'une action explicite (reason: seek/play/pause).
  const resyncRequestedRef = useRef(false);
  const vidRiftActivationTimerRef = useRef<number | null>(null);
  const hasCustomLocalVolumeRef = useRef(false);
  const remoteCommandTimeoutRef = useRef<number | null>(null);
  const remoteSuppressionUntilRef = useRef(0);
  const syncWorkerRef = useRef<Worker | null>(null);
  const syncTickTimerRef = useRef<number | null>(null);
  const clockOffsetRef = useRef(0);
  const clockOffsetSamplesRef = useRef<Array<{ offsetMs: number; roundTripMs: number }>>([]);
  const pendingClockProbesRef = useRef(new Map<string, number>());
  const clockProbeSequenceRef = useRef(0);

  useEffect(() => {
    if (!routeCode) return;
    setJoinCode(routeCode.toUpperCase());
    setShowJoin(true);
  }, [routeCode]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    const query = catalogQuery.trim();
    if (query.length < 2 || !TMDB_API_KEY) {
      setCatalogResults([]);
      setIsSearchingCatalog(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearchingCatalog(true);
      try {
        const response = await axios.get('https://api.themoviedb.org/3/search/multi', {
          params: {
            api_key: TMDB_API_KEY,
            query,
            language: getTmdbLanguage(),
            include_adult: false,
            page: 1,
          },
          signal: controller.signal,
        });
        const results = (response.data?.results || []).filter((item: TmdbMedia & { media_type: string }) => (
          (item.media_type === 'movie' || item.media_type === 'tv')
          && item.poster_path
          && Number.isFinite(item.id)
        )) as TmdbMedia[];
        setCatalogResults(results.slice(0, 24));
      } catch (err) {
        if (!controller.signal.aborted) {
          setCatalogResults([]);
          setError('La recherche du catalogue est indisponible pour le moment.');
        }
      } finally {
        if (!controller.signal.aborted) setIsSearchingCatalog(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogQuery]);

  useEffect(() => {
    if (!selectedMedia || selectedMedia.media_type !== 'tv') {
      setSeasons([]);
      setEpisodes([]);
      setSelectedSeason(null);
      setSelectedEpisode(null);
      setIsLoadingSeasons(false);
      setIsLoadingEpisodes(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingSeasons(true);
    setSeasons([]);
    setEpisodes([]);
    setSelectedSeason(null);
    setSelectedEpisode(null);
    axios.get(`https://api.themoviedb.org/3/tv/${selectedMedia.id}`, {
      params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() },
      signal: controller.signal,
    }).then(response => {
      if (controller.signal.aborted) return;
      const available = (response.data?.seasons || [])
        .filter((season: TmdbSeason) => Number.isInteger(season.season_number) && season.season_number >= 0)
        .sort((a: TmdbSeason, b: TmdbSeason) => a.season_number - b.season_number);
      setSeasons(available);
      const first = available.find((season: TmdbSeason) => season.season_number > 0) || available[0];
      if (first) setSelectedSeason(first.season_number);
      else setError('Aucune saison disponible pour cette série.');
    }).catch(err => {
      if (!controller.signal.aborted) setError('Impossible de charger les saisons de cette série.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoadingSeasons(false);
    });

    return () => controller.abort();
  }, [selectedMedia?.id, selectedMedia?.media_type]);

  useEffect(() => {
    if (!selectedMedia || selectedMedia.media_type !== 'tv' || selectedSeason === null) {
      setEpisodes([]);
      setSelectedEpisode(null);
      return;
    }

    const controller = new AbortController();
    setIsLoadingEpisodes(true);
    setEpisodes([]);
    setSelectedEpisode(null);
    axios.get(`https://api.themoviedb.org/3/tv/${selectedMedia.id}/season/${selectedSeason}`, {
      params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() },
      signal: controller.signal,
    }).then(response => {
      if (controller.signal.aborted) return;
      const available = (response.data?.episodes || [])
        .filter((episode: TmdbEpisode) => Number.isInteger(episode.episode_number) && episode.episode_number > 0)
        .sort((a: TmdbEpisode, b: TmdbEpisode) => a.episode_number - b.episode_number);
      setEpisodes(available);
      if (available[0]) setSelectedEpisode(available[0].episode_number);
      else setError('Aucun épisode disponible dans cette saison.');
    }).catch(() => {
      if (!controller.signal.aborted) setError('Impossible de charger les épisodes.');
    }).finally(() => {
      if (!controller.signal.aborted) setIsLoadingEpisodes(false);
    });

    return () => controller.abort();
  }, [selectedMedia?.id, selectedMedia?.media_type, selectedSeason]);

  const selectCatalogMedia = (media: TmdbMedia) => {
    setSelectedMedia(media);
    setCatalogQuery('');
    setCatalogResults([]);
    setError('');
    const mediaTitle = media.title || media.name || 'Contenu';
    setRoomName(current => !current || current.startsWith('Watch Party ·') ? `Watch Party · ${mediaTitle}` : current);
  };

  const refreshPublicRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      const result = await apiRequest<{ success: boolean; rooms: PublicRoom[] }>('/api/watchparty/public');
      setPublicRooms(result.rooms || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les salons publics.');
    } finally {
      setIsLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    if (!roomId) void refreshPublicRooms();
  }, [roomId, refreshPublicRooms]);

  const rememberIdentity = (name: string) => {
    const clean = name.trim();
    try { sessionStorage.setItem('watchPartyNickname', clean); } catch { /* stockage optionnel */ }
    return clean;
  };

  const handleJoin = async (event?: FormEvent, selectedCode?: string) => {
    event?.preventDefault();
    const codeToJoin = (selectedCode || joinCode).trim().toUpperCase();
    const cleanNickname = nickname.trim();
    if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(cleanNickname)) {
      setError('Choisis un pseudo de 2 à 24 caractères, sans URL ni symbole spécial.');
      setShowJoin(true);
      return;
    }
    if (!/^[A-Z0-9]{6}$/.test(codeToJoin)) {
      setError('Le code doit contenir 6 lettres ou chiffres.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      rememberIdentity(cleanNickname);
      const result = await apiRequest<{ roomId: string; token: string }>('/api/watchparty/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: codeToJoin, nickname: cleanNickname }),
      });
      storeRoomToken(result.roomId, result.token);
      setShowJoin(false);
      navigate(`/watchparty/room/${result.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de rejoindre ce salon.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const cleanNickname = nickname.trim();
    if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(cleanNickname)) {
      setError('Choisis un pseudo de 2 à 24 caractères, sans URL ni symbole spécial.');
      return;
    }
    if (!selectedMedia) {
      setError('Sélectionne un film, une série ou un anime dans le catalogue.');
      return;
    }
    if (selectedMedia.media_type === 'tv' && (
      selectedSeason === null || selectedEpisode === null || isLoadingSeasons || isLoadingEpisodes
    )) {
      setError('Sélectionne une saison et un épisode disponibles.');
      return;
    }

    const mediaTitle = selectedMedia.title || selectedMedia.name || 'Contenu';
    const poster = selectedMedia.poster_path
      ? `https://image.tmdb.org/t/p/w500${selectedMedia.poster_path}`
      : undefined;
    setIsSubmitting(true);
    setError('');
    try {
      rememberIdentity(cleanNickname);
      const result = await apiRequest<{ roomId: string; roomCode: string; hostToken: string }>('/api/watchparty/create', {
        method: 'POST',
        body: JSON.stringify({
          nickname: cleanNickname,
          maxParticipants: Number(maxParticipants),
          roomName: roomName.trim() || `Watch Party · ${mediaTitle}`,
          isPublic,
          syncMode: 'classic',
          media: {
            src: 'vidrift',
            playbackType: 'vidrift',
            mediaId: String(selectedMedia.id),
            title: mediaTitle,
            poster,
            mediaType: selectedMedia.media_type,
            isAnime: selectedMedia.media_type === 'tv' && selectedMedia.genre_ids?.includes(16) === true,
            seasonNumber: selectedMedia.media_type === 'tv' ? selectedSeason : undefined,
            episodeNumber: selectedMedia.media_type === 'tv' ? selectedEpisode : undefined,
            position: 0,
            isPlaying: false,
          },
        }),
      });
      storeRoomToken(result.roomId, result.hostToken);
      setShowCreate(false);
      setSelectedMedia(null);
      navigate(`/watchparty/room/${result.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le salon.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!room?.code) return;
    const link = `${window.location.origin}/watchparty/join/${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 1800);
    } catch {
      setError('La copie automatique a échoué. Copie ce lien : ' + link);
    }
  };

  const leaveRoom = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (roomId) clearRoomToken(roomId);
    navigate('/watchparty');
  }, [roomId, navigate]);

  // Une commande distante et un snapshot peuvent arriver pendant la même
  // fenêtre : la plus longue doit gagner, sinon un événement local tardif est
  // rebroadcast et peut faire osciller la lecture.
  const suppressRemotePlaybackEvents = useCallback((durationMs: number) => {
    const now = Date.now();
    const until = Math.max(remoteSuppressionUntilRef.current, now + durationMs);
    remoteSuppressionUntilRef.current = until;
    applyingRemoteRef.current = true;
    if (remoteCommandTimeoutRef.current !== null) window.clearTimeout(remoteCommandTimeoutRef.current);
    remoteCommandTimeoutRef.current = window.setTimeout(() => {
      applyingRemoteRef.current = false;
      remoteCommandTimeoutRef.current = null;
      remoteSuppressionUntilRef.current = 0;
    }, Math.max(0, until - now));
  }, []);

  const applyRemotePlayback = useCallback(async (state: PlaybackSnapshot) => {
    authoritativePlaybackRef.current = state;
    const serverNow = Date.now() + clockOffsetRef.current;
    const elapsedSeconds = state.isPlaying && Number.isFinite(state.updatedAt)
      ? Math.max(0, Math.min(6, (serverNow - Number(state.updatedAt)) / 1000))
      : 0;
    const targetPosition = Math.max(0, Number(state.position) + elapsedSeconds);

    if (roomRef.current?.media.playbackType === 'vidrift') {
      const target = vidriftFrameRef.current?.contentWindow;
      if (!target) {
        pendingPlaybackRef.current = state;
        return;
      }
      suppressRemotePlaybackEvents(1200);
      if (Number.isFinite(targetPosition) && Math.abs(vidriftPlaybackRef.current.currentTime - targetPosition) > 0.8) {
        target.postMessage({ type: 'vidrift:resume', currentTime: targetPosition }, VIDRIFT_ORIGIN);
      }
      // Heartbeats repeat the authoritative playback state. Sending play/pause
      // on every heartbeat makes VidRift reopen its controls for guests even
      // when playback is already in the requested state.
      const playbackStateChanged = vidriftPlaybackRef.current.paused !== !state.isPlaying;
      if (playbackStateChanged) {
        target.postMessage({ type: state.isPlaying ? 'vidrift:play' : 'vidrift:pause' }, VIDRIFT_ORIGIN);
      }
      vidriftPlaybackRef.current = {
        ...vidriftPlaybackRef.current,
        paused: !state.isPlaying,
        currentTime: targetPosition,
        updatedAt: performance.now(),
      };
      return;
    }

    const video = videoRef.current;
    if (!video) {
      pendingPlaybackRef.current = state;
      return;
    }
    suppressRemotePlaybackEvents(250);
    if (Number.isFinite(targetPosition) && Math.abs(video.currentTime - targetPosition) > 0.8) {
      video.currentTime = targetPosition;
    }
    if (state.isPlaying && video.paused) {
      await video.play().then(() => setRequiresUserGesture(false)).catch(() => setRequiresUserGesture(true));
    }
    if (!state.isPlaying && !video.paused) video.pause();
    if (!state.isPlaying) setRequiresUserGesture(false);
  }, [suppressRemotePlaybackEvents]);

  const closeVidRiftActivation = () => {
    setVidRiftActivationOpen(false);
    if (vidRiftActivationTimerRef.current !== null) {
      window.clearTimeout(vidRiftActivationTimerRef.current);
      vidRiftActivationTimerRef.current = null;
    }
  };

  const openVidRiftActivation = () => {
    if (vidRiftActivationTimerRef.current !== null) {
      window.clearTimeout(vidRiftActivationTimerRef.current);
    }
    setVidRiftActivationOpen(true);
    vidRiftActivationTimerRef.current = window.setTimeout(() => {
      setVidRiftActivationOpen(false);
      vidRiftActivationTimerRef.current = null;
    }, 7000);
  };

  useEffect(() => {
    return () => {
      if (vidRiftActivationTimerRef.current !== null) {
        window.clearTimeout(vidRiftActivationTimerRef.current);
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    const token = getRoomToken(roomId);
    if (!token) {
      navigate('/watchparty', { replace: true, state: { message: 'Rejoins le salon avec son code pour obtenir ton accès.' } });
      return;
    }
    let active = true;
    // Les handlers Socket.IO peuvent s'exécuter avant que l'effet React qui
    // rafraîchit roomRef soit appliqué : garder la référence synchrone évite
    // d'arbitrer avec un ancien média, rôle ou mode de synchronisation.
    const updateRoom = (updater: (current: Room) => Room) => {
      const current = roomRef.current ?? room;
      if (!current) return;
      const next = updater(current);
      roomRef.current = next;
      setRoom(next);
    };
    let resyncOnForeground: (() => void) | null = null;
    const loadRoom = async () => {
      try {
        const result = await apiRequest<{ room: Room }>(`/api/watchparty/room/${roomId}`, {
          headers: { 'x-watchparty-token': token },
        });
        if (!active) return;
        roomRef.current = result.room;
        setRoom(result.room);
        setParticipants(result.room.participants || []);
        setReadyState(result.room.readyState || {});
        if (result.room.pauseTimer) setPauseTimer(result.room.pauseTimer);
        if (result.room.countdown?.startAt) setCountdownTarget(result.room.countdown.startAt);
        if (result.room.pauseVote) setPauseVote(result.room.pauseVote);
        if (result.room.playbackState) pendingPlaybackRef.current = result.room.playbackState;
        const savedNickname = (() => { try { return sessionStorage.getItem('watchPartyNickname') || 'Invité'; } catch { return 'Invité'; } })();
        const socket = io(`${WATCHPARTY_API}/watchparty`, {
          query: { roomId, nickname: savedNickname, token },
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socketRef.current = socket;
        socket.on('connect', () => {
          setError('');
          setSocketState('connected');
          setSelfId(socket.id || '');
          // Calibrate the client clock against the server before interpolating
          // playback timestamps. The lowest-RTT samples minimize jitter.
          clockOffsetSamplesRef.current = [];
          clockOffsetRef.current = 0;
          pendingClockProbesRef.current.clear();
          for (let index = 0; index < 5; index += 1) {
            const probeId = `${socket.id || 'client'}-${Date.now()}-${++clockProbeSequenceRef.current}`;
            const clientSentAt = Date.now();
            pendingClockProbesRef.current.set(probeId, clientSentAt);
            socket.emit('sync:probe', { probeId, clientSentAt });
          }
          // Ask the server for its authoritative snapshot. This also covers
          // iframe loads and reconnects that happen after the initial join.
          socket.emit('playback:getState');
        });
        socket.on('disconnect', () => {
          setSocketState('disconnected');
          pendingClockProbesRef.current.clear();
        });
        socket.on('connect_error', (err) => {
          setSocketState('disconnected');
          setError(err.message || 'Connexion au salon impossible.');
        });
        socket.on('room:info', (nextRoom: Room) => updateRoom(current => ({ ...current, ...nextRoom })));
        socket.on('room:participants', (next: Participant[]) => setParticipants(next || []));
        socket.on('ready:state', (next: Record<string, boolean>) => setReadyState(next || {}));
        socket.on('room:countdown', (payload: { startAt: number }) => setCountdownTarget(payload.startAt));
        socket.on('room:countdownCancelled', () => setCountdownTarget(null));
        socket.on('room:countdownFinished', () => setCountdownTarget(null));
        socket.on('room:startCountdownDenied', (payload: { message?: string }) => setControlNotice(payload?.message || 'Tout le monde doit être prêt.'));
        socket.on('room:chatToggled', (payload: { enabled: boolean }) => {
          updateRoom(current => ({ ...current, chatEnabled: payload.enabled }));
        });
        socket.on('pause:timerStarted', (payload: PauseTimer) => setPauseTimer(payload));
        socket.on('pause:timerCancelled', () => setPauseTimer(null));
        socket.on('pause:timerFinished', () => setPauseTimer(null));
        socket.on('vote:started', (payload: PauseVote) => setPauseVote(payload));
        socket.on('vote:update', (payload: { yesVotes: number; noVotes: number; totalVotes: number; totalParticipants: number }) => {
          setPauseVote(current => current ? { ...current, ...payload } : current);
        });
        socket.on('vote:ended', () => setPauseVote(null));
        socket.on('reaction:received', (reaction: FloatingReaction) => {
          setReactions(current => [...current.slice(-7), reaction]);
          window.setTimeout(() => setReactions(current => current.filter(item => item.id !== reaction.id)), 3200);
        });
        socket.on('message:deleted', (payload: { messageId: string }) => {
          setMessages(current => current.map(message => message.id === payload.messageId ? { ...message, deleted: true, text: 'Message supprimé par la modération.' } : message));
        });
        socket.on('host:transferred', (payload: { hostId: string }) => {
          updateRoom(current => ({ ...current, hostId: payload.hostId }));
          setControlNotice(payload.hostId === socket.id ? 'Tu es maintenant l’hôte de cette Watch Party.' : 'Le rôle d’hôte a été transféré.');
        });
        socket.on('sync:modeChanged', (payload: { mode: 'classic' | 'pro' }) => {
          updateRoom(current => ({ ...current, syncMode: payload.mode }));
        });
        socket.on('control:state', (state: { controlMode: 'host-only' | 'democratic'; coHosts: string[]; pendingRequests: ControlRequest[] }) => {
          updateRoom(current => ({ ...current, controlMode: state.controlMode, coHosts: state.coHosts || [] }));
          setControlRequests(state.pendingRequests || []);
        });
        socket.on('control:approved', () => setControlNotice('L’hôte t’a accordé le contrôle de la lecture.'));
        socket.on('control:denied', () => setControlNotice('L’hôte a refusé ta demande de contrôle.'));
        socket.on('control:revoked', () => setControlNotice('Ton autorisation de contrôle a été retirée.'));
        socket.on('sync:probeResult', (result: {
          probeId: string;
          clientSentAt: number;
          serverReceivedAt: number;
          serverSentAt: number;
        }) => {
          const sentAt = pendingClockProbesRef.current.get(result.probeId);
          if (sentAt === undefined) return;
          pendingClockProbesRef.current.delete(result.probeId);
          const receivedAt = Date.now();
          syncWorkerRef.current?.postMessage({
            type: 'probe-result',
            result: { ...result, clientReceivedAt: receivedAt } satisfies SyncProbeResult
          });
          const roundTripMs = receivedAt - sentAt;
          if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > 5000) return;
          const offsetMs = (
            (result.serverReceivedAt - sentAt)
            + (result.serverSentAt - receivedAt)
          ) / 2;
          if (!Number.isFinite(offsetMs)) return;
          const samples = clockOffsetSamplesRef.current;
          samples.push({ offsetMs, roundTripMs });
          if (samples.length > 5) samples.shift();
          const bestSamples = [...samples]
            .sort((a, b) => a.roundTripMs - b.roundTripMs)
            .slice(0, 3)
            .map(sample => sample.offsetMs)
            .sort((a, b) => a - b);
          clockOffsetRef.current = bestSamples[Math.floor(bestSamples.length / 2)] ?? 0;
        });
        const handleAuthoritativePlayback = (state: PlaybackSnapshot, isRoomSnapshot = false) => {
          authoritativePlaybackRef.current = state;
          const activeSocketId = socket.id;
          const activeIsHost = Boolean(activeSocketId && roomRef.current?.hostId === activeSocketId);
          const isResync = isRoomSnapshot && resyncRequestedRef.current;
          if (isResync) resyncRequestedRef.current = false;

          if (roomRef.current?.syncMode === 'pro' && syncWorkerRef.current) {
            if (isResync) {
              syncWorkerRef.current.postMessage({ type: 'master-state', state });
              return;
            }
            // Explicit actions arrive with a scheduled event; do not make the
            // worker execute them early from the unscheduled state broadcast.
            // C'est vrai aussi pour l'hôte : il reçoit le même schedule et ne
            // doit pas appliquer l'état explicite deux fois.
            if (!activeIsHost && (state.reason === 'heartbeat' || state.reason === undefined)) {
              syncWorkerRef.current.postMessage({ type: 'master-state', state });
            }
            return;
          }

          if (isResync || !(activeIsHost && state.reason === 'heartbeat' && state.updatedBy === activeSocketId)) {
            void applyRemotePlayback(state);
          }
        };
        socket.on('room:playback', (state: PlaybackSnapshot) => handleAuthoritativePlayback(state, true));
        socket.on('playback:state', (state: PlaybackSnapshot) => handleAuthoritativePlayback(state, false));
        socket.on('playback:schedule', (schedule: ScheduledPlaybackEvent) => {
          if (roomRef.current?.syncMode === 'pro' && syncWorkerRef.current) {
            syncWorkerRef.current.postMessage({ type: 'schedule', event: schedule });
          } else {
            void applyRemotePlayback({
              isPlaying: schedule.action === 'play' || (schedule.action === 'seek' && authoritativePlaybackRef.current?.isPlaying === true),
              position: schedule.position,
              updatedAt: schedule.scheduledAt,
              updatedBy: schedule.updatedBy
            });
          }
        });
        socket.on('room:chat', (message: ChatMessage) => {
          setMessages(current => current.some(item => item.id === message.id) ? current : [...current.slice(-99), message]);
        });
        socket.on('media:updated', (media: Media) => {
          updateRoom(current => ({ ...current, media, pauseTimer: null, pauseVote: null }));
          // La position reçue avant le changement concernait l'ancien média.
          pendingPlaybackRef.current = null;
          setPauseTimer(null);
          setPauseVote(null);
        });
        socket.on('host:token', (payload: { token: string }) => storeRoomToken(roomId, payload.token));
        socket.on('room:kicked', (payload: { reason?: string }) => {
          socket.disconnect();
          clearRoomToken(roomId);
          navigate('/watchparty', {
            replace: true,
            state: { message: payload?.reason || 'Tu as été retiré du salon.' }
          });
        });
        socket.on('room:closed', (payload?: { reason?: string }) => {
          clearRoomToken(roomId);
          socket.disconnect();
          navigate('/watchparty', {
            replace: true,
            state: { message: payload?.reason || 'Ce salon a été fermé.' }
          });
        });
        socket.on('error', (payload: { message?: string }) => setError(payload?.message || 'Erreur de connexion au salon.'));

        // Les navigateurs mobiles gèlent les timers en arrière-plan : à retour
        // en avant-plan, l'hôte réémet sa position et l'invité redemande un
        // snapshot au lieu d'attendre le prochain heartbeat.
        resyncOnForeground = () => {
          if (document.visibilityState !== 'visible') return;
          if (socket.id && roomRef.current?.hostId === socket.id) {
            socket.emit('playback:update', {
              isPlaying: authoritativePlaybackRef.current?.isPlaying === true,
              position: authoritativePlaybackRef.current?.position ?? 0,
              reason: 'heartbeat'
            });
          } else {
            resyncRequestedRef.current = true;
            socket.emit('playback:getState');
          }
        };
        document.addEventListener('visibilitychange', resyncOnForeground);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Impossible de charger le salon.');
          navigate('/watchparty', { replace: true });
        }
      }
    };
    void loadRoom();
    return () => {
      active = false;
      if (resyncOnForeground) document.removeEventListener('visibilitychange', resyncOnForeground);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [roomId, navigate, applyRemotePlayback]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && room?.media?.playbackType !== 'vidrift') {
      video.volume = localVolume;
      video.muted = localMuted;
    }
  }, [room?.media?.src, room?.media?.playbackType, localVolume, localMuted]);

  useEffect(() => {
    const video = videoRef.current;
    const src = room?.media?.src;
    if (!video || !src) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.removeAttribute('src');
    video.load();
    // iPadOS Safari peut annoncer MSE tout en bloquant le chargement HLS.js.
    // Comme sur iPhone, le master est confié au lecteur HLS natif de Safari ;
    // Hls.js reste inchangé sur PC, Android et iPhone.
    const useNativeIpadHls = isIpadSafari()
      && video.canPlayType('application/vnd.apple.mpegurl') !== '';
    const handleNativeError = () => {
      if (useNativeIpadHls) {
        setError('Le flux HLS n’a pas pu être chargé sur iPad. Vérifie la source ou réessaie.');
      }
    };
    if (/\.m3u8(?:$|\?)/i.test(src) && !useNativeIpadHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Le flux HLS n’a pas pu être chargé. Vérifie que le serveur du flux autorise les requêtes vidéo depuis le navigateur.');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      if (useNativeIpadHls) video.addEventListener('error', handleNativeError);
      video.src = src;
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeEventListener('error', handleNativeError);
    };
  }, [room?.media?.src]);

  const isHost = Boolean(selfId && room?.hostId === selfId);
  const isCoHost = Boolean(selfId && room?.coHosts?.includes(selfId));
  const canControl = isHost || isCoHost || room?.controlMode === 'democratic';
  const hasPendingControlRequest = Boolean(selfId && controlRequests.some(request => request.participantId === selfId));
  const allParticipantsReady = participants.length > 1 && participants.every(person => readyState[person.id] === true);
  const countdownSeconds = countdownTarget === null
    ? null
    : Math.max(0, Math.ceil((countdownTarget - countdownNow) / 1000));

  const applySyncCommand = useCallback((command: {
    action: 'play' | 'pause' | 'seek' | 'setPlaybackRate' | 'resetPlaybackRate';
    value?: number;
  }) => {
    suppressRemotePlaybackEvents(1300);

    const isVidRift = roomRef.current?.media.playbackType === 'vidrift';
    const target = vidriftFrameRef.current?.contentWindow;
    const video = videoRef.current;
    if (isVidRift && target) {
      if (command.action === 'play') target.postMessage({ type: 'vidrift:play' }, VIDRIFT_ORIGIN);
      if (command.action === 'pause') target.postMessage({ type: 'vidrift:pause' }, VIDRIFT_ORIGIN);
      if (command.action === 'seek' && Number.isFinite(command.value)) {
        target.postMessage({ type: 'vidrift:resume', currentTime: Math.max(0, command.value as number) }, VIDRIFT_ORIGIN);
      }
      if (command.action === 'setPlaybackRate' && Number.isFinite(command.value)) {
        target.postMessage({ type: 'vidrift:set', speed: command.value }, VIDRIFT_ORIGIN);
      }
      if (command.action === 'resetPlaybackRate') {
        target.postMessage({ type: 'vidrift:set', speed: 1 }, VIDRIFT_ORIGIN);
      }
      return;
    }
    if (!video) return;
    if (command.action === 'play') void video.play().catch(() => setRequiresUserGesture(true));
    if (command.action === 'pause') video.pause();
    if (command.action === 'seek' && Number.isFinite(command.value)) video.currentTime = Math.max(0, command.value as number);
    if (command.action === 'setPlaybackRate' && Number.isFinite(command.value)) video.playbackRate = command.value as number;
    if (command.action === 'resetPlaybackRate') video.playbackRate = 1;
  }, [suppressRemotePlaybackEvents]);

  useEffect(() => {
    if (!roomId || !room) return;
    const worker = new Worker(new URL('../workers/watchpartySync.worker.ts', import.meta.url), { type: 'module' });
    syncWorkerRef.current = worker;
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type: 'status' | 'engine' | 'command';
        status?: 'classic' | 'calibrating' | 'perfect' | 'adjusting' | 'unstable';
        implementation?: 'js' | 'wasm';
        action?: 'play' | 'pause' | 'seek' | 'setPlaybackRate' | 'resetPlaybackRate';
        value?: number;
      };
      if (message.type === 'status' && message.status) setSyncStatus(message.status);
      if (message.type === 'engine' && message.implementation) setSyncEngine(message.implementation);
      if (message.type === 'command' && message.action) {
        applySyncCommand({ action: message.action, value: message.value });
      }
    };
    worker.postMessage({
      type: 'init',
      mode: room.syncMode,
      state: authoritativePlaybackRef.current || room.playbackState || null
    });
    return () => {
      worker.terminate();
      if (remoteCommandTimeoutRef.current !== null) {
        window.clearTimeout(remoteCommandTimeoutRef.current);
        remoteCommandTimeoutRef.current = null;
      }
      applyingRemoteRef.current = false;
      remoteSuppressionUntilRef.current = 0;
      if (syncWorkerRef.current === worker) syncWorkerRef.current = null;
    };
  }, [roomId, room?.id]);

  useEffect(() => {
    if (!roomId || !room) return;
    syncWorkerRef.current?.postMessage({ type: 'set-mode', mode: room.syncMode });
    setSyncStatus(room.syncMode === 'pro' ? 'calibrating' : 'classic');
  }, [roomId, room?.syncMode]);

  useEffect(() => {
    if (!roomId || !room || room.syncMode !== 'pro' || isHost || socketState !== 'connected') {
      if (syncTickTimerRef.current !== null) {
        window.clearInterval(syncTickTimerRef.current);
        syncTickTimerRef.current = null;
      }
      return;
    }
    if (!syncWorkerRef.current) return;

    const tick = () => {
      const now = performance.now();
      if (roomRef.current?.media.playbackType === 'vidrift') {
        if (!vidRiftHasReportedStateRef.current) return;
        const snapshot = vidriftPlaybackRef.current;
        const elapsed = !snapshot.paused && snapshot.updatedAt > 0
          ? Math.max(0, now - snapshot.updatedAt) / 1000
          : 0;
        syncWorkerRef.current?.postMessage({
          type: 'local-state',
          state: {
            now: Date.now(),
            currentTime: Math.max(0, snapshot.currentTime + elapsed * snapshot.playbackRate),
            isPlaying: !snapshot.paused,
            playbackRate: snapshot.playbackRate
          }
        });
      } else {
        const video = videoRef.current;
        if (!video) return;
        syncWorkerRef.current?.postMessage({
          type: 'local-state',
          state: {
            now: Date.now(),
            currentTime: video.currentTime,
            isPlaying: !video.paused,
            playbackRate: video.playbackRate
          }
        });
      }
    };
    syncTickTimerRef.current = window.setInterval(tick, 250);
    return () => {
      if (syncTickTimerRef.current !== null) {
        window.clearInterval(syncTickTimerRef.current);
        syncTickTimerRef.current = null;
      }
    };
  }, [roomId, room?.syncMode, room?.media?.src, room?.media?.playbackType, isHost, socketState]);

  useEffect(() => {
    if (countdownTarget === null && !pauseTimer && !pauseVote) return;
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdownTarget, pauseTimer?.endTime, pauseVote?.endTime]);

  useEffect(() => {
    if (room?.countdown?.startAt) setCountdownTarget(room.countdown.startAt);
  }, [room?.countdown?.startAt]);

  useEffect(() => {
    if (!canControl && !vidRiftActivationOpen) vidriftFrameRef.current?.blur();
  }, [canControl, vidRiftActivationOpen]);

  const sendPlayback = useCallback((reason: 'play' | 'pause' | 'seek' | 'heartbeat' | 'ended') => {
    const socket = socketRef.current;
    if (!socket?.connected || !canControl || applyingRemoteRef.current) return;
    // Co-hosts and democratic viewers may issue controls, but only the room
    // host is the periodic clock source. Otherwise each viewer's heartbeat
    // competes with the others and makes the shared timeline oscillate.
    if (reason === 'heartbeat' && !isHost) return;
    if (reason === 'heartbeat') lastHeartbeatRef.current = Date.now();
    if (roomRef.current?.media.playbackType === 'vidrift') {
      const snapshot = vidriftPlaybackRef.current;
      const now = performance.now();
      const elapsed = !snapshot.paused && snapshot.updatedAt > 0
        ? Math.max(0, now - snapshot.updatedAt) / 1000
        : 0;
      const position = Math.max(0, snapshot.currentTime + elapsed * snapshot.playbackRate);
      vidriftPlaybackRef.current = { ...snapshot, currentTime: position, updatedAt: now };
      socket.emit('playback:update', {
        isPlaying: !snapshot.paused,
        position,
        reason,
      });
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    socket.emit('playback:update', {
      isPlaying: !video.paused,
      position: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      reason,
    });
  }, [canControl, isHost]);

  useEffect(() => {
    if (!roomId || !isHost || socketState !== 'connected') return;
    const heartbeat = window.setInterval(() => sendPlayback('heartbeat'), 1000);
    return () => window.clearInterval(heartbeat);
  }, [roomId, isHost, socketState, sendPlayback]);

  const handleTimeUpdate = () => {
    const now = Date.now();
    if (isHost && now - lastHeartbeatRef.current > 2500) {
      lastHeartbeatRef.current = now;
      sendPlayback('heartbeat');
    }
  };

  const handleVideoReady = () => {
    const pending = pendingPlaybackRef.current;
    if (pending) {
      pendingPlaybackRef.current = null;
      void applyRemotePlayback(pending);
    }
  };

  const applyLocalVolume = (nextVolume: number, nextMuted = false) => {
    const volume = Math.max(0, Math.min(1, Number.isFinite(nextVolume) ? nextVolume : 0.8));
    hasCustomLocalVolumeRef.current = true;
    setLocalVolume(volume);
    setLocalMuted(nextMuted);

    if (roomRef.current?.media.playbackType === 'vidrift') {
      const target = vidriftFrameRef.current?.contentWindow;
      if (!target) return;
      // Volume is local to this iframe only and is never broadcast via Socket.IO.
      target.postMessage({ type: 'vidrift:set', volume, muted: nextMuted }, VIDRIFT_ORIGIN);
      return;
    }

    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = nextMuted;
    }
  };

  const toggleLocalMute = () => {
    const nextMuted = !localMuted;
    const restoreVolume = localVolume > 0 ? localVolume : 0.8;
    applyLocalVolume(restoreVolume, nextMuted);
  };

  const handleVidRiftLoad = () => {
    const target = vidriftFrameRef.current?.contentWindow;
    if (!target) return;
    vidRiftHasReportedStateRef.current = false;
    target.postMessage({ type: 'vidrift:get-state' }, VIDRIFT_ORIGIN);
    if (hasCustomLocalVolumeRef.current) {
      target.postMessage({ type: 'vidrift:set', volume: localVolume, muted: localMuted }, VIDRIFT_ORIGIN);
    }
    socketRef.current?.emit('playback:getState');
  };

  useEffect(() => {
    const media = room?.media;
    if (!roomId || media?.playbackType !== 'vidrift' || !media.mediaId) return;

    const handleVidRiftMessage = (event: MessageEvent) => {
      const frame = vidriftFrameRef.current;
      if (event.origin !== VIDRIFT_ORIGIN || event.source !== frame?.contentWindow) return;
      if (!event.data || typeof event.data !== 'object' || typeof event.data.type !== 'string') return;

      const data = event.data as {
        type: string;
        tmdbId?: number | string;
        mediaType?: string;
        currentTime?: number;
        paused?: boolean;
        volume?: number;
        muted?: boolean;
        speed?: number;
        season?: number;
        episode?: number;
      };
      if (Number(data.tmdbId) !== Number(media.mediaId) || data.mediaType !== media.mediaType) return;

      const currentTime = Number(data.currentTime);
      if (data.type === 'vidrift:state') {
        vidRiftHasReportedStateRef.current = true;
        // Mirror VidRift's local volume settings into this participant's UI only.
        if (typeof data.volume === 'number' && Number.isFinite(data.volume)) {
          setLocalVolume(Math.max(0, Math.min(1, data.volume)));
        }
        if (typeof data.muted === 'boolean') setLocalMuted(data.muted);
        const previous = vidriftPlaybackRef.current;
        const now = performance.now();
        const expectedTime = previous.currentTime + (
          !previous.paused && previous.updatedAt > 0
            ? Math.max(0, now - previous.updatedAt) / 1000
            : 0
        );
        const nextTime = Number.isFinite(currentTime) && currentTime >= 0
          ? currentTime
          : previous.currentTime;
        const nextPaused = typeof data.paused === 'boolean' ? data.paused : previous.paused;
        const pauseChanged = nextPaused !== previous.paused;
        // Distinguish a real seek from the normal time elapsed since the last
        // state/progress message, otherwise metadata changes can look like seeks.
        const positionChanged = Math.abs(nextTime - expectedTime) > 1.5;

        vidriftPlaybackRef.current = {
          currentTime: nextTime,
          paused: nextPaused,
          updatedAt: now,
          playbackRate: Number.isFinite(data.speed) ? Number(data.speed) : previous.playbackRate
        };

        if (!canControl && vidRiftActivationOpen && (pauseChanged || positionChanged)) {
          const authoritative = authoritativePlaybackRef.current;
          closeVidRiftActivation();
          if (authoritative) void applyRemotePlayback(authoritative);
          return;
        }

        // The server snapshot is authoritative when the iframe first loads or
        // reconnects. Apply it before treating the player's initial autoplay
        // state as a new host command.
        const pending = pendingPlaybackRef.current;
        if (pending) {
          pendingPlaybackRef.current = null;
          void applyRemotePlayback(pending);
          return;
        }

        if (!applyingRemoteRef.current && canControl && (pauseChanged || positionChanged)) {
          sendPlayback(pauseChanged ? (nextPaused ? 'pause' : 'play') : 'seek');
        }
        return;
      }

      if (data.type === 'vidrift:progress') {
        if (Number.isFinite(currentTime) && currentTime >= 0) {
          vidriftPlaybackRef.current.currentTime = currentTime;
          vidriftPlaybackRef.current.updatedAt = performance.now();
        }
        if (typeof data.speed === 'number' && Number.isFinite(data.speed)) {
          vidriftPlaybackRef.current.playbackRate = data.speed;
        }
        if (isHost && Date.now() - lastHeartbeatRef.current > 2500) {
          lastHeartbeatRef.current = Date.now();
          sendPlayback('heartbeat');
        }
        return;
      }

      if (data.type === 'vidrift:paused' || data.type === 'vidrift:unpaused') {
        const wasPaused = vidriftPlaybackRef.current.paused;
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        vidriftPlaybackRef.current.paused = data.type === 'vidrift:paused';
        vidriftPlaybackRef.current.updatedAt = performance.now();
        if (typeof data.speed === 'number' && Number.isFinite(data.speed)) {
          vidriftPlaybackRef.current.playbackRate = data.speed;
        }
        // A one-time user activation may change local playback. Immediately
        // restore the server snapshot, then put the guest lock back in place.
        if (!canControl && wasPaused !== vidriftPlaybackRef.current.paused && vidRiftActivationOpen) {
          const authoritative = authoritativePlaybackRef.current;
          closeVidRiftActivation();
          if (authoritative) void applyRemotePlayback(authoritative);
          return;
        }
        // Remote commands update the ref before being posted into the iframe.
        // Only relay an actual local transition, even if VidRift acknowledges
        // it after the short command-suppression window has elapsed.
        if (wasPaused !== vidriftPlaybackRef.current.paused && !applyingRemoteRef.current && canControl) {
          sendPlayback(data.type === 'vidrift:paused' ? 'pause' : 'play');
        }
        return;
      }

      if (data.type === 'vidrift:ended') {
        const wasPaused = vidriftPlaybackRef.current.paused;
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        vidriftPlaybackRef.current.paused = true;
        vidriftPlaybackRef.current.updatedAt = performance.now();
        if (!canControl && !wasPaused && vidRiftActivationOpen) {
          const authoritative = authoritativePlaybackRef.current;
          closeVidRiftActivation();
          if (authoritative) void applyRemotePlayback(authoritative);
          return;
        }
        if (!wasPaused && !applyingRemoteRef.current && canControl) sendPlayback('ended');
        return;
      }

      if (data.type === 'vidrift:episode' && media.mediaType === 'tv') {
        if (!Number.isInteger(data.season) || data.season! < 0
          || !Number.isInteger(data.episode) || data.episode! < 1) return;
        if (!canControl) return;
        socketRef.current?.emit('media:change', {
          ...media,
          src: 'vidrift',
          playbackType: 'vidrift',
          seasonNumber: data.season,
          episodeNumber: data.episode,
          position: 0,
          isPlaying: false,
        });
        return;
      }

      if (data.type === 'vidrift:exit') leaveRoom();
      if (data.type === 'vidrift:command-error') {
        const commandError = event.data as { reason?: string };
        setError(commandError.reason === 'click-required'
          ? 'VidRift attend un premier clic dans le lecteur. Utilise « Activer le lecteur » pour l’autoriser ; le contrôle restera ensuite verrouillé.'
          : 'Le lecteur VidRift n’a pas pu appliquer une commande de synchronisation.');
      }
    };

    window.addEventListener('message', handleVidRiftMessage);
    return () => window.removeEventListener('message', handleVidRiftMessage);
  }, [
    roomId,
    room?.media,
    canControl,
    isHost,
    vidRiftActivationOpen,
    applyRemotePlayback,
    sendPlayback,
    leaveRoom,
  ]);

  const handleSendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || !socketRef.current?.connected) return;
    socketRef.current.emit('chat:message', { text, replyToId: chatReply?.id });
    setChatInput('');
    setChatReply(null);
  };

  const sendReaction = (emoji: string) => {
    if (!socketRef.current?.connected) return;
    socketRef.current.emit('reaction:send', { emoji });
  };

  const toggleReady = () => {
    if (!socketRef.current?.connected || countdownTarget !== null) return;
    socketRef.current.emit('ready:toggle');
  };

  const startTogether = () => {
    if (!isHost || !allParticipantsReady) return;
    socketRef.current?.emit('room:startCountdown');
  };

  const voteForPause = (vote: boolean) => {
    socketRef.current?.emit('vote:cast', { vote });
  };

  const filteredPublicRooms = publicRooms
    .filter(publicRoom => {
      const normalizedQuery = publicQuery.trim().toLocaleLowerCase('fr');
      if (normalizedQuery && !`${publicRoom.title} ${publicRoom.mediaTitle} ${publicRoom.hostNickname}`.toLocaleLowerCase('fr').includes(normalizedQuery)) return false;
      if (publicTypeFilter === 'movie') return publicRoom.mediaType === 'movie';
      if (publicTypeFilter === 'tv') return publicRoom.mediaType === 'tv' && !publicRoom.isAnime;
      if (publicTypeFilter === 'anime') return publicRoom.mediaType === 'tv' && publicRoom.isAnime === true;
      return true;
    })
    .sort((a, b) => publicSort === 'popular'
      ? b.participantCount - a.participantCount || b.createdAt - a.createdAt
      : b.createdAt - a.createdAt);

  if (roomId) {
    return (
      <main className="mx-auto w-full max-w-[1500px] px-4 pb-12 pt-8 text-white sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <button onClick={leaveRoom} className="inline-flex items-center gap-2 text-sm text-white/60 transition hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Retour aux salons
          </button>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
            <span className={`h-2 w-2 rounded-full ${socketState === 'connected' ? 'bg-emerald-400' : socketState === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
            {socketState === 'connected' ? 'Connecté' : socketState === 'connecting' ? 'Connexion…' : 'Déconnecté'}
          </div>
        </div>
        {error && <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
        {!room ? (
          <div className={`${panelClass} flex min-h-72 items-center justify-center gap-3 text-sm text-white/60`}>
            <Loader2 className="h-5 w-5 animate-spin" /> Chargement du salon…
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[.22em] text-red-400">MOVIX WATCH PARTY</p>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{room.name || room.media.title}</h1>
                {room.name && <p className="mt-1 text-sm text-white/45">{room.media.title}</p>}
                <p className="mt-1 text-sm text-white/45">Code du salon <span className="font-mono font-bold tracking-[.18em] text-white">{room.code}</span> · {participants.length}/{room.maxParticipants} participants</p>
              </div>
              <button onClick={handleCopyInvite} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:bg-white/10">
                {copyDone ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copyDone ? 'Lien copié' : 'Inviter des amis'}
              </button>
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className={`${panelClass} overflow-hidden`}>
                <div className="relative aspect-video bg-black">
                  {room.media.playbackType === 'vidrift' ? (
                    <iframe
                      key={buildVidRiftEmbedUrl(room.media)}
                      ref={vidriftFrameRef}
                      src={buildVidRiftEmbedUrl(room.media)}
                      title={room.media.title ? `VidRift — ${room.media.title}` : 'Lecteur VidRift'}
                      className="h-full w-full border-0 bg-black"
                      tabIndex={canControl ? 0 : -1}
                      allow="autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope"
                      allowFullScreen
                      onLoad={handleVidRiftLoad}
                    />
                  ) : (
                    <video
                      ref={videoRef}
                      className="h-full w-full bg-black object-contain"
                      poster={room.media.poster || undefined}
                      controls={canControl}
                      playsInline
                      onLoadedMetadata={handleVideoReady}
                      onCanPlay={handleVideoReady}
                      onPlay={() => { setRequiresUserGesture(false); sendPlayback('play'); }}
                      onPause={() => sendPlayback('pause')}
                      onSeeked={() => sendPlayback('seek')}
                      onTimeUpdate={handleTimeUpdate}
                    />
                  )}
                  {room.media.playbackType === 'vidrift' && !canControl && !vidRiftActivationOpen && (
                    <div
                      className="absolute inset-0 z-20 flex flex-col items-center justify-end gap-3 bg-black/[0.025] p-4"
                      role="group"
                      aria-label="Commandes de lecture verrouillées"
                      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
                      onClick={event => { event.preventDefault(); event.stopPropagation(); }}
                      onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); }}
                      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
                      onKeyDown={event => { event.preventDefault(); event.stopPropagation(); }}
                    >
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-2 text-xs font-semibold text-white/80 shadow-lg backdrop-blur">
                        <LockKeyhole className="h-3.5 w-3.5 text-amber-300" />
                        Lecture contrôlée par {participants.find(person => person.isHost)?.nickname || 'l’hôte'}
                      </div>
                      <button
                        type="button"
                        onClick={openVidRiftActivation}
                        className="rounded-full border border-white/15 bg-white px-4 py-2 text-xs font-bold text-black shadow-lg transition hover:bg-white/85"
                      >
                        Activer le lecteur
                      </button>
                    </div>
                  )}
                  {room.media.playbackType === 'vidrift' && !canControl && vidRiftActivationOpen && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
                      <span className="rounded-full border border-white/10 bg-black/80 px-3 py-2 text-[11px] font-semibold text-white/80 shadow-lg backdrop-blur">
                        Clique une fois dans le lecteur pour activer la synchronisation…
                      </span>
                    </div>
                  )}
                  {room.media.playbackType !== 'vidrift' && !canControl && (
                    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-black/70 px-3 py-2 text-xs text-white/75 backdrop-blur">
                      Lecture synchronisée par {participants.find(person => person.isHost)?.nickname || 'l’hôte'}
                    </div>
                  )}
                  {requiresUserGesture && room.media.playbackType !== 'vidrift' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
                      <button onClick={() => { void videoRef.current?.play().catch(() => setError('Impossible de démarrer la lecture sur cet appareil.')); }} className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-xl transition hover:bg-red-500">
                        <Play className="h-4 w-4 fill-current" /> Activer la lecture synchronisée
                      </button>
                    </div>
                  )}
                  {countdownSeconds !== null && countdownSeconds > 0 && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm">
                      <p className="text-xs font-bold uppercase tracking-[.25em] text-white/65">Départ collectif dans</p>
                      <span className="mt-2 text-7xl font-black tabular-nums text-white drop-shadow-2xl">{countdownSeconds}</span>
                    </div>
                  )}
                  {reactions.length > 0 && (
                    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
                      {reactions.map((reaction, index) => (
                        <div key={reaction.id} className="absolute bottom-8 animate-bounce text-4xl drop-shadow-lg" style={{ left: `${12 + ((index * 19) % 76)}%`, animationDuration: '1.4s' }}>
                          <span>{reaction.emoji}</span>
                          <span className="mt-1 block max-w-24 truncate rounded-full bg-black/70 px-2 py-0.5 text-center text-[9px] font-semibold text-white/80">{reaction.senderNickname}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                  <div className="flex min-w-[220px] flex-1 items-center gap-3" aria-label="Réglage de volume personnel">
                    <button
                      type="button"
                      onClick={toggleLocalMute}
                      aria-label={localMuted ? 'Réactiver mon son' : 'Couper mon son'}
                      title={localMuted ? 'Réactiver mon son' : 'Couper mon son'}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/65 transition hover:bg-white/[0.07] hover:text-white"
                    >
                      {localMuted || localVolume === 0
                        ? <VolumeX className="h-4 w-4" />
                        : <Volume2 className="h-4 w-4" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={localMuted ? 0 : Math.round(localVolume * 100)}
                      onChange={event => {
                        const nextVolume = Number(event.target.value) / 100;
                        applyLocalVolume(nextVolume, nextVolume === 0);
                      }}
                      aria-label="Volume personnel"
                      title="Volume personnel"
                      className="h-1.5 w-full max-w-36 cursor-pointer accent-red-500"
                    />
                    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-white/45">
                      {localMuted ? 0 : Math.round(localVolume * 100)}%
                    </span>
                    <span className="hidden text-[11px] text-white/35 sm:inline">Volume perso.</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-white/65">Synchronisation {room.syncMode === 'pro' ? 'Pro' : 'classique'} · {room.controlMode === 'democratic' ? 'Contrôle partagé' : 'Contrôle hôte'}</p>
                    {room.syncMode === 'pro' && (
                      <p className="text-[10px] text-white/35">
                        {syncStatus === 'perfect' ? 'Synchronisation stable' : syncStatus === 'adjusting' ? 'Correction du décalage…' : syncStatus === 'unstable' ? 'Rattrapage en cours…' : 'Calibration…'}
                        {' · '}Moteur {syncEngine === 'wasm' ? 'WASM' : 'JS'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['😂', '❤️', '🔥', '😱', '👏', '🍿'] as const).map(emoji => (
                      <button key={emoji} type="button" onClick={() => sendReaction(emoji)} disabled={socketState !== 'connected'} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.045] text-base transition hover:bg-white/[0.12] disabled:opacity-40" aria-label={`Envoyer la réaction ${emoji}`}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={toggleReady}
                    disabled={socketState !== 'connected' || countdownTarget !== null}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-40 ${readyState[selfId] ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.05] text-white/65 hover:bg-white/10'}`}
                  >
                    {readyState[selfId] ? '✓ Prêt' : 'Je suis prêt'}
                  </button>
                  {isHost && (
                    <button type="button" onClick={startTogether} disabled={!allParticipantsReady || countdownTarget !== null || socketState !== 'connected'} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40">
                      {countdownTarget !== null ? 'Départ en cours…' : `Lancer ensemble · ${participants.filter(person => readyState[person.id]).length}/${participants.length}`}
                    </button>
                  )}
                  {isHost && (
                    <button type="button" onClick={() => { if (pauseTimer) socketRef.current?.emit('pause:cancel'); else socketRef.current?.emit('pause:start', { duration: 60 }); }} className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/65 transition hover:bg-white/10">
                      {pauseTimer ? 'Annuler la pause' : 'Pause 60 s'}
                    </button>
                  )}
                  {!canControl && !pauseVote && (
                    <button type="button" onClick={() => socketRef.current?.emit('vote:request', { duration: 60 })} className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs font-semibold text-white/55 transition hover:bg-white/10">
                      Demander une pause
                    </button>
                  )}
                  {countdownTarget !== null && isHost && (
                    <button type="button" onClick={() => socketRef.current?.emit('room:cancelCountdown')} className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs text-white/60 hover:bg-white/10">Annuler le départ</button>
                  )}
                  {!canControl && room.controlMode === 'host-only' && (
                    <button
                      onClick={() => {
                        socketRef.current?.emit('control:request');
                        setControlNotice('Demande envoyée à l’hôte.');
                      }}
                      disabled={hasPendingControlRequest || socketState !== 'connected'}
                      className="text-xs font-semibold text-red-300 transition hover:text-red-200 disabled:cursor-not-allowed disabled:text-white/40"
                    >
                      {hasPendingControlRequest ? 'Demande en attente…' : 'Demander le contrôle'}
                    </button>
                  )}
                  {controlNotice && (
                    <p className="w-full text-right text-[11px] text-white/55" role="status">{controlNotice}</p>
                  )}
                  {isHost && (
                    <button
                      onClick={() => socketRef.current?.emit('sync:setMode', { mode: room.syncMode === 'pro' ? 'classic' : 'pro' })}
                      className="text-xs font-semibold text-red-300 transition hover:text-red-200"
                    >
                      {room.syncMode === 'pro' ? 'Désactiver Sync Pro' : 'Activer Sync Pro'}
                    </button>
                  )}
                  {isHost && (
                    <button
                      onClick={() => socketRef.current?.emit('control:setMode', { mode: room.controlMode === 'democratic' ? 'host-only' : 'democratic' })}
                      className="text-xs font-semibold text-white/70 transition hover:text-white"
                    >
                      {room.controlMode === 'democratic' ? 'Réserver le contrôle à l’hôte' : 'Autoriser tout le monde à contrôler'}
                    </button>
                  )}
                </div>
              </section>
              <aside className="space-y-5">
                {isHost && controlRequests.length > 0 && (
                  <section className={`${panelClass} space-y-3 p-4`}>
                    <h2 className="text-sm font-bold">Demandes de contrôle</h2>
                    {controlRequests.map(request => (
                      <div key={request.participantId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-white/75">{request.nickname}</span>
                        <div className="flex shrink-0 gap-2">
                          <button onClick={() => socketRef.current?.emit('control:approve', { participantId: request.participantId })} className="rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">Accepter</button>
                          <button onClick={() => socketRef.current?.emit('control:deny', { participantId: request.participantId })} className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs font-semibold text-white/55 hover:bg-white/10">Refuser</button>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
                {pauseVote && (
                  <section className={`${panelClass} space-y-3 p-4`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-bold">Vote pour une pause</h2>
                      <span className="text-[10px] text-white/40">{Math.max(0, Math.ceil((pauseVote.endTime - countdownNow) / 1000))} s</span>
                    </div>
                    <p className="text-xs text-white/50">{pauseVote.requestedByNickname} propose une pause de {pauseVote.requestedDuration} secondes.</p>
                    <p className="text-xs tabular-nums text-white/65">👍 {pauseVote.yesVotes || 0} · 👎 {pauseVote.noVotes || 0} · {pauseVote.totalVotes || 0}/{pauseVote.totalParticipants}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => voteForPause(true)} className="flex-1 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">Voter oui</button>
                      <button type="button" onClick={() => voteForPause(false)} className="flex-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/20">Voter non</button>
                    </div>
                  </section>
                )}
                {pauseTimer && (
                  <section className={`${panelClass} flex items-center justify-between gap-3 p-4`}>
                    <div>
                      <p className="text-sm font-bold">Pause collective</p>
                      <p className="mt-1 text-xs text-white/45">{pauseTimer.resumeAfterPause === false ? 'La lecture était déjà en pause.' : 'Reprise automatique à la fin du minuteur.'}</p>
                    </div>
                    <span className="text-lg font-black tabular-nums text-amber-300">{Math.max(0, Math.ceil((pauseTimer.endTime - countdownNow) / 1000))} s</span>
                  </section>
                )}
                {isHost && (
                  <section className={`${panelClass} space-y-4 p-4`}>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold">Gérer la salle</h2>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Hôte</span>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between gap-3">
                      <span>
                        <span className="block text-xs font-semibold text-white/80">Salle publique</span>
                        <span className="block text-[10px] text-white/35">Visible dans la galerie Watch Party</span>
                      </span>
                      <input type="checkbox" checked={room.isPublic} onChange={event => socketRef.current?.emit('room:setVisibility', { isPublic: event.target.checked })} className="h-4 w-4 accent-red-500" />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3">
                      <span>
                        <span className="block text-xs font-semibold text-white/80">Discussion</span>
                        <span className="block text-[10px] text-white/35">Autoriser les messages des spectateurs</span>
                      </span>
                      <input type="checkbox" checked={room.chatEnabled !== false} onChange={event => socketRef.current?.emit('room:toggleChat', { enabled: event.target.checked })} className="h-4 w-4 accent-red-500" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-white/80">Capacité maximale</span>
                      <select value={room.maxParticipants} onChange={event => socketRef.current?.emit('room:setMaxParticipants', { max: Number(event.target.value) })} className={inputClass}>
                        {[2,4,6,8,10,15,20,30,50].filter(value => value >= participants.length).map(value => <option key={value} value={value}>{value} personnes</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => { if (window.confirm('Fermer définitivement cette Watch Party ?')) socketRef.current?.emit('room:close'); }} className="w-full rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/15">
                      Fermer la salle
                    </button>
                  </section>
                )}
                <section className={`${panelClass} p-4`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-red-400" /> Participants</h2>
                    <span className="text-xs text-white/40">{participants.filter(person => readyState[person.id]).length} prêts · {participants.length}/{room.maxParticipants}</span>
                  </div>
                  <div className="space-y-2">
                    {participants.map(person => (
                      <div key={person.id} className="flex items-center gap-2 rounded-lg bg-white/[0.035] px-3 py-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{person.nickname.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-white/85">{person.nickname}{person.id === selfId ? ' (toi)' : ''}</span>
                        <span className={`text-[10px] ${readyState[person.id] ? 'text-emerald-300' : 'text-white/25'}`}>{readyState[person.id] ? 'Prêt' : 'En attente'}</span>
                        {person.isHost && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Hôte</span>}
                        {!person.isHost && room.coHosts?.includes(person.id) && <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Contrôle</span>}
                        {isHost && !person.isHost && (
                          <>
                            <button type="button" onClick={() => socketRef.current?.emit('host:transfer', { participantId: person.id })} className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-200 transition hover:bg-amber-500/20" title="Transférer le rôle d'hôte">Passer hôte</button>
                            <button type="button" onClick={() => socketRef.current?.emit('participant:kick', { participantId: person.id })} className="shrink-0 rounded-md bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-300 transition hover:bg-red-500/20" title="Retirer ce participant">Exclure</button>
                          </>
                        )}
                        {isHost && room.controlMode === 'host-only' && !person.isHost && room.coHosts?.includes(person.id) && (
                          <button
                            type="button"
                            onClick={() => socketRef.current?.emit('control:revoke', { participantId: person.id })}
                            className="shrink-0 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/55 transition hover:bg-red-500/15 hover:text-red-300"
                          >
                            Retirer le contrôle
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <section className={`${panelClass} flex min-h-[360px] flex-col p-4`}>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><MessageCircle className="h-4 w-4 text-red-400" /> Discussion</h2>
                  <div className="mb-3 flex-1 space-y-3 overflow-y-auto pr-1">
                    {messages.length === 0 ? <p className="py-8 text-center text-xs text-white/35">La discussion commence ici.</p> : messages.map(message => (
                      <div key={message.id} className={message.type === 'system' ? 'text-center text-[11px] text-white/35' : 'group rounded-lg px-2 py-1.5 transition hover:bg-white/[0.025]'}>
                        {message.type === 'system' ? message.text : message.deleted ? (
                          <p className="text-xs italic text-white/30">Message supprimé par la modération.</p>
                        ) : (
                          <>
                            {message.replyTo && (
                              <div className="mb-1 border-l-2 border-red-400/50 pl-2">
                                <p className="text-[10px] font-semibold text-white/45">{message.replyTo.senderNickname}</p>
                                <p className="line-clamp-1 text-[10px] text-white/35">{message.replyTo.text}</p>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <p className="mb-0.5 text-[11px] font-semibold text-white/55">{message.senderNickname}</p>
                              <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                                <button type="button" onClick={() => setChatReply(message)} className="text-[10px] font-semibold text-white/45 hover:text-red-300">Répondre</button>
                                {isHost && <button type="button" onClick={() => socketRef.current?.emit('message:delete', { messageId: message.id })} className="text-[10px] font-semibold text-red-300/70 hover:text-red-300">Supprimer</button>}
                              </div>
                            </div>
                            <p className="break-words text-sm leading-relaxed text-white/85">{message.text}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  {chatReply && (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border-l-2 border-red-400 bg-white/[0.035] px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold text-red-300">Réponse à {chatReply.senderNickname}</p>
                        <p className="truncate text-xs text-white/50">{chatReply.text}</p>
                      </div>
                      <button type="button" onClick={() => setChatReply(null)} className="text-xs text-white/45 hover:text-white">Annuler</button>
                    </div>
                  )}
                  {room.chatEnabled === false && !canControl && (
                    <p className="mb-2 text-center text-[11px] text-amber-200/70">La discussion est désactivée par l’hôte.</p>
                  )}
                  <form onSubmit={handleSendMessage} className="flex gap-2 border-t border-white/[0.07] pt-3">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={room.chatEnabled === false && !canControl ? 'Discussion désactivée' : 'Écrire un message…'} maxLength={500} className={inputClass} disabled={room.chatEnabled === false && !canControl} />
                    <button type="submit" disabled={!chatInput.trim() || socketState !== 'connected' || (room.chatEnabled === false && !canControl)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white transition hover:bg-red-500 disabled:opacity-40" aria-label="Envoyer"><Send className="h-4 w-4" /></button>
                  </form>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
    );
  }

  const openJoinDialog = (code = '') => {
    setJoinCode(code.toUpperCase());
    setError('');
    setShowJoin(true);
  };

  const openCreateDialog = () => {
    setError('');
    setShowCreate(true);
  };

  return (
    <main className="mx-auto min-h-[calc(100vh-150px)] w-full max-w-[1584px] px-6 pb-20 pt-14 text-white">
      <header className="mb-11">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-black tracking-[-0.045em] sm:text-5xl">Watch Party</h1>
            <p className="mt-3 text-base text-white/55">Regardez films et séries entre amis, en synchro</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void refreshPublicRooms()}
              disabled={isLoadingRooms}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#454545] px-4 text-xs font-bold text-white/90 transition hover:bg-[#555] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingRooms ? 'animate-spin' : ''}`} />
              Rafraîchir
            </button>
            <button
              type="button"
              onClick={() => openJoinDialog()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#171717] px-4 text-xs font-semibold text-white/85 transition hover:bg-[#242424]"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Rejoindre avec un code
            </button>
            <button type="button" onClick={openCreateDialog} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-xs font-bold text-[#111] transition hover:bg-white/85">
              <Plus className="h-4 w-4" />
              Créer une salle
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Fermer"><X className="h-4 w-4" /></button>
        </div>
      )}

      <section>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-extrabold tracking-tight">Salles publiques</h2>
            <span className="text-sm font-semibold text-white/45">{isLoadingRooms ? '…' : filteredPublicRooms.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={publicQuery}
              onChange={event => setPublicQuery(event.target.value)}
              placeholder="Rechercher une salle, un film, un hôte…"
              className="h-9 w-64 max-w-full rounded-lg border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-red-500/50"
            />
            <select value={publicSort} onChange={event => setPublicSort(event.target.value as 'recent' | 'popular')} className="h-9 rounded-lg border border-white/10 bg-[#171717] px-3 text-xs text-white/75">
              <option value="recent">Plus récentes</option>
              <option value="popular">Plus populaires</option>
            </select>
          </div>
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          {([
            ['all', 'Tout'],
            ['movie', 'Films'],
            ['tv', 'Séries'],
            ['anime', 'Anime'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPublicTypeFilter(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${publicTypeFilter === value ? 'bg-red-600 text-white' : 'border border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoadingRooms ? (
          <div className="flex min-h-48 items-center gap-3 text-sm text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des salles publiques…
          </div>
        ) : filteredPublicRooms.length === 0 ? (
          <div className="flex min-h-64 max-w-2xl flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05]">
              <Users className="h-6 w-6 text-white/35" />
            </div>
            <h3 className="text-base font-bold">{publicRooms.length === 0 ? 'Aucune salle publique pour le moment' : 'Aucune salle ne correspond à ta recherche'}</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/40">{publicRooms.length === 0 ? 'Crée la première salle et invite tes amis à te rejoindre.' : 'Modifie les filtres ou essaie un autre titre.'}</p>
            {publicRooms.length === 0 && (
              <button type="button" onClick={openCreateDialog} className={`${buttonClass} mt-5`}>
                <Plus className="h-4 w-4" /> Créer une salle
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,312px),312px))] gap-x-2.5 gap-y-7">
            {filteredPublicRooms.map(publicRoom => (
              <button
                key={publicRoom.id}
                type="button"
                onClick={() => openJoinDialog(publicRoom.code)}
                className="group w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#191919]">
                  {publicRoom.poster ? (
                    <img src={publicRoom.poster} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.045] group-hover:brightness-75" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(ellipse_at_30%_20%,rgba(220,38,38,.22),transparent_60%),linear-gradient(135deg,#242424,#101010)] px-5 text-center">
                      <Film className="absolute left-4 top-4 h-5 w-5 text-white/25" />
                      <span className="line-clamp-2 text-lg font-bold text-white/75">{publicRoom.mediaTitle || publicRoom.title}</span>
                    </div>
                  )}
                  <div className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.8)]" />
                    <Users className="h-3 w-3" />
                    {publicRoom.participantCount}
                  </div>
                  <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur" title="Accès par code">
                    <LockKeyhole className="h-3.5 w-3.5" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex translate-y-2 items-center justify-center bg-gradient-to-t from-black/75 to-transparent pb-3 pt-8 opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                    <span className="rounded-full bg-white px-4 py-1.5 text-[11px] font-bold text-black">Rejoindre la salle</span>
                  </div>
                </div>
                <h3 className="mt-2.5 truncate text-[13px] font-semibold text-white/90 transition group-hover:text-white">{publicRoom.title}</h3>
                <p className="mt-1 truncate text-[11px] text-white/45">Par {publicRoom.hostNickname || 'Hôte'}</p>
                <p className="mt-1 truncate text-[11px] text-white/35">{publicRoom.mediaTitle || publicRoom.title}{publicRoom.isAnime ? ' · Anime' : publicRoom.mediaType === 'tv' ? ' · Série' : ' · Film'} · {publicRoom.participantCount}/{publicRoom.maxParticipants} en ligne · Sync {publicRoom.syncMode === 'pro' ? 'Pro' : 'classique'}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="watchparty-create-title" className="my-auto max-h-[min(90vh,850px)] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#151515] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#151515]/95 px-6 py-5 backdrop-blur">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-red-400">MOVIX WATCH PARTY</p>
                <h2 id="watchparty-create-title" className="mt-1 text-xl font-bold">Créer une salle</h2>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Fermer" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4 p-6">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Nom de la salle</span>
                <input value={roomName} onChange={event => setRoomName(event.target.value)} maxLength={80} placeholder="Ex. Soirée cinéma" className={inputClass} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Ton pseudo</span>
                <input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={24} placeholder="Ex. Yuno" className={inputClass} />
              </label>
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-white/70">Choisir le contenu</span>
                  <div className="relative">
                    <input
                      value={catalogQuery}
                      onChange={event => setCatalogQuery(event.target.value)}
                      maxLength={100}
                      placeholder="Rechercher un film, une série ou un anime…"
                      className={`${inputClass} pl-10`}
                    />
                    <Film className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    {isSearchingCatalog && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-red-400" />}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['all', 'Tout'],
                    ['movie', 'Films'],
                    ['tv', 'Séries'],
                    ['anime', 'Anime'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCatalogType(value)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${catalogType === value ? 'bg-red-600 text-white' : 'border border-white/10 bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {catalogQuery.trim().length >= 2 && (
                  <div className="max-h-64 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/20 p-2">
                    {isSearchingCatalog ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/45">
                        <Loader2 className="h-4 w-4 animate-spin" /> Recherche dans le catalogue…
                      </div>
                    ) : (
                      (() => {
                        const visibleResults = catalogResults.filter(item => {
                          if (catalogType === 'movie') return item.media_type === 'movie';
                          if (catalogType === 'tv') return item.media_type === 'tv';
                          if (catalogType === 'anime') return item.media_type === 'tv' && item.genre_ids?.includes(16);
                          return true;
                        });
                        return visibleResults.length > 0 ? (
                          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {visibleResults.map(item => {
                              const itemTitle = item.title || item.name || 'Sans titre';
                              const year = (item.release_date || item.first_air_date || '').slice(0, 4);
                              const isAnime = item.media_type === 'tv' && item.genre_ids?.includes(16);
                              return (
                                <button
                                  key={`${item.media_type}-${item.id}`}
                                  type="button"
                                  onClick={() => selectCatalogMedia(item)}
                                  className="group min-w-0 rounded-lg p-1 text-left transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                >
                                  <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-white/[0.05]">
                                    {item.poster_path ? (
                                      <img src={`https://image.tmdb.org/t/p/w342${item.poster_path}`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                                    ) : (
                                      <div className="flex h-full items-center justify-center"><Film className="h-6 w-6 text-white/25" /></div>
                                    )}
                                    <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white/80">
                                      {isAnime ? 'ANIME' : item.media_type === 'tv' ? 'SÉRIE' : 'FILM'}
                                    </span>
                                  </div>
                                  <span className="mt-1.5 block line-clamp-2 text-[11px] font-semibold leading-4 text-white/85">{itemTitle}</span>
                                  <span className="block text-[10px] text-white/40">{year || 'Date inconnue'}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="px-3 py-7 text-center text-xs text-white/40">Aucun résultat dans cette catégorie.</p>
                        );
                      })()
                    )}
                  </div>
                )}
                {selectedMedia ? (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/[0.055] p-3">
                    <div className="flex items-start gap-3">
                      {selectedMedia.poster_path ? (
                        <img src={`https://image.tmdb.org/t/p/w342${selectedMedia.poster_path}`} alt="" className="h-24 w-16 shrink-0 rounded-lg bg-black object-cover" />
                      ) : (
                        <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]"><Film className="h-5 w-5 text-white/30" /></div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-red-300">Contenu sélectionné</p>
                        <h3 className="mt-1 text-sm font-bold text-white">{selectedMedia.title || selectedMedia.name}</h3>
                        <p className="mt-1 text-xs text-white/45">
                          {selectedMedia.media_type === 'tv'
                            ? (selectedMedia.genre_ids?.includes(16) ? 'Anime / série' : 'Série')
                            : 'Film'}
                          {' · '}
                          {(selectedMedia.release_date || selectedMedia.first_air_date || '').slice(0, 4) || 'Année inconnue'}
                        </p>
                        <button type="button" onClick={() => { setSelectedMedia(null); setSeasons([]); setEpisodes([]); setSelectedSeason(null); setSelectedEpisode(null); }} className="mt-3 text-[11px] font-semibold text-red-300 hover:text-red-200">Changer de contenu</button>
                      </div>
                    </div>
                    {selectedMedia.media_type === 'tv' && (
                      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-3">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-white/65">Saison</span>
                          <select
                            value={selectedSeason ?? ''}
                            onChange={event => setSelectedSeason(Number(event.target.value))}
                            disabled={isLoadingSeasons || seasons.length === 0}
                            className={inputClass}
                          >
                            {isLoadingSeasons && <option value="">Chargement…</option>}
                            {seasons.map(season => <option key={season.id} value={season.season_number}>{season.name || `Saison ${season.season_number}`}</option>)}
                          </select>
                        </label>
                        <label className="block space-y-1.5">
                          <span className="text-xs font-semibold text-white/65">Épisode</span>
                          <select
                            value={selectedEpisode ?? ''}
                            onChange={event => setSelectedEpisode(Number(event.target.value))}
                            disabled={isLoadingEpisodes || episodes.length === 0}
                            className={inputClass}
                          >
                            {isLoadingEpisodes && <option value="">Chargement…</option>}
                            {episodes.map(episode => <option key={episode.id} value={episode.episode_number}>E{String(episode.episode_number).padStart(2, '0')} · {episode.name || `Épisode ${episode.episode_number}`}</option>)}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center">
                    <p className="text-xs text-white/45">Recherche un titre puis sélectionne son affiche pour choisir le film ou l’épisode à regarder ensemble.</p>
                  </div>
                )}
                {!TMDB_API_KEY && (
                  <p className="text-xs text-red-300">La clé de recherche TMDB n’est pas configurée sur cette version du site.</p>
                )}
              </section>
              <div className="grid grid-cols-1 gap-3">
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-white/70">Places</span>
                  <select value={maxParticipants} onChange={event => setMaxParticipants(event.target.value)} className={inputClass}>{[2,4,6,8,10,15,20,30,50].map(value => <option key={value} value={value}>{value} personnes</option>)}</select>
                </label>
              </div>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3">
                <input type="checkbox" checked={isPublic} onChange={event => setIsPublic(event.target.checked)} className="h-4 w-4 accent-red-500" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Salle publique</span><span className="block text-[11px] text-white/40">Visible dans la galerie. Sinon, seul le code permet de rejoindre.</span></span>
                <Globe2 className="h-4 w-4 text-white/35" />
              </label>
              {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-white/[0.07] pt-4">
                <button type="button" onClick={() => setShowCreate(false)} className="h-11 rounded-xl px-4 text-sm font-semibold text-white/60 transition hover:bg-white/[0.06] hover:text-white">Annuler</button>
                <button type="submit" disabled={isSubmitting || !selectedMedia || (selectedMedia.media_type === 'tv' && (selectedSeason === null || selectedEpisode === null || isLoadingSeasons || isLoadingEpisodes))} className={buttonClass}>{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer la salle</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showJoin && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setShowJoin(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="watchparty-join-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#151515] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-red-400">MOVIX WATCH PARTY</p>
                <h2 id="watchparty-join-title" className="mt-1 text-lg font-bold">Rejoindre une salle</h2>
              </div>
              <button type="button" onClick={() => setShowJoin(false)} aria-label="Fermer" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/45 transition hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleJoin} className="space-y-4 p-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Ton pseudo</span>
                <input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={32} placeholder="Ex. Yuno" className={inputClass} autoFocus />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Code d’invitation</span>
                <input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ABC123" maxLength={6} className={`${inputClass} text-center font-mono text-xl font-bold tracking-[.28em]`} />
              </label>
              {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
              <button type="submit" disabled={isSubmitting || joinCode.length !== 6} className={`${buttonClass} w-full`}>{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Rejoindre la salle</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
};

export default WatchPartyPage;
