import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { requireDpopIfBound } from './dpopResource.js';

export function workspaceRequiredScope(req) {
  if (/^\/[^/]+\/api-keys(?:\/|$)/i.test(req.path)) return 'team:manage';
  const read = req.method === 'GET' || req.method === 'HEAD';
  if (/^\/[^/]+\/(?:billing(?:\/|$)|budget(?:\/|$))/i.test(req.path)) {
    return read ? 'billing:read' : 'billing:manage';
  }
  // Selecting a workspace changes only the caller's active view, not membership.
  if (req.method === 'POST' && /^\/[^/]+\/select\/?$/i.test(req.path)) return 'team:read';
  return read ? 'team:read' : 'team:manage';
}

/** OAuth scopes narrow server-side ReBAC; they never replace it. Mounted inside
 * both workspace routers, behind authMiddleware. Browser legacy/API-key sessions
 * already verified by that middleware retain their pre-existing route semantics.
 * No renderer role, cookie string, or header can set req.user/req.auth.
 */
export function requireWorkspaceAuthority(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.auth?.kind !== 'oidc') return next();
  return requireDpopIfBound(req, res, () => {
    const required = workspaceRequiredScope(req);
    const granted = new Set(String(req.auth.scope || '').split(/\s+/).filter(Boolean));
    const ceiling = scopesForClient(req.auth.clientId);
    if (!granted.has(required) || !ceiling?.includes(required)) {
      res.set('WWW-Authenticate', `DPoP error="insufficient_scope", scope="${required}"`);
      return res.status(403).json({ success: false, error: 'insufficient_scope', required_scope: required });
    }
    return next();
  });
}
