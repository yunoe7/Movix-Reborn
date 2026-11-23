import React from 'react';

export type Icons8Name = 'home' | 'film' | 'tv' | 'search' | 'bell' | 'star' | 'list' | 'settings' | 'shield' | 'crown' | 'history' | 'user' | 'users' | 'logout' | 'arrows' | 'chevron' | 'refresh' | 'clapper' | 'radio' | 'network' | 'unlock' | 'external' | 'grid' | 'dice' | 'sparkles' | 'help' | 'github' | 'calendar' | 'puzzle' | 'phone' | 'monitor' | 'plus' | 'close' | 'info' | 'play' | 'loading' | 'arrow-up-right' | 'check' | 'trash' | 'chevron-left' | 'chevron-right' | 'target' | 'flame' | 'compass' | 'download' | 'video' | 'alert' | 'eye' | 'eyeoff' | 'arrowdownup' | 'filter' | 'award' | 'globe' | 'tag' | 'arrowupdown' | 'heart' | 'login' | 'copy' | 'share' | 'message' | 'send' | 'clipboard' | 'userx' | 'maximize' | 'minimize' | 'hand' | 'clock' | 'checkcircle' | 'xcircle' | 'arrowleft' | 'tablet' | 'snowflake' | 'activity' | 'volume' | 'database' | 'key' | 'lock' | 'palette' | 'upload' | 'belloff' | 'zap' | 'listordered' | 'gauge' | 'megaphone' | 'square' | 'captions' | 'ghost' | 'leaf' | 'cloudrain' | 'flower' | 'popcorn' | 'link' | 'messagecircle' | 'calendarclock' | 'tree' | 'chevronup' | 'chevronright' | 'arrowup' | 'arrowdown' | 'videoicon' | 'loader' | 'tabletdevice' | 'volume2' | 'share2' | 'messagesquare' | 'checkcircle2' | 'xcircle2' | 'arrowdownup2' | 'arrowupdown2' | 'eyeoff2' | 'userx2' | 'arrowright' | 'shieldalert' | 'bellring' | 'flag' | 'gallery' | 'gift' | 'handcoins' | 'plug' | 'sprout' | 'wrench' | 'folder' | 'sortasc' | 'sortdesc' | 'type' | 'messageSquare' | 'server' | 'pause' | 'volumex' | 'volume1' | 'rewind' | 'fastforward' | 'repeat' | 'cast' | 'airplay' | 'pip' | 'scissors' | 'edit' | 'calendarplus' | 'sliders' | 'wifi' | 'rotate' | 'alertcircle' | 'drama' | 'ticket' | 'gridicon' | 'building' | 'mappin' | 'languages' | 'dollar' | 'trending' | 'bookmark' | 'trophy' | 'barchart' | 'timer' | 'hash' | 'checkcircleplain' | 'monitorsmartphone' | 'shuffle' | 'clipboardlist' | 'library' | 'handshake' | 'drag' | 'layers' | 'more' | 'cloudoff' | 'hourglass' | 'serveroff' | 'playlist' | 'camera' | 'thumbsup' | 'thumbsdown' | 'ban' | 'arrowupfromline' | 'coins' | 'image' | 'userplus' | 'minus' | 'arrowupleft' | 'arrowupright' | 'circle' | 'arrowdownleft' | 'arrowdownright' | 'folderplus' | 'smile' | 'euro' | 'scale' | 'apple' | 'flask' | 'map' | 'pointer' | 'arrowdownwide' | 'arrowupwide' | 'creditcard' | 'handheart' | 'timeroff' | 'bellplus' | 'bookmarkminus' | 'bookmarkplus' | 'filepen' | 'folderx' | 'heartoff' | 'listchecks' | 'listminus' | 'listplus' | 'playcircle' | 'staroff' | 'usercog' | 'qrcode' | 'rocket' | 'vote' | 'alignleft' | 'arrowbigup' | 'tags' | 'layouttemplate' | 'images' | 'imageplus' | 'imageoff' | 'pausecircle' | 'power' | 'save' | 'undo' | 'atsign' | 'contact' | 'mail' | 'wallet' | 'folderheart' | 'lifebuoy' | 'badgecheck' | 'grid3x3' | 'bookopen' | 'candy' | 'skull' | 'battery';
type Props = { name: Icons8Name; size?: number | string; className?: string; title?: string; style?: React.CSSProperties; strokeWidth?: number; absoluteStrokeWidth?: boolean };

