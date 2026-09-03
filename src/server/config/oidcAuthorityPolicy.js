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
  'broker:enroll', 'broker:exchange',
]);

const IDENTITY = ['openid', 'profile', 'email'];
const PRODUCT = [...IDENTITY, 'ledger', 'inference:run', 'ledger:read', 'ledger:spend', 'projects:read', 'projects:write', 'sync:use'];
const HUB = [...PRODUCT, 'agent-identity:use', 'team:read', 'team:manage', 'collaboration:use', 'billing:read', 'billing:manage', 'account:logout', 'broker:enroll', 'broker:exchange'];
const WEB = [...HUB, 'marketplace:payout'];
const COLLAB_PRODUCT = [...PRODUCT, 'team:read', 'collaboration:use'];
const AGENT_PRODUCT = [...PRODUCT, 'agent-identity:use'];

export const CLIENT_AUTHORITY = Object.freeze({
  'xeno-hub': HUB,
  'xeno-pixel': PRODUCT,
  'xeno-motion': PRODUCT,
  'xeno-sound': PRODUCT,
  'xeno-canvas': [...PRODUCT, 'collaboration:use'],
  'xeno-browser': PRODUCT,
  'xeno-docs': PRODUCT,
  'xeno-sheets': PRODUCT,
  'xeno-slides': PRODUCT,
  'xeno-notes': PRODUCT,
  'xeno-architect': PRODUCT,
  'xeno-form': PRODUCT, // renamed from xeno-3d 2026-09-03 (the modeler is XENO Form; xeno-3d is now the generator and has no OIDC client yet)
  'xeno-engine': PRODUCT,
  'xeno-workflow': PRODUCT,
  'xeno-comms': COLLAB_PRODUCT,
  'xeno-shell': AGENT_PRODUCT,
  'xeno-anima': AGENT_PRODUCT,
  'xeno-rt': ['openid', 'profile', 'inference:run', 'ledger:read', 'ledger:spend'],
  'xeno-agent-cli': AGENT_PRODUCT,
  'xeno-web': WEB,
  'xeno-post': [...COLLAB_PRODUCT, 'team:manage', 'billing:read'],
  'xeno-api-portal': [...IDENTITY, 'inference:run', 'ledger:read', 'ledger:spend', 'billing:read', 'billing:manage'],
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
