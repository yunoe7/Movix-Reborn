import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clapperboard,
  Flag,
  GalleryHorizontalEnd,
  Gift,
  HandCoins,
  HelpCircle,
  KeyRound,
  Link2,
  ListOrdered,
  Megaphone,
  MessageSquare,
  Plug,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  Wrench
} from 'lucide-react';

import AdminComments from './AdminComments';
import AdminHelpFeedback from './AdminHelpFeedback';
import AdminHeroPromos from './AdminHeroPromos';
import AdminMonetizationSettings from './AdminMonetizationSettings';
import AdminLinkSubmissions from './Greenlight/AdminLinkSubmissions';
import AdminWishboard from './Greenlight/AdminWishboard';
import AdminOAuthApps from './AdminOAuthApps';
import AdminReferralSettings from './AdminReferralSettings';
import AdminReports from './AdminReports';
import AdminSharedLists from './AdminSharedLists';
import AdminTeam from './AdminTeam';
import AdminVipDonationSettings from './AdminVipDonationSettings';
import StreamingLinksManager from './StreamingLinksManager';
import VipInvoicesManager from './VipInvoicesManager';
import VipKeysManager from './VipKeysManager';
import AnimatedBorderCard from './ui/animated-border-card';
import ShinyText from './ui/shiny-text';

type AdminSection =
  | 'links'
  | 'vip-keys'
  | 'vip-invoices'
  | 'vip-donation-settings'
  | 'monetization'
  | 'hero-promos'
  | 'referral'
  | 'oauth-apps'
  | 'wishboard'
  | 'link-submissions'
  | 'comments'
  | 'shared-lists'
  | 'reports'
  | 'help-feedback'
  | 'team';

interface AdminDashboardProps {
  role: 'admin' | 'uploader';
}

