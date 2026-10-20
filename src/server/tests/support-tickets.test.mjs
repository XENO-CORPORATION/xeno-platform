/**
 * XENO support (services/supportTickets.js, supportMcp.js), against a real Postgres.
 *
 *   - a request is private: the requester, XENO staff and its delegate agent read it; anyone else gets "not found"
 *   - the requester never sees internal notes, internal files or unsent agent drafts — filtered on the server
 *   - an agent's reply is a DRAFT; only a human on staff sends it, and the database refuses an unratified send
 *   - an agent is never staff, whatever its role column says
 *   - statuses move only along the allowed edges; the requester may only close or reopen a resolved request
 *   - SLA targets follow priority; replies, status changes, merges and the linked task's fix reach the requester
 *   - engineering work is a XENO Tasks task, and finishing it writes the fix back to the request
 *   - making it public is the requester's alone: a Forum Help thread
 *   - rate limits refuse a burst
 *
 *   node src/server/tests/support-tickets.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { seedForum } from '../database/seeds/forum-seed.js';
import * as support from '../services/supportTickets.js';
import * as supportMcp from '../services/supportMcp.js';
import * as tasks from '../services/xenoTasks.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };

async function main() {
  await runAllMigrations(pool);
  await seedForum(pool).catch(() => {});
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const id = { ada: await mk('sp-ada'), bob: await mk('sp-bob'), mod: await mk('sp-mod', 'moderator'), bot: await mk('sp-bot', 'admin'), adaBot: await mk('sp-adabot') };
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.bot, id.mod]);
  await pool.query("INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1,$2,'other','manual','active')", [id.adaBot, id.ada]);
  const ada = { id: id.ada, kind: 'human', role: 'user' }, bob = { id: id.bob, kind: 'human', role: 'user' };
  const staff = { id: id.mod, kind: 'human', role: 'moderator', username: 'mod' };
  const bot = { id: id.bot, kind: 'agent', role: 'admin' };     // an agent whose role column says admin: still not staff
  const adaBot = { id: id.adaBot, kind: 'agent', role: 'user' }; // Ada's own agent, asking for her
  const service = { id: id.bob, kind: 'service', role: 'user' };

  // raise
  const t = await support.createTicket(pool, ada, { kind: 'billing', title: 'Charged twice', body: 'My card shows two charges.' });
  check(/^T-\d+$/.test(t.key) && t.status === 'new' && t.kind === 'billing' && t.you === 'requester', 'a request is raised, private, keyed T-n, with the requester as its owner');
  check(t.sla.firstResponseDueAt && t.sla.resolutionDueAt && !t.sla.firstResponseBreached, 'it carries SLA targets');
  check(await code(() => support.createTicket(pool, ada, { kind: 'rant', title: 'x' })) === 'invalid_kind', 'an unknown kind is refused');
  check(await code(() => support.createTicket(pool, service, { title: 'x' })) === 'service_cannot_ask', 'a service account cannot ask');
  check(await code(() => support.createTicket(pool, ada, { title: '' })) === 'title_required', 'a request needs a title');

  // readers
  check((await support.getTicket(pool, staff, t.key)).you === 'staff', 'XENO staff read it');
  check(await code(() => support.getTicket(pool, bob, t.key)) === 'ticket_not_found', 'another person is told it does not exist');
  check(await code(() => support.getTicket(pool, bot, t.key)) === 'ticket_not_found', 'an agent with an admin role column is NOT staff, and cannot read it undelegated');
  check((await support.getTicket(pool, adaBot, t.key)).you === 'requester', 'Ada’s own agent reads her request, as her');
  check(await code(() => support.listQueue(pool, bob)) === 'not_allowed', 'a person cannot see the queue');
  check((await support.listQueue(pool, staff, { status: 'open' })).some((x) => x.key === t.key), 'staff see it in the open queue');
  check((await support.listQueue(pool, bot)).length === 0, 'an agent’s queue holds only what is delegated to it');
  check((await support.listMine(pool, bob)).length === 0 && (await support.listMine(pool, ada)).some((x) => x.key === t.key), 'each person lists only their own');

  // assign + delegate
  check(await code(() => support.assign(pool, ada, t.key, { assigneeId: id.mod })) === 'not_allowed', 'the requester cannot assign');
  check(await code(() => support.assign(pool, staff, t.key, { assigneeId: id.bob })) === 'assignee_not_staff', 'a request is assigned only to staff');
  check(await code(() => support.assign(pool, staff, t.key, { assigneeId: id.bot })) === 'assignee_not_staff', 'an agent cannot be the assignee, even with an admin role');
  check(await code(() => support.assign(pool, staff, t.key, { delegateAgentId: id.bob })) === 'delegate_not_agent', 'only an agent is a delegate');
  await support.assign(pool, staff, t.key, { assigneeId: id.mod, delegateAgentId: id.bot });
  check((await support.getTicket(pool, bot, t.key)).you === 'agent', 'the delegate agent now reads it');

  // agent triage + draft
  const tr = await support.triage(pool, bot, t.key, { priority: 'urgent' });
  check(tr.priority === 'urgent' && tr.status === 'triaged', 'the delegate agent triages it');
  check(new Date(tr.sla.firstResponseDueAt) - new Date(tr.createdAt) === 3600_000, 'the SLA follows priority (urgent: first response within an hour)');
  check(await code(() => support.setStatus(pool, bot, t.key, { status: 'resolved' })) === 'not_allowed', 'an agent cannot resolve it');
  const draft = await support.reply(pool, bot, t.key, { body: 'We see the duplicate charge and have refunded it.' });
  check(draft.state === 'draft', 'an agent’s reply is a draft');
  await support.reply(pool, staff, t.key, { body: 'Stripe shows a duplicate auth — refund issued.', internal: true });
  let mine = await support.getTicket(pool, ada, t.key);
  check(!mine.messages.some((m) => /refunded it|duplicate auth/.test(m.body)), 'the requester sees neither the unsent draft nor the internal note');
  check(mine.messages.every((m) => m.visibility === undefined && m.state === undefined), 'and no draft/visibility fields at all');
  check(await code(() => support.ratifyDraft(pool, bot, t.key, draft.id)) === 'human_ratification_required', 'an agent cannot send its own draft');
  check(await code(() => support.ratifyDraft(pool, ada, t.key, draft.id)) === 'human_ratification_required', 'the requester cannot send it either');
  check(await code(() => pool.query(`UPDATE support_messages SET state = 'sent' WHERE id = $1`, [draft.id])) !== null, 'the DATABASE refuses an unratified agent draft becoming sent');
  check(await code(() => pool.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, body) SELECT id, $2, 'agent', 'hi' FROM support_tickets WHERE number = $1`, [t.number, id.bot])) !== null, 'the DATABASE refuses a staff-side agent inserting a sent reply');
  const notesBefore = Number((await pool.query(`SELECT count(*)::int n FROM user_notifications WHERE user_id = $1 AND source = 'support'`, [id.ada])).rows[0].n);
  const sent = await support.ratifyDraft(pool, staff, t.key, draft.id, { body: 'We see the duplicate charge and refunded it today.' });
  const rm = sent.messages.find((m) => m.id === draft.id);
  check(rm.state === 'sent' && rm.agentDrafted && rm.ratifiedBy && String(rm.ratifiedBy.id) === String(id.mod), 'staff ratify it: sent, marked agent-drafted, with who ratified it');
  check(sent.sla.firstRespondedAt, 'the first response is recorded');
  mine = await support.getTicket(pool, ada, t.key);
  check(mine.messages.some((m) => m.body === 'We see the duplicate charge and refunded it today.' && m.author.name === 'XENO support'), 'the requester now sees the reply as from XENO support');
  check(Number((await pool.query(`SELECT count(*)::int n FROM user_notifications WHERE user_id = $1 AND source = 'support'`, [id.ada])).rows[0].n) === notesBefore + 1, 'and is notified');

  // statuses
  check(await code(() => support.setStatus(pool, ada, t.key, { status: 'resolved' })) === 'not_allowed', 'the requester cannot resolve it');
  await support.setStatus(pool, staff, t.key, { status: 'waiting_on_customer' });
  await support.reply(pool, ada, t.key, { body: 'Thanks, I see the refund.' });
  check((await support.getTicket(pool, staff, t.key)).status === 'triaged', 'the requester’s reply hands a waiting request back to XENO');
  check(await code(() => support.reply(pool, ada, t.key, { body: 'x', internal: true })) === 'not_allowed', 'the requester cannot write internal notes');
  await support.setStatus(pool, staff, t.key, { status: 'resolved', note: 'Refunded' });
  check((await support.setStatus(pool, ada, t.key, { status: 'triaged' })).status === 'triaged', 'the requester can reopen a resolved request');
  check((await support.setStatus(pool, ada, t.key, { status: 'closed' })).status === 'closed', 'and close their own');
  check(await code(() => support.reply(pool, ada, t.key, { body: 'more' })) === 'ticket_closed', 'a closed request takes no more customer messages');

  // engineering: a XENO Tasks task, and the fix written back
  const t2 = await support.createTicket(pool, ada, { kind: 'bug', title: 'Export fails', body: 'PDF export spins forever' });
  const linked = await support.linkTask(pool, staff, t2.key);
  check(linked.engineering && /^T-\d+$/.test(linked.engineering.task), 'staff raise a XENO Tasks task from it');
  check((await support.getTicket(pool, ada, t2.key)).engineering.status === 'in progress' && !(await support.getTicket(pool, ada, t2.key)).engineering.task, 'the requester sees engineering is on it, not the internal task');
  for (const to of ['todo', 'in_progress', 'done']) await tasks.transitionTask(pool, staff, linked.engineering.task, { to });
  const fixed = await support.getTicket(pool, ada, t2.key);
  check(fixed.status === 'resolved' && fixed.messages.some((m) => /fix is done/.test(m.body)) && fixed.engineering.status === 'fixed', 'finishing the task writes the fix back: resolved, recorded, visible');

  // merge
  const dup = await support.createTicket(pool, ada, { kind: 'bug', title: 'Export still fails' });
  check(await code(() => support.merge(pool, ada, dup.key, { into: t2.key })) === 'not_allowed', 'only staff merge');
  check(await code(() => support.merge(pool, staff, dup.key, { into: dup.key })) === 'merge_self', 'a request cannot merge into itself');
  const m = await support.merge(pool, staff, dup.key, { into: t2.key });
  check(m.status === 'closed' && m.mergedInto === t2.key, 'a duplicate merges: closed, pointing at the survivor');

  // publish
  const t3 = await support.createTicket(pool, ada, { kind: 'other', title: 'How do I share a folder?', body: 'Is there a link option?' });
  check(await code(() => support.publish(pool, staff, t3.key)) === 'not_allowed', 'staff cannot make a request public');
  check(await code(() => support.publish(pool, adaBot, t3.key)) === 'not_allowed', 'nor can the requester’s agent');
  const pub = await support.publish(pool, ada, t3.key);
  check(pub.thread && pub.thread.url.startsWith('/forum/t/'), 'the requester makes it a public Forum Help thread, linked');

  // macros
  check(await code(() => support.saveMacro(pool, ada, { title: 'x', body: 'y' })) === 'not_allowed', 'saved replies are staff-only');
  const mac = await support.saveMacro(pool, staff, { title: 'Refund issued', body: 'We have refunded the charge.' });
  check((await support.listMacros(pool, staff)).some((x) => x.id === mac.id), 'staff save and list saved replies');

  // MCP: same service, and no tool sends to a customer
  check(!supportMcp.TOOLS.some((x) => /send|ratify/.test(x.name)), 'no agent tool sends a reply to a customer');
  const viaMcp = await supportMcp.callTool(pool, adaBot, 'create_ticket', { kind: 'account', title: 'Change my email' });
  check(String((await support.getTicket(pool, ada, viaMcp.structuredContent.ticket.key)).requester ?? 'requester') && viaMcp.structuredContent.ticket.you === 'requester', 'an agent raises a request for its owner through the tool');
  check(!(await support.getTicket(pool, ada, viaMcp.structuredContent.ticket.key)).messages.some((x) => /agent/.test(x.body)), 'the internal “raised by an agent” line stays internal');
  await support.assign(pool, staff, viaMcp.structuredContent.ticket.key, { delegateAgentId: id.bot });
  const d2 = await supportMcp.callTool(pool, bot, 'reply_draft', { key: viaMcp.structuredContent.ticket.key, body: 'Go to Settings › Account.' });
  check(d2.structuredContent.message.state === 'draft', 'the delegate agent’s tool reply is a draft');

  // rate limit
  let limited = null;
  for (let i = 0; i < support.LIMITS.tickets + 1 && !limited; i += 1) limited = await code(() => support.createTicket(pool, bob, { title: `burst ${i}` }));
  check(limited === 'rate_limited', 'a burst of requests is refused');

  console.log(`\nsupport-tickets: ${passed} passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
