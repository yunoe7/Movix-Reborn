import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import axios from 'axios';
import { getTmdbLanguage } from '../i18n';
import Hls from 'hls.js';
import {
  ArrowLeft, Check, Copy, Film, Globe2, KeyRound, Loader2, LockKeyhole,
  MessageCircle, Play, Plus, RefreshCw, Send, Users, X,
} from 'lucide-react';
import { clearRoomToken, getRoomToken, storeRoomToken } from '../utils/watchparty';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

const WATCHPARTY_API = String(
  import.meta.env.VITE_WATCHPARTY_API || 'https://watchparty-api-production.up.railway.app',
).trim().replace(/\/+$/, '');

type Media = {
  src: string;
  title: string;
  poster?: string | null;
  mediaType: 'movie' | 'tv';
  mediaId?: string;
  playbackType?: 'direct' | 'vidrift';
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
  timestamp: number;
  type: 'chat' | 'system' | 'action';
};

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
  playbackState?: { isPlaying: boolean; position: number; updatedAt: number };
};

type ControlRequest = { participantId: string; nickname: string; requestedAt?: number };

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
  seasonNumber?: number;
  episodeNumber?: number;
  createdAt: number;
};

const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';

function buildVidRiftEmbedUrl(media: Media): string {
  const tmdbId = String(media.mediaId || '');
  if (!/^\d+$/.test(tmdbId)) return '';
  const season = Math.max(0, Number(media.seasonNumber) || 1);
  const episode = Math.max(1, Number(media.episodeNumber) || 1);
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
  const [error, setError] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [controlRequests, setControlRequests] = useState<ControlRequest[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [selfId, setSelfId] = useState('');
  const [socketState, setSocketState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [copyDone, setCopyDone] = useState(false);
  const [requiresUserGesture, setRequiresUserGesture] = useState(false);
  const [controlNotice, setControlNotice] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const vidriftFrameRef = useRef<HTMLIFrameElement>(null);
  const roomRef = useRef<Room | null>(null);
  const vidriftPlaybackRef = useRef({ currentTime: 0, paused: true });
  const hlsRef = useRef<Hls | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastHeartbeatRef = useRef(0);
  const pendingPlaybackRef = useRef<{ isPlaying: boolean; position: number } | null>(null);

  useEffect(() => {
    if (!routeCode) return;
    setJoinCode(routeCode.toUpperCase());
    setShowJoin(true);
  }, [routeCode]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

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
    if (cleanNickname.length < 2) {
      setError('Choisis un pseudo d’au moins 2 caractères.');
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
    const launchContext = watchPartyContext;
    const useVidRift = Boolean(launchContext && /^\d+$/.test(launchContext.tmdbId));
    const contentTitle = launchContext?.title.trim() || title.trim();
    const contentPoster = launchContext?.posterPath || posterUrl.trim();

    if (cleanNickname.length < 2) {
      setError('Choisis un pseudo d’au moins 2 caractères.');
      return;
    }
    if (!contentTitle) {
      setError('Ajoute un titre pour le film ou la série.');
      return;
    }
    if (!useVidRift && !isDirectVideoUrl(sourceUrl.trim())) {
      setError('Ajoute un lien vidéo direct en MP4, WebM ou M3U8 (HLS).');
      return;
    }
    if (contentPoster) {
      try {
        const poster = new URL(contentPoster);
        if (!['http:', 'https:'].includes(poster.protocol)) throw new Error();
      } catch {
        setError('Le lien de l’affiche doit être une URL valide.');
        return;
      }
    }
    setIsSubmitting(true);
    setError('');
    try {
      rememberIdentity(cleanNickname);
      const result = await apiRequest<{ roomId: string; roomCode: string; hostToken: string }>('/api/watchparty/create', {
        method: 'POST',
        body: JSON.stringify({
          nickname: cleanNickname,
          maxParticipants: Number(maxParticipants),
          roomName: roomName.trim(),
          isPublic,
          syncMode: 'classic',
          media: useVidRift ? {
            src: 'vidrift',
            playbackType: 'vidrift',
            mediaId: launchContext!.tmdbId,
            title: contentTitle,
            poster: contentPoster || undefined,
            mediaType: launchContext!.kind,
            seasonNumber: launchContext!.kind === 'tv' ? launchContext!.season : undefined,
            episodeNumber: launchContext!.kind === 'tv' ? launchContext!.episode : undefined,
            position: launchContext!.position || 0,
            isPlaying: launchContext!.isPlaying === true,
          } : {
            src: sourceUrl.trim(),
            title: contentTitle,
            poster: contentPoster || undefined,
            mediaType,
            playbackType: 'direct',
          },
        }),
      });
      storeRoomToken(result.roomId, result.hostToken);
      setShowCreate(false);
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

  const applyRemotePlayback = useCallback(async (state: { isPlaying: boolean; position: number }) => {
    if (roomRef.current?.media.playbackType === 'vidrift') {
      const target = vidriftFrameRef.current?.contentWindow;
      if (!target) {
        pendingPlaybackRef.current = state;
        return;
      }
      applyingRemoteRef.current = true;
      try {
        if (Number.isFinite(state.position) && Math.abs(vidriftPlaybackRef.current.currentTime - state.position) > 1) {
          target.postMessage({ type: 'vidrift:resume', currentTime: Math.max(0, state.position) }, VIDRIFT_ORIGIN);
        }
        target.postMessage({ type: state.isPlaying ? 'vidrift:play' : 'vidrift:pause' }, VIDRIFT_ORIGIN);
        vidriftPlaybackRef.current.paused = !state.isPlaying;
        vidriftPlaybackRef.current.currentTime = Math.max(0, state.position || 0);
      } finally {
        window.setTimeout(() => { applyingRemoteRef.current = false; }, 1200);
      }
      return;
    }

    const video = videoRef.current;
    if (!video) {
      pendingPlaybackRef.current = state;
      return;
    }
    applyingRemoteRef.current = true;
    try {
      if (Number.isFinite(state.position) && Math.abs(video.currentTime - state.position) > 0.8) {
        video.currentTime = Math.max(0, state.position);
      }
      if (state.isPlaying && video.paused) {
        await video.play().then(() => setRequiresUserGesture(false)).catch(() => setRequiresUserGesture(true));
      }
      if (!state.isPlaying && !video.paused) video.pause();
      if (!state.isPlaying) setRequiresUserGesture(false);
    } finally {
      window.setTimeout(() => { applyingRemoteRef.current = false; }, 250);
    }
  }, []);

  useEffect(() => {
    if (!roomId) return;
    const token = getRoomToken(roomId);
    if (!token) {
      navigate('/watchparty', { replace: true, state: { message: 'Rejoins le salon avec son code pour obtenir ton accès.' } });
      return;
    }
    let active = true;
    const loadRoom = async () => {
      try {
        const result = await apiRequest<{ room: Room }>(`/api/watchparty/room/${roomId}`, {
          headers: { 'x-watchparty-token': token },
        });
        if (!active) return;
        roomRef.current = result.room;
        setRoom(result.room);
        setParticipants(result.room.participants || []);
        if (result.room.playbackState) pendingPlaybackRef.current = result.room.playbackState;
        const savedNickname = (() => { try { return sessionStorage.getItem('watchPartyNickname') || 'Invité'; } catch { return 'Invité'; } })();
        const socket = io(`${WATCHPARTY_API}/watchparty`, {
          query: { roomId, nickname: savedNickname, token },
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socketRef.current = socket;
        socket.on('connect', () => {
          setSocketState('connected');
          setSelfId(socket.id || '');
        });
        socket.on('disconnect', () => setSocketState('disconnected'));
        socket.on('connect_error', (err) => {
          setSocketState('disconnected');
          setError(err.message || 'Connexion au salon impossible.');
        });
        socket.on('room:info', (nextRoom: Room) => setRoom(current => current ? { ...current, ...nextRoom } : nextRoom));
        socket.on('room:participants', (next: Participant[]) => setParticipants(next || []));
        socket.on('control:state', (state: { controlMode: 'host-only' | 'democratic'; coHosts: string[]; pendingRequests: ControlRequest[] }) => {
          setRoom(current => current ? { ...current, controlMode: state.controlMode, coHosts: state.coHosts || [] } : current);
          setControlRequests(state.pendingRequests || []);
        });
        socket.on('room:playback', applyRemotePlayback);
        socket.on('playback:state', applyRemotePlayback);
        socket.on('room:chat', (message: ChatMessage) => {
          setMessages(current => current.some(item => item.id === message.id) ? current : [...current.slice(-99), message]);
        });
        socket.on('media:updated', (media: Media) => setRoom(current => current ? { ...current, media } : current));
        socket.on('host:token', (payload: { token: string }) => storeRoomToken(roomId, payload.token));
        socket.on('room:kicked', (payload: { reason?: string }) => {
          setError(payload?.reason || 'Tu as été retiré du salon.');
          socket.disconnect();
          clearRoomToken(roomId);
          navigate('/watchparty');
        });
        socket.on('room:closed', () => {
          setError('Ce salon a été fermé.');
          socket.disconnect();
          clearRoomToken(roomId);
          navigate('/watchparty');
        });
        socket.on('error', (payload: { message?: string }) => setError(payload?.message || 'Erreur de connexion au salon.'));
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
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [roomId, navigate, applyRemotePlayback]);

  useEffect(() => {
    const video = videoRef.current;
    const src = room?.media?.src;
    if (!video || !src) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.removeAttribute('src');
    video.load();
    if (/\.m3u8(?:$|\?)/i.test(src) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Le flux HLS n’a pas pu être chargé. Vérifie que le serveur du flux autorise les requêtes vidéo depuis le navigateur.');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [room?.media?.src]);

  const isHost = Boolean(selfId && room?.hostId === selfId);
  const canControl = isHost || Boolean(selfId && room?.coHosts?.includes(selfId)) || room?.controlMode === 'democratic';

  const sendPlayback = useCallback((reason: 'play' | 'pause' | 'seek' | 'heartbeat' | 'ended') => {
    const socket = socketRef.current;
    if (!socket?.connected || !canControl || applyingRemoteRef.current) return;
    if (roomRef.current?.media.playbackType === 'vidrift') {
      socket.emit('playback:update', {
        isPlaying: !vidriftPlaybackRef.current.paused,
        position: Number.isFinite(vidriftPlaybackRef.current.currentTime) ? vidriftPlaybackRef.current.currentTime : 0,
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
  }, [canControl]);

  const handleTimeUpdate = () => {
    const now = Date.now();
    if (now - lastHeartbeatRef.current > 2500) {
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

  const handleVidRiftLoad = () => {
    const target = vidriftFrameRef.current?.contentWindow;
    if (!target) return;
    target.postMessage({ type: 'vidrift:get-state' }, VIDRIFT_ORIGIN);
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
        season?: number;
        episode?: number;
      };
      if (Number(data.tmdbId) !== Number(media.mediaId) || data.mediaType !== media.mediaType) return;

      const currentTime = Number(data.currentTime);
      if (data.type === 'vidrift:state') {
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        if (typeof data.paused === 'boolean') vidriftPlaybackRef.current.paused = data.paused;
        const pending = pendingPlaybackRef.current;
        if (pending) {
          pendingPlaybackRef.current = null;
          void applyRemotePlayback(pending);
        }
        return;
      }

      if (data.type === 'vidrift:progress') {
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        if (canControl && Date.now() - lastHeartbeatRef.current > 2500) {
          lastHeartbeatRef.current = Date.now();
          sendPlayback('heartbeat');
        }
        return;
      }

      if (data.type === 'vidrift:paused' || data.type === 'vidrift:unpaused') {
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        vidriftPlaybackRef.current.paused = data.type === 'vidrift:paused';
        if (!applyingRemoteRef.current && canControl) {
          sendPlayback(data.type === 'vidrift:paused' ? 'pause' : 'play');
        }
        return;
      }

      if (data.type === 'vidrift:ended') {
        if (Number.isFinite(currentTime) && currentTime >= 0) vidriftPlaybackRef.current.currentTime = currentTime;
        vidriftPlaybackRef.current.paused = true;
        if (!applyingRemoteRef.current && canControl) sendPlayback('ended');
        return;
      }

      if (data.type === 'vidrift:episode' && media.mediaType === 'tv') {
        if (!Number.isInteger(data.season) || data.season! < 1
          || !Number.isInteger(data.episode) || data.episode! < 1) return;
        if (!isHost) return;
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
        setError('Le lecteur VidRift n’a pas pu appliquer une commande de synchronisation.');
      }
    };

    window.addEventListener('message', handleVidRiftMessage);
    return () => window.removeEventListener('message', handleVidRiftMessage);
  }, [
    roomId,
    room?.media,
    canControl,
    isHost,
    applyRemotePlayback,
    sendPlayback,
    leaveRoom,
  ]);

  const handleSendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || !socketRef.current?.connected) return;
    socketRef.current.emit('chat:message', { text });
    setChatInput('');
  };

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
                  {!canControl && (
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
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                  <p className="text-xs text-white/45">Synchronisation {room.syncMode === 'pro' ? 'Pro' : 'classique'} · {room.controlMode === 'democratic' ? 'Contrôle partagé' : 'Contrôle hôte'}</p>
                  {!isHost && room.controlMode !== 'democratic' && (
                    <button onClick={() => socketRef.current?.emit('control:request')} className="text-xs font-semibold text-red-300 transition hover:text-red-200">Demander le contrôle</button>
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
                <section className={`${panelClass} p-4`}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-red-400" /> Participants</h2>
                    <span className="text-xs text-white/40">{participants.length}/{room.maxParticipants}</span>
                  </div>
                  <div className="space-y-2">
                    {participants.map(person => (
                      <div key={person.id} className="flex items-center gap-2 rounded-lg bg-white/[0.035] px-3 py-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{person.nickname.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-white/85">{person.nickname}{person.id === selfId ? ' (toi)' : ''}</span>
                        {person.isHost && <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Hôte</span>}
                      </div>
                    ))}
                  </div>
                </section>
                <section className={`${panelClass} flex min-h-[360px] flex-col p-4`}>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><MessageCircle className="h-4 w-4 text-red-400" /> Discussion</h2>
                  <div className="mb-3 flex-1 space-y-3 overflow-y-auto pr-1">
                    {messages.length === 0 ? <p className="py-8 text-center text-xs text-white/35">La discussion commence ici.</p> : messages.map(message => (
                      <div key={message.id} className={message.type === 'system' ? 'text-center text-[11px] text-white/35' : ''}>
                        {message.type === 'system' ? message.text : (
                          <>
                            <p className="mb-0.5 text-[11px] font-semibold text-white/55">{message.senderNickname}</p>
                            <p className="break-words text-sm leading-relaxed text-white/85">{message.text}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleSendMessage} className="flex gap-2 border-t border-white/[0.07] pt-3">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Écrire un message…" maxLength={500} className={inputClass} />
                    <button type="submit" disabled={!chatInput.trim() || socketState !== 'connected'} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white transition hover:bg-red-500 disabled:opacity-40" aria-label="Envoyer"><Send className="h-4 w-4" /></button>
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
        <div className="mb-7 flex items-center gap-2.5">
          <h2 className="text-base font-extrabold tracking-tight">Salles publiques</h2>
          <span className="text-sm font-semibold text-white/45">{isLoadingRooms ? '…' : publicRooms.length}</span>
        </div>

        {isLoadingRooms ? (
          <div className="flex min-h-48 items-center gap-3 text-sm text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" />
            Chargement des salles publiques…
          </div>
        ) : publicRooms.length === 0 ? (
          <div className="flex min-h-64 max-w-2xl flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05]">
              <Users className="h-6 w-6 text-white/35" />
            </div>
            <h3 className="text-base font-bold">Aucune salle publique pour le moment</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-white/40">Crée la première salle et invite tes amis à te rejoindre.</p>
            <button type="button" onClick={openCreateDialog} className={`${buttonClass} mt-5`}>
              <Plus className="h-4 w-4" /> Créer une salle
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,312px),312px))] gap-x-2.5 gap-y-7">
            {publicRooms.map(publicRoom => (
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
                <p className="mt-1 truncate text-[11px] text-white/35">{publicRoom.mediaTitle || publicRoom.title}{publicRoom.mediaType === 'tv' ? ' · Série' : ' · Film'}</p>
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
                <input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={32} placeholder="Ex. Yuno" className={inputClass} />
              </label>
              {watchPartyContext ? (
                <div className="flex items-center gap-4 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  {watchPartyContext.posterPath ? (
                    <img src={watchPartyContext.posterPath} alt="" className="h-20 w-14 shrink-0 rounded-lg bg-black object-cover" />
                  ) : (
                    <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]"><Film className="h-5 w-5 text-white/35" /></div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[.16em] text-red-300">Contenu récupéré automatiquement</p>
                    <h3 className="mt-1 truncate text-sm font-bold text-white">{watchPartyContext.title}</h3>
                    <p className="mt-1 text-xs text-white/50">
                      {watchPartyContext.kind === 'tv'
                        ? `Série · Saison ${watchPartyContext.season} · Épisode ${watchPartyContext.episode}`
                        : 'Film'}
                    </p>
                    <p className="mt-2 text-[11px] leading-4 text-white/40">Le même lecteur VidRift sera ouvert chez chaque participant. Aucun lien vidéo à copier.</p>
                  </div>
                </div>
              ) : (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-white/70">Film ou série à regarder</span>
                    <input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Titre du contenu" className={inputClass} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-white/70">Lien vidéo direct</span>
                    <input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…/video.m3u8 ou .mp4" inputMode="url" className={inputClass} />
                    <span className="block text-[11px] leading-5 text-white/35">Pour les vidéos hébergées en dehors du lecteur Movix, MP4, WebM et HLS (.m3u8) sont acceptés.</span>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-white/70">Affiche (facultatif)</span>
                    <input value={posterUrl} onChange={event => setPosterUrl(event.target.value)} placeholder="https://…/poster.jpg" inputMode="url" className={inputClass} />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-white/70">Type</span>
                    <select value={mediaType} onChange={event => setMediaType(event.target.value as 'movie' | 'tv')} className={inputClass}><option value="movie">Film</option><option value="tv">Série</option></select>
                  </label>
                </>
              )}
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
                <button type="submit" disabled={isSubmitting} className={buttonClass}>{isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Créer la salle</button>
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