interface DashboardSection {
  id: AdminSection;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  highlight: string;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ role }) => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<AdminSection>('links');

  const allSections = useMemo<DashboardSection[]>(
    () => [
      {
        id: 'team',
        title: t('admin.team.cardTitle', 'Admins & Uploaders'),
        description: t('admin.team.cardDesc', 'Gérer l\'équipe, ajouter des uploaders et voir leur historique'),
        icon: Users,
        accent: 'text-sky-300',
        highlight: '56 189 248'
      },
      {
        id: 'links',
        title: t('admin.manageMoviesSeries'),
        description: t('admin.manageStreamingLinksDesc'),
        icon: Clapperboard,
        accent: 'text-blue-300',
        highlight: '59 130 246'
      },
      {
        id: 'vip-keys',
        title: t('admin.manageVipKeys'),
        description: t('admin.manageVipKeysDesc'),
        icon: KeyRound,
        accent: 'text-emerald-300',
        highlight: '16 185 129'
      },
      {
        id: 'vip-invoices',
        title: t('vipDonations.admin.dashboardTitle'),
        description: t('vipDonations.admin.dashboardDescription'),
        icon: Sparkles,
        accent: 'text-yellow-300',
        highlight: '234 179 8'
      },
      {
        id: 'vip-donation-settings',
        title: t('vipDonations.settings.dashboardTitle'),
        description: t('vipDonations.settings.dashboardDescription'),
        icon: HandCoins,
        accent: 'text-amber-300',
        highlight: '245 158 11'
      },
      {
        id: 'monetization',
        title: t('admin.monetization.dashboardTitle'),
        description: t('admin.monetization.dashboardDescription'),
        icon: Megaphone,
        accent: 'text-lime-300',
        highlight: '132 204 22'
      },
      {
        id: 'hero-promos',
        title: t('heroPromo.admin.dashboardTitle'),
        description: t('heroPromo.admin.dashboardDescription'),
        icon: GalleryHorizontalEnd,
        accent: 'text-orange-300',
        highlight: '251 146 60'
      },
      {
        id: 'referral',
        title: t('referral.admin.dashboardTitle'),
        description: t('referral.admin.dashboardDescription'),
        icon: Gift,
        accent: 'text-pink-300',
        highlight: '236 72 153'
      },
      {
        id: 'oauth-apps',
        title: t('adminOauthApps.cardTitle'),
        description: t('adminOauthApps.cardDesc'),
        icon: Plug,
        accent: 'text-purple-300',
        highlight: '168 85 247'
      },
      {
        id: 'wishboard',
        title: t('admin.wishboardGreenlight'),
        description: t('admin.manageContentRequests'),
        icon: Sprout,
        accent: 'text-red-300',
        highlight: '239 68 68'
      },
      {
        id: 'link-submissions',
        title: t('admin.submittedLinks'),
        description: t('admin.reviewSubmittedLinksDesc'),
        icon: Link2,
        accent: 'text-teal-300',
        highlight: '20 184 166'
      },
      {
        id: 'comments',
        title: t('admin.manageComments'),
        description: t('admin.manageCommentsDesc'),
        icon: MessageSquare,
        accent: 'text-fuchsia-300',
        highlight: '217 70 239'
      },
      {
        id: 'shared-lists',
        title: t('admin.sharedLists'),
        description: t('admin.manageSharedListsDesc'),
        icon: ListOrdered,
        accent: 'text-orange-300',
        highlight: '249 115 22'
      },
      {
        id: 'reports',
        title: t('admin.reports', 'Signalements'),
        description: t('admin.manageReportsDesc', 'Gérer les signalements de commentaires et listes'),
        icon: Flag,
        accent: 'text-rose-300',
        highlight: '244 63 94'
      },
      {
        id: 'help-feedback',
        title: t('admin.helpFeedback.sectionTitle'),
        description: t('admin.helpFeedback.sectionDesc'),
        icon: HelpCircle,
        accent: 'text-sky-300',
        highlight: '56 189 248'
      }
    ],
    [t]
  );

  const sections = useMemo(() => {
    if (role === 'uploader') {
      return allSections.filter((section) => (
        section.id === 'links'
        || section.id === 'wishboard'
        || section.id === 'link-submissions'
      ));
    }

    return allSections;
  }, [allSections, role]);

  const activeSectionMeta = sections.find((section) => section.id === activeSection) || sections[0];

  const navigationGroups: { title: string; ids: AdminSection[] }[] = [
    {
      title: t('admin.navigation.content', 'Contenu'),
      ids: ['links', 'wishboard', 'link-submissions', 'hero-promos']
    },
    {
      title: t('admin.navigation.community', 'Communauté'),
      ids: ['comments', 'shared-lists', 'reports', 'help-feedback']
    },
    {
      title: t('admin.navigation.business', 'VIP & revenus'),
      ids: ['vip-keys', 'vip-invoices', 'vip-donation-settings', 'monetization', 'referral']
    },
    {
      title: t('admin.navigation.access', 'Accès & équipe'),
      ids: ['team', 'oauth-apps']
    }
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-5 lg:px-7">
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#0b1020]/85 px-4 py-4 shadow-[0_16px_50px_rgba(0,0,0,0.22)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-300/20 bg-indigo-400/10 text-indigo-200 shadow-[0_0_24px_rgba(99,102,241,0.12)]">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200/65">MOVIX / CONTROL CENTER</p>
            <h1 className="text-lg font-semibold tracking-tight text-white sm:text-xl">
              {role === 'uploader' ? t('admin.uploaderSpace') : t('admin.movixAdministration')}
            </h1>
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/65">
          <span className={`h-1.5 w-1.5 rounded-full ${role === 'admin' ? 'bg-indigo-300 shadow-[0_0_8px_rgba(129,140,248,0.8)]' : 'bg-sky-300'}`} />
          {role === 'admin' ? t('admin.adminInterface') : t('admin.streamingLinksManagement')}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:gap-6">
        <aside className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#090e1b]/90 shadow-[0_18px_55px_rgba(0,0,0,0.25)] backdrop-blur-xl lg:sticky lg:top-24">
          <div className="hidden border-b border-white/[0.07] px-5 py-5 lg:block">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400/20 to-blue-500/10 text-indigo-200 ring-1 ring-indigo-300/20">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Movix Admin</p>
                <p className="text-[11px] text-white/35">{t('admin.adminInterface')}</p>
              </div>
            </div>
          </div>

          <nav aria-label={t('admin.navigation.label', 'Navigation administration')} className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:block lg:space-y-5 lg:p-3">
            {navigationGroups.map((group) => {
              const groupSections = group.ids
                .map((id) => sections.find((section) => section.id === id))
                .filter((section): section is DashboardSection => Boolean(section));

              if (groupSections.length === 0) return null;

              return (
                <div key={group.title} className="min-w-0">
                  <p className="hidden px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30 lg:block">
                    {group.title}
                  </p>
                  <div className="space-y-1">
                    {groupSections.map((section) => {
                      const Icon = section.icon;
                      const isActive = activeSection === section.id;

                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setActiveSection(section.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`group flex min-h-[46px] w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 sm:gap-3 ${isActive
                            ? 'border-indigo-300/20 bg-gradient-to-r from-indigo-500/20 to-blue-500/[0.08] text-white shadow-[inset_2px_0_0_rgba(165,180,252,0.9),0_8px_24px_rgba(49,46,129,0.12)]'
                            : 'border-transparent text-white/55 hover:border-white/[0.07] hover:bg-white/[0.045] hover:text-white/90'
                          }`}
                        >
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-indigo-300/15 text-indigo-100' : 'bg-white/[0.035] text-white/45 group-hover:bg-white/[0.07] group-hover:text-white/80'}`}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium sm:text-[13px]">{section.title}</span>
                          {isActive && <span className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-200 shadow-[0_0_8px_rgba(165,180,252,0.9)] lg:block" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="hidden border-t border-white/[0.07] px-5 py-4 lg:block">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/25">MOVIX REBORN</p>
            <p className="mt-1 text-[11px] text-white/35">Premium administration</p>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-200/55">{t('admin.navigation.workspace', 'Espace de travail')}</p>
              <p className="mt-1 text-sm text-white/45">{activeSectionMeta?.description || t('admin.adminInterface')}</p>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-[11px] text-white/40">
              {sections.length} {t('admin.navigation.sections', 'sections')}
            </span>
          </div>

      {activeSection === 'vip-invoices' && role === 'admin' ? (
        <div>
          <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
            <ShieldCheck className="h-6 w-6 text-yellow-300" />
            {t('vipDonations.admin.dashboardTitle')}
          </h2>
          <VipInvoicesManager />
        </div>
      ) : (
        <AnimatedBorderCard
          highlightColor={activeSectionMeta?.highlight || '234 179 8'}
          backgroundColor="10 10 10"
          className="p-6 md:p-7"
        >
          {activeSection === 'team' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Users className="h-6 w-6 text-sky-300" />
                {t('admin.team.cardTitle', 'Admins & Uploaders')}
              </h2>
              <AdminTeam />
            </div>
          )}

          {activeSection === 'links' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Clapperboard className="h-6 w-6 text-blue-300" />
                {t('admin.manageMoviesSeries')}
              </h2>
              <StreamingLinksManager />
            </div>
          )}

          {activeSection === 'vip-keys' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <KeyRound className="h-6 w-6 text-emerald-300" />
                {t('admin.manageVipKeys')}
              </h2>
              <VipKeysManager />
            </div>
          )}

          {activeSection === 'vip-donation-settings' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <HandCoins className="h-6 w-6 text-amber-300" />
                {t('vipDonations.settings.dashboardTitle')}
              </h2>
              <AdminVipDonationSettings />
            </div>
          )}

          {activeSection === 'monetization' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Megaphone className="h-6 w-6 text-lime-300" />
                {t('admin.monetization.dashboardTitle')}
              </h2>
              <AdminMonetizationSettings />
            </div>
          )}

          {activeSection === 'hero-promos' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <GalleryHorizontalEnd className="h-6 w-6 text-orange-300" />
                {t('heroPromo.admin.dashboardTitle')}
              </h2>
              <AdminHeroPromos />
            </div>
          )}

          {activeSection === 'referral' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Gift className="h-6 w-6 text-pink-300" />
                {t('referral.admin.dashboardTitle')}
              </h2>
              <AdminReferralSettings />
            </div>
          )}

          {activeSection === 'wishboard' && (role === 'admin' || role === 'uploader') && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Sprout className="h-6 w-6 text-red-300" />
                {t('admin.wishboardGreenlight')}
              </h2>
              <AdminWishboard />
            </div>
          )}

          {activeSection === 'link-submissions' && (role === 'admin' || role === 'uploader') && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Link2 className="h-6 w-6 text-teal-300" />
                {t('admin.userSubmittedLinks')}
              </h2>
              <AdminLinkSubmissions />
            </div>
          )}

          {activeSection === 'comments' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <MessageSquare className="h-6 w-6 text-fuchsia-300" />
                {t('admin.manageComments')}
              </h2>
              <AdminComments />
            </div>
          )}

          {activeSection === 'shared-lists' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <ListOrdered className="h-6 w-6 text-orange-300" />
                {t('admin.sharedLists')}
              </h2>
              <AdminSharedLists />
            </div>
          )}

          {activeSection === 'reports' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Flag className="h-6 w-6 text-rose-300" />
                {t('admin.reports', 'Signalements')}
              </h2>
              <AdminReports />
            </div>
          )}

          {activeSection === 'help-feedback' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <HelpCircle className="h-6 w-6 text-sky-300" />
                {t('admin.helpFeedback.sectionTitle')}
              </h2>
              <AdminHelpFeedback />
            </div>
          )}

          {activeSection === 'oauth-apps' && role === 'admin' && (
            <div>
              <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold text-white">
                <Plug className="h-6 w-6 text-purple-300" />
                {t('adminOauthApps.cardTitle')}
              </h2>
              <AdminOAuthApps />
            </div>
          )}
        </AnimatedBorderCard>
      )}

        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
