import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Share2, Gift, Users, BadgeCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { copyText } from '@/utils/clipboard';
import { Button } from '@/components/profile/ui';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  buildReferralLink,
  claimReferralCode,
  formatWatchDuration,
  getReferralMe,
  hasAccountSession,
  isDataCollectionAllowed,
  normalizeReferralCode,
  type ReferralAccount,
  type ReferralProgress
} from '@/services/referralService';
import { describeReferralError, formatDays, formatDistinctDays, requestReferralRefresh } from './referralActions';

// Carte « Parrainage » de la page profil, dans le langage des tickets de la
// page : surface gray-900, talon blanc perforé qui porte le code, un seul
// accent rouge (la barre de minutes). Rien si le parrainage est coupé.

function formatCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

function Stat({ value, label, icon: Icon }: { value: number; label: string; icon: React.ElementType }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:px-4">
      <div className="flex items-center gap-2 text-white/40">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.09em]">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-[1.7rem]">{value}</p>
    </div>
  );
}

function RefereeProgress({ progress }: { progress: ReferralProgress }) {
  const { t } = useTranslation();
  if (progress.status === 'rewarded') {
    return <p className="text-sm text-emerald-300">{t('referral.card.progressDone')}</p>;
  }
  if (progress.status === 'cancelled') {
    return <p className="text-sm text-white/55">{t('referral.card.progressCancelled')}</p>;
  }

  const collectionOff = !isDataCollectionAllowed();
  const minutes = Math.min(progress.watchMinutes, progress.requiredMinutes);
  const percent = progress.requiredMinutes > 0 ? (minutes / progress.requiredMinutes) * 100 : 0;
  const days = Math.min(progress.watchDays, progress.requiredDays);
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm text-white/70">
          {t('referral.card.progressMinutes', {
            watched: formatWatchDuration(minutes),
            required: formatWatchDuration(progress.requiredMinutes)
          })}
        </p>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.requiredMinutes}
          aria-valuenow={minutes}
          aria-label={t('referral.card.progressMinutesLabel')}
        >
          <div className="h-full rounded-full bg-red-600 transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: progress.requiredDays }, (_, index) => (
            <span
              key={index}
              className={`h-3 w-3 rounded-full ${index < days ? 'bg-white' : 'border border-white/30'}`}
            />
          ))}
        </div>
        <p className="text-sm tabular-nums text-white/70">
          {t('referral.card.progressDays', { watched: days, required: progress.requiredDays })}
        </p>
      </div>
      {collectionOff && (
        <p className="text-sm leading-relaxed text-amber-200 sm:col-span-2">
          {t('referral.card.collectionOff')}{' '}
          <Link to="/settings#privacy" className="font-medium text-white underline underline-offset-2 hover:text-amber-100">
            {t('referral.card.collectionOffLink')}
          </Link>
        </p>
      )}
    </div>
  );
}

