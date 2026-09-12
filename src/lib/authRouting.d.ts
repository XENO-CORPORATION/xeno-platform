export type AuthMode = 'signin' | 'signup';
export const LOGIN_PATH: '/login';
export const SIGNUP_PATH: '/signup';
export function safeReturnUrl(raw: unknown): string | null;
export function authReturnUrl(search: string): string | null;
export function normalizeClientId(raw: unknown): string | null;
export function clientIdFromReturnUrl(raw: unknown): string | null;
export function legacyAppClientId(app: unknown): string | null;
export function authClientId(search: string, legacyApp?: string): string | null;
export function canonicalAuthSearch(search: string, legacyApp?: string): string;
export function authPath(mode: AuthMode, search?: string, legacyApp?: string): string;
export function locationReturnPath(
  location: { pathname: string; search?: string; hash?: string } | null | undefined,
  fallback?: string,
): string;
