import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, X } from 'lucide-react';

import { MovixMark } from './brand/MovixMark';
import AccessCodeForm from './AccessCodeForm';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { getOverlayPortalRoot } from '@/utils/overlayPortal';
import './vip-access-modal.css';

interface VipModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

const VipModal: React.FC<VipModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  const closeFromLink = useCallback(() => {
    onClose();
  }, [onClose]);

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          data-testid="vip-modal-backdrop"
          data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
          className="vip-access-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            data-testid="vip-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vip-access-modal-title"
            aria-describedby="vip-access-modal-subtitle"
            className="vip-access-modal"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.985 }}
            transition={transition}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              data-testid="vip-modal-close"
              className="vip-access-modal-close"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <span className="inline-flex" data-vip-icon="vip-modal-close" aria-hidden="true">
                <X className="h-5 w-5" />
              </span>
            </button>

            <div className="vip-access-modal-header">
              <span className="vip-access-modal-mark" aria-hidden="true">
                <MovixMark testId="vip-modal-mark" />
              </span>
              <div className="min-w-0">
                <p className="vip-access-modal-eyebrow">Movix VIP</p>
                <h2 id="vip-access-modal-title" data-testid="vip-modal-title" className="vip-access-modal-title">
                  {t('vip.accessMovixVip')}
                </h2>
              </div>
            </div>

            <p
              id="vip-access-modal-subtitle"
              data-testid="vip-modal-subtitle"
              className="vip-access-modal-subtitle"
            >
              {t('vip.accessModal.subtitle')}
            </p>

            <AccessCodeForm />

            <div className="vip-access-modal-footer">
              <span className="vip-access-modal-divider">{t('common.or')}</span>
              <p data-testid="vip-modal-no-key" className="vip-access-modal-no-key">
                {t('vip.noVipKey')}
              </p>
              <Link
                to="/vip"
                data-testid="vip-modal-discover"
                onClick={closeFromLink}
                className="vip-access-modal-secondary"
              >
                <span className="inline-flex" data-vip-icon="vip-modal-discover" aria-hidden="true">
                  <Crown className="h-4 w-4" />
                </span>
                {t('vip.discoverBenefits')}
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    getOverlayPortalRoot(),
  );
};

export default VipModal;
