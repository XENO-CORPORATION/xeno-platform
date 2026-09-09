// One data-only operation policy shared by the hosted boundary and local proxy.
export const PREVIEW_POLICY_VERSION = '1';
export const PREVIEW_MODE = 'preview-readonly';
export const PREVIEW_LIFETIME_SECONDS = 3600;
export const PREVIEW_COOKIE = '__Host-xeno_preview_session';
export const PREVIEW_CSRF_COOKIE = '__Host-xeno_preview_csrf';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const reads = new Map([
  ['/api/auth/validate', []], ['/api/account/overview', []], ['/api/account/notifications', []],
  ['/api/account/sessions', []], ['/api/dashboard/stats', []], ['/api/billing/overview', []],
  ['/api/billing/subscription', []], ['/api/billing/ledger', ['limit', 'offset']],
  ['/api/billing/entitlements', []], ['/api/user-data/settings', []], ['/api/workspaces', []],
  ['/api/chat/projects', ['workspace_id']],
]);
export function previewOperation(method, rawUrl, headers = {}) {
  // Never normalize an ambiguous path into a permitted route.
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/') || /[\\#\s]/.test(rawUrl) || rawUrl.startsWith('//')) return null;
  const rawPath = rawUrl.split('?')[0];
  if (rawPath.includes('%') || rawPath.includes('//') || rawPath.split('/').some(p => p === '.' || p === '..')) return null;
  for (const key of Object.keys(headers)) if (/^(x-http-method|x-method-override|x-original-url|x-rewrite-url|upgrade)/i.test(key)) return null;
  const url = new URL(rawUrl, 'https://preview.invalid');
  const verb = String(method).toUpperCase();
  if (verb === 'POST' && !url.search) {
    if (rawPath === '/api/auth/login') return 'login';
    if (rawPath === '/api/auth/refresh') return 'refresh';
    if (rawPath === '/api/auth/logout') return 'logout';
  }
  if (verb !== 'GET') return null;
  if (rawPath === '/api/auth/preview-policy' && !url.search) return 'policy';
  let parameters = reads.get(rawPath);
  if (!parameters && new RegExp(`^/api/workspaces/${UUID}/members$`, 'i').test(rawPath)) parameters = [];
  if (!parameters && new RegExp(`^/api/chat/projects/${UUID}$`, 'i').test(rawPath)) parameters = ['workspace_id'];
  if (!parameters) return null;
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !parameters.includes(key)) return null;
    seen.add(key);
    if (key === 'workspace_id' && !new RegExp(`^${UUID}$`, 'i').test(value)) return null;
    if (key === 'limit' && (!/^\d{1,3}$/.test(value) || +value < 1 || +value > 200)) return null;
    if (key === 'offset' && (!/^\d{1,7}$/.test(value) || +value > 1000000)) return null;
  }
  return 'read';
}
