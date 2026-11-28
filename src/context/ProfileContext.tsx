import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { Profile, ProfileContextType } from '../types/profile';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import i18n from '../i18n';
import { predefinedAvatars } from '../data/avatars';
import {
  getSyncableLocalStorageEntries,
  hasSyncableLocalStorageData,
  isSyncableStorageKey,
  SYNC_OUTBOX_STORAGE_KEY
} from '../utils/syncStorage';
import { checkVipStatus } from '../utils/vipUtils';
import {
  clearDeletedProfileSelectionIfStillActive,
  commitProfileSelection,
  createLatestProfileHydrationGuard,
  createLatestProfileIntentGuard,
} from '../utils/profileSelectionTransaction';
import { replaceProfileStorage } from '../utils/profileStorage';
import { API_BASE_URL } from '../config/api';
import { getResolvedAccountContext } from '../utils/accountAuth';
import { runProfileIsolationWipe } from '../utils/profileIsolation';

// Pending sync ops persisted by App.tsx flushPendingOpsSync at unload time.
// We POST these to /api/sync BEFORE replaceProfileStorage wipes
// localStorage — otherwise unsynced writes (Firefox keepalive flake, network
// hiccup) would be destroyed by the wipe-and-restore restoring stale backend
// state. On success the accepted ops are cleared; individually rejected ops
// are kept for the next boot; on transient failure everything is kept for
// retry; on a permanent auth mismatch it's discarded.
const SYNC_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SyncOutboxPayload {
  userType: 'oauth' | 'bip39';
  profileId: string;
  userId: string;
  ops: unknown[];
  ts: number;
}

function isSyncOutboxPayload(value: unknown): value is SyncOutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SyncOutboxPayload>;
  return (
    (candidate.userType === 'oauth' || candidate.userType === 'bip39')
    && typeof candidate.profileId === 'string'
    && candidate.profileId.length > 0
    && typeof candidate.userId === 'string'
    && candidate.userId.length > 0
    && Array.isArray(candidate.ops)
    && candidate.ops.length > 0
  );
}

