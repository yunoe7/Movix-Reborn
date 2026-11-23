import React from 'react';

export type Icons8Name = 'home' | 'film' | 'tv' | 'search' | 'bell' | 'star' | 'list' | 'settings' | 'shield' | 'crown' | 'history' | 'user' | 'users' | 'logout' | 'arrows' | 'chevron' | 'refresh' | 'clapper' | 'radio' | 'network' | 'unlock' | 'external' | 'grid' | 'dice' | 'sparkles' | 'help' | 'github' | 'calendar' | 'puzzle' | 'phone' | 'monitor' | 'plus' | 'close' | 'info' | 'play' | 'loading' | 'arrow-up-right' | 'check' | 'trash' | 'chevron-left' | 'chevron-right';
type Props = { name: Icons8Name; size?: number | string; className?: string; title?: string; style?: React.CSSProperties; strokeWidth?: number };

const paths: Record<Icons8Name, string> = {
  "home": "home--v1",
  "film": "movie-projector",
  "tv": "tv",
  "search": "search",
  "bell": "bell",
  "star": "star",
  "list": "list",
  "settings": "settings",
  "shield": "shield",
  "crown": "crown",
  "history": "time-machine",
  "user": "user",
  "users": "user-group-man-man",
  "logout": "logout-rounded-left",
  "arrows": "left-and-right-arrows",
  "chevron": "expand-arrow",
  "refresh": "synchronize",
  "clapper": "clapperboard",
  "radio": "radio-tower",
  "unlock": "unlock",
  "external": "external-link",
  "grid": "grid",
  "dice": "dice",
  "sparkles": "sparkles",
  "help": "help",
  "github": "github",
  "calendar": "calendar",
  "puzzle": "puzzle",
  "phone": "smartphone",
  "monitor": "monitor",
  "plus": "plus",
  "close": "delete-sign",
  "info": "info",
  "play": "play",
  "loading": "loading",
  "arrow-up-right": "up-right",
  "check": "checkmark",
  "trash": "trash",
  "chevron-left": "chevron-left",
  "chevron-right": "chevron-right"
};

export const Icons8Icon: React.FC<Props> = ({ name, size = 20, className, title, style }) => (
  <span
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    className={['inline-block shrink-0 bg-current align-middle', className].filter(Boolean).join(' ')}
    style={{
      width: size,
      height: size,
      maskImage: `url(https://img.icons8.com/ios/100/${paths[name]}.png)`,
      WebkitMaskImage: `url(https://img.icons8.com/ios/100/${paths[name]}.png)`,
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      maskPosition: 'center',
      WebkitMaskPosition: 'center',
      maskSize: 'contain',
      WebkitMaskSize: 'contain',
      ...style,
    }}
  />
);

export const Home = (p: Omit<Props, 'name'>) => <Icons8Icon name="home" {...p} />;
export const Film = (p: Omit<Props, 'name'>) => <Icons8Icon name="film" {...p} />;
export const Search = (p: Omit<Props, 'name'>) => <Icons8Icon name="search" {...p} />;
export const Star = (p: Omit<Props, 'name'>) => <Icons8Icon name="star" {...p} />;
export const Tv = (p: Omit<Props, 'name'>) => <Icons8Icon name="tv" {...p} />;
export const Tv2 = Tv;
export const Users = (p: Omit<Props, 'name'>) => <Icons8Icon name="users" {...p} />;
export const Clapperboard = (p: Omit<Props, 'name'>) => <Icons8Icon name="clapper" {...p} />;
export const Bell = (p: Omit<Props, 'name'>) => <Icons8Icon name="bell" {...p} />;
export const List = (p: Omit<Props, 'name'>) => <Icons8Icon name="list" {...p} />;
export const Radio = (p: Omit<Props, 'name'>) => <Icons8Icon name="radio" {...p} />;
export const Unlock = (p: Omit<Props, 'name'>) => <Icons8Icon name="unlock" {...p} />;
export const ChevronDown = (p: Omit<Props, 'name'>) => <Icons8Icon name="chevron" {...p} />;
export const ExternalLink = (p: Omit<Props, 'name'>) => <Icons8Icon name="external" {...p} />;
export const LayoutGrid = (p: Omit<Props, 'name'>) => <Icons8Icon name="grid" {...p} />;
export const Settings = (p: Omit<Props, 'name'>) => <Icons8Icon name="settings" {...p} />;
export const Dices = (p: Omit<Props, 'name'>) => <Icons8Icon name="dice" {...p} />;
export const Sparkles = (p: Omit<Props, 'name'>) => <Icons8Icon name="sparkles" {...p} />;
export const HelpCircle = (p: Omit<Props, 'name'>) => <Icons8Icon name="help" {...p} />;
export const Github = (p: Omit<Props, 'name'>) => <Icons8Icon name="github" {...p} />;
export const CalendarDays = (p: Omit<Props, 'name'>) => <Icons8Icon name="calendar" {...p} />;
export const Puzzle = (p: Omit<Props, 'name'>) => <Icons8Icon name="puzzle" {...p} />;
export const Smartphone = (p: Omit<Props, 'name'>) => <Icons8Icon name="phone" {...p} />;
export const MonitorPlay = (p: Omit<Props, 'name'>) => <Icons8Icon name="monitor" {...p} />;
export const ShieldCheck = (p: Omit<Props, 'name'>) => <Icons8Icon name="shield" {...p} />;
export const ArrowLeftRight = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrows" {...p} />;
export const Crown = (p: Omit<Props, 'name'>) => <Icons8Icon name="crown" {...p} />;
export const History = (p: Omit<Props, 'name'>) => <Icons8Icon name="history" {...p} />;
export const KeyRound = (p: Omit<Props, 'name'>) => <Icons8Icon name="unlock" {...p} />;
export const LogOut = (p: Omit<Props, 'name'>) => <Icons8Icon name="logout" {...p} />;
export const Shield = (p: Omit<Props, 'name'>) => <Icons8Icon name="shield" {...p} />;
export const User = (p: Omit<Props, 'name'>) => <Icons8Icon name="user" {...p} />;
export const RefreshCw = (p: Omit<Props, 'name'>) => <Icons8Icon name="refresh" {...p} />;
export const Loader2 = (p: Omit<Props, 'name'>) => <span className={['inline-block animate-spin rounded-full border-2 border-current border-r-transparent', p.className].filter(Boolean).join(' ')} style={{ width: p.size ?? 20, height: p.size ?? 20 }} />;
export const X = (p: Omit<Props, 'name'>) => <Icons8Icon name="close" {...p} />;
export const Lightbulb = (p: Omit<Props, 'name'>) => <Icons8Icon name="info" {...p} />;

export const Network = (p: Omit<Props, 'name'>) => <Icons8Icon name="network" {...p} />;

export const ArrowUpRight = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrow-up-right" {...p} />;
export const BellRing = Bell;
export const Check = (p: Omit<Props, 'name'>) => <Icons8Icon name="check" {...p} />;
export const Trash2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="trash" {...p} />;
export const ChevronLeft = (p: Omit<Props, 'name'>) => <Icons8Icon name="chevron-left" {...p} />;
export const ChevronRight = (p: Omit<Props, 'name'>) => <Icons8Icon name="chevron-right" {...p} />;
