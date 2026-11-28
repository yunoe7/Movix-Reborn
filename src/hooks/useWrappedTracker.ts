import { useEffect, useRef, useCallback } from 'react';
import { getResolvedAccountContext, getResolvedUserId } from '../utils/accountAuth';
import { readWrappedSession } from '../utils/wrappedSession';
import { createWrappedTracker, type WrappedIdentity, type WrappedTracker } from '../utils/wrappedTrackerCore';

const MAIN_API = import.meta.env.VITE_MAIN_API;

// Interval for sending data (30 seconds — reduced from 10s, 3x fewer network requests)
const SEND_INTERVAL_MS = 30_000;
const RETRY_DELAY_MS = 4_000;

interface ViewingData {
    contentType: 'movie' | 'tv' | 'anime' | 'live-tv';
    contentId: string;
    contentTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
}

interface PageData {
    pageName: string;
    contentId?: string; // TMDB ID for detail pages (movie-details, tv-details)
    meta?: Record<string, unknown>;
}

type TrackerMode = 'viewing' | 'page';

type TrackerTarget =
    | { mode: 'viewing'; data: ViewingData }
    | { mode: 'page'; data: PageData };

interface UseWrappedTrackerOptions {
    mode: TrackerMode;
    viewingData?: ViewingData;
    pageData?: PageData;
    isActive?: boolean; // Control whether tracking is active (e.g., player is open)
}

/**
 * Hook to track viewing time and page visits for Movix Wrapped 2026.
 * Respects privacy_data_collection setting in localStorage.
 * Sends data every 30 seconds to minimize request spam.
 * Le cumul et les règles d'envoi sont dans utils/wrappedTrackerCore.ts.
 */
