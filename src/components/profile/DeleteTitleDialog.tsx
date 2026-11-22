// Confirmation de « Supprimer de l'historique », sur le Dialog Radix du
// projet (comme la bulle « estimé ») : focus posé sur « Annuler » à
// l'ouverture, Échap et clic à l'extérieur ferment, mais pas pendant la
// requête ; Radix rend le focus en fermant (l'onglet choisit où, voir
// onCloseAutoFocus).

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from './ui';

interface DeleteTitleDialogProps {
  open: boolean;
  /** Titre affiché dans la question (repli déjà appliqué). */
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export default function DeleteTitleDialog({ open, title, busy, onCancel, onConfirm, onCloseAutoFocus }: DeleteTitleDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const blockWhileBusy = (event: Event) => {
    if (busy) event.preventDefault();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0b1220] p-0 text-white shadow-[0_28px_90px_rgba(0,0,0,0.65)]"
        onOpenAutoFocus={(event) => {
          // Action définitive : le focus part sur « Annuler », pas sur « Supprimer ».
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onEscapeKeyDown={blockWhileBusy}
        onPointerDownOutside={blockWhileBusy}
        onInteractOutside={blockWhileBusy}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="relative overflow-hidden border-b border-white/[0.08] bg-gradient-to-br from-[#151f31] via-[#101827] to-[#0b1220] px-6 pb-5 pt-5">
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-red-500/[0.08] blur-3xl" />
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-rose-300/80">Movix / Control</p>
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="pr-10 text-xl font-extrabold tracking-tight text-white">
              {t('profilePage.history.delete.confirm', 'Supprimer')}
            </DialogTitle>
          </DialogHeader>
          <div className="absolute right-5 top-5 rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/50">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-full border border-red-400/25 bg-red-500/10 p-2.5 text-red-400 shadow-[0_0_24px_rgba(248,113,113,0.10)]">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <DialogDescription className="pt-0.5 text-sm leading-6 text-slate-300">
              {t('profilePage.history.delete.title', { title, defaultValue: 'Supprimer « {{title}} » de l’historique ?' })}
              <span className="mt-2 block text-xs leading-5 text-slate-400">
                {t('profilePage.history.delete.message', 'Sa progression, ses épisodes vus et ses marques « Déjà vu » seront effacés. Ça impactera aussi tes statistiques (temps visionné). Cette action est définitive.')}
              </span>
            </DialogDescription>
          </div>

          <div className="mt-6 flex justify-end gap-2.5">
            <Button
              ref={cancelRef}
              variant="secondary"
              onClick={busy ? undefined : onCancel}
              aria-disabled={busy || undefined}
              className="rounded-xl border border-white/10 bg-white/[0.07] px-4 text-slate-200 shadow-none transition-all hover:border-white/20 hover:bg-white/[0.12] hover:text-white"
            >
              {t('profilePage.history.delete.cancel', 'Annuler')}
            </Button>
            <Button
              variant="primary"
              onClick={onConfirm}
              pending={busy}
              className="rounded-xl border border-red-400/30 bg-gradient-to-b from-red-500 to-red-700 px-4 font-semibold text-white shadow-[0_8px_24px_rgba(220,38,38,0.22)] transition-all hover:-translate-y-0.5 hover:from-red-400 hover:to-red-600 hover:shadow-[0_12px_30px_rgba(220,38,38,0.32)]"
            >
              {t('profilePage.history.delete.confirm', 'Supprimer')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
