import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Palette,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
} from '../icons/Icons8';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Skeleton } from '../ui/Skeleton';
import { AdminPanel, AdminServiceRow, AdminStateBlock, AdminStatCard } from '../admin/AdminUi';
import { useAdminConfirm } from '../admin/AdminConfirmProvider';
import { SettingsField, SettingsSection, ToggleRow } from '../adminVipDonations/SettingsUi';
import {
  SEASONAL_THEME_CATALOG,
  SEASONAL_THEME_CAPABILITIES,
  SEASONAL_THEME_EFFECTS,
  SEASONAL_THEME_FONTS,
  SEASONAL_THEME_PLATFORMS,
  SEASONAL_THEME_TYPOGRAPHY_CATEGORIES,
  SeasonalThemeApiError,
  disableSeasonalThemeDecoration,
  getAdminSeasonalThemeConfig,
  getSeasonalThemeAudit,
  getSeasonalThemeHistory,
  getSeasonalThemeStatus,
  invalidateSeasonalThemeCache,
  publishSeasonalThemeConfig,
  setSeasonalThemeEmergency,
  type SeasonalThemeApiErrorCode,
  type SeasonalThemeAuditEntry,
  type SeasonalThemeCapability,
  type SeasonalThemeCatalogDecoration,
  type SeasonalThemeConfig,
  type SeasonalThemeDecoration,
  type SeasonalThemeFamily,
  type SeasonalThemeFlagMap,
  type SeasonalThemeHistoryEntry,
  type SeasonalThemePlatform,
  type SeasonalThemeStatus,
  type SeasonalThemeTypographySetting,
} from '../../services/seasonalThemeAdminService';
import {
  buildSeasonalThemePatch,
  buildSeasonalThemePreview,
  cloneSeasonalThemeConfig,
  mergeSeasonalThemeRemote,
  sameSeasonalThemeConfig,
  seasonalThemeFingerprint,
  summarizeSeasonalThemeConfig,
  validateSeasonalThemeDraft,
} from './seasonalThemeForm';
import './adminDecor.css';

type TabId = 'dashboard' | 'themes' | 'schedule' | 'publish' | 'history' | 'preview';
type BusyAction = 'publish' | 'emergency' | 'disable' | 'invalidate' | null;

interface Label { key: string; fallback: string }

const TAB_LABELS: Record<TabId, Label> = {
  dashboard: { key: 'admin.decor.tab.dashboard', fallback: 'Tableau de bord' },
  themes: { key: 'admin.decor.tab.themes', fallback: 'Thèmes & décorations' },
  schedule: { key: 'admin.decor.tab.schedule', fallback: 'Programmation' },
  publish: { key: 'admin.decor.tab.publish', fallback: 'Publication' },
  history: { key: 'admin.decor.tab.history', fallback: 'Historique & audit' },
  preview: { key: 'admin.decor.tab.preview', fallback: 'Aperçu' },
};
const TAB_IDS: TabId[] = ['dashboard', 'themes', 'schedule', 'publish', 'history', 'preview'];

const FAMILY_LABELS: Record<SeasonalThemeFamily, Label> = {
  screenDecor: { key: 'admin.decor.family.screenDecor', fallback: 'Décor d’écran' },
  background: { key: 'admin.decor.family.background', fallback: 'Arrière-plan' },
  components: { key: 'admin.decor.family.components', fallback: 'Composants' },
  lights: { key: 'admin.decor.family.lights', fallback: 'Lumières' },
  particles: { key: 'admin.decor.family.particles', fallback: 'Particules' },
  typography: { key: 'admin.decor.family.typography', fallback: 'Typographie' },
};
const PLATFORM_LABELS: Record<SeasonalThemePlatform, Label> = {
  mobile: { key: 'admin.decor.platform.mobile', fallback: 'Mobile' },
  desktop: { key: 'admin.decor.platform.desktop', fallback: 'Ordinateur' },
  tablet: { key: 'admin.decor.platform.tablet', fallback: 'Tablette' },
  tv: { key: 'admin.decor.platform.tv', fallback: 'TV' },
};
const CAPABILITY_LABELS: Record<SeasonalThemeCapability, Label> = {
  lightMode: { key: 'admin.decor.capability.lightMode', fallback: 'Mode clair' },
  reducedMotion: { key: 'admin.decor.capability.reducedMotion', fallback: 'Mouvement réduit' },
  tvStaticEffects: { key: 'admin.decor.capability.tvStaticEffects', fallback: 'Effets statiques TV' },
};
const CATEGORY_LABELS = {
  pageTitle: { key: 'admin.decor.category.pageTitle', fallback: 'Titre de page' },
  sectionTitle: { key: 'admin.decor.category.sectionTitle', fallback: 'Titre de section' },
  categoryTitle: { key: 'admin.decor.category.categoryTitle', fallback: 'Titre de catégorie' },
};
const EFFECT_LABELS = {
  none: { key: 'admin.decor.effect.none', fallback: 'Aucun' },
  glow: { key: 'admin.decor.effect.glow', fallback: 'Halo' },
  frost: { key: 'admin.decor.effect.frost', fallback: 'Givre' },
};

const FALLBACK_TIMEZONES = ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney'];
const PAGE_SIZE = 5;

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function makeDecoration(entry: SeasonalThemeCatalogDecoration): SeasonalThemeDecoration {
  return {
    id: entry.id,
    family: entry.family,
    enabled: false,
    priority: entry.priority,
    conflictsWith: [...entry.conflictsWith],
    requires: [...entry.requires],
    platforms: Object.fromEntries(SEASONAL_THEME_PLATFORMS.map((platform) => [platform, entry.allowedPlatforms.includes(platform)])),
    capabilities: Object.fromEntries(SEASONAL_THEME_CAPABILITIES.map((capability) => [capability, entry.allowedCapabilities.includes(capability)])),
    options: {},
    typography: entry.family === 'typography'
      ? Object.fromEntries(SEASONAL_THEME_TYPOGRAPHY_CATEGORIES.map((category) => [category, {
        enabled: true,
        fontKey: 'inter',
        weight: 400,
        effect: 'none',
      }]))
      : {},
  };
}

function allFlags(keys: readonly string[]): SeasonalThemeFlagMap {
  return Object.fromEntries(keys.map((key) => [key, true]));
}

