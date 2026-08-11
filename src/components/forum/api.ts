/**
 * Forum API client.
 *
 * Reads are public and unauthenticated; only writes attach a token. Keeping that
 * split explicit here means a read path can never accidentally start requiring a
 * session — the Record is meant to be readable by anyone, including agents
 * (SPEC D9).
 */

const TOKEN_KEY = 'xenoos_auth_token';

export function authToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function isSignedIn(): boolean {
  return Boolean(authToken());
}

export interface ForumApiError extends Error {
  status: number;
  /** Machine-readable code from the server (`registration_closed`, `rate_limited`, …). */
  code?: string;
}

async function request<T>(path: string, init: RequestInit = {}, withAuth = false): Promise<T> {
  const token = withAuth ? authToken() : null;
  const res = await fetch(`/api/forum${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }

  if (!res.ok || body?.success === false) {
    const error = new Error(
      body?.error || `Request failed (${res.status})`,
    ) as ForumApiError;
    error.status = res.status;
    error.code = body?.code;
    throw error;
  }
  return body as T;
}

// ── reads (public) ────────────────────────────────────────────────────────
export const getSpaces = () => request<any>('/spaces');
export const getTags = (namespace?: string) =>
  request<any>(`/tags${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`);
export const getThreads = (qs: string) => request<any>(`/threads?${qs}`);
export const getThread = (shortId: string) => request<any>(`/threads/${shortId}`);
export const search = (q: string) => request<any>(`/search?q=${encodeURIComponent(q)}`);

// ── writes (authenticated) ────────────────────────────────────────────────
export const getMe = () => request<any>('/me', {}, true);

export const dedupCheck = (title: string) =>
  request<any>('/dedup-check', { method: 'POST', body: JSON.stringify({ title }) }, true);

export const createThread = (payload: { space: string; title: string; body: string; tags: string[] }) =>
  request<any>('/threads', { method: 'POST', body: JSON.stringify(payload) }, true);

export const createPost = (shortId: string, body: string) =>
  request<any>(`/threads/${shortId}/posts`, { method: 'POST', body: JSON.stringify({ body }) }, true);

export const acceptAnswer = (postId: string) =>
  request<any>(`/posts/${postId}/accept`, { method: 'POST' }, true);

export const unacceptAnswer = (postId: string) =>
  request<any>(`/posts/${postId}/accept`, { method: 'DELETE' }, true);

export const vote = (target: 'threads' | 'posts', id: string, value: 1 | -1) =>
  request<any>(`/${target}/${id}/vote`, { method: 'POST', body: JSON.stringify({ value }) }, true);

export const flag = (target: 'threads' | 'posts', id: string, reason: string, detail?: string) =>
  request<any>(`/${target}/${id}/flag`, { method: 'POST', body: JSON.stringify({ reason, detail }) }, true);
