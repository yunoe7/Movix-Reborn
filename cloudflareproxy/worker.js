/**
 * Worker Cloudflare de relais CORS pour Movix.
 *
 * Politique actuelle : deny-all. Les deux listes sont volontairement vides.
 * Toute requête est refusée tant qu'une origine ET une cible n'ont pas été
 * ajoutées explicitement, une par une, dans ce fichier.
 *
 * Ce Worker est distinct de `API/proxiesembed/`, qui sert les lecteurs Movix.
 * Aucune modification ici ne doit toucher à proxiesembed.
 */

// Correspondance exacte uniquement : pas de joker, pas de regex, pas de
// sous-domaine implicite (y compris `www.`), pas de valeur fournie par
// l'appelant, pas de variable d'environnement de repli.
const ALLOWED_ORIGINS = Object.freeze([]);

// Chaque entrée future est de la forme :
//   { origin: 'https://hote-exact', pathPrefix: '/chemin/autorise/' }
// `pathPrefix` est facultatif et comparé comme un préfixe littéral.
const ALLOWED_TARGETS = Object.freeze([]);

// POST, PUT, PATCH, DELETE et toute autre méthode sont désactivés.
const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD']);
const ALLOW_METHODS = 'GET, HEAD';
const PREFLIGHT_METHODS = 'GET, HEAD, OPTIONS';
const PREFLIGHT_HEADERS = 'Accept, Accept-Language, If-Modified-Since, If-None-Match, Range';

// HTTPS uniquement. Aucune exception, y compris pour les hôtes locaux.
const ALLOWED_PROTOCOLS = Object.freeze(['https:']);

// Aucun en-tête choisi par l'appelant n'est relayé. Il n'existe aucun
// équivalent de l'ancien `x-cors-headers`.
const FORWARDED_REQUEST_HEADERS = Object.freeze([
  'accept',
  'accept-language',
  'if-modified-since',
  'if-none-match',
  'range',
]);

// Seuls ces en-têtes de réponse sont copiés. Tous ne sont pas nécessairement
// accessibles au JavaScript du navigateur sans `Access-Control-Expose-Headers`.
// `cache-control` est volontairement absent : `no-store` reste prioritaire.
const EXPOSED_RESPONSE_HEADERS = Object.freeze([
  'accept-ranges',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'expires',
  'last-modified',
]);

const MAX_HEADER_VALUE_LENGTH = 4096;

function baseHeaders() {
  const headers = new Headers();
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return headers;
}

function errorResponse(status, code, allowedOrigin = null, extra = {}) {
  const headers = baseHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');
  }
  for (const [name, value] of Object.entries(extra)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

function matchedOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return null;
  return ALLOWED_ORIGINS.find((candidate) => candidate === origin) || null;
}

function readTargetValue(requestUrl) {
  const values = new URL(requestUrl).searchParams.getAll('uri');
  // Un seul paramètre, non vide : aucune ambiguïté d'encodage, aucun
  // double décodage, aucune valeur cachée dans un second `uri`.
  if (values.length !== 1 || values[0].length === 0) return null;
  return values[0];
}

function parseTarget(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  // Protocole explicitement autorisé, aucun identifiant d'autorité,
  // aucun fragment.
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password || parsed.hash) return null;
  return parsed;
}

// Une comparaison de préfixe seule ne suffit pas : un amont peut décoder
// `%2e%2e`, `%2f` ou `%5c` après le Worker. On refuse donc ces formes à
// chaque couche de décodage, puis on exige le préfixe sur la forme encodée
// ET sur la forme décodée.
function decodePathSafely(pathname) {
  const layers = [pathname];
  let current = pathname;
  for (let i = 0; i < 3; i += 1) {
    let next;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) break;
    layers.push(next);
    current = next;
  }
  for (const layer of layers) {
    if (/%2e%2e/i.test(layer) || /%2f/i.test(layer) || /%5c/i.test(layer)) return null;
    if (/[\\]/.test(layer) || /[\u0000-\u001f\u007f]/.test(layer)) return null;
    for (const segment of layer.split('/')) {
      if (segment === '.' || segment === '..') return null;
    }
  }
  return layers[layers.length - 1];
}

function isAllowedTarget(parsed) {
  const decodedPath = decodePathSafely(parsed.pathname);
  if (decodedPath === null) return false;

  for (const entry of ALLOWED_TARGETS) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.origin !== parsed.origin) continue;
    if (entry.pathPrefix
      && !(parsed.pathname.startsWith(entry.pathPrefix)
        && decodedPath.startsWith(entry.pathPrefix))) continue;
    return true;
  }
  return false;
}

function outboundHeaders(request) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null && value.length <= MAX_HEADER_VALUE_LENGTH) {
      headers.set(name, value);
    }
  }
  return headers;
}

function proxyHeaders(upstream, allowedOrigin) {
  const headers = baseHeaders();
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Vary', 'Origin');
  for (const name of EXPOSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Réaffirmé après la copie : un `cache-control` amont ne peut pas écraser
  // la politique du Worker.
  headers.set('Cache-Control', 'no-store');
  return headers;
}

async function handleRequest(request) {
  const method = String(request.method || '').toUpperCase();

  if (method !== 'OPTIONS' && !ALLOWED_METHODS.includes(method)) {
    return errorResponse(405, 'method_not_allowed', null, { Allow: ALLOW_METHODS });
  }

  // L'origine est comparée à la liste, jamais renvoyée telle quelle. La
  // valeur utilisée dans CORS provient de la constante autorisée.
  const allowedOrigin = matchedOrigin(request.headers.get('Origin'));
  if (!allowedOrigin) {
    return errorResponse(403, 'forbidden');
  }

  if (method === 'OPTIONS') {
    const headers = baseHeaders();
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Access-Control-Allow-Methods', PREFLIGHT_METHODS);
    headers.set('Access-Control-Allow-Headers', PREFLIGHT_HEADERS);
    headers.set('Access-Control-Max-Age', '600');
    headers.set(
      'Vary',
      'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    );
    return new Response(null, { status: 204, headers });
  }

  const targetValue = readTargetValue(request.url);
  if (!targetValue) {
    return errorResponse(400, 'invalid_target', allowedOrigin);
  }

  const target = parseTarget(targetValue);
  if (!target || !isAllowedTarget(target)) {
    return errorResponse(403, 'target_not_allowed', allowedOrigin);
  }

  let upstream;
  try {
    upstream = await fetch(target.href, {
      method: method === 'HEAD' ? 'HEAD' : 'GET',
      headers: outboundHeaders(request),
      // Aucune redirection ne peut être suivie : elle échapperait au filtrage.
      redirect: 'manual',
    });
  } catch {
    return errorResponse(502, 'upstream_unavailable', allowedOrigin);
  }

  // Une redirection, même vers une cible autorisée, n'est jamais renvoyée.
  if (upstream.status >= 300 && upstream.status < 400) {
    return errorResponse(502, 'redirect_blocked', allowedOrigin);
  }

  const body = method === 'HEAD' ? null : await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers: proxyHeaders(upstream, allowedOrigin),
  });
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});
