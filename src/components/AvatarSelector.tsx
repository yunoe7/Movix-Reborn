import React, { useState, useEffect, useMemo, useCallback, memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from './icons/Icons8';
import { avatarCategories } from '../data/avatars';
import { platformAvatars, platforms } from '../data/new_avatars';
import { getOverlayPortalRoot } from '../utils/overlayPortal';
import './profile/profile-console.css';

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onAvatarSelect: (avatarUrl: string) => void;
  currentAvatar?: string;
}

// Bouton d'avatar mémoïsé : la sélection active est une bordure rouge et une
// coche, sans dépendre d'un dégradé ou d'une icône absente.
const AvatarButton = memo(({
  avatar,
  index,
  isSelected,
  onClick,
  label,
}: {
  avatar: string;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  label: string;
}) => (
  <motion.button
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.15, delay: Math.min(index * 0.004, 0.16) }}
    onClick={onClick}
    whileHover={{ scale: 1.04 }}
    whileTap={{ scale: 0.96 }}
    type="button"
    aria-label={`${label} ${index + 1}`}
    aria-pressed={isSelected}
    data-avatar={avatar}
    data-testid="avatar-option"
    className="profile-avatar-option"
  >
    <img
      src={avatar}
      alt=""
      className="h-full w-full rounded-full object-cover"
      loading="lazy"
      decoding="async"
    />
    {isSelected && (
      <span className="profile-avatar-check" aria-hidden="true">
        <span><Check className="h-4 w-4" /></span>
      </span>
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
  const titleId = useId();
  const [selectedPlatform, setSelectedPlatform] = useState<string>(platforms[0] || 'Crunchyroll');
  const [isClosing, setIsClosing] = useState(false);

  // Empêche le défilement de la page et arrête Lenis pendant la modale.
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const lenis = (window as Window & { lenis?: { stop: () => void; start: () => void } }).lenis;
    if (lenis) lenis.stop();

    return () => {
      document.body.style.overflow = originalOverflow;
      if (lenis) lenis.start();
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  const handleAvatarClick = useCallback((avatarUrl: string) => {
    setIsClosing(true);
    setTimeout(() => {
      onAvatarSelect(avatarUrl);
      onClose();
      setIsClosing(false);
    }, 300);
  }, [onAvatarSelect, onClose]);

  const currentCategories = useMemo(() => {
    const isClassiques = selectedPlatform === 'Classiques';
    return isClassiques
      ? avatarCategories
      : (platformAvatars[selectedPlatform] || {});
  }, [selectedPlatform]);

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
          transition={{ duration: 0.2 }}
          data-lenis-prevent
          data-testid="avatar-modal"
          className="avatar-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) handleClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="avatar-dialog"
          >
            <div className="avatar-dialog-header">
              <div className="min-w-0">
                <p className="profile-eyebrow">MOVIX / {t('profile.myProfile')}</p>
                <h3 id={titleId} className="avatar-dialog-title">{t('profile.selectAvatar')}</h3>
              </div>
              <button
                type="button"
                onClick={handleClose}
                aria-label={t('common.close', 'Fermer')}
                title={t('common.close', 'Fermer')}
                data-testid="avatar-close"
                className="profile-icon-button"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="avatar-platform-bar" role="group" aria-label={t('profile.avatar')}>
              {allPlatforms.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => setSelectedPlatform(platform)}
                  aria-pressed={selectedPlatform === platform}
                  className="avatar-platform-button"
                >
                  {platform}
                </button>
              ))}
            </div>

            <div className="avatar-dialog-content">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedPlatform}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {Object.entries(currentCategories).map(([category, avatars]) => (
                    <section key={category} data-testid="avatar-category">
                      <h4 className="avatar-category">{category}</h4>
                      <div className="avatar-grid">
                        {(avatars as string[]).map((avatar: string, index: number) => (
                          <AvatarButton
                            key={`${avatar}-${index}`}
                            avatar={avatar}
                            index={index}
                            isSelected={currentAvatar === avatar}
                            onClick={() => handleAvatarClick(avatar)}
                            label={t('profile.avatar')}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(
    <div className="profile-console avatar-selector-console">{modalContent}</div>,
    getOverlayPortalRoot(),
  );
};

export default memo(AvatarSelector);
