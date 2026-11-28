import type { TFunction } from 'i18next';
import {
  Clapperboard,
  Crown,
  FileText,
  Flag,
  GalleryHorizontalEnd,
  Gauge,
  Gift,
  HandCoins,
  HelpCircle,
  Home,
  KeyRound,
  LayoutGrid,
  Link2,
  ListOrdered,
  Megaphone,
  MessageSquare,
  Palette,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  Wrench,
  type LucideIcon,
} from '../icons/Icons8';

export type AdminRole = 'admin' | 'moderator' | 'uploader';

export type AdminSectionId =
  | 'overview'
  | 'links'
  | 'wishboard'
  | 'link-submissions'
  | 'comments'
  | 'reports'
  | 'shared-lists'
  | 'vip-keys'
  | 'vip-invoices'
  | 'vip-donation-settings'
  | 'monetization'
  | 'hero-promos'
  | 'team-selection'
  | 'referral'
  | 'oauth-apps'
  | 'team'
  | 'help-feedback'
  | 'release-notes'
  | 'whats-new'
  | 'decor'
  | 'diagnostics';

export type AdminGroupId =
  | 'dashboard'
  | 'users'
  | 'vip'
  | 'content'
  | 'extensions'
  | 'decor'
  | 'settings'
  | 'diagnostics'
  | 'other';

export type AdminSubgroupId =
  | 'accounts'
  | 'access'
  | 'programs'
  | 'catalog'
  | 'requests'
  | 'moderation'
  | 'integrations'
  | 'decor'
  | 'revenue'
  | 'communication'
  | 'health'
  | 'feedback';

type Translate = TFunction;

export interface AdminGroupMeta {
  id: AdminGroupId;
  labelKey: string;
  labelDefault: string;
  icon: LucideIcon;
}

export interface AdminSubgroupMeta {
  id: AdminSubgroupId;
  labelKey: string;
  labelDefault: string;
}

export interface AdminSectionMeta {
  id: AdminSectionId;
  titleKey: string;
  titleDefault: string;
  title: string;
  descriptionKey: string;
  descriptionDefault: string;
  description: string;
  group: AdminGroupId;
  subgroup?: AdminSubgroupId;
  icon: LucideIcon;
  keywords: string[];
  allowedRoles: AdminRole[];
}

const ADMIN: AdminRole[] = ['admin'];
const OPERATORS: AdminRole[] = ['admin', 'moderator', 'uploader'];
const SUBMISSIONS: AdminRole[] = ['admin', 'uploader'];

export const ADMIN_GROUPS: AdminGroupMeta[] = [
  { id: 'dashboard', labelKey: 'admin.console.groupDashboard', labelDefault: 'Tableau de bord', icon: LayoutGrid },
  { id: 'users', labelKey: 'admin.console.groupUsers', labelDefault: 'Utilisateurs & équipe', icon: Users },
  { id: 'vip', labelKey: 'admin.console.groupVip', labelDefault: 'VIP & abonnements', icon: Crown },
  { id: 'content', labelKey: 'admin.console.groupContent', labelDefault: 'Contenus & lecteurs', icon: Clapperboard },
  { id: 'extensions', labelKey: 'admin.console.groupExtensions', labelDefault: 'Extensions & API', icon: Plug },
  { id: 'decor', labelKey: 'admin.console.groupDecor', labelDefault: 'Décoratif', icon: Palette },
  { id: 'settings', labelKey: 'admin.console.groupSettings', labelDefault: 'Paramètres', icon: Settings },
  { id: 'diagnostics', labelKey: 'admin.console.groupDiagnostics', labelDefault: 'Logs & diagnostics', icon: Gauge },
  { id: 'other', labelKey: 'admin.console.groupOther', labelDefault: 'Autres', icon: Wrench },
];

