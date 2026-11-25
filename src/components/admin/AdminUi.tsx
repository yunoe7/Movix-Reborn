import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  XCircle,
} from '../icons/Icons8';
import type { StatPoint } from '../../services/adminStatsService';

export const AdminPanel: React.FC<{
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ eyebrow, title, description, action, className = '', children }) => (
  <section className={`admin-panel rounded-2xl border border-white/[0.08] bg-[#0a0a0b] ${className}`}>
    {(eyebrow || action || description) && (
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{eyebrow}</p>
          )}
          <h2 className="text-base font-bold tracking-tight text-white sm:text-lg">{title}</h2>
          {description && <p className="mt-1 text-[13px] leading-5 text-white/50">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
    )}
    <div className="p-5 sm:p-6">{children}</div>
  </section>
);

export const AdminStatCard: React.FC<{
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  caption?: string;
  testId?: string;
}> = ({ label, value, icon: Icon, caption, testId }) => (
  <div data-testid={testId} className="admin-stat rounded-xl border border-white/[0.08] bg-[#0e0e10] p-4">
    <div className="flex items-start justify-between gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <Icon className="h-[18px] w-[18px] text-white/55" aria-hidden="true" />
    </div>
    <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-white">{value}</p>
    {caption && <p className="mt-1 text-xs text-white/40">{caption}</p>}
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
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{title}</p>
      {points.length === 0 || max === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] text-xs text-white/40">
          {emptyLabel}
        </div>
      ) : (
        <div className="admin-chart -mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex h-24 min-w-[320px] items-end gap-[3px]" role="img" aria-label={title}>
            {points.map((point) => (
              <div
                key={point.date}
                className="min-w-0 flex-1 rounded-t-[3px] bg-white/25 transition-colors hover:bg-white/60"
                style={{ height: `${Math.max(4, Math.round((point.count / max) * 100))}%` }}
                title={`${point.date} · ${point.count}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-white/30">
            <span>{points[0]?.date}</span>
            <span>{points[points.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminStateBlock: React.FC<{
  tone: 'loading' | 'empty' | 'error' | 'info';
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ tone, title, description, action }) => {
  const icon = tone === 'error'
    ? <XCircle className="h-4 w-4" aria-hidden="true" />
    : tone === 'info'
      ? <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      : tone === 'loading'
        ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        : <Clock className="h-4 w-4" aria-hidden="true" />;

  const toneClass = tone === 'error'
    ? 'border-red-500/25 bg-red-500/[0.06] text-red-200'
    : 'border-white/[0.08] bg-white/[0.02] text-white/70';

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${toneClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-white">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-white/50">{description}</p>}
      </div>
      {action}
    </div>
  );
};

export const AdminServiceRow: React.FC<{
  label: string;
  detail: string;
  healthy: boolean;
  pending?: boolean;
}> = ({ label, detail, healthy, pending }) => (
  <div className="flex items-start gap-3 border-b border-white/[0.06] py-3 last:border-0 last:pb-0">
    <span className={`mt-0.5 shrink-0 ${healthy ? 'text-white/80' : 'text-red-300'}`}>
      {pending
        ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        : healthy
          ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          : <XCircle className="h-4 w-4" aria-hidden="true" />}
    </span>
    <div className="min-w-0">
      <p className="text-[13px] font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-xs leading-5 text-white/45">{detail}</p>
    </div>
    <span className={`ml-auto shrink-0 text-[11px] font-semibold ${healthy ? 'text-white/55' : 'text-red-300'}`}>
      {pending
        ? '…'
        : healthy
          ? 'OK'
          : 'KO'}
    </span>
  </div>
);

export const AdminBarRow: React.FC<{
  label: string;
  value: number;
  max: number;
  suffix?: string;
}> = ({ label, value, max, suffix }) => {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-white/65">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-white/80">
          {value.toLocaleString('fr-FR')}{suffix ? ` ${suffix}` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-white/35" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};
