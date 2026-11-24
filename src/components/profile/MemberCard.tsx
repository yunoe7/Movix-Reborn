// Carte de membre du profil Movix — direction anthracite, typographie nette et accent rouge.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import { Camera, Check, Crown, Pencil, Repeat, Settings, X } from '../icons/Icons8';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { buttonClass } from './ui';

export interface MemberCardProps {
  name: string;
  avatar: string;
  profileCount: number;
  memberSince: string | null;
  providerLabel: string;
  vipUntil: string | null;
  isVip: boolean;
  onEditAvatar: () => void;
  onRename: (name: string) => Promise<void> | void;
}

function initialsOf(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'M';
}

export default function MemberCard({
  name, avatar, profileCount, memberSince, providerLabel, vipUntil, isVip, onEditAvatar, onRename,
}: MemberCardProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);
  useEffect(() => { setAvatarFailed(false); }, [avatar]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) { setEditing(false); return; }
    setSaving(true);
    try { await onRename(trimmed); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <motion.section
      aria-label={t('profilePage.card.label', 'Carte de membre')}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-[26px] border border-[#303030] bg-[#171717] p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:rounded-[30px] sm:p-7"
    >
      <div className="flex items-center gap-4 sm:gap-5">
        <button
          type="button"
          onClick={onEditAvatar}
          aria-label={t('profilePage.card.changeAvatar', 'Changer d’avatar')}
          className="group relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-full border border-white/20 bg-[#242424] ring-1 ring-white/10 transition-transform duration-200 hover:scale-[1.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f04455] sm:h-[92px] sm:w-[92px]"
        >
          {avatar && !avatarFailed
            ? <img src={avatar} alt="" className="h-full w-full object-cover" onError={() => setAvatarFailed(true)} />
            : <span className="flex h-full w-full items-center justify-center text-3xl font-semibold">{initialsOf(name)}</span>}
          <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Camera className="h-5 w-5" aria-hidden="true" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40 sm:text-xs">MOVIX ACCOUNT</p>
          {editing ? (
            <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex flex-wrap items-center gap-2">
              <label htmlFor="profile-name-input" className="sr-only">{t('profilePage.header.usernamePlaceholder')}</label>
              <input
                id="profile-name-input" ref={inputRef} value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }}
                maxLength={32} placeholder={t('profilePage.header.usernamePlaceholder')}
                className="h-10 min-w-0 flex-1 rounded-xl border border-[#414141] bg-[#202020] px-3 text-lg font-semibold text-white outline-none focus:border-[#f04455]"
              />
              <button type="submit" disabled={saving} aria-label={t('profilePage.header.save')} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#e73545] text-white disabled:opacity-60"><Check className="h-5 w-5" /></button>
              <button type="button" onClick={() => setEditing(false)} aria-label={t('profilePage.header.cancel')} className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#292929] text-white"><X className="h-5 w-5" /></button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[30px] font-semibold leading-tight tracking-[-0.035em] sm:text-[36px]" title={name}>{name}</h1>
              <button type="button" onClick={() => setEditing(true)} aria-label={t('profilePage.card.rename', 'Modifier le nom')} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#414141] text-white/65 transition-colors hover:border-[#f04455] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f04455]"><Pencil className="h-4 w-4" /></button>
            </div>
          )}
          <p className="mt-1 truncate text-[14px] leading-relaxed text-[#a3a3a3] sm:text-base">
            {profileCount > 1 ? t('profilePage.card.profileCount', { count: profileCount, defaultValue: '{{count}} profils' }) : providerLabel}
          </p>
        </div>
      </div>

      <div className="my-5 border-t border-[#303030] sm:my-6" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {memberSince && <p className="text-sm text-[#929292]">{t('profilePage.card.memberSince', { date: memberSince, defaultValue: 'Membre depuis {{date}}' })}</p>}
          {profileCount > 1 && <p className="mt-1 text-sm text-[#929292]">{providerLabel}</p>}
          {isVip && <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#f04455]"><Crown className="h-4 w-4" />{vipUntil ? t('vip.activeUntil', { date: vipUntil }) : t('vip.youAreVip')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isVip && (
            <Link to="/vip" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#e73545] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#f04455] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <Crown className="h-4 w-4" aria-hidden="true" />{t('vip.becomeVip')}
            </Link>
          )}
          {profileCount > 0 && (
            <Link to="/profile-selection" className={buttonClass('ghost', 'sm', 'min-h-10 rounded-xl border border-[#383838] bg-[#202020] px-3 text-white/80 hover:bg-[#292929]')}>
              <Repeat className="h-4 w-4" aria-hidden="true" />{t('profilePage.card.switchProfile', 'Changer')}
            </Link>
          )}
          <Link to="/settings" aria-label={t('settings.title', 'Paramètres')} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#383838] bg-[#202020] text-white/70 transition-colors hover:text-white">
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
