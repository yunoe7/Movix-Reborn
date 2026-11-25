import React from 'react';
import { Bitcoin, Coins } from 'lucide-react';

import { cn } from '@/lib/utils';

// Petit adaptateur conservé pour l'écran d'administration des réglages. Les
// logos distants ont été retirés : BTC et LTC utilisent les mêmes SVG locaux
// que la page publique, donc aucun carré ne peut apparaître hors ligne.
export type CryptoLogoCoin = 'btc' | 'ltc';

export const CryptoLogo: React.FC<{ coin: CryptoLogoCoin; className?: string }> = ({ coin, className }) => {
  const Icon = coin === 'btc' ? Bitcoin : Coins;
  return <Icon className={cn('shrink-0', className)} aria-hidden="true" />;
};

// Carte cadeau : une carte barrée d'un ruban et de son nœud, au même trait que
// les icônes Lucide utilisées partout sur la page. SVG local : aucune image
// distante ne peut laisser un carré vide si le réseau est bloqué.
export const GiftCardIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="2" y="7" width="20" height="13" rx="2" />
    <path d="M2 12h20" />
    <path d="M12 12c-1.4-2.6-4.3-3.6-4.3-1.6 0 1.3 2.3 1.6 4.3 1.6" />
    <path d="M12 12c1.4-2.6 4.3-3.6 4.3-1.6 0 1.3 2.3 1.6 4.3 1.6" />
    <path d="m12 12-2.3 3" />
    <path d="m12 12 2.3 3" />
  </svg>
);
