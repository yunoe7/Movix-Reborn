import { MAIN_API } from '../config/runtime';

/**
 * Transport de la console « Décoratif » vers la Main API LOT 1/LOT 2.
 *
 * Le catalogue ci-dessous reproduit les identifiants acceptés par le backend.
 * Il sert uniquement à construire des formulaires sûrs et à afficher des
 * libellés : le serveur reste l'autorité et rejette toute valeur inconnue.
 * Aucune décoration n'est appliquée aux pages publiques depuis ce module.
 */

export type SeasonalThemeFamily =
  | 'screenDecor' | 'background' | 'components' | 'lights' | 'particles' | 'typography';
export type SeasonalThemePlatform = 'mobile' | 'desktop' | 'tablet' | 'tv';
export type SeasonalThemeCapability = 'lightMode' | 'reducedMotion' | 'tvStaticEffects';
export type SeasonalThemeTypographyCategory = 'pageTitle' | 'sectionTitle' | 'categoryTitle';
export type SeasonalThemeFontKey = 'inter' | 'creepster' | 'archivo-black';
export type SeasonalThemeEffect = 'none' | 'glow' | 'frost';

export const SEASONAL_THEME_FAMILIES: readonly SeasonalThemeFamily[] = [
  'screenDecor', 'background', 'components', 'lights', 'particles', 'typography',
];
export const SEASONAL_THEME_PLATFORMS: readonly SeasonalThemePlatform[] = [
  'mobile', 'desktop', 'tablet', 'tv',
];
export const SEASONAL_THEME_CAPABILITIES: readonly SeasonalThemeCapability[] = [
  'lightMode', 'reducedMotion', 'tvStaticEffects',
];
export const SEASONAL_THEME_TYPOGRAPHY_CATEGORIES: readonly SeasonalThemeTypographyCategory[] = [
  'pageTitle', 'sectionTitle', 'categoryTitle',
];
export const SEASONAL_THEME_FONTS: readonly {
  key: SeasonalThemeFontKey;
  family: string;
  weights: number[];
}[] = [
  { key: 'inter', family: 'Inter', weights: [400, 500, 600, 700, 800, 900] },
  { key: 'creepster', family: 'Creepster', weights: [400] },
  { key: 'archivo-black', family: 'Archivo Black', weights: [400] },
];
export const SEASONAL_THEME_EFFECTS: readonly SeasonalThemeEffect[] = ['none', 'glow', 'frost'];

export interface SeasonalThemeCatalogDecoration {
  id: string;
  themeId: string;
  family: SeasonalThemeFamily;
  priority: number;
  conflictsWith: string[];
  requires: string[];
  allowedPlatforms: SeasonalThemePlatform[];
  allowedCapabilities: SeasonalThemeCapability[];
  supportsEffects: boolean;
  optionKeys: string[];
}

export interface SeasonalThemeCatalogTheme {
  id: string;
  aliases: string[];
  priority: number;
}

export interface SeasonalThemeCatalog {
  themes: SeasonalThemeCatalogTheme[];
  decorations: SeasonalThemeCatalogDecoration[];
  limits: { priorityMin: number; priorityMax: number; maxWindowsPerTheme: number; maxOptionValueLength: number };
  assetPrefix: string;
}

