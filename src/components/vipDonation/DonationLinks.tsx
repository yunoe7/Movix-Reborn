import React from 'react';
import { useTranslation } from 'react-i18next';
import { FolderHeart, KeyRound, LifeBuoy, MessageCircle } from 'lucide-react';

import { useVipModal } from '@/context/VipModalContext';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';

interface DonationLinksProps {
  discordUrl: string;
}

const secondaryLinkClass = 'vip-card-hover flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-sm font-medium leading-tight text-white/85 transition-colors duration-150 hover:border-yellow-400/30 hover:bg-yellow-400/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';
const helpLinkClass = 'rounded font-medium text-white/80 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-yellow-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';

// Liens sous la carte de don : historique des dons, activation d'une clé
// existante et support Discord. Gardés aussi quand les dons sont en pause.
const DonationLinks: React.FC<DonationLinksProps> = ({ discordUrl }) => {
  const { t } = useTranslation();
  const { openVipModal } = useVipModal();

  return (
    <div data-testid="vip-links" className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Link to="/vip/invoices" data-testid="vip-link-donations" className={secondaryLinkClass}>
          <span data-vip-icon="vip-link-donations" className="inline-flex text-yellow-400" aria-hidden="true">
            <FolderHeart className="h-4 w-4" />
          </span>
          {t('vipDonations.donate.links.myDonations')}
        </Link>
        <button
          type="button"
          data-testid="vip-link-key"
          onClick={openVipModal}
          className={secondaryLinkClass}
        >
          <span data-vip-icon="vip-link-key" className="inline-flex text-yellow-400" aria-hidden="true">
            <KeyRound className="h-4 w-4" />
          </span>
          {t('vipDonations.donate.links.haveKey')}
        </button>
      </div>

      <p data-testid="vip-link-help" className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-white/55">
        <span data-vip-icon="vip-link-help" className="inline-flex text-white opacity-70" aria-hidden="true">
          <LifeBuoy className="h-4 w-4" />
        </span>
        <span>{t('vipDonations.donate.links.help')}</span>
        <a href={discordUrl} target="_blank" rel="noopener noreferrer" className={helpLinkClass} data-testid="vip-link-discord">
          <MessageCircle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
          {t('vipDonations.donate.links.discord')}
        </a>
      </p>
    </div>
  );
};

export default DonationLinks;