function FlagCheckboxes({
  id,
  label,
  values,
  allowed,
  labels,
  onChange,
}: {
  id: string;
  label: string;
  values: SeasonalThemeFlagMap;
  allowed: readonly string[];
  labels: Record<string, Label>;
  onChange: (next: SeasonalThemeFlagMap) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="admin-decor-fieldset">
      <legend>{label}</legend>
      <div className="admin-decor-chips">
        {allowed.map((key) => {
          const item = labels[key] || { key: '', fallback: key };
          return (
            <label key={key} className="admin-decor-chip" htmlFor={`${id}-${key}`}>
              <input
                id={`${id}-${key}`}
                type="checkbox"
                checked={values[key] === true}
                onChange={(event) => onChange({ ...values, [key]: event.target.checked })}
              />
              <span>{t(item.key, item.fallback)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function IdListCheckboxes({
  id,
  label,
  values,
  options,
  onChange,
}: {
  id: string;
  label: string;
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (value: string) => onChange(
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
  );
  return (
    <fieldset className="admin-decor-fieldset">
      <legend>{label}</legend>
      <div className="admin-decor-chips">
        {options.length === 0 && <span className="admin-decor-muted">—</span>}
        {options.map((option) => (
          <label key={option} className="admin-decor-chip" htmlFor={`${id}-${option}`}>
            <input
              id={`${id}-${option}`}
              type="checkbox"
              checked={values.includes(option)}
              onChange={() => toggle(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TypographyEditor({
  decoration,
  onChange,
}: {
  decoration: SeasonalThemeDecoration;
  onChange: (next: Record<string, SeasonalThemeTypographySetting>) => void;
}) {
  const { t } = useTranslation();
  const update = (category: string, patch: Partial<SeasonalThemeTypographySetting>) => {
    const current = decoration.typography[category] || { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' };
    onChange({ ...decoration.typography, [category]: { ...current, ...patch } });
  };

  return (
    <div className="admin-decor-typography">
      {SEASONAL_THEME_TYPOGRAPHY_CATEGORIES.map((category) => {
        const setting = decoration.typography[category] || { enabled: false, fontKey: 'inter', weight: 400, effect: 'none' };
        const font = SEASONAL_THEME_FONTS.find((item) => item.key === setting.fontKey) || SEASONAL_THEME_FONTS[0];
        const categoryMeta = CATEGORY_LABELS[category];
        return (
          <div key={category} className="admin-decor-typography-row">
            <SettingsField
              id={`typo-${decoration.id}-${category}-font`}
              label={t(categoryMeta.key, categoryMeta.fallback)}
            >
              <select
                id={`typo-${decoration.id}-${category}-font`}
                className="admin-decor-control"
                value={setting.fontKey}
                onChange={(event) => {
                  const nextFont = SEASONAL_THEME_FONTS.find((item) => item.key === event.target.value) || font;
                  update(category, { fontKey: nextFont.key, weight: nextFont.weights[0] });
                }}
                aria-label={t(categoryMeta.key, categoryMeta.fallback)}
              >
                {SEASONAL_THEME_FONTS.map((item) => (
                  <option key={item.key} value={item.key}>{item.family} ({item.key})</option>
                ))}
              </select>
            </SettingsField>
            <SettingsField
              id={`typo-${decoration.id}-${category}-weight`}
              label={t('admin.decor.field.weight', 'Graisse')}
            >
              <select
                id={`typo-${decoration.id}-${category}-weight`}
                className="admin-decor-control"
                value={String(setting.weight)}
                onChange={(event) => update(category, { weight: Number(event.target.value) })}
                aria-label={t('admin.decor.field.weight', 'Graisse')}
              >
                {font.weights.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </select>
            </SettingsField>
            <SettingsField
              id={`typo-${decoration.id}-${category}-effect`}
              label={t('admin.decor.field.effect', 'Effet')}
              hint={category === 'categoryTitle'
                ? t('admin.decor.field.categoryEffectHint', 'categoryTitle accepte uniquement « aucun ».')
                : undefined}
            >
              <select
                id={`typo-${decoration.id}-${category}-effect`}
                className="admin-decor-control"
                value={setting.effect}
                disabled={category === 'categoryTitle'}
                onChange={(event) => update(category, {
                  effect: category === 'categoryTitle' ? 'none' : event.target.value,
                })}
                aria-label={t('admin.decor.field.effect', 'Effet')}
              >
                {SEASONAL_THEME_EFFECTS.map((effect) => {
                  const meta = EFFECT_LABELS[effect];
                  return <option key={effect} value={effect}>{t(meta.key, meta.fallback)}</option>;
                })}
              </select>
            </SettingsField>
            <div className="admin-decor-typography-enabled">
              <ToggleRow
                id={`typo-${decoration.id}-${category}-enabled`}
                label={t('admin.decor.field.enabled', 'Activé')}
                checked={setting.enabled}
                onCheckedChange={(enabled) => update(category, { enabled })}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecorationEditor({
  decoration,
  onChange,
  onDisable,
}: {
  decoration: SeasonalThemeDecoration;
  onChange: (patch: Partial<SeasonalThemeDecoration>) => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();
  const catalog = SEASONAL_THEME_CATALOG.decorations.find((item) => item.id === decoration.id);
  const family = FAMILY_LABELS[decoration.family as SeasonalThemeFamily]
    || { key: '', fallback: decoration.family };
  const options = catalog?.optionKeys ?? [];

  return (
    <div className="admin-decor-editor" data-testid={`admin-decor-decoration-${decoration.id}`}>
      <div className="admin-decor-editor-head">
        <div className="min-w-0">
          <p className="admin-decor-editor-id">{decoration.id}</p>
          <p className="admin-decor-muted">{t(family.key, family.fallback)}</p>
        </div>
        <div className="admin-decor-editor-actions">
          <ToggleRow
            id={`decor-enabled-${decoration.id}`}
            label={t('admin.decor.field.enabled', 'Activé')}
            checked={decoration.enabled}
            onCheckedChange={(enabled) => onChange({ enabled })}
            className="admin-decor-inline-toggle"
          />
          <Button type="button" variant="ghost" size="sm" onClick={onDisable} aria-label={t('admin.decor.action.disableDecoration', 'Désactiver la décoration')}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="admin-decor-fields">
        <SettingsField id={`decor-priority-${decoration.id}`} label={t('admin.decor.field.priority', 'Priorité')}>
          <Input
            id={`decor-priority-${decoration.id}`}
            className="admin-decor-control"
            type="number"
            min={SEASONAL_THEME_CATALOG.limits.priorityMin}
            max={SEASONAL_THEME_CATALOG.limits.priorityMax}
            value={decoration.priority}
            onChange={(event) => onChange({ priority: Number(event.target.value) })}
          />
        </SettingsField>
        <FlagCheckboxes
          id={`decor-platform-${decoration.id}`}
          label={t('admin.decor.field.platforms', 'Plateformes')}
          values={decoration.platforms}
          allowed={SEASONAL_THEME_PLATFORMS}
          labels={PLATFORM_LABELS}
          onChange={(platforms) => onChange({ platforms })}
        />
        <FlagCheckboxes
          id={`decor-capability-${decoration.id}`}
          label={t('admin.decor.field.capabilities', 'Capacités')}
          values={decoration.capabilities}
          allowed={SEASONAL_THEME_CAPABILITIES}
          labels={CAPABILITY_LABELS}
          onChange={(capabilities) => onChange({ capabilities })}
        />
        <IdListCheckboxes
          id={`decor-conflicts-${decoration.id}`}
          label={t('admin.decor.field.conflicts', 'Conflits')}
          values={decoration.conflictsWith}
          options={catalog?.conflictsWith ?? []}
          onChange={(conflictsWith) => onChange({ conflictsWith })}
        />
        <IdListCheckboxes
          id={`decor-requires-${decoration.id}`}
          label={t('admin.decor.field.requires', 'Dépendances')}
          values={decoration.requires}
          options={SEASONAL_THEME_CATALOG.decorations
            .filter((item) => item.id !== decoration.id)
            .map((item) => item.id)}
          onChange={(requires) => onChange({ requires })}
        />
      </div>

      {options.length > 0 && (
        <div className="admin-decor-fields">
          {options.map((key) => (
            <SettingsField
              key={key}
              id={`decor-option-${decoration.id}-${key}`}
              label={key === 'assetPath' ? t('admin.decor.field.assetPath', 'Chemin local') : key}
              hint={key === 'assetPath' ? SEASONAL_THEME_CATALOG.assetPrefix : undefined}
            >
              <Input
                id={`decor-option-${decoration.id}-${key}`}
                className="admin-decor-control"
                type={key === 'assetPath' ? 'text' : 'number'}
                value={decoration.options[key] ?? ''}
                onChange={(event) => onChange({
                  options: {
                    ...decoration.options,
                    [key]: key === 'assetPath' ? event.target.value : Number(event.target.value),
                  },
                })}
              />
            </SettingsField>
          ))}
        </div>
      )}

      {decoration.family === 'typography' && (
        <TypographyEditor
          decoration={decoration}
          onChange={(typography) => onChange({ typography })}
        />
      )}
    </div>
  );
}

const AdminDecor: React.FC = () => {
  const { t } = useTranslation();
  const { confirm } = useAdminConfirm();
  const [tab, setTab] = useState<TabId>('dashboard');
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<{ code: string; message: string } | null>(null);
  const [base, setBase] = useState<SeasonalThemeConfig | null>(null);
  const [draft, setDraft] = useState<SeasonalThemeConfig | null>(null);
  const [status, setStatus] = useState<SeasonalThemeStatus | null>(null);
  const [history, setHistory] = useState<SeasonalThemeHistoryEntry[]>([]);
  const [audit, setAudit] = useState<SeasonalThemeAuditEntry[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [conflict, setConflict] = useState<{ remote: SeasonalThemeConfig; merged: SeasonalThemeConfig } | null>(null);
  const [previewContext, setPreviewContext] = useState({
    platform: 'desktop',
    capabilities: [] as string[],
    at: new Date().toISOString(),
  });
  const [historyPage, setHistoryPage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const requestIdRef = useRef(0);
  const actionRef = useRef(false);

  const describeError = useCallback((error: unknown): { code: string; message: string } => {
    const code = error instanceof SeasonalThemeApiError ? error.code : 'REQUEST_FAILED';
    const messages: Record<SeasonalThemeApiErrorCode, Label> = {
      TOKEN_MISSING: { key: 'admin.decor.error.TOKEN_MISSING', fallback: 'Session admin expirée, reconnectez-vous' },
      UNAUTHORIZED: { key: 'admin.decor.error.UNAUTHORIZED', fallback: 'Session expirée, reconnectez-vous' },
      FORBIDDEN: { key: 'admin.decor.error.FORBIDDEN', fallback: 'Accès administration refusé' },
      VALIDATION: { key: 'admin.decor.error.VALIDATION', fallback: 'Configuration refusée par le serveur' },
      REVISION_CONFLICT: { key: 'admin.decor.error.REVISION_CONFLICT', fallback: 'Un autre administrateur a publié une révision plus récente' },
      EMERGENCY_ACTIVE: { key: 'admin.decor.error.EMERGENCY_ACTIVE', fallback: 'Arrêt d’urgence actif : publication impossible' },
      RATE_LIMITED: { key: 'admin.decor.error.RATE_LIMITED', fallback: 'Trop d’actions administratives, réessayez dans un instant' },
      UNAVAILABLE: { key: 'admin.decor.error.UNAVAILABLE', fallback: 'Synchronisation indisponible, réessayez plus tard' },
      NETWORK: { key: 'admin.decor.error.NETWORK', fallback: 'Erreur réseau, vérifiez la connexion' },
      ABORTED: { key: 'admin.decor.error.ABORTED', fallback: 'Chargement annulé' },
      REQUEST_FAILED: { key: 'admin.decor.error.REQUEST_FAILED', fallback: 'Requête refusée par le serveur' },
    };
    const label = messages[code as SeasonalThemeApiErrorCode] || messages.REQUEST_FAILED;
    return { code, message: t(label.key, label.fallback) };
  }, [t]);

  const load = useCallback(async (options: { preserveDraft?: boolean } = {}) => {
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    setLoadError(null);
    try {
      const [config, sync, entries, auditRows] = await Promise.all([
        getAdminSeasonalThemeConfig(),
        getSeasonalThemeStatus(),
        getSeasonalThemeHistory(100),
        getSeasonalThemeAudit(100),
      ]);
      if (requestId !== requestIdRef.current) return;
      setBase(config);
      setStatus(sync);
      setHistory(entries);
      setAudit(auditRows);
      setDraft((current) => {
        if (options.preserveDraft && current && !sameSeasonalThemeConfig(current, config)) return current;
        return cloneSeasonalThemeConfig(config);
      });
      setLoadState('ready');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(describeError(error));
      setLoadState('error');
    }
  }, [describeError]);

  useEffect(() => { void load(); }, [load]);

  const issues = useMemo(() => (draft ? validateSeasonalThemeDraft(draft) : []), [draft]);
  const patch = useMemo(() => (base && draft ? buildSeasonalThemePatch(base, draft) : {}), [base, draft]);
  const isDirty = Boolean(base && draft && !sameSeasonalThemeConfig(base, draft));
  const summary = useMemo(
    () => (draft && status
      ? summarizeSeasonalThemeConfig(draft, status, new Date())
      : null),
    [draft, status],
  );
  const preview = useMemo(
    () => (draft ? buildSeasonalThemePreview(draft, previewContext) : null),
    [draft, previewContext],
  );

  useEffect(() => {
    if (!isDirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const updateDraft = useCallback((updater: (next: SeasonalThemeConfig) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneSeasonalThemeConfig(current);
      updater(next);
      return next;
    });
  }, []);

  const updateTheme = useCallback((themeId: string, fields: Partial<SeasonalThemeConfig['themes'][number]>) => {
    updateDraft((next) => {
      const theme = next.themes.find((item) => item.id === themeId);
      if (theme) Object.assign(theme, fields);
    });
  }, [updateDraft]);

  const updateDecoration = useCallback((themeId: string, decorationId: string, fields: Partial<SeasonalThemeDecoration>) => {
    updateDraft((next) => {
      const decoration = next.themes.find((theme) => theme.id === themeId)
        ?.decorations.find((item) => item.id === decorationId);
      if (decoration) Object.assign(decoration, fields);
    });
  }, [updateDraft]);

  const handlePublish = useCallback(async () => {
    if (!base || !draft || !isDirty || busy !== null || actionRef.current) return;
    actionRef.current = true;
    const submitted = cloneSeasonalThemeConfig(draft);
    const accepted = await confirm({
      title: t('admin.decor.confirm.publishTitle', 'Publier cette révision ?'),
      message: t('admin.decor.confirm.publishMessage', 'La configuration sera visible par tous les workers sans redéploiement.'),
      confirmLabel: t('admin.decor.confirm.publish', 'Publier'),
      destructive: false,
    });
    if (!accepted) {
      actionRef.current = false;
      return;
    }
    setBusy('publish');
    try {
      const next = await publishSeasonalThemeConfig({
        patch: buildSeasonalThemePatch(base, submitted),
        reason: reason.trim() || t('admin.decor.reason.default', 'Publication depuis la console'),
        expectedRevision: base.revision,
      });
      setBase(next);
      setDraft((current) => (current && sameSeasonalThemeConfig(current, submitted)
        ? cloneSeasonalThemeConfig(next)
        : current));
      setConflict(null);
      setReason('');
      toast.success(t('admin.decor.publish.success', { defaultValue: 'Publié : révision {{revision}}', revision: next.revision }));
      await load({ preserveDraft: true });
    } catch (error) {
      const described = describeError(error);
      if (described.code === 'REVISION_CONFLICT') {
        try {
          const remote = await getAdminSeasonalThemeConfig();
          const merged = mergeSeasonalThemeRemote(base, submitted, remote);
          setBase(remote);
          setDraft((current) => (current && sameSeasonalThemeConfig(current, submitted) ? merged : current));
          setConflict({ remote, merged });
          setTab('publish');
        } catch {
          toast.error(described.message);
        }
      } else {
        toast.error(described.message);
        if (described.code === 'EMERGENCY_ACTIVE' || described.code === 'UNAVAILABLE') {
          await load({ preserveDraft: true });
        }
      }
    } finally {
      setBusy(null);
      actionRef.current = false;
    }
  }, [base, busy, confirm, describeError, draft, isDirty, load, reason, t]);

  const handleEmergency = useCallback(async (enabled: boolean) => {
    if (!base || busy !== null || actionRef.current) return;
    actionRef.current = true;
    const accepted = await confirm({
      title: enabled
        ? t('admin.decor.confirm.emergencyOnTitle', 'Activer l’arrêt d’urgence ?')
        : t('admin.decor.confirm.emergencyOffTitle', 'Réactiver le système ?'),
      message: enabled
        ? t('admin.decor.confirm.emergencyOnMessage', 'Toutes les familles seront désactivées sur tous les workers. Aucune publication ne sera acceptée tant que l’urgence est active.')
        : t('admin.decor.confirm.emergencyOffMessage', 'La configuration enregistrée redeviendra effective après confirmation du serveur.'),
      confirmLabel: enabled
        ? t('admin.decor.action.emergencyOn', 'Arrêter')
        : t('admin.decor.action.emergencyOff', 'Réactiver'),
      destructive: enabled,
    });
    if (!accepted) {
      actionRef.current = false;
      return;
    }
    setBusy('emergency');
    try {
      const next = await setSeasonalThemeEmergency({
        enabled,
        reason: t('admin.decor.reason.emergency', 'Console Décoratif'),
        expectedRevision: base.revision,
      });
      setBase(next);
      setDraft((current) => (current ? { ...current, emergencyDisable: next.emergencyDisable } : current));
      toast.success(t('admin.decor.emergency.success', { defaultValue: 'État d’urgence mis à jour : révision {{revision}}', revision: next.revision }));
      await load({ preserveDraft: true });
    } catch (error) {
      toast.error(describeError(error).message);
      await load({ preserveDraft: true });
    } finally {
      setBusy(null);
      actionRef.current = false;
    }
  }, [base, busy, confirm, describeError, load, t]);

  const handleDisableDecoration = useCallback(async (decorationId: string) => {
    if (!base || busy !== null || actionRef.current) return;
    actionRef.current = true;
    const accepted = await confirm({
      title: t('admin.decor.confirm.disableTitle', 'Désactiver cette décoration ?'),
      message: t('admin.decor.confirm.disableMessage', 'Action immédiate et isolée : elle ne désactive pas l’arrêt d’urgence global.'),
      confirmLabel: t('admin.decor.action.disableDecoration', 'Désactiver la décoration'),
      destructive: true,
    });
    if (!accepted) {
      actionRef.current = false;
      return;
    }
    setBusy('disable');
    try {
      const next = await disableSeasonalThemeDecoration({
        decorationId,
        reason: t('admin.decor.reason.disable', 'Désactivation ciblée depuis la console'),
        expectedRevision: base.revision,
      });
      setBase(next);
      setDraft((current) => (current && sameSeasonalThemeConfig(current, draft) ? cloneSeasonalThemeConfig(next) : current));
      toast.success(t('admin.decor.disable.success', 'Décoration désactivée'));
      await load({ preserveDraft: true });
    } catch (error) {
      toast.error(describeError(error).message);
    } finally {
      setBusy(null);
      actionRef.current = false;
    }
  }, [base, busy, confirm, describeError, draft, load, t]);

  const handleInvalidate = useCallback(async () => {
    if (!base || busy !== null || actionRef.current) return;
    actionRef.current = true;
    const accepted = await confirm({
      title: t('admin.decor.confirm.invalidateTitle', 'Invalidater le cache ?'),
      message: t('admin.decor.confirm.invalidateMessage', 'Le cache sera réconcilié avec la source de vérité sans modifier la configuration.'),
      confirmLabel: t('admin.decor.action.invalidate', 'Invalidater'),
    });
    if (!accepted) {
      actionRef.current = false;
      return;
    }
    setBusy('invalidate');
    try {
      const result = await invalidateSeasonalThemeCache({
        reason: t('admin.decor.reason.invalidate', 'Invalidation depuis la console'),
        expectedRevision: base.revision,
      });
      toast.success(t('admin.decor.invalidate.success', { defaultValue: 'Cache réconcilié : révision {{revision}}', revision: result.revision }));
      await load({ preserveDraft: true });
    } catch (error) {
      toast.error(describeError(error).message);
    } finally {
      setBusy(null);
      actionRef.current = false;
    }
  }, [base, busy, confirm, describeError, load, t]);

  const addTheme = useCallback(() => {
    const available = SEASONAL_THEME_CATALOG.themes.find((item) => !draft?.themes.some((theme) => theme.id === item.id));
    if (!available) return;
    updateDraft((next) => {
      next.themes.push({
        id: available.id,
        enabled: false,
        priority: available.priority,
        platforms: allFlags(SEASONAL_THEME_PLATFORMS),
        capabilities: allFlags(SEASONAL_THEME_CAPABILITIES),
        windows: [],
        decorations: SEASONAL_THEME_CATALOG.decorations
          .filter((item) => item.themeId === available.id)
          .map(makeDecoration),
      });
    });
  }, [draft, updateDraft]);

  const addDecoration = useCallback((themeId: string) => {
    const theme = draft?.themes.find((item) => item.id === themeId);
    if (!theme) return;
    const available = SEASONAL_THEME_CATALOG.decorations.find((item) => item.themeId === themeId
      && !theme.decorations.some((decoration) => decoration.id === item.id));
    if (!available) return;
    updateDraft((next) => {
      next.themes.find((item) => item.id === themeId)?.decorations.push(makeDecoration(available));
    });
  }, [draft, updateDraft]);

  const addWindow = useCallback((themeId: string) => {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    updateDraft((next) => {
      const theme = next.themes.find((item) => item.id === themeId);
      if (theme && theme.windows.length < SEASONAL_THEME_CATALOG.limits.maxWindowsPerTheme) {
        theme.windows.push({ start, end, timezone });
      }
    });
  }, [updateDraft]);

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const focusedId = event.currentTarget.id.replace('admin-decor-tab-', '') as TabId;
    const index = TAB_IDS.indexOf(focusedId);
    if (index < 0) return;
    const next = TAB_IDS[(index + (event.key === 'ArrowRight' ? 1 : TAB_IDS.length - 1)) % TAB_IDS.length];
    setTab(next);
    document.getElementById(`admin-decor-tab-${next}`)?.focus();
  };

  const renderDashboard = () => {
    if (!summary || !status || !draft) return null;
    const syncLabel = summary.syncState === 'ok'
      ? t('admin.decor.sync.ok', 'Bus opérationnel')
      : summary.syncState === 'error'
        ? t('admin.decor.sync.error', 'Fail-closed actif')
        : t('admin.decor.sync.unknown', 'État non vérifiable');
    return (
      <div className="admin-decor-stack">
        <AdminPanel
          eyebrow={t('admin.decor.dashboard.eyebrow', 'État réel')}
          title={t('admin.decor.dashboard.title', 'Tableau de bord décoratif')}
          description={t('admin.decor.dashboard.description', 'Valeurs lues depuis les endpoints admin, sans donnée simulée.')}
          action={<Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={busy !== null}>
            <RefreshCw aria-hidden="true" /> {t('admin.decor.action.refresh', 'Actualiser')}
          </Button>}
        >
          <div className="admin-decor-stats">
            <AdminStatCard testId="admin-decor-stat-themes" label={t('admin.decor.dashboard.themesConfigured', 'Thèmes configurés')} value={String(summary.themesConfigured)} icon={Palette} />
            <AdminStatCard testId="admin-decor-stat-active" label={t('admin.decor.dashboard.themesActive', 'Thèmes actifs')} value={String(summary.themesActive)} icon={CheckCircle2} caption={`${summary.themesPublished} ${t('admin.decor.dashboard.published', 'publiés')}`} />
            <AdminStatCard testId="admin-decor-stat-decorations" label={t('admin.decor.dashboard.decorations', 'Décorations activées')} value={String(summary.decorationsEnabled)} icon={Sparkles} />
            <AdminStatCard testId="admin-decor-stat-revision" label={t('admin.decor.dashboard.revision', 'Révision')} value={String(summary.revision)} icon={Save} caption={dateLabel(summary.lastPublication)} />
          </div>
          <div className="admin-decor-services">
            <AdminServiceRow label={t('admin.decor.status.channel', 'Canal de publication')} detail={status.channel} healthy={status.subscribed} />
            <AdminServiceRow label={t('admin.decor.status.failClosed', 'Lecture fail-closed')} detail={status.failClosed ? t('admin.decor.status.on', 'Activée') : t('admin.decor.status.off', 'Désactivée')} healthy={!status.failClosed} />
            <AdminServiceRow label={t('admin.decor.status.localRevision', 'Révision locale')} detail={String(status.localRevision)} healthy={status.localRevision === draft.revision} />
          </div>
          <div className="admin-decor-notice">
            <AdminStateBlock
              tone={summary.emergency ? 'error' : 'success'}
              title={summary.emergency
                ? t('admin.decor.emergency.active', 'Arrêt d’urgence actif')
                : t('admin.decor.emergency.inactive', 'Arrêt d’urgence inactif')}
              description={t('admin.decor.status.syncHint', 'Le canal signale l’abonnement du worker courant ; la synchronisation de chaque worker n’est pas mesurée par cette API.')}
            />
            <p className="admin-decor-sync-label" data-state={summary.syncState}>{syncLabel}</p>
          </div>
        </AdminPanel>

        <AdminPanel
          eyebrow={t('admin.decor.dashboard.scheduleEyebrow', 'Calendrier')}
          title={t('admin.decor.dashboard.upcoming', 'Prochaines programmations')}
          description={t('admin.decor.dashboard.timezoneHint', 'Le contrat backend stocke des dates calendaires et un fuseau explicite, pas d’heure locale implicite.')}
        >
          {summary.upcomingWindows.length === 0 ? (
            <AdminStateBlock tone="empty" title={t('admin.decor.empty.windows', 'Aucune programmation à venir')} />
          ) : (
            <ul className="admin-decor-list">
              {summary.upcomingWindows.slice(0, 8).map((window) => (
                <li key={`${window.themeId}-${window.start}-${window.end}-${window.timezone}`}>
                  <span className="admin-decor-chip-static">{window.themeId}</span>
                  <span>{window.start} → {window.end}</span>
                  <span className="admin-decor-muted">{window.timezone}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>

        <AdminPanel
          eyebrow={t('admin.decor.emergency.eyebrow', 'Sécurité')}
          title={t('admin.decor.emergency.title', 'Arrêt d’urgence global')}
          description={t('admin.decor.emergency.description', 'Commande distincte de la désactivation d’un thème : elle désactive toutes les familles et bloque les publications.')}
        >
          <AdminStateBlock
            tone={draft.emergencyDisable ? 'warning' : 'info'}
            title={t('admin.decor.emergency.consequences', 'Conséquences')}
            description={t('admin.decor.emergency.consequencesDetail', 'Toutes les décorations sont désactivées sur tous les workers ; une publication est refusée tant que l’urgence reste active.')}
          />
          <div className="admin-decor-actions">
            <Button type="button" variant="destructive" onClick={() => void handleEmergency(true)} disabled={busy !== null || draft.emergencyDisable}>
              <ShieldAlert aria-hidden="true" /> {t('admin.decor.action.emergencyOn', 'Arrêter toutes les décorations')}
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleEmergency(false)} disabled={busy !== null || !draft.emergencyDisable}>
              <RefreshCw aria-hidden="true" /> {t('admin.decor.action.emergencyOff', 'Réactiver')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void handleInvalidate()} disabled={busy !== null}>
              {t('admin.decor.action.invalidate', 'Invalidater le cache')}
            </Button>
          </div>
        </AdminPanel>
      </div>
    );
  };

  const renderThemes = () => {
    if (!draft) return null;
    return (
      <div className="admin-decor-stack">
        <AdminPanel
          eyebrow={t('admin.decor.themes.eyebrow', 'Catalogue fermé')}
          title={t('admin.decor.themes.title', 'Thèmes et décorations')}
          description={t('admin.decor.themes.description', 'Le backend n’accepte que les identifiants du catalogue : création et renommage libres indisponibles. Plusieurs thèmes peuvent coexister.')}
          action={<Button type="button" variant="outline" size="sm" onClick={addTheme} disabled={busy !== null || SEASONAL_THEME_CATALOG.themes.every((item) => draft.themes.some((theme) => theme.id === item.id))}>
            <Palette aria-hidden="true" /> {t('admin.decor.action.addTheme', 'Ajouter un thème du catalogue')}
          </Button>}
        >
          {draft.themes.length === 0 && <AdminStateBlock tone="empty" title={t('admin.decor.empty.themes', 'Aucun thème dans le brouillon')} />}
          {draft.themes.map((theme) => {
            const availableDecoration = SEASONAL_THEME_CATALOG.decorations.some((item) => item.themeId === theme.id
              && !theme.decorations.some((decoration) => decoration.id === item.id));
            return (
              <SettingsSection
                key={theme.id}
                id={`admin-decor-theme-${theme.id}`}
                icon={Palette}
                title={theme.id}
                description={t('admin.decor.themes.sectionDescription', { defaultValue: '{{count}} décoration(s) configurée(s)', count: theme.decorations.length })}
                className="admin-decor-theme"
              >
                <ToggleRow
                  id={`theme-enabled-${theme.id}`}
                  label={t('admin.decor.field.enabled', 'Activé')}
                  description={t('admin.decor.themes.enableHint', 'Un thème désactivé n’est jamais sélectionné par le résolveur.')}
                  checked={theme.enabled}
                  onCheckedChange={(enabled) => updateTheme(theme.id, { enabled })}
                />
                <div className="admin-decor-fields">
                  <SettingsField id={`theme-priority-${theme.id}`} label={t('admin.decor.field.priority', 'Priorité')}>
                    <Input
                      id={`theme-priority-${theme.id}`}
                      className="admin-decor-control"
                      type="number"
                      min={SEASONAL_THEME_CATALOG.limits.priorityMin}
                      max={SEASONAL_THEME_CATALOG.limits.priorityMax}
                      value={theme.priority}
                      onChange={(event) => updateTheme(theme.id, { priority: Number(event.target.value) })}
                    />
                  </SettingsField>
                  <FlagCheckboxes
                    id={`theme-platform-${theme.id}`}
                    label={t('admin.decor.field.platforms', 'Plateformes')}
                    values={theme.platforms}
                    allowed={SEASONAL_THEME_PLATFORMS}
                    labels={PLATFORM_LABELS}
                    onChange={(platforms) => updateTheme(theme.id, { platforms })}
                  />
                  <FlagCheckboxes
                    id={`theme-capability-${theme.id}`}
                    label={t('admin.decor.field.capabilities', 'Capacités')}
                    values={theme.capabilities}
                    allowed={SEASONAL_THEME_CAPABILITIES}
                    labels={CAPABILITY_LABELS}
                    onChange={(capabilities) => updateTheme(theme.id, { capabilities })}
                  />
                </div>
                <div className="admin-decor-subhead">
                  <p>{t('admin.decor.themes.decorations', 'Décorations')}</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addDecoration(theme.id)} disabled={!availableDecoration}>
                    {t('admin.decor.action.addDecoration', 'Ajouter une décoration du catalogue')}
                  </Button>
                </div>
                {theme.decorations.length === 0 && (
                  <AdminStateBlock tone="empty" title={t('admin.decor.empty.decorations', 'Aucune décoration')} />
                )}
                {theme.decorations.map((decoration) => (
                  <DecorationEditor
                    key={decoration.id}
                    decoration={decoration}
                    onChange={(fields) => updateDecoration(theme.id, decoration.id, fields)}
                    onDisable={() => void handleDisableDecoration(decoration.id)}
                  />
                ))}
              </SettingsSection>
            );
          })}
        </AdminPanel>
      </div>
    );
  };

  const renderSchedule = () => {
    if (!draft) return null;
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const timezones = typeof supportedValuesOf === 'function'
      ? supportedValuesOf.call(Intl, 'timeZone').slice(0, 40)
      : FALLBACK_TIMEZONES;
    return (
      <div className="admin-decor-stack">
        <datalist id="admin-decor-timezones">
          {timezones.map((zone) => <option key={zone} value={zone} />)}
        </datalist>
        <AdminPanel
          eyebrow={t('admin.decor.schedule.eyebrow', 'Programmation')}
          title={t('admin.decor.schedule.title', 'Fenêtres avec fuseau explicite')}
          description={t('admin.decor.schedule.description', 'Le backend valide AAAA-MM-JJ et un fuseau IANA. Aucune date locale n’est interprétée sans fuseau.')}
        >
          {draft.themes.map((theme) => (
            <div key={theme.id} className="admin-decor-window-theme">
              <div className="admin-decor-subhead">
                <p>{theme.id}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => addWindow(theme.id)} disabled={theme.windows.length >= SEASONAL_THEME_CATALOG.limits.maxWindowsPerTheme}>
                  {t('admin.decor.action.addWindow', 'Ajouter une fenêtre')}
                </Button>
              </div>
              {theme.windows.length === 0 && <p className="admin-decor-muted">{t('admin.decor.empty.windowsTheme', 'Aucune fenêtre : le thème reste actif en continu lorsqu’il est activé.')}</p>}
              {theme.windows.map((window, index) => (
                <div key={`${theme.id}-${index}`} className="admin-decor-window-row">
                  <SettingsField id={`window-start-${theme.id}-${index}`} label={t('admin.decor.field.start', 'Début (AAAA-MM-JJ)')}>
                    <Input
                      id={`window-start-${theme.id}-${index}`}
                      className="admin-decor-control"
                      type="date"
                      value={window.start}
                      onChange={(event) => updateTheme(theme.id, { windows: theme.windows.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })}
                    />
                  </SettingsField>
                  <SettingsField id={`window-end-${theme.id}-${index}`} label={t('admin.decor.field.end', 'Fin (AAAA-MM-JJ)')}>
                    <Input
                      id={`window-end-${theme.id}-${index}`}
                      className="admin-decor-control"
                      type="date"
                      value={window.end}
                      onChange={(event) => updateTheme(theme.id, { windows: theme.windows.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })}
                    />
                  </SettingsField>
                  <SettingsField id={`window-tz-${theme.id}-${index}`} label={t('admin.decor.field.timezone', 'Fuseau horaire')}>
                    <Input
                      id={`window-tz-${theme.id}-${index}`}
                      className="admin-decor-control"
                      list="admin-decor-timezones"
                      value={window.timezone}
                      onChange={(event) => updateTheme(theme.id, { windows: theme.windows.map((item, i) => i === index ? { ...item, timezone: event.target.value } : item) })}
                    />
                  </SettingsField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('admin.decor.action.removeWindow', 'Retirer la fenêtre')}
                    onClick={() => updateTheme(theme.id, { windows: theme.windows.filter((_, i) => i !== index) })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </AdminPanel>
      </div>
    );
  };

  const renderPublish = () => {
    if (!draft || !base) return null;
    return (
      <div className="admin-decor-stack">
        <AdminPanel
          eyebrow={t('admin.decor.publish.eyebrow', 'Publication contrôlée')}
          title={t('admin.decor.publish.title', 'Changements et confirmation')}
          description={t('admin.decor.publish.description', 'Le patch est comparé à la révision chargée. Rien n’est envoyé avant votre confirmation explicite.')}
        >
          <div className="admin-decor-publish-meta">
            <span>{t('admin.decor.publish.loadedRevision', 'Révision chargée')} : <strong>{base.revision}</strong></span>
            <span>{t('admin.decor.publish.draftRevision', 'Révision locale')} : <strong>{draft.revision}</strong></span>
            <span data-state={isDirty ? 'draft' : 'published'} className="admin-decor-state-pill">
              {isDirty ? t('admin.decor.state.draft', 'Brouillon') : t('admin.decor.state.published', 'Publié')}
            </span>
          </div>
          {conflict && (
            <AdminStateBlock
              tone="warning"
              title={t('admin.decor.conflict.title', 'Conflit de révision détecté')}
              description={t('admin.decor.conflict.description', { defaultValue: 'La révision distante est {{revision}}. Vos modifications ont été conservées et fusionnées ; relisez le patch avant une nouvelle publication.', revision: conflict.remote.revision })}
            />
          )}
          <SettingsField id="admin-decor-reason" label={t('admin.decor.field.reason', 'Motif de publication')}>
            <Textarea
              id="admin-decor-reason"
              className="admin-decor-control"
              rows={2}
              value={reason}
              placeholder={t('admin.decor.field.reasonPlaceholder', 'Ex. : campagne de saison')}
              onChange={(event) => setReason(event.target.value)}
            />
          </SettingsField>
          <div className="admin-decor-diff">
            <p className="admin-decor-subhead-title">{t('admin.decor.publish.changes', 'Patch envoyé')}</p>
            {isDirty ? (
              <pre data-testid="admin-decor-patch" aria-label={t('admin.decor.publish.changes', 'Patch envoyé')}>{JSON.stringify(patch, null, 2)}</pre>
            ) : (
              <AdminStateBlock tone="empty" title={t('admin.decor.publish.noChanges', 'Aucune modification locale')} />
            )}
          </div>
          <div className="admin-decor-validations">
            <p className="admin-decor-subhead-title">{t('admin.decor.publish.validation', 'Validation')}</p>
            {issues.length === 0 ? (
              <AdminStateBlock tone="success" title={t('admin.decor.publish.valid', 'Configuration valide')} />
            ) : (
              <ul>
                {issues.slice(0, 12).map((entry, index) => (
                  <li key={`${entry.path}-${index}`}><code>{entry.code}</code> {entry.path}</li>
                ))}
              </ul>
            )}
          </div>
          {loadError && (
            <AdminStateBlock
              tone="error"
              title={t('admin.decor.loadError', 'Chargement impossible')}
              description={loadError.message}
              action={<Button type="button" variant="outline" size="sm" onClick={() => void load()}>{t('admin.decor.action.retry', 'Réessayer')}</Button>}
            />
          )}
          <div className="admin-decor-actions">
            <Button
              type="button"
              data-testid="admin-decor-publish"
              onClick={() => void handlePublish()}
              disabled={busy !== null || !isDirty || issues.length > 0}
            >
              <Save aria-hidden="true" /> {busy === 'publish'
                ? t('admin.decor.action.publishing', 'Publication…')
                : t('admin.decor.action.publish', 'Publier la révision')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void load({ preserveDraft: false })}
              disabled={busy !== null}
            >
              <RefreshCw aria-hidden="true" /> {t('admin.decor.action.reload', 'Recharger la configuration distante')}
            </Button>
          </div>
        </AdminPanel>
      </div>
    );
  };

  const renderPagination = (page: number, total: number, setPage: (next: number) => void) => {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return (
      <div className="admin-decor-pagination">
        <Button type="button" variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          {t('admin.decor.action.previous', 'Précédent')}
        </Button>
        <span>{t('admin.decor.pagination.page', { defaultValue: 'Page {{current}} / {{total}}', current: page + 1, total: pages })}</span>
        <Button type="button" variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          {t('admin.decor.action.next', 'Suivant')}
        </Button>
      </div>
    );
  };

  const renderHistory = () => {
    const historyRows = history.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);
    const auditRows = audit.slice(auditPage * PAGE_SIZE, (auditPage + 1) * PAGE_SIZE);
    return (
      <div className="admin-decor-stack">
        <AdminPanel
          eyebrow={t('admin.decor.history.eyebrow', 'Traçabilité')}
          title={t('admin.decor.history.title', 'Historique des publications')}
          description={t('admin.decor.history.description', 'Snapshots append-only renvoyés par la Main API. Aucune restauration n’est exposée par le backend.')}
        >
          {historyRows.length === 0 ? (
            <AdminStateBlock tone="empty" title={t('admin.decor.empty.history', 'Aucune publication enregistrée')} />
          ) : (
            <div className="admin-decor-table-wrap">
              <table className="admin-decor-table">
                <thead><tr>
                  <th>{t('admin.decor.field.date', 'Date')}</th>
                  <th>{t('admin.decor.field.revision', 'Révision')}</th>
                  <th>{t('admin.decor.field.admin', 'Administrateur')}</th>
                  <th>{t('admin.decor.field.reason', 'Motif')}</th>
                </tr></thead>
                <tbody>
                  {historyRows.map((entry) => (
                    <tr key={entry.id}>
                      <td>{dateLabel(entry.changedAt)}</td>
                      <td>{entry.config.revision}</td>
                      <td>{entry.changedBy || '—'}</td>
                      <td>{entry.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {renderPagination(historyPage, history.length, setHistoryPage)}
        </AdminPanel>

        <AdminPanel
          eyebrow={t('admin.decor.audit.eyebrow', 'Journal')}
          title={t('admin.decor.audit.title', 'Actions d’audit')}
          description={t('admin.decor.audit.description', 'Détails fournis par le serveur, sans information interne supplémentaire.')}
        >
          {auditRows.length === 0 ? (
            <AdminStateBlock tone="empty" title={t('admin.decor.empty.audit', 'Aucune action journalisée')} />
          ) : (
            <div className="admin-decor-table-wrap">
              <table className="admin-decor-table">
                <thead><tr>
                  <th>{t('admin.decor.field.date', 'Date')}</th>
                  <th>{t('admin.decor.field.action', 'Action')}</th>
                  <th>{t('admin.decor.field.admin', 'Administrateur')}</th>
                  <th>{t('admin.decor.field.target', 'Cible')}</th>
                  <th>{t('admin.decor.field.details', 'Détails')}</th>
                </tr></thead>
                <tbody>
                  {auditRows.map((entry) => (
                    <tr key={entry.id}>
                      <td>{dateLabel(entry.createdAt)}</td>
                      <td>{entry.action}</td>
                      <td>{entry.adminId || '—'}</td>
                      <td>{entry.target || '—'}</td>
                      <td><code>{JSON.stringify(entry.details)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {renderPagination(auditPage, audit.length, setAuditPage)}
        </AdminPanel>
      </div>
    );
  };

  const renderPreview = () => {
    if (!preview) return null;
    return (
      <div className="admin-decor-stack">
        <AdminPanel
          eyebrow={t('admin.decor.preview.eyebrow', 'Aperçu isolé')}
          title={t('admin.decor.preview.title', 'Prévisualisation structurelle')}
          description={t('admin.decor.preview.description', 'Contenu neutre et brouillon local. Aucune publication, aucun effet appliqué aux pages publiques. Les moteurs graphiques du LOT 4 ne sont pas disponibles.')}
        >
          <AdminStateBlock tone="info" title={t('admin.decor.preview.notice', 'Aperçu administratif — non public')} description={t('admin.decor.preview.noticeDetail', 'Les paramètres ci-dessous décrivent la configuration que vous allez publier ; ils ne représentent pas un rendu visuel réel.')} />
          <div className="admin-decor-fields">
            <SettingsField id="preview-platform" label={t('admin.decor.field.platform', 'Plateforme')}>
              <select
                id="preview-platform"
                className="admin-decor-control"
                value={previewContext.platform}
                onChange={(event) => setPreviewContext((current) => ({ ...current, platform: event.target.value }))}
              >
                {SEASONAL_THEME_PLATFORMS.map((platform) => {
                  const meta = PLATFORM_LABELS[platform];
                  return <option key={platform} value={platform}>{t(meta.key, meta.fallback)}</option>;
                })}
              </select>
            </SettingsField>
            <SettingsField id="preview-at" label={t('admin.decor.field.at', 'Date de référence (ISO)')}>
              <Input
                id="preview-at"
                className="admin-decor-control"
                value={previewContext.at}
                onChange={(event) => setPreviewContext((current) => ({ ...current, at: event.target.value }))}
              />
            </SettingsField>
            <FlagCheckboxes
              id="preview-capabilities"
              label={t('admin.decor.field.capabilities', 'Capacités')}
              values={Object.fromEntries(previewContext.capabilities.map((item) => [item, true]))}
              allowed={SEASONAL_THEME_CAPABILITIES}
              labels={CAPABILITY_LABELS}
              onChange={(next) => setPreviewContext((current) => ({
                ...current,
                capabilities: Object.entries(next).filter(([, enabled]) => enabled).map(([key]) => key),
              }))}
            />
          </div>
          <div className="admin-decor-preview-sample">
            <p className="admin-decor-preview-kicker">{t('admin.decor.preview.sample', 'Contenu neutre')}</p>
            <p>{preview.sample}</p>
            <span className="admin-decor-state-pill" data-state="draft">{t('admin.decor.preview.draftBadge', 'Brouillon — non publié')}</span>
          </div>
          <pre className="admin-decor-preview-json" aria-label={t('admin.decor.preview.parameters', 'Paramètres configurés')}>
            {JSON.stringify({ platform: preview.platform, capabilities: preview.capabilities, at: preview.at, themes: preview.themes, typography: preview.typography }, null, 2)}
          </pre>
        </AdminPanel>
      </div>
    );
  };

  return (
    <div className="admin-decor-root" data-testid="admin-decor">
      <div className="admin-decor-header">
        <div>
          <p className="admin-panel-eyebrow">{t('admin.decor.header.eyebrow', 'Console Décoratif')}</p>
          <h2 className="admin-panel-title">{t('admin.decor.header.title', 'Système décoratif global')}</h2>
          <p className="admin-panel-description">{t('admin.decor.header.description', 'Créer, programmer, prévisualiser et publier les thèmes et décorations sans redéploiement.')}</p>
        </div>
        <span className="admin-decor-fingerprint" aria-label={t('admin.decor.field.fingerprint', 'Empreinte du brouillon')}>
          {t('admin.decor.field.fingerprintShort', 'Empreinte')} {seasonalThemeFingerprint(draft ?? {}).slice(0, 12)}…
        </span>
      </div>

      <div className="admin-decor-tabs" role="tablist" aria-label={t('admin.decor.tab.list', 'Sections décoratives')}>
        {TAB_IDS.map((id) => {
          const meta = TAB_LABELS[id];
          return (
            <button
              key={id}
              id={`admin-decor-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`admin-decor-panel-${id}`}
              className="admin-decor-tab"
              data-active={tab === id}
              onClick={() => setTab(id)}
              onKeyDown={onTabKeyDown}
            >
              {t(meta.key, meta.fallback)}
            </button>
          );
        })}
      </div>

      {loadState === 'loading' && (
        <div className="space-y-4" aria-busy="true" data-testid="admin-decor-loading">
          <span className="sr-only" role="status">{t('admin.decor.loading', 'Chargement de la configuration…')}</span>
          <Skeleton variant="button" height={56} count={4} />
        </div>
      )}
      {loadState === 'error' && (
        <AdminPanel title={t('admin.decor.loadError', 'Chargement impossible')}>
          <AdminStateBlock
            tone="error"
            title={loadError?.message || t('admin.decor.loadError', 'Chargement impossible')}
            description={t('admin.decor.loadErrorDetail', 'Les permissions et l’état du serveur restent définis par la Main API.')}
            action={<Button type="button" variant="outline" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" /> {t('admin.decor.action.retry', 'Réessayer')}
            </Button>}
          />
        </AdminPanel>
      )}
      {loadState === 'ready' && (
        <div id={`admin-decor-panel-${tab}`} role="tabpanel" aria-labelledby={`admin-decor-tab-${tab}`}>
          {tab === 'dashboard' && renderDashboard()}
          {tab === 'themes' && renderThemes()}
          {tab === 'schedule' && renderSchedule()}
          {tab === 'publish' && renderPublish()}
          {tab === 'history' && renderHistory()}
          {tab === 'preview' && renderPreview()}
        </div>
      )}

    </div>
  );
};

export default AdminDecor;
