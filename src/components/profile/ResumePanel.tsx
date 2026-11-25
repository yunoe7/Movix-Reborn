// Grande image du dernier titre en cours, avec « Reprendre » qui lance le lecteur.
// Le voile sombre garantit la lisibilité quelle que soit l'image.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clapperboard, Play } from '../icons/Icons8';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { backdropUrl } from './storage';
import { buttonClass } from './ui';
import type { ResumeItem } from './useResumeItem';

export default function ResumePanel({ item, loading }: { item: ResumeItem | null; loading: boolean }) {
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  if (loading) {
    return <div className="profile-skeleton animate-pulse" data-testid="resume-skeleton" aria-hidden="true" />;
  }

  if (!item) {
    return (
      <section data-testid="resume-empty" className="profile-surface profile-resume-card profile-resume-empty">
        <Clapperboard className="h-9 w-9 text-[#ff7883]" aria-hidden="true" />
        <div className="mt-4">
          <h2 className="profile-section-title">{t('profilePage.resume.emptyTitle', 'Rien en cours')}</h2>
          <p className="profile-page-subtitle">
            {t('profilePage.resume.emptyDesc', 'Lance un film ou un épisode : tu pourras le reprendre ici en un clic.')}
          </p>
        </div>
        <Link to="/" className={`${buttonClass('primary', 'md')} mt-5 self-start`}>{t('profilePage.emptyStates.exploreCatalog')}</Link>
      </section>
    );
  }

  const image = backdropUrl(item.backdrop, 1280);
  const episodeLine = item.type === 'tv'
    ? t('profilePage.resume.episode', { season: item.season, episode: item.episode, defaultValue: 'Saison {{season}}, épisode {{episode}}' })
    : t('profilePage.media.movie');

  return (
    <section
      aria-label={t('profilePage.resume.label', 'Reprendre')}
      data-testid="resume-card"
      className="profile-surface profile-resume-card"
    >
      {image && !imageFailed && (
        <img
          src={image}
          alt=""
          onError={() => setImageFailed(true)}
          className="profile-resume-image"
        />
      )}
      <div aria-hidden="true" className="profile-resume-shade" />

      <div className="relative">
        <p className="profile-kicker">{t('profilePage.resume.kicker', 'Tu en étais là')}</p>
        <h2 className="profile-resume-title" data-testid="resume-title">{item.title}</h2>
        <p className="profile-resume-meta">{episodeLine}</p>

        {item.progress > 0 && (
          <div className="mt-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)}>
            <div className="profile-progress-track">
              <div className="profile-progress-fill" style={{ width: `${item.progress}%` }} />
            </div>
          </div>
        )}

        <div className="profile-resume-actions">
          <Link to={item.watchPath} className={buttonClass('primary', 'md')} data-testid="resume-watch">
            <Play className="h-4 w-4" aria-hidden="true" />
            {t('profilePage.resume.action', 'Reprendre')}
          </Link>
          <Link to={item.detailsPath} className={buttonClass('secondary', 'md')} data-testid="resume-details">
            {t('profilePage.resume.details', 'Voir la fiche')}
          </Link>
          {item.remainingMinutes !== null && item.remainingMinutes > 0 && (
            <span className="profile-resume-remaining">
              {t('profilePage.resume.remaining', { count: item.remainingMinutes, defaultValue: 'Reste {{count}} min' })}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
