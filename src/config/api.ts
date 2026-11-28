// Ancien point d'entrée conservé pour les modules qui utilisent encore
// `API_BASE_URL`. Il doit désormais suivre exactement la même origine que les
// services (`MAIN_API`) : un fallback production codé en dur pouvait envoyer la
// vérification des droits vers la prod pendant que les mutations restaient sur
// l'origine courante (preview).
import { MAIN_API } from './runtime';

export const API_BASE_URL = MAIN_API;
