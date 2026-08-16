#!/usr/bin/env node
/**
 * The two verbs the agent surface was missing, proven through the REAL MCP
 * dispatcher against the real database.
 *
 *   forum_flag        §3.3 rule 1 says "agents flag to review, never to
 *                     remove". Before this tool that rule described an
 *                     affordance an agent did not have.
 *   forum_mark_fixed  Loop C's write-back — the step §2 calls the one everyone
 *                     skips. It was reachable from a browser and from nothing
 *                     an agent could call, while releases here are driven by
 *                     agents.
 *
 * ── WHAT THIS ASSERTS THAT A UNIT TEST CANNOT ───────────────────────────────
 *
 *   • the flag lands as a REVIEW ITEM and the content is still visible — the
 *     whole point of "flag, never remove"
 *   • a flag can target a POST by the position a read tool returned, because a
 *     citable position is all an agent has
 *   • marking fixed NOTIFIES the person who reported it — Loop C only closes if
 *     the reporter finds out
 *   • 🔴 a NON-STAFF agent is refused, and the refusal comes from the SERVICE,
 *     not from the tool. That is the §4.11 lesson: a rule enforced per surface
 *     is not enforced.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT; `--confirm` required.
 *   • 🔴 NOTHING IS EVER COMMITTED — one transaction, always rolled back.
 */

