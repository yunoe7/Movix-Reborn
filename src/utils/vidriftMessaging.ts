// Communication avec l'iframe VidRift. Le targetOrigin doit toujours être une
// origine explicite autorisée : jamais '*' et jamais l'origine de la page parente.
export const VIDRIFT_ORIGIN = 'https://embed.vidrift.net';

const ALLOWED_VIDRIFT_ORIGINS = new Set([VIDRIFT_ORIGIN]);

export function isAllowedVidRiftOrigin(origin: string): boolean {
  return ALLOWED_VIDRIFT_ORIGINS.has(origin);
}

function readFrameOrigin(frame: HTMLIFrameElement): string | null {
  try {
    return new URL(frame.src || '', window.location.href).origin;
  } catch {
    return null;
  }
}

// Une frame cross-origin a `contentDocument === null`. Une frame about:blank ou
// retombée sur le SPA Movix a un document same-origin : dans ce cas le document
// courant n'est pas VidRift et poster avec l'origine VidRift lève une exception.
export function getVidRiftTargetOrigin(frame?: HTMLIFrameElement | null): string | null {
  if (!frame?.contentWindow) return null;
  const origin = readFrameOrigin(frame);
  if (!origin || !isAllowedVidRiftOrigin(origin)) return null;
  try {
    if (frame.contentDocument) return null;
  } catch {
    // Cross-origin : c'est précisément le cas attendu pour le lecteur VidRift.
  }
  return origin;
}

export function postToVidRift(
  frame: HTMLIFrameElement | null | undefined,
  message: Record<string, unknown>
): boolean {
  const targetOrigin = getVidRiftTargetOrigin(frame);
  if (!targetOrigin || !frame?.contentWindow) return false;
  try {
    frame.contentWindow.postMessage(message, targetOrigin);
    return true;
  } catch {
    // La frame a pu naviguer entre la validation et l'envoi : ne pas propager
    // l'erreur dans un handler Socket.IO, worker ou onLoad.
    return false;
  }
}

export function isTrustedVidRiftMessage(
  event: MessageEvent,
  frame?: HTMLIFrameElement | null
): boolean {
  return isAllowedVidRiftOrigin(event.origin)
    && Boolean(frame?.contentWindow)
    && event.source === frame?.contentWindow;
}
