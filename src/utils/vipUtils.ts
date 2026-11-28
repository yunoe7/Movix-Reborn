/**
 * vipService.ts - Service centralisé de vérification VIP côté frontend
 * 
 * Au lieu de simplement lire localStorage('is_vip'), ce service :
 * 1. Vérifie périodiquement avec le serveur que la clé est toujours valide dans MySQL
 * 2. Révoque automatiquement le VIP si la clé a expiré ou a été désactivée
 * 3. Fournit un header `x-access-key` pour toutes les requêtes API
 */

import { readLocalStorage } from './browserStorage';

const MAIN_API = import.meta.env.VITE_MAIN_API;

// Intervalle de vérification : toutes les 10 minutes
const VIP_CHECK_INTERVAL = 10 * 60 * 1000;

// Cache local pour éviter de spammer le serveur. Il est indexé par clé
// d'accès : réutiliser le résultat d'une clé pour une autre peut accorder un
// VIP révoqué (ou refuser une clé valide) après un simple changement de code.
interface VipCacheEntry {
  time: number;
  result: boolean;
}

const vipCache = new Map<string, VipCacheEntry>();
const inFlightChecks = new Map<string, Promise<boolean>>();

function rememberCheck(accessKey: string, result: boolean): void {
  vipCache.set(accessKey, { time: Date.now(), result });
}

function cachedCheck(accessKey: string): VipCacheEntry | undefined {
  return vipCache.get(accessKey);
}

/**
 * Récupère la clé d'accès stockée dans localStorage
 */
export function getAccessKey(): string | null {
  return readLocalStorage('access_code');
}

/**
 * Vérifie côté serveur si la clé est toujours valide.
 * Cache le résultat pendant 10 minutes.
 * 
 * @param force - Forcer la vérification même si le cache est encore valide
 * @returns true si VIP valide, false sinon
 */
export async function checkVipStatus(force = false): Promise<boolean> {
  let accessKey: string | null;
  try {
    accessKey = localStorage.getItem('access_code');
  } catch {
    // Un stockage fermé n'est pas une révocation de la clé enregistrée.
    return false;
  }

  // Pas de clé stockée → pas VIP
  if (!accessKey) {
    revokeVipStatus();
    return false;
  }

  // Vérifier le cache de cette clé uniquement (sauf si force)
  const now = Date.now();
  const cached = cachedCheck(accessKey);
  if (!force && cached && (now - cached.time < VIP_CHECK_INTERVAL)) {
    return cached.result;
  }

  // Éviter les vérifications simultanées pour LA MÊME clé. Une clé différente
  // doit démarrer sa propre vérification, même si une autre est en vol.
  const inFlight = inFlightChecks.get(accessKey);
  if (inFlight) {
    return inFlight;
  }

  const check = _performCheck(accessKey);
  inFlightChecks.set(accessKey, check);
  try {
    return await check;
  } finally {
    if (inFlightChecks.get(accessKey) === check) inFlightChecks.delete(accessKey);
  }
}

/**
 * Effectue la vérification HTTP vers /api/check-vip
 */