export const ADMIN_SUBGROUPS: AdminSubgroupMeta[] = [
  { id: 'accounts', labelKey: 'admin.console.subgroupAccounts', labelDefault: 'Comptes' },
  { id: 'access', labelKey: 'admin.console.subgroupAccess', labelDefault: 'Accès & factures' },
  { id: 'programs', labelKey: 'admin.console.subgroupPrograms', labelDefault: 'Programmes' },
  { id: 'catalog', labelKey: 'admin.console.subgroupCatalog', labelDefault: 'Catalogue & lecteurs' },
  { id: 'requests', labelKey: 'admin.console.subgroupRequests', labelDefault: 'Demandes & soumissions' },
  { id: 'moderation', labelKey: 'admin.console.subgroupModeration', labelDefault: 'Modération' },
  { id: 'integrations', labelKey: 'admin.console.subgroupIntegrations', labelDefault: 'Intégrations' },
  { id: 'decor', labelKey: 'admin.console.subgroupDecor', labelDefault: 'Bibliothèque future' },
  { id: 'revenue', labelKey: 'admin.console.subgroupRevenue', labelDefault: 'Revenus' },
  { id: 'communication', labelKey: 'admin.console.subgroupCommunication', labelDefault: 'Communication' },
  { id: 'health', labelKey: 'admin.console.subgroupHealth', labelDefault: 'État & source' },
  { id: 'feedback', labelKey: 'admin.console.subgroupFeedback', labelDefault: 'Retours' },
];

