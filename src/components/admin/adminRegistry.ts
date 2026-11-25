import type { LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Clapperboard, Flag, GalleryHorizontalEnd, Gift, HandCoins, HelpCircle, Home, KeyRound, LayoutGrid, Link2, ListOrdered, Megaphone, MessageSquare, Plug, ShieldCheck, Sparkles, Sprout, Users, FileText } from 'lucide-react';

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
  | 'release-notes';

export type AdminGroupId = 'overview' | 'moderation' | 'catalog' | 'revenue' | 'platform';

type Translate = TFunction;

export interface AdminGroupMeta {
  id: AdminGroupId;
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
  icon: LucideIcon;
  keywords: string[];
  allowedRoles: AdminRole[];
}

const ADMIN: AdminRole[] = ['admin'];
const OPERATORS: AdminRole[] = ['admin', 'moderator', 'uploader'];
const SUBMISSIONS: AdminRole[] = ['admin', 'uploader'];

export const ADMIN_GROUPS: AdminGroupMeta[] = [
  { id: 'overview', labelKey: 'admin.console.groupOverview', labelDefault: 'Pilotage' },
  { id: 'moderation', labelKey: 'admin.console.groupModeration', labelDefault: 'Modération' },
  { id: 'catalog', labelKey: 'admin.console.groupCatalog', labelDefault: 'Catalogue' },
  { id: 'revenue', labelKey: 'admin.console.groupRevenue', labelDefault: 'Revenus & accès' },
  { id: 'platform', labelKey: 'admin.console.groupPlatform', labelDefault: 'Plateforme' },
];

