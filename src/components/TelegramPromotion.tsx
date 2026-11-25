import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { DISCORD_INVITE_URL } from '@/config/community';

const TelegramPromotion: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="px-5 md:px-10">
      {/* Deux boutons à droite seulement en grand écran : avant, ils passent
          sous le texte pour lui laisser la largeur. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:px-6 sm:py-5 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#5865F2] text-white" aria-hidden="true"><svg viewBox="0 0 127.14 96.36" className="h-7 w-7 fill-current"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.94 97.68 97.68 0 0 0-29.08 0A72.37 72.37 0 0 0 45.67 0a105.89 105.89 0 0 0-26.25 8.09C2.8 32.65-1.7 56.6.55 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.9-11.18 68.42 68.42 0 0 1-10.86-5.18c.91-.66 1.8-1.34 2.66-2.04 20.94 9.8 43.65 9.8 64.34 0 .87.7 1.76 1.38 2.66 2.04a68.68 68.68 0 0 1-10.88 5.19 77.1 77.1 0 0 0 6.9 11.17 105.14 105.14 0 0 0 32.19-16.14c2.64-27.38-4.52-51.1-18.93-72.15ZM42.45 65.65c-6.27 0-11.43-5.75-11.43-12.8s5.05-12.8 11.43-12.8c6.42 0 11.53 5.8 11.42 12.8 0 7.05-5.05 12.8-11.42 12.8Zm42.24 0c-6.27 0-11.42-5.75-11.42-12.8s5.05-12.8 11.42-12.8c6.42 0 11.53 5.8 11.43 12.8 0 7.05-5.01 12.8-11.43 12.8Z"/></svg></div>

        <div className="min-w-0">
          <h2 className="text-base font-bold leading-snug text-white sm:text-lg">
            {t('telegram.joinCommunity')}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-400">
            <Trans t={t} i18nKey="telegram.officialAnnouncements" components={{ strong: <strong /> }} />
            <br />
            👉 <strong>{t('telegram.joinUsNow')}</strong>
          </p>
        </div>

        <div className="col-start-2 flex flex-wrap gap-2 lg:col-start-auto lg:justify-end">
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-colors duration-150 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black motion-reduce:transition-none"
          >
            <svg viewBox="0 0 127.14 96.36" className="h-4 w-4 shrink-0 fill-current" aria-hidden="true"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.94 97.68 97.68 0 0 0-29.08 0A72.37 72.37 0 0 0 45.67 0a105.89 105.89 0 0 0-26.25 8.09C2.8 32.65-1.7 56.6.55 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.9-11.18 68.42 68.42 0 0 1-10.86-5.18c.91-.66 1.8-1.34 2.66-2.04 20.94 9.8 43.65 9.8 64.34 0 .87.7 1.76 1.38 2.66 2.04a68.68 68.68 0 0 1-10.88 5.19 77.1 77.1 0 0 0 6.9 11.17 105.14 105.14 0 0 0 32.19-16.14c2.64-27.38-4.52-51.1-18.93-72.15ZM42.45 65.65c-6.27 0-11.43-5.75-11.43-12.8s5.05-12.8 11.43-12.8c6.42 0 11.53 5.8 11.42 12.8 0 7.05-5.05 12.8-11.42 12.8Zm42.24 0c-6.27 0-11.42-5.75-11.42-12.8s5.05-12.8 11.42-12.8c6.42 0 11.53 5.8 11.43 12.8 0 7.05-5.01 12.8-11.43 12.8Z"/></svg>
            {t('telegram.joinTelegram')}
          </a>
        </div>
      </div>
    </div>
  );
};

export default TelegramPromotion;
