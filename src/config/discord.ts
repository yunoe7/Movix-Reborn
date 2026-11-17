// Client-side Discord OAuth configuration only.
// Authorization decisions are always verified server-side by Mainapi.
const getRedirectUri = () => `${window.location.origin}/auth`;

export const DISCORD_CONFIG = {
  // Existing Discord OAuth application used by the current Movix deployment.
  // This is a public application ID; never put the bot token in frontend config.
  CLIENT_ID: '1517232036425895996',
  GUILD_ID: '1570056496471867483',
  OWNER_USER_ID: '1239889177055596607',
  ADMIN_ROLE_IDS: ['1570072172104261732'],
  MODERATOR_ROLE_IDS: ['1570312607988977667'],
  VIP_ROLE_IDS: ['1570312606940659755'],
  get REDIRECT_URI() {
    return getRedirectUri();
  },
  SCOPES: ['identify', 'guilds', 'guilds.members.read'],
  API_ENDPOINT: 'https://discord.com/api/v10',
  CACHE_DURATION: 40
};
