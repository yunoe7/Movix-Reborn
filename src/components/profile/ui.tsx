// Briques visuelles de la page profil : surfaces anthracite, texte lisible et
// un seul accent rouge. Les classes `profile-*` vivent dans profile-console.css.

import React from 'react';
import { Loader2 } from '../icons/Icons8';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'profile-btn profile-btn-primary',
  secondary: 'profile-btn profile-btn-secondary',
  ghost: 'profile-btn profile-btn-quiet',
  danger: 'profile-btn profile-btn-quiet hover:!border-[#e11d2e] hover:!bg-[#2a1416]',
  light: 'profile-btn bg-white text-[#141414] border border-white hover:bg-[#e9e9e9]',
};

const BASE_BUTTON =
  'inline-flex shrink-0 items-center justify-center gap-2 ' +
  'transition-[background-color,color,border-color,transform,opacity] duration-150 ease-out active:scale-[0.98] ' +
  'disabled:pointer-events-none disabled:opacity-50';

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md', extra = '') {
  const sizing = size === 'sm' ? 'text-[13px]' : 'text-sm';
  return `${BASE_BUTTON} ${sizing} ${VARIANTS[variant]} ${extra}`.trim();
}

/* Menus « ⋯ » du profil : portail inclus, donc couleurs explicites déjà
   utilisées par la refonte (elles ne héritent pas des variables CSS). */
export const profileMenuContentClass =
  'min-w-[14rem] border-[#363636] bg-[#111111] text-white shadow-[0_20px_60px_rgba(0,0,0,0.7)]';
export const profileMenuItemClass =
  'min-h-10 gap-2 px-3 text-[15px] text-white/85 focus:text-white [&_svg]:text-white [&_svg]:opacity-85 focus:[&_svg]:opacity-100';

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
    dark: '',
    light: '',
    danger: 'profile-icon-button-danger',
  };
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`profile-icon-button ${tones[tone]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-[#d0d0d0]" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden="true" />
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
    <div className="profile-empty sm:flex-row sm:items-center">
      <span className="profile-empty-icon [&>span]:!h-6 [&>span]:!w-6 [&>svg]:h-6 [&>svg]:w-6">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="profile-empty-title">{title}</h3>
        <p className="profile-empty-description">{description}</p>
      </div>
      {action && (action.to ? (
        <Link to={action.to} className={buttonClass('primary', 'md')}>{action.label}</Link>
      ) : (
        <Button variant="primary" onClick={action.onClick} pending={action.pending}>{action.label}</Button>
      ))}
    </div>
  );
}

export type TicketTone = 'default' | 'accent' | 'light';

/** Rythme des talons dans une grille : surtout sombres, un rouge et un blanc de temps en temps. */
export const ticketToneAt = (index: number): TicketTone => (index % 7 === 3 ? 'accent' : index % 7 === 6 ? 'light' : 'default');

const STRIP_TONES: Record<TicketTone, { strip: string; meta: string }> = {
  default: { strip: 'profile-poster-strip', meta: 'profile-poster-meta' },
  accent: { strip: 'profile-poster-strip profile-poster-strip-accent', meta: 'profile-poster-meta !text-white' },
  light: { strip: 'profile-poster-strip profile-poster-strip-light', meta: 'profile-poster-meta' },
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
    <div className="relative aspect-[2/3] overflow-hidden bg-[#202020]">
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
          <span className="text-white [&>span]:!h-9 [&>span]:!w-9 [&>svg]:h-9 [&>svg]:w-9">{fallbackIcon}</span>
          <span className="line-clamp-3 text-sm font-semibold text-[#e4e4e4]">{title}</span>
        </div>
      )}
      {typeof progress === 'number' && progress > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/70" aria-hidden="true">
          <span className="profile-progress-fill block" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </span>
      )}
    </div>
  );

  return (
    <article data-testid="poster-ticket" className={`profile-poster group relative flex flex-col ${selected ? '!border-[#e11d2e]' : ''}`}>
      {to ? (
        <Link to={to} aria-label={title} className="block">{art}</Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} aria-label={title} aria-expanded={selected} className="block w-full text-left">{art}</button>
      ) : art}

      {badge && <div className="pointer-events-none absolute left-2 top-2">{badge}</div>}
      {actions && (
        <div className="absolute right-2 top-2 flex gap-1.5">
          {actions}
        </div>
      )}

      <div className={colors.strip}>
        <p className="line-clamp-1 text-sm font-bold" title={title}>{title}</p>
        {(metaLeft || metaRight) && (
          <p className={`mt-1 flex items-center justify-between gap-2 tabular-nums ${colors.meta}`}>
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
  return <span className="inline-flex items-center gap-1 rounded-full bg-black/85 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">{children}</span>;
}

/** Grille d'affiches commune à tous les onglets. */
export function PosterGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">{children}</div>;
}
