import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdminDashboard from '../components/AdminDashboard';
import { SquareBackground } from '../components/ui/square-background';
import { checkAdminAccess } from '../services/adminAccessService';
import type { AdminRole } from '../components/admin/adminRegistry';
import '../components/admin/admin-console.css';

interface AdminIdentity {
  userId?: string;
  userType?: string;
  adminId?: string | number;
}

const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [bgMode] = useState<'combined' | 'static' | 'animated'>(() => {
    return (localStorage.getItem('settings_bg_mode') as 'combined' | 'static' | 'animated') || 'combined';
  });

  useEffect(() => {
    const checkAdminAuth = async () => {
      const access = await checkAdminAccess();
      if (!access) {
        setIsAuthenticated(false);
        return;
      }

      setIdentity(access.identity);
      setAdminRole(access.role);
      setIsAuthenticated(true);
    };

    void checkAdminAuth().catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === null) {
    return (
      <SquareBackground
        mode={bgMode}
        borderColor="rgba(255,255,255,0.07)"
        className="min-h-screen bg-black text-white flex items-center justify-center"
      >
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-white" />
          <p className="text-sm text-white/60">{t('admin.verifyingRights')}</p>
        </div>
      </SquareBackground>
    );
  }

  if (!isAuthenticated || !adminRole) {
    return <Navigate to="/" replace />;
  }

  return <AdminDashboard role={adminRole} identity={identity} />;
};

export default AdminPage;