export function useWrappedTracker(options: UseWrappedTrackerOptions) {
    const { mode, isActive = true } = options;

    // Check if data collection is enabled
    const isDataCollectionEnabled = useCallback(() => {
        try {
            const setting = localStorage.getItem('privacy_data_collection');
            // Default to true, disable only if explicitly set to 'false'
            return setting !== 'false';
        } catch {
            // Pas de collecte si la préférence de confidentialité est illisible.
            return false;
        }
    }, []);

    // Get user and profile IDs
    // IMPORTANT: Priority must match the JWT token generation order in the server
    // The JWT 'sub' claim is set from OAuth provider IDs (Google/Discord), so we must prioritize those
    const getUserInfo = useCallback(() => {
        try {
            const session = readWrappedSession();
            let userId: string | null = getResolvedUserId();

            // Priority 5 (last resort): VIP Guest UUID
            if (!userId) {
                userId = localStorage.getItem('guest_uuid');
            }

            return { authToken: session.token, profileId: session.profileId, userId };
        } catch {
            // Firefox peut fermer le stockage avant le dernier tick (NS_ERROR_ABORT).
            return { authToken: null, profileId: null, userId: null };
        }
    }, []);

    // L'identité est lue au moment du cumul, jamais au retry : un logout ou
    // un changement de profil ne peut pas créditer les secondes à un autre
    // compte. Le token doit encore correspondre pour qu'un retry soit tenté.
    const resolveIdentity = useCallback(() => {
        const { authToken, profileId, userId } = getUserInfo();
        if (!authToken || !userId) return null;
        let userType: string | null = null;
        try { userType = getResolvedAccountContext().userType ?? null; } catch { /* noop */ }
        return { userType, userId, profileId, token: authToken };
    }, [getUserInfo]);

    const isIdentityAuthenticatable = useCallback((identity: WrappedIdentity | null) => {
        if (!identity?.token || !identity.userId) return false;
        const current = resolveIdentity();
        if (!current?.token || current.token !== identity.token || current.userId !== identity.userId) return false;
        if (identity.profileId && current.profileId && identity.profileId !== current.profileId) return false;
        return true;
    }, [resolveIdentity]);

    // Envoie le temps d'une cible avec l'identité capturée à l'accumulation.
    // `false` = à retenter (réseau, 401 avec identité encore valable, 429, 5xx) ;
    // sans identité authentifiable, le cœur Wrapped garde les secondes dans sa
    // file isolée jusqu'à expiration.
    const sendToApi = useCallback(async (
        target: TrackerTarget,
        seconds: number,
        capturedIdentity?: WrappedIdentity | null
    ) => {
        const current = getUserInfo();
        const authToken = capturedIdentity?.token ?? current.authToken;
        const userId = capturedIdentity?.userId ?? current.userId;
        const profileId = capturedIdentity?.profileId ?? current.profileId;
        if (!authToken || !userId) return true;

        const now = new Date();
        const payload: Record<string, unknown> = {
            userId,
            profileId,
            type: target.mode,
            month: now.getMonth() + 1,
            year: now.getFullYear(),
            duration: seconds,
        };

        if (target.mode === 'viewing') {
            payload.contentType = target.data.contentType;
            payload.contentId = target.data.contentId;
            payload.contentTitle = target.data.contentTitle;
            payload.seasonNumber = target.data.seasonNumber;
            payload.episodeNumber = target.data.episodeNumber;
            payload.hourOfDay = now.getHours();
        } else {
            payload.pageName = target.data.pageName;
            payload.contentId = target.data.contentId;
            payload.meta = target.data.meta;
        }

        try {
            const response = await fetch(`${MAIN_API}/api/wrapped/track`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`,
                },
                body: JSON.stringify(payload),
                keepalive: true,
            });
            // Un 401 n'invalide pas la session : si l'identité capturée peut
            // encore être authentifiée, le temps reste en file différée pour un
            // retry. Un 403 d'appartenance reste un refus permanent acquitté.
            if (response.status === 403) return true;
            // Comparaison en ligne : elle ne dépend que de getUserInfo(), déjà
            // fourni au callback, et reste donc lisible par les tests qui
            // isolent l'envoi du reste du hook.
            const capturedToken = capturedIdentity?.token;
            if (response.status === 401 && capturedToken && capturedIdentity?.userId) {
                const current = getUserInfo();
                const stillAuthentifiable = current.authToken === capturedToken
                    && current.userId === capturedIdentity.userId
                    && (!capturedIdentity.profileId || !current.profileId || capturedIdentity.profileId === current.profileId);
                if (stillAuthentifiable) return false;
            }
            return response.ok || (
                response.status >= 400 && response.status < 500 && response.status !== 429
            );
        } catch {
            // Silent fail — wrapped tracking is non-critical
            return false;
        }
    }, [getUserInfo]);

    const trackerRef = useRef<WrappedTracker<TrackerTarget> | null>(null);
    if (!trackerRef.current) {
        trackerRef.current = createWrappedTracker<TrackerTarget>({
            now: Date.now,
            collectionEnabled: isDataCollectionEnabled,
            identity: resolveIdentity,
            isIdentityAuthenticatable,
            storage: localStorage,
            send: sendToApi,
        });
    }
    const tracker = trackerRef.current;

    // La cible ne change que si le contenu change : un nouveau rendu du parent
    // ne doit ni relancer les envois ni couper le cumul en cours.
    const target: TrackerTarget | null = mode === 'viewing'
        ? (options.viewingData ? { mode, data: options.viewingData } : null)
        : (options.pageData ? { mode, data: options.pageData } : null);
    const targetKey = !target ? '' : target.mode === 'viewing'
        ? ['viewing', target.data.contentType, target.data.contentId, target.data.seasonNumber ?? '', target.data.episodeNumber ?? ''].join('|')
        : ['page', target.data.pageName, target.data.contentId ?? ''].join('|');
    const targetRef = useRef(target);
    targetRef.current = target;

    useEffect(() => {
        tracker.setActive(isActive);
    }, [tracker, isActive]);

    // Changement de contenu (film, épisode, chaîne) : le reste part à l'ancien.
    useEffect(() => {
        tracker.setTarget(targetRef.current);
    }, [tracker, targetKey]);

    useEffect(() => {
        const handleVisibilityChange = () => tracker.setVisible(!document.hidden);
        handleVisibilityChange();
        document.addEventListener('visibilitychange', handleVisibilityChange);
        // Envoi raté : un seul nouvel essai, vite. Le serveur ne crédite que le
        // temps réel des ~35 dernières secondes, attendre le cycle suivant
        // ferait perdre presque tout le temps de l'envoi raté.
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const sendInterval = setInterval(() => {
            void tracker.tick().then((failed) => {
                if (!failed) return;
                clearTimeout(retryTimer);
                retryTimer = setTimeout(() => { void tracker.tick(); }, RETRY_DELAY_MS);
            });
        }, SEND_INTERVAL_MS);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearInterval(sendInterval);
            clearTimeout(retryTimer);
            // Démontage : envoie le reste de la cible en cours.
            tracker.setTarget(null);
        };
    }, [tracker]);

    return {
        isTracking: isActive && isDataCollectionEnabled(),
    };
}

export default useWrappedTracker;
