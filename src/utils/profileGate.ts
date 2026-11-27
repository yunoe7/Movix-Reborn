/**
 * Décision du gate de profil, isolée du rendu pour pouvoir être vérifiée
 * sans navigateur. Un profil validé est requis avant de monter l'application :
 * sans lui, les restrictions d'âge retombent à 0 et le contrôle parental
 * devient inopérant.
 */
export type ProfileGateDecision = 'pass' | 'error' | 'loading' | 'select';

export interface ProfileGateInputs {
  isAuthenticated: boolean;
  /** Routes volontairement exemptées (lecture, WatchParty, OAuth, VIP…). */
  skipGate: boolean;
  loadingTimedOut: boolean;
  isLoading: boolean;
  profileCount: number;
  hasCurrentProfile: boolean;
}

export function resolveProfileGate({
  isAuthenticated,
  skipGate,
  loadingTimedOut,
  isLoading,
  profileCount,
  hasCurrentProfile,
}: ProfileGateInputs): ProfileGateDecision {
  if (!isAuthenticated || skipGate) return 'pass';
  // Le timeout n'est jamais une autorisation : il faut un profil chargé.
  if (loadingTimedOut) return 'error';
  if (isLoading || profileCount === 0) return 'loading';
  if (!hasCurrentProfile) return 'select';
  return 'pass';
}
