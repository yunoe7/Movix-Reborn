import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from './icons/Icons8';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useLightMode } from '../context/LightModeContext';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import { useVirtualizer } from '@tanstack/react-virtual';

interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  position?: 'top' | 'bottom' | 'auto';
}

const CustomDropdown: React.FC<CustomDropdownProps> = ({
  options,
  value,
  onChange,
  placeholder = i18n.t('common.select'),
  disabled = false,
  className = '',
  position = 'auto',
  searchable = true
}) => {
  const { t } = useTranslation();
  const lightModeContext = useLightMode();
  const animationsDisabled = !lightModeContext?.effectivePrefs?.transitions;
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Les listes d'épisodes peuvent contenir plusieurs centaines d'entrées :
  // ne monter que les lignes visibles dans le menu.
  const optionVirtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 6,
  });
  const virtualOptions = optionVirtualizer.getVirtualItems();
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  const selectedOption = options.find(option => option.value === value);

  // Calculate fixed position for the portal menu
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const menuHeight = 250;

    const resolvedPlacement = position !== 'auto'
      ? position
      : (spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom');

    setPlacement(resolvedPlacement);

    // Clamp left so the menu doesn't overflow the viewport
    const menuWidth = Math.max(rect.width, 180);
    const left = Math.min(rect.left, viewportWidth - menuWidth - 8);

    if (resolvedPlacement === 'top') {
      setMenuStyle({
        position: 'fixed',
        bottom: viewportHeight - rect.top + 4,
        left: Math.max(8, left),
        width: rect.width,
        minWidth: Math.min(menuWidth, viewportWidth - 16),
        zIndex: 100000,
        transformOrigin: 'bottom center',
      });
    } else {
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: Math.max(8, left),
        width: rect.width,
        minWidth: Math.min(menuWidth, viewportWidth - 16),
        zIndex: 100000,
        transformOrigin: 'top center',
      });
    }
  }, [position]);

  // Click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        (!contentRef.current || !contentRef.current.contains(event.target as Node))
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Recalculate position on open & resize
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen, updatePosition]);

  // Close on scroll/wheel outside
  useEffect(() => {
    if (!isOpen) return;
    const handleWheel = (e: WheelEvent) => {
      if (contentRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
      setSearchTerm('');
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (contentRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
      setSearchTerm('');
    };
    window.addEventListener('wheel', handleWheel, { passive: true, capture: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener('touchmove', handleTouchMove, { capture: true } as EventListenerOptions);
    };
  }, [isOpen]);

  // Focus search input
  useEffect(() => {
    if (isOpen && searchable && searchRef.current) {
      searchRef.current.focus({ preventScroll: true });
    }
  }, [isOpen, searchable]);

  // Stop Lenis smooth scroll while dropdown is open
  useEffect(() => {
    if (!isOpen) return;
    const lenis = (window as any).lenis;
    if (lenis) lenis.stop();
    return () => {
      const lenisInstance = (window as any).lenis;
      if (lenisInstance) lenisInstance.start();
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    setSearchTerm('');
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchTerm('');
    }
  };

  const handleContentWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (listRef.current) {
      listRef.current.scrollTop += e.deltaY;
    }
  };

  const innerMenu = (
    <div
      ref={contentRef}
      style={menuStyle}
      className="bg-[#111111] border border-[#383838] rounded-xl shadow-[0_18px_50px_rgba(0,0,0,0.55)] overflow-hidden"
      data-lenis-prevent
      onWheel={handleContentWheel}
    >
      {searchable && (
        <div className="p-2.5 border-b border-[#383838]">
          <input
            ref={searchRef}
            type="text"
            placeholder={t('common.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2.5 bg-[#080808] border border-[#404040] rounded-lg text-slate-100 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-white/40"
            onKeyDown={handleKeyDown}
          />
        </div>
      )}

      <div
        ref={listRef}
        className={`h-48 overflow-y-auto overscroll-contain ${searchable ? 'rounded-b-lg' : 'rounded-lg'}`}
        data-lenis-prevent
        onWheel={handleContentWheel}
      >
        {filteredOptions.length > 0 ? (
          <div style={{ height: optionVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualOptions.map((virtualRow) => {
              const option = filteredOptions[virtualRow.index];
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`absolute left-0 top-0 flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#383838] transition-colors ${value === option.value ? 'bg-[#3a3a3a] text-[#f0f0f0] font-semibold' : 'text-slate-100'}`}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                  </div>
                  {value === option.value && <Check className="w-4 h-4 text-[#f0f0f0] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-2 text-gray-400 text-sm text-center">
            {t('common.noResults')}
          </div>
        )}
      </div>
    </div>
  );

  const menuContent = animationsDisabled ? (
    isOpen ? innerMenu : null
  ) : (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, y: placement === 'top' ? 8 : -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: placement === 'top' ? 8 : -8, scale: 0.95 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={menuStyle}
          className="bg-[#111111] border border-[#383838] rounded-xl shadow-[0_18px_50px_rgba(0,0,0,0.55)] overflow-hidden"
          data-lenis-prevent
          onWheel={handleContentWheel}
        >
          {searchable && (
            <div className="p-2.5 border-b border-[#383838]">
              <input
                ref={searchRef}
                type="text"
                placeholder={t('common.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2.5 bg-[#080808] border border-[#404040] rounded-lg text-slate-100 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-white/40"
                onKeyDown={handleKeyDown}
              />
            </div>
          )}

          <div
            ref={listRef}
            className={`h-48 overflow-y-auto overscroll-contain ${searchable ? 'rounded-b-lg' : 'rounded-lg'}`}
            data-lenis-prevent
            onWheel={handleContentWheel}
          >
            {filteredOptions.length > 0 ? (
          <div style={{ height: optionVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualOptions.map((virtualRow) => {
              const option = filteredOptions[virtualRow.index];
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`absolute left-0 top-0 flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#383838] transition-colors ${value === option.value ? 'bg-[#3a3a3a] text-[#f0f0f0] font-semibold' : 'text-slate-100'}`}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                  </div>
                  {value === option.value && <Check className="w-4 h-4 text-[#f0f0f0] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : (
              <div className="px-3 py-2 text-gray-400 text-sm text-center">
                {t('common.noResults')}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 bg-[#242424] border border-[#484848] rounded-xl text-slate-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/25 focus:border-white/40 transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#383838]'}`}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedOption?.icon}
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {createPortal(menuContent, getOverlayPortalRoot())}
    </div>
  );
};

export default CustomDropdown;
