/**
 * Checked-in first-party authority ceiling. A client can receive only scopes in
 * its own row; provider and gateway route policies further reduce authority.
 */
export const OIDC_SCOPES = Object.freeze([
  'openid', 'profile', 'email',
  'ledger', // bounded legacy compatibility; route policy prefers ledger:read/spend
  'inference:run', 'ledger:read', 'ledger:spend',
  'projects:read', 'projects:write', 'sync:use',
  'agent-identity:use', 'team:read', 'team:manage', 'collaboration:use',
  'billing:read', 'billing:manage', 'marketplace:payout', 'account:logout',
]);

const IDENTITY = ['openid', 'profile', 'email'];
const PRODUCT = [...IDENTITY, 'ledger', 'inference:run', 'ledger:read', 'ledger:spend', 'projects:read', 'projects:write', 'sync:use'];
const HUB = [...PRODUCT, 'agent-identity:use', 'team:read', 'team:manage', 'collaboration:use', 'billing:read', 'billing:manage', 'account:logout'];
const WEB = [...HUB, 'marketplace:payout'];

export const CLIENT_AUTHORITY = Object.freeze({
  'xeno-hub': HUB,
  'xeno-pixel': PRODUCT,
  'xeno-motion': PRODUCT,
  'xeno-sound': PRODUCT,
  'xeno-canvas': [...PRODUCT, 'collaboration:use'],
  'xeno-browser': PRODUCT,
  'xeno-rt': ['openid', 'profile', 'inference:run', 'ledger:read', 'ledger:spend'],
  'xeno-agent-cli': [...PRODUCT, 'agent-identity:use'],
  'xeno-web': WEB,
  'xeno-mail': IDENTITY,
  'xeno-mobile-ios': [...IDENTITY, 'projects:read', 'projects:write', 'sync:use', 'team:read', 'collaboration:use'],
  'xeno-mobile-android': [...IDENTITY, 'projects:read', 'projects:write', 'sync:use', 'team:read', 'collaboration:use'],
});

export function scopesForClient(clientId) {
  return CLIENT_AUTHORITY[clientId] ? [...CLIENT_AUTHORITY[clientId]] : null;
}

export function assertAuthorityPolicy() {
  const known = new Set(OIDC_SCOPES);
  for (const [clientId, scopes] of Object.entries(CLIENT_AUTHORITY)) {
    if (new Set(scopes).size !== scopes.length) throw new Error(`duplicate OIDC scope for ${clientId}`);
    for (const scope of scopes) {
      if (!known.has(scope)) throw new Error(`unknown OIDC scope ${scope} for ${clientId}`);
    }
    if (!scopes.includes('openid')) throw new Error(`first-party client ${clientId} lacks openid`);
  }
  return true;
}
