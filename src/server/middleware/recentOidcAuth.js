/** Existing OAuth step-up policy, shared without changing its acceptance window. */
export function recentOidcAuthAllowed(auth, { scope, clients }, now = Math.floor(Date.now() / 1000)) {
  const authTime = Number(auth?.authTime);
  const scopes = new Set(String(auth?.scope || '').split(/\s+/).filter(Boolean));
  return auth?.kind === 'oidc' && clients.includes(auth?.clientId) && scopes.has(scope)
    && Number.isFinite(authTime) && authTime <= now + 60 && now - authTime <= 5 * 60;
}
export function requireRecentOidcAuth(policy) {
  return (req, res, next) => {
    if (!recentOidcAuthAllowed(req.auth, policy)) {
      res.set('WWW-Authenticate', 'DPoP error="insufficient_user_authentication", max_age="300"');
      return res.status(401).json({ error: 'insufficient_user_authentication', max_age: 300 });
    }
    return next();
  };
}
