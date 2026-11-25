import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  BadgeCheck,
  BadgeEuro,
  Check,
  ChevronRight,
  CreditCard,
  Crown,
  Gift,
  Heart,
  Info,
  ShieldCheck,
  Sparkles,
  Unlock,
  type LucideIcon,
} from 'lucide-react';

import AnimatedBorderCard from '@/components/ui/animated-border-card';
import { SquareBackground } from '@/components/ui/square-background';
import DonationForm from '@/components/vipDonation/DonationForm';
import DonationLinks from '@/components/vipDonation/DonationLinks';
import DonationPerks from '@/components/vipDonation/DonationPerks';
import { DonationPausedCard, DonationSkeleton } from '@/components/vipDonation/DonationCardStates';
import {
  ALL_DONATION_METHODS_AVAILABLE,
  getDonationRule,
  isSafeExternalUrl,
  scrollToDonationCard
} from '@/components/vipDonation/donationUtils';
import { IX_MATRIX_URL } from '@/config/community';
import { useLightMode } from '@/context/LightModeContext';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import {
  DEFAULT_VIP_DONATION_SETTINGS,
  getVipDonationSettings,
  type VipDonationAvailability,
  type VipDonationSettings
} from '@/services/vipDonationsService';
import { readLocalStorage } from '@/utils/browserStorage';

import '@/components/vipDonation/vip-page.css';

type DonationSettingsState =
  | { status: 'loading' }
  | { status: 'ready'; settings: VipDonationSettings; availability: VipDonationAvailability };

const DONATION_CARD_STYLE = { '--_card-radius': '1.5rem' } as React.CSSProperties;
const SCROLL_CANCEL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

const HOW_STEPS: ReadonlyArray<{ icon: LucideIcon; key: string }> = [
  { icon: Check, key: 'help.vip.step1' },
  { icon: Heart, key: 'help.vip.step2' },
  { icon: CreditCard, key: 'help.vip.step3' },
  { icon: Unlock, key: 'help.vip.step4' },
];

const FAQ_ITEMS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: BadgeEuro,
    title: 'help.vip.packsTitle',
    body: 'help.vip.packsIntro',
  },
  {
    icon: CreditCard,
    title: 'help.vip.paymentTitle',
    body: 'help.vip.paymentBody',
  },
  {
    icon: Gift,
    title: 'vipDonations.donate.giftCard.step1Title',
    body: 'vipDonations.donate.giftCard.lead',
  },
  {
    icon: ShieldCheck,
    title: 'help.vip.limitsTitle',
    body: 'help.vip.limitsBody',
  },
];