export function getAdminSections(t: Translate): AdminSectionMeta[] {
  const seeds: Array<Omit<AdminSectionMeta, 'title' | 'description'>> = [
    {
      id: 'overview',
      titleKey: 'admin.console.overviewTitle',
      titleDefault: 'Vue d’ensemble',
      descriptionKey: 'admin.console.overviewDesc',
      descriptionDefault: 'Données réelles et état des services',
      group: 'overview',
      icon: Home,
      keywords: ['dashboard', 'stats', 'statistiques', 'accueil', 'overview', 'activite'],
      allowedRoles: OPERATORS,
    },
    {
      id: 'links',
      titleKey: 'admin.manageMoviesSeries',
      titleDefault: 'Films & séries',
      descriptionKey: 'admin.manageStreamingLinksDesc',
      descriptionDefault: 'Liens de streaming et téléchargement',
      group: 'catalog',
      icon: Clapperboard,
      keywords: ['liens', 'streaming', 'films', 'series', 'download', 'telechargement', 'catalogue'],
      allowedRoles: OPERATORS,
    },
    {
      id: 'wishboard',
      titleKey: 'admin.wishboardGreenlight',
      titleDefault: 'Wishboard / Greenlight',
      descriptionKey: 'admin.manageContentRequests',
      descriptionDefault: 'Demandes de contenu des utilisateurs',
      group: 'moderation',
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
      group: 'moderation',
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
      group: 'moderation',
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
      group: 'moderation',
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
      group: 'moderation',
      icon: ListOrdered,
      keywords: ['listes', 'shared', 'partagees', 'moderation'],
      allowedRoles: ADMIN,
    },
    {
      id: 'vip-keys',
      titleKey: 'admin.manageVipKeys',
      titleDefault: 'Clés VIP',
      descriptionKey: 'admin.manageVipKeysDesc',
      descriptionDefault: 'Créer, modifier et révoquer les accès',
      group: 'revenue',
      icon: KeyRound,
      keywords: ['vip', 'cles', 'acces', 'keys'],
      allowedRoles: ADMIN,
    },
    {
      id: 'vip-invoices',
      titleKey: 'vipDonations.admin.dashboardTitle',
      titleDefault: 'Factures VIP',
      descriptionKey: 'vipDonations.admin.dashboardDescription',
      descriptionDefault: 'Valider ou annuler les paiements',
      group: 'revenue',
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
      group: 'revenue',
      icon: HandCoins,
      keywords: ['vip', 'dons', 'parametres', 'donations', 'recompenses'],
      allowedRoles: ADMIN,
    },
    {
      id: 'monetization',
      titleKey: 'admin.monetization.dashboardTitle',
      titleDefault: 'Monétisation',
      descriptionKey: 'admin.monetization.dashboardDescription',
      descriptionDefault: 'Placements publicitaires et statistiques',
      group: 'revenue',
      icon: Megaphone,
      keywords: ['pubs', 'monetisation', 'publicite', 'revenus', 'stats'],
      allowedRoles: ADMIN,
    },
    {
      id: 'hero-promos',
      titleKey: 'heroPromo.admin.dashboardTitle',
      titleDefault: 'Promos du carrousel',
      descriptionKey: 'heroPromo.admin.dashboardDescription',
      descriptionDefault: 'Gérer les campagnes d’accueil',
      group: 'revenue',
      icon: GalleryHorizontalEnd,
      keywords: ['hero', 'promos', 'carrousel', 'accueil', 'campagnes'],
      allowedRoles: ADMIN,
    },
    {
      id: 'team-selection',
      titleKey: 'admin.teamSelection.title',
      titleDefault: 'Sélection de l’équipe',
      descriptionKey: 'admin.teamSelection.description',
      descriptionDefault: 'Choisir le film ou la série mis en avant sur l’accueil',
      group: 'catalog',
      icon: Sparkles,
      keywords: ['selection', 'equipe', 'mise en avant', 'featured', 'home', 'tmdb'],
      allowedRoles: ADMIN,
    },
    {
      id: 'referral',
      titleKey: 'referral.admin.dashboardTitle',
      titleDefault: 'Parrainage',
      descriptionKey: 'referral.admin.dashboardDescription',
      descriptionDefault: 'Récompenses et parrainages en cours',
      group: 'revenue',
      icon: Gift,
      keywords: ['parrainage', 'referral', 'recompenses', 'vip'],
      allowedRoles: ADMIN,
    },
    {
      id: 'oauth-apps',
      titleKey: 'adminOauthApps.cardTitle',
      titleDefault: 'Applications OAuth',
      descriptionKey: 'adminOauthApps.cardDesc',
      descriptionDefault: 'Clients, scopes et quotas VIP',
      group: 'platform',
      icon: Plug,
      keywords: ['oauth', 'api', 'clients', 'scopes', 'integrations'],
      allowedRoles: ADMIN,
    },
    {
      id: 'team',
      titleKey: 'admin.team.cardTitle',
      titleDefault: 'Équipe',
      descriptionKey: 'admin.team.cardDesc',
      descriptionDefault: 'Admins, uploaders et historique',
      group: 'platform',
      icon: Users,
      keywords: ['equipe', 'team', 'admins', 'uploaders', 'roles'],
      allowedRoles: ADMIN,
    },
    {
      id: 'release-notes',
      titleKey: 'admin.releaseNotes.title',
      titleDefault: 'Notes de version',
      descriptionKey: 'admin.releaseNotes.description',
      descriptionDefault: 'Rédiger les nouveautés et corrections',
      group: 'platform',
      icon: FileText,
      keywords: ['release', 'notes', 'version', 'nouveautes', 'corrections', 'mise a jour'],
      allowedRoles: ADMIN,
    },
    {
      id: 'help-feedback',
      titleKey: 'admin.helpFeedback.sectionTitle',
      titleDefault: 'Feedback /help',
      descriptionKey: 'admin.helpFeedback.sectionDesc',
      descriptionDefault: 'Votes des tutoriels de l’aide',
      group: 'platform',
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

export function groupSections(sections: AdminSectionMeta[]): Array<{ group: AdminGroupMeta; items: AdminSectionMeta[] }> {
  return ADMIN_GROUPS
    .map((group) => ({ group, items: sections.filter((section) => section.group === group.id) }))
    .filter((entry) => entry.items.length > 0);
}

export function searchSections(sections: AdminSectionMeta[], query: string): AdminSectionMeta[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return sections.filter((section) => (
    section.title.toLocaleLowerCase().includes(needle)
    || section.description.toLocaleLowerCase().includes(needle)
    || section.id.includes(needle)
    || section.keywords.some((keyword) => keyword.includes(needle))
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

export function getSectionIcon(id: AdminSectionId): LucideIcon {
  if (id === 'overview') return Home;
  if (id === 'links') return Clapperboard;
  if (id === 'wishboard') return Sprout;
  if (id === 'link-submissions') return Link2;
  if (id === 'comments') return MessageSquare;
  if (id === 'reports') return Flag;
  if (id === 'shared-lists') return ListOrdered;
  if (id === 'vip-keys') return KeyRound;
  if (id === 'vip-invoices') return Sparkles;
  if (id === 'vip-donation-settings') return HandCoins;
  if (id === 'monetization') return Megaphone;
  if (id === 'hero-promos') return GalleryHorizontalEnd;
  if (id === 'team-selection') return Sparkles;
  if (id === 'referral') return Gift;
  if (id === 'oauth-apps') return Plug;
  if (id === 'team') return Users;
  if (id === 'release-notes') return FileText;
  return HelpCircle;
}

export function getGroupIcon(id: AdminGroupId): LucideIcon {
  if (id === 'overview') return LayoutGrid;
  if (id === 'moderation') return ShieldCheck;
  if (id === 'catalog') return Clapperboard;
  if (id === 'revenue') return Gift;
  return Plug;
}