async function _performCheck(accessKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${MAIN_API}/api/check-vip`, {
      method: 'GET',
      headers: {
        'x-access-key': accessKey,
      },
    });

    if (!response.ok) {
      // Erreur serveur — ne pas révoquer immédiatement (tolérance aux pannes)
      console.warn('[VIP] Server error during check, keeping current status');
      return readLocalStorage('is_vip') === 'true';
    }

    const data = await response.json();

    const previousCheckResult = cachedCheck(accessKey)?.result ?? null;
    rememberCheck(accessKey, data.vip === true);

    if (data.vip) {
      let changed = localStorage.getItem('is_vip') !== 'true';

      // Mettre à jour les données d'expiration si le serveur les renvoie
      if (data.expiresAt) {
        // Store as ISO string for consistent Date parsing from localStorage
        const d = new Date(typeof data.expiresAt === 'number' ? data.expiresAt : data.expiresAt);
        const nextExpires = isNaN(d.getTime()) ? String(data.expiresAt) : d.toISOString();
        if (localStorage.getItem('access_code_expires') !== nextExpires) {
          localStorage.setItem('access_code_expires', nextExpires);
          changed = true;
        }
      }
      if (localStorage.getItem('is_vip') !== 'true') {
        localStorage.setItem('is_vip', 'true');
      }

      // Une connexion avec un code VIP pose dÃ©jÃ  `is_vip` avant cette
      // vÃ©rification. Il faut aussi notifier lorsque la vÃ©rification devient
      // positive pour la premiÃ¨re fois, mÃªme si la valeur locale n'a pas changÃ©.
      if (changed || previousCheckResult !== true) {
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: true } }));
      }

      return true;
    } else {
      // Clé invalide/expirée/désactivée → révoquer le VIP
      console.warn('[VIP] Server rejected key:', data.reason || 'unknown');
      revokeVipStatus();
      return false;
    }
  } catch (error) {
    // Erreur réseau — ne pas révoquer (tolérance aux pannes)
    console.warn('[VIP] Network error during check:', error);
    return readLocalStorage('is_vip') === 'true';
  }
}

/**
 * Révoque le statut VIP local
 */
export function revokeVipStatus(): void {
  let revokedKey: string | null = null;
  try {
    revokedKey = localStorage.getItem('access_code');
    localStorage.removeItem('is_vip');
    localStorage.removeItem('access_code');
    localStorage.removeItem('access_code_expires');
  } catch {
    // Le résultat serveur reste connu même si le stockage est inaccessible.
  }
  // La clé révoquée ne doit pas redevenir valide par simple retour de cache.
  if (revokedKey) rememberCheck(revokedKey, false);

  // Notifier les autres onglets et composants
  window.dispatchEvent(new Event('storage'));
  window.dispatchEvent(new CustomEvent('vipStatusChanged', { detail: { vip: false } }));
}

/**
 * Vérifie si l'utilisateur est VIP (lecture locale + vérification serveur en arrière-plan).
 * 
 * Pour les vérifications synchrones rapides (UI rendering), vérifie localStorage.
 * Lance une vérification serveur en arrière-plan si le cache est expiré.
 * 
 * @returns true si le localStorage indique VIP (sera corrigé en arrière-plan si invalide)
 */
export function isUserVip(): boolean {
  const localVip = readLocalStorage('is_vip') === 'true';

  if (localVip) {
    // Lancer une vérification serveur en arrière-plan (non bloquante) pour la
    // clé courante uniquement.
    const accessKey = getAccessKey();
    const cached = accessKey ? cachedCheck(accessKey) : undefined;
    if (!cached || Date.now() - cached.time > VIP_CHECK_INTERVAL) {
      checkVipStatus().catch(() => { /* ignore */ });
    }
  }

  return localVip;
}

/**
 * Retourne les headers à inclure dans les requêtes API pour la vérification VIP côté serveur.
 * À utiliser dans tous les appels fetch/axios vers le backend.
 */
export function getVipHeaders(): Record<string, string> {
  const accessKey = getAccessKey();
  if (accessKey) {
    return { 'x-access-key': accessKey };
  }
  return {};
}

/**
 * Démarre la vérification automatique périodique du VIP.
 * À appeler au démarrage de l'application (dans App.tsx ou main.tsx).
 */
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startVipVerification(): void {
  // Vérification initiale
  if (getAccessKey()) {
    checkVipStatus(true).catch(() => { /* ignore */ });
  }

  // Arrêter l'intervalle précédent si existant
  if (intervalId) {
    clearInterval(intervalId);
  }

  // Vérification périodique
  intervalId = setInterval(() => {
    if (getAccessKey()) {
      checkVipStatus().catch(() => { /* ignore */ });
    }
  }, VIP_CHECK_INTERVAL);
}

/**
 * Arrête la vérification automatique périodique.
 */
export function stopVipVerification(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
