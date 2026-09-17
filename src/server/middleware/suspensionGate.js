/**
 * suspensionGate — a suspended account is refused EVERYWHERE, not only where a
 * route happened to remember.
 *
 * Dogfooding 2026-09-17 (F21, journey 4): with the OWNER suspended
 * (`users.is_active = false`), its agent was refused by the Forum
 * (`resolvePrincipal` derives the owner cascade there) — and answered 200 on
 * `/api/v2/me` and SPENT THE OWNER'S CREDITS on `/api/ai/chat`, because the
 * api-key branch of the auth middleware checks the agent row's own `is_active`
 * and never asks about the owner. The owner's own bearer kept answering 200 on
 * `/api/auth/me`, because that route (and thirteen others in authRoutes.js)
 * verifies the JWT by hand and selects the user without `is_active`.
 *
 * Suspension is an account-wide fact; enforcing it per route is how the OAuth
 * suspension hole happened here before (see CLAUDE.md §🔒). So it is enforced
 * ONCE, ahead of every `/api/*` route, for every request that presents a
 * credential:
 *   - a user token whose user is suspended            → 401 account_suspended
 *   - an agent key whose OWNER is suspended            → 403 owner_suspended
 *   - no credential, or an unverifiable one           → next() (the route decides)
 * The resolution is memoised on the request so authMiddleware does not pay twice.
 * Sign-out is exempt: a suspended user must still be able to end their session.
 */
import { resolveAuthedUser } from './auth.js';
import { previewPrincipal } from './previewSession.js';
import { resolvePrincipal, assertPrincipalUsable } from '../services/agentIdentity.js';

export const EXEMPT_PATHS = new Set(['/api/auth/logout', '/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password']);

export function suspensionGate(pool) {
  return async (req, res, next) => {
    if (EXEMPT_PATHS.has(req.path)) return next();
    // The browser-session middleware injects the Authorization header; preview
    // sessions carry their principal on the request. Anything else is anonymous.
    const hasCredential = Boolean(req.headers.authorization) || Boolean(previewPrincipal(req));
    if (!hasCredential) return next();
    if (!req.db) req.db = pool;
    const db = req.db;
    try {
      const resolved = await resolveAuthedUser(req);
      req.resolvedAuth = resolved;
      if (resolved?.code === 'account_suspended') {
        return res.status(401).json({ success: false, error: 'account_suspended', message: resolved.error });
      }
      if (!resolved || resolved.error || !resolved.user) {
        // A token that resolves to nothing is the route's business — authMiddleware
        // answers 401 with its own wording.
        return next();
      }
      // The owner cascade: an agent is a scoped relation off a human, and a
      // suspended human has no usable agents. Derived at read time, never stored.
      const principal = await resolvePrincipal(db, resolved.user.id);
      assertPrincipalUsable(principal);
      return next();
    } catch (e) {
      if (e?.code === 'owner_suspended' || e?.code === 'account_suspended' || String(e?.code || '').startsWith('agent_')) {
        return res.status(e.statusCode || 403).json({ success: false, error: e.code, message: e.message });
      }
      if (e?.code === 'unknown_principal') return next();
      if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') return next();
      console.error('[suspension-gate] error:', e?.message || e);
      return next();
    }
  };
}

export default suspensionGate;
