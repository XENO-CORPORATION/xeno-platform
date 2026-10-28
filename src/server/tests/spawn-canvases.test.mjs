/**
 * Spawn cloud canvases (services/spawnCanvases.js) and their XENO Multiplayer tickets, against a real Postgres.
 *
 *   - a workspace editor creates a canvas (idempotent on its id, bound to a machine in that workspace); a viewer cannot;
 *     an id already used in another workspace is refused
 *   - roles: workspace admin → owner, editor → editor, viewer → viewer; an outsider invited to ONE canvas gets that
 *     role on it and nothing else; an agent is never above editor
 *   - only the owner, in person, invites or removes; removing an invite closes live connections only when no access is
 *     left; a ticket for spawn.canvas/<canvasId> carries the canvas role; a machine id still works (until rc.91)
 *   - a service ticket for the machine's Spawn server is kind service, sub = the machine, on that canvas only
 *
 *   node src/server/tests/spawn-canvases.test.mjs   (DATABASE_URL = a disposable database)
 */
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as compute from '../services/compute.js';
import { setComputeBackend } from '../services/computeBackend.js';
import * as canvases from '../services/spawnCanvases.js';
import * as live from '../services/liveTickets.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `cnv${Date.now().toString(36)}`;
const claims = (t) => jwt.decode(t);

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  setComputeBackend({ name: 'fake', create: async () => ({ ref: 'f' }) });
  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), outsider = await user('outsider'), other = await user('other'), agentU = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  const ws2 = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Other',$2) RETURNING id`, [other, `${tag}-b`])).rows[0].id;
  await writeTuples(pool, { writes: [
    ...[['owner', owner], ['admin', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })),
    { object: `workspace:${ws2}`, subject: `user:${other}`, relation: 'owner' }, { object: `workspace:${ws2}`, subject: `user:${other}`, relation: 'admin' }] });
  const H = (id, name) => ({ id, kind: 'human', display_name: name });
  const m = await compute.createMachine(pool, H(editor), { workspace: ws, name: 'Canvas box', size: 'small' });
  const cid = crypto.randomUUID();

  // create
  check(await code(() => canvases.createCanvas(pool, H(viewer), { id: cid, name: 'x', machineId: m.id })) === 'editor_required', 'a workspace viewer cannot create a canvas');
  const c = await canvases.createCanvas(pool, H(editor), { id: cid, name: 'Launch plan', machineId: m.id });
  check(c.id === cid && c.workspaceId === String(ws) && c.machineId === m.id && c.role === 'editor' && c.url === `/workspace/${ws}/spawn/projects/${cid}`, 'an editor creates a canvas bound to the machine, addressed by id');
  check((await canvases.createCanvas(pool, H(editor), { id: cid, name: 'again', machineId: m.id })).name === 'Launch plan', 'creating it again answers the same canvas (idempotent)');
  check(await code(() => canvases.createCanvas(pool, H(other), { id: cid, name: 'steal', workspace: ws2 })) === 'canvas_conflict', 'the same id from another workspace is refused');
  check(await code(() => canvases.createCanvas(pool, H(editor), { id: 'not-a-uuid', name: 'x' })) === 'invalid_canvas', 'a canvas id must be a UUID');

  // roles
  check((await canvases.getCanvas(pool, H(owner), cid)).role === 'owner', 'a workspace admin is the canvas owner');
  check((await canvases.getCanvas(pool, H(viewer), cid)).role === 'viewer', 'a workspace viewer is a canvas viewer');
  check(await code(() => canvases.getCanvas(pool, H(outsider), cid)) === 'not_a_member', 'an outsider sees nothing');
  check((await canvases.getCanvas(pool, { id: agentU, kind: 'agent' }, cid)).role === 'editor', 'an agent of the owner is an editor, never the owner');

  // invites
  check(await code(() => canvases.invite(pool, H(editor), cid, { userId: outsider, role: 'viewer' })) === 'owner_required', 'an editor cannot invite');
  check(await code(() => canvases.invite(pool, { id: agentU, kind: 'agent' }, cid, { userId: outsider, role: 'viewer' })) === 'owner_required', 'an agent cannot invite');
  check(await code(() => canvases.invite(pool, H(owner), cid, { userId: agentU, role: 'viewer' })) === 'user_not_found', 'an agent cannot be invited (people only)');
  await canvases.invite(pool, H(owner), cid, { userId: outsider, role: 'viewer' });
  check((await canvases.getCanvas(pool, H(outsider), cid)).role === 'viewer', 'an invited outsider gets the canvas as viewer');
  await canvases.invite(pool, H(owner), cid, { userId: outsider, role: 'editor' });
  check((await canvases.getCanvas(pool, H(outsider), cid)).role === 'editor' && (await canvases.listInvites(pool, H(owner), cid)).filter((x) => x.userId === String(outsider)).length === 1, 'changing the invite replaces it (one role per person)');
  const cid2 = crypto.randomUUID();
  await canvases.createCanvas(pool, H(editor), { id: cid2, name: 'Other canvas', machineId: m.id });
  check(await code(() => canvases.getCanvas(pool, H(outsider), cid2)) === 'not_a_member', 'the invite is for that canvas alone, not the workspace');
  check(await code(() => compute.getMachine(pool, H(outsider), m.id)) === 'not_a_member', 'and does not open the machine itself');

  // tickets through the record
  const tk = claims((await live.createTicket(pool, H(outsider, 'outsider'), `spawn.canvas/${cid}`)).ticket);
  check(tk.xeno_role === 'editor' && tk.xeno_resource === `spawn.canvas/${cid}` && tk.sub === String(outsider), 'a ticket for spawn.canvas/<canvasId> carries the canvas role');
  check(claims((await live.createTicket(pool, H(viewer), `spawn.canvas/${m.id}`)).ticket).xeno_role === 'viewer', 'a machine id is still accepted until Spawn rc.91');
  const svc = claims(await live.createServiceTicket(pool, m.id, `spawn.canvas/${cid}`));
  check(svc.kind === 'service' && svc.sub === m.id && svc.xeno_role === 'editor' && svc.xeno_resource === `spawn.canvas/${cid}` && svc.exp - svc.iat <= 120, 'a service ticket for the machine’s Spawn server: kind service, sub = the machine, that canvas only');
  check((await canvases.canvasesOnMachine(pool, m.id)).sort().join() === [cid, cid2].sort().join(), 'the machine’s canvases are the ones bound to it');

  // removing an invite
  const calls = [];
  const fakeRevoke = async (_db, resource, sub) => { calls.push([resource, sub]); return { ok: true, status: 200 }; };
  const out = await canvases.uninvite(pool, H(owner), cid, outsider, { revoke: fakeRevoke });
  check(out.removed === 1 && calls.length === 1 && calls[0][0] === `spawn.canvas/${cid}` && calls[0][1] === String(outsider), 'removing an invite revokes that person’s live connections');
  check(await code(() => canvases.getCanvas(pool, H(outsider), cid)) === 'not_a_member', 'and the canvas is closed to them');
  await canvases.invite(pool, H(owner), cid, { userId: viewer, role: 'editor' });
  calls.length = 0;
  await canvases.uninvite(pool, H(owner), cid, viewer, { revoke: fakeRevoke });
  check(calls.length === 0 && (await canvases.getCanvas(pool, H(viewer), cid)).role === 'viewer', 'a workspace member keeps the canvas through the workspace, so nothing is revoked');

  console.log(`\nspawn-canvases: ${passed} checks passed`);
}

main().then(() => pool.end(), (e) => { console.error(e); process.exit(1); });