// Page de don unique, servie sur /vip et /vip/don : pourquoi donner, le
// montant, le moyen, puis le don. Le VIP est le merci.
const VipPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'fr';
  const location = useLocation();
  const { effectivePrefs } = useLightMode();
  const donationCardRef = useRef<HTMLDivElement>(null);
  const transitionsRef = useRef(effectivePrefs.transitions);
  const [state, setState] = useState<DonationSettingsState>({ status: 'loading' });

  useEffect(() => {
    transitionsRef.current = effectivePrefs.transitions;
  }, [effectivePrefs.transitions]);

  useEffect(() => {
    let cancelled = false;
    getVipDonationSettings()
      .then(({ settings, availability }) => {
        if (!cancelled) {
          setState({ status: 'ready', settings, availability });
        }
      })
      .catch(() => {
        // API muette : réglages par défaut, pour que le don reste possible.
        if (!cancelled) {
          setState({
            status: 'ready',
            settings: DEFAULT_VIP_DONATION_SETTINGS,
            availability: ALL_DONATION_METHODS_AVAILABLE
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const wantsDonationCard = /^\/vip\/don\/?$/.test(location.pathname) || location.hash === '#don';

  useEffect(() => {
    if (!wantsDonationCard) {
      return undefined;
    }

    // Le moindre geste de l'utilisateur annule le défilement automatique.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    SCROLL_CANCEL_EVENTS.forEach((type) => window.addEventListener(type, cancel, { passive: true }));

    // Laisse d'abord passer le retour en haut de page fait à chaque
    // changement de route (ScrollToTop dans App.tsx).
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        const smooth = transitionsRef.current && readLocalStorage('settings_smooth_scroll') !== 'false';
        scrollToDonationCard(donationCardRef.current, smooth);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      SCROLL_CANCEL_EVENTS.forEach((type) => window.removeEventListener(type, cancel));
    };
  }, [wantsDonationCard, location.key]);

  const ready = state.status === 'ready' ? state : null;
  // Pas de règle affichée pendant une pause : rien ne peut être donné.
  const rule = ready?.settings.donationsEnabled ? getDonationRule(t, locale, ready.settings) : null;
  const contacts = (ready?.settings ?? DEFAULT_VIP_DONATION_SETTINGS).contacts;
  const matrixUrl = isSafeExternalUrl(contacts.matrixRoomUrl) ? contacts.matrixRoomUrl.trim() : IX_MATRIX_URL;
  const discordUrl = isSafeExternalUrl(contacts.discordUrl) ? contacts.discordUrl.trim() : null;

  return (
    <SquareBackground
      squareSize={48}
      borderColor="rgba(234, 179, 8, 0.12)"
      // overflow-clip au lieu de overflow-hidden : même découpe du fond, mais
      // sans créer de conteneur de défilement, sinon la carte de don ne peut
      // pas rester collée (sticky) sur ordinateur.
      className="min-h-screen overflow-clip bg-black text-white"
    >
      <div
        data-testid="vip-page"
        className="mx-auto w-full max-w-7xl px-4 pb-20 pt-4 sm:px-6 sm:pt-8 lg:px-8"
      >
        <Link
          to="/"
          data-testid="vip-back"
          className="group inline-flex items-center gap-2 rounded text-sm text-white/55 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
        >
          <span data-vip-icon="vip-back" className="inline-flex" aria-hidden="true">
            <ArrowLeft className="h-4 w-4 text-white opacity-55 transition-opacity group-hover:opacity-100" />
          </span>
          {t('common.backToHome')}
        </Link>

        {/* Deux colonnes : l'accroche et les avantages à gauche, la carte de
            don à droite. La carte reste visible sans écraser le formulaire. */}
        <div
          data-testid="vip-layout"
          className="mt-8 grid items-start gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] lg:gap-x-10"
        >
          <div className="min-w-0 space-y-8 lg:space-y-10">
            <header
              data-testid="vip-header"
              className="vip-reveal min-w-0"
              style={{ animationDelay: '40ms' }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="vip-badge"
                  className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-yellow-200"
                >
                  <span data-vip-icon="vip-badge" className="inline-flex text-yellow-400" aria-hidden="true">
                    <Crown className="h-4 w-4" />
                  </span>
                  VIP
                </span>
                <span aria-hidden="true" className="h-px w-10 bg-yellow-400/30" />
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/45">
                  {t('vip.getVip')}
                </span>
              </div>

              <h1
                data-testid="vip-heading"
                className="mt-5 text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-[1.08]"
              >
                {t('vipDonations.donate.heroTitle')}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
                {t('vipDonations.donate.heroText')}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                {ready === null ? (
                  <span aria-hidden="true" className="h-[38px] w-56 animate-pulse rounded-full bg-white/[0.06]" />
                ) : rule ? (
                  <span
                    data-testid="vip-rule"
                    className="inline-flex items-center gap-2.5 rounded-full border border-yellow-400/25 bg-yellow-400/10 px-4 py-2 text-sm font-semibold text-yellow-100"
                  >
                    <span data-vip-icon="vip-rule" className="inline-flex text-yellow-400" aria-hidden="true">
                      <Crown className="h-4 w-4" />
                    </span>
                    {rule}
                  </span>
                ) : null}
                <Link
                  to="/frais"
                  className="inline-flex items-center gap-2 rounded text-sm text-white/55 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white hover:decoration-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
                >
                  <span data-vip-icon="vip-costs" className="inline-flex" aria-hidden="true">
                    <Info className="h-4 w-4" />
                  </span>
                  {t('vipDonations.donate.costsLink')}
                </Link>
              </div>
            </header>

            <section
              data-testid="vip-overview"
              className="vip-reveal relative min-w-0 overflow-hidden rounded-3xl border border-yellow-400/20 bg-gradient-to-br from-yellow-400/[0.09] via-white/[0.035] to-transparent p-6 sm:p-7"
              style={{ animationDelay: '80ms' }}
            >
              <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full border border-yellow-400/10" />
              <span aria-hidden="true" className="pointer-events-none absolute -right-4 -top-8 h-32 w-32 rounded-full border border-yellow-400/15" />
              <span
                data-vip-icon="vip-overview-crown"
                className="relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-yellow-400/10 text-yellow-400 ring-1 ring-inset ring-yellow-400/25"
                aria-hidden="true"
              >
                <Crown className="h-7 w-7" />
              </span>
              <p className="relative mt-5 text-sm font-medium uppercase tracking-[0.16em] text-white/50">
                {t('vip.accessMovixVip')}
              </p>
              <p className="relative mt-1.5 text-2xl font-semibold tracking-tight text-yellow-100 sm:text-3xl">
                {rule ?? t('vip.title')}
              </p>
              <ul className="relative mt-5 grid gap-2 sm:grid-cols-2">
                <li className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5 text-sm text-white/75">
                  <span data-vip-icon="vip-overview-sparkles" className="inline-flex text-yellow-400" aria-hidden="true">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  {t('vip.quality4k')}
                </li>
                <li className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5 text-sm text-white/75">
                  <span data-vip-icon="vip-overview-shield" className="inline-flex text-yellow-400" aria-hidden="true">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  {t('vip.noAds')}
                </li>
              </ul>
            </section>

            <div className="vip-reveal min-w-0" style={{ animationDelay: '120ms' }}>
              <DonationPerks />
            </div>

            <section
              data-testid="vip-how"
              className="vip-reveal min-w-0"
              style={{ animationDelay: '160ms' }}
            >
              <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                {t('help.vip.stepsTitle')}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-white/60">{t('vip.getAccessClicks')}</p>
              <ol className="mt-5 grid gap-3 sm:grid-cols-2">
                {HOW_STEPS.map(({ icon: Icon, key }, index) => (
                  <li
                    key={key}
                    data-testid={`vip-step-${index + 1}`}
                    className="vip-card-hover flex min-h-[6.5rem] gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"
                  >
                    <span
                      data-vip-icon={`vip-step-${index + 1}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400"
                      aria-hidden="true"
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <p className="min-w-0 text-sm leading-6 text-white/75">{t(key)}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          {/* Sur téléphone, la carte suit l'accroche ; sur ordinateur, elle
              occupe la colonne de droite et reste en vue. */}
          <div className="min-w-0 lg:sticky lg:top-24">
            <div
              id="don"
              ref={donationCardRef}
              data-testid="vip-donation-card"
              className="vip-reveal min-w-0 scroll-mt-24"
              style={{ animationDelay: '80ms' }}
            >
              {ready && !ready.settings.donationsEnabled ? (
                <DonationPausedCard message={ready.settings.pausedMessage} />
              ) : (
                <AnimatedBorderCard
                  highlightColor="234 179 8"
                  backgroundColor="12 12 12"
                  animationSpeed={0.5}
                  style={DONATION_CARD_STYLE}
                  className="p-5 sm:p-6"
                >
                  {ready
                    ? <DonationForm settings={ready.settings} availability={ready.availability} />
                    : <DonationSkeleton />}
                </AnimatedBorderCard>
              )}
            </div>
            <DonationLinks matrixUrl={matrixUrl} discordUrl={discordUrl} />
          </div>
        </div>

        <section
          data-testid="vip-faq"
          className="vip-reveal mt-12 border-t border-white/[0.07] pt-10 sm:mt-16"
          style={{ animationDelay: '200ms' }}
        >
          <div className="flex items-center gap-3">
            <span
              data-vip-icon="vip-faq"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400"
              aria-hidden="true"
            >
              <BadgeCheck className="h-5 w-5" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {t('vip.learnMore')}
            </h2>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {FAQ_ITEMS.map(({ icon: Icon, title, body }, index) => (
              <details
                key={title}
                data-testid={`vip-faq-${index}`}
                className="vip-card-hover vip-details group min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
                  <span
                    data-vip-icon={`vip-faq-${index}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400"
                    aria-hidden="true"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1 font-medium leading-snug text-white">{t(title)}</span>
                  <span
                    data-vip-icon={`vip-faq-chevron-${index}`}
                    className="inline-flex text-yellow-400 transition-transform duration-200 group-open:rotate-90"
                    aria-hidden="true"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </summary>
                <p className="break-words border-t border-white/[0.06] px-4 pb-4 pt-3 text-sm leading-6 text-white/65">
                  {t(body)}
                </p>
              </details>
            ))}
          </div>
        </section>
      </div>
    </SquareBackground>
  );
};

export default VipPage;
