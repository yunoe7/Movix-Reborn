import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FolderPlus, Plus, Shuffle, X } from 'lucide-react';

interface AddToListMenuProps {
  mediaId: number;
  mediaType: 'movie' | 'tv' | 'collection';
  title: string;
  posterPath: string;
  onClose: () => void;
  movieCount?: number;
  presentation?: 'popover' | 'modal';
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
  presentation = 'popover',
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

  if (presentation === 'modal') {
    return (
      <div
        className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/80 p-4"
        onClick={onClose}
        data-testid="add-to-list-modal"
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={t('lists.addToList')}
          className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#20252f] p-6 text-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-bold">{t('lists.addToList')}</h2>
            <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {mediaType === 'collection' && !lists.some((list) => list.name === title) && (
            <button
              type="button"
              onClick={handleCreateCollectionList}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
            >
              <FolderPlus className="h-4 w-4" />
              {t('lists.createListNamed', { name: title })}
              {!!movieCount && <span className="text-xs text-white/70">({movieCount} {t('lists.movies')})</span>}
            </button>
          )}

          {addedToList && (
            <p className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
              ✓ {t('lists.addedSuccess')}
            </p>
          )}

          {lists.length === 0 ? (
            <div className="py-6 text-center">
              <FolderPlus className="mx-auto mb-3 h-14 w-14 text-white/45" />
              <p className="mb-4 text-sm text-white/60">{t('lists.noLists')}</p>
              <button type="button" onClick={() => setShowCreateForm(true)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500">
                {t('lists.createFirstList')}
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {lists.map((list) => {
                  const alreadyAdded = (list.items ?? []).some((item) => Number(item.id) === mediaId && item.type === mediaType);
                  return (
                    <button
                      key={String(list.id)}
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => handleAddToList(list.id)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-white/85 transition-colors hover:bg-white/[0.08] disabled:text-emerald-300"
                    >
                      <span>{list.name}</span>
                      {alreadyAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <button type="button" onClick={() => setShowCreateForm(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/85 hover:bg-white/[0.08]">
                  <Plus className="h-4 w-4" />
                  {t('lists.createNewList')}
                </button>
              </div>
            </>
          )}

          {showCreateForm && (
            <form onSubmit={handleCreateList} className="mt-3 space-y-3 border-t border-white/10 pt-4">
              <input
                ref={inputRef}
                type="text"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                placeholder={t('lists.listNamePlaceholder')}
                aria-label={t('lists.listName')}
                className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/35"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowCreateForm(false); setNewListName(''); }} className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/15">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={!newListName.trim()} className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
                  {t('lists.create')}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={t('lists.addToList')}
      data-testid="add-to-list-popover"
      className="relative w-[236px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-white/[0.10] bg-[#181818] text-white shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
    >
      <div className="border-b border-white/[0.09] px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold leading-5 text-white/90">{t('lists.addToList')}</h2>
      </div>

      {lists.length === 0 ? (
        <div className="whitespace-pre-line px-3 py-[18px] text-center text-[13px] leading-[1.4] text-white/45" data-testid="add-to-list-empty">
          {t('lists.noListsPopover')}
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
              placeholder={t('lists.listNamePlaceholder')}
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
