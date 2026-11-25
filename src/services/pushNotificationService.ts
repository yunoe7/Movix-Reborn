import axios from 'axios';

const API_URL = import.meta.env.VITE_MAIN_API;

function getAuthToken(): string | null {
  return localStorage.getItem('auth_token') || localStorage.getItem('session_id');
}

let cachedVapidPublicKey: string | null = import.meta.env.VITE_VAPID_PUBLIC_KEY || null;

async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidPublicKey) return cachedVapidPublicKey;
  try {
    const response = await axios.get(`${API_URL}/api/comments/notifications/push/vapid-key`);
    const key = response.data?.publicKey;
    if (typeof key === 'string' && key.length > 0) {
      cachedVapidPublicKey = key;
      return key;
    }
  } catch {
    // ignore
  }
  return null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getPushPermission(): NotificationPermission {
  if (!isPushSupported()) return 'denied';
  return Notification.permission;
}

export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

const PUSH_BANNER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export function hasDismissedPushBanner(): boolean {
  const dismissedAt = localStorage.getItem('push_banner_dismissed_at');
  if (!dismissedAt) return false;
  return Date.now() - parseInt(dismissedAt, 10) < PUSH_BANNER_DELAY_MS;
}

export function dismissPushBanner(): void {
  localStorage.setItem('push_banner_dismissed_at', Date.now().toString());
}

export function dismissPushBannerPermanently(): void {
  localStorage.setItem('push_banner_dismissed_permanently', 'true');
}

export function hasDismissedPermanently(): boolean {
  return localStorage.getItem('push_banner_dismissed_permanently') === 'true';
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const vapidPublicKey = await getVapidPublicKey();
  if (!vapidPublicKey) return false;

  const token = getAuthToken();
  if (!token) return false;

  let subscription: PushSubscription | null = null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const registration = await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });

    await axios.post(
      `${API_URL}/api/comments/notifications/push/subscribe`,
      { subscription: subscription.toJSON() },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return true;
  } catch (error) {
    console.error('Erreur lors de la souscription push:', error);
    // Clean up the local subscription if backend registration failed.
    if (subscription) {
      try { await subscription.unsubscribe(); } catch { /* ignore */ }
    }
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;

    const token = getAuthToken();
    if (token) {
      try {
        await axios.delete(`${API_URL}/api/comments/notifications/push/unsubscribe`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { endpoint: subscription.endpoint },
        });
      } catch (error) {
        console.error('Erreur backend désinscription push:', error);
      }
    }

    await subscription.unsubscribe();
    return true;
  } catch (error) {
    console.error('Erreur lors de la désinscription push:', error);
    return false;
  }
}