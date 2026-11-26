import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import Hls from 'hls.js';
import {
  ArrowLeft, Check, Copy, Film, Globe2, KeyRound, LoaderCircle,
  MessageCircle, Play, RefreshCw, Send, Users, Video, X,
} from 'lucide-react';
import { clearRoomToken, getRoomToken, storeRoomToken } from '../utils/watchparty';

const WATCHPARTY_API = String(
  import.meta.env.VITE_WATCHPARTY_API || 'https://watchparty-api-production.up.railway.app',
).trim().replace(/\/+$/, '');

type Media = {
  src: string;
  title: string;
  poster?: string | null;
  mediaType: 'movie' | 'tv';
  mediaId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
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

type PublicRoom = {
  id: string;
  code: string;
  title: string;
  poster?: string;
  mediaType: 'movie' | 'tv';
  participantCount: number;
  maxParticipants: number;
  syncMode: 'classic' | 'pro';
  seasonNumber?: number;
  episodeNumber?: number;
  createdAt: number;
};

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

function isDirectVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return /\.(mp4|m4v|webm|m3u8)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

const WatchPartyPage: React.FC = () => {
  const navigate = useNavigate();
  const { code: routeCode, roomId } = useParams<{ code?: string; roomId?: string }>();
  const [nickname, setNickname] = useState(() => {
    try { return sessionStorage.getItem('watchPartyNickname') || ''; } catch { return ''; }
  });
  const [joinCode, setJoinCode] = useState((routeCode || '').toUpperCase());
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [mediaType, setMediaType] = useState<'movie' | 'tv'>('movie');
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
  const socketRef = useRef<Socket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const applyingRemoteRef = useRef(false);
  const lastHeartbeatRef = useRef(0);
  const pendingPlaybackRef = useRef<{ isPlaying: boolean; position: number } | null>(null);

  useEffect(() => {
    setJoinCode((routeCode || '').toUpperCase());
  }, [routeCode]);

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
    if (cleanNickname.length < 2) {
      setError('Choisis un pseudo d’au moins 2 caractères.');
      return;
    }
    if (!title.trim()) {
      setError('Ajoute un titre pour le film ou la série.');
      return;
    }
    if (!isDirectVideoUrl(sourceUrl.trim())) {
      setError('Ajoute un lien vidéo direct en MP4, WebM ou M3U8 (HLS). Les liens de pages ou lecteurs externes ne sont pas synchronisables.');
      return;
    }
    if (posterUrl.trim()) {
      try {
        const poster = new URL(posterUrl.trim());
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
          isPublic,
          syncMode: 'classic',
          media: {
            src: sourceUrl.trim(),
            title: title.trim(),
            poster: posterUrl.trim() || undefined,
            mediaType,
          },
        }),
      });
      storeRoomToken(result.roomId, result.hostToken);
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

  const leaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (roomId) clearRoomToken(roomId);
    navigate('/watchparty');
  };

  const applyRemotePlayback = useCallback(async (state: { isPlaying: boolean; position: number }) => {
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
        socket.on('room:chat', (message: ChatMessage) => {
          setMessages(current => current.some(item => item.id === message.id) ? current : [...current.slice(-99), message]);
        });
        socket.on('room:playback', applyRemotePlayback);
        socket.on('playback:state', applyRemotePlayback);
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

  const sendPlayback = (reason: 'play' | 'pause' | 'seek' | 'heartbeat') => {
    const video = videoRef.current;
    const socket = socketRef.current;
    if (!video || !socket || !socket.connected || !canControl || applyingRemoteRef.current) return;
    socket.emit('playback:update', {
      isPlaying: !video.paused,
      position: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      reason,
    });
  };

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
            <LoaderCircle className="h-5 w-5 animate-spin" /> Chargement du salon…
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[.22em] text-red-400">MOVIX WATCH PARTY</p>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{room.media.title}</h1>
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
                  {!canControl && (
                    <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg bg-black/70 px-3 py-2 text-xs text-white/75 backdrop-blur">
                      Lecture synchronisée par {participants.find(person => person.isHost)?.nickname || 'l’hôte'}
                    </div>
                  )}
                  {requiresUserGesture && (
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

  return (
    <main className="mx-auto w-full max-w-[1320px] px-4 pb-16 pt-8 text-white sm:px-6">
      <div className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[.24em] text-red-400">MOVIX · ENSEMBLE</p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Watch Party</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Lance une session privée, invite tes amis avec un code et synchronisez votre lecture en temps réel.</p>
            <label className="mt-4 block max-w-sm space-y-1.5"><span className="text-xs font-semibold text-white/65">Ton pseudo pour les sessions</span><input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={32} placeholder="Ex. Yuno" className={inputClass} /></label>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-white/50">
            <Users className="h-4 w-4 text-red-400" /> Jusqu’à 50 participants
          </div>
        </div>
      </div>

      {error && <div className="mb-5 flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200"><span>{error}</span><button onClick={() => setError('')} aria-label="Fermer"><X className="h-4 w-4" /></button></div>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(330px,.8fr)]">
        <section className={`${panelClass} p-5 sm:p-6`}>
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-400"><Video className="h-5 w-5" /></div>
            <div><h2 className="text-lg font-bold">Créer un salon</h2><p className="text-xs text-white/40">Tu seras l’hôte et tu partageras le lien.</p></div>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Titre du contenu</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Nom du film ou de la série" className={inputClass} /></label>
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Lien vidéo direct</span><input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…/video.m3u8 ou .mp4" inputMode="url" className={inputClass} /><span className="block text-[11px] leading-5 text-white/35">Formats compatibles : MP4, WebM ou HLS (.m3u8). Les pages d’un lecteur externe ne permettent pas une synchronisation fiable.</span></label>
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Affiche (facultatif)</span><input value={posterUrl} onChange={e => setPosterUrl(e.target.value)} placeholder="https://…/poster.jpg" inputMode="url" className={inputClass} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Type</span><select value={mediaType} onChange={e => setMediaType(e.target.value as 'movie' | 'tv')} className={inputClass}><option value="movie">Film</option><option value="tv">Série</option></select></label>
              <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Places</span><select value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} className={inputClass}>{[2,4,6,8,10,15,20,30,50].map(value => <option key={value} value={value}>{value} personnes</option>)}</select></label>
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3">
              <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} className="h-4 w-4 accent-red-500" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Salon public</span><span className="block text-[11px] text-white/40">Visible dans la liste ci-dessous. Sinon, seul le code permet de rejoindre.</span></span>
              <Globe2 className="h-4 w-4 text-white/35" />
            </label>
            <button type="submit" disabled={isSubmitting} className={`${buttonClass} w-full`}>{isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Créer ma Watch Party</button>
          </form>
        </section>

        <div className="space-y-5">
          <section className={`${panelClass} p-5 sm:p-6`}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.06] text-white/70"><KeyRound className="h-5 w-5" /></div>
              <div><h2 className="text-lg font-bold">Rejoindre un salon</h2><p className="text-xs text-white/40">Entre le code transmis par ton ami.</p></div>
            </div>
            <form onSubmit={handleJoin} className="space-y-3">
              <label className="block space-y-1.5"><span className="text-xs font-semibold text-white/65">Code d’invitation</span><input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="ABC123" maxLength={6} className={`${inputClass} text-center font-mono text-xl font-bold tracking-[.28em]`} /></label>
              <button type="submit" disabled={isSubmitting || joinCode.length !== 6} className={`${buttonClass} w-full`}><Users className="h-4 w-4" /> Rejoindre avec le code</button>
            </form>
          </section>

          <section className={`${panelClass} p-5 sm:p-6`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><h2 className="text-lg font-bold">Salons publics</h2><p className="text-xs text-white/40">Rejoins une session ouverte à tous.</p></div>
              <button onClick={() => void refreshPublicRooms()} disabled={isLoadingRooms} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/50 transition hover:bg-white/5 hover:text-white" aria-label="Actualiser"><RefreshCw className={`h-4 w-4 ${isLoadingRooms ? 'animate-spin' : ''}`} /></button>
            </div>
            {isLoadingRooms ? <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40"><LoaderCircle className="h-4 w-4 animate-spin" /> Chargement des salons…</div>
              : publicRooms.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center"><Film className="mx-auto mb-2 h-6 w-6 text-white/25" /><p className="text-sm text-white/55">Aucun salon public pour le moment.</p><p className="mt-1 text-xs text-white/30">Tu peux en créer un et le rendre visible ici.</p></div>
              : <div className="space-y-3">{publicRooms.map(publicRoom => (
                <button key={publicRoom.id} onClick={() => { setJoinCode(publicRoom.code); void handleJoin(undefined, publicRoom.code); }} className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5 text-left transition hover:border-red-500/35 hover:bg-white/[0.05]">
                  {publicRoom.poster ? <img src={publicRoom.poster} alt="" className="h-16 w-11 shrink-0 rounded-lg bg-black object-cover" /> : <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]"><Film className="h-5 w-5 text-white/25" /></div>}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white/90">{publicRoom.title}</span><span className="mt-1 block text-[11px] text-white/40">{publicRoom.participantCount}/{publicRoom.maxParticipants} participants · {publicRoom.mediaType === 'tv' ? 'Série' : 'Film'}</span><span className="mt-1 block font-mono text-[10px] tracking-[.18em] text-red-300/80">{publicRoom.code}</span></span>
                  <Play className="mr-1 h-4 w-4 shrink-0 text-white/25 transition group-hover:text-red-400" />
                </button>
              ))}</div>}
          </section>
          <p className="px-1 text-[11px] leading-5 text-white/30">Pour que la synchronisation soit fiable, l’hôte doit fournir un flux vidéo direct compatible. Les lecteurs externes intégrés dans une page web ne peuvent pas être pilotés depuis Movix.</p>
        </div>
      </div>
    </main>
  );
};

export default WatchPartyPage;
