import { MAIN_API } from '../config/runtime';
import { normalizeAdminRole, type AdminRole } from '../components/admin/adminRegistry';

export interface AdminAccessResult {
  role: AdminRole;
  identity: {
    userId?: string;
    userType?: string;
    adminId?: string | number;
  } | null;
}

/**
 * Unique vérification de droits admin côté client.
 *
 * `MAIN_API` est la même origine que celle utilisée par tous les services
 * admin : la porte et les mutations ne peuvent plus diverger entre la prod et
 * un preview. Le serveur reste la seule autorité ; cette fonction ne sert
 * qu'à afficher/masquer l'UI.
 */
export async function checkAdminAccess(): Promise<AdminAccessResult | null> {
  let authToken: string | null;
  try {
    authToken = localStorage.getItem('auth_token');
  } catch {
    return null;
  }

  if (!authToken) return null;

  try {
    const response = await fetch(`${MAIN_API}/api/admin/check`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    if (!response.ok) return null;

    const payload = await response.json().catch(() => null);
    const role = normalizeAdminRole(payload?.admin?.role);
    if (payload?.success !== true || !role) return null;

    return {
      role,
      identity: payload.admin
        ? {
            userId: payload.admin.userId,
            userType: payload.admin.userType,
            adminId: payload.admin.adminId,
          }
        : null,
    };
  } catch {
    return null;
  }
}
