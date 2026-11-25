import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from '../icons/Icons8';
import { getOverlayPortalRoot } from '../../utils/overlayPortal';

interface ReusableModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    className?: string; // For customized width/height if needed
}

/**
 * Modal réutilisable avec fade + scale in/out via framer-motion.
 *
 * **Pattern AnimatePresence avec `isOpen` direct** (pas de state `isClosing`
 * interne) : quand `isOpen` passe de `true` à `false`, AnimatePresence garde
 * le motion.div monté le temps de jouer l'animation `exit`, puis démonte.
 * Ça marche quel que soit comment `isOpen` devient false :
 *   - click X → `onClose()` → parent set false → exit anime
 *   - click backdrop → idem
 *   - click bouton interne (ex. "Annuler", "Confirmer") → idem
 *   - close programmatique depuis le parent → idem
 *
 * L'ancien pattern `isClosing + setTimeout` ne fonctionnait que sur le
 * chemin "click X" interne ; dès qu'un parent changeait `isOpen` directement
 * (ex. bouton "Annuler" d'un popup de confirmation) le modal unmountait
 * instantanément sans exit — ce qui cassait le fade-out observé par l'user.
 */
const ReusableModal: React.FC<ReusableModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    className = "max-w-2xl"
}) => {
    // Disable body scroll when modal is open (sync avec isOpen live).
    useEffect(() => {
        if (!isOpen) return;

        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = originalOverflow;
        };
    }, [isOpen]);

    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="backdrop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    data-lenis-prevent
                    className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-5"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) onClose();
                    }}
                >
                    <motion.div
                        key="panel"
                        initial={{ scale: 0.92, opacity: 0, y: 8 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 8 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        data-lenis-prevent
                        className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[1.35rem] border border-white/[0.1] bg-[#0a0a0b] shadow-[0_30px_100px_rgba(0,0,0,0.7)] ${className}`}
                    >
                        {/* Header */}
                        <div className="relative flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.08] bg-[#0b0c0e] px-5 py-4 sm:px-6 sm:py-5">
                            <div className="min-w-0"><p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.22em] text-white/40">MOVIX / CONTROL</p><h3 className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">{title}</h3></div>
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={onClose}
                                className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5 text-white/50 transition-all hover:border-white/15 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                            >
                                <X className="w-5 h-5" />
                            </motion.button>
                        </div>

                        {/* Content */}
                        <div className="overflow-y-auto bg-black/[0.08] p-5 sm:p-6" data-lenis-prevent style={{ overscrollBehavior: 'contain' }}>
                            {children}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return createPortal(modalContent, getOverlayPortalRoot());
};

export default ReusableModal;
