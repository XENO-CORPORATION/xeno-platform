/**
 * The download funnel — client half.
 *
 * One call, `beginDownload(slug, os)`, from anywhere. It creates an intent, asks
 * the server what the person is missing, and either starts the download or sends
 * them to the one place that can fix it.
 *
 * 🔴 The server decides, always. This module never guesses at entitlement, never
 * reads a plan out of localStorage, and never hides a button because it thinks
 * someone cannot use it. A client-side gate is a suggestion; the only thing that
 * refuses is the grant endpoint. That separation is what stops the UI and the
 * enforcement drifting apart — the classic version of which is a "helpful"
 * front-end that hides Download from paying customers whose token had merely
 * expired.
 */

export type DownloadState = 'signin' | 'onboarding' | 'plan' | 'unavailable' | 'ready';

export interface IntentEnvelope {
  token: string;
  slug: string;
  os: string;
  state: DownloadState;
  reason: string | null;
  next: string;
  version: string | null;
  filename: string | null;
  currentPlan: string | null;
}

const API = '/api';
const TOKEN_KEY = 'xenoos_auth_token';
const ANON_KEY = 'xeno_anon_id';

function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

/**
 * A first-party visitor id, minted in the browser and stored locally.
 *
 * It exists to answer one question no other identifier can: "did this account
 * get created BECAUSE someone tried to download something?" A user id cannot
 * answer it — at the moment of the click there is no user. It is not a
 * credential, it is not sent to anyone else, and the server treats it as a
 * grouping hint with no authority, so two people colliding on one corrupts a
 * marketing number and nothing else.
 */
export function anonId(): string | null {
  try {
    let v = localStorage.getItem(ANON_KEY);
    if (!v) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ANON_KEY, v);
    }
    return v;
  } catch {
    /* Private mode, or storage disabled. Attribution degrades; the download must
     * not. Never let a missing analytics id block a purchase. */
    return null;
  }
}

function utmFromLocation(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) {
      const v = q.get(k);
      if (v) out[k] = v.slice(0, 128);
    }
  } catch { /* nothing to report */ }
  return out;
}

/** Create an intent and get the verdict. */
export async function createIntent(slug: string, os: string, opts: {
  version?: string; channel?: string;
} = {}): Promise<IntentEnvelope | null> {
  try {
    const res = await fetch(`${API}/downloads/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        slug,
        os,
        version: opts.version || '',
        channel: opts.channel || 'stable',
        anonId: anonId(),
        originPath: typeof window !== 'undefined' ? window.location.pathname : null,
        referrer: typeof document !== 'undefined' ? document.referrer || null : null,
        utm: utmFromLocation(),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as IntentEnvelope;
  } catch {
    return null;
  }
}

/** Re-ask. The resume page polls this while it waits for a webhook to land. */
export async function readIntent(token: string): Promise<IntentEnvelope | null> {
  try {
    const res = await fetch(`${API}/downloads/intent/${encodeURIComponent(token)}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) return null;
    return (await res.json()) as IntentEnvelope;
  } catch {
    return null;
  }
}

/**
 * Bind an intent to the account that just authenticated.
 *
 * ⚠️ Returns null WITHOUT calling when there is no token. Claiming is an
 * authenticated action, so an anonymous caller gets a guaranteed 401 — a failed
 * request and a console error on every single anonymous visit to the resume
 * page. Nobody would ever see it (the page works), which is exactly why it would
 * be permanent: a console full of expected errors is a console nobody reads.
 */
export async function claimIntent(token: string, wasSignup: boolean): Promise<IntentEnvelope | null> {
  if (!authHeaders().Authorization) return null;
  try {
    const res = await fetch(`${API}/downloads/intent/${encodeURIComponent(token)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ signup: wasSignup }),
    });
    if (!res.ok) return null;
    return (await res.json()) as IntentEnvelope;
  } catch {
    return null;
  }
}

/**
 * Mint a grant and hand the browser the file.
 *
 * `location.assign` rather than a synthetic anchor click: the response is a 302
 * to a large binary, and letting the browser's own download manager own it is
 * what makes resume-on-flaky-connection work. A fetch+blob would buffer 140 MB
 * in a tab first.
 */
export async function startTransfer(slug: string, os: string, intent?: string, version?: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/downloads/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ slug, os, version: version || '', intent: intent || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.url) return false;
    window.location.assign(data.url);
    return true;
  } catch {
    return false;
  }
}

/**
 * The whole flow, from a click.
 *
 * Returns the state it ended in so a caller can render, but it also NAVIGATES
 * when navigation is the right answer — because the states that are not `ready`
 * are all "this happens somewhere else".
 */
export async function beginDownload(slug: string, os: string, opts: {
  version?: string;
  onState?: (s: DownloadState) => void;
} = {}): Promise<DownloadState> {
  const env = await createIntent(slug, os, { version: opts.version });

  if (!env) {
    /* The funnel is unreachable. Fall back to a bare grant attempt: a signed-in,
     * entitled customer must still be able to download when analytics is down.
     * Measurement is never allowed to become a dependency of the product. */
    const ok = await startTransfer(slug, os, undefined, opts.version);
    if (ok) { opts.onState?.('ready'); return 'ready'; }
    opts.onState?.('signin');
    window.location.assign(
      `/auth?returnUrl=${encodeURIComponent(`/product/${slug}`)}`,
    );
    return 'signin';
  }

  opts.onState?.(env.state);

  if (env.state === 'ready') {
    const ok = await startTransfer(env.slug, env.os, env.token, env.version || undefined);
    if (!ok) {
      /* Resolved READY and the mint refused — a plan that lapsed between the two
       * calls, or a token that expired mid-flow. The resume page re-derives from
       * scratch, so send them there rather than guessing here. */
      window.location.assign(`/download/resume?i=${encodeURIComponent(env.token)}`);
    }
    return 'ready';
  }

  window.location.assign(env.next);
  return env.state;
}
