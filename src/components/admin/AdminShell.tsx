import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, LayoutGrid, Search, ShieldCheck, X } from '../icons/Icons8';
import {
  getGroupIcon,
  getGroupMeta,
  getRoleLabel,
  getSubgroupMeta,
  groupSections,
  searchSections,
  type AdminGroupMeta,
  type AdminRole,
  type AdminSectionId,
  type AdminSectionMeta,
} from './adminRegistry';

interface AdminIdentity {
  userId?: string;
  userType?: string;
  adminId?: string | number;
}

const AdminShell: React.FC<{
  role: AdminRole;
  identity: AdminIdentity | null;
  sections: AdminSectionMeta[];
  activeSection: AdminSectionId;
  onNavigate: (id: AdminSectionId) => void;
  children: React.ReactNode;
}> = ({ role, identity, sections, activeSection, onNavigate, children }) => {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const grouped = useMemo(() => groupSections(sections), [sections]);
  const results = useMemo(() => searchSections(sections, query).slice(0, 8), [sections, query]);
  const activeMeta = sections.find((section) => section.id === activeSection);
  const activeGroup = activeMeta ? getGroupMeta(activeMeta.group) : null;
  const ActiveIcon = activeMeta?.icon ?? LayoutGrid;
  const ActiveGroupIcon = getGroupIcon(activeGroup?.id ?? 'dashboard');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key === '/' && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setQuery('');
        setDrawerOpen(false);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [activeSection]);

  const navigate = (id: AdminSectionId) => {
    onNavigate(id);
    setQuery('');
    setDrawerOpen(false);
  };

  const navItem = (section: AdminSectionMeta, compact = false) => {
    const Icon = section.icon;
    const isActive = section.id === activeSection;
    return (
      <button
        key={section.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        aria-label={`${section.title} — ${section.description}`}
        onClick={() => navigate(section.id)}
        data-testid={`admin-nav-${section.id}`}
        className={`admin-nav-item ${isActive ? 'is-active' : ''} ${compact ? 'is-compact' : ''}`}
        title={`${section.title} — ${section.description}`}
      >
        <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
        {!compact && <span className="min-w-0 flex-1 truncate text-left">{section.title}</span>}
        {isActive && !compact && <span className="admin-nav-active-dot" aria-hidden="true" />}
      </button>
    );
  };

  const navGroups = () => grouped.map(({ group, items }: { group: AdminGroupMeta; items: AdminSectionMeta[] }) => {
    const GroupIcon = getGroupIcon(group.id);
    return (
      <div key={group.id} className="admin-nav-group">
        <p className="admin-nav-group-label">
          <GroupIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{t(group.labelKey, group.labelDefault)}</span>
        </p>
        <div className="admin-nav-group-items">
          {items.map((section, index) => {
            const previous = items[index - 1];
            const subgroup = getSubgroupMeta(section.subgroup);
            const showSubgroup = Boolean(subgroup) && section.subgroup !== previous?.subgroup;
            return (
              <React.Fragment key={section.id}>
                {showSubgroup && subgroup && (
                  <p className="admin-nav-subgroup-label">{t(subgroup.labelKey, subgroup.labelDefault)}</p>
                )}
                {navItem(section)}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <div className="admin-console min-h-screen text-white">
      <aside data-testid="admin-sidebar" className="admin-sidebar hidden lg:flex" aria-label={t('admin.console.sidebarLabel', 'Navigation administration')}>
        <div className="admin-sidebar-brand">
          <span className="admin-brand-mark"><img src="/movix-monogram.svg" alt="Movix" className="h-6 w-6 object-contain" draggable={false} /></span>
          <div className="min-w-0">
            <p className="text-sm font-extrabold tracking-tight text-white">MOVIX</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
              {t('admin.console.control', 'Control')}
            </p>
          </div>
        </div>
        <nav className="admin-sidebar-nav">{navGroups()}</nav>
        <div className="admin-sidebar-foot">
          <Link to="/" className="admin-sidebar-link">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('admin.console.backToSite', 'Retour au site')}
          </Link>
        </div>
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-[100010] lg:hidden">
          <button
            type="button"
            aria-label={t('common.close', 'Fermer')}
            className="admin-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="admin-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t('admin.console.sidebarLabel', 'Navigation administration')}
          >
            <div className="admin-drawer-head">
              <div className="flex items-center gap-2.5">
                <span className="admin-brand-mark h-8 w-8"><img src="/movix-monogram.svg" alt="Movix" className="h-5 w-5 object-contain" draggable={false} /></span>
                <div>
                  <p className="text-sm font-extrabold tracking-tight text-white">MOVIX</p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                    {t('admin.console.control', 'Control')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="admin-icon-button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t('common.close', 'Fermer')}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav className="admin-sidebar-nav admin-drawer-nav">{navGroups()}</nav>
          </aside>
        </div>
      )}

      <div className="admin-main lg:pl-[280px]">
        <header className="admin-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="admin-icon-button lg:hidden"
              aria-label={t('admin.console.openMenu', 'Ouvrir le menu')}
              onClick={() => setDrawerOpen(true)}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="hidden min-w-0 sm:block">
              <div className="admin-breadcrumb">
                <ActiveGroupIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {activeGroup ? t(activeGroup.labelKey, activeGroup.labelDefault) : t('admin.console.control', 'Control')}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
                <span className="truncate font-semibold text-white/85">{activeMeta?.title}</span>
              </div>
            </div>
          </div>

          <div className="admin-search-wrap">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('admin.console.searchPlaceholder', 'Rechercher une section… ( / )')}
              aria-label={t('admin.console.searchLabel', 'Recherche globale administration')}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="admin-search-results"
              aria-autocomplete="list"
              data-testid="admin-search"
              className="admin-search-input"
            />
            {results.length > 0 && (
              <div className="admin-search-results" id="admin-search-results" role="listbox">
                {results.map((section) => {
                  const Icon = section.icon;
                  const group = getGroupMeta(section.group);
                  return (
                    <button
                      key={section.id}
                      type="button"
                      role="option"
                      aria-selected={section.id === activeSection}
                      onClick={() => navigate(section.id)}
                      className="admin-search-result"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-white/45" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] font-semibold text-white/85">{section.title}</span>
                        <span className="block truncate text-[11px] text-white/40">
                          {t(group.labelKey, group.labelDefault)} · {section.description}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}
            {query.trim() && results.length === 0 && (
              <div className="admin-search-results admin-search-empty">
                {t('admin.console.noSearchResult', 'Aucune section ne correspond à cette recherche.')}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <span
              data-testid="admin-role"
              data-role={role}
              className="admin-role-badge"
              title={identity ? `${identity.userId ?? ''} ${identity.userType ?? ''}`.trim() : undefined}
            >
              <span className="admin-role-dot" aria-hidden="true" />
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{getRoleLabel(t, role)}</span>
            </span>
          </div>
        </header>

        <main className="admin-main-content">
          <div className="admin-page-heading">
            <div className="min-w-0">
              <p className="admin-page-eyebrow">
                {activeGroup ? t(activeGroup.labelKey, activeGroup.labelDefault) : t('admin.console.control', 'Control')}
                {' · '}
                {getRoleLabel(t, role)}
              </p>
              <h1 className="admin-page-title">
                {activeMeta?.title ?? t('admin.movixAdministration', 'Administration Movix')}
              </h1>
              <p className="admin-page-description">
                {activeMeta?.description ?? t('admin.console.headerHint', 'Toutes les données affichées proviennent des endpoints admin existants.')}
              </p>
            </div>
            <span className="admin-page-icon" aria-hidden="true">
              <ActiveIcon className="h-6 w-6" />
            </span>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