async function replayOutboxIfAny(): Promise<void> {
  // La clé historique reste admise ; les files séparées par profil sont écrites
  // par App.tsx avec le triplet complet du propriétaire capturé à l'écriture.
  const storageKeys = [SYNC_OUTBOX_STORAGE_KEY];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(`${SYNC_OUTBOX_STORAGE_KEY}:`)) storageKeys.push(key);
    }
  } catch { /* stockage indisponible : la clé historique reste tentée */ }

  for (const storageKey of storageKeys) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(storageKey); } catch { return; }
    if (!raw) continue;

    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
      continue;
    }

    if (!isSyncOutboxPayload(parsed)) {
      // Une ancienne file sans userId n'est pas mal formée : elle appartient
      // peut-être encore à son propriétaire. On la laisse inactive plutôt que
      // de la supprimer sous une autre identité.
      const incomplete = parsed && typeof parsed === 'object'
        && Array.isArray((parsed as { ops?: unknown }).ops)
        && typeof (parsed as { profileId?: unknown }).profileId === 'string'
        && !(parsed as { userId?: unknown }).userId;
      if (incomplete) {
        console.warn('[outbox] skipping replay — owner identity incomplete');
        continue;
      }
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
      continue;
    }

    const payload = parsed;
    // Éviter de rejouer deux fois la même file : App.tsx écrit aussi la clé
    // historique pour le compte courant.
    if (storageKey === SYNC_OUTBOX_STORAGE_KEY) {
      const scopedKey = `${SYNC_OUTBOX_STORAGE_KEY}:${payload.userType}:${encodeURIComponent(payload.userId)}:${encodeURIComponent(payload.profileId)}`;
      try { if (localStorage.getItem(scopedKey)) continue; } catch { /* noop */ }
    }

    const ageMs = Date.now() - (typeof payload.ts === 'number' ? payload.ts : 0);
    if (ageMs > SYNC_OUTBOX_MAX_AGE_MS) {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
      continue;
    }

    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      // No auth yet (e.g., logged out). Keep the outbox for a future replay.
      return;
    }

    // Le triplet complet doit correspondre au compte sélectionné. Une file
    // sans userId est déjà écartée plus haut : sans cette garde, une file A
    // pourrait être POSTée avec le token B puis supprimée sur le 403.
    const { userType: currentUserType, userId: currentUserId } = getResolvedAccountContext();
    if (
      currentUserType !== payload.userType
      || !currentUserId
      || payload.userId !== currentUserId
    ) {
      console.warn('[outbox] skipping replay — different account logged in than outbox owner');
      continue;
    }

    // Filter out ops whose keys are no longer syncable. Legacy outboxes may
    // contain keys removed from the allowlist after a backend security update
    // (e.g. `is_vip` per audit P0). Without filtering, the backend rejects the
    // whole batch with 400 INVALID_SYNC_KEY → replayOutboxIfAny treats 400 as
    // permanent → outbox is dropped, taking legitimate co-batched ops with it.
    const validOps = payload.ops.filter((op): op is Record<string, unknown> & { key: string } => {
      if (!op || typeof op !== 'object') return false;
      const candidateKey = (op as { key?: unknown }).key;
      return typeof candidateKey === 'string' && isSyncableStorageKey(candidateKey);
    });

    if (validOps.length === 0) {
      try { localStorage.removeItem(storageKey); } catch { /* noop */ }
      continue;
    }

    try {
      const response = await axios.post(`${API_URL}/api/sync`, {
        userType: payload.userType,
        profileId: payload.profileId,
        userId: payload.userId,
        ops: validOps
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Le serveur applique désormais chaque opération valide et rapporte les
      // autres avec leur index dans le lot envoyé. On ne retire que celles qui
      // ont été réellement acceptées ; les opérations rejetées restent dans
      // l'outbox avec le même propriétaire pour une correction ou un retry.
      const rejected = Array.isArray(response?.data?.rejected) ? response.data.rejected : [];
      const rejectedOps = new Set<unknown>();
      for (const item of rejected) {
        const index = Number(item?.index);
        if (Number.isInteger(index) && index >= 0 && index < validOps.length) {
          rejectedOps.add(validOps[index]);
        }
      }

      if (rejectedOps.size > 0) {
        const remainingOps = payload.ops.filter((op) => rejectedOps.has(op));
        if (remainingOps.length > 0) {
          try {
            localStorage.setItem(storageKey, JSON.stringify({
              ...payload,
              ops: remainingOps,
              ts: Date.now()
            }));
          } catch { /* noop */ }
        } else {
          try { localStorage.removeItem(storageKey); } catch { /* noop */ }
        }
      } else {
        try { localStorage.removeItem(storageKey); } catch { /* noop */ }
      }
    } catch (error: unknown) {
      const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
      const status = response?.status;
      const errMsg = response?.data?.error || '';

      // Un refus d'appartenance du profil signifie que la file n'est pas
      // rejouable avec le compte courant, pas qu'elle est invalide. On la
      // conserve pour son propriétaire légitime jusqu'à la TTL.
      const ownershipRejected = status === 403
        || (status === 404 && /profile|owner/i.test(errMsg));
      if (ownershipRejected) {
        console.warn('[outbox] skipping replay — profile is not owned by current account');
        continue;
      }

      // Les autres 4xx sont permanentes : une requête mal formée ne deviendra
      // pas valide en la rejouant. 401 Unauthorized, 408, 429, 5xx et les
      // erreurs réseau restent retryables.
      const isPermanent = typeof status === 'number'
        && status >= 400 && status < 500
        && status !== 408 && status !== 429
        && !(status === 401 && errMsg === 'Unauthorized');

      if (isPermanent) {
        try { localStorage.removeItem(storageKey); } catch { /* noop */ }
        console.warn('[outbox] replay rejected permanently, dropping outbox:', status, errMsg);
      } else {
        console.warn('[outbox] replay failed, will retry on next boot:', error);
      }
    }
  }
}

const API_URL = API_BASE_URL;