export function getAdminSections(t: Translate): AdminSectionMeta[] {
  const seeds: Array<Omit<AdminSectionMeta, 'title' | 'description'>> = [
    {
      id: 'overview',
      titleKey: 'admin.console.overviewTitle',
      titleDefault: 'Vue d’ensemble',
      descriptionKey: 'admin.console.overviewDesc',
      descriptionDefault: 'Données réelles et état des services',
      group: 'dashboard',
      icon: Home,
      keywords: ['dashboard', 'stats', 'statistiques', 'accueil', 'overview', 'activite', 'tableau de bord'],
      allowedRoles: OPERATORS,
    },
    {
      id: 'team',
      titleKey: 'admin.team.cardTitle',
      titleDefault: 'Équipe',
      descriptionKey: 'admin.team.cardDesc',
      descriptionDefault: 'Admins, uploaders et historique',
      group: 'users',
      subgroup: 'accounts',
      icon: Users,
      keywords: ['equipe', 'team', 'admins', 'uploaders', 'roles', 'utilisateurs', 'users'],
      allowedRoles: ADMIN,
    },
    {
      id: 'vip-keys',
      titleKey: 'admin.manageVipKeys',
      titleDefault: 'Clés VIP',
      descriptionKey: 'admin.manageVipKeysDesc',
      descriptionDefault: 'Créer, modifier et révoquer les accès',
      group: 'vip',
      subgroup: 'access',
      icon: KeyRound,
      keywords: ['vip', 'cles', 'acces', 'keys', 'abonnements'],
      allowedRoles: ADMIN,
    },
    {
      id: 'vip-invoices',
      titleKey: 'vipDonations.admin.dashboardTitle',
      titleDefault: 'Factures VIP',
      descriptionKey: 'vipDonations.admin.dashboardDescription',
      descriptionDefault: 'Valider ou annuler les paiements',
      group: 'vip',
      subgroup: 'access',
      icon: Sparkles,
      keywords: ['vip', 'factures', 'invoices', 'paiements', 'donations'],
      allowedRoles: ADMIN,
    },
    {
      id: 'vip-donation-settings',
      titleKey: 'vipDonations.settings.dashboardTitle',
      titleDefault: 'Paramètres VIP',
      descriptionKey: 'vipDonations.settings.dashboardDescription',
      descriptionDefault: 'Configuration des dons et récompenses',
      group: 'vip',
      subgroup: 'programs',
      icon: HandCoins,
      keywords: ['vip', 'dons', 'parametres', 'donations', 'recompenses'],
      allowedRoles: ADMIN,
    },
    {
      id: 'referral',
      titleKey: 'referral.admin.dashboardTitle',
      titleDefault: 'Parrainage',
      descriptionKey: 'referral.admin.dashboardDescription',
      descriptionDefault: 'Récompenses et parrainages en cours',
      group: 'vip',
      subgroup: 'programs',
      icon: Gift,
      keywords: ['parrainage', 'referral', 'recompenses', 'vip'],
      allowedRoles: ADMIN,
    },
    {
      id: 'links',
      titleKey: 'admin.manageMoviesSeries',
      titleDefault: 'Films & séries',
      descriptionKey: 'admin.manageStreamingLinksDesc',
      descriptionDefault: 'Liens de streaming et téléchargement',
      group: 'content',
      subgroup: 'catalog',
      icon: Clapperboard,
      keywords: ['liens', 'streaming', 'films', 'series', 'download', 'telechargement', 'catalogue', 'lecteur'],
      allowedRoles: OPERATORS,
    },
    {
      id: 'team-selection',
      titleKey: 'admin.teamSelection.title',
      titleDefault: 'Sélection de l’équipe',
      descriptionKey: 'admin.teamSelection.description',
      descriptionDefault: 'Choisir le film ou la série mis en avant sur l’accueil',
      group: 'content',
      subgroup: 'catalog',
      icon: Sparkles,
      keywords: ['selection', 'equipe', 'mise en avant', 'featured', 'home', 'tmdb'],
      allowedRoles: ADMIN,
    },
    {
      id: 'hero-promos',
      titleKey: 'heroPromo.admin.dashboardTitle',
      titleDefault: 'Promos du carrousel',
      descriptionKey: 'heroPromo.admin.dashboardDescription',
      descriptionDefault: 'Gérer les campagnes d’accueil',
      group: 'content',
      subgroup: 'catalog',
      icon: GalleryHorizontalEnd,
      keywords: ['hero', 'promos', 'carrousel', 'accueil', 'campagnes'],
      allowedRoles: ADMIN,
    },
    {
      id: 'wishboard',
      titleKey: 'admin.wishboardGreenlight',
      titleDefault: 'Wishboard / Greenlight',
      descriptionKey: 'admin.manageContentRequests',
      descriptionDefault: 'Demandes de contenu des utilisateurs',
      group: 'content',
      subgroup: 'requests',
      icon: Sprout,
      keywords: ['wishboard', 'greenlight', 'demandes', 'contenu', 'votes'],
      allowedRoles: SUBMISSIONS,
    },
    {
      id: 'link-submissions',
      titleKey: 'admin.submittedLinks',
      titleDefault: 'Liens soumis',
      descriptionKey: 'admin.reviewSubmittedLinksDesc',
      descriptionDefault: 'Examiner les liens envoyés par les utilisateurs',
      group: 'content',
      subgroup: 'requests',
      icon: Link2,
      keywords: ['soumissions', 'liens', 'approbation', 'moderation'],
      allowedRoles: SUBMISSIONS,
    },
    {
      id: 'comments',
      titleKey: 'admin.manageComments',
      titleDefault: 'Commentaires',
      descriptionKey: 'admin.manageCommentsDesc',
      descriptionDefault: 'Modérer, bannir et supprimer les doublons',
      group: 'content',
      subgroup: 'moderation',
      icon: MessageSquare,
      keywords: ['commentaires', 'moderation', 'bans', 'doublons', 'signalements'],
      allowedRoles: ADMIN,
    },
    {
      id: 'reports',
      titleKey: 'admin.reports',
      titleDefault: 'Signalements',
      descriptionKey: 'admin.manageReportsDesc',
      descriptionDefault: 'Traiter les signalements de commentaires',
      group: 'content',
      subgroup: 'moderation',
      icon: Flag,
      keywords: ['signalements', 'reports', 'moderation'],
      allowedRoles: ADMIN,
    },
    {
      id: 'shared-lists',
      titleKey: 'admin.sharedLists',
      titleDefault: 'Listes partagées',
      descriptionKey: 'admin.manageSharedListsDesc',
      descriptionDefault: 'Modérer les listes publiques',
      group: 'content',
      subgroup: 'moderation',
      icon: ListOrdered,
      keywords: ['listes', 'shared', 'partagees', 'moderation'],
      allowedRoles: ADMIN,
    },
    {
      id: 'oauth-apps',
      titleKey: 'adminOauthApps.cardTitle',
      titleDefault: 'Applications OAuth',
      descriptionKey: 'adminOauthApps.cardDesc',
      descriptionDefault: 'Clients, scopes et quotas VIP',
      group: 'extensions',
      subgroup: 'integrations',
      icon: Plug,
      keywords: ['oauth', 'api', 'clients', 'scopes', 'integrations', 'extensions'],
      allowedRoles: ADMIN,
    },
    {
      id: 'decor',
      titleKey: 'admin.console.decorTitle',
      titleDefault: 'Décoratif',
      descriptionKey: 'admin.console.decorDesc',
      descriptionDefault: 'Emplacement réservé aux décorations globales à venir',
      group: 'decor',
      subgroup: 'decor',
      icon: Palette,
      keywords: ['decoratif', 'decoration', 'animations', 'effets', 'arriere-plans', 'themes', 'graphiques'],
      allowedRoles: ADMIN,
    },
    {
      id: 'monetization',
      titleKey: 'admin.monetization.dashboardTitle',
      titleDefault: 'Monétisation',
      descriptionKey: 'admin.monetization.dashboardDescription',
      descriptionDefault: 'Placements publicitaires et statistiques',
      group: 'settings',
      subgroup: 'revenue',
      icon: Megaphone,
      keywords: ['pubs', 'monetisation', 'publicite', 'revenus', 'stats'],
      allowedRoles: ADMIN,
    },
    {
      id: 'whats-new',
      titleKey: 'admin.whatsNew.title',
      titleDefault: 'Gestion des nouveautés',
      descriptionKey: 'admin.whatsNew.description',
      descriptionDefault: 'Publier les annonces visibles par les utilisateurs',
      group: 'settings',
      subgroup: 'communication',
      icon: FileText,
      keywords: ['nouveautes', 'annonces', 'publication', 'changelog'],
      allowedRoles: ADMIN,
    },
    {
      id: 'release-notes',
      titleKey: 'admin.releaseNotes.title',
      titleDefault: 'Notes de version',
      descriptionKey: 'admin.releaseNotes.description',
      descriptionDefault: 'Rédiger les nouveautés et corrections',
      group: 'settings',
      subgroup: 'communication',
      icon: FileText,
      keywords: ['release', 'notes', 'version', 'nouveautes', 'corrections', 'mise a jour'],
      allowedRoles: ADMIN,
    },
    {
      id: 'diagnostics',
      titleKey: 'admin.console.diagnosticsTitle',
      titleDefault: 'Diagnostics',
      descriptionKey: 'admin.console.diagnosticsDesc',
      descriptionDefault: 'État des sources déjà utilisées par la console',
      group: 'diagnostics',
      subgroup: 'health',
      icon: Gauge,
      keywords: ['logs', 'diagnostics', 'sante', 'health', 'etat', 'endpoint', 'source'],
      allowedRoles: ADMIN,
    },
    {
      id: 'help-feedback',
      titleKey: 'admin.helpFeedback.sectionTitle',
      titleDefault: 'Feedback /help',
      descriptionKey: 'admin.helpFeedback.sectionDesc',
      descriptionDefault: 'Votes des tutoriels de l’aide',
      group: 'other',
      subgroup: 'feedback',
      icon: HelpCircle,
      keywords: ['aide', 'help', 'feedback', 'votes', 'tutos'],
      allowedRoles: ADMIN,
    },
  ];

  return seeds.map((section) => ({
    ...section,
    title: t(section.titleKey, section.titleDefault),
    description: t(section.descriptionKey, section.descriptionDefault),
  }));
}

