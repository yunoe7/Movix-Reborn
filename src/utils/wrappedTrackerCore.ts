// Cumul du temps passé sur un contenu (ou une page) pour le Wrapped, sans
// React ni DOM : l'horloge, le réglage de confidentialité, l'identité et
// l'envoi sont fournis par l'appelant, ce qui permet de tester chaque cas à la
// main.
//
// Règles :
// - le temps ne compte que si le suivi est actif, l'onglet visible, une cible
//   connue et la collecte autorisée ; collecte coupée = rien n'est cumulé ni
//   envoyé, quel que soit le chemin (onglet masqué, démontage, changement) ;
// - le temps cumulé appartient à la cible ET à l'identité capturées au moment
//   de l'accumulation : un retry ne réattribue jamais des secondes au profil
//   courant ;
// - un envoi raté (réseau, 429, 5xx) garde son temps dans une file isolée,
//   persistée et bornée (TTL 7 jours), avec createdAt stable et id de dédup ;
// - une identité qui n'est plus authentifiable n'est jamais envoyée avec un
//   autre token : ses secondes restent non synchronisées jusqu'à un retour du
//   propriétaire d'origine ou à l'expiration de la file.

/** En dessous, un envoi périodique ne vaut pas une requête. */
export const WRAPPED_MIN_SECONDS_TO_SEND = 5;
/** Un trou aussi long entre deux relevés = onglet endormi : rien n'est compté. */
export const WRAPPED_MAX_GAP_SECONDS = 60;
/** Durée maximale d'un envoi côté serveur (POST /api/wrapped/track). */
export const WRAPPED_MAX_SECONDS_PER_SEND = 60;
/** Clé de la file isolée des secondes en attente d'un retry. */
export const WRAPPED_DEFERRED_STORAGE_KEY = '__movix_wrapped_deferred';
export const WRAPPED_DEFERRED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WRAPPED_DEFERRED_MAX_ENTRIES = 100;
export const WRAPPED_DEFERRED_VERSION = 1;

export interface WrappedIdentity {
    userType?: string | null;
    userId: string | null;
    profileId: string | null;
    token: string | null;
}

export interface DeferredWrappedEntry<Target> {
    id: string;
    dedupId: string;
    target: Target;
    seconds: number;
    identity: WrappedIdentity | null;
    createdAt: number;
    lastAttemptAt: number;
    attempts: number;
}

