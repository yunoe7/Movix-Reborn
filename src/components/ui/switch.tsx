import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    disabled?: boolean;
    id?: string;
    'aria-label'?: string;
    className?: string;
    size?: 'sm' | 'default';
}

/**
 * Switch on/off custom. Pas de dépendance Radix : on gère soi-même le pattern
 * `role="switch" aria-checked`. Le thumb glisse via une transition CSS sur
 * `translate-x`, donc pas besoin de framer-motion ici.
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
    ({ checked, onCheckedChange, disabled, id, className, size = 'default', ...props }, ref) => {
        const dims = size === 'sm'
            ? { track: 'h-5 w-9', thumb: 'h-3.5 w-3.5', translate: 'translate-x-4' }
            : { track: 'h-6 w-11', thumb: 'h-4 w-4', translate: 'translate-x-5' };

        return (
            <button
                ref={ref}
                type="button"
                role="switch"
                id={id}
                aria-checked={checked}
                disabled={disabled}
                onClick={() => !disabled && onCheckedChange(!checked)}
                className={cn(
                    'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
                    'transition-colors duration-200 ease-in-out',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-2 focus-visible:ring-offset-black',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    dims.track,
                    checked
                        ? 'bg-white/85'
                        : 'bg-white/10 hover:bg-white/20',
                    className,
                )}
                {...props}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        'pointer-events-none inline-block transform rounded-full shadow-none ring-0',
                        'transition-all duration-200 ease-in-out',
                        dims.thumb,
                        checked ? `${dims.translate} bg-black` : 'translate-x-0.5 bg-white/80',
                    )}
                />
            </button>
        );
    },
);
Switch.displayName = 'Switch';

export { Switch };