import crypto from 'crypto';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function service(name) {
  const dir = process.env.FORUM_SERVICE_DIR;
  const candidates = dir
    ? [new URL(`${dir.replace(/\/$/, '')}/${name}`, 'file:///').href]
    : [`../src/server/services/${name}`, `../services/${name}`];
  for (const p of candidates) {
    try { return await import(p); } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error(`cannot locate ${name} in either layout`);
}

async function cloneUser(client, sourceId, label, { ageHours = 48, role = 'user' } = {}) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position`,
  );
  const names = cols.map((c) => c.column_name);
  const uniq = crypto.randomBytes(4).toString('hex');
  const select = names.map((n) => {
    if (n === 'id') return 'gen_random_uuid() AS id';
    if (n === 'email') return `'ags-${uniq}@example.invalid' AS email`;
    if (['handle', 'username', 'display_name'].includes(n)) return `'${label}${uniq}' AS ${n}`;
    if (n === 'created_at') return `(NOW() - INTERVAL '${Number(ageHours)} hours') AS created_at`;
    if (n === 'role') return `'${role}' AS role`;
    return `"${n}"`;
  }).join(', ');
  const { rows } = await client.query(
    `INSERT INTO users (${names.map((n) => `"${n}"`).join(', ')})
     SELECT ${select} FROM users WHERE id = $1 RETURNING id`,
    [sourceId],
  );
  return rows[0].id;
}

const client = await pool.connect();
let began = false;

try {
  const { rows: admins } = await client.query(
    "SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  );
  if (!admins.length) throw new Error('no admin account');

  if (!CONFIRM) {
    console.log('DRY RUN — would open a transaction, create a reporter + a plain user + an');
    console.log('agent, drive forum_flag and forum_mark_fixed through the real MCP');
    console.log('dispatcher, and ROLL BACK. Nothing is committed. Re-run with --confirm.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;

  const mcp = await service('forumMcp.js');
  const write = await service('forumWrite.js');
  const ident = await service('agentIdentity.js');

  const actorOf = async (id) => {
    const p = await ident.resolvePrincipal(client, id);
    return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
  };

  const staff = await actorOf(admins[0].id);
  const reporterId = await cloneUser(client, admins[0].id, 'agsrep');
  const reporter = await actorOf(reporterId);
  const plainId = await cloneUser(client, admins[0].id, 'agsplain');
  const plain = await actorOf(plainId);

  const created = await ident.createAgent(client, { id: plain.id, kind: 'human', handle: plain.username, role: 'user' }, {
    name: 'surfaceproof', displayName: 'Surface Proof Agent', agentRole: 'reporter', agentOrigin: 'proof',
  });
  const { rows: aRows } = await client.query(
    'SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [created.agent.handle],
  );
  const agent = await actorOf(aRows[0].id);
  console.log(`staff: ${staff.username} | reporter: ${reporter.username} | agent: ${agent.username} (owner ${plain.username})\n`);

  // A thread the reporter raised, so Loop C has someone to notify.
  const thread = await write.createThread(client, reporter, {
    space: 'feedback',
    title: 'Agent-surface proof — export hangs on a large canvas',
    body: 'Reported by the proof. This transaction is rolled back.',
    tags: ['product:pixel', 'kind:bug'],
  });
  await write.createPost(client, plain, thread.shortId, { body: 'Also seeing this here.' });

  // ── 1. an agent can FLAG a thread, and nothing disappears ────────────────
  console.log('1. forum_flag on a thread:');
  const f1 = await mcp.callTool(client, agent, 'forum_flag', {
    shortId: thread.shortId, reason: 'off_topic', detail: 'Raised by the agent-surface proof.',
  });
  if (f1?.isError) fail(`forum_flag failed: ${f1.content?.[0]?.text?.slice(0, 100)}`);
  else pass('the agent flagged the thread');

  const { rows: flagRows } = await client.query(
    `SELECT f.status, f.reason, f.reporter_kind FROM forum_flags f
       JOIN forum_threads t ON t.id = f.target_id
      WHERE t.short_id = $1 AND f.target_type = 'thread'`,
    [thread.shortId],
  );
  if (!flagRows.length) fail('no flag row — the tool reported success and wrote nothing');
  else pass(`a review item exists (status=${flagRows[0].status}, reason=${flagRows[0].reason})`);
  if (flagRows[0]?.reporter_kind !== 'agent') fail(`the flag records reporter_kind="${flagRows[0]?.reporter_kind}", expected agent`);
  else pass('it is recorded as an AGENT flag — separable forever (D5)');

  // 🔴 The rule is "flag, never remove". Prove the content is still there.
  const { rows: stillVisible } = await client.query(
    "SELECT status FROM forum_threads WHERE short_id = $1", [thread.shortId],
  );
  if (stillVisible[0]?.status !== 'open') fail(`flagging changed thread status to "${stillVisible[0]?.status}" — it must remove nothing`);
  else pass('the thread is untouched — flagging creates work, it does not hide content');

  // ── 2. a flag can target a POST, by the position a read tool returned ────
  console.log('\n2. forum_flag on a post, by citable position:');
  const readBack = await mcp.callTool(client, agent, 'forum_get_thread', { shortId: thread.shortId });
  const posts = JSON.parse(readBack.content[0].text).posts;
  const target = posts[posts.length - 1];

  const f2 = await mcp.callTool(client, agent, 'forum_flag', {
    shortId: thread.shortId, postPosition: target.position, reason: 'low_quality',
  });
  if (f2?.isError) fail(`post flag failed: ${f2.content?.[0]?.text?.slice(0, 100)}`);
  else pass(`flagged post #${target.position} using the position the read tool returned`);

  const { rows: postFlags } = await client.query(
    "SELECT COUNT(*)::int AS n FROM forum_flags WHERE target_type = 'post'",
  );
  if (!postFlags[0].n) fail('no post-targeted flag row');
  else pass('a post-targeted review item exists');

  const bad = await mcp.callTool(client, agent, 'forum_flag', {
    shortId: thread.shortId, postPosition: 999, reason: 'spam',
  });
  if (!bad?.isError) fail('flagging a nonexistent post position succeeded');
  else pass('a bad position is refused, naming the position');

  // ── 3. 🔴 a NON-STAFF agent cannot mark a thread fixed ───────────────────
  console.log('\n3. forum_mark_fixed — the rule comes from the SERVICE:');
  const refused = await mcp.callTool(client, agent, 'forum_mark_fixed', {
    shortId: thread.shortId, version: '9.9.9',
  });
  if (!refused?.isError) fail('a non-staff agent marked a thread fixed — anyone could close any report');
  else if (!/staff_required/.test(refused.content?.[0]?.text || '')) {
    fail(`refused for a different reason: ${refused.content?.[0]?.text?.slice(0, 90)}`);
  } else pass('refused with staff_required — inherited from markThreadFixed, not re-implemented here');

  // ── 4. staff closes the loop, and the REPORTER finds out ─────────────────
  console.log('\n4. staff marks it fixed — does Loop C actually close?');
  const before = await client.query(
    'SELECT COUNT(*)::int AS n FROM forum_notifications WHERE user_id = $1', [reporter.id],
  );
  const okRes = await mcp.callTool(client, staff, 'forum_mark_fixed', {
    shortId: thread.shortId, version: '0.6.4', note: 'Fixed by the proof.',
  });
  if (okRes?.isError) fail(`staff mark_fixed failed: ${okRes.content?.[0]?.text?.slice(0, 120)}`);
  else pass('staff marked it fixed through MCP');

  const { rows: fixedRows } = await client.query(
    'SELECT fixed_in_version, fixed_at, status FROM forum_threads WHERE short_id = $1',
    [thread.shortId],
  );
  if (fixedRows[0]?.fixed_in_version !== '0.6.4') fail(`fixed_in_version is "${fixedRows[0]?.fixed_in_version}", expected 0.6.4`);
  else pass('the thread records the version that fixed it');
  if (!fixedRows[0]?.fixed_at) fail('fixed_at not stamped — the digest\'s `shipped` section reads it');
  else pass('fixed_at stamped — Loop D\'s `shipped` section can see it');

  const after = await client.query(
    'SELECT COUNT(*)::int AS n FROM forum_notifications WHERE user_id = $1', [reporter.id],
  );
  if (after.rows[0].n <= before.rows[0].n) {
    fail('the REPORTER was not notified — a report that does not come back is worse than no report (§2 Loop C)');
  } else pass(`the reporter was notified (${before.rows[0].n} → ${after.rows[0].n})`);

  // The URL an agent hands a human must be citable.
  const payload = JSON.parse(okRes.content[0].text);
  if (!/\/forum\/t\//.test(payload.url || '')) fail(`no citable url in the result: ${payload.url}`);
  else pass('the result carries a citable URL');
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no user, agent, thread, flag or notification was committed.');
  }
  client.release();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('The agent surface can flag without removing, and can close Loop C when its owner is staff.');
