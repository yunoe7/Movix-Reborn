import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, LayoutGrid, Search, ShieldCheck, X } from '../icons/Icons8';
import {
  getGroupIcon,
  getRoleLabel,
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
  const ActiveIcon = activeMeta?.icon ?? LayoutGrid;

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
        onClick={() => navigate(section.id)}
        data-testid={`admin-nav-${section.id}`}
        className={`admin-nav-item ${isActive ? 'is-active' : ''} ${compact ? 'is-compact' : ''}`}
        title={section.description}
      >
        <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
        {!compact && <span className="min-w-0 flex-1 truncate text-left">{section.title}</span>}
        {isActive && !compact && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/80" aria-hidden="true" />}
      </button>
    );
  };

  const navGroups = (compact = false) => grouped.map(({ group, items }: { group: AdminGroupMeta; items: AdminSectionMeta[] }) => {
    const GroupIcon = getGroupIcon(group.id);
    return (
      <div key={group.id} className="admin-nav-group">
        {!compact && (
          <p className="admin-nav-group-label">
            <GroupIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t(group.labelKey, group.labelDefault)}
          </p>
        )}
        <div className="space-y-1">{items.map((section) => navItem(section, compact))}</div>
      </div>
    );
  });

  return (
    <div className="admin-console min-h-screen bg-black text-white">
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
        <nav className="admin-sidebar-nav">{navGroups(false)}</nav>
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
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="admin-drawer" aria-label={t('admin.console.sidebarLabel', 'Navigation administration')}>
            <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="admin-brand-mark h-8 w-8"><img src="/movix-monogram.svg" alt="Movix" className="h-5 w-5 object-contain" draggable={false} /></span>
                <p className="text-sm font-extrabold tracking-tight text-white">MOVIX</p>
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
            <nav className="admin-sidebar-nav px-3 py-4">{navGroups(false)}</nav>
          </aside>
        </div>
      )}

      <div className="admin-main lg:pl-[268px]">
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
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                {t('admin.console.control', 'Control')}
              </p>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white/85">
                <ActiveIcon className="h-4 w-4 text-white/50" aria-hidden="true" />
                <span className="truncate">{activeMeta?.title}</span>
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
              data-testid="admin-search"
              className="admin-search-input"
            />
            {results.length > 0 && (
              <div className="admin-search-results" role="listbox">
                {results.map((section) => {
                  const Icon = section.icon;
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
                        <span className="block truncate text-[11px] text-white/40">{section.description}</span>
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
            <span data-testid="admin-role" className="admin-role-badge" title={identity ? `${identity.userId ?? ''} ${identity.userType ?? ''}`.trim() : undefined}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{getRoleLabel(t, role)}</span>
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
                {t('admin.console.control', 'Control')}
              </p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {role === 'admin'
                  ? t('admin.movixAdministration', 'Administration Movix')
                  : t('admin.uploaderSpace', 'Espace opérateur')}
              </h1>
            </div>
            <p className="max-w-md text-xs leading-5 text-white/40">
              {t('admin.console.headerHint', 'Toutes les données affichées proviennent des endpoints admin existants.')}
            </p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
