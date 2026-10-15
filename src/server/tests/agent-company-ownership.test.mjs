/**
 * Company-owned agents (XENO-WORKFORCE-01 OWN-01/OWN-05, MKT-01), end to end against a real database:
 *
 *  - an agent moves into a COMPANY workspace by the two-sided transfer (source approves, a review lists every
 *    secret it uses, a receiving admin accepts) -- only from a browser session that just confirmed it is you;
 *  - accepting makes the accepting admin ACCOUNTABLE, in the same transaction, recorded;
 *  - the four rights: viewer < runner < editor, and exporter apart; workspace admins hold them all, members
 *    hold what they were granted, and each right opens exactly its operations;
 *  - when the accountable person stops being an admin, the agent PAUSES (its credential stops working) and any
 *    admin takes it over with one recorded act -- it is never deleted;
 *  - nobody outside sees it, and a script with a bearer token cannot move it.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/agent-company-ownership.test.mjs
 */
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { browserSessionMiddleware } from '../middleware/browserSession.js';
import authRoutes from '../routes/authRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import xenoTasksRoutes, { taskTokenAuth, unlessTaskToken, mcpChallenge } from '../routes/xenoTasksRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import accountSecurityRoutes from '../routes/accountSecurityRoutes.js';
import { authMiddleware } from '../middleware/auth.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check_ = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const PW = 'Company-agents-test-42!';

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const hash = await bcrypt.hash(PW, 4);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,is_active,workspace_activated_at) VALUES($1,$2,$3,$1,TRUE,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`, hash])).rows[0].id;
  const ada = await mk('cown-ada'), bea = await mk('cown-bea'), cal = await mk('cown-cal'), dov = await mk('cown-dov');

  // the company: Ada owns it, Bea is an admin, Cal a member; Dov is outside
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', 'acme-cown') RETURNING id`, [ada])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${ws}`, relation: 'owner', subject: `user:${ada}` },
    { object: `workspace:${ws}`, relation: 'admin', subject: `user:${bea}` },
    { object: `workspace:${ws}`, relation: 'editor', subject: `user:${cal}` },
  ] });

  const app = express(); app.use(cookieParser()); app.use(express.json());
  app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/auth', authRoutes);
  app.use('/api/account', authMiddleware, accountSecurityRoutes);
  app.use('/api/tasks', mcpChallenge, taskTokenAuth, unlessTaskToken(authMiddleware), xenoTasksRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // a real browser session: log in, then "confirm it's you" with the password
  const jar = (sc = []) => sc.map((v) => v.split(';', 1)[0]).join('; ');
  const browser = async (email) => {
    const r = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-xeno-session-mode': 'browser' }, body: JSON.stringify({ email, password: PW }) });
    const cookie = jar(r.headers.getSetCookie());
    const csrf = decodeURIComponent(cookie.split('; ').find((v) => /^(?:__Host-)?xeno_csrf=/.test(v)).split('=')[1]);
    return { cookie, csrf };
  };
  const call = async (method, path, { as, token, body } = {}) => {
    const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    if (as) { headers.cookie = as.cookie; headers['x-xeno-csrf'] = as.csrf; }
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await fetch(origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const confirm = (as) => call('POST', '/api/account/confirm', { as, body: { method: 'password', password: PW } });

  try {
    const A = await browser('cown-ada@example.test'), B = await browser('cown-bea@example.test');
    const C = await browser('cown-cal@example.test'), D = await browser('cown-dov@example.test');
    const ag = (await call('POST', '/api/agents', { as: A, body: { name: 'Acme Bot', instructions: 'Help Acme.' } })).j.agent;
    check_(ag && ag.owner.kind === 'personal' && ag.accountable.userId === String(ada), 'a new agent is personal, and its maker is accountable');

    // moving it into the company: the browser must have confirmed, and a bearer token can never do it
    const bearer = jwt.sign({ userId: ada, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '5m' });
    check_((await call('POST', `/api/agents/${ag.id}/transfers`, { token: bearer, body: { workspaceId: ws } })).j.code === 'confirmation_unavailable', 'a script with a bearer token cannot move an agent');
    check_((await call('POST', `/api/agents/${ag.id}/transfers`, { as: A, body: { workspaceId: ws } })).j.code === 'confirmation_required', 'a browser must confirm it is you first');
    check_((await confirm(A)).s === 200, 'confirm it is you (password)');
    const t = await call('POST', `/api/agents/${ag.id}/transfers`, { as: A, body: { workspaceId: ws } });
    check_(t.s === 200 && t.j.transfer.state === 'authorized', `the owner proposes and approves the move in one act (${t.s} ${t.j && t.j.code})`);
    const subject = (await call('GET', `/api/agents/transfers/${t.j.transfer.id}/review-subject`, { as: A })).j.subject;
    check_(subject && Array.isArray(subject.secretReferences), 'the review shows what the agent depends on');
    const rev = await call('POST', `/api/agents/transfers/${t.j.transfer.id}/review`, { as: A, body: { agentVersion: subject.agentVersion, review: { schemaVersion: 1, secretReferences: subject.secretReferences, licenses: subject.licenses, dependencies: [], verdict: 'clear' } } });
    check_(rev.s === 200 && rev.j.transfer.state === 'reviewed', 'the review is recorded');
    check_((await call('POST', `/api/agents/transfers/${t.j.transfer.id}/accept`, { as: C, body: { rationale: 'x' } })).s === 403, 'a member who is not an admin of Acme cannot accept it');
    const inbox = (await call('GET', '/api/agents/transfers/inbox', { as: B })).j.transfers;
    check_(inbox.some((x) => x.id === t.j.transfer.id && x.agent.name === 'Acme Bot' && x.toName === 'Acme'), "the move waits in an Acme admin's inbox, named");
    check_(!(await call('GET', '/api/agents/transfers/inbox', { as: C })).j.transfers.length, 'not in a plain member’s');
    await confirm(B);
    const acc = await call('POST', `/api/agents/transfers/${t.j.transfer.id}/accept`, { as: B, body: { rationale: 'Acme runs this agent now.' } });
    check_(acc.s === 200 && acc.j.transfer.state === 'accepted', 'an Acme admin accepts it');

    const after = (await call('GET', `/api/agents/${ag.id}`, { as: B })).j.agent;
    check_(after.owner.kind === 'company' && after.owner.name === 'Acme' && after.accountable.userId === String(bea), 'it now belongs to Acme, and the accepting admin answers for it');
    const hist = (await pool.query(`SELECT reason, from_user_id, to_user_id FROM agent_accountability_changes WHERE agent_user_id = $1`, [after.userId])).rows;
    check_(hist.length === 1 && hist[0].reason === 'transfer' && String(hist[0].from_user_id) === String(ada), 'the change of accountable person is recorded');

    // the four rights
    check_((await call('GET', `/api/agents/${ag.id}`, { as: A })).s === 200, 'Ada, the workspace owner, still sees it (an admin holds every right)');
    check_((await call('GET', `/api/agents/${ag.id}`, { as: C })).s === 404 && (await call('GET', `/api/agents/${ag.id}`, { as: D })).s === 404, 'a member without a right, and an outsider, do not see it');
    check_(!(await call('GET', '/api/agents', { as: C })).j.agents.some((x) => x.id === ag.id), "it is not in the member's list either");
    await call('PUT', `/api/agents/${ag.id}/access/${cal}/viewer`, { as: B });
    const seen = await call('GET', `/api/agents/${ag.id}`, { as: C });
    check_(seen.s === 200 && seen.j.agent.rights.viewer && !seen.j.agent.rights.runner && !seen.j.agent.rights.manage, 'granted viewer, Cal sees it and knows he can only look');
    check_((await call('POST', `/api/agents/${ag.id}/credentials`, { as: C, body: {} })).s === 403, 'a viewer cannot run it (no credential)');
    check_((await call('PATCH', `/api/agents/${ag.id}`, { as: C, body: { instructions: 'No.' } })).s === 403, 'and cannot change it');
    await call('PUT', `/api/agents/${ag.id}/access/${cal}/runner`, { as: B });
    const cred = await call('POST', `/api/agents/${ag.id}/credentials`, { as: C, body: {} });
    check_(cred.s === 201 && /^xtk_/.test(cred.j.credential.token), 'granted runner, Cal can run it');
    check_((await call('PATCH', `/api/agents/${ag.id}`, { as: C, body: { instructions: 'No.' } })).s === 403, 'but runner still cannot change it');
    await call('PUT', `/api/agents/${ag.id}/access/${cal}/editor`, { as: B });
    check_((await call('PATCH', `/api/agents/${ag.id}`, { as: C, body: { instructions: 'Help Acme carefully.' } })).j.agent.instructions === 'Help Acme carefully.', 'granted editor, Cal changes its instructions');
    check_((await call('DELETE', `/api/agents/${ag.id}`, { as: C })).s === 403, 'but only its owner or an admin can delete it');
    check_((await call('PUT', `/api/agents/${ag.id}/access/${dov}/viewer`, { as: B })).j.code === 'not_a_member', 'a right is only for members of the workspace');
    const selfGrant = await call('PUT', `/api/agents/${ag.id}/access/${cal}/exporter`, { as: C });
    check_(selfGrant.s === 403, `a member, even an editor, cannot grant rights (${selfGrant.s} ${selfGrant.j && selfGrant.j.code})`);
    const list = (await call('GET', `/api/agents/${ag.id}/access`, { as: B })).j.access;
    check_(list.people.some((p) => p.userId === String(cal) && p.rights.includes('editor')), 'the access list shows who holds what');
    check_((await pool.query(`SELECT count(*)::int AS n FROM agent_access_changes WHERE agent_user_id = $1`, [after.userId])).rows[0].n === 3, 'every grant is recorded');
    let blocked = null; try { await pool.query(`DELETE FROM agent_access_changes WHERE agent_user_id = $1`, [after.userId]); } catch (e) { blocked = e; }
    check_(blocked && blocked.code === '23514', 'and that history cannot be erased');

    // the accountable admin leaves: the agent pauses, an admin takes it over
    const live = (await call('POST', `/api/agents/${ag.id}/credentials`, { as: B, body: {} })).j.credential.token;
    check_((await call('GET', '/api/tasks/agent/me', { token: live })).s === 200, 'its credential works');
    await writeTuples(pool, { deletes: [{ object: `workspace:${ws}`, relation: 'admin', subject: `user:${bea}` }] });
    const paused = await call('GET', '/api/tasks/agent/me', { token: live });
    check_(paused.s === 403 && /paused/.test(paused.j.error || ''), `when Bea stops being an admin, the agent pauses and says why (${paused.s})`);
    const view = (await call('GET', `/api/agents/${ag.id}`, { as: A })).j.agent;
    check_(view.paused === 'needs_owner' && view.instructions === 'Help Acme carefully.', 'it is not deleted: Ada sees it, paused, needing an owner');
    await pool.query(`DELETE FROM account_confirmations WHERE user_id = $1`, [ada]);
    check_((await call('POST', `/api/agents/${ag.id}/accountable`, { as: A, body: {} })).j.code === 'confirmation_required', 'taking it over needs the browser to confirm it is you');
    await confirm(A);
    const took = await call('POST', `/api/agents/${ag.id}/accountable`, { as: A, body: { note: 'Bea left' } });
    check_(took.s === 200 && took.j.access.accountable.userId === String(ada) && took.j.access.history[0].reason === 'takeover', 'Ada takes it over, recorded with her note');
    check_((await call('GET', '/api/tasks/agent/me', { token: live })).s === 200, 'and it works again, with the same credential');
    check_((await call('POST', `/api/agents/${ag.id}/accountable`, { as: A, body: { userId: cal } })).j.code === 'not_an_admin', 'only an admin of the workspace can be made accountable');
  } finally {
    server.close();
    await pool.end();
  }
  console.log(`\nagent-company-ownership: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
