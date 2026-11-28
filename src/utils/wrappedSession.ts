import { getResolvedAccountContext } from './accountAuth';

export interface WrappedSession {
  token: string | null;
  profileId: string | null;
  collectionEnabled: boolean;
}

/**
 * Session Wrapped liée au compte courant. La clé globale `selected_profile_id`
 * peut encore appartenir au compte précédent pendant une transition : la
 * sélection account-scopée fait autorité dès qu'elle existe.
 */
function readWrappedSession(
  storage: Pick<Storage, 'getItem'> = localStorage,
  fallbackProfileId: string | null = null
): WrappedSession {
  let scopedProfileId: string | null = null;
  let hasAccount = false;
  try {
    const { userType, userId } = getResolvedAccountContext();
    hasAccount = Boolean(userType && userId);
    if (hasAccount) {
      scopedProfileId = storage.getItem(`movix_selected_profile:${userType}:${encodeURIComponent(userId!)}`);
    }
  } catch {
    // Sans contexte de compte, on garde le comportement historique.
  }

  const globalProfileId = storage.getItem('selected_profile_id');
  const profileId = scopedProfileId || fallbackProfileId || (hasAccount ? null : globalProfileId);
  return {
    token: storage.getItem('auth_token'),
    profileId,
    collectionEnabled: storage.getItem('privacy_data_collection') !== 'false'
  };
}

export { readWrappedSession };
