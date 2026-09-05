const LEGACY_TOKEN_KEY = 'xenoos_auth_token';
const CSRF_COOKIE_NAMES = ['__Host-xeno_csrf', 'xeno_csrf'];

let accessToken: string | null = null;
let authenticated = false;
const COOKIE_SESSION_MARKER = '__xeno_cookie_session__';

// One-release migration: rescue an existing signed-in tab, then remove the
// bearer from persistent browser storage immediately. New sessions never write
// it there.
try {
  accessToken = localStorage.getItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch { /* storage may be unavailable */ }

// Compatibility for code paths that use token presence as an authenticated
// predicate. The marker is not a credential and the fetch interceptor removes
// it from outgoing headers.
export function getAccessToken(): string | null { return accessToken || (authenticated ? COOKIE_SESSION_MARKER : null); }
export function getLegacyAccessToken(): string | null { return accessToken; }
export function setAccessToken(token: string | null): void { accessToken = token; }
export function hasAuthSession(): boolean { return authenticated || Boolean(accessToken); }
export function setAuthSession(value: boolean): void { authenticated = value; }
export function clearAuthSession(): void { accessToken = null; authenticated = false; }

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const name of CSRF_COOKIE_NAMES) {
    const prefix = `${name}=`;
    const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (match) return decodeURIComponent(match.slice(prefix.length));
  }
  return null;
}

let installed = false;
export function installAuthenticatedFetch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const requestUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(requestUrl, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const legacy = getLegacyAccessToken();
    const existingAuth = headers.get('authorization');
    if (existingAuth === 'Bearer null' || existingAuth === 'Bearer undefined'
        || existingAuth === `Bearer ${COOKIE_SESSION_MARKER}`) headers.delete('authorization');
    if (!headers.has('authorization') && legacy) headers.set('authorization', `Bearer ${legacy}`);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = readCsrfCookie();
      if (csrf && !headers.has('x-xeno-csrf')) headers.set('x-xeno-csrf', csrf);
    }
    return nativeFetch(input, { ...init, credentials: init.credentials || 'same-origin', headers });
  };
}