export function getVisibleSections(sections: AdminSectionMeta[], role: AdminRole): AdminSectionMeta[] {
  return sections.filter((section) => section.allowedRoles.includes(role));
}

export function getGroupMeta(id: AdminGroupId): AdminGroupMeta {
  return ADMIN_GROUPS.find((group) => group.id === id) ?? ADMIN_GROUPS[0];
}

export function getSubgroupMeta(id?: AdminSubgroupId): AdminSubgroupMeta | null {
  if (!id) return null;
  return ADMIN_SUBGROUPS.find((subgroup) => subgroup.id === id) ?? null;
}

export function groupSections(sections: AdminSectionMeta[]): Array<{
  group: AdminGroupMeta;
  items: AdminSectionMeta[];
  subsections: Array<{ meta: AdminSubgroupMeta; items: AdminSectionMeta[] }>;
}> {
  return ADMIN_GROUPS
    .map((group) => {
      const groupItems = sections.filter((section) => section.group === group.id);
      const subsections = ADMIN_SUBGROUPS
        .map((meta) => ({ meta, items: groupItems.filter((section) => section.subgroup === meta.id) }))
        .filter((entry) => entry.items.length > 0);
      const loose = groupItems.filter((section) => !section.subgroup);
      return {
        group,
        items: [...loose, ...subsections.flatMap((entry) => entry.items)],
        subsections,
      };
    })
    .filter((entry) => entry.items.length > 0);
}

