import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { List } from 'lucide-react';
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
  posterPath
}) => {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setShowMenu(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.19] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(0,0,0,0.18)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.27]"
      >
        <List className="w-4 h-4" />
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
    </>
  );
};

export default AddToListButton; 