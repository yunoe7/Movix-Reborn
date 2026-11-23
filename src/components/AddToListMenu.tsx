import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Shuffle } from 'lucide-react';

interface AddToListMenuProps {
  mediaId: number;
  mediaType: 'movie' | 'tv' | 'collection';
  title: string;
  posterPath: string;
  onClose: () => void;
  movieCount?: number;
}

type CustomList = {
  id: string | number;
  name: string;
  items?: Array<{ id: number; type: string; title?: string; poster_path?: string }>;
  createdAt?: string;
};

const readLists = (): CustomList[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('custom_lists') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Compact list popover anchored to AddToListButton.
 * It intentionally stays inside the button's stacking context instead of opening a full-screen modal.
 */
const AddToListMenu: React.FC<AddToListMenuProps> = ({
  mediaId,
  mediaType,
  title,
  posterPath,
  onClose,
  movieCount,
}) => {
  const { t } = useTranslation();
  const [lists, setLists] = useState<CustomList[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [addedToList, setAddedToList] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setLists(readLists());
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (showCreateForm) inputRef.current?.focus();
  }, [showCreateForm]);

  const persistLists = (updatedLists: CustomList[]) => {
    try {
      window.localStorage.setItem('custom_lists', JSON.stringify(updatedLists));
      setLists(updatedLists);
      return true;
    } catch (error) {
      console.error('Unable to save custom list', error);
      return false;
    }
  };

  const closeAfterSuccess = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, 650);
  };

  const handleAddToList = (rawListId: string | number) => {
    const listId = String(rawListId);
    const updatedLists = lists.map((list) => {
      if (String(list.id) !== listId) return list;
      const items = Array.isArray(list.items) ? list.items : [];
      const itemExists = items.some((item) => Number(item.id) === mediaId && item.type === mediaType);
      return itemExists ? list : {
        ...list,
        items: [{
          id: mediaId,
          type: mediaType,
          title,
          poster_path: posterPath,
          addedAt: new Date().toISOString(),
        }, ...items],
      };
    });

    if (!persistLists(updatedLists)) return;
    setAddedToList(listId);
    closeAfterSuccess();
  };

  const handleCreateList = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const name = newListName.trim();
    if (!name) return;

    const newList: CustomList = {
      id: Date.now().toString(),
      name,
      items: [{
        id: mediaId,
        type: mediaType,
        title,
        poster_path: posterPath,
        addedAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
    };
    if (!persistLists([...lists, newList])) return;
    setAddedToList(String(newList.id));
    setNewListName('');
    setShowCreateForm(false);
    closeAfterSuccess();
  };

  const handleCreateCollectionList = () => {
    if (mediaType !== 'collection' || lists.some((list) => list.name === title)) return;
    const newList: CustomList = {
      id: Date.now().toString(),
      name: title,
      items: [{
        id: mediaId,
        type: mediaType,
        title,
        poster_path: posterPath,
        addedAt: new Date().toISOString(),
      }],
      createdAt: new Date().toISOString(),
    };
    if (!persistLists([...lists, newList])) return;
    setAddedToList(String(newList.id));
    closeAfterSuccess();
  };

  const fillRandomName = () => {
    const suggestions = ['À regarder', 'Mes découvertes', 'Mes favoris', 'Pour plus tard', 'Ma sélection'];
    const available = suggestions.filter((name) => !lists.some((list) => list.name.toLocaleLowerCase() === name.toLocaleLowerCase()));
    const choices = available.length ? available : suggestions;
    setNewListName(choices[Math.floor(Math.random() * choices.length)]);
  };

  return (
    <div
      role="dialog"
      aria-label={t('lists.addToList')}
      data-testid="add-to-list-popover"
      className="absolute left-0 top-full z-[100002] mt-2 w-[236px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-white/[0.10] bg-[#181818] text-white shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
    >
      <div className="border-b border-white/[0.09] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold leading-5 text-white/90">{t('lists.addToList')}</h2>
      </div>

      {lists.length === 0 ? (
        <div className="px-3 py-[18px] text-center text-[13px] leading-[1.4] text-white/45" data-testid="add-to-list-empty">
          {t('lists.noLists')}
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto py-1" data-testid="add-to-list-items">
          {lists.map((list) => {
            const alreadyAdded = (list.items ?? []).some((item) => Number(item.id) === mediaId && item.type === mediaType);
            const success = addedToList === String(list.id);
            return (
              <button
                key={String(list.id)}
                type="button"
                onClick={() => handleAddToList(list.id)}
                disabled={alreadyAdded || success}
                className={`flex min-h-10 w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[13px] transition-colors ${alreadyAdded || success ? 'text-emerald-300' : 'text-white/85 hover:bg-white/[0.07]'}`}
              >
                <span className="min-w-0 truncate font-medium">{list.name}</span>
                {alreadyAdded || success ? <Check className="h-4 w-4 shrink-0" /> : <Plus className="h-4 w-4 shrink-0 text-white/55" />}
              </button>
            );
          })}
        </div>
      )}

      {mediaType === 'collection' && !lists.some((list) => list.name === title) && (
        <button
          type="button"
          onClick={handleCreateCollectionList}
          className="flex min-h-10 w-full items-center gap-2 border-t border-white/[0.09] px-3.5 text-left text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.07]"
        >
          <Plus className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">{t('lists.createListNamed', { name: title })}</span>
          {!!movieCount && <span className="text-[11px] text-white/45">({movieCount})</span>}
        </button>
      )}

      <div className="border-t border-white/[0.09] p-1">
        {showCreateForm ? (
          <form onSubmit={handleCreateList} className="flex h-[38px] items-center rounded-lg border border-white/[0.28] bg-[#111111] pl-3 pr-1" data-testid="add-to-list-create-form">
            <input
              ref={inputRef}
              type="text"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setShowCreateForm(false);
                  setNewListName('');
                }
              }}
              placeholder={t('lists.listName')}
              aria-label={t('lists.listName')}
              maxLength={48}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
              data-testid="add-to-list-name"
            />
            <button
              type="button"
              onClick={fillRandomName}
              aria-label={t('common.random', 'Nom aléatoire')}
              title={t('common.random', 'Nom aléatoire')}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-white/45 transition-colors hover:text-white"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
            <span className="h-5 w-px bg-white/15" />
            <button
              type="submit"
              disabled={!newListName.trim()}
              aria-label={t('lists.create')}
              title={t('lists.create')}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-white/60 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              data-testid="add-to-list-confirm"
            >
              <Check className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.07]"
            data-testid="add-to-list-create-trigger"
          >
            <Plus className="h-4 w-4" />
            {t('lists.createNewList')}
          </button>
        )}
      </div>
    </div>
  );
};

export default AddToListMenu;