export interface WrappedTrackerDeps<Target> {
    now: () => number;
    collectionEnabled: () => boolean;
    /** Résout à `false` quand l'envoi doit être retenté plus tard. */
    send: (target: Target, seconds: number, identity?: WrappedIdentity | null) => Promise<boolean>;
    /** Identité au moment où les secondes sont accumulées (pas au retry). */
    identity?: () => WrappedIdentity | null;
    /** Un retry n'est tenté que si cette identité peut encore être authentifiée. */
    isIdentityAuthenticatable?: (identity: WrappedIdentity | null) => boolean;
    /** Stockage de la file différée ; absent = file en mémoire seulement. */
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface WrappedTracker<Target> {
    setTarget: (target: Target | null) => void;
    setActive: (active: boolean) => void;
    setVisible: (visible: boolean) => void;
    /**
     * Envoi périodique (toutes les 30 s côté hook). Résout à `true` quand
     * l'envoi a raté : le serveur ne crédite que le temps réel récent, donc un
     * nouvel essai n'est utile que dans les secondes qui suivent.
     */
    tick: () => Promise<boolean>;
    pendingSeconds: () => number;
    /** Copie lisible de la file isolée (diagnostic + tests d'isolation). */
    deferredEntries: () => DeferredWrappedEntry<Target>[];
    /** Secondes conservées sans avoir été créditées au serveur. */
    unsyncedSeconds: () => number;
}

export function createWrappedTracker<Target>(deps: WrappedTrackerDeps<Target>): WrappedTracker<Target> {
    return createWrappedTrackerImpl(deps);
}

/**
 * Implémentation nommée pour les tests d'isolation : elle ne référence que ses
 * dépendances injectées et les constantes ci-dessus.
 */
function createWrappedTrackerImpl<Target>(deps: WrappedTrackerDeps<Target>): WrappedTracker<Target> {
    let target: Target | null = null;
    let active = false;
    let visible = true;
    let pending = 0;
    // Début de la tranche en cours ; null tant que rien ne doit être compté.
    let since: number | null = null;
    let inFlight = 0;
    let retrying = false;
    let pendingIdentity: WrappedIdentity | null = null;
    let pendingTarget: Target | null = null;
    let sequence = 0;

    const counting = () => active && visible && target !== null;

    function currentIdentity(): WrappedIdentity | null {
        try {
            const identity = deps.identity?.() ?? null;
            if (!identity || typeof identity !== 'object') return null;
            return {
                userType: identity.userType ?? null,
                userId: identity.userId ?? null,
                profileId: identity.profileId ?? null,
                token: identity.token ?? null
            };
        } catch {
            return null;
        }
    }

    function sameIdentity(a: WrappedIdentity | null, b: WrappedIdentity | null): boolean {
        // Les appelants historiques sans identité gardent le comportement
        // « même propriétaire » : la cible suffit à décider du retry.
        if (!a && !b) return true;
        return Boolean(
            a && b
            && (a.userType ?? null) === (b.userType ?? null)
            && (a.userId ?? null) === (b.userId ?? null)
            && (a.profileId ?? null) === (b.profileId ?? null)
            && (a.token ?? null) === (b.token ?? null)
        );
    }

    function serialize(value: unknown): string {
        try { return JSON.stringify(value) ?? ''; } catch { return String(value); }
    }

    function dedupIdFor(entryTarget: Target, identity: WrappedIdentity | null): string {
        return `${serialize(entryTarget)}|${serialize(identity)}`;
    }

    function isAuthenticatable(identity: WrappedIdentity | null): boolean {
        if (!deps.isIdentityAuthenticatable) return true;
        try { return deps.isIdentityAuthenticatable(identity); } catch { return false; }
    }

    function createId(): string {
        sequence += 1;
        return `${deps.now()}:${sequence}:${Math.random().toString(36).slice(2)}`;
    }

    function normalizeEntry(raw: unknown): DeferredWrappedEntry<Target> | null {
        if (!raw || typeof raw !== 'object') return null;
        const candidate = raw as Partial<DeferredWrappedEntry<Target>>;
        if (!candidate.target || typeof candidate.seconds !== 'number') return null;
        const seconds = Math.floor(candidate.seconds);
        if (seconds < 1) return null;
        const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt) && candidate.createdAt > 0
            ? candidate.createdAt
            : deps.now();
        if (deps.now() - createdAt > WRAPPED_DEFERRED_TTL_MS) return null;
        const lastAttemptAt = typeof candidate.lastAttemptAt === 'number' && Number.isFinite(candidate.lastAttemptAt)
            ? candidate.lastAttemptAt
            : createdAt;
        const identity = (candidate.identity && typeof candidate.identity === 'object')
            ? candidate.identity as WrappedIdentity
            : null;
        return {
            id: typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(),
            dedupId: typeof candidate.dedupId === 'string' && candidate.dedupId
                ? candidate.dedupId
                : dedupIdFor(candidate.target, identity),
            target: candidate.target,
            seconds: Math.min(WRAPPED_MAX_SECONDS_PER_SEND, seconds),
            identity,
            createdAt,
            lastAttemptAt,
            attempts: typeof candidate.attempts === 'number' && Number.isFinite(candidate.attempts) ? candidate.attempts : 0
        };
    }

    // File isolée : chargée au démarrage, filtrée par TTL puis bornée. Les
    // entrées périmées ne sont jamais envoyées ni recréées.
    const deferred: Array<DeferredWrappedEntry<Target>> = [];
    try {
        const raw = deps.storage?.getItem(WRAPPED_DEFERRED_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as { v?: unknown; entries?: unknown };
            if (Array.isArray(parsed?.entries)) {
                for (const rawEntry of parsed.entries) {
                    const entry = normalizeEntry(rawEntry);
                    if (entry) deferred.push(entry);
                    if (deferred.length >= WRAPPED_DEFERRED_MAX_ENTRIES) break;
                }
            }
        }
    } catch {
        // Stockage indisponible ou payload corrompu : on repart d'une file vide.
    }

    function saveDeferred(): void {
        try {
            if (!deps.storage) return;
            if (deferred.length === 0) {
                deps.storage.removeItem(WRAPPED_DEFERRED_STORAGE_KEY);
                return;
            }
            deps.storage.setItem(WRAPPED_DEFERRED_STORAGE_KEY, JSON.stringify({
                v: WRAPPED_DEFERRED_VERSION,
                entries: deferred.slice(0, WRAPPED_DEFERRED_MAX_ENTRIES)
            }));
        } catch {
            // Quota / Firefox en fermeture : la file mémoire reste disponible.
        }
    }

    function defer(entryTarget: Target, seconds: number, identity: WrappedIdentity | null): void {
        const whole = Math.floor(seconds);
        if (whole < 1) return;
        const now = deps.now();
        const dedupId = dedupIdFor(entryTarget, identity);
        const existing = deferred.find((entry) => entry.dedupId === dedupId);
        if (existing) {
            // Un retry multiple du même cumul ne crée pas de doublon.
            existing.seconds = Math.min(WRAPPED_MAX_SECONDS_PER_SEND, existing.seconds + whole);
            existing.lastAttemptAt = now;
        } else {
            deferred.push({
                id: createId(),
                dedupId,
                target: entryTarget,
                seconds: Math.min(WRAPPED_MAX_SECONDS_PER_SEND, whole),
                identity,
                createdAt: now,
                lastAttemptAt: now,
                attempts: 0
            });
        }
        if (deferred.length > WRAPPED_DEFERRED_MAX_ENTRIES) deferred.splice(0, deferred.length - WRAPPED_DEFERRED_MAX_ENTRIES);
        saveDeferred();
    }

