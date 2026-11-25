// Carte de membre du profil Movix : identité lisible, faits du compte et
// actions clairement nommées. Les callbacks et les liens restent inchangés.
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
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch {
      // Le parent affiche déjà le toast d'erreur ; on garde le champ ouvert.
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.section
      aria-label={t('profilePage.card.label', 'Carte de membre')}
      data-testid="member-card"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="profile-surface profile-member-card flex h-full flex-col"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="profile-eyebrow">{t('profilePage.card.title', 'Carte de membre')}</p>
        {isVip && (
          <span data-testid="member-vip-badge" className="inline-flex items-center gap-1.5 rounded-full border border-[#e11d2e]/45 bg-[#e11d2e]/10 px-3 py-1 text-xs font-bold text-[#ff8a94]">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            {vipUntil ? t('vip.activeUntil', { date: vipUntil }) : t('vip.youAreVip')}
          </span>
        )}
      </div>

      <div className="profile-member-top mt-5">
        <button
          type="button"
          onClick={onEditAvatar}
          data-testid="member-avatar-button"
          aria-label={t('profilePage.card.changeAvatar', 'Changer d’avatar')}
          className="profile-member-avatar"
        >
          {avatar && !avatarFailed
            ? <img src={avatar} alt="" data-testid="member-avatar" className="h-full w-full object-cover" onError={() => setAvatarFailed(true)} />
            : <span data-testid="member-avatar-initials" className="flex h-full w-full items-center justify-center text-3xl font-bold">{initialsOf(name)}</span>}
          <span className="profile-member-avatar-overlay">
            <Camera className="h-6 w-6" aria-hidden="true" />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex flex-wrap items-center gap-2">
              <label htmlFor="profile-name-input" className="sr-only">{t('profilePage.header.usernamePlaceholder')}</label>
              <input
                id="profile-name-input"
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setEditing(false); }}
                maxLength={32}
                placeholder={t('profilePage.header.usernamePlaceholder')}
                className="h-11 min-w-0 flex-1 rounded-xl border border-[#505050] bg-[#101010] px-3 text-lg font-semibold text-white outline-none focus:border-[#e11d2e]"
              />
              <button
                type="submit"
                disabled={saving}
                aria-label={t('profilePage.header.save')}
                title={t('profilePage.header.save')}
                className="profile-icon-button"
              >
                <Check className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label={t('profilePage.header.cancel')}
                title={t('profilePage.header.cancel')}
                className="profile-icon-button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </form>
          ) : (
            <>
              <h1 className="profile-member-name" data-testid="member-name" title={name}>{name}</h1>
              <p className="profile-member-meta">
                <span>{profileCount > 1
                  ? t('profilePage.card.profileCount', { count: profileCount, defaultValue: '{{count}} profils' })
                  : providerLabel}</span>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="profile-member-facts">
        <div className="profile-fact">
          <span className="profile-fact-label">{t('profile.connectedUser')}</span>
          <span className="profile-fact-value" title={providerLabel}>{providerLabel}</span>
        </div>
        <div className="profile-fact">
          <span className="profile-fact-label">{String(t('profilePage.card.memberSince', { date: '', defaultValue: 'Membre depuis {{date}}' })).trim()}</span>
          <span className="profile-fact-value">{memberSince || '—'}</span>
        </div>
      </div>

      <div className="profile-divider my-5" />

      <div className="profile-member-actions">
        <button type="button" onClick={() => setEditing(true)} className="profile-btn profile-btn-secondary" data-testid="member-edit">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t('profilePage.card.rename', 'Modifier le nom')}
        </button>
        <button type="button" onClick={onEditAvatar} className="profile-btn profile-btn-secondary" data-testid="member-change-avatar">
          <Camera className="h-4 w-4" aria-hidden="true" />
          {t('profilePage.card.changeAvatar', 'Changer d’avatar')}
        </button>
        {!isVip && (
          <Link to="/vip" className="profile-btn profile-btn-primary" data-testid="member-vip">
            <Crown className="h-4 w-4" aria-hidden="true" />
            {t('vip.becomeVip')}
          </Link>
        )}
        {profileCount > 0 && (
          <Link to="/profile-selection" className="profile-btn profile-btn-secondary" data-testid="member-switch">
            <Repeat className="h-4 w-4" aria-hidden="true" />
            {t('profilePage.card.switchProfile', 'Changer')}
          </Link>
        )}
        <Link to="/settings" className={`${buttonClass('ghost', 'md')} md:col-span-2`} data-testid="member-settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
          {t('settings.title', 'Paramètres')}
        </Link>
      </div>
    </motion.section>
  );
}
