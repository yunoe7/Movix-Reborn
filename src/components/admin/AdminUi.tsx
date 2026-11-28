import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  XCircle,
} from '../icons/Icons8';
import type { StatPoint } from '../../services/adminStatsService';

export type AdminTone = 'loading' | 'empty' | 'error' | 'success' | 'info' | 'warning';

export const AdminPanel: React.FC<{
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ eyebrow, title, description, action, className = '', children }) => (
  <section className={`admin-panel ${className}`}>
    {(eyebrow || action || description) && (
      <header className="admin-panel-head">
        <div className="min-w-0">
          {eyebrow && <p className="admin-panel-eyebrow">{eyebrow}</p>}
          <h2 className="admin-panel-title">{title}</h2>
          {description && <p className="admin-panel-description">{description}</p>}
        </div>
        {action && <div className="admin-panel-action">{action}</div>}
      </header>
    )}
    <div className="admin-panel-body">{children}</div>
  </section>
);

export const AdminStatCard: React.FC<{
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  caption?: string;
  testId?: string;
}> = ({ label, value, icon: Icon, caption, testId }) => (
  <div data-testid={testId} className="admin-stat">
    <div className="admin-stat-top">
      <p className="admin-stat-label">{label}</p>
      <span className="admin-stat-icon"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
    </div>
    <p className="admin-stat-value">{value}</p>
    {caption && <p className="admin-stat-caption">{caption}</p>}
  </div>
);

export const AdminMiniChart: React.FC<{
  title: string;
  points: StatPoint[];
  emptyLabel: string;
}> = ({ title, points, emptyLabel }) => {
  const max = points.reduce((highest, point) => Math.max(highest, point.count), 0);

  return (
    <div className="min-w-0">
      <p className="admin-chart-title">{title}</p>
      {points.length === 0 || max === 0 ? (
        <div className="admin-chart-empty">{emptyLabel}</div>
      ) : (
        <div className="admin-chart">
          <div className="admin-chart-bars" role="img" aria-label={title}>
            {points.map((point) => (
              <div
                key={point.date}
                className="admin-chart-bar"
                style={{ height: `${Math.max(4, Math.round((point.count / max) * 100))}%` }}
                title={`${point.date} · ${point.count}`}
              />
            ))}
          </div>
          <div className="admin-chart-axis">
            <span>{points[0]?.date}</span>
            <span>{points[points.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const STATE_ICONS: Record<AdminTone, React.ReactNode> = {
  error: <XCircle className="h-4 w-4" aria-hidden="true" />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
  info: <Info className="h-4 w-4" aria-hidden="true" />,
  loading: <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />,
  empty: <Clock className="h-4 w-4" aria-hidden="true" />,
};

export const AdminStateBlock: React.FC<{
  tone: AdminTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ tone, title, description, action }) => (
  <div className={`admin-state admin-state--${tone}`} data-state={tone}>
    <span className="admin-state-icon">{STATE_ICONS[tone]}</span>
    <div className="min-w-0 flex-1">
      <p className="admin-state-title">{title}</p>
      {description && <p className="admin-state-description">{description}</p>}
    </div>
    {action && <div className="admin-state-action">{action}</div>}
  </div>
);

export const AdminServiceRow: React.FC<{
  label: string;
  detail: string;
  healthy: boolean;
  pending?: boolean;
  unavailable?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}> = ({ label, detail, healthy, pending, unavailable, icon: Icon }) => {
  const { t } = useTranslation();
  const state = unavailable ? 'unavailable' : pending ? 'pending' : healthy ? 'ok' : 'error';
  const icon = Icon
    ? <Icon className="h-4 w-4" aria-hidden="true" />
    : state === 'pending'
      ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
      : state === 'ok'
        ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        : state === 'error'
          ? <XCircle className="h-4 w-4" aria-hidden="true" />
          : <Clock className="h-4 w-4" aria-hidden="true" />;
  const statusLabel = state === 'ok'
    ? t('admin.console.statusOk', { defaultValue: 'OK' })
    : state === 'error'
      ? t('admin.console.statusError', { defaultValue: 'KO' })
      : state === 'pending'
        ? t('admin.console.statusPending', { defaultValue: '…' })
        : t('admin.console.statusUnavailable', { defaultValue: 'N/A' });

  return (
    <div className="admin-service-row" data-state={state}>
      <span className="admin-service-icon">{icon}</span>
      <div className="min-w-0">
        <p className="admin-service-label">{label}</p>
        <p className="admin-service-detail">{detail}</p>
      </div>
      <span
        className="admin-service-status"
        aria-label={t('admin.console.serviceStatus', {
          defaultValue: 'Statut du service : {{status}}',
          status: statusLabel,
        })}
      >
        {statusLabel}
      </span>
    </div>
  );
};

export const AdminBarRow: React.FC<{
  label: string;
  value: number;
  max: number;
  suffix?: string;
}> = ({ label, value, max, suffix }) => {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="admin-bar-row">
      <div className="admin-bar-meta">
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">
          {value.toLocaleString('fr-FR')}{suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <div className="admin-bar-track">
        <div className="admin-bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};