    async function deliver(entryTarget: Target, seconds: number, identity: WrappedIdentity | null): Promise<boolean> {
        inFlight += 1;
        try {
            return await deps.send(entryTarget, seconds, identity);
        } catch {
            return false;
        } finally {
            inFlight -= 1;
        }
    }

    async function retryDeferred(): Promise<void> {
        if (retrying || inFlight > 0 || deferred.length === 0) return;
        retrying = true;
        try {
            for (const entry of deferred.slice()) {
                if (!deferred.includes(entry)) continue;
                // Une identité devenue non authentifiable reste isolée : jamais
                // d'envoi avec le token d'un autre compte.
                if (!isAuthenticatable(entry.identity)) continue;
                entry.attempts += 1;
                entry.lastAttemptAt = deps.now();
                const delivered = await deliver(entry.target, entry.seconds, entry.identity);
                if (delivered) {
                    const index = deferred.indexOf(entry);
                    if (index >= 0) deferred.splice(index, 1);
                }
            }
        } finally {
            retrying = false;
            saveDeferred();
        }
    }

    // Verse la tranche écoulée dans le cumul, puis repart de maintenant.
    function harvest(): void {
        const now = deps.now();
        const identity = currentIdentity();
        if (!deps.collectionEnabled()) {
            pending = 0;
            since = null;
            pendingIdentity = null;
            pendingTarget = null;
            return;
        }

        // Une identité changée alors que des secondes étaient en attente :
        // ces secondes restent au propriétaire qui les a accumulées.
        if (pending >= 1 && pendingIdentity && !sameIdentity(pendingIdentity, identity) && pendingTarget !== null) {
            defer(pendingTarget, pending, pendingIdentity);
            pending = 0;
        }

        if (since !== null) {
            const elapsed = (now - since) / 1000;
            if (elapsed > 0 && elapsed < WRAPPED_MAX_GAP_SECONDS) {
                pending = Math.min(WRAPPED_MAX_SECONDS_PER_SEND, pending + elapsed);
            }
        }
        since = counting() ? now : null;
        if (since !== null) {
            pendingIdentity = identity;
            pendingTarget = target;
        }
    }

    async function flush(minSeconds: number): Promise<boolean> {
        harvest();
        if (inFlight > 0 || target === null || pending < minSeconds) return false;
        const seconds = Math.floor(pending);
        if (seconds < 1) return false;
        const sentTarget = target;
        const sentIdentity = pendingIdentity || currentIdentity();
        pending -= seconds;
        if (pending < 1) {
            pendingIdentity = currentIdentity();
            pendingTarget = target;
        }
        const delivered = await deliver(sentTarget, seconds, sentIdentity);
        if (!delivered) {
            if (target === sentTarget && sameIdentity(sentIdentity, currentIdentity())) {
                pending = Math.min(WRAPPED_MAX_SECONDS_PER_SEND, pending + seconds);
            } else {
                // La cible ou l'identité a pu changer pendant l'envoi : ces
                // secondes appartiennent à l'ancien propriétaire.
                defer(sentTarget, seconds, sentIdentity);
            }
        }
        return !delivered;
    }

    async function drain(): Promise<boolean> {
        await retryDeferred();
        const failed = await flush(WRAPPED_MIN_SECONDS_TO_SEND);
        return failed || deferred.length > 0;
    }

    return {
        setTarget(next) {
            harvest();
            const previous = target;
            const seconds = Math.floor(pending);
            const sentIdentity = pendingIdentity || currentIdentity();
            target = next;
            pending = 0;
            pendingIdentity = currentIdentity();
            pendingTarget = next;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
            if (previous !== null && seconds >= 1) {
                void deliver(previous, seconds, sentIdentity).then((delivered) => {
                    if (!delivered) defer(previous, seconds, sentIdentity);
                });
            }
        },
        setActive(next) {
            if (next === active) return;
            harvest();
            active = next;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
            if (since !== null) {
                pendingIdentity = currentIdentity();
                pendingTarget = target;
            }
        },
        setVisible(next) {
            if (next === visible) return;
            harvest();
            visible = next;
            since = counting() && deps.collectionEnabled() ? deps.now() : null;
            if (since !== null) {
                pendingIdentity = currentIdentity();
                pendingTarget = target;
            }
            // Onglet masqué : il peut ne jamais revenir, on envoie ce qu'on a.
            if (!next) void drain();
        },
        tick() {
            return drain();
        },
        pendingSeconds() {
            return pending;
        },
        deferredEntries() {
            return deferred.map((entry) => ({
                ...entry,
                identity: entry.identity ? { ...entry.identity } : null,
                target: entry.target
            }));
        },
        unsyncedSeconds() {
            return deferred.reduce((total, entry) => total + entry.seconds, 0);
        }
    };
}
