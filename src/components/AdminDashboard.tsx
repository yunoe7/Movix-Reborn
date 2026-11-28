import React, { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminComments from './AdminComments';
import AdminHelpFeedback from './AdminHelpFeedback';
import AdminHeroPromos from './AdminHeroPromos';
import AdminTeamSelection from './AdminTeamSelection';
import AdminMonetizationSettings from './AdminMonetizationSettings';
import AdminLinkSubmissions from './Greenlight/AdminLinkSubmissions';
import AdminWishboard from './Greenlight/AdminWishboard';
import AdminOAuthApps from './AdminOAuthApps';
import AdminReleaseNotes from './AdminReleaseNotes';
import AdminWhatsNew from './AdminWhatsNew';
import AdminReferralSettings from './AdminReferralSettings';
import AdminReports from './AdminReports';
import AdminSharedLists from './AdminSharedLists';
import AdminTeam from './AdminTeam';
import AdminVipDonationSettings from './AdminVipDonationSettings';
import StreamingLinksManager from './StreamingLinksManager';
import VipInvoicesManager from './VipInvoicesManager';
import VipKeysManager from './VipKeysManager';
import AdminDecor from './adminDecor/AdminDecor';
import AdminDiagnostics from './admin/AdminDiagnostics';
import { AdminConfirmProvider } from './admin/AdminConfirmProvider';
import AdminDashboardHome from './admin/AdminDashboardHome';
import AdminShell from './admin/AdminShell';
import {
  getAdminSections,
  getVisibleSections,
  type AdminRole,
  type AdminSectionId,
} from './admin/adminRegistry';
import { AdminStateBlock } from './admin/AdminUi';

interface AdminDashboardProps {
  role: AdminRole;
  identity?: { userId?: string; userType?: string; adminId?: string | number } | null;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ role, identity = null }) => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sections = useMemo(() => getAdminSections(t), [t]);
  const visibleSections = useMemo(() => getVisibleSections(sections, role), [sections, role]);

  const requestedSection = searchParams.get('section') as AdminSectionId | null;
  const activeSection: AdminSectionId = requestedSection
    && visibleSections.some((section) => section.id === requestedSection)
    ? requestedSection
    : 'overview';

  const navigate = useCallback((id: AdminSectionId) => {
    setSearchParams(id === 'overview' ? {} : { section: id }, { replace: false });
  }, [setSearchParams]);

  useEffect(() => {
    if (requestedSection && activeSection !== requestedSection) {
      setSearchParams({}, { replace: true });
    }
  }, [activeSection, requestedSection, setSearchParams]);

  const content = useMemo(() => {
    switch (activeSection) {
      case 'overview':
        return <AdminDashboardHome role={role} visibleSections={visibleSections} onNavigate={navigate} />;
      case 'links':
        return <StreamingLinksManager />;
      case 'wishboard':
        return <AdminWishboard />;
      case 'link-submissions':
        return <AdminLinkSubmissions />;
      case 'comments':
        return <AdminComments />;
      case 'reports':
        return <AdminReports />;
      case 'shared-lists':
        return <AdminSharedLists />;
      case 'vip-keys':
        return <VipKeysManager />;
      case 'vip-invoices':
        return <VipInvoicesManager />;
      case 'vip-donation-settings':
        return <AdminVipDonationSettings />;
      case 'monetization':
        return <AdminMonetizationSettings />;
      case 'hero-promos':
        return <AdminHeroPromos />;
      case 'team-selection':
        return <AdminTeamSelection />;
      case 'referral':
        return <AdminReferralSettings />;
      case 'oauth-apps':
        return <AdminOAuthApps />;
      case 'team':
        return <AdminTeam />;
      case 'help-feedback':
        return <AdminHelpFeedback />;
      case 'release-notes':
        return <AdminReleaseNotes />;
      case 'whats-new':
        return <AdminWhatsNew />;
      case 'decor':
        return <AdminDecor />;
      case 'diagnostics':
        return <AdminDiagnostics role={role} />;
      default:
        return (
          <AdminStateBlock
            tone="error"
            title={t('admin.console.forbiddenSection', 'Section indisponible')}
            description={t('admin.console.forbiddenSectionDesc', 'Votre rôle ne permet pas d’ouvrir cette section.')}
          />
        );
    }
  }, [activeSection, navigate, role, t, visibleSections]);

  return (
    <AdminConfirmProvider>
      <AdminShell
        role={role}
        identity={identity}
        sections={visibleSections}
        activeSection={activeSection}
        onNavigate={navigate}
      >
        <div key={activeSection} className="admin-section-content" aria-live="polite">
          {content}
        </div>
      </AdminShell>
    </AdminConfirmProvider>
  );
};

export default AdminDashboard;
