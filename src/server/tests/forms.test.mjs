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
 *   - a closing date and a response limit are held, even by answers arriving together
 *   - an answer keeps its question as it read then; erasing a contact erases what they answered
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
import * as customers from '../services/customers.js';
import express from 'express';
import formsRoutes from '../routes/formsRoutes.js';
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
  const ct = await F.runAction(pool, E, { ...w, id: form.id, responseId: ada.id, action: 'contact' });
  const crow = (await pool.query('SELECT * FROM crm_contacts WHERE id = $1', [ct.response.actions.contact.id])).rows[0];
  ok(crow && crow.workspace_id === ws && crow.email === 'ada@example.com' && crow.name === 'Ada' && crow.source === 'form', 'a response becomes a Customers contact in the same workspace, sourced "form"');
  ok((await pool.query('SELECT 1 FROM crm_activities WHERE contact_id = $1 AND body LIKE $2', [crow.id, '%Seats: 5%'])).rows.length === 1, 'with the answers on its timeline');
  await F.submit(pool, pt, { answers: { ...good, name: 'Ada L.' }, source: '6.6.6.6' });
  const ada2 = (await F.listResponses(pool, E, { ...w, id: form.id })).responses.find((r) => r.answers.name === 'Ada L.');
  const ct2 = await F.runAction(pool, E, { ...w, id: form.id, responseId: ada2.id, action: 'contact' });
  ok(ct2.response.actions.contact.id === crow.id && ct2.response.actions.contact.matched, 'the same email answering again is matched to that contact, never a duplicate');
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

  // ── an answer keeps its question as it read then
  const hist = (await F.createForm(pool, E, { ...w, title: 'History', fields: [{ id: 'q', type: 'text', label: 'First wording', required: true }, { id: 'gone', type: 'text', label: 'Later removed' }] })).form;
  await F.updateForm(pool, E, { ...w, id: hist.id, status: 'open' });
  const hl = await F.createLink(pool, E, { ...w, id: hist.id, kind: 'public' });
  await F.submit(pool, tokenOf(hl.url), { answers: { q: 'yes', gone: 'kept' }, source: '6.6.6.6' });
  await F.updateForm(pool, E, { ...w, id: hist.id, fields: [{ id: 'q', type: 'text', label: 'Second wording', required: true }] });
  const hr = (await F.listResponses(pool, E, { ...w, id: hist.id })).responses[0];
  ok(hr.fields.find((x) => x.id === 'q').label === 'First wording', 'editing a form leaves an old answer with its question as it read then');
  const hcsv = (await F.exportCsv(pool, E, { ...w, id: hist.id })).csv;
  ok(hcsv.includes('Later removed') && hcsv.includes('kept'), 'a question since removed still has its answers in the export');
  const notes = (await pool.query(`SELECT title FROM user_notifications WHERE user_id = $1 AND source = 'forms' AND title LIKE '%History%'`, [editor])).rows;
  ok(notes.length === 1, 'whoever made the form is told about a response');

  // ── a closing date and a limit
  const dated = (await F.createForm(pool, E, { ...w, title: 'Dated', fields: [{ id: 'q', type: 'text', label: 'Q' }] })).form;
  await F.updateForm(pool, E, { ...w, id: dated.id, status: 'open', closesAt: new Date(Date.now() + 3_600_000).toISOString() });
  const dl = tokenOf((await F.createLink(pool, E, { ...w, id: dated.id, kind: 'public' })).url);
  ok(!!(await F.publicForm(pool, dl)).form, 'a form before its closing date opens');
  await F.updateForm(pool, E, { ...w, id: dated.id, closesAt: new Date(Date.now() - 1000).toISOString() });
  ok(await code(F.publicForm(pool, dl)) === 'form_not_open' && await code(F.submit(pool, dl, { answers: { q: 'x' }, source: '7.7.7.7' })) === 'form_not_open', 'after it, it is closed');
  ok(await code(F.updateForm(pool, E, { ...w, id: dated.id, closesAt: 'soon' })) === 'invalid_closes_at' && await code(F.updateForm(pool, E, { ...w, id: dated.id, maxResponses: 0 })) === 'invalid_max_responses', 'a bad date or limit is refused');
  const full = (await F.createForm(pool, E, { ...w, title: 'One only', fields: [{ id: 'q', type: 'text', label: 'Q' }] })).form;
  await F.updateForm(pool, E, { ...w, id: full.id, status: 'open', maxResponses: 1 });
  const fl = tokenOf((await F.createLink(pool, E, { ...w, id: full.id, kind: 'public' })).url);
  await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.1)')));   // warm connections, so the answers really do arrive together
  const got = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((i) => F.submit(pool, fl, { answers: { q: `r${i}` }, source: `8.8.8.${i}` })));
  ok(got.filter((x) => x.status === 'fulfilled').length === 1 && got.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'form_full'), 'six answers at once can’t overrun a limit of one');
  ok(await code(F.publicForm(pool, fl)) === 'form_full', 'and the form says it has all it needs');

  // ── erasing a contact erases what they answered
  const lead = (await F.createForm(pool, E, { ...w, title: 'Leads', fields: [{ id: 'name', type: 'text', label: 'Name' }, { id: 'mail', type: 'email', label: 'Mail' }], autoActions: ['contact'] })).form;
  await F.updateForm(pool, E, { ...w, id: lead.id, status: 'open' });
  const ll = tokenOf((await F.createLink(pool, E, { ...w, id: lead.id, kind: 'public' })).url);
  await F.submit(pool, ll, { answers: { name: 'Grace', mail: 'grace@example.test' }, source: '9.9.9.1' });
  await F.submit(pool, ll, { answers: { name: 'G', mail: 'GRACE@example.test' }, source: '9.9.9.2' });
  const cs = (await pool.query(`SELECT id FROM crm_contacts WHERE workspace_id = $1 AND lower(email) = 'grace@example.test'`, [ws])).rows;
  ok(cs.length === 1, 'the same e-mail answering twice is one contact');
  const O = { id: owner, kind: 'human' };
  ok((await customers.exportContact(pool, O, cs[0].id, w)).formResponses.length === 2, 'their export includes what they answered');
  await customers.eraseContact(pool, O, cs[0].id, w);
  ok((await F.listResponses(pool, E, { ...w, id: lead.id })).responses.length === 0, 'erasing the contact erases what they answered');

  // ── the public page itself, over HTTP: no account, no JavaScript
  const app = express(); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/forms', formsRoutes);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = `http://127.0.0.1:${srv.address().port}/api/forms/public`;
    const pg1 = (await F.createForm(pool, E, { ...w, title: 'Page <b>', fields: [{ id: 'who', type: 'text', label: 'Who?', required: true }, { id: 'how', type: 'select', label: 'How', options: ['A', 'B'] }, { id: 'days', type: 'multiselect', label: 'Days', options: ['Mon', 'Tue'] }] })).form;
    await F.updateForm(pool, E, { ...w, id: pg1.id, status: 'open', confirmation: 'Got it.' });
    const tk = tokenOf((await F.createLink(pool, E, { ...w, id: pg1.id, kind: 'public' })).url);
    const got = await fetch(`${base}/${tk}`), html = await got.text();
    ok(got.status === 200 && /<form[^>]+method="post"/.test(html) && !/<script/i.test(html), 'the public page is a plain form with no script');
    ok(html.includes('Page &lt;b&gt;') && !html.includes('Page <b>'), 'what a person typed is escaped');
    ok(/noindex/.test(got.headers.get('x-robots-tag') || '') && /default-src 'none'/.test(got.headers.get('content-security-policy') || ''), 'it’s not indexed and allows nothing else to load');
    const post = (b) => fetch(`${base}/${tk}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b).toString() });
    const badRes = await post([['a_who', ''], ['a_how', 'A']]);
    const bad = await badRes.text();
    ok(badRes.status === 422 && /<option selected>A<\/option>/.test(bad), 'a wrong answer comes back with what they typed still there');
    const good = await post([['a_who', 'Lin'], ['a_how', 'B'], ['a_days', 'Mon'], ['a_days', 'Tue']]);
    ok(good.status === 200 && (await good.text()).includes('Got it.'), 'a good answer gets the thanks');
    const saved = (await F.listResponses(pool, E, { ...w, id: pg1.id })).responses[0];
    ok(saved.answers.who === 'Lin' && saved.answers.days.join() === 'Mon,Tue', 'and is stored, several choices included');
    await post([['a_who', 'Bot'], [F.HONEYPOT, 'x']]);
    ok((await F.listResponses(pool, E, { ...w, id: pg1.id })).responses.length === 1, 'a filled honeypot isn’t counted as a response');
    const nope = await fetch(`${base}/${'x'.repeat(43)}`);
    ok(nope.status === 404 && /doesn|does not work/.test(await nope.text()), 'a dead link says so');
  } finally { await new Promise((r) => srv.close(r)); }

  // ── erasing every answer is a person's
  ok(await code(F.deleteAllResponses(pool, AG, { ...w, id: hist.id })) === 'person_required', 'an agent can’t erase all responses');
  ok((await F.deleteAllResponses(pool, E, { ...w, id: hist.id })).deleted === 1 && (await pool.query(`SELECT answers, fields, email FROM form_responses WHERE form_id = $1`, [hist.id])).rows.every((r) => JSON.stringify(r.answers) === '{}' && JSON.stringify(r.fields) === '[]' && r.email === null), 'a person can, and the answers are gone, not hidden');

  console.log(`\nforms: ${passed} passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
