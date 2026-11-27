/**
 * Détection « appareil mobile/tablette » côté client, pour choisir quoi
 * proposer à l'utilisateur : l'appli mobile (Android/iOS) ou l'extension
 * navigateur (PC/Mac). L'iPad sous iPadOS se présente comme « Macintosh » :
 * on le rattrape via le multi-touch.
 */
export function isMobileOrTabletDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Détecte spécifiquement Safari sur iPad, y compris sous iPadOS 13+ où
 * l'iPad se déclare « Macintosh » (UA bureau) avec plusieurs points tactiles.
 *
 * Les autres navigateurs sur iPad (Chrome, Firefox, PWA), l'iPhone et les
 * vrais Mac sont exclus : les correctifs de lecture qui utilisent ce signal
 * ne doivent concerner que WebKit sur iPadOS.
 */
export function isIpadSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isWebKitSafari = /Safari/i.test(ua)
    && !/(Chrome|CriOS|Chromium|Android|Edg|OPR|Opera|FxiOS|Firefox|UCBrowser)/i.test(ua);
  if (!isWebKitSafari) return false;
  if (/iPad/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}
