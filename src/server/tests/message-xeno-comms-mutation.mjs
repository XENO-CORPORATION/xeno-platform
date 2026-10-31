/**
 * Mutation check for the Message scoping gates (services/xenoComms.js): each mutation REMOVES one protection, and
 * message-xeno-comms.test.mjs must FAIL against it. A gate that still passes with its protection gone proves nothing.
 *
 * Run: DATABASE_URL=postgresql://…/<a database whose name ends in a digit> node tests/message-xeno-comms-mutation.mjs
 * (each mutation runs the suite on a fresh database: <name>_m<n>, created and dropped here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'services', 'xenoComms.js');
const original = fs.readFileSync(target, 'utf8');
const MUTATIONS = [
  ['the channel audience check', "if (!a.members.some((m) => m.subject === String(ctx.me.id))) throw new MessageError('You are not a member of that channel', 'not_in_channel', 403);", ''],
  ['the workspace membership check', "if (!(await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${me.id}` })).allowed) throw new MessageError('You are not a member of that workspace', 'not_a_member', 403);", ''],
  ['the direct-message co-member check', "if (!(await viewerOf(db, `workspace:${ctx.workspaceId}`, userId))) throw new MessageError('That person is not in this workspace', 'not_a_member', 403);", ''],
  ['the assertion single-use ledger', "if (!spent.rows.length) return null;   // replayed", ''],
  ['team membership in the audience', "const members = (await db.query(`SELECT member_principal_id FROM workforce_team_memberships WHERE team_id = $1 AND state = 'active' AND member_principal_id IS NOT NULL`, [o.id])).rows.map((r) => String(r.member_principal_id));", "const members = (await db.query(`SELECT member_principal_id FROM workforce_team_memberships WHERE team_id = $1 AND member_principal_id IS NOT NULL`, [o.id])).rows.map((r) => String(r.member_principal_id));"],
];

const base = new URL(process.env.DATABASE_URL);
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let killed = 0;
try {
  for (const [i, [label, from, to]] of MUTATIONS.entries()) {
    if (!original.includes(from)) throw new Error(`mutation "${label}" no longer matches the source — update it`);
    const db = `${base.pathname.slice(1)}_m${i}`;
    await admin.query(`DROP DATABASE IF EXISTS ${db}`); await admin.query(`CREATE DATABASE ${db}`);
    fs.writeFileSync(target, original.replace(from, to));
    const url = new URL(base); url.pathname = '/' + db;
    const r = spawnSync(process.execPath, [path.join(here, 'message-xeno-comms.test.mjs')], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 240_000 });
    fs.writeFileSync(target, original);
    await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    if (r.status === 0) { console.log(`  SURVIVED  ${label}`); continue; }
    killed += 1; console.log(`  killed    ${label}`);
  }
} finally { fs.writeFileSync(target, original); await admin.end(); }
console.log(`\n${killed}/${MUTATIONS.length} mutations killed`);
if (killed !== MUTATIONS.length) process.exit(1);
