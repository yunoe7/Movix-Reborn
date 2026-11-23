import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from './icons/Icons8';
import { avatarCategories } from '../data/avatars';
import { platformAvatars, platforms } from '../data/new_avatars';
import { getOverlayPortalRoot } from '../utils/overlayPortal';

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onAvatarSelect: (avatarUrl: string) => void;
  currentAvatar?: string;
}

// Memoized avatar button component for performance
const AvatarButton = memo(({
  avatar,
  index,
  isSelected,
  onClick
}: {
  avatar: string;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) => (
  <motion.button
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.15, delay: Math.min(index * 0.005, 0.2) }}
    onClick={onClick}
    whileHover={{ scale: 1.05 }}
    whileTap={{ scale: 0.95 }}
    className={`group relative h-16 w-16 rounded-full p-[3px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b1220] sm:h-[4.5rem] sm:w-[4.5rem] md:h-20 md:w-20 ${isSelected
        ? 'bg-gradient-to-br from-rose-300 via-rose-500 to-orange-400 shadow-[0_0_0_3px_rgba(244,63,94,0.16),0_8px_24px_rgba(244,63,94,0.24)]'
        : 'bg-white/[0.08] hover:bg-gradient-to-br hover:from-rose-400/80 hover:to-orange-400/80 hover:shadow-[0_8px_24px_rgba(244,63,94,0.16)]'
      }` }
  >
    <img
      src={avatar}
      alt={`Avatar ${index + 1}`}
      className="h-full w-full rounded-full object-cover ring-1 ring-black/20 transition-transform duration-200 group-hover:scale-[0.96]"
      loading="lazy"
      decoding="async"
    />
    {isSelected && (
      <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-black/35 backdrop-blur-[1px]">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/70 bg-rose-500 text-white shadow-lg">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      </div>
    )}
  </motion.button>
));

AvatarButton.displayName = 'AvatarButton';

const AvatarSelector: React.FC<AvatarSelectorProps> = ({
  isOpen,
  onClose,
  onAvatarSelect,
  currentAvatar
}) => {
  const { t } = useTranslation();
  const [selectedPlatform, setSelectedPlatform] = useState<string>(platforms[0] || 'Crunchyroll');
  const [isClosing, setIsClosing] = useState(false);

  // Disable body scroll and Lenis when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Stop Lenis to allow native scrolling inside the modal
    const lenis = (window as any).lenis;
    if (lenis) lenis.stop();

    return () => {
      document.body.style.overflow = originalOverflow;
      if (lenis) lenis.start();
    };
  }, [isOpen]);

  // Memoized close handler
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  }, [onClose]);

  // Memoized avatar click handler
  const handleAvatarClick = useCallback((avatarUrl: string) => {
    setIsClosing(true);
    setTimeout(() => {
      onAvatarSelect(avatarUrl);
      onClose();
      setIsClosing(false);
    }, 300);
  }, [onAvatarSelect, onClose]);

  // Memoize current categories to avoid recalculation
  const currentCategories = useMemo(() => {
    const isClassiques = selectedPlatform === 'Classiques';
    return isClassiques
      ? avatarCategories
      : (platformAvatars[selectedPlatform] || {});
  }, [selectedPlatform]);

  // Memoize platform list with Classiques
  const allPlatforms = useMemo(() => {
    const hasOldAvatars = Object.keys(avatarCategories).length > 0;
    return hasOldAvatars ? [...platforms, 'Classiques'] : platforms;
  }, []);

  if (!isOpen) return null;

  const modalContent = (
    <AnimatePresence mode="wait">
      {isOpen && !isClosing && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          data-lenis-prevent
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-[#02040a]/80 p-2 backdrop-blur-md sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.6rem] border border-white/[0.1] bg-[#0b1220] shadow-[0_30px_100px_rgba(0,0,0,0.65)] ring-1 ring-black/40 sm:rounded-[1.8rem]"
          >
            {/* Header */}
            <div className="relative flex flex-shrink-0 items-center justify-between overflow-hidden border-b border-white/[0.07] bg-gradient-to-r from-[#111a2c] via-[#101827] to-[#151323] px-5 py-5 sm:px-8 sm:py-6">
              <><div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-rose-400/70 to-transparent" /><div className="pointer-events-none absolute -right-16 -top-24 h-48 w-48 rounded-full bg-rose-500/[0.09] blur-3xl" /><div className="pointer-events-none absolute -left-20 -bottom-28 h-44 w-44 rounded-full bg-indigo-500/[0.08] blur-3xl" /></>
              <div className="min-w-0">
                <p className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.24em] text-rose-300">MOVIX / PROFILE</p>
                <h3 className="text-xl font-extrabold tracking-[-0.035em] text-white sm:text-[1.4rem]">{t('profile.selectAvatar')}</h3>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleClose}
                className="rounded-xl border border-white/[0.1] bg-black/20 p-3 text-slate-400 shadow-inner shadow-white/[0.03] transition-all duration-200 hover:-rotate-3 hover:border-rose-300/30 hover:bg-rose-500/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70"
              >
                <X className="w-5 h-5" />
              </motion.button>
            </div>

            {/* Platform Tabs */}
            <div className="relative flex flex-shrink-0 justify-start gap-2 overflow-x-auto border-b border-white/[0.06] bg-gradient-to-b from-white/[0.025] to-transparent px-4 py-4 scrollbar-hidden sm:justify-center sm:px-6 sm:py-5">
              {allPlatforms.map((platform) => (
                <button
                  key={platform}
                  onClick={() => setSelectedPlatform(platform)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 sm:text-sm ${selectedPlatform === platform
                      ? 'border-rose-300/60 bg-gradient-to-b from-rose-500 to-rose-600 text-white shadow-[0_7px_22px_rgba(225,29,72,0.32)] ring-1 ring-inset ring-white/20'
                      : 'border-white/[0.08] bg-[#182234]/75 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] hover:border-white/20 hover:bg-[#202d42] hover:text-white'
                    }` }
                >
                  {platform}
                </button>
              ))}
            </div>

            {/* Content with Categories */}
            <div className="relative flex-1 overflow-y-auto px-5 py-4 scrollbar-hidden sm:px-7 sm:py-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedPlatform}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="space-y-6"
                >
                  {Object.entries(currentCategories).map(([category, avatars]) => (
                    <div key={category} className="relative">
                      {/* Sticky Category Title - higher z-index */}
                      <h4 className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0b1220]/95 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-300 backdrop-blur-xl">
                        {category}
                      </h4>

                      {/* Avatar Grid - lower z-index */}
                      <div className="relative z-0 grid grid-cols-4 justify-items-center gap-x-3 gap-y-4 py-4 sm:grid-cols-6 sm:gap-x-5 sm:gap-y-5 md:grid-cols-7 lg:grid-cols-8 xl:grid-cols-10">
                        {(avatars as string[]).map((avatar: string, index: number) => (
                          <AvatarButton
                            key={`${avatar}-${index}`}
                            avatar={avatar}
                            index={index}
                            isSelected={currentAvatar === avatar}
                            onClick={() => handleAvatarClick(avatar)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, getOverlayPortalRoot());
};

export default memo(AvatarSelector);