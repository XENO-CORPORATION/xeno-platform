/**
 * startDownload — turn a Download click into a grant, then a navigation.
 *
 * ── WHY A CLICK HANDLER AND NOT JUST AN href ────────────────────────────────
 *
 * Since the 2026-08-24 owner override an installer needs an active paid plan,
 * and `/product/:slug/download/:os` serves nothing without a signed grant.
 * It cannot read the session itself: this app authenticates with
 * `Authorization: Bearer` and sets NO auth cookie, so a plain <a> navigation
 * arrives with no credential at all — a paying customer would be bounced to
 * sign-in exactly like an anonymous visitor.
 *
 * So the SPA, which does hold the token, exchanges it for a short-lived grant
 * and navigates to the link with it.
 *
 * The href on those anchors stays the real deep-link on purpose. Middle-click
 * and "copy link" still go somewhere truthful — the sign-in redirect — rather
 * than to a dead `#`.
 */
import { AUTH_TOKEN_KEY } from './onboardingHandoff.js';

export type DownloadOs = 'windows' | 'mac' | 'linux';

/** Where to send someone who cannot download yet, preserving where they were. */
function bounce(to: string, returnTo: string) {
  window.location.href = `${to}?returnUrl=${encodeURIComponent(returnTo)}`;
}

function token(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null; // storage can throw in a locked-down browser; treat as signed out
  }
}

export type DownloadOutcome = 'started' | 'signin' | 'upgrade' | 'unavailable';

/**
 * Begin a download. Returns what happened so a caller can show a message
 * instead of guessing — a silent no-op on a Download button is indistinguishable
 * from a broken one.
 */
export async function startDownload(
  slug: string,
  os: DownloadOs,
  version?: string,
): Promise<DownloadOutcome> {
  const here = window.location.pathname + window.location.search;

  const t = token();
  if (!t) { bounce('/auth', here); return 'signin'; }

  let res: Response;
  try {
    res = await fetch('/api/downloads/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ slug, os, version }),
    });
  } catch {
    return 'unavailable'; // offline / network — do NOT pretend it worked
  }

  if (res.status === 401) { bounce('/auth', here); return 'signin'; }
  if (res.status === 403) { bounce('/pricing', here); return 'upgrade'; }
  if (!res.ok) return 'unavailable';

  const data = await res.json().catch(() => null);
  if (!data?.url) return 'unavailable';

  window.location.href = data.url;
  return 'started';
}

/** onClick for an <a> whose href is already the deep-link. */
export function downloadClickHandler(slug: string, os: DownloadOs, version?: string) {
  return (e: React.MouseEvent) => {
    // Leave modified clicks alone — the href is a truthful destination.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void startDownload(slug, os, version);
  };
}
