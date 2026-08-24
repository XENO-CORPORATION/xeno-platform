/**
 * Download click handling — the compatibility surface.
 *
 * ── WHY THIS FILE IS NOW A SHIM ─────────────────────────────────────────────
 *
 * It used to own the logic: exchange the session for a grant, navigate, and on a
 * refusal send the person to sign-in or pricing. That was correct as far as it
 * went and it lost the person's INTENT at every bounce — they arrived at
 * `/auth`, or at `/pricing`, with nothing recording that they had been trying to
 * download Pixel for Windows, so nothing could bring them back and nothing could
 * attribute the account or the purchase that followed.
 *
 * The logic now lives in `downloadFlow.ts`, which creates a durable intent
 * first. This file stays because five components import `downloadClickHandler`
 * from it, and a shim is cheaper and safer than five simultaneous edits — but it
 * holds no rules of its own. If you are adding behaviour, add it there.
 *
 * The href on those anchors stays the real deep-link on purpose: middle-click and
 * "copy link" still go somewhere truthful rather than to a dead `#`.
 */
import { beginDownload, type DownloadState } from './downloadFlow';

export type DownloadOs = 'windows' | 'mac' | 'linux';

/** Kept for callers that want the outcome rather than a handler. */
export type StartDownloadResult = 'started' | 'signin' | 'upgrade' | 'unavailable';

const AS_RESULT: Record<DownloadState, StartDownloadResult> = {
  ready: 'started',
  signin: 'signin',
  onboarding: 'signin',
  plan: 'upgrade',
  unavailable: 'unavailable',
};

export async function startDownload(
  slug: string,
  os: DownloadOs,
  version?: string,
): Promise<StartDownloadResult> {
  const state = await beginDownload(slug, os, { version });
  return AS_RESULT[state] ?? 'unavailable';
}

/** onClick for an <a> whose href is already the deep-link. */
export function downloadClickHandler(slug: string, os: DownloadOs, version?: string) {
  return (e: React.MouseEvent) => {
    // Leave modified clicks alone — the href is a truthful destination.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void beginDownload(slug, os, { version });
  };
}
