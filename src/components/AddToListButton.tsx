import React, { useEffect, useRef, useState } from 'react';
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

const AddToListButton: React.FC<AddToListButtonProps> = ({
  mediaId,
  mediaType,
  title,
  posterPath,
}) => {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
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
    <div ref={rootRef} className="relative inline-flex">
      <motion.button
        type="button"
        aria-haspopup="dialog"
        data-testid="add-to-list-trigger"
        aria-expanded={showMenu}
        onClick={() => setShowMenu((open) => !open)}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-[#505050] px-5 py-2.5 text-sm font-semibold text-white shadow-none transition-colors hover:bg-[#5b5b5b]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('lists.addToList')}
      </motion.button>

      {showMenu && (
        <AddToListMenu
          mediaId={mediaId}
          mediaType={mediaType}
          title={title}
          posterPath={posterPath}
          onClose={() => setShowMenu(false)}
        />
      )}
    </div>
  );
};

export default AddToListButton;