const paths: Record<Icons8Name, string> = {
  "battery": "battery",
  "candy": "candy",
  "skull": "skull",
  "badgecheck": "verified",
  "grid3x3": "grid",
  "bookopen": "open-book",
  "atsign": "at-sign",
  "contact": "contact",
  "mail": "email",
  "wallet": "wallet",
  "folderheart": "folder-heart",
  "lifebuoy": "life-buoy",
  "layouttemplate": "template",
  "images": "images",
  "imageplus": "image-add",
  "imageoff": "image-off",
  "pausecircle": "pause",
  "power": "power",
  "save": "save",
  "undo": "undo",
  "tags": "tags",
  "bellplus": "bell-plus",
  "bookmarkminus": "bookmark-minus",
  "bookmarkplus": "bookmark-add",
  "filepen": "edit",
  "folderx": "folder-remove",
  "heartoff": "broken-heart",
  "listchecks": "checked-list",
  "listminus": "remove-from-list",
  "listplus": "add-to-list",
  "playcircle": "circled-play",
  "staroff": "star-outline",
  "usercog": "user-settings",
  "qrcode": "qr-code",
  "rocket": "rocket",
  "vote": "vote",
  "alignleft": "align-left",
  "arrowbigup": "up",
  "creditcard": "credit-card",
  "handheart": "hand-heart",
  "timeroff": "timer-off",
  "apple": "apple",
  "flask": "lab-flask",
  "map": "map",
  "pointer": "cursor-click",
  "arrowdownwide": "sort-down",
  "arrowupwide": "sort-up",
  "folderplus": "add-to-folder",
  "smile": "happy",
  "euro": "euro",
  "scale": "scales",
  "arrowupleft": "up-left",
  "arrowup": "up",
  "arrowupright": "up-right",
  "circle": "circle",
  "arrowdownleft": "down-left",
  "arrowdown": "down",
  "arrowdownright": "down-right",
  "thumbsup": "thumb-up",
  "thumbsdown": "thumb-down",
  "ban": "block",
  "arrowupfromline": "upload",
  "coins": "coins",
  "image": "image",
  "userplus": "add-user",
  "minus": "minus",
  "drag": "drag",
  "layers": "layers",
  "more": "more",
  "cloudoff": "cloud-off",
  "hourglass": "hourglass",
  "serveroff": "server-off",
  "playlist": "playlist",
  "camera": "camera",
  "gridicon": "grid",
  "building": "building",
  "mappin": "map-pin",
  "languages": "translation",
  "dollar": "usd",
  "trending": "line-chart",
  "bookmark": "bookmark",
  "trophy": "trophy",
  "barchart": "bar-chart",
  "timer": "timer",
  "hash": "hashtag",
  "checkcircleplain": "checkmark",
  "monitorsmartphone": "smartphone",
  "shuffle": "shuffle",
  "clipboardlist": "clipboard-list",
  "library": "library",
  "handshake": "handshake",
  "edit": "edit",
  "calendarplus": "calendar-plus",
  "sliders": "sliders",
  "wifi": "wi-fi",
  "rotate": "rotate-left",
  "unlock": "unlock",
  "alertcircle": "error",
  "drama": "theatre-masks",
  "ticket": "ticket",
  "pause": "pause",
  "volumex": "no-sound",
  "volume1": "low-volume",
  "rewind": "rewind",
  "fastforward": "fast-forward",
  "repeat": "repeat",
  "cast": "cast",
  "airplay": "airplay",
  "pip": "picture-in-picture",
  "scissors": "scissors",
  "server": "server",
  "flag": "flag",
  "gallery": "gallery",
  "gift": "gift",
  "handcoins": "coins",
  "plug": "plug",
  "sprout": "sprout",
  "wrench": "wrench",
  "folder": "open-folder",
  "sortasc": "sort-up",
  "sortdesc": "sort-down",
  "type": "text",
  "messageSquare": "message",
  "plus": "plus",
  "arrowright": "right",
  "shieldalert": "warning",
  "bellring": "bell",
  "info": "info",
  "target": "target",
  "flame": "fire",
  "compass": "compass",
  "download": "download",
  "video": "video",
  "calendar": "calendar",
  "alert": "warning",
  "eye": "visible",
  "eyeoff": "invisible",
  "arrowdownup": "sort",
  "filter": "filter",
  "award": "medal",
  "globe": "globe",
  "tag": "tag",
  "arrowupdown": "sort",
  "heart": "heart",
  "login": "login",
  "copy": "copy",
  "share": "share",
  "message": "message",
  "send": "sent",
  "clipboard": "clipboard",
  "userx": "remove-user",
  "maximize": "fullscreen",
  "minimize": "minimize",
  "hand": "hand",
  "clock": "clock",
  "checkcircle": "checked",
  "xcircle": "cancel",
  "arrowleft": "left",
  "monitor": "monitor",
  "tablet": "tablet",
  "snowflake": "snowflake",
  "activity": "activity",
  "trash": "trash",
  "volume": "high-volume",
  "database": "database",
  "key": "key",
  "lock": "lock",
  "palette": "color-palette",
  "upload": "upload",
  "belloff": "no-notifications",
  "zap": "flash",
  "listordered": "numbered-list",
  "gauge": "speed",
  "megaphone": "megaphone",
  "square": "stop",
  "captions": "subtitles",
  "ghost": "ghost",
  "leaf": "leaf",
  "cloudrain": "rain",
  "flower": "flower",
  "popcorn": "popcorn",
  "link": "link",
  "messagecircle": "message",
  "calendarclock": "calendar",
  "tree": "pine-tree",
  "chevronup": "up",
  "chevronright": "right",
  "external": "external-link",
  "videoicon": "video",
  "loader": "loading",
  "tabletdevice": "tablet",
  "volume2": "high-volume",
  "share2": "share",
  "messagesquare": "message",
  "checkcircle2": "checked",
  "xcircle2": "cancel",
  "arrowdownup2": "sort",
  "arrowupdown2": "sort",
  "eyeoff2": "invisible",
  "userx2": "remove-user",
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
  "network": "network",

  "grid": "grid",
  "dice": "dice",
  "sparkles": "sparkles",
  "help": "help",
  "github": "github",

  "puzzle": "puzzle",
  "phone": "smartphone",

  "close": "delete-sign",

  "play": "play",
  "loading": "loading",
  "arrow-up-right": "up-right",
  "check": "checkmark",

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

export const Info = (p: Omit<Props, 'name'>) => <Icons8Icon name="info" {...p} />;
export const Target = (p: Omit<Props, 'name'>) => <Icons8Icon name="target" {...p} />;
export const Flame = (p: Omit<Props, 'name'>) => <Icons8Icon name="flame" {...p} />;
export const Compass = (p: Omit<Props, 'name'>) => <Icons8Icon name="compass" {...p} />;
export const Download = (p: Omit<Props, 'name'>) => <Icons8Icon name="download" {...p} />;
export const Video = (p: Omit<Props, 'name'>) => <Icons8Icon name="video" {...p} />;
export const Calendar = (p: Omit<Props, 'name'>) => <Icons8Icon name="calendar" {...p} />;
export const AlertTriangle = (p: Omit<Props, 'name'>) => <Icons8Icon name="alert" {...p} />;
export const Eye = (p: Omit<Props, 'name'>) => <Icons8Icon name="eye" {...p} />;
export const EyeOff = (p: Omit<Props, 'name'>) => <Icons8Icon name="eyeoff" {...p} />;
export const ArrowDownUp = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrowdownup" {...p} />;
export const Filter = (p: Omit<Props, 'name'>) => <Icons8Icon name="filter" {...p} />;
export const Award = (p: Omit<Props, 'name'>) => <Icons8Icon name="award" {...p} />;
export const Globe = (p: Omit<Props, 'name'>) => <Icons8Icon name="globe" {...p} />;
export const Tag = (p: Omit<Props, 'name'>) => <Icons8Icon name="tag" {...p} />;
export const ArrowUpDown = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrowupdown" {...p} />;
export const Heart = (p: Omit<Props, 'name'>) => <Icons8Icon name="heart" {...p} />;
export const LogIn = (p: Omit<Props, 'name'>) => <Icons8Icon name="login" {...p} />;
export const Copy = (p: Omit<Props, 'name'>) => <Icons8Icon name="copy" {...p} />;
export const Share2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="share" {...p} />;
export const MessageSquare = (p: Omit<Props, 'name'>) => <Icons8Icon name="message" {...p} />;
export const Send = (p: Omit<Props, 'name'>) => <Icons8Icon name="send" {...p} />;
export const Clipboard = (p: Omit<Props, 'name'>) => <Icons8Icon name="clipboard" {...p} />;
export const UserX = (p: Omit<Props, 'name'>) => <Icons8Icon name="userx" {...p} />;
export const Maximize = (p: Omit<Props, 'name'>) => <Icons8Icon name="maximize" {...p} />;
export const Minimize = (p: Omit<Props, 'name'>) => <Icons8Icon name="minimize" {...p} />;
export const Hand = (p: Omit<Props, 'name'>) => <Icons8Icon name="hand" {...p} />;
export const Clock = (p: Omit<Props, 'name'>) => <Icons8Icon name="clock" {...p} />;
export const CheckCircle2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="checkcircle" {...p} />;
export const XCircle = (p: Omit<Props, 'name'>) => <Icons8Icon name="xcircle" {...p} />;
export const ArrowLeft = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrowleft" {...p} />;
export const Monitor = (p: Omit<Props, 'name'>) => <Icons8Icon name="monitor" {...p} />;
export const Tablet = (p: Omit<Props, 'name'>) => <Icons8Icon name="tablet" {...p} />;
export const Snowflake = (p: Omit<Props, 'name'>) => <Icons8Icon name="snowflake" {...p} />;
export const Activity = (p: Omit<Props, 'name'>) => <Icons8Icon name="activity" {...p} />;
export const Volume2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="volume" {...p} />;
export const Database = (p: Omit<Props, 'name'>) => <Icons8Icon name="database" {...p} />;
export const Key = (p: Omit<Props, 'name'>) => <Icons8Icon name="key" {...p} />;
export const Lock = (p: Omit<Props, 'name'>) => <Icons8Icon name="lock" {...p} />;
export const Palette = (p: Omit<Props, 'name'>) => <Icons8Icon name="palette" {...p} />;
export const Upload = (p: Omit<Props, 'name'>) => <Icons8Icon name="upload" {...p} />;
export const BellOff = (p: Omit<Props, 'name'>) => <Icons8Icon name="belloff" {...p} />;
export const Zap = (p: Omit<Props, 'name'>) => <Icons8Icon name="zap" {...p} />;
export const ListOrdered = (p: Omit<Props, 'name'>) => <Icons8Icon name="listordered" {...p} />;
export const Gauge = (p: Omit<Props, 'name'>) => <Icons8Icon name="gauge" {...p} />;
export const Megaphone = (p: Omit<Props, 'name'>) => <Icons8Icon name="megaphone" {...p} />;
export const Square = (p: Omit<Props, 'name'>) => <Icons8Icon name="square" {...p} />;
export const Captions = (p: Omit<Props, 'name'>) => <Icons8Icon name="captions" {...p} />;
export const Ghost = (p: Omit<Props, 'name'>) => <Icons8Icon name="ghost" {...p} />;
export const Leaf = (p: Omit<Props, 'name'>) => <Icons8Icon name="leaf" {...p} />;
export const CloudRain = (p: Omit<Props, 'name'>) => <Icons8Icon name="cloudrain" {...p} />;
export const Flower2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="flower" {...p} />;
export const Popcorn = (p: Omit<Props, 'name'>) => <Icons8Icon name="popcorn" {...p} />;
export const Link2 = (p: Omit<Props, 'name'>) => <Icons8Icon name="link" {...p} />;
export const MessageCircle = (p: Omit<Props, 'name'>) => <Icons8Icon name="messagecircle" {...p} />;
export const CalendarClock = (p: Omit<Props, 'name'>) => <Icons8Icon name="calendarclock" {...p} />;
export const TreePine = (p: Omit<Props, 'name'>) => <Icons8Icon name="tree" {...p} />;
export const ChevronUp = (p: Omit<Props, 'name'>) => <Icons8Icon name="chevronup" {...p} />;
export const Loader = (p: Omit<Props, 'name'>) => <Icons8Icon name="loader" {...p} />;
export type LucideProps = Omit<Props, 'name'>;
export type LucideIcon = React.ComponentType<LucideProps>;

export const Plus = (p: Omit<Props, 'name'>) => <Icons8Icon name="plus" {...p} />;
export const ArrowRight = (p: Omit<Props, 'name'>) => <Icons8Icon name="arrowright" {...p} />;
export const ShieldAlert = (p: Omit<Props, 'name'>) => <Icons8Icon name="shieldalert" {...p} />;

export const Flag = (p: Omit<Props, 'name'>) => <Icons8Icon name="flag" {...p} />;
export const GalleryHorizontalEnd = (p: Omit<Props, 'name'>) => <Icons8Icon name="gallery" {...p} />;
export const Gift = (p: Omit<Props, 'name'>) => <Icons8Icon name="gift" {...p} />;
export const HandCoins = (p: Omit<Props, 'name'>) => <Icons8Icon name="handcoins" {...p} />;
export const Plug = (p: Omit<Props, 'name'>) => <Icons8Icon name="plug" {...p} />;
export const Sprout = (p: Omit<Props, 'name'>) => <Icons8Icon name="sprout" {...p} />;
export const Wrench = (p: Omit<Props, 'name'>) => <Icons8Icon name="wrench" {...p} />;
export const FolderOpen = (p: Omit<Props, 'name'>) => <Icons8Icon name="folder" {...p} />;
export const SortAsc = (p: Omit<Props, 'name'>) => <Icons8Icon name="sortasc" {...p} />;
export const SortDesc = (p: Omit<Props, 'name'>) => <Icons8Icon name="sortdesc" {...p} />;
export const Type = (p: Omit<Props, 'name'>) => <Icons8Icon name="type" {...p} />;

export const Server = (p: Omit<Props, "name">) => <Icons8Icon name="server" {...p} />;

export const Play = (p: Omit<Props, "name">) => <Icons8Icon name="play" {...p} />;

export const Pause = (p: Omit<Props, "name">) => <Icons8Icon name="pause" {...p} />;
export const VolumeX = (p: Omit<Props, "name">) => <Icons8Icon name="volumex" {...p} />;
export const Volume1 = (p: Omit<Props, "name">) => <Icons8Icon name="volume1" {...p} />;
export const Rewind = (p: Omit<Props, "name">) => <Icons8Icon name="rewind" {...p} />;
export const FastForward = (p: Omit<Props, "name">) => <Icons8Icon name="fastforward" {...p} />;
export const Repeat = (p: Omit<Props, "name">) => <Icons8Icon name="repeat" {...p} />;
export const Cast = (p: Omit<Props, "name">) => <Icons8Icon name="cast" {...p} />;
export const Airplay = (p: Omit<Props, "name">) => <Icons8Icon name="airplay" {...p} />;
export const PictureInPicture = (p: Omit<Props, "name">) => <Icons8Icon name="pip" {...p} />;
export const Scissors = (p: Omit<Props, "name">) => <Icons8Icon name="scissors" {...p} />;

export const Edit = (p: Omit<Props, "name">) => <Icons8Icon name="edit" {...p} />;
export const Edit3 = (p: Omit<Props, "name">) => <Icons8Icon name="edit" {...p} />;
export const CalendarPlus = (p: Omit<Props, "name">) => <Icons8Icon name="calendarplus" {...p} />;
export const SlidersHorizontal = (p: Omit<Props, "name">) => <Icons8Icon name="sliders" {...p} />;
export const Wifi = (p: Omit<Props, "name">) => <Icons8Icon name="wifi" {...p} />;
export const RotateCcw = (p: Omit<Props, "name">) => <Icons8Icon name="rotate" {...p} />;
export const LockKeyhole = (p: Omit<Props, "name">) => <Icons8Icon name="unlock" {...p} />;
export const AlertCircle = (p: Omit<Props, "name">) => <Icons8Icon name="alertcircle" {...p} />;
export const Drama = (p: Omit<Props, "name">) => <Icons8Icon name="drama" {...p} />;
export const Ticket = (p: Omit<Props, "name">) => <Icons8Icon name="ticket" {...p} />;

export const Grid = (p: Omit<Props, "name">) => <Icons8Icon name="gridicon" {...p} />;
export const Building = (p: Omit<Props, "name">) => <Icons8Icon name="building" {...p} />;
export const MapPin = (p: Omit<Props, "name">) => <Icons8Icon name="mappin" {...p} />;
export const Languages = (p: Omit<Props, "name">) => <Icons8Icon name="languages" {...p} />;
export const DollarSign = (p: Omit<Props, "name">) => <Icons8Icon name="dollar" {...p} />;
export const TrendingUp = (p: Omit<Props, "name">) => <Icons8Icon name="trending" {...p} />;
export const Bookmark = (p: Omit<Props, "name">) => <Icons8Icon name="bookmark" {...p} />;
export const Trophy = (p: Omit<Props, "name">) => <Icons8Icon name="trophy" {...p} />;
export const BarChart3 = (p: Omit<Props, "name">) => <Icons8Icon name="barchart" {...p} />;
export const Timer = (p: Omit<Props, "name">) => <Icons8Icon name="timer" {...p} />;
export const Hash = (p: Omit<Props, "name">) => <Icons8Icon name="hash" {...p} />;
export const CheckCircle = (p: Omit<Props, "name">) => <Icons8Icon name="checkcircleplain" {...p} />;
export const MonitorSmartphone = (p: Omit<Props, "name">) => <Icons8Icon name="monitorsmartphone" {...p} />;
export const Shuffle = (p: Omit<Props, "name">) => <Icons8Icon name="shuffle" {...p} />;
export const ClipboardList = (p: Omit<Props, "name">) => <Icons8Icon name="clipboardlist" {...p} />;
export const Library = (p: Omit<Props, "name">) => <Icons8Icon name="library" {...p} />;
export const HeartHandshake = (p: Omit<Props, "name">) => <Icons8Icon name="handshake" {...p} />;

export const Pencil = (p: Omit<Props, "name">) => <Icons8Icon name="edit" {...p} />;
export const GripVertical = (p: Omit<Props, "name">) => <Icons8Icon name="drag" {...p} />;
export const Layers = (p: Omit<Props, "name">) => <Icons8Icon name="layers" {...p} />;
export const MoreVertical = (p: Omit<Props, "name">) => <Icons8Icon name="more" {...p} />;
export const MoreHorizontal = (p: Omit<Props, "name">) => <Icons8Icon name="more" {...p} />;
export const CloudOff = (p: Omit<Props, "name">) => <Icons8Icon name="cloudoff" {...p} />;
export const Hourglass = (p: Omit<Props, "name">) => <Icons8Icon name="hourglass" {...p} />;
export const ServerOff = (p: Omit<Props, "name">) => <Icons8Icon name="serveroff" {...p} />;
export const ListVideo = (p: Omit<Props, "name">) => <Icons8Icon name="playlist" {...p} />;
export const Camera = (p: Omit<Props, "name">) => <Icons8Icon name="camera" {...p} />;

export const ThumbsUp = (p: Omit<Props, "name">) => <Icons8Icon name="thumbsup" {...p} />;
export const ThumbsDown = (p: Omit<Props, "name">) => <Icons8Icon name="thumbsdown" {...p} />;
export const Ban = (p: Omit<Props, "name">) => <Icons8Icon name="ban" {...p} />;
export const ArrowUpFromLine = (p: Omit<Props, "name">) => <Icons8Icon name="arrowupfromline" {...p} />;
export const Coins = (p: Omit<Props, "name">) => <Icons8Icon name="coins" {...p} />;
export const Image = (p: Omit<Props, "name">) => <Icons8Icon name="image" {...p} />;
export const UserPlus = (p: Omit<Props, "name">) => <Icons8Icon name="userplus" {...p} />;
export const Minus = (p: Omit<Props, "name">) => <Icons8Icon name="minus" {...p} />;

export const ArrowUpLeft = (p: Omit<Props, "name">) => <Icons8Icon name="arrowupleft" {...p} />;
export const ArrowUp = (p: Omit<Props, "name">) => <Icons8Icon name="arrowup" {...p} />;
export const Circle = (p: Omit<Props, "name">) => <Icons8Icon name="circle" {...p} />;
export const ArrowDownLeft = (p: Omit<Props, "name">) => <Icons8Icon name="arrowdownleft" {...p} />;
export const ArrowDown = (p: Omit<Props, "name">) => <Icons8Icon name="arrowdown" {...p} />;
export const ArrowDownRight = (p: Omit<Props, "name">) => <Icons8Icon name="arrowdownright" {...p} />;
export const MessagesSquare = (p: Omit<Props, "name">) => <Icons8Icon name="message" {...p} />;

export const FolderPlus = (p: Omit<Props, "name">) => <Icons8Icon name="folderplus" {...p} />;
export const Smile = (p: Omit<Props, "name">) => <Icons8Icon name="smile" {...p} />;
export const Euro = (p: Omit<Props, "name">) => <Icons8Icon name="euro" {...p} />;
export const Scale = (p: Omit<Props, "name">) => <Icons8Icon name="scale" {...p} />;
export const UserRound = (p: Omit<Props, "name">) => <Icons8Icon name="user" {...p} />;
export const RefreshCcw = (p: Omit<Props, "name">) => <Icons8Icon name="refresh" {...p} />;

export const Apple = (p: Omit<Props, "name">) => <Icons8Icon name="apple" {...p} />;
export const FlaskConical = (p: Omit<Props, "name">) => <Icons8Icon name="flask" {...p} />;
export const Map = (p: Omit<Props, "name">) => <Icons8Icon name="map" {...p} />;
export const MousePointerClick = (p: Omit<Props, "name">) => <Icons8Icon name="pointer" {...p} />;
export const ArrowDownWideNarrow = (p: Omit<Props, "name">) => <Icons8Icon name="arrowdownwide" {...p} />;
export const ArrowUpWideNarrow = (p: Omit<Props, "name">) => <Icons8Icon name="arrowupwide" {...p} />;

export const Shrink = (p: Omit<Props, "name">) => <Icons8Icon name="minimize" {...p} />;

export type LucideIcon = React.ComponentType<any>;
export const Clock3 = Clock;
export const CreditCard = (p: Omit<Props, "name">) => <Icons8Icon name="creditcard" {...p} />;
export const HandHeart = (p: Omit<Props, "name">) => <Icons8Icon name="handheart" {...p} />;
export const TimerOff = (p: Omit<Props, "name">) => <Icons8Icon name="timeroff" {...p} />;

export const BellPlus = (p: Omit<Props, "name">) => <Icons8Icon name="bellplus" {...p} />;
export const BookmarkMinus = (p: Omit<Props, "name">) => <Icons8Icon name="bookmarkminus" {...p} />;
export const BookmarkPlus = (p: Omit<Props, "name">) => <Icons8Icon name="bookmarkplus" {...p} />;
export const FilePenLine = (p: Omit<Props, "name">) => <Icons8Icon name="filepen" {...p} />;
export const FolderX = (p: Omit<Props, "name">) => <Icons8Icon name="folderx" {...p} />;
export const HeartOff = (p: Omit<Props, "name">) => <Icons8Icon name="heartoff" {...p} />;
export const ListChecks = (p: Omit<Props, "name">) => <Icons8Icon name="listchecks" {...p} />;
export const ListMinus = (p: Omit<Props, "name">) => <Icons8Icon name="listminus" {...p} />;
export const ListPlus = (p: Omit<Props, "name">) => <Icons8Icon name="listplus" {...p} />;
export const PlayCircle = (p: Omit<Props, "name">) => <Icons8Icon name="playcircle" {...p} />;
export const StarOff = (p: Omit<Props, "name">) => <Icons8Icon name="staroff" {...p} />;
export const UserRoundCog = (p: Omit<Props, "name">) => <Icons8Icon name="usercog" {...p} />;
export const QrCode = (p: Omit<Props, "name">) => <Icons8Icon name="qrcode" {...p} />;
export const Rocket = (p: Omit<Props, "name">) => <Icons8Icon name="rocket" {...p} />;
export const Vote = (p: Omit<Props, "name">) => <Icons8Icon name="vote" {...p} />;
export const AlignLeft = (p: Omit<Props, "name">) => <Icons8Icon name="alignleft" {...p} />;
export const ArrowBigUp = (p: Omit<Props, "name">) => <Icons8Icon name="arrowbig" {...p} />;
export const LinkIcon = (p: Omit<Props, "name">) => <Icons8Icon name="link" {...p} />;

export const Tags = (p: Omit<Props, "name">) => <Icons8Icon name="tags" {...p} />;

export const LayoutTemplate = (p: Omit<Props, "name">) => <Icons8Icon name="layouttemplate" {...p} />;
export const Images = (p: Omit<Props, "name">) => <Icons8Icon name="images" {...p} />;
export const ImagePlus = (p: Omit<Props, "name">) => <Icons8Icon name="imageplus" {...p} />;
export const ImageOff = (p: Omit<Props, "name">) => <Icons8Icon name="imageoff" {...p} />;
export const PauseCircle = (p: Omit<Props, "name">) => <Icons8Icon name="pausecircle" {...p} />;
export const Power = (p: Omit<Props, "name">) => <Icons8Icon name="power" {...p} />;
export const Save = (p: Omit<Props, "name">) => <Icons8Icon name="save" {...p} />;
export const Undo2 = (p: Omit<Props, "name">) => <Icons8Icon name="undo" {...p} />;

export const AtSign = (p: Omit<Props, "name">) => <Icons8Icon name="atsign" {...p} />;
export const Contact = (p: Omit<Props, "name">) => <Icons8Icon name="contact" {...p} />;
export const Mail = (p: Omit<Props, "name">) => <Icons8Icon name="mail" {...p} />;
export const Wallet = (p: Omit<Props, "name">) => <Icons8Icon name="wallet" {...p} />;
export const FolderHeart = (p: Omit<Props, "name">) => <Icons8Icon name="folderheart" {...p} />;
export const LifeBuoy = (p: Omit<Props, "name">) => <Icons8Icon name="lifebuoy" {...p} />;

export const BadgeCheck = (p: Omit<Props, "name">) => <Icons8Icon name="badgecheck" {...p} />;
export const Grid3X3 = (p: Omit<Props, "name">) => <Icons8Icon name="grid3x3" {...p} />;
export const BookOpen = (p: Omit<Props, "name">) => <Icons8Icon name="bookopen" {...p} />;

export const Candy = (p: Omit<Props, "name">) => <Icons8Icon name="candy" {...p} />;
export const Skull = (p: Omit<Props, "name">) => <Icons8Icon name="skull" {...p} />;

export const BatteryCharging = (p: Omit<Props, "name">) => <Icons8Icon name="battery" {...p} />;
