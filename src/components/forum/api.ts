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

/**
 * A 401 means the token we are holding is no longer valid — expired, revoked, or
 * from a suspended account. Holding a stale token is indistinguishable from being
 * signed out as far as the UI is concerned, so treat it that way instead of
 * rendering an error the user can do nothing about.
 *
 * (This is what put `GET /api/forum/feed 401` in the console: isSignedIn() was
 * true because a token EXISTED, so the feed was requested with a credential the
 * server had already stopped honouring.)
 */
export function clearStaleSession(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
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
    // An authenticated request rejected as unauthenticated means the stored token
    // is dead. Drop it so the UI falls back to the signed-out state rather than
    // retrying a credential the server will never accept.
    if (withAuth && res.status === 401) clearStaleSession();

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

// ── the Feed (v0.4) — the only inherently personal surface ────────────────
export const getFeed = (ranker?: string) =>
  request<any>(`/feed${ranker ? `?ranker=${encodeURIComponent(ranker)}` : ''}`, {}, true);

export const markOpened = (shortId: string) =>
  request<any>(`/threads/${shortId}/opened`, { method: 'POST' }, true).catch(() => null);

// Subscriptions. The read side (`getViewerContext` -> ranker fit) shipped in
// v0.4 with no way to write a row, so `my-topics` was permanently empty.
export const getSubscriptions = () => request<any>('/subscriptions', {}, true);

export const subscribeTag = (tag: string) =>
  request<any>('/subscriptions', { method: 'POST', body: JSON.stringify({ tag }) }, true);

export const unsubscribeTag = (tag: string) =>
  request<any>('/subscriptions', { method: 'DELETE', body: JSON.stringify({ tag }) }, true);

// Notifications (WP1). The return path: you ask, someone answers, you find out.
export const getNotifications = (unreadOnly = false) =>
  request<any>(`/notifications${unreadOnly ? '?unread=1' : ''}`, {}, true);

export const markNotificationsRead = (ids?: string[]) =>
  request<any>('/notifications/read', {
    method: 'POST',
    body: JSON.stringify(ids ? { ids } : {}),
  }, true);

// Follow / mute a thread. Posting subscribes you automatically; this is the way
// back out, and it is why reply fan-out was safe to ship.
export const setThreadSubscription = (shortId: string, subscribed: boolean) =>
  request<any>(`/threads/${shortId}/subscription`, {
    method: 'PUT',
    body: JSON.stringify({ subscribed }),
  }, true);

// Edit / delete your own post (WP2). Every edit is marked; delete tombstones
// the row and blanks the body.
export const editPost = (postId: string, body: string) =>
  request<any>(`/posts/${postId}`, { method: 'PATCH', body: JSON.stringify({ body }) }, true);

export const deletePost = (postId: string) =>
  request<any>(`/posts/${postId}`, { method: 'DELETE' }, true);
