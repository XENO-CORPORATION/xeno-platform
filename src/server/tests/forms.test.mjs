/**
 * Corpo › Forms (services/forms.js + formsMcp.js) on real Postgres.
 *
 *   - §8.11: a viewer lists forms, an editor builds them and reads responses, a stranger is refused; an agent works
 *     as its owner; deleting a form or a response is a person's act
 *   - fields are validated when the form is built (unknown types, duplicate ids, empty choices refused)
 *   - answers are validated on the server: required, email, number range, choices, size
 *   - links: sign-in (needs an account) and public; an agent cannot make a public link — the service refuses AND the
 *     database refuses; a revoked or expired link, a draft or closed form, takes nothing; only the token's hash is stored
 *   - spam: a filled honeypot is stored as spam and answered as accepted; per-source hourly limit
 *   - actions: a response becomes a XENO Tasks task and a support request, recorded once; contact says Customers is
 *     unavailable when that area is absent
 *   - CSV export guards against spreadsheet formulas; deleting a response erases its answers
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/forms.test.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as F from '../services/forms.js';
import * as Mcp from '../services/formsMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `fm${process.pid}`; let seq = 0, passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, workspace_activated_at, is_active, password_hash) VALUES ($1,$2,$3,true,now(),true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const team = async (owner, name) => (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${seq += 1}`])).rows[0].id;
const tokenOf = (url) => url.split('/').pop();

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent'), resp = await user('resp');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)`, [agentU, editor]);
  const ws = await team(owner, 'Forms'), other = await team(stranger, 'Other');
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation }))
    .concat([{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }]) });
  const E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' }, R = { id: resp, kind: 'human' };
  const w = { workspace: ws };
  const FIELDS = [
    { id: 'name', type: 'text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email', required: true },
    { id: 'seats', type: 'number', label: 'Seats', min: 1, max: 100 },
    { id: 'plan', type: 'select', label: 'Plan', options: ['Free', 'Team'] },
    { id: 'notes', type: 'textarea', label: 'Notes', maxLength: 50 },
  ];

  // ── building
  ok(await code(F.createForm(pool, V, { ...w, title: 'x' })) === 'editor_required', 'a viewer cannot build a form');
  ok(await code(F.createForm(pool, S, { ...w, title: 'x' })) === 'not_a_member', 'a stranger cannot either');
  ok(await code(F.createForm(pool, E, { ...w, title: 'x', fields: [{ type: 'rocket', label: 'a' }] })) === 'invalid_field_type', 'an unknown field type is refused');
  ok(await code(F.createForm(pool, E, { ...w, title: 'x', fields: [{ id: 'a', type: 'text', label: 'a' }, { id: 'a', type: 'text', label: 'b' }] })) === 'duplicate_field_id', 'two fields cannot share an id');
  ok(await code(F.createForm(pool, E, { ...w, title: 'x', fields: [{ type: 'select', label: 'a', options: [] }] })) === 'invalid_options', 'a choice field needs choices');
  const { form } = await F.createForm(pool, E, { ...w, title: 'Beta sign-up', fields: FIELDS });
  ok(form.status === 'draft' && form.fields.length === 5 && form.url === `/workspace/corpo/spaces/forms/${form.id}`, 'an editor builds a draft form, addressed by id');
  ok((await F.listForms(pool, V, w)).forms.some((f) => f.id === form.id), 'a viewer lists it');
  ok(await code(F.listForms(pool, S, w)) === 'not_a_member', 'a stranger cannot list it');
  ok(await code(F.getForm(pool, S, { workspace: other, id: form.id })) === 'form_not_found', 'from another workspace the form does not exist');

  // ── links
  const sl = await F.createLink(pool, E, { ...w, id: form.id, kind: 'signin' });
  const pl = await F.createLink(pool, E, { ...w, id: form.id, kind: 'public', label: 'Website' });
  ok(sl.url.includes('/workspace/corpo/spaces/forms/fill/') && pl.url.includes('/api/forms/public/'), 'sign-in and public links have their own addresses');
  ok(!(await pool.query('SELECT 1 FROM form_links WHERE token_sha256 = $1', [tokenOf(pl.url)])).rows.length
    && (await pool.query('SELECT 1 FROM form_links WHERE token_sha256 = $1', [crypto.createHash('sha256').update(tokenOf(pl.url)).digest('hex')])).rows.length === 1, 'only the token’s hash is stored');
  ok(await code(F.createLink(pool, AG, { ...w, id: form.id, kind: 'public' })) === 'person_required', 'an agent cannot make a public link');
  ok(await code(pool.query(`INSERT INTO form_links (form_id, kind, token_sha256, created_by_user_id, created_by_kind) VALUES ($1,'public','x${seq}',$2,'agent')`, [form.id, agentU])) !== null, 'the DATABASE refuses a public link made by an agent');
  const al = await Mcp.callTool(pool, AG, 'create_signin_link', { ...w, id: form.id });
  ok(al.structuredContent.link.kind === 'signin' && al.structuredContent.link.createdByKind === 'agent', 'an agent makes a sign-in link through its tool');
  ok(!Mcp.TOOLS.some((t) => /public|delete/.test(t.name)), 'no agent tool makes a public link or deletes');

  // ── answering
  const pt = tokenOf(pl.url), st = tokenOf(sl.url);
  ok(await code(F.publicForm(pool, pt)) === 'form_not_open', 'a draft form takes nothing');
  ok(await code(F.updateForm(pool, V, { ...w, id: form.id, status: 'open' })) === 'editor_required', 'a viewer cannot open it');
  await F.updateForm(pool, E, { ...w, id: form.id, status: 'open', autoActions: [] });
  const pub = await F.publicForm(pool, pt);
  ok(pub.form.title === 'Beta sign-up' && pub.form.fields.length === 5 && !('workspaceId' in pub.form), 'a public link shows the form, nothing about the workspace');
  ok(await code(F.publicForm(pool, st, null)) === 'sign_in_required', 'a sign-in link needs an account');
  ok((await F.publicForm(pool, st, R)).form.kind === 'signin', 'and opens for one');
  ok(await code(F.publicForm(pool, 'A'.repeat(43))) === 'link_not_found', 'an unknown token does not open');
  let e = null; try { await F.submit(pool, pt, { answers: { email: 'nope', seats: 500, plan: 'Gold', notes: 'x'.repeat(60) }, source: '1.1.1.1' }); } catch (x) { e = x; }
  ok(e && e.code === 'invalid_answers' && e.errors.name && e.errors.email && e.errors.seats && e.errors.plan && e.errors.notes, 'answers are validated on the server: required, email, range, choice, length');
  const good = { name: 'Ada', email: 'ADA@example.com', seats: '5', plan: 'Team', notes: '=HYPERLINK("evil")' };
  ok((await F.submit(pool, pt, { answers: good, source: '1.1.1.1' })).received, 'a valid response is received');
  await F.submit(pool, st, { answers: { name: 'Bob', email: 'bob@example.com' }, user: R });
  const spam = await F.submit(pool, pt, { answers: { ...good, [F.HONEYPOT]: 'buy now' }, source: '2.2.2.2' });
  ok(spam.received, 'a bot filling the honeypot is answered as accepted');
  let list = await F.listResponses(pool, E, { ...w, id: form.id });
  ok(list.responses.length === 2 && list.responses.some((r) => r.answers.email === 'ada@example.com' && r.answers.seats === 5) && list.responses.some((r) => r.signedIn), 'responses are stored normalized; the signed-in one is marked');
  ok((await F.listResponses(pool, E, { ...w, id: form.id, spam: true })).responses.length === 1, 'the spam is kept apart');
  ok(await code(F.listResponses(pool, V, { ...w, id: form.id })) === 'editor_required', 'a viewer cannot read responses');
  ok(!(await pool.query('SELECT 1 FROM form_responses WHERE source_hash LIKE $1', ['%1.1.1.1%'])).rows.length, 'the client address is never stored');
  let limited = null;
  for (let i = 0; i < F.LIMITS.perSource + 1 && !limited; i += 1) limited = await code(F.submit(pool, pt, { answers: good, source: '3.3.3.3' }));
  ok(limited === 'rate_limited', 'a burst from one source is refused');

  // ── actions
  const ada = list.responses.find((r) => r.answers.name === 'Ada');
  const act = await Mcp.callTool(pool, AG, 'act_on_response', { ...w, id: form.id, response: ada.id, action: 'task' });
  const key = act.structuredContent.response.actions.task.key;
  ok(/^T-\d+$/.test(key), 'an agent turns a response into a XENO Tasks task');
  const again = await F.runAction(pool, E, { ...w, id: form.id, responseId: ada.id, action: 'task' });
  ok(again.already && again.response.actions.task.key === key, 'running it again returns the same task, never a second');
  const tk = await F.runAction(pool, E, { ...w, id: form.id, responseId: ada.id, action: 'ticket' });
  ok(/^T-\d+$/.test(tk.response.actions.ticket.key) && (await pool.query('SELECT 1 FROM support_tickets WHERE number = $1 AND requester_id = $2', [Number(tk.response.actions.ticket.key.slice(2)), editor])).rows.length === 1, 'a response becomes a support request, raised by the person who ran it');
  const contact = await code(F.runAction(pool, E, { ...w, id: form.id, responseId: ada.id, action: 'contact' }));
  ok(contact === (await F.customersArea() ? null : 'customers_not_available'), 'a contact is made when Customers is present, and says so clearly when it is not');
  const spamRow = (await F.listResponses(pool, E, { ...w, id: form.id, spam: true })).responses[0];
  ok(await code(F.runAction(pool, E, { ...w, id: form.id, responseId: spamRow.id, action: 'task' })) === 'response_is_spam', 'nothing is made from spam');

  // ── export, delete
  const csv = (await F.exportCsv(pool, E, { ...w, id: form.id })).csv;
  ok(csv.includes('"\'=HYPERLINK(""evil"")"') && csv.startsWith('submitted,Your name,Email'), 'CSV export neutralizes formulas');
  ok(await code(F.deleteResponse(pool, AG, { ...w, id: form.id, responseId: ada.id })) === 'person_required', 'an agent cannot delete a response');
  await F.deleteResponse(pool, E, { ...w, id: form.id, responseId: ada.id });
  ok(JSON.stringify((await pool.query('SELECT answers FROM form_responses WHERE id = $1', [ada.id])).rows[0].answers) === '{}', 'deleting a response erases its answers');

  // ── revoke, close, delete form
  await F.revokeLink(pool, E, { ...w, id: form.id, linkId: sl.link.id });
  ok(await code(F.publicForm(pool, st, R)) === 'link_not_found', 'a revoked link stops working');
  await F.updateForm(pool, E, { ...w, id: form.id, status: 'closed' });
  ok(await code(F.submit(pool, pt, { answers: good, source: '4.4.4.4' })) === 'form_not_open', 'a closed form takes nothing');
  ok(await code(F.deleteForm(pool, AG, { ...w, id: form.id })) === 'person_required', 'an agent cannot delete a form');
  await F.deleteForm(pool, E, { ...w, id: form.id });
  ok(!(await F.listForms(pool, E, w)).forms.some((f) => f.id === form.id), 'a deleted form leaves the list');
  ok((await F.restoreForm(pool, E, { ...w, id: form.id })).form.id === form.id, 'and restore brings it back');

  // ── automatic actions on submit
  const auto = (await F.createForm(pool, E, { ...w, title: 'Bug intake', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }], autoActions: ['task'] })).form;
  await F.updateForm(pool, E, { ...w, id: auto.id, status: 'open' });
  const al2 = await F.createLink(pool, E, { ...w, id: auto.id, kind: 'public' });
  await F.submit(pool, tokenOf(al2.url), { answers: { name: 'Crash on save' }, source: '5.5.5.5' });
  const ar = (await F.listResponses(pool, E, { ...w, id: auto.id })).responses[0];
  ok(ar && ar.actions.task && /^T-\d+$/.test(ar.actions.task.key), 'a form set to make a task does so on every response');

  console.log(`\nforms: ${passed} passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
