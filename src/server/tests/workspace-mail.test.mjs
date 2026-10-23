/**
 * Office › Mail = a FRONT-END to XENO Mail (services/xenoMail.js + mailMcp.js), on real Postgres against a FAKE
 * mail-core that verifies every assertion with the platform's own public key, binds the mailbox the way mail-core does
 * (the person's own address or a refusal, never a fallback) and serves the §8 capability envelope. No real network.
 *
 *   - fails closed: no XENO_MAIL_API_URL → mail_not_configured (status reports configured:false);
 *   - the assertion: aud xeno-mail, typ xeno-mail-assertion+jwt, ≤60 s, sub = the person, act = the agent,
 *     mail_address = the address this workspace is mapped to;
 *   - the workspace↔mailbox mapping: only the person's own address is accepted, an agent cannot change it, and every
 *     later call carries it;
 *   - read, search, star, label (by id), archive/unarchive and draft go to mail-core by capability name with { args };
 *   - send: a person needs confirm:true (428 otherwise); an agent's send is saved as a DRAFT, recorded as the agent's,
 *     and send is never called; sending that draft consumes it; discarding a draft is a person's;
 *   - mail → task (source 'mail'), → support ticket, → a XENO Customers contact (one per address) + timeline;
 *   - a non-member of the workspace is refused; MCP has no send, discard or mailbox tool;
 *   - NOTHING of the mail is stored on the platform (no table holds a subject or a body).
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/workspace-mail.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { jwks } from '../utils/oidcProvider.js';
import { ensurePersonalWorkspace } from '../services/personalWorkspace.js';
import * as Mail from '../services/xenoMail.js';
import * as Mcp from '../services/mailMcp.js';
import { BOUND_TOOLS } from '../capabilities/catalogue.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ml${Date.now().toString(36)}`;
let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed += 1; console.log(`  ok  ${label}`); };

// ── the fake mail-core
const calls = [];
let pub;
const MAILBOXES = new Map();   // person id → their own addresses (first = default)
const NOW = new Date().toISOString();
const THREAD = { thread_id: 'th1', unread: true, messages: [{ message_id: 'm1', from: { name: 'Ada Lovelace', email: 'Ada@Example.com' }, to: ['me@xeno.test'], subject: 'Contract draft', received_at: NOW, text: 'Please review §4.' }] };
const drafts = new Map(); let draftSeq = 0;
const fake = http.createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  const fail = (code, message, s = 200) => send(s, { ok: false, provenance: 'trusted', error: { code, message } });
  let claims;
  try {
    const tok = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const hdr = JSON.parse(Buffer.from(tok.split('.')[0], 'base64url').toString());
    if (hdr.typ !== Mail.ASSERTION_TYP) throw new Error('typ');
    claims = jwt.verify(tok, pub, { algorithms: ['ES256'], audience: 'xeno-mail' });
    if (claims.exp - claims.iat > 60) throw new Error('lifetime');
  } catch { return fail('denied', 'bad assertion', 401); }
  const m = req.url.match(/^\/api\/capabilities\/([a-z._]+)$/);
  if (!m) return fail('not_found', 'no', 404);
  const body = JSON.parse(raw || '{}');
  if (!body || typeof body.args !== 'object') return fail('bad_input', 'wrap args', 400);
  // bind the mailbox exactly as mail-core does (xeno-mail PR #4): the named address of THIS person, or refuse
  const own = MAILBOXES.get(claims.sub);
  if (!own) return fail('not_found', 'This XENO account has no mailbox yet.', 503);
  const bound = claims.mail_address ? own.find((a) => a === claims.mail_address) : own[0];
  if (!bound) return fail('not_found', `This account has no mailbox at ${claims.mail_address}.`, 503);
  const name = m[1], a = body.args;
  calls.push({ name, args: a, claims, bound });
  if (claims.act && ['mail.message.send', 'mail.draft.delete', 'mail.thread.delete'].includes(name)) return fail('denied', 'an agent cannot run an irreversible capability', 403);
  switch (name) {
    case 'mail.app.status': return send(200, { ok: true, provenance: 'trusted', data: { mailbox: bound } });
    case 'mail.thread.search': return send(200, { ok: true, provenance: 'untrusted', data: { count: 1, threads: [{ thread_id: 'th1', subject: 'Contract draft', from: { name: 'Ada', email: 'ada@example.com' }, received_at: NOW, snippet: 'Please review', unread: true }] } });
    case 'mail.thread.get': return a.thread_id === 'th1' ? send(200, { ok: true, provenance: 'untrusted', data: THREAD }) : fail('not_found', 'No thread');
    case 'mail.thread.mark_read': case 'mail.thread.archive': case 'mail.thread.unarchive': case 'mail.thread.label': return send(200, { ok: true, provenance: 'trusted', data: { updated: a.thread_ids.length, requested: a.thread_ids.length } });
    case 'mail.thread.star': return send(200, { ok: true, provenance: 'trusted', data: { updated: 1, requested: 1, starred: a.starred } });
    case 'mail.label.list': return send(200, { ok: true, provenance: 'trusted', data: { count: 1, labels: [{ id: 'lbl_legal', name: 'Legal', color: null }] } });
    case 'mail.label.create': return send(200, { ok: true, provenance: 'trusted', data: { id: 'lbl_new', name: a.name, color: null } });
    case 'mail.draft.save': { const id = a.draft_id || `d${++draftSeq}`; drafts.set(id, { ...a, draft_id: id }); return send(200, { ok: true, provenance: 'trusted', data: { draft_id: id } }); }
    case 'mail.draft.list': return send(200, { ok: true, provenance: 'untrusted', data: { count: drafts.size, drafts: [...drafts.values()].map((d) => ({ draft_id: d.draft_id, to: d.to, cc: d.cc, subject: d.subject, updated_at: NOW })) } });
    case 'mail.draft.get': return drafts.has(a.draft_id) ? send(200, { ok: true, provenance: 'untrusted', data: { ...drafts.get(a.draft_id), body: drafts.get(a.draft_id).body } }) : fail('not_found', 'no draft');
    case 'mail.draft.delete': drafts.delete(a.draft_id); return send(200, { ok: true, provenance: 'trusted', data: { deleted: a.draft_id } });
    case 'mail.message.send': if (a.draft_id) drafts.delete(a.draft_id); return send(200, { ok: true, provenance: 'trusted', data: { message_id: 'sent1', thread_id: a.thread_id || 'tnew', relay_accepted: true, filed_to_sent: true } });
    default: return fail('not_found', `No capability named ${name}`, 404);
  }
});

const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const refuses = async (p, code, label) => {
  await assert.rejects(p, (e) => { assert.ok(e instanceof Mail.MailError || e instanceof Mcp.MailMcpError, String(e)); assert.equal(e.code, code, `${label}: ${e.code}`); return true; });
  passed += 1; console.log(`  ok  ${label}`);
};

async function main() {
  await runAllMigrations(pool); await migrateAccountV2(pool);   // oidc_signing_keys
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const k = (await jwks(pool)).keys[0]; pub = crypto.createPublicKey({ key: k, format: 'jwk' });

  const me = await user('me'), stranger = await user('stranger'), viewer = await user('viewer');
  const agentId = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentId, me]);
  MAILBOXES.set(String(me), ['me@xeno.test', 'team@xeno.test']);
  const H = { id: me, kind: 'human' }, A = { id: agentId, kind: 'agent' };
  const personal = String((await ensurePersonalWorkspace(pool, me)).id);
  // a shared workspace I edit, where a viewer reads
  const shared = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [me, `${tag}-a`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', me], ['admin', me], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${shared}`, subject: `user:${u}`, relation })) });

  // ── fails closed
  delete process.env.XENO_MAIL_API_URL;
  ok((await Mail.status(pool, H)).configured === false, 'without XENO_MAIL_API_URL status says not configured');
  await refuses(Mail.listThreads(pool, H), 'mail_not_configured', 'without XENO_MAIL_API_URL every call fails closed');
  process.env.XENO_MAIL_API_URL = `http://127.0.0.1:${fake.address().port}/`;

  // ── status + read + search, as the person; the assertion carries who is asking
  const st = await Mail.status(pool, H);
  ok(st.connected === true && st.mailbox === 'me@xeno.test' && st.mappedAddress === null, 'status: connected to the default mailbox, no mapping yet');
  ok((await Mail.status(pool, { id: stranger, kind: 'human' })).connected === false, 'a person with no mailbox reads as not connected, not as an error');
  const ls = await Mail.listThreads(pool, H, { q: 'contract' });
  ok(ls.threads.length === 1, 'search returns threads');
  const last = calls.at(-1);
  ok(last.name === 'mail.thread.search' && last.args.query === 'contract' && last.args.folder === 'inbox', 'search reaches mail.thread.search with { args }');
  ok(last.claims.sub === String(me) && last.claims.act === undefined && last.claims.xeno_workspace === personal && last.claims.mail_address === undefined, 'assertion: sub = the person, no act, the workspace, no address');
  ok(last.claims.iss && last.claims.jti && last.claims.exp - last.claims.iat <= 60, 'assertion: issuer, single-use jti, 60 s');
  ok((await Mail.getThread(pool, H, { threadId: 'th1' })).thread.messages.length === 1, 'read a thread');
  await refuses(Mail.getThread(pool, H, { threadId: 'nope' }), 'mail_not_found', 'an unknown thread is mail_not_found');
  await refuses(Mail.getThread(pool, H, { threadId: '../x y' }), 'invalid_thread', 'a thread id is validated before it leaves');
  await Mail.listThreads(pool, H, { labelId: 'lbl_legal' });
  ok(calls.at(-1).args.folder === 'lbl_legal', 'a label view searches under the label id');

  // ── workspace ↔ mailbox mapping
  await refuses(Mail.setMailbox(pool, H, { workspace: shared, address: 'someone@else.test' }), 'mailbox_not_yours', 'mapping a workspace to an address that is not yours is refused');
  ok((await pool.query('SELECT count(*)::int n FROM mail_workspace_mailboxes')).rows[0].n === 0, '…and nothing is stored');
  await refuses(Mail.setMailbox(pool, A, { workspace: shared, address: 'team@xeno.test' }), 'person_required', 'an agent cannot re-point its owner’s mailbox');
  const mp = await Mail.setMailbox(pool, H, { workspace: shared, address: 'Team@Xeno.test' });
  ok(mp.mappedAddress === 'team@xeno.test', 'map the shared workspace to my team address (lower-cased)');
  await Mail.listThreads(pool, H, { workspace: shared });
  ok(calls.at(-1).claims.mail_address === 'team@xeno.test' && calls.at(-1).bound === 'team@xeno.test' && calls.at(-1).claims.xeno_workspace === shared, 'calls from that workspace carry and bind the mapped address');
  await Mail.listThreads(pool, A, { workspace: shared });
  ok(calls.at(-1).claims.mail_address === 'team@xeno.test' && calls.at(-1).claims.act.sub === String(agentId), 'an agent in that workspace reads the same mapped mailbox, as itself');
  await Mail.listThreads(pool, H);
  ok(calls.at(-1).claims.mail_address === undefined, 'the Personal workspace keeps the default mailbox');
  ok((await Mail.status(pool, H, { workspace: shared })).mailbox === 'team@xeno.test', 'status in the shared workspace reports the mapped mailbox');
  await refuses(Mail.listThreads(pool, { id: stranger, kind: 'human' }, { workspace: shared }), 'not_a_member', 'a non-member of the workspace is refused');

  // ── star / label / archive / read state
  await Mail.starThreads(pool, H, { threadIds: ['th1'] }); ok(calls.at(-1).name === 'mail.thread.star' && calls.at(-1).args.starred === true, 'star');
  await Mail.labelThreads(pool, H, { threadIds: ['th1'], add: ['lbl_legal'] });
  ok(JSON.stringify(calls.at(-1).args) === JSON.stringify({ thread_ids: ['th1'], add: ['lbl_legal'], remove: [] }), 'label by id');
  await refuses(Mail.labelThreads(pool, H, { threadIds: ['th1'] }), 'invalid_label', 'label with nothing to add or remove is refused');
  await refuses(Mail.labelThreads(pool, H, { threadIds: ['th1'], add: ['not an id!'] }), 'invalid_label', 'a label NAME with spaces is not an id');
  await Mail.archiveThreads(pool, H, { threadIds: ['th1'] }); ok(calls.at(-1).name === 'mail.thread.archive', 'archive');
  await Mail.archiveThreads(pool, H, { threadIds: ['th1'], undo: true }); ok(calls.at(-1).name === 'mail.thread.unarchive', 'undo archive');
  await Mail.markRead(pool, H, { threadIds: ['th1'], unread: true }); ok(calls.at(-1).args.unread === true, 'mark unread');
  ok((await Mail.listLabels(pool, H)).labels[0].id === 'lbl_legal', 'labels carry ids');
  ok((await Mail.createLabel(pool, H, { name: 'Finance' })).label.id === 'lbl_new', 'create a label');

  // ── compose / send
  await refuses(Mail.compose(pool, H, { to: 'bad', body: 'x' }), 'invalid_recipients', 'a bad recipient is refused before anything leaves');
  const dr = await Mail.compose(pool, H, { to: ['ada@example.com'], subject: 'Hi', body: 'Draft' });
  ok(dr.sent === false && calls.at(-1).name === 'mail.draft.save', 'save a draft');
  await refuses(Mail.compose(pool, H, { to: ['ada@example.com'], subject: 'Hi', body: 'x', send: true }), 'confirm_required', 'sending without confirm is refused (428)');
  const sends = () => calls.filter((c) => c.name === 'mail.message.send').length;
  const before = sends();
  const sent = await Mail.compose(pool, H, { to: ['ada@example.com'], subject: 'Re: Contract', body: 'Done', threadId: 'th1', send: true, confirm: true });
  ok(sent.sent === true && calls.at(-1).name === 'mail.message.send' && calls.at(-1).args.thread_id === 'th1', 'a person sends a reply with confirm');
  // an agent's send — even with confirm — is a draft, recorded as the agent's, and send is never called
  const ag = await Mail.compose(pool, A, { to: ['ada@example.com'], subject: 'Proposed reply', body: 'y', send: true, confirm: true });
  ok(ag.sent === false && ag.proposal === true && sends() === before + 1, 'an agent’s send is saved as a draft; send is never called');
  ok(calls.at(-1).name === 'mail.draft.save' && calls.at(-1).claims.sub === String(me) && calls.at(-1).claims.act.sub === String(agentId), '…as the agent acting for its owner');
  const agentDraft = ag.draft.draft_id;
  const dl = await Mail.listDrafts(pool, H);
  ok(dl.drafts.find((d) => d.draft_id === agentDraft).byAgent.id === String(agentId) && dl.drafts.find((d) => d.draft_id === dr.draft.draft_id).byAgent === null, 'drafts mark the one an agent wrote');
  ok((await Mail.status(pool, H)).agentDrafts === 1, 'status counts agent drafts waiting for the person');
  ok((await Mail.getDraft(pool, H, { draftId: agentDraft })).draft.byAgent.id === String(agentId), 'reading the draft shows who wrote it');
  await Mail.compose(pool, A, { to: ['ada@example.com'], subject: 'Proposed reply v2', body: 'y2', draftId: agentDraft });
  ok(calls.at(-1).args.draft_id === agentDraft, 'an agent updates its draft by id');
  await refuses(Mail.deleteDraft(pool, A, { draftId: agentDraft }), 'person_required', 'an agent cannot discard a draft');
  const s2 = await Mail.compose(pool, H, { to: ['ada@example.com'], subject: 'Proposed reply v2', body: 'y2', draftId: agentDraft, send: true, confirm: true });
  ok(s2.sent === true && calls.at(-1).args.draft_id === agentDraft, 'the person sends the agent’s draft (the draft is consumed)');
  ok((await pool.query('SELECT count(*)::int n FROM mail_agent_drafts WHERE draft_id = $1', [agentDraft])).rows[0].n === 0, '…and it is no longer waiting for review');
  await Mail.deleteDraft(pool, H, { draftId: dr.draft.draft_id }); ok(calls.at(-1).name === 'mail.draft.delete', 'a person discards a draft');

  // ── mail → work
  const t = await Mail.toTask(pool, H, { threadId: 'th1' });
  const trow = (await pool.query('SELECT title, source, source_ref FROM tasks WHERE id = $1', [t.task.id])).rows[0];
  ok(trow.title === 'Contract draft' && trow.source === 'mail' && trow.source_ref === 'mail:th1', 'mail → task (source mail, ref to the thread)');
  const tk = await Mail.toTicket(pool, H, { threadId: 'th1' });
  ok(tk.ticket && tk.ticket.title === 'Contract draft', 'mail → support request');
  const c1 = await Mail.toContact(pool, H, { threadId: 'th1' }); const c2 = await Mail.toContact(pool, H, { threadId: 'th1' });
  ok(c1.contact.email === 'ada@example.com' && c1.created === true && c2.created === false && c1.contact.id === c2.contact.id, 'mail → one XENO Customers contact per address');
  const acts = (await pool.query('SELECT kind, state FROM crm_activities WHERE contact_id = $1', [c1.contact.id])).rows;
  ok(acts.length === 2 && acts.every((x) => x.kind === 'email' && x.state === 'kept'), '…with the thread on its timeline');
  ok((await Mail.toContact(pool, A, { threadId: 'th1' })).activity.state === 'draft', 'an agent’s timeline entry is a draft a person keeps');
  await refuses(Mail.toContact(pool, { id: viewer, kind: 'human' }, { workspace: shared, threadId: 'th1' }), 'editor_required', 'a viewer cannot write contacts from mail');

  // ── MCP: no send, no discard, no mailbox tool; drafts through MCP are drafts; every tool is catalogued
  ok(!Mcp.TOOLS.some((x) => /send|delete|discard|mailbox/.test(x.name)), 'MCP has no send, discard or mailbox tool');
  ok(Mcp.TOOLS.every((x) => BOUND_TOOLS.mail.some((y) => y.name === x.name)), 'every MCP tool is bound in the catalogue');
  const r = await Mcp.callTool(pool, A, 'draft_mail', { to: ['ada@example.com'], body: 'hello' });
  ok(r.structuredContent.sent === false, 'an agent’s draft through MCP is a draft');
  await refuses(Mcp.callTool(pool, A, 'read_thread', { thread_id: 'nope' }), 'mail_not_found', 'MCP maps mail-core errors');

  // ── the platform stores no mail
  const cols = (await pool.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('mail_workspace_mailboxes','mail_agent_drafts')`)).rows.map((x) => x.column_name);
  ok(!cols.some((c) => /subject|body|text|html|password|secret|token/.test(c)), 'no platform mail table has a subject, body or credential column');

  console.log(`workspace-mail: ${passed} assertions passed`);
}

main().then(() => { fake.close(); return pool.end(); }).catch((e) => { console.error(e); fake.close(); pool.end(); process.exit(1); });