function normalizeSearchValue(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function searchSections(sections: AdminSectionMeta[], query: string): AdminSectionMeta[] {
  const needle = normalizeSearchValue(query.trim());
  if (!needle) return [];
  return sections.filter((section) => (
    normalizeSearchValue(section.title).includes(needle)
    || normalizeSearchValue(section.description).includes(needle)
    || normalizeSearchValue(section.id).includes(needle)
    || section.keywords.some((keyword) => normalizeSearchValue(keyword).includes(needle))
  ));
}

export function normalizeAdminRole(rawRole: unknown): AdminRole | null {
  const role = typeof rawRole === 'string' ? rawRole.trim().toLowerCase() : '';
  if (role === 'admin' || role === 'owner') return 'admin';
  if (role === 'moderator' || role === 'mod') return 'moderator';
  if (role === 'uploader') return 'uploader';
  return null;
}

export function getRoleLabel(t: Translate, role: AdminRole): string {
  if (role === 'admin') return t('admin.console.roleAdmin', 'Admin');
  if (role === 'moderator') return t('admin.console.roleModerator', 'Modérateur');
  return t('admin.console.roleUploader', 'Uploader');
}

const SECTION_ICONS: Record<AdminSectionId, LucideIcon> = {
  overview: Home,
  links: Clapperboard,
  wishboard: Sprout,
  'link-submissions': Link2,
  comments: MessageSquare,
  reports: Flag,
  'shared-lists': ListOrdered,
  'vip-keys': KeyRound,
  'vip-invoices': Sparkles,
  'vip-donation-settings': HandCoins,
  monetization: Megaphone,
  'hero-promos': GalleryHorizontalEnd,
  'team-selection': Sparkles,
  referral: Gift,
  'oauth-apps': Plug,
  team: Users,
  'help-feedback': HelpCircle,
  'release-notes': FileText,
  'whats-new': FileText,
  decor: Palette,
  diagnostics: Gauge,
};

export function getSectionIcon(id: AdminSectionId): LucideIcon {
  return SECTION_ICONS[id] ?? LayoutGrid;
}

export function getGroupIcon(id: AdminGroupId): LucideIcon {
  return getGroupMeta(id).icon ?? ShieldCheck;
}
