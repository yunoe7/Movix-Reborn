// Confirmation de « Supprimer de l'historique », sur le Dialog Radix du
// projet (comme la bulle « estimé ») : focus posé sur « Annuler » à
// l'ouverture, Échap et clic à l'extérieur ferment, mais pas pendant la
// requête ; Radix rend le focus en fermant (l'onglet choisit où, voir
// onCloseAutoFocus).

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
        className="max-w-md overflow-hidden rounded-[1.25rem] border border-white/[0.16] bg-gradient-to-b from-[#15171b] to-[#090a0c] p-0 text-white shadow-[0_32px_100px_rgba(0,0,0,0.82)]"
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
        <div className="relative overflow-hidden border-b border-white/[0.08] bg-[#0b0c0f] px-6 pb-5 pt-5">
          <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-red-500/[0.08] blur-3xl" />
          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.25em] text-white/55">Movix / Control</p>
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="pr-10 text-[19px] font-extrabold leading-snug tracking-[-0.035em] text-white">
              {t('profilePage.history.delete.confirm', 'Supprimer')}
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="bg-[#08090b] px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-full border border-red-400/25 bg-white/[0.07] p-2.5 text-white/55 shadow-[0_0_28px_rgba(248,65,75,0.12)]">
              <img src="/movix-monogram.svg" alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
            </span>
            <DialogDescription className="pt-0.5 text-[13px] font-medium leading-[1.55] text-white/75">
              {t('profilePage.history.delete.title', { title, defaultValue: 'Supprimer « {{title}} » de l’historique ?' })}
              <span className="mt-2 block text-xs leading-5 text-white/40">
                {t('profilePage.history.delete.message', 'Sa progression, ses épisodes vus et ses marques « Déjà vu » seront effacés. Ça impactera aussi tes statistiques (temps visionné). Cette action est définitive.')}
              </span>
            </DialogDescription>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Button
              ref={cancelRef}
              variant="secondary"
              onClick={busy ? undefined : onCancel}
              aria-disabled={busy || undefined}
              className="h-10 rounded-xl border border-white/[0.09] bg-white/[0.07] px-5 text-[13px] font-semibold text-white/85 shadow-none transition-all hover:border-white/20 hover:bg-white/[0.12] hover:text-white"
            >
              {t('profilePage.history.delete.cancel', 'Annuler')}
            </Button>
            <Button
              variant="primary"
              onClick={onConfirm}
              pending={busy}
              className="h-10 rounded-xl border border-white/[0.12] bg-white/[0.08] px-5 text-[13px] font-bold text-white shadow-[0_8px_24px_rgba(220,38,38,0.18)] transition-all hover:-translate-y-0.5 hover:bg-white/[0.14] hover:shadow-[0_12px_30px_rgba(220,38,38,0.28)]"
            >
              {t('profilePage.history.delete.confirm', 'Supprimer')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
