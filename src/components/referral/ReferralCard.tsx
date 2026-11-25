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

// Carte « Parrainage » : même langage visuel que le compte (surfaces
// anthracite, accent rouge), code très lisible et trois chiffres contrastés.
// Rien si le parrainage est coupé.

function formatCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

function Stat({ value, label, icon: Icon, testId }: { value: number; label: string; icon: React.ElementType; testId: string }) {
  return (
    <div className="profile-stat" data-testid={testId}>
      <div className="profile-stat-label">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <span className="profile-stat-value">{value}</span>
    </div>
  );
}

function RefereeProgress({ progress }: { progress: ReferralProgress }) {
  const { t } = useTranslation();
  if (progress.status === 'rewarded') {
    return <p className="text-sm font-semibold text-[#7ee7a8]">{t('referral.card.progressDone')}</p>;
  }
  if (progress.status === 'cancelled') {
    return <p className="text-sm text-[#d0d0d0]">{t('referral.card.progressCancelled')}</p>;
  }

  const collectionOff = !isDataCollectionAllowed();
  const minutes = Math.min(progress.watchMinutes, progress.requiredMinutes);
  const percent = progress.requiredMinutes > 0 ? (minutes / progress.requiredMinutes) * 100 : 0;
  const days = Math.min(progress.watchDays, progress.requiredDays);
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm text-[#d8d8d8]">
          {t('referral.card.progressMinutes', {
            watched: formatWatchDuration(minutes),
            required: formatWatchDuration(progress.requiredMinutes)
          })}
        </p>
        <div
          className="profile-progress-track mt-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.requiredMinutes}
          aria-valuenow={minutes}
          aria-label={t('referral.card.progressMinutesLabel')}
        >
          <div className="profile-progress-fill transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: progress.requiredDays }, (_, index) => (
            <span
              key={index}
              className={`h-3 w-3 rounded-full ${index < days ? 'bg-[#e11d2e]' : 'border border-[#777777]'}`}
            />
          ))}
        </div>
        <p className="text-sm font-semibold tabular-nums text-[#f0f0f0]">
          {t('referral.card.progressDays', { watched: days, required: progress.requiredDays })}
        </p>
      </div>
      {collectionOff && (
        <p className="text-sm leading-relaxed text-[#ffdca8] sm:col-span-2">
          {t('referral.card.collectionOff')}{' '}
          <Link to="/settings#privacy" className="font-semibold text-white underline underline-offset-2 hover:text-[#ffdca8]">
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
    <section
      className={`profile-surface profile-referral-card ${className}`}
      aria-labelledby={`${inputId}-title`}
      data-testid="referral-card"
    >
      <div className="profile-referral-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="profile-referral-icon">
            <Gift className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="profile-eyebrow text-[#ff8a94]">MOVIX REWARDS</p>
            <h2 id={`${inputId}-title`} className="profile-section-title mt-1">{t('referral.card.title')}</h2>
          </div>
        </div>
        <Sparkles className="hidden h-6 w-6 text-[#ff8a94] sm:block" aria-hidden="true" />
      </div>

      <p className="profile-referral-pitch">
        {t('referral.card.pitch', {
          duration: formatWatchDuration(data.requiredMinutes),
          days: formatDistinctDays(t, data.requiredDays),
          reward: formatDays(t, data.rewardDays)
        })}
      </p>

      <div className="profile-referral-row">
        <div className="min-w-0">
          <div className="profile-code-ticket" data-testid="referral-code">
            <div className="profile-code-label">
              <span>{t('referral.card.yourCode')}</span>
              <Film className="h-4 w-4 text-[#ff8a94]" aria-hidden="true" />
            </div>
            <p className="profile-code-value" aria-label={data.code.split('').join(' ')}>
              {formatCode(data.code)}
            </p>
          </div>
          <div className="profile-referral-actions">
            <Button variant="primary" onClick={handleCopy} data-testid="referral-copy">
              <Copy className="h-4 w-4" aria-hidden="true" />
              {t('referral.card.copyLink')}
            </Button>
            {canShare && (
              <Button variant="secondary" onClick={handleShare} data-testid="referral-share">
                <Share2 className="h-4 w-4" aria-hidden="true" />
                {t('referral.card.share')}
              </Button>
            )}
          </div>
          {codeActiveDate && (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#ffdca8]">
              {t('referral.card.codeNotActive', { date: codeActiveDate })}
            </p>
          )}
        </div>

        <div className="profile-metric-grid">
          <Stat value={data.stats.invited} label={t('referral.card.statInvited')} icon={Users} testId="referral-stat-invited" />
          <Stat value={data.stats.rewarded} label={t('referral.card.statRewarded')} icon={BadgeCheck} testId="referral-stat-rewarded" />
          <Stat value={data.stats.daysEarned} label={t('referral.card.statDays')} icon={Gift} testId="referral-stat-days" />
        </div>
      </div>

      {data.referee && (
        <div className="profile-referral-subpanel" data-testid="referral-progress">
          <h3 className="mb-3 text-sm font-bold text-white">
            {data.referee.status === 'pending'
              ? t('referral.card.progressTitle', { reward: formatDays(t, data.rewardDays) })
              : t('referral.card.progressTitleDone')}
          </h3>
          <RefereeProgress progress={data.referee} />
        </div>
      )}

      {!data.referee && data.canEnterCode && (
        <form onSubmit={handleClaim} className="profile-referral-subpanel mt-5" data-testid="referral-claim">
          <label htmlFor={inputId} className="block text-sm font-bold text-white">{t('referral.card.enterTitle')}</label>
          {deadline && <p className="mt-1 text-[13px] text-[#d0d0d0]">{t('referral.card.enterDeadline', { date: deadline })}</p>}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value.slice(0, 300))}
              placeholder={t('referral.field.placeholder')}
              className="profile-referral-input"
              data-testid="referral-claim-input"
            />
            <Button type="submit" variant="primary" pending={claiming} disabled={!codeInput.trim()} data-testid="referral-claim-submit">
              {t('referral.card.enterSubmit')}
            </Button>
          </div>
        </form>
      )}

      <p className="profile-referral-note">
        <Gift className="h-4 w-4 shrink-0 text-[#ff8a94]" aria-hidden="true" />
        {t('referral.card.vipNote')}
      </p>
    </section>
  );
}
