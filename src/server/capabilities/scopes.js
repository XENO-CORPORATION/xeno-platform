/**
 * The per-AREA scopes of the `xeno-workspace` token audience (XENO WORKSPACE AGENT SURFACE - SPEC.md §P2,
 * APPROVED by the owner 2026-10-20: "yes to all"). One-way names: they are written into issued tokens and into
 * every client's consent, so a name here is never renamed — only added beside.
 *
 * A scope names an AREA and a level. It never widens anything: what a call may do is
 *   scope ∩ the person's own rights ∩ the workspace grant (capability:<name>@<workspace>)
 * exactly as an agent's role is capped by its owner's.
 *
 * `forum:*` is not in the spec's list; it follows the same <area>:<level> pattern because the Forum folds into
 * /api/mcp (P1) and its tools need a scope. Canvas is an area of Tasks, studio media of the Library.
 */
export const WORKSPACE_SCOPES = Object.freeze([
  'storage:read', 'storage:write', 'share:create',
  'library:read', 'library:write',
  'tasks:read', 'tasks:write',
  'chat:read', 'chat:write',
  'agents:read', 'agents:write',
  'wallet:read', 'wallet:spend',
  'workspace:read', 'workspace:admin',
  'places:read', 'places:write',
  'marketplace:read', 'marketplace:write',
  'forum:read', 'forum:write',
  'publish:read', 'publish:write',
  'analytics:read', 'analytics:write',
  'docs:read', 'docs:write', 'scheduling:read', 'scheduling:write',   // Office › Write and Notes (2026-10-20). Writes are versions or trash: reversible.   // Corpo › Analytics (2026-10-20). Agents read; a person writes dashboards.   // XENO Publish = XENO Post (2026-10-20). Publishing itself is never a scope: a person confirms it on screen.
  'customers:read', 'customers:write',   // Corpo › Customers (2026-10-20). Agents read and draft; deletes and erasure are a person's.
  'automate:read', 'automate:write',   // Dev › Automate = XENO Workflow (2026-10-23). Agents draft; turning a workflow on is a person's.
  'message:read', 'message:write',   // Social › Message = XENO Comms (2026-10-23). Agents read and post in channels they belong to.
  'mail:read', 'mail:write',   // Office › Mail = XENO Mail (2026-10-23). Sending is never a scope: a person confirms it on screen.
  'compute:read', 'compute:write',   // XENO Compute (2026-10-26). Agents run machines billed to their owner; caps and prices are never a scope.
]);

/** Ledger classes (§4 reversibility). The catalogue's `undoable` is the ledger's `reversible`. */
export const LEDGER_CLASSES = Object.freeze(['safe', 'reversible', 'irreversible', 'external']);
export const ledgerClassOf = (catalogueClass) => (catalogueClass === 'undoable' ? 'reversible' : catalogueClass);

/** Which area a parity division's actions fall in. */
export const DIVISION_AREA = Object.freeze({
  storage: 'storage', studio: 'library', canvas: 'tasks', tasks: 'tasks', chat: 'chat', inference: 'chat',
  agents: 'agents', workforce: 'agents', commerce: 'wallet', workspace: 'workspace', 'workspace-ui': 'workspace',
  account: 'workspace', platform: 'workspace', places: 'places', forum: 'forum', 'browser-shell': 'workspace',
  marketplace: 'marketplace', publish: 'publish', message: 'message', analytics: 'analytics', docs: 'docs', scheduling: 'scheduling', support: 'forum', customers: 'customers', mail: 'mail', automate: 'automate', releases: 'workspace', compute: 'compute',
  // XENO-WORKFORCE-01 capability divisions (catalogue first segments)
  agent: 'agents', run: 'agents', objective: 'agents', division: 'workspace', funding: 'wallet',
  orchestrator: 'tasks', audit: 'workspace',
});

/** The scope an action of `area` needs at `cls`. Reads need :read; a wallet write spends; a workspace write is admin. */
export function scopeFor(area, cls) {
  const write = cls !== 'safe';
  if (area === 'wallet') return write ? 'wallet:spend' : 'wallet:read';
  if (area === 'workspace') return write ? 'workspace:admin' : 'workspace:read';
  return `${area}:${write ? 'write' : 'read'}`;
}

/** Does a granted scope set satisfy `need`? */
export const hasScope = (granted, need) => [].concat(granted || []).includes(need);