export default function ReferralCard({ className = '' }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const [data, setData] = useState<ReferralAccount | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!hasAccountSession()) {
      setData(null);
      return;
    }
    try {
      const me = await getReferralMe();
      setData(me.enabled ? me : null);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data) return null;

  const link = buildReferralLink(data.code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleCopy = async () => {
    const ok = await copyText(link);
    if (ok) toast.success(t('referral.card.copied'));
    else toast.error(t('referral.card.copyFailed'));
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: 'Movix', text: t('referral.card.shareText', { days: formatDays(t, data.rewardDays) }), url: link });
    } catch {
      // Partage annulé : rien à faire.
    }
  };

  const handleClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = normalizeReferralCode(codeInput);
    if (!code) {
      toast.error(t('referral.field.invalid'));
      return;
    }
    setClaiming(true);
    try {
      await claimReferralCode(code);
      toast.success(t('referral.toast.claimed', {
        duration: formatWatchDuration(data.requiredMinutes),
        days: formatDistinctDays(t, data.requiredDays),
        reward: formatDays(t, data.rewardDays)
      }));
      setCodeInput('');
      await load();
      // Le gestionnaire global commence à compter les minutes.
      requestReferralRefresh();
    } catch (error) {
      toast.error(describeReferralError(t, error));
    } finally {
      setClaiming(false);
    }
  };

  let deadline: string | null = null;
  if (data.claimDeadline) {
    try {
      deadline = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(new Date(data.claimDeadline));
    } catch {
      deadline = null;
    }
  }

  // Compte trop récent pour parrainer : le code ne marche pas avant cette date.
  let codeActiveDate: string | null = null;
  if (data.codeActiveAt) {
    try {
      codeActiveDate = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(new Date(data.codeActiveAt));
    } catch {
      codeActiveDate = null;
    }
  }

  return (
    <section className={`relative isolate overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(135deg,#171c2b_0%,#111725_48%,#0d111c_100%)] p-5 shadow-[0_22px_65px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.045)] sm:p-7 ${className}`} aria-labelledby={`${inputId}-title`}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full bg-red-500/[0.09] blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-[28%] -z-10 h-64 w-64 rounded-full bg-indigo-500/[0.07] blur-3xl" />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.9fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-300 shadow-[0_0_24px_rgba(239,68,68,0.09)]">
              <Gift className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-300/75">MOVIX REWARDS</p>
              <h2 id={`${inputId}-title`} className="mt-0.5 text-xl font-semibold tracking-tight text-white sm:text-[1.35rem]">{t('referral.card.title')}</h2>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300/75 sm:text-[15px]">
            {t('referral.card.pitch', {
              duration: formatWatchDuration(data.requiredMinutes),
              days: formatDistinctDays(t, data.requiredDays),
              reward: formatDays(t, data.rewardDays)
            })}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {/* Code de parrainage présenté comme un billet premium. */}
            <div className="relative min-w-[12.5rem] overflow-hidden rounded-xl border border-white/15 bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)] px-5 py-3.5 text-slate-950 shadow-[0_8px_24px_rgba(0,0,0,0.2)]">
              <span aria-hidden="true" className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#151a28]" />
              <span aria-hidden="true" className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#151a28]" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('referral.card.yourCode')}</p>
                <Sparkles className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
              </div>
              <p className="mt-1 font-mono text-[1.45rem] font-bold tabular-nums tracking-[0.16em]" aria-label={data.code.split('').join(' ')}>
                {formatCode(data.code)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={handleCopy}>
                <Copy className="h-4 w-4" aria-hidden="true" />
                {t('referral.card.copyLink')}
              </Button>
              {canShare && (
                <Button variant="secondary" onClick={handleShare}>
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                  {t('referral.card.share')}
                </Button>
              )}
            </div>
          </div>
          {codeActiveDate && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-amber-200">
              {t('referral.card.codeNotActive', { date: codeActiveDate })}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:w-full">
          <Stat value={data.stats.invited} label={t('referral.card.statInvited')} icon={Users} />
          <Stat value={data.stats.rewarded} label={t('referral.card.statRewarded')} icon={BadgeCheck} />
          <Stat value={data.stats.daysEarned} label={t('referral.card.statDays')} icon={Gift} />
        </div>
      </div>

      {data.referee && (
        <div className="mt-7 rounded-xl border border-white/[0.08] bg-black/15 p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-medium text-white">
            {data.referee.status === 'pending'
              ? t('referral.card.progressTitle', { reward: formatDays(t, data.rewardDays) })
              : t('referral.card.progressTitleDone')}
          </h3>
          <RefereeProgress progress={data.referee} />
        </div>
      )}

      {!data.referee && data.canEnterCode && (
        <form onSubmit={handleClaim} className="mt-7 rounded-xl border border-white/[0.08] bg-black/15 p-4 sm:p-5">
          <label htmlFor={inputId} className="block text-sm font-medium text-white">{t('referral.card.enterTitle')}</label>
          {deadline && <p className="mt-1 text-[13px] text-white/50">{t('referral.card.enterDeadline', { date: deadline })}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              id={inputId}
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value.slice(0, 300))}
              placeholder={t('referral.field.placeholder')}
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0b101b]/80 px-4 text-[15px] uppercase tracking-[0.12em] text-white outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-white/35 hover:border-white/20 focus:border-red-400/60 focus:ring-2 focus:ring-red-500/10 sm:max-w-sm"
            />
            <Button type="submit" variant="light" pending={claiming} disabled={!codeInput.trim()}>
              {t('referral.card.enterSubmit')}
            </Button>
          </div>
        </form>
      )}

      <p className="mt-5 flex items-center gap-2 text-xs leading-relaxed text-slate-400/70"><Gift className="h-3.5 w-3.5 shrink-0 text-red-300/70" aria-hidden="true" />{t('referral.card.vipNote')}</p>
    </section>
  );
}
