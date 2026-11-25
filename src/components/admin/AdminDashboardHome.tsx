import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Clock,
  MessageSquare,
  RefreshCw,
  Sparkles,
  UserPlus,
  Users,
} from '../icons/Icons8';
import { fetchStatsOverview } from '../../services/adminStatsService';
import type { StatsOverview, StatsRange } from '../../services/adminStatsService';
import type { AdminRole, AdminSectionMeta } from './adminRegistry';
import { getRoleLabel } from './adminRegistry';
import {
  AdminBarRow,
  AdminMiniChart,
  AdminPanel,
  AdminServiceRow,
  AdminStateBlock,
  AdminStatCard,
} from './AdminUi';

type LoadState = 'loading' | 'ready' | 'error';

const RANGES: StatsRange[] = [7, 30, 90];
const numberFormatter = new Intl.NumberFormat('fr-FR');

const sumPoints = (points: StatsOverview['registrationsPerDay']): number => (
  points.reduce((total, point) => total + point.count, 0)
);

const AdminDashboardHome: React.FC<{
  role: AdminRole;
  visibleSections: AdminSectionMeta[];
  onNavigate: (id: AdminSectionMeta['id']) => void;
}> = ({ role, visibleSections, onNavigate }) => {
  const { t } = useTranslation();
  const [range, setRange] = useState<StatsRange>(30);
  const [data, setData] = useState<StatsOverview | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextRange: StatsRange) => {
    setState('loading');
    setError(null);
    try {
      setData(await fetchStatsOverview(nextRange));
      setState('ready');
    } catch {
      setError(t('admin.stats.loadError', 'Erreur de chargement des statistiques'));
      setState('error');
    }
  }, [t]);

  useEffect(() => {
    let active = true;
    setState('loading');
    setError(null);
    fetchStatsOverview(range)
      .then((payload) => {
        if (active) {
          setData(payload);
          setState('ready');
        }
      })
      .catch(() => {
        if (active) {
          setError(t('admin.stats.loadError', 'Erreur de chargement des statistiques'));
          setState('error');
        }
      });
    return () => { active = false; };
  }, [range, t]);

  const providers = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.totals.byProvider)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [data]);
  const providerMax = providers.reduce((max, provider) => Math.max(max, provider.value), 0);

  const registrationTrend = useMemo(() => {
    if (!data) return null;
    const series = data.registrationsPerDay;
    if (series.length < 14) return null;
    const recent = sumPoints(series.slice(-7));
    const previous = sumPoints(series.slice(-14, -7));
    if (previous === 0) return null;
    return Math.round(((recent - previous) / previous) * 100);
  }, [data]);

  const alerts = useMemo(() => {
    const items: Array<{ id: string; tone: 'error' | 'info'; text: string }> = [];
    if (error) items.push({ id: 'stats', tone: 'error', text: error });
    if (role !== 'admin') {
      items.push({
        id: 'scope',
        tone: 'info',
        text: t('admin.console.limitedAccess', 'Votre rôle limite les sections accessibles.'),
      });
    }
    return items;
  }, [error, role, t]);

  const quickActions = visibleSections.filter((section) => section.id !== 'overview').slice(0, 4);
  const generatedAt = data
    ? new Date(data.generatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const kpis = [
    {
      id: 'users',
      label: t('admin.stats.totalUsers', 'Utilisateurs'),
      value: data?.totals.users ?? 0,
      icon: Users,
      caption: t('admin.console.allTime', 'Depuis le début'),
    },
    {
      id: 'registrations',
      label: t('admin.stats.registrations', 'Inscriptions'),
      value: data?.totals.registrationsInRange ?? 0,
      icon: UserPlus,
      caption: t('admin.stats.lastDays', { count: range, defaultValue: `${range} jours` }),
    },
    {
      id: 'logins',
      label: t('admin.stats.logins', 'Connexions'),
      value: data?.totals.sessionsInRange ?? 0,
      icon: Activity,
      caption: t('admin.stats.lastDays', { count: range, defaultValue: `${range} jours` }),
    },
    {
      id: 'dau',
      label: t('admin.stats.avgDau', 'DAU moyen'),
      value: data?.totals.avgDau ?? 0,
      icon: BarChart3,
      caption: t('admin.console.dailyAverage', 'Moyenne quotidienne'),
    },
    {
      id: 'comments',
      label: t('admin.stats.comments', 'Commentaires'),
      value: data?.totals.commentsInRange ?? 0,
      icon: MessageSquare,
      caption: t('admin.stats.lastDays', { count: range, defaultValue: `${range} jours` }),
    },
    {
      id: 'vip',
      label: t('admin.stats.vip', 'VIP'),
      value: data?.totals.vipInRange ?? 0,
      icon: Sparkles,
      caption: t('admin.console.deliveredDonations', 'Dons livrés'),
    },
  ];

  return (
    <div className="space-y-5" data-testid="admin-overview" data-generated-at={data?.generatedAt ?? ''}>
      <AdminPanel
        eyebrow={t('admin.console.liveData', 'Données live')}
        title={t('admin.console.activityTitle', 'Activité récente')}
        description={generatedAt
          ? `${t('admin.console.generatedAt', 'Généré le')} ${generatedAt}`
          : t('admin.console.waitingData', 'En attente des données serveur')}
        action={(
          <>
            <div className="admin-range" role="group" aria-label={t('admin.console.period', 'Période')}>
              {RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`admin-range-button ${range === value ? 'is-active' : ''}`}
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                >
                  {t('admin.stats.lastDays', { count: value, defaultValue: `${value} jours` })}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="admin-icon-button"
              onClick={() => load(range)}
              disabled={state === 'loading'}
              aria-label={t('admin.stats.refresh', 'Actualiser')}
              title={t('admin.stats.refresh', 'Actualiser')}
            >
              <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </>
        )}
      >
        {state === 'error' && (
          <AdminStateBlock
            tone="error"
            title={error ?? t('admin.stats.loadError', 'Erreur de chargement des statistiques')}
            description={t('admin.console.statsUnavailable', 'Les chiffres ci-dessous ne sont pas affichés tant que la source est indisponible.')}
            action={(
              <button type="button" className="admin-text-button" onClick={() => load(range)}>
                {t('common.retry', 'Réessayer')}
              </button>
            )}
          />
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((item) => (
            <AdminStatCard
              key={item.label}
              label={item.label}
              value={!data ? '—' : numberFormatter.format(item.value)}
              icon={item.icon}
              caption={item.caption}
              testId={`admin-stat-${item.id}`}
            />
          ))}
        </div>

        {data && (
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <AdminMiniChart
              title={t('admin.stats.registrationsPerDay', 'Inscriptions par jour')}
              points={data.registrationsPerDay}
              emptyLabel={t('admin.console.noActivity', 'Aucune activité sur la période')}
            />
            <AdminMiniChart
              title={t('admin.stats.engagement', 'Commentaires par jour')}
              points={data.commentsPerDay}
              emptyLabel={t('admin.console.noActivity', 'Aucune activité sur la période')}
            />
          </div>
        )}

        {data && registrationTrend !== null && (
          <p className="mt-4 text-xs text-white/45">
            <span className="font-semibold text-white/75">
              {registrationTrend > 0 ? '+' : ''}{registrationTrend}%
            </span>
            {' '}
            {t('admin.console.registrationTrend', 'inscriptions sur les 7 derniers jours vs 7 précédents')}
          </p>
        )}
      </AdminPanel>

      <div className="grid gap-5 xl:grid-cols-3">
        <AdminPanel
          eyebrow={t('admin.console.usersEyebrow', 'Utilisateurs')}
          title={t('admin.stats.providerSplit', 'Répartition par fournisseur')}
        >
          {state === 'loading' && !data ? (
            <AdminStateBlock tone="loading" title={t('admin.console.loading', 'Chargement…')} />
          ) : providers.length === 0 ? (
            <AdminStateBlock
              tone="empty"
              title={t('admin.console.noProviderData', 'Aucune répartition disponible')}
            />
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <AdminBarRow
                  key={provider.name}
                  label={provider.name}
                  value={provider.value}
                  max={providerMax}
                />
              ))}
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          eyebrow={t('admin.console.healthEyebrow', 'Disponibilité')}
          title={t('admin.console.servicesTitle', 'État des services')}
        >
          <AdminServiceRow
            label={t('admin.console.authService', 'Contrôle des droits admin')}
            detail={t('admin.console.authServiceDetail', 'Vérifié à l’ouverture du panneau')}
            healthy
          />
          <AdminServiceRow
            label={t('admin.console.statsService', 'Source de statistiques')}
            detail={generatedAt
              ? `${t('admin.console.generatedAt', 'Généré le')} ${generatedAt}`
              : t('admin.console.waitingData', 'En attente des données serveur')}
            healthy={state !== 'error'}
            pending={state === 'loading'}
          />
          <p className="mt-4 text-[11px] leading-4 text-white/35">
            {t('admin.console.healthNote', 'Statut déduit des réponses réelles des endpoints admin.')}
          </p>
        </AdminPanel>

        <AdminPanel
          eyebrow={t('admin.console.sessionEyebrow', 'Session')}
          title={t('admin.console.alertsTitle', 'Alertes')}
          description={t('admin.console.alertsDesc', 'Uniquement les situations détectées.')}
        >
          {alerts.length === 0 ? (
            <AdminStateBlock
              tone="empty"
              title={t('admin.console.noAlerts', 'Aucune alerte détectée')}
              description={t('admin.console.noAlertsDesc', 'Les services répondent normalement.')}
            />
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <AdminStateBlock
                  key={alert.id}
                  tone={alert.tone}
                  title={alert.tone === 'error'
                    ? t('admin.console.statsDown', 'Statistiques indisponibles')
                    : t('admin.console.limitedAccessTitle', 'Accès restreint')}
                  description={alert.text}
                />
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-white/[0.06] pt-4 text-xs text-white/45">
            <span className="font-semibold text-white/70">{getRoleLabel(t, role)}</span>
            {' · '}
            {t('admin.console.sessionRole', 'rôle actif')}
          </div>
        </AdminPanel>
      </div>

      {quickActions.length > 0 && (
        <AdminPanel
          eyebrow={t('admin.console.shortcutsEyebrow', 'Navigation')}
          title={t('admin.console.shortcutsTitle', 'Accès rapides')}
          description={t('admin.console.shortcutsDesc', 'Ouvrir directement une section autorisée.')}
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onNavigate(section.id)}
                  className="admin-quick-action group"
                >
                  <Icon className="h-4 w-4 shrink-0 text-white/55" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-white/80">
                    {section.title}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </AdminPanel>
      )}

      {state === 'error' && (
        <p className="sr-only" aria-live="polite">
          <AlertTriangle aria-hidden="true" />
          {' '}{error}
        </p>
      )}
      {state === 'ready' && (
        <p className="sr-only" aria-live="polite">
          <Clock aria-hidden="true" />
          {' '}{t('admin.console.statsUpdated', 'Statistiques à jour')}
        </p>
      )}
    </div>
  );
};

export default AdminDashboardHome;
