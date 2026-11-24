import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Share2, Gift, Users, BadgeCheck, Sparkles, Film } from '../icons/Icons8';
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
    <div className="min-w-0 rounded-[18px] border border-[#383838] bg-[#202020] px-3 py-3.5 sm:px-4">
      <div className="flex items-center gap-2 text-[#929292]">
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
    return <p className="text-sm text-[#929292]">{t('referral.card.progressCancelled')}</p>;
  }

  const collectionOff = !isDataCollectionAllowed();
  const minutes = Math.min(progress.watchMinutes, progress.requiredMinutes);
  const percent = progress.requiredMinutes > 0 ? (minutes / progress.requiredMinutes) * 100 : 0;
  const days = Math.min(progress.watchDays, progress.requiredDays);
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm text-[#b0b0b0]">
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
          <div className="h-full rounded-full bg-[#e73545] transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
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
    <section className={`relative isolate overflow-hidden rounded-[26px] border border-[#303030] bg-[#171717] px-5 pb-5 pt-10 shadow-[0_18px_48px_rgba(0,0,0,0.24)] sm:rounded-[30px] sm:px-7 sm:pb-7 sm:pt-11 ${className}`} aria-labelledby={`${inputId}-title`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-7 border-b border-[#303030] bg-[#202020]">
        <div className="mx-3 flex h-full items-center gap-2 overflow-hidden sm:mx-4 sm:gap-2.5">
          {Array.from({ length: 22 }, (_, index) => (
            <span key={index} className="h-3.5 w-4 shrink-0 rounded-[4px] bg-black/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)] sm:w-[18px]" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-28 -z-10 h-80 w-80 rounded-full bg-[#e73545]/[0.07] blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-[30%] -z-10 h-64 w-64 rounded-full bg-[#e73545]/[0.04] blur-3xl" />
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.9fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#f04455]/25 bg-[#e73545]/10 text-[#f04455]">
              <Gift className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f04455]">MOVIX REWARDS</p>
              <h2 id={`${inputId}-title`} className="mt-0.5 text-xl font-semibold tracking-tight text-white sm:text-[1.35rem]">{t('referral.card.title')}</h2>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#a3a3a3] sm:text-[15px]">
            {t('referral.card.pitch', {
              duration: formatWatchDuration(data.requiredMinutes),
              days: formatDistinctDays(t, data.requiredDays),
              reward: formatDays(t, data.rewardDays)
            })}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {/* Code de parrainage présenté comme un billet premium. */}
            <div className="relative min-w-[12.5rem] overflow-hidden rounded-xl border border-[#414141] bg-[#242424] px-5 py-3.5 text-white shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
              <span aria-hidden="true" className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#171717]" />
              <span aria-hidden="true" className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#171316]" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#929292]">{t('referral.card.yourCode')}</p>
                <Film className="h-3.5 w-3.5 text-[#f04455]" aria-hidden="true" />
              </div>
              <p className="mt-1 font-mono text-[1.45rem] font-bold tabular-nums tracking-[0.16em]" aria-label={data.code.split('').join(' ')}>
                {formatCode(data.code)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" className="!bg-[#e73545] hover:!bg-[#f04455]" onClick={handleCopy}>
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
        <div className="mt-7 rounded-[20px] border border-[#383838] bg-[#202020] p-4 sm:p-5">
          <h3 className="mb-3 text-sm font-medium text-white">
            {data.referee.status === 'pending'
              ? t('referral.card.progressTitle', { reward: formatDays(t, data.rewardDays) })
              : t('referral.card.progressTitleDone')}
          </h3>
          <RefereeProgress progress={data.referee} />
        </div>
      )}

      {!data.referee && data.canEnterCode && (
        <form onSubmit={handleClaim} className="mt-7 rounded-2xl border border-white/[0.09] bg-black/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:p-5">
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
              className="h-11 min-w-0 flex-1 rounded-xl border border-[#414141] bg-[#202020] px-4 text-[15px] uppercase tracking-[0.12em] text-white outline-none transition-colors placeholder:normal-case placeholder:tracking-normal placeholder:text-white/35 hover:border-white/20 focus:border-rose-400/65 focus:ring-2 focus:ring-red-500/15 sm:max-w-sm"
            />
            <Button type="submit" variant="light" pending={claiming} disabled={!codeInput.trim()}>
              {t('referral.card.enterSubmit')}
            </Button>
          </div>
        </form>
      )}

      <p className="mt-5 flex items-center gap-2 text-xs leading-relaxed text-white/45"><Gift className="h-3.5 w-3.5 shrink-0 text-rose-300/75" aria-hidden="true" />{t('referral.card.vipNote')}</p>
    </section>
  );
}