// Per-device record of which profiles have been confirmed to hold server-side
// data on a prior load. Used by loadProfileData to detect the "server returned
// empty for a profile that previously had data" scenario (corrupted profile
// file, transient backend bug, partial response) and preserve local state
// instead of wiping it. NOT synced — prefixed to fall outside the syncable
// allowlist and not in PROFILE_LOAD_PRESERVED_KEYS removal path.
const PROFILE_SELECTION_PREFIX = 'movix_selected_profile';

function getProfileSelectionKey(): string | null {
  try {
    const { userType, userId } = getResolvedAccountContext();
    if (!userType || !userId) return null;
    return `${PROFILE_SELECTION_PREFIX}:${userType}:${encodeURIComponent(userId)}`;
  } catch {
    return null;
  }
}

function readCurrentAccountSelectedProfileId(): string | null {
  const key = getProfileSelectionKey();
  return (key && localStorage.getItem(key)) || localStorage.getItem('selected_profile_id');
}

function readSelectedProfileId(profiles: Profile[]): string | null {
  const key = getProfileSelectionKey();
  if (key) {
    const scopedId = localStorage.getItem(key);
    // A saved account-scoped choice is authoritative. If the profile was
    // deleted, fall back to the account default; never consult the legacy
    // global key, which may belong to a different account.
    if (scopedId) {
      return profiles.some((profile) => profile.id === scopedId) ? scopedId : null;
    }
  }

  // One-time migration for devices that only have the legacy global key.
  // Accept it only when the ID is present in the currently authenticated
  // account's server profile list, then immediately scope it to that account.
  const legacyId = localStorage.getItem('selected_profile_id');
  if (legacyId && profiles.some((profile) => profile.id === legacyId)) {
    if (key) localStorage.setItem(key, legacyId);
    return legacyId;
  }
  return null;
}

function persistSelectedProfileId(profileId: string): void {
  localStorage.setItem('selected_profile_id', profileId);
  const key = getProfileSelectionKey();
  if (key) localStorage.setItem(key, profileId);
}

function clearSelectedProfileId(profileId?: string): void {
  const key = getProfileSelectionKey();
  const current = localStorage.getItem('selected_profile_id');
  if (!profileId || current === profileId) localStorage.removeItem('selected_profile_id');
  if (key) {
    const scoped = localStorage.getItem(key);
    if (!profileId || scoped === profileId) localStorage.removeItem(key);
  }
}

const KNOWN_PROFILE_DATA_KEY = '__movix_known_profile_data';

interface KnownProfileDataMap {
  [profileId: string]: number;
}

