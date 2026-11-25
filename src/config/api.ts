// Shared API origin for browser builds. Cloudflare Pages may omit the build-time
// variable on mirrors/previews; keep the production Railway API as a safe fallback.
const configuredApiBase = String(import.meta.env.VITE_MAIN_API || '').trim();

export const API_BASE_URL = (
  configuredApiBase || 'https://main-api-production-1590f478.up.railway.app'
).replace(/\/+$/, '');
