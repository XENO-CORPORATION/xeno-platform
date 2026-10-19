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
  'workforce:read', 'workforce:manage',
  'billing:read', 'billing:manage', 'marketplace:payout', 'account:logout',
  'broker:enroll', 'broker:exchange',
  // XENO Tasks over MCP: the only scopes a self-registered (RFC 7591) client can ever hold
  'tasks:read', 'tasks:write',
  // XENO Extension: let platform chats use THIS browser (register an installation, hold the relay connection).
  // Separate from inference on purpose: driving a browser is a different authority from spending credits.
  'browser:connect',
]);

const IDENTITY = ['openid', 'profile', 'email'];
const PRODUCT = [...IDENTITY, 'ledger', 'inference:run', 'ledger:read', 'ledger:spend', 'projects:read', 'projects:write', 'sync:use'];
// A ceiling permits consent to be REQUESTED; it never expands an existing token.
// Workforce configuration authorizes neither billing, principal minting nor execution --
// those stay on their own scopes, so a workforce grant cannot become a spend grant.
const WORKFORCE = ['workforce:read', 'workforce:manage'];
const HUB = [...PRODUCT, ...WORKFORCE, 'agent-identity:use', 'team:read', 'team:manage', 'collaboration:use', 'billing:read', 'billing:manage', 'account:logout', 'broker:enroll', 'broker:exchange'];
const WEB = [...HUB, 'marketplace:payout'];
const COLLAB_PRODUCT = [...PRODUCT, 'team:read', 'collaboration:use'];
const AGENT_PRODUCT = [...PRODUCT, ...WORKFORCE, 'agent-identity:use'];

export const CLIENT_AUTHORITY = Object.freeze({
  'xeno-hub': HUB,
  'xeno-pixel': PRODUCT,
  'xeno-motion': PRODUCT,
  'xeno-sound': PRODUCT,
  'xeno-canvas': [...PRODUCT, 'collaboration:use'],
  'xeno-browser': PRODUCT,
  // XENO Extension (MV3, RFC 8628 device grant + DPoP): its own metered model loop, plus browser:connect so a
  // platform chat can use this browser (CHAT-TOOL-CALLING-PLAN.md, "Browser tools"). No projects, team or billing.
  'xeno-extension': [...IDENTITY, 'inference:run', 'ledger:read', 'ledger:spend', 'browser:connect'],
  // XENO Storage desktop: the product set (its files go through /api/library, which ReBAC decides) plus team:read,
  // so it can list the person's team workspaces and show their team folders. No team:manage: membership is managed
  // on the web, never from a sync client.
  'xeno-storage': [...PRODUCT, 'team:read'],
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
  // Standalone Agent is a public loopback PKCE client. Keep its authority identical
  // to the existing agent surfaces; unsupported requested scopes are downscoped by
  // the provider, never added to the policy by guesswork.
  'xeno-agent-interface': [...AGENT_PRODUCT, 'collaboration:use'],
  'xeno-rt': ['openid', 'profile', 'inference:run', 'ledger:read', 'ledger:spend'],
  'xeno-agent-cli': AGENT_PRODUCT,
  // XENO Spawn: identity, read the credits balance, and run inference through the XENO
  // gateway on the user's behalf (which spends credits). Nothing more: no projects/sync,
  // no workforce, no billing, team or broker authority. Widen by a reviewed change only.
  'xeno-spawn': [...IDENTITY, 'inference:run', 'ledger:read', 'ledger:spend'],
  // XENO Workshop: identity, the credits balance, and gateway inference — an agent turn a person
  // starts in the workshop runs on, and bills, that person's own account (surface-account seam).
  'xeno-workshop': [...IDENTITY, 'inference:run', 'ledger:read', 'ledger:spend'],
  'xeno-workshop-local': [...IDENTITY, 'inference:run', 'ledger:read', 'ledger:spend'],
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

// ── XENO Connect (audience `xeno-connect`) ──────────────────────────────────
// Connect is a separate resource server (xeno-connect/docs/STORAGE-HANDOFF.md §1). A client reaches it ONLY by
// RFC 8693-exchanging its own DPoP-bound `xeno-api` token for a short `xeno-connect` token bound to the same key.
// These scopes are therefore NOT OIDC scopes and never appear in an authorize request or a `xeno-api` token: the
// two ceilings are kept apart so neither audience can carry the other's authority.
export const CONNECT_SCOPES = Object.freeze(['connect:read', 'connect:use', 'connect:manage']);
// connect:manage (link/revoke/grant) is honoured for HUMAN principals only; an agent asking for it is refused.
export const CONNECT_HUMAN_ONLY_SCOPES = Object.freeze(['connect:manage']);
const DRIVE_READ = ['drive.files.list', 'drive.files.stat', 'drive.files.read', 'drive.quota.read', 'drive.changes.read', 'drive.drives.list'];
const DRIVE_WRITE = ['drive.files.create', 'drive.files.rename', 'drive.files.move', 'drive.files.trash', 'drive.files.restore',
  'drive.uploads.start', 'drive.uploads.status', 'drive.uploads.write', 'drive.uploads.finish', 'drive.uploads.cancel'];
// Overwriting an existing file's content in place. A separate grant from upload, so an upload ceiling never implies
// overwrite. Added 2026-10-19 once Connect (ca099bd) qualified it with an md5/version precondition; Storage needs it
// to save edits made on a mounted Google Drive.
const DRIVE_REPLACE = ['drive.files.replace'];
// The client ceiling: which Connect scopes and provider operations a consumer may ever hold.
export const CONNECT_CLIENT_AUTHORITY = Object.freeze({
  'xeno-storage': Object.freeze({ scopes: CONNECT_SCOPES, operations: Object.freeze([...DRIVE_READ, ...DRIVE_WRITE, ...DRIVE_REPLACE]) }),
  // The WEBSITE's Storage (services/webConnect.js). Not an OIDC client: no browser ever holds its token. It is minted
  // in-process for a live website session and is NEVER reachable by RFC 8693 exchange (connectExchangeGrant refuses it).
  'xeno-web-storage': Object.freeze({ scopes: CONNECT_SCOPES, operations: Object.freeze([...DRIVE_READ, ...DRIVE_WRITE, ...DRIVE_REPLACE]) }),
});
/** The website's first-party Connect consumer: minted server-side only, bound to a website session. */
export const CONNECT_WEB_CONSUMER = 'xeno-web-storage';

export function connectAuthorityForClient(clientId) {
  const c = CONNECT_CLIENT_AUTHORITY[clientId];
  return c ? { scopes: [...c.scopes], operations: [...c.operations] } : null;
}
