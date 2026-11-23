import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import AddToListMenu from './AddToListMenu';

interface AddToListButtonProps {
  mediaId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath: string;
}

type PopoverPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

const POPOVER_WIDTH = 236;
const VIEWPORT_GUTTER = 8;

const AddToListButton: React.FC<AddToListButtonProps> = ({
  mediaId,
  mediaType,
  title,
  posterPath,
}) => {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<PopoverPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const availableWidth = Math.max(180, window.innerWidth - VIEWPORT_GUTTER * 2);
      const left = Math.max(
        VIEWPORT_GUTTER,
        Math.min(rect.left, window.innerWidth - Math.min(POPOVER_WIDTH, availableWidth) - VIEWPORT_GUTTER),
      );
      const estimatedHeight = Math.min(220, window.innerHeight - VIEWPORT_GUTTER * 2);
      const below = rect.bottom + 8;
      const top = below + estimatedHeight <= window.innerHeight - VIEWPORT_GUTTER
        ? below
        : Math.max(VIEWPORT_GUTTER, rect.top - estimatedHeight - 8);

      setMenuPosition({
        top,
        left,
        maxHeight: Math.max(140, window.innerHeight - top - VIEWPORT_GUTTER),
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setShowMenu(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(false);
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showMenu]);

  return (
    <>
      <div ref={rootRef} className="relative inline-flex">
        <motion.button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={showMenu}
          data-testid="add-to-list-trigger"
          onClick={() => setShowMenu((open) => !open)}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.985 }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#505050] px-5 py-2.5 text-sm font-semibold text-white shadow-none transition-colors hover:bg-[#5b5b5b]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('lists.addToList')}
        </motion.button>
      </div>

      {showMenu && menuPosition && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100002]"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            maxHeight: menuPosition.maxHeight,
          }}
        >
          <AddToListMenu
            mediaId={mediaId}
            mediaType={mediaType}
            title={title}
            posterPath={posterPath}
            onClose={() => setShowMenu(false)}
          />
        </div>,
        document.body,
      )}
    </>
  );
};

export default AddToListButton;