function readKnownProfileData(): KnownProfileDataMap {
  try {
    const raw = localStorage.getItem(KNOWN_PROFILE_DATA_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as KnownProfileDataMap;
  } catch {
    return {};
  }
}

function markProfileHasData(profileId: string) {
  try {
    const current = readKnownProfileData();
    current[profileId] = Date.now();
    localStorage.setItem(KNOWN_PROFILE_DATA_KEY, JSON.stringify(current));
  } catch { /* noop — markers are best-effort */ }
}

function hasLocalSyncableContent(): boolean {
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!isSyncableStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    if (typeof value !== 'string') continue;
    if (value.trim() === '' || value === '[]' || value === '{}') continue;
    return true;
  }
  return false;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

interface ProfileProviderProps {
  children: ReactNode;
}

interface LoadProfileDataOptions {
  notifyConsumers?: boolean;
  preserveLocalOnUnexpectedEmpty?: boolean;
  isIntentCurrent?: () => boolean;
}

type ProfileDataLoadingWindow = Window & {
  setProfileDataLoading?: (loading: boolean) => void;
};

export const ProfileProvider: React.FC<ProfileProviderProps> = ({ children }) => {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();

  // Dedupes the two useEffects below (mount timer + auth_changed listener)
  // that can both call loadProfiles within ~500ms of each other. Without
  // this guard, two concurrent GET /api/profiles → loadProfileData chains
  // race the wipe-and-restore against in-flight user writes.
  const loadProfilesInFlightRef = useRef(false);
  const reloadProfilesAfterFlightRef = useRef(false);

  // The /watch/* skip only applies to automatic hydration during loadProfiles;
  // an explicit profile selection always hydrates its target before publishing.
  const isWatchRoute = location.pathname.startsWith('/watch/');

  // Perf : l'ancien pattern [isWatchRoute] sur les effets de montage relançait TOUT le
  // cycle réseau (GET /api/profiles + GET /api/profiles/:id/data + wipe/rewrite du
  // localStorage) à CHAQUE transition watch <-> reste du site — le chemin le plus
  // emprunté (retour sur Home après une vidéo). On ne garde que le strict nécessaire :
  // un chargement au boot, un rattrapage si l'app a démarré sur /watch/ (deep-link).
  const profileDataHydratedRef = useRef(false);
  const prevIsWatchRouteRef = useRef(isWatchRoute);
  const profileHydrationGuardRef = useRef<ReturnType<typeof createLatestProfileHydrationGuard> | null>(null);
  if (!profileHydrationGuardRef.current) {
    profileHydrationGuardRef.current = createLatestProfileHydrationGuard((loading) => {
      (window as ProfileDataLoadingWindow).setProfileDataLoading?.(loading);
    });
  }
  const profileHydrationGuard = profileHydrationGuardRef.current;
  const profileIntentGuardRef = useRef<ReturnType<typeof createLatestProfileIntentGuard> | null>(null);
  if (!profileIntentGuardRef.current) {
    profileIntentGuardRef.current = createLatestProfileIntentGuard();
  }
  const profileIntentGuard = profileIntentGuardRef.current;

  const refreshVipState = () => {
    if (localStorage.getItem('access_code')) {
      checkVipStatus(true).catch(() => { /* ignore */ });
    } else {
      window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: false } }));
    }
  };

  const notifyProfileDataUpdated = () => {
    window.dispatchEvent(new CustomEvent('sync_storage_updated'));
    refreshVipState();
  };

  const clearDeletedProfileSelection = (deletedProfileId: string) => (
    clearDeletedProfileSelectionIfStillActive({
      deletedProfileId,
      readSelectedProfileId: readCurrentAccountSelectedProfileId,
      clearCurrentProfile: () => setCurrentProfile(null),
      clearSelectedProfileId: () => clearSelectedProfileId(deletedProfileId),
      notifyProfileDataUpdated,
    })
  );

  // Load profiles from server
  const loadProfiles = async () => {
    if (loadProfilesInFlightRef.current) {
      // An auth change can arrive while the previous account's request is still
      // running. Queue one fresh load instead of silently dropping that change.
      reloadProfilesAfterFlightRef.current = true;
      return;
    }
    loadProfilesInFlightRef.current = true;
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        // A logged-out session must never keep the previous account's profile
        // visible in context. Keep selected_profile_id untouched for a later
        // login, but clear only the in-memory identity.
        setCurrentProfile(null);
        setProfiles([]);
        profileDataHydratedRef.current = false;
        return;
      }

      // For BIP39 users, ensure auth data is fully loaded
      const isBip39Auth = localStorage.getItem('bip39_auth') === 'true';
      if (isBip39Auth) {
        // Wait a bit more for BIP39 auth to be fully processed
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      const response = await axios.get(`${API_URL}/api/profiles`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Never publish a response belonging to a session that was replaced
      // while the request was in flight (e.g. Discord re-login/account switch).
      if (localStorage.getItem('auth_token') !== authToken) return;

      if (response.data.success) {
        setProfiles(response.data.profiles);
        
        // If no profiles exist, try to migrate existing data
        if (response.data.profiles.length === 0) {
          // Keep loading state while creating profile
          setIsLoading(true);
          
          // Check if this is a new user (no existing data to migrate)
          const hasExistingData = await checkForExistingUserData();
          if (hasExistingData) {
            await migrateExistingData();
          } else {
            // For new users, create a default profile automatically
            await createDefaultProfileForNewUser();
          }
          return;
        }
        
        // Pick the previously-selected profile if it still exists for this
        // account; otherwise fall back to the default. The fallback covers two
        // cases: (1) account switch (user A's selectedProfileId stale for user
        // B), (2) profile deleted server-side between sessions.
        const selectedProfileId = readSelectedProfileId(response.data.profiles);
        const selectedProfile = selectedProfileId
          ? response.data.profiles.find((p: Profile) => p.id === selectedProfileId)
          : null;

        if (selectedProfile) {
          setCurrentProfile(selectedProfile);
          // Keep the legacy key aligned for older features that still read it
          // (comments, Wrapped, history and sync diagnostics). The account-
          // scoped ID has already been validated against this account's list.
          persistSelectedProfileId(selectedProfile.id);
          if (!isWatchRoute) {
            await loadProfileData(selectedProfile.id);
          } else {
            console.log('Skipping profile data loading for selected profile - on watch route');
          }
        } else if (response.data.profiles.length > 0) {
          const defaultProfile = response.data.profiles.find((p: Profile) => p.isDefault) || response.data.profiles[0];
          setCurrentProfile(defaultProfile);
          persistSelectedProfileId(defaultProfile.id);
          if (!isWatchRoute) {
            await loadProfileData(defaultProfile.id);
          } else {
            console.log('Skipping profile data loading for default profile - on watch route');
          }
        }
      }
    } catch (error) {
      console.error('Error loading profiles:', error);
    } finally {
      loadProfilesInFlightRef.current = false;
      setIsLoading(false);
      // Libère la garde anti-sync (App.tsx l'init à true au boot pour bloquer
      // tout push pendant la fenêtre où des composants pourraient écrire des
      // valeurs vides dans localStorage avant l'hydration serveur).
      // loadProfileData a son propre try/finally qui la baisse aussi ; cet
      // appel couvre les branches qui ne l'invoquent pas (pas d'auth_token,
      // route /watch/*, profiles.length === 0).
      profileHydrationGuard.releaseLoadingIfIdle();
      if (reloadProfilesAfterFlightRef.current) {
        reloadProfilesAfterFlightRef.current = false;
        window.setTimeout(() => loadProfilesRef.current(), 0);
      }
    }
  };

  // Check if user has existing data to migrate
  const checkForExistingUserData = async (): Promise<boolean> => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return false;

      return hasSyncableLocalStorageData();
    } catch (error) {
      console.error('Error checking for existing user data:', error);
      return false;
    }
  };

  // Create default profile for new users
  const createDefaultProfileForNewUser = async (
    isIntentCurrent: () => boolean = () => true,
  ) => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return;

      // Get user info for default profile name
      let defaultName = i18n.t('nav.profile');
      let defaultAvatar = predefinedAvatars[Math.floor(Math.random() * predefinedAvatars.length)];
      
      // Try to get username from auth data
      const authStr = localStorage.getItem('auth');
      if (authStr) {
        try {
          const authObj = JSON.parse(authStr);
          if (authObj.userProfile && authObj.userProfile.username) {
            defaultName = authObj.userProfile.username;
          }
          if (authObj.userProfile && authObj.userProfile.avatar) {
            defaultAvatar = authObj.userProfile.avatar;
          }
        } catch (e) {
          console.log('Could not parse auth data for default profile');
        }
      }

      console.log('Creating default profile for new user:', defaultName);

      const response = await axios.post(`${API_URL}/api/profiles`, {
        name: defaultName,
        avatar: defaultAvatar
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        if (!isIntentCurrent()) return;
        const defaultProfile = response.data.profile;
        setProfiles([defaultProfile]);
        setCurrentProfile(defaultProfile);
        persistSelectedProfileId(defaultProfile.id);
        window.dispatchEvent(new CustomEvent('sync_storage_updated'));
        refreshVipState();
        console.log('Default profile created for new user:', defaultProfile.name);
      }
    } catch (error) {
      console.error('Error creating default profile for new user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Migrate existing user data to default profile
  const migrateExistingData = async () => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return;

      // Collect all localStorage data for migration
      const userData = getSyncableLocalStorageEntries();

      const response = await axios.post(`${API_URL}/api/profiles/migrate`, {
        userData
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (response.data.success) {
        const defaultProfile = response.data.profile;
        setProfiles([defaultProfile]);
        setCurrentProfile(defaultProfile);
        persistSelectedProfileId(defaultProfile.id);
        window.dispatchEvent(new CustomEvent('sync_storage_updated'));
        refreshVipState();
        console.log('Data migrated to default profile:', defaultProfile.name);
      }
    } catch (error) {
      console.error('Error migrating data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Load profile data from server and update localStorage
  const loadProfileData = async (
    profileId: string,
    {
      notifyConsumers = true,
      preserveLocalOnUnexpectedEmpty = true,
      isIntentCurrent = () => true,
    }: LoadProfileDataOptions = {},
  ): Promise<boolean> => {
    const hydrationRequest = profileHydrationGuard.begin();
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) return false;

      // Recovery flush: replay any sync ops persisted at the previous unload
      // BEFORE the GET below pulls server state. Without this, a write that
      // didn't reach the server (Firefox keepalive flake, network hiccup,
      // browser crash) would be destroyed when replaceProfileStorage
      // wipes localStorage and restores stale backend data.
      await replayOutboxIfAny();
      if (
        localStorage.getItem('auth_token') !== authToken
        || !hydrationRequest.isCurrent()
        || !isIntentCurrent()
      ) return false;

      const response = await axios.get(`${API_URL}/api/profiles/${profileId}/data`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (
        localStorage.getItem('auth_token') !== authToken
        || !hydrationRequest.isCurrent()
        || !isIntentCurrent()
      ) return false;
      if (!response.data.success || !response.data.data) return false;

      const profileData = response.data.data;
      const profileEntries = Object.fromEntries(
        Object.entries(profileData).filter(
          ([key, value]) => typeof value === 'string' && isSyncableStorageKey(key)
        )
      ) as Record<string, string>;

      const serverHasData = Object.keys(profileEntries).length > 0;
      const known = readKnownProfileData();
      const profileWasKnownToHaveData = Object.prototype.hasOwnProperty.call(known, profileId);

      // Wipe guard: if the server returns an empty profile for a profile
      // we previously confirmed had data on this device, AND we still have
      // local syncable content, do NOT wipe. A transient backend error or
      // corrupted profile file would otherwise silently destroy the user's
      // local state. Preserve local; the next sync push will restore the
      // server side from localStorage.
      if (
        preserveLocalOnUnexpectedEmpty
        && !serverHasData
        && profileWasKnownToHaveData
        && hasLocalSyncableContent()
      ) {
        console.warn(
          `[sync] Server returned empty profile ${profileId} that previously held data — preserving local state`
        );
        profileDataHydratedRef.current = true;
        if (notifyConsumers) notifyProfileDataUpdated();
        return true;
      }

      if (
        localStorage.getItem('auth_token') !== authToken
        || !hydrationRequest.isCurrent()
        || !isIntentCurrent()
      ) return false;
      replaceProfileStorage(profileEntries);
      profileDataHydratedRef.current = true;

      if (serverHasData) {
        markProfileHasData(profileId);
      }

      if (notifyConsumers) notifyProfileDataUpdated();

      console.log('Profile data loaded for profile:', profileId);
      return true;
    } catch (error) {
      console.error('Error loading profile data:', error);
      return false;
    } finally {
      hydrationRequest.finish();
    }
  };

  const activateProfile = async (
    profile: Profile,
    isIntentCurrent: () => boolean,
  ): Promise<boolean> => (
    commitProfileSelection({
      profile,
      hydrateProfileData: (profileId, currentIntent) => loadProfileData(profileId, {
        notifyConsumers: false,
        preserveLocalOnUnexpectedEmpty: false,
        isIntentCurrent: currentIntent,
      }),
      persistSelectedProfileId: (profileId) => {
        persistSelectedProfileId(profileId);
      },
      publishCurrentProfile: setCurrentProfile,
      notifyProfileDataUpdated,
      isIntentCurrent,
    })
  );

  // Select a profile
  const selectProfile = async (profileId: string): Promise<boolean> => {
    const selectionIntent = profileIntentGuard.begin();
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return false;
    return activateProfile(profile, selectionIntent.isCurrent);
  };

  // Create a new profile
  const createProfile = async (name: string, avatar: string, ageRestriction?: number) => {
    let requestAuthToken: string | null = null;
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      requestAuthToken = authToken;
      if (!authToken) throw new Error('No auth token');

      const response = await axios.post(`${API_URL}/api/profiles`, {
        name,
        avatar,
        ageRestriction: ageRestriction ?? 0
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      // Ignore late responses from the account that was active before a switch.
      if (localStorage.getItem('auth_token') !== authToken) return;
      if (response.data.success) {
        const newProfile = response.data.profile;
        setProfiles(prev => [...prev, newProfile]);
        
        // If this is the first profile, select it
        if (profiles.length === 0) {
          setCurrentProfile(newProfile);
          persistSelectedProfileId(newProfile.id);
        }
      }
    } catch (error) {
      console.error('Error creating profile:', error);
      throw error;
    } finally {
      if (requestAuthToken && localStorage.getItem('auth_token') === requestAuthToken) setIsLoading(false);
    }
  };

  // Update a profile
  // Pas de setIsLoading ici : ProfileGate remplace toutes les routes par
  // l'écran « Chargement des profils… » tant que isLoading est vrai, ce qui
  // démontait la page profil à chaque changement de nom ou d'avatar.
  const updateProfile = async (profileId: string, updates: Partial<Profile>) => {
    try {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('No auth token');

      const response = await axios.put(`${API_URL}/api/profiles/${profileId}`, updates, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (localStorage.getItem('auth_token') !== authToken) return;
      if (response.data.success) {
        const updatedProfile = response.data.profile;
        setProfiles(prev => prev.map(p => p.id === profileId ? updatedProfile : p));
        
        // Update current profile if it's the one being updated
        if (currentProfile?.id === profileId) {
          setCurrentProfile(updatedProfile);
        }
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  // Delete a profile
  const deleteProfile = async (profileId: string) => {
    const deletionIntent = profileIntentGuard.begin();
    try {
      setIsLoading(true);
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) throw new Error('No auth token');

      const response = await axios.delete(`${API_URL}/api/profiles/${profileId}`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (localStorage.getItem('auth_token') !== authToken || !deletionIntent.isCurrent()) return;
      if (response.data.success) {
        // Check if server created a new default profile
        if (response.data.newDefaultProfile) {
          // Server created a new default profile, use it directly
          const newDefaultProfile = response.data.newDefaultProfile;
          if (!deletionIntent.isCurrent()) return;
          setProfiles([newDefaultProfile]);
          const activated = await activateProfile(
            newDefaultProfile,
            deletionIntent.isCurrent,
          );
          if (!activated && deletionIntent.isCurrent()) {
            console.error('Failed to activate replacement profile:', newDefaultProfile.id);
            clearDeletedProfileSelection(profileId);
          }
          console.log('New default profile created by server:', newDefaultProfile.name);
        } else {
          // Reload profiles from server to get updated default status
          const profilesResponse = await axios.get(`${API_URL}/api/profiles`, {
            headers: { Authorization: `Bearer ${authToken}` }
          });

          if (localStorage.getItem('auth_token') !== authToken || !deletionIntent.isCurrent()) return;
          if (profilesResponse.data.success) {
            const updatedProfiles = profilesResponse.data.profiles;
            setProfiles(updatedProfiles);
            
            // If deleted profile was current, select the default one
            if (currentProfile?.id === profileId) {
              if (updatedProfiles.length > 0) {
                const newCurrent = updatedProfiles.find((p: Profile) => p.isDefault) || updatedProfiles[0];
                if (!deletionIntent.isCurrent()) return;
                const activated = await activateProfile(
                  newCurrent,
                  deletionIntent.isCurrent,
                );
                if (!activated && deletionIntent.isCurrent()) {
                  console.error('Failed to activate profile after deletion:', newCurrent.id);
                  clearDeletedProfileSelection(profileId);
                }
              } else {
                // No profiles left, create a new default profile automatically
                console.log('No profiles left, creating new default profile...');
                if (!deletionIntent.isCurrent()) return;
                await createDefaultProfileForNewUser(deletionIntent.isCurrent);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      throw error;
    } finally {
      if (deletionIntent.isCurrent()) setIsLoading(false);
    }
  };

  // Ref vers la dernière version de loadProfiles (closure fraîche, avec le bon
  // isWatchRoute) pour les effets/listeners montés une seule fois ci-dessous
  const loadProfilesRef = useRef(loadProfiles);
  useEffect(() => {
    loadProfilesRef.current = loadProfiles;
  });

  // Load profiles on mount with delay for BIP39 users — montage unique (perf)
  useEffect(() => {
    // Add a small delay to ensure auth data is fully loaded
    const timer = setTimeout(() => {
      loadProfilesRef.current();
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  // Rattrapage deep-link : si l'app a démarré sur /watch/*, l'hydratation automatique
  // de loadProfiles a été ignorée. La première sortie de /watch/ déclenche alors le
  // chargement ; une sélection explicite, elle, hydrate toujours immédiatement.
  useEffect(() => {
    const wasWatch = prevIsWatchRouteRef.current;
    prevIsWatchRouteRef.current = isWatchRoute;
    if (wasWatch && !isWatchRoute && !profileDataHydratedRef.current) {
      loadProfilesRef.current();
    }
  }, [isWatchRoute]);

  // Listen for auth changes to reload profiles — montage unique (perf)
  useEffect(() => {
    const handleAuthChange = () => {
      // Invalider immédiatement les réponses de l'ancien compte, y compris
      // une hydratation déjà en vol et une sélection manuelle de profil.
      profileIntentGuard.begin();
      const invalidatedHydration = profileHydrationGuard.begin();
      invalidatedHydration.finish();
      // Ne jamais laisser l'identité précédente visible pendant le changement
      // de compte (connexion Discord, déconnexion ou reconnexion).
      setCurrentProfile(null);
      setProfiles([]);
      setIsLoading(true);
      // Nouveau compte → les données profil devront être réhydratées
      profileDataHydratedRef.current = false;

      // Wipe syncable localStorage data from the previous account so it cannot
      // be migrated into the new account's default profile (P0-3). Le drapeau
      // isolé empêche le patch Storage d'App.tsx de transformer ces suppressions
      // en opérations `remove` envoyées avec le token du nouveau compte.
      try {
        runProfileIsolationWipe(() => {
          const syncableEntries = getSyncableLocalStorageEntries();
          for (const key of Object.keys(syncableEntries)) {
            localStorage.removeItem(key);
          }
        });
      } catch {
        // Best-effort: if storage is unavailable, skip silently.
      }

      // Reload profiles when auth changes (especially for BIP39)
      setTimeout(() => {
        loadProfilesRef.current();
      }, 500);
    };

    window.addEventListener('auth_changed', handleAuthChange);
    return () => window.removeEventListener('auth_changed', handleAuthChange);
  }, []);

  // Memoize value with state-only deps. The 4 callbacks (selectProfile,
  // createProfile, updateProfile, deleteProfile) are recreated each render
  // but they only close over state listed in deps below, so capturing the
  // most-recent ones on memo invalidation is correct.
  //
  // Why this matters: 12 consumers (every Watch page, MovieDetails, TVDetails,
  // ProfileSwitcher, ProfileMenu, LikeDislikeButton-on-cards). The previous
  // bare object literal was a fresh ref every render, and ProfileProvider
  // re-runs on every route transition between watch and non-watch routes
  // because its loadProfiles effect depends on `isWatchRoute`. — perf
  const value = useMemo<ProfileContextType>(() => ({
    currentProfile,
    profiles,
    selectProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    isLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentProfile, profiles, isLoading]);

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = (): ProfileContextType => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};
