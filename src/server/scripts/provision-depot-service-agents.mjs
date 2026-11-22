#!/usr/bin/env node
/**
 * Provision the two service agents XENO Depot and XENO Runner act as (owner's yes, 2026-11-21T23:04:15Z, session
 * dbde4f58: "yes for XENO Depot and XENO Runner", typos corrected).
 *
 *   xeno-depot   a company agent of the workspace given with --workspace, its creator accountable. Depot's service
 *                identity for the proofs and every backup import. Credential: depot:read, depot:write, depot:admin.
 *                It administers the repos it creates (depotAuthority: a creating agent gets admin), so it is also the
 *                one that grants xeno-runner read on the pilot repo once that repo exists.
 *   xeno-runner  the owner's own agent. Credential: depot:read only, so CI can fetch code it is granted.
 *
 * Runs INSIDE the backend container (DATABASE_URL), through the same services the screens call
 * (platformAgents.create, depotAuthority.issueAgentCredential), so nothing here is a second path.
 *
 * ABSOLUTE RULE §2b: dry-run by default; --confirm to act; REFUSES when an agent of that name already exists for the
 * owner rather than replacing or adding a second one.
 *
 * 🔴 THE CREDENTIALS ARE NEVER PRINTED. Each goes to <out-dir>/<NAME> (mode 0600) as NAME=value, for the operator to
 * move into ~/.xeno-secrets and then delete. stdout carries only the hint (prefix), scopes and expiry.
 *
 *   node scripts/provision-depot-service-agents.mjs --owner <handle> --workspace <uuid>
 *   node scripts/provision-depot-service-agents.mjs --owner <handle> --workspace <uuid> --confirm --out-dir <dir>
 */
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import * as agents from '../services/platformAgents.js';
import { issueAgentCredential } from '../services/depotAuthority.js';
import { resolvePrincipal } from '../services/agentIdentity.js';

const SPECS = [
  { name: 'xeno-depot', company: true, scopes: ['depot:read', 'depot:write', 'depot:admin'], days: 365,
    secret: 'DEPOT_SERVICE_AGENT_CREDENTIAL',
    description: "XENO Depot's service agent: runs the proofs and every backup import into Depot." },
  { name: 'xeno-runner', company: false, scopes: ['depot:read'], days: 365,
    secret: 'XENO_RUNNER_DEPOT_XDP',
    description: 'XENO Runner: reads the Depot repos it is granted so CI can fetch their code.' },
];

const arg = (f) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const CONFIRM = process.argv.includes('--confirm');
const OWNER = arg('--owner'), WORKSPACE = arg('--workspace'), OUT = arg('--out-dir');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!OWNER || !UUID.test(String(WORKSPACE || ''))) { console.error('usage: --owner <handle> --workspace <uuid> [--confirm --out-dir <dir>]'); process.exit(2); }
if (CONFIRM && !OUT) { console.error('--confirm needs --out-dir: the credentials have to go somewhere that is not stdout'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const u = (await db.query('SELECT id FROM users WHERE username = $1', [OWNER])).rows[0];
  const p = u && await resolvePrincipal(db, u.id);
  if (!p || p.kind !== 'human' || !p.usable) throw new Error(`owner ${OWNER} is not a usable person`);
  const ws = (await db.query('SELECT id, name FROM workspaces WHERE id = $1', [WORKSPACE])).rows[0];
  if (!ws) throw new Error('workspace not found');
  const me = { id: String(u.id), kind: 'human' };

  // refuse, never replace: an agent with this display name already made by this owner
  for (const s of SPECS) {
    const hit = (await db.query(`SELECT a.public_id FROM agent_identities a JOIN users x ON x.id = a.user_id
      WHERE a.owner_user_id = $1 AND (x.display_name = $2 OR x.username LIKE $3)`, [u.id, s.name, `${s.name}%`])).rows[0];
    if (hit) throw new Error(`${s.name} already exists (${hit.public_id}); refusing to make a second one`);
  }
  console.log(`owner ${OWNER}, workspace "${ws.name}"`);
  for (const s of SPECS) console.log(`  ${s.name}: ${s.company ? 'company agent of the workspace' : 'the owner\'s own'}, credential ${s.scopes.join(' ')} for ${s.days} days -> ${s.secret}`);
  if (!CONFIRM) { console.log('dry run: nothing written (add --confirm --out-dir <dir>)'); process.exit(0); }

  mkdirSync(OUT, { recursive: true, mode: 0o700 });
  for (const s of SPECS) {
    const agent = await agents.create(db, me, { name: s.name, description: s.description, workspaceId: s.company ? WORKSPACE : null });
    const userId = (await db.query('SELECT user_id FROM agent_identities WHERE public_id = $1', [agent.id])).rows[0].user_id;
    const cred = await issueAgentCredential(db, me, { agentId: String(userId), scopes: s.scopes, label: `${s.name} service`, days: s.days });
    const file = join(OUT, s.secret);
    writeFileSync(file, `${s.secret}=${cred.token}\n`, { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* best effort */ }
    console.log(`made ${s.name}: agent ${agent.id}, user ${userId}, credential ${cred.hint} (${cred.scopes.join(' ')}) until ${new Date(cred.expiresAt).toISOString().slice(0, 10)}`);
  }
} catch (e) {
  console.error(`provision-depot-service-agents: ${e.message}`);
  process.exitCode = 1;
} finally { await db.end(); }
