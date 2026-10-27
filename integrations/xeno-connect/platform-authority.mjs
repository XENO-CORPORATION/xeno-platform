/**
 * PlatformAuthority for XENO Connect (xeno-connect apps/service/src/auth.ts `PlatformAuthority`).
 *
 * Runs INSIDE the Connect deployment; Connect's oidcResolver has already verified the token's signature, audience,
 * type and DPoP proof before resolveVerifiedToken is called. This adapter never decides anything itself: it asks
 * xeno-platform (`/api/connect/authority`, services/connectAuthority.js) for the LIVE authority. A GRANTED answer is
 * reused for at most `cacheMs` (default 30 s) for the same token and workspace, and never past the token's expiry, so
 * suspension, membership and session changes apply within 30 s. A refusal is never cached. Without the reuse every
 * Google operation asked again: 109 requests a minute from one drive polling every 2 s (Storage session, 2026-10-27).
 * Dependency-free (global fetch and node:crypto, Node >= 18).
 *
 * Connect owns its link sessions, so the browser callback needs one thing only Connect can answer: who started the
 * link for this `state`. Pass it as `lookupLink(state) → { principalId, workspaceId, consumerId } | null`.
 */
import { createHash } from 'node:crypto';

const CACHE_MAX = 5000;

export function createPlatformAuthority({ platformOrigin, serviceToken, lookupLink, fetchImpl = globalThis.fetch, timeoutMs = 5000,
  cacheMs = 30_000, now = () => Date.now() }) {
  const origin = new URL(platformOrigin);
  if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
    throw new Error('platformOrigin must be https (loopback http allowed for local tests)');
  }
  if (!serviceToken) throw new Error('serviceToken required');
  if (typeof lookupLink !== 'function') throw new Error('lookupLink required');
  const granted = new Map(); // sha256(token)|workspace -> { answer, until }; the token itself is never kept

  async function ask(path, body) {
    const res = await fetchImpl(new URL(`/api/connect/authority/${path}`, origin), {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`platform authority refused (${res.status})`);
    return res.json();
  }

  function workspaceFrom(request) {
    const fromParams = request.params && request.params.workspaceId;
    const m = /^\/v1\/connect\/workspaces\/([^/?#]+)/.exec(String(request.url || ''));
    const id = fromParams || (m && decodeURIComponent(m[1]));
    if (!id) throw new Error('workspace required'); // no personal-workspace fallback
    return id;
  }

  return {
    async resolveVerifiedToken(claims, request) {
      const m = /^(?:DPoP|Bearer) ([A-Za-z0-9_.-]+)$/.exec(String(request.headers.authorization || ''));
      if (!m) throw new Error('token required');
      const workspaceId = workspaceFrom(request);
      const key = `${createHash('sha256').update(m[1]).digest('hex')}|${workspaceId}`;
      const t = now();
      const hit = granted.get(key);
      let a = hit && hit.until > t ? hit.answer : null;
      if (!a) {
        granted.delete(key);
        a = await ask('token', { token: m[1], workspaceId });
        const exp = Number(claims.exp) * 1000;
        const until = Math.min(t + cacheMs, Number.isFinite(exp) && exp > 0 ? exp : t + cacheMs);
        if (cacheMs > 0 && until > t) {
          if (granted.size >= CACHE_MAX) granted.delete(granted.keys().next().value); // oldest first
          granted.set(key, { answer: a, until });
        }
      }
      // Defence in depth, on every request, cached or not: the answer must be about the token Connect verified.
      if (a.principalId !== claims.sub || a.consumerId !== claims.client_id) throw new Error('authority mismatch');
      return a;
    },
    async resolveBrowserCallback(request, state) {
      const link = await lookupLink(state);
      if (!link) throw new Error('unknown link');
      return ask('callback', { principalId: link.principalId, workspaceId: link.workspaceId, consumerId: link.consumerId });
    },
  };
}
