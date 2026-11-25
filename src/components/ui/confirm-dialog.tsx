import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from '../icons/Icons8';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { Button } from './button';

export interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'destructive';
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmation harmonisée avec la direction artistique noire de Movix.
 * Le dialogue reste accessible (Radix), bloque la fermeture pendant une
 * action en cours et conserve les variantes destructive / standard.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant = 'default',
    busy = false,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    const isDestructive = variant === 'destructive';

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(next) => {
                if (!next && !busy) onCancel();
            }}
        >
            <DialogContent className="max-w-md overflow-hidden rounded-[1.5rem] border border-white/[0.11] bg-[#08090b] p-0 text-white shadow-[0_32px_100px_rgba(0,0,0,0.82)]">
                <div className="relative overflow-hidden border-b border-white/[0.08] bg-[#0b0c0f] px-6 pb-5 pt-5">
                    <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.25em] text-white/40">
                        Movix / Control
                    </p>
                    <DialogHeader className="space-y-0 text-left">
                        <DialogTitle className="pr-10 text-[22px] font-extrabold tracking-[-0.045em] text-white">
                            {title}
                        </DialogTitle>
                    </DialogHeader>
                </div>

                <div className="bg-[#08090b] px-6 py-5">
                    <div className="flex items-start gap-3">
                        {isDestructive && (
                            <span className="mt-0.5 shrink-0 rounded-full border border-red-400/25 bg-red-500/[0.09] p-2.5 text-[#ff666d]">
                                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                            </span>
                        )}
                        <DialogDescription asChild>
                            <div className="min-w-0 pt-0.5 text-[13px] font-medium leading-[1.55] text-white/75">
                                {message}
                            </div>
                        </DialogDescription>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-end gap-2.5">
                        <Button
                            variant="secondary"
                            onClick={onCancel}
                            disabled={busy}
                            className="h-10 rounded-xl border border-white/[0.09] bg-white/[0.07] px-5 text-[13px] font-semibold text-white/85 shadow-none transition-all hover:border-white/20 hover:bg-white/[0.12] hover:text-white"
                        >
                            {cancelLabel ?? t('common.cancel')}
                        </Button>
                        <Button
                            variant={isDestructive ? 'destructive' : 'default'}
                            onClick={onConfirm}
                            disabled={busy}
                            className={isDestructive
                                ? 'h-10 rounded-xl border border-red-400/30 bg-[#a91f2b] px-5 text-[13px] font-bold text-white transition-colors hover:border-red-300/50 hover:bg-[#c12735]'
                                : 'h-10 rounded-xl border border-white/10 bg-white/[0.09] px-5 text-[13px] font-bold text-white transition-colors hover:bg-white/[0.15]'}
                        >
                            {confirmLabel ?? t('common.confirm')}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ConfirmDialog;