export const SEASONAL_THEME_CATALOG: SeasonalThemeCatalog = {
  themes: [
    { id: 'halloween-2026', aliases: ['halloween'], priority: 10 },
    { id: 'christmas-2026', aliases: ['christmas'], priority: 20 },
  ],
  decorations: [
    { id: 'halloween.screenDecor', themeId: 'halloween-2026', family: 'screenDecor', priority: 10, conflictsWith: ['christmas.screenDecor'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['opacity', 'density'] },
    { id: 'halloween.background', themeId: 'halloween-2026', family: 'background', priority: 10, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['assetPath'] },
    { id: 'halloween.background.fog', themeId: 'halloween-2026', family: 'background', priority: 11, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['opacity', 'density'] },
    { id: 'halloween.components', themeId: 'halloween-2026', family: 'components', priority: 10, conflictsWith: ['christmas.components'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['assetPath'] },
    { id: 'halloween.lights', themeId: 'halloween-2026', family: 'lights', priority: 10, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['intensity'] },
    { id: 'halloween.lights.candles', themeId: 'halloween-2026', family: 'lights', priority: 11, conflictsWith: [], requires: ['halloween.background'], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['intensity'] },
    { id: 'halloween.particles', themeId: 'halloween-2026', family: 'particles', priority: 10, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['density', 'maxParticles'] },
    { id: 'halloween.typography', themeId: 'halloween-2026', family: 'typography', priority: 10, conflictsWith: ['christmas.typography'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: true, optionKeys: [] },
    { id: 'christmas.screenDecor', themeId: 'christmas-2026', family: 'screenDecor', priority: 20, conflictsWith: ['halloween.screenDecor'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['opacity', 'density'] },
    { id: 'christmas.background', themeId: 'christmas-2026', family: 'background', priority: 20, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['assetPath'] },
    { id: 'christmas.background.snow', themeId: 'christmas-2026', family: 'background', priority: 21, conflictsWith: [], requires: ['christmas.background'], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['opacity', 'density'] },
    { id: 'christmas.components', themeId: 'christmas-2026', family: 'components', priority: 20, conflictsWith: ['halloween.components'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: false, optionKeys: ['assetPath'] },
    { id: 'christmas.lights', themeId: 'christmas-2026', family: 'lights', priority: 20, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['intensity'] },
    { id: 'christmas.particles', themeId: 'christmas-2026', family: 'particles', priority: 20, conflictsWith: [], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet'], allowedCapabilities: ['lightMode', 'reducedMotion'], supportsEffects: false, optionKeys: ['density', 'maxParticles'] },
    { id: 'christmas.typography', themeId: 'christmas-2026', family: 'typography', priority: 20, conflictsWith: ['halloween.typography'], requires: [], allowedPlatforms: ['mobile', 'desktop', 'tablet', 'tv'], allowedCapabilities: ['lightMode', 'reducedMotion', 'tvStaticEffects'], supportsEffects: true, optionKeys: [] },
  ],
  limits: { priorityMin: 0, priorityMax: 100, maxWindowsPerTheme: 8, maxOptionValueLength: 120 },
  assetPrefix: '/assets/seasonal-theme/',
};

export type SeasonalThemeFlagMap = Record<string, boolean>;

export interface SeasonalThemeWindow {
  start: string;
  end: string;
  timezone: string;
}

export interface SeasonalThemeTypographySetting {
  enabled: boolean;
  fontKey: string;
  weight: number;
  effect: string;
}

export interface SeasonalThemeDecoration {
  id: string;
  family: string;
  enabled: boolean;
  priority: number;
  conflictsWith: string[];
  requires: string[];
  platforms: SeasonalThemeFlagMap;
  capabilities: SeasonalThemeFlagMap;
  options: Record<string, string | number>;
  typography: Record<string, SeasonalThemeTypographySetting>;
}

export interface SeasonalThemeTheme {
  id: string;
  enabled: boolean;
  priority: number;
  platforms: SeasonalThemeFlagMap;
  capabilities: SeasonalThemeFlagMap;
  windows: SeasonalThemeWindow[];
  decorations: SeasonalThemeDecoration[];
}

export interface SeasonalThemeConfig {
  version: number;
  revision: number;
  emergencyDisable: boolean;
  themes: SeasonalThemeTheme[];
  typography: Record<string, SeasonalThemeTypographySetting>;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SeasonalThemeStatus {
  failClosed: boolean;
  subscribed: boolean;
  localRevision: number;
  emergency: boolean;
  channel: string;
}

export interface SeasonalThemeHistoryEntry {
  id: number | string;
  config: SeasonalThemeConfig;
  changedBy: string | null;
  reason: string | null;
  changedAt: string | null;
}

export interface SeasonalThemeAuditEntry {
  id: number | string;
  adminId: string | null;
  adminAuthType: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  createdAt: string | null;
}

export interface SeasonalThemeResolvedDecoration {
  id: string;
  family: string;
  [key: string]: unknown;
}

export interface SeasonalThemeResolved {
  decorations: SeasonalThemeResolvedDecoration[];
  [key: string]: unknown;
}

export type SeasonalThemeApiErrorCode =
  | 'TOKEN_MISSING'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'REVISION_CONFLICT'
  | 'EMERGENCY_ACTIVE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'ABORTED'
  | 'REQUEST_FAILED';

export class SeasonalThemeApiError extends Error {
  readonly name = 'SeasonalThemeApiError';
  readonly code: SeasonalThemeApiErrorCode;
  readonly status?: number;

  constructor(code: SeasonalThemeApiErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

function normalizeFlagMap(value: unknown): SeasonalThemeFlagMap {
  if (!isPlainObject(value)) return {};
  const result: SeasonalThemeFlagMap = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') result[key] = enabled;
  }
  return result;
}

function normalizeTypography(value: unknown): Record<string, SeasonalThemeTypographySetting> {
  const result: Record<string, SeasonalThemeTypographySetting> = {};
  if (!isPlainObject(value)) return result;
  for (const [category, raw] of Object.entries(value)) {
    if (!isPlainObject(raw)) continue;
    result[category] = {
      enabled: asBoolean(raw.enabled),
      fontKey: asString(raw.fontKey, 'inter'),
      weight: asNumber(raw.weight, 400),
      effect: asString(raw.effect, 'none'),
    };
  }
  return result;
}

function normalizeWindow(value: unknown): SeasonalThemeWindow {
  const raw = isPlainObject(value) ? value : {};
  return {
    start: asString(raw.start),
    end: asString(raw.end),
    timezone: asString(raw.timezone),
  };
}

function normalizeDecoration(value: unknown): SeasonalThemeDecoration {
  const raw = isPlainObject(value) ? value : {};
  const options: Record<string, string | number> = {};
  if (isPlainObject(raw.options)) {
    for (const [key, option] of Object.entries(raw.options)) {
      if (typeof option === 'string' || (typeof option === 'number' && Number.isFinite(option))) {
        options[key] = option;
      }
    }
  }
  return {
    id: asString(raw.id),
    family: asString(raw.family),
    enabled: asBoolean(raw.enabled),
    priority: asNumber(raw.priority),
    conflictsWith: asStringArray(raw.conflictsWith),
    requires: asStringArray(raw.requires),
    platforms: normalizeFlagMap(raw.platforms),
    capabilities: normalizeFlagMap(raw.capabilities),
    options,
    typography: normalizeTypography(raw.typography),
  };
}

function normalizeTheme(value: unknown): SeasonalThemeTheme {
  const raw = isPlainObject(value) ? value : {};
  return {
    id: asString(raw.id),
    enabled: asBoolean(raw.enabled),
    priority: asNumber(raw.priority),
    platforms: normalizeFlagMap(raw.platforms),
    capabilities: normalizeFlagMap(raw.capabilities),
    windows: asArray(raw.windows).map(normalizeWindow),
    decorations: asArray(raw.decorations).map(normalizeDecoration),
  };
}

export function normalizeSeasonalThemeConfig(value: unknown): SeasonalThemeConfig {
  const raw = isPlainObject(value) ? value : {};
  return {
    version: asNumber(raw.version, 1),
    revision: asNumber(raw.revision),
    emergencyDisable: asBoolean(raw.emergencyDisable),
    themes: asArray(raw.themes).map(normalizeTheme),
    typography: normalizeTypography(raw.typography),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null,
  };
}

export function normalizeSeasonalThemeStatus(value: unknown): SeasonalThemeStatus {
  const raw = isPlainObject(value) ? value : {};
  return {
    failClosed: asBoolean(raw.failClosed, true),
    subscribed: asBoolean(raw.subscribed),
    localRevision: asNumber(raw.localRevision),
    emergency: asBoolean(raw.emergency),
    channel: asString(raw.channel, 'seasonal-theme:changes'),
  };
}

function normalizeHistoryEntry(value: unknown): SeasonalThemeHistoryEntry {
  const raw = isPlainObject(value) ? value : {};
  return {
    id: (raw.id as number | string) ?? 0,
    config: normalizeSeasonalThemeConfig(raw.config),
    changedBy: typeof raw.changedBy === 'string' ? raw.changedBy
      : typeof raw.changed_by === 'string' ? raw.changed_by : null,
    reason: typeof raw.reason === 'string' ? raw.reason
      : typeof raw.change_reason === 'string' ? raw.change_reason : null,
    changedAt: typeof raw.changedAt === 'string' ? raw.changedAt
      : typeof raw.changed_at === 'string' ? raw.changed_at : null,
  };
}

function parseDetails(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeAuditEntry(value: unknown): SeasonalThemeAuditEntry {
  const raw = isPlainObject(value) ? value : {};
  return {
    id: (raw.id as number | string) ?? 0,
    adminId: typeof raw.adminId === 'string' ? raw.adminId
      : typeof raw.admin_id === 'string' ? raw.admin_id : null,
    adminAuthType: typeof raw.adminAuthType === 'string' ? raw.adminAuthType
      : typeof raw.admin_auth_type === 'string' ? raw.admin_auth_type : null,
    action: asString(raw.action),
    target: typeof raw.target === 'string' ? raw.target : null,
    details: parseDetails(raw.details ?? raw.details_json),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt
      : typeof raw.created_at === 'string' ? raw.created_at : null,
  };
}

function getAdminToken(): string {
  const token = localStorage.getItem('auth_token');
  if (!token) throw new SeasonalThemeApiError('TOKEN_MISSING', 'Token admin manquant');
  return token;
}

function statusErrorCode(status: number, rawCode: string): SeasonalThemeApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'UNAVAILABLE';
  if (status === 400) return 'VALIDATION';
  if (status === 409 && rawCode === 'REVISION_CONFLICT') return 'REVISION_CONFLICT';
  if (status === 409 && rawCode === 'EMERGENCY_ACTIVE') return 'EMERGENCY_ACTIVE';
  return 'REQUEST_FAILED';
}

const DEFAULT_ERROR_MESSAGES: Record<SeasonalThemeApiErrorCode, string> = {
  TOKEN_MISSING: 'Session admin expirée, reconnectez-vous',
  UNAUTHORIZED: 'Session expirée, reconnectez-vous',
  FORBIDDEN: 'Accès administration refusé',
  VALIDATION: 'Configuration refusée par le serveur',
  REVISION_CONFLICT: 'Un autre administrateur a publié une révision plus récente',
  EMERGENCY_ACTIVE: 'Arrêt d’urgence actif : publication impossible',
  RATE_LIMITED: 'Trop d’actions administratives, réessayez dans un instant',
  UNAVAILABLE: 'Synchronisation indisponible, réessayez plus tard',
  NETWORK: 'Erreur réseau, vérifiez la connexion',
  ABORTED: 'Chargement annulé',
  REQUEST_FAILED: 'Requête refusée par le serveur',
};

async function requestJson(
  path: string,
  init: RequestInit = {},
  options: { admin?: boolean } = {},
): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  if (options.admin) {
    headers.set('Authorization', `Bearer ${getAdminToken()}`);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(`${MAIN_API}${path}`, {
      cache: 'no-store',
      credentials: 'omit',
      ...init,
      headers,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const code: SeasonalThemeApiErrorCode = aborted ? 'ABORTED' : 'NETWORK';
    throw new SeasonalThemeApiError(code, asString((error as Error | undefined)?.message) || DEFAULT_ERROR_MESSAGES[code]);
  }

  const data: unknown = await response.json().catch(() => ({}));
  const body = isPlainObject(data) ? data : {};
  if (!response.ok) {
    const rawCode = asString(body.code);
    const code = statusErrorCode(response.status, rawCode);
    const message = asString(body.error) || DEFAULT_ERROR_MESSAGES[code];
    throw new SeasonalThemeApiError(code, message, response.status);
  }
  if (body.success === false) {
    const rawCode = asString(body.code);
    const code = statusErrorCode(response.status, rawCode);
    throw new SeasonalThemeApiError(code, asString(body.error) || DEFAULT_ERROR_MESSAGES[code], response.status);
  }
  return body;
}

function clampLimit(limit: number, fallback: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : fallback;
}

export async function getPublicSeasonalThemeConfig(signal?: AbortSignal): Promise<SeasonalThemeConfig> {
  const body = await requestJson('/api/seasonal-theme', { signal });
  return normalizeSeasonalThemeConfig(body.config);
}

export async function resolveSeasonalTheme(
  input: { platform?: string; capabilities?: string[]; at?: string },
  signal?: AbortSignal,
): Promise<SeasonalThemeResolved> {
  const query = new URLSearchParams();
  if (input.platform) query.set('platform', input.platform);
  if (input.capabilities && input.capabilities.length > 0) {
    query.set('capabilities', input.capabilities.join(','));
  }
  if (input.at) query.set('at', input.at);
  const suffix = query.toString();
  const body = await requestJson(`/api/seasonal-theme/resolve${suffix ? `?${suffix}` : ''}`, { signal });
  return { decorations: [], ...body.resolved } as SeasonalThemeResolved;
}

export async function getAdminSeasonalThemeConfig(signal?: AbortSignal): Promise<SeasonalThemeConfig> {
  const body = await requestJson('/api/admin/seasonal-theme', { signal }, { admin: true });
  return normalizeSeasonalThemeConfig(body.config);
}

export interface SeasonalThemePublishInput {
  patch: Record<string, unknown>;
  reason: string;
  expectedRevision: number;
}

export async function publishSeasonalThemeConfig(
  input: SeasonalThemePublishInput,
  signal?: AbortSignal,
): Promise<SeasonalThemeConfig> {
  const body = await requestJson('/api/admin/seasonal-theme', {
    method: 'PUT',
    body: JSON.stringify({ patch: input.patch, reason: input.reason, expectedRevision: input.expectedRevision }),
    signal,
  }, { admin: true });
  return normalizeSeasonalThemeConfig(body.config);
}

export async function disableSeasonalThemeDecoration(
  input: { decorationId: string; reason: string; expectedRevision: number },
  signal?: AbortSignal,
): Promise<SeasonalThemeConfig> {
  const body = await requestJson('/api/admin/seasonal-theme/decorations/disable', {
    method: 'POST',
    body: JSON.stringify({
      decorationId: input.decorationId,
      reason: input.reason,
      expectedRevision: input.expectedRevision,
    }),
    signal,
  }, { admin: true });
  return normalizeSeasonalThemeConfig(body.config);
}

export async function setSeasonalThemeEmergency(
  input: { enabled: boolean; reason: string; expectedRevision: number },
  signal?: AbortSignal,
): Promise<SeasonalThemeConfig> {
  const body = await requestJson('/api/admin/seasonal-theme/emergency-disable', {
    method: 'POST',
    body: JSON.stringify({
      enabled: input.enabled,
      reason: input.reason,
      expectedRevision: input.expectedRevision,
    }),
    signal,
  }, { admin: true });
  return normalizeSeasonalThemeConfig(body.config);
}

export async function invalidateSeasonalThemeCache(
  input: { reason: string; expectedRevision: number },
  signal?: AbortSignal,
): Promise<{ success: boolean; revision: number }> {
  const body = await requestJson('/api/admin/seasonal-theme/cache/invalidate', {
    method: 'POST',
    body: JSON.stringify({ reason: input.reason, expectedRevision: input.expectedRevision }),
    signal,
  }, { admin: true });
  const raw = isPlainObject(body.invalidation) ? body.invalidation : {};
  return { success: asBoolean(raw.success), revision: asNumber(raw.revision) };
}

export async function getSeasonalThemeStatus(signal?: AbortSignal): Promise<SeasonalThemeStatus> {
  const body = await requestJson('/api/admin/seasonal-theme/status', { signal }, { admin: true });
  return normalizeSeasonalThemeStatus(body.status);
}

export async function getSeasonalThemeHistory(limit = 20, signal?: AbortSignal): Promise<SeasonalThemeHistoryEntry[]> {
  const body = await requestJson(`/api/admin/seasonal-theme/history?limit=${clampLimit(limit, 20)}`, { signal }, { admin: true });
  return asArray(body.history).map(normalizeHistoryEntry);
}

export async function getSeasonalThemeAudit(limit = 50, signal?: AbortSignal): Promise<SeasonalThemeAuditEntry[]> {
  const body = await requestJson(`/api/admin/seasonal-theme/audit?limit=${clampLimit(limit, 50)}`, { signal }, { admin: true });
  return asArray(body.audit).map(normalizeAuditEntry);
}
