// Fonction pour obtenir l'URL de redirection de manière dynamique
const getRedirectUri = () => {
  // Utiliser le domaine actuel du site dans tous les cas
  // Tous les domaines doivent être autorisés dans Google Cloud Console
  return `${window.location.origin}/auth/google`;
};

export const GOOGLE_CONFIG = {
  CLIENT_ID: '240076922442-1poqc3eaqlt5c5j41vo60m1al5b2odc3.apps.googleusercontent.com',
  
  get REDIRECT_URI() {
    return getRedirectUri();
  },
  SCOPES: ['email', 'profile']
}; 