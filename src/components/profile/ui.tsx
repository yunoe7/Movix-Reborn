// Briques visuelles de la page profil : un seul accent (rouge thémable),
// surfaces plates en gray-900, boutons en pilule, aucune ombre ni dégradé
// (sauf le voile sombre posé sur une photo pour lire le texte).

import React from 'react';
import { Loader2 } from '../icons/Icons8';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[#555555] text-white hover:bg-[#777777]',
  secondary: 'bg-[#242424] text-slate-100 ring-1 ring-[#484848] hover:bg-[#2b3b53]',
  // Icônes en couleur pleine + opacity (une couleur transparente fait foncer les croisements de traits).
  ghost: 'text-slate-300 hover:bg-[#242424] hover:text-white [&_svg]:text-slate-200 [&_svg]:opacity-90 hover:[&_svg]:opacity-100',
  danger: 'bg-[#242424] text-[#eeeeee] ring-1 ring-[#484848] hover:bg-[#555555] hover:text-white',
  light: 'bg-white text-black hover:bg-white/85',
};

const BASE_BUTTON =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium ' +
  'transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-[0.97] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ' +
  'disabled:pointer-events-none disabled:opacity-50';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md', extra = '') {
  const sizing = size === 'sm' ? 'h-9 px-3.5' : 'h-10 px-4';
  return `${BASE_BUTTON} ${sizing} ${VARIANTS[variant]} ${extra}`.trim();
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  /**
   * Action en cours sans désactiver le bouton : sablier, aria-disabled et
   * clics ignorés, mais le focus clavier reste dessus (un bouton `disabled`
   * le perd et le renvoie sur <body>).
   */
  pending?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', loading = false, pending = false, className = '', children, disabled, type = 'button', onClick, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={pending ? (event) => event.preventDefault() : onClick}
      className={buttonClass(variant, size, `${pending ? 'cursor-progress opacity-70' : ''} ${className}`)}
      {...rest}
    >
      {(loading || pending) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = 'ProfileButton';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'dark' | 'light' | 'danger';
}

/** Bouton rond à icône seule ; `label` sert d'aria-label et d'infobulle. */
export function IconButton({ label, tone = 'dark', className = '', children, type = 'button', ...rest }: IconButtonProps) {
  const tones = {
    dark: 'bg-black/70 text-white hover:bg-black',
    light: 'bg-white/10 text-white hover:bg-white/[0.16] [&_svg]:opacity-80 hover:[&_svg]:opacity-100',
    danger: 'bg-black/70 text-white hover:bg-[#555555]',
  };
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-white/60" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-white/80" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** `pending` : action en cours (bouton seulement, voir Button). */
  action?: { label: string; to?: string; onClick?: () => void; pending?: boolean };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="group relative isolate flex flex-col items-start gap-5 overflow-hidden rounded-[24px] border border-[#303030] bg-[#202020] px-6 py-8 shadow-[0_18px_48px_rgba(0,0,0,0.16)] sm:flex-row sm:items-center sm:px-8 sm:py-9">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#d0d0d0]/10 text-[#eeeeee] ring-1 ring-[#eeeeee]/15 transition-transform duration-300 group-hover:scale-105 [&>svg]:h-6 [&>svg]:w-6">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-white/60">{description}</p>
      </div>
      {action && (action.to ? (
        <Link to={action.to} className={buttonClass('primary', 'md', '!bg-[#d0d0d0] hover:!bg-[#eeeeee]')}>{action.label}</Link>
      ) : (
        <Button variant="primary" className="!bg-[#d0d0d0] hover:!bg-[#eeeeee]" onClick={action.onClick} pending={action.pending}>{action.label}</Button>
      ))}
    </div>
  );
}

export type TicketTone = 'default' | 'accent' | 'light';

/** Rythme des talons dans une grille : surtout sombres, un rouge et un blanc de temps en temps. */
export const ticketToneAt = (index: number): TicketTone => (index % 7 === 3 ? 'accent' : index % 7 === 6 ? 'light' : 'default');

const STRIP_TONES: Record<TicketTone, { strip: string; meta: string }> = {
  default: { strip: 'bg-[#111111] text-white', meta: 'text-slate-300' },
  accent: { strip: 'bg-[#d0d0d0] text-white', meta: 'text-white/85' },
  light: { strip: 'bg-[#242424] text-white', meta: 'text-slate-200' },
};

interface PosterTicketProps {
  title: string;
  poster: string;
  /** Icône affichée quand il n'y a pas d'affiche. */
  fallbackIcon?: React.ReactNode;
  metaLeft?: React.ReactNode;
  metaRight?: React.ReactNode;
  tone?: TicketTone;
  /** Lien (navigation) ou action au clic sur l'affiche. */
  to?: string;
  onOpen?: () => void;
  /** Boutons posés en haut à droite de l'affiche. */
  actions?: React.ReactNode;
  /** Pastille en haut à gauche (épisode, numéro…). */
  badge?: React.ReactNode;
  /** Barre de progression 0–100 au bas de l'affiche. */
  progress?: number;
  selected?: boolean;
  children?: React.ReactNode;
}

/**
 * Affiche + talon de ticket : le talon porte le titre et deux infos courtes,
 * séparé de l'affiche par une ligne perforée et deux encoches.
 */
export function PosterTicket({
  title,
  poster,
  fallbackIcon,
  metaLeft,
  metaRight,
  tone = 'default',
  to,
  onOpen,
  actions,
  badge,
  progress,
  selected = false,
  children,
}: PosterTicketProps) {
  const [failed, setFailed] = React.useState(false);
  const colors = STRIP_TONES[tone];
  const showImage = poster && !failed;

  const art = (
    <div className="relative aspect-[2/3] overflow-hidden rounded-t-lg bg-[#202020]">
      {showImage ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
          <span className="text-white opacity-40 [&>svg]:h-9 [&>svg]:w-9">{fallbackIcon}</span>
          <span className="line-clamp-3 text-sm font-medium text-white/80">{title}</span>
        </div>
      )}
      {typeof progress === 'number' && progress > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/60" aria-hidden="true">
          <span className="block h-full bg-[#d0d0d0]" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
    </div>
  );

  const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-t-lg';

  return (
    <article className={`group relative flex flex-col overflow-hidden rounded-2xl border border-[#383838] shadow-[0_12px_30px_rgba(0,0,0,0.18)] transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:shadow-[0_20px_42px_rgba(0,0,0,0.28)] ${selected ? 'ring-2 ring-white/30 ring-offset-2 ring-offset-black rounded-lg' : ''}`}>
      {to ? (
        <Link to={to} aria-label={title} className={`block ${focusRing}`}>{art}</Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} aria-label={title} aria-expanded={selected} className={`block w-full text-left ${focusRing}`}>{art}</button>
      ) : art}

      {badge && <div className="pointer-events-none absolute left-2 top-2">{badge}</div>}
      {actions && (
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {actions}
        </div>
      )}

      <div className={`relative rounded-b-2xl px-3 pb-3 pt-3 ${colors.strip}`}>
        {/* Perforation et encoches du talon */}
        <span aria-hidden="true" className="absolute inset-x-3 top-0 border-t border-white/10" />
        <span aria-hidden="true" className="hidden" />
        <span aria-hidden="true" className="hidden" />
        <p className="line-clamp-1 text-sm font-medium" title={title}>{title}</p>
        {(metaLeft || metaRight) && (
          <p className={`mt-0.5 flex items-center justify-between gap-2 text-[13px] tabular-nums ${colors.meta}`}>
            <span className="truncate">{metaLeft}</span>
            {metaRight && <span className="shrink-0">{metaRight}</span>}
          </p>
        )}
      </div>
      {children}
    </article>
  );
}

/** Pastille sombre lisible sur une affiche. */
export function PosterBadge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-xs font-medium text-white tabular-nums">{children}</span>;
}

/** Grille d'affiches commune à tous les onglets. */
export function PosterGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{children}</div>;
}
