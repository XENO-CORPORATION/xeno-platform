/**
 * XENO Customers (services/customers.js, customersMcp.js), against a real Postgres.
 *
 *   - contacts, companies and deals belong to the WORKSPACE: viewers read, editors write, a human admin deletes/erases
 *   - a stranger and another workspace see nothing
 *   - an email is one contact per workspace (dedupe); CSV import is a dry run unless confirmed, skips or merges duplicates
 *   - an agent reads and DRAFTS: its note and deal wait for a person; it cannot delete, erase, merge, export or import
 *   - the database refuses an agent's draft marked kept without a person, and an agent keeping one
 *   - pipeline stages, deal moves on the timeline; support tickets from this workspace show on the contact's record
 *   - tasks are XENO Tasks, linked; GDPR export carries the person's data; erasure leaves only a tombstone
 *
 *   node src/server/tests/customers.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as crm from '../services/customers.js';
import * as mcp from '../services/customersMcp.js';
import * as support from '../services/supportTickets.js';
import { BOUND_TOOLS } from '../capabilities/catalogue.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const code = async (fn) => { try { await fn(); return null; } catch (e) { return e.code || e.message; } };
const tag = `crm${Date.now().toString(36)}`;

async function main() {
  await runAllMigrations(pool);
  const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash, workspace_activated_at) VALUES ($1,$2,$3,true,true,'x',NOW()) RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, owner]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Acme',$2) RETURNING id`, [owner, `${tag}-a`])).rows[0].id;
  const other = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Other',$2) RETURNING id`, [stranger, `${tag}-b`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['admin', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  await writeTuples(pool, { writes: [{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }] });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, A = { id: agentU, kind: 'agent' };
  const w = { workspace: ws };

  // contacts + ownership
  const co = await crm.createCompany(pool, E, { ...w, name: 'Acme GmbH', domain: 'https://acme.example/' });
  check(co.domain === 'acme.example', 'a company is added, its domain normalised');
  check(await code(() => crm.createCompany(pool, E, { ...w, name: 'Acme 2', domain: 'ACME.example' })) === 'duplicate_company', 'one company per domain');
  const ada = await crm.createContact(pool, E, { ...w, name: 'Ada Lovelace', email: 'ADA@acme.example', companyId: co.id, tags: ['vip', 'vip', 'eu'] });
  check(ada.email === 'ada@acme.example' && ada.tags.length === 2 && ada.source === 'manual', 'an editor adds a contact; email lower-cased, tags deduped');
  check(await code(() => crm.createContact(pool, E, { ...w, name: 'Ada again', email: 'ada@ACME.example' })) === 'duplicate_contact', 'one contact per email per workspace (dedupe)');
  check(await code(() => crm.createContact(pool, V, { ...w, name: 'x' })) === 'editor_required', 'a viewer cannot write');
  check((await crm.listContacts(pool, V, w)).some((c) => c.id === ada.id), 'a viewer reads the workspace’s contacts');
  check(await code(() => crm.listContacts(pool, S, w)) === 'not_a_member', 'a stranger reads nothing');
  check(await code(() => crm.getContact(pool, S, ada.id, { workspace: other })) === 'contact_not_found', 'another workspace cannot reach this contact by id');
  check((await crm.listContacts(pool, V, { ...w, q: 'lovel' })).length === 1, 'search by name');
  check(await code(() => crm.createContact(pool, E, { ...w, name: 'Bad', email: 'not-an-email' })) === 'invalid_email', 'a malformed email is refused');
  const ada2 = await crm.updateContact(pool, E, ada.id, { ...w, title: 'Countess' });
  check(ada2.title === 'Countess', 'an editor updates a contact');

  // pipeline
  const p = await crm.pipeline(pool, V, w);
  check(p.stages.map((s) => s.name).join(',') === 'Lead,Qualified,Proposal,Won,Lost', 'a workspace gets the default pipeline');
  const deal = await crm.createDeal(pool, E, { ...w, title: 'Acme renewal', amountCents: 1200000, contactId: ada.id });
  check(deal.state === 'active' && deal.stageName === 'Lead', 'a person’s deal is active in the first stage');
  const moved = await crm.moveDeal(pool, E, deal.id, { ...w, stageId: p.stages[2].id });
  check(moved.stageName === 'Proposal', 'a deal moves stage');
  check((await crm.pipeline(pool, V, w)).stages[2].totalCents === 1200000, 'the stage totals its active deals');
  check(await code(() => crm.createDeal(pool, E, { ...w, title: 'x', amountCents: -1 })) === 'invalid_amount', 'a negative amount is refused');

  // agents read and draft
  const draftDeal = await crm.createDeal(pool, A, { ...w, title: 'Upsell (agent)', amountCents: 500, contactId: ada.id });
  check(draftDeal.state === 'draft', 'an agent’s deal is a DRAFT');
  check((await crm.pipeline(pool, V, w)).stages[0].totalCents === 0, 'a draft deal does not count in totals');
  check(await code(() => crm.confirmDeal(pool, A, draftDeal.id, w)) === 'human_only', 'an agent cannot confirm its own deal');
  check((await crm.confirmDeal(pool, E, draftDeal.id, w)).state === 'active', 'a person confirms it');
  check(await code(() => crm.moveDeal(pool, A, deal.id, { ...w, stageId: p.stages[3].id })) === 'human_only', 'an agent cannot move a deal');
  const note = await crm.addActivity(pool, A, ada.id, { ...w, kind: 'call', body: 'Called; wants a quote' });
  check(note.state === 'draft' && note.agentDrafted, 'an agent’s note is a draft');
  check(await code(() => crm.keepActivity(pool, A, note.id, w)) === 'human_only', 'an agent cannot keep a draft');
  check(await code(() => pool.query("UPDATE crm_activities SET state = 'kept' WHERE id = $1", [note.id])) === '23514', 'the database refuses an agent’s draft kept without a person');
  check(await code(() => pool.query("UPDATE crm_activities SET state = 'kept', kept_by = $2 WHERE id = $1", [note.id, agentU])) === '23514', 'the database refuses an agent keeping one');
  check((await crm.keepActivity(pool, O, note.id, w)).state === 'kept', 'a person keeps it');
  const n2 = await crm.addActivity(pool, E, ada.id, { ...w, body: 'Sent the deck' });
  check(n2.state === 'kept', 'a person’s note is kept at once');
  for (const op of [() => crm.deleteContact(pool, A, ada.id, w), () => crm.eraseContact(pool, A, ada.id, w), () => crm.exportContact(pool, A, ada.id, w),
    () => crm.mergeContacts(pool, A, { ...w, into: ada.id, from: ada.id }), () => crm.importCsv(pool, A, { ...w, csv: 'name\nx', confirm: true })]) {
    check(['human_only'].includes(await code(op)), 'an agent cannot delete, erase, export, merge or run an import');
  }
  check(await code(() => crm.deleteContact(pool, E, ada.id, w)) === 'admin_required', 'an editor cannot delete — deletes are an admin’s');

  // MCP: the tools are the service, and no destructive tool exists
  const names = mcp.TOOLS.map((t) => t.name);
  check(!names.some((n) => /delete|erase|merge|export|confirm|keep/.test(n)), 'no capability deletes, erases, merges, exports or keeps');
  check(BOUND_TOOLS.customers && BOUND_TOOLS.customers.length === mcp.TOOLS.length, 'the catalogue binds every Customers tool');
  const viaMcp = await mcp.callTool(pool, A, 'get_contact', { ...w, contactId: ada.id });
  check(viaMcp.structuredContent.contact.id === ada.id, 'an agent reads a contact through MCP');
  const prev = await mcp.callTool(pool, A, 'preview_import', { ...w, csv: 'name,email\nZed,zed@x.example' });
  check(prev.structuredContent.report.created === 1 && !(await crm.listContacts(pool, V, { ...w, q: 'zed' })).length, 'preview_import writes nothing');

  // tickets on the record, tasks linked
  const t = await support.createTicket(pool, { id: editor, kind: 'human', role: 'user' }, { kind: 'bug', title: 'Login broken', body: 'x', workspaceId: ws });
  const bob = await crm.createContact(pool, O, { ...w, name: 'The Editor', email: `${tag}_editor@xeno.test` });
  const bobRec = await crm.getContact(pool, E, bob.id, w);
  check(bobRec.tickets.some((x) => x.key === t.key), 'a support ticket raised from this workspace by this email shows on the contact');
  check(!(await crm.getContact(pool, V, bob.id, w)).tickets.length, 'a ticket the reader may not read does not show');
  check(await code(() => crm.link(pool, V, bob.id, { ...w, kind: 'support_ticket', key: t.key })) === 'editor_required', 'a viewer cannot link');
  check(await code(() => crm.link(pool, O, bob.id, { ...w, kind: 'support_ticket', key: t.key })) === 'ticket_not_found', 'you can only link a ticket you can read');
  const task = await crm.createTaskFor(pool, E, ada.id, { ...w, title: 'Send the renewal quote' });
  check(/^T-\d+$/.test(task.key), 'a XENO Tasks task is raised for the contact');
  const adaRec = await crm.getContact(pool, E, ada.id, w);
  check(adaRec.tasks.some((x) => x.key === task.key && x.title === 'Send the renewal quote'), 'the task is linked on the record');
  check(adaRec.activities.some((a) => a.kind === 'stage') && adaRec.activities.some((a) => a.kind === 'link'), 'stage moves and links land on the timeline');

  // import + dedupe
  const csv = 'Name,Email,Phone,Company,Tags\r\n"Grace Hopper",grace@navy.example,+1 555,Navy,"a;b"\nAda L,ada@acme.example,+44 1,,\n,nobody@x.example,,,\nGrace dup,GRACE@navy.example,,,\n"Quote, Inc",,,,';
  const dry = await crm.importCsv(pool, E, { ...w, csv });
  check(dry.created === 2 && dry.skipped === 2 && dry.invalid.length === 1 && !dry.confirm, 'a dry run reports creates, duplicates (in-file and existing) and invalid rows');
  check(!(await crm.listContacts(pool, V, { ...w, q: 'grace' })).length, 'the dry run wrote nothing');
  const real = await crm.importCsv(pool, E, { ...w, csv, confirm: true, onDuplicate: 'merge' });
  check(real.created === 2 && real.merged === 1, 'a confirmed import creates and merges');
  const grace = (await crm.listContacts(pool, V, { ...w, q: 'grace' }))[0];
  check(grace.companyName === 'Navy' && grace.tags.join() === 'a,b' && grace.source === 'import', 'imported contacts get their company and tags');
  check((await crm.listContacts(pool, V, { ...w, q: 'quote' }))[0].name === 'Quote, Inc', 'a quoted comma survives CSV parsing');
  check((await crm.getContact(pool, V, ada.id, w)).phone === '+44 1', 'merge fills a blank and never overwrites');
  check(await code(() => crm.importCsv(pool, E, { ...w, csv: 'email\nx@y.z' })) === 'name_column_required', 'an import needs a name column');
  const dupA = await crm.createContact(pool, E, { ...w, name: 'Twin', email: 'twin1@x.example' });
  const dupB = await crm.createContact(pool, E, { ...w, name: 'twin ', email: 'twin2@x.example' });
  await crm.addActivity(pool, E, dupB.id, { ...w, body: 'note on B' });
  check((await crm.findDuplicates(pool, V, w)).some((d) => [d.a.id, d.b.id].includes(dupA.id) && [d.a.id, d.b.id].includes(dupB.id)), 'likely duplicates by name are found');
  const merged = await crm.mergeContacts(pool, E, { ...w, into: dupA.id, from: dupB.id });
  check(merged.activities.some((a) => a.body === 'note on B') && await code(() => crm.getContact(pool, V, dupB.id, w)) === 'contact_not_found', 'merge moves the timeline and removes the other');

  // GDPR
  const exp = await crm.exportContact(pool, E, ada.id, w);
  check(exp.format === 'xeno-customers-export@1' && exp.contact.email === 'ada@acme.example' && exp.deals.length === 2 && exp.activities.some((a) => a.body === 'Sent the deck'), 'GDPR export carries the person’s data');
  check((await crm.eraseContact(pool, O, ada.id, w)).erased, 'a human admin erases a contact');
  check(await code(() => crm.getContact(pool, V, ada.id, w)) === 'contact_not_found', 'erased: gone');
  check(!(await pool.query('SELECT 1 FROM crm_activities WHERE contact_id = $1', [ada.id])).rowCount, 'erased: timeline gone');
  check((await pool.query('SELECT 1 FROM crm_erasures WHERE contact_id = $1', [ada.id])).rowCount === 1, 'erasure leaves a tombstone with no personal data');
  check((await pool.query('SELECT contact_id FROM crm_deals WHERE id = $1', [deal.id])).rows[0].contact_id === null, 'a deal survives without the person');

  const s = await crm.summary(pool, V, w);
  check(s.contacts >= 4 && s.companies >= 2 && s.openDeals >= 2, 'the summary counts the workspace');
  console.log(`\ncustomers: ${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
