/**
 * Per-person site access codes (services/siteAccessCodes.js + routes/siteGateRoutes.js), against a real Postgres.
 *
 *   - an admin creates a code; the plain code is returned once and only its hash is stored
 *   - a non-admin cannot create, list or revoke codes (the REAL requireAdmin, reading the real users row)
 *   - the code unlocks the pages; revoking it, or its expiry, refuses the cookie it already issued
 *   - max uses is enforced atomically; wrong / expired / revoked / used-up all answer the same 401
 *   - an 'account' code lets the holder through registrationGate while registration is closed; a 'pages' code and
 *     no code do not
 *   - the audit records created / redeemed (country only) / revoked / which account browsed under it
 *
 *   node src/server/tests/site-access-codes.test.mjs   (DATABASE_URL = a disposable database)
 */
import pg from 'pg';
import express from 'express';
import { runAllMigrations } from '../services/migrationRunner.js';
import { createSiteGateRouter } from '../routes/siteGateRoutes.js';
import { requireAdmin } from '../middleware/auth.js';
import { requireRegistrationOpen } from '../middleware/registrationGate.js';
import { hashCode } from '../services/siteAccessCodes.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  const mk = async (name, role = 'user') => { const m = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3) RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id; };
  const admin = await mk('sac-admin', 'admin'), user = await mk('sac-user');

  const env = { SITE_GATE: 'on', SITE_GATE_SECRET: 'test-secret', NODE_ENV: 'test' };
  Object.assign(process.env, env, { REGISTRATION_OPEN: 'false', REGISTRATION_OPEN_UNTIL: '' });
  const app = express(); app.use(express.json());
  app.use((req, _r, n) => { req.db = pool; const as = req.headers['x-test-user']; if (as) req.user = { id: as }; n(); });
  app.use('/g', createSiteGateRouter({ env, staffGuard: [(req, res, n) => (req.user ? n() : res.status(401).end()), requireAdmin] }));
  app.post('/register', requireRegistrationOpen, (_q, r) => r.status(201).end());
  const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const base = `http://127.0.0.1:${s.address().port}`;
  const req = (method, p, { body, as, cookie, country } = {}) => fetch(base + p, { method,
    headers: { 'content-type': 'application/json', ...(as ? { 'x-test-user': as } : {}), ...(cookie ? { cookie } : {}), ...(country ? { 'cf-ipcountry': country } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const cookiesOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const checkPages = (cookie) => req('GET', '/g/check', { cookie }).then((r) => r.status);

  try {
    // ── the console ──
    check((await req('POST', '/g/codes', { body: { label: 'x' }, as: user })).status === 403, 'a non-admin cannot create a code');
    check((await req('GET', '/g/codes', { as: user })).status === 403, 'a non-admin cannot list codes');
    check((await req('POST', '/g/codes', { body: { label: 'x' } })).status === 401, 'signed out cannot create a code');
    const made = await (await req('POST', '/g/codes', { body: { label: 'Investor — Example Fund', scope: 'account', days: 30 }, as: admin })).json();
    check(/^XENO(-[A-Z2-9]{5}){4}$/.test(made.code) && made.accessCode.scope === 'account', 'an admin creates an account-scope code and sees it once');
    const row = (await pool.query('SELECT * FROM site_access_codes WHERE id = $1', [made.accessCode.id])).rows[0];
    check(row.code_hash === hashCode(made.code) && !JSON.stringify(row).includes(made.code.replace(/-/g, '').slice(4)), 'only the hash is stored');
    check(Math.round((new Date(row.expires_at) - new Date(row.created_at)) / 86400_000) === 30, 'expiry defaults to the requested 30 days');
    check((await req('POST', '/g/codes', { body: { label: 'x', days: 0 }, as: admin })).status === 400, 'an expiry is required and bounded');
    const pagesOnly = await (await req('POST', '/g/codes', { body: { label: 'Tester', maxUses: 1 }, as: admin })).json();
    check(pagesOnly.accessCode.scope === 'pages' && pagesOnly.accessCode.maxUses === 1, 'scope defaults to pages');
    const list = await (await req('GET', '/g/codes', { as: admin })).json();
    check(list.codes.some((c) => c.id === made.accessCode.id) && !JSON.stringify(list).includes(made.code), 'the list never carries a code');

    // ── redeem ──
    check(await checkPages('') === 401, 'no cookie: Coming soon');
    check((await req('POST', '/g/unlock', { body: { code: 'XENO-AAAAA-AAAAA-AAAAA-AAAAA' } })).status === 401, 'a wrong code is refused');
    const r1 = await req('POST', '/g/unlock', { body: { code: made.code.toLowerCase().replace(/-/g, ' ') }, country: 'DE' });
    check(r1.status === 200, 'the code works as typed from a mail, any case or spacing');
    const c1 = cookiesOf(r1);
    check(/xeno_share_invite=v1\./.test(c1), 'an account code carries the signup invitation');
    check(await checkPages(c1) === 204, 'the cookie opens the pages');
    check((await req('POST', '/register', { body: { email: 'new@example.test' }, cookie: c1 })).status === 201, 'with an account code a new person may sign up while registration is closed');
    check((await req('POST', '/register', { body: { email: 'new@example.test' } })).status === 403, 'without a code signup stays closed');
    const p1 = await req('POST', '/g/unlock', { body: { code: pagesOnly.code } });
    const pc = cookiesOf(p1);
    check(p1.status === 200 && await checkPages(pc) === 204 && !/xeno_share_invite/.test(pc), 'a pages code opens pages and carries no invitation');
    check((await req('POST', '/register', { body: { email: 'other@example.test' }, cookie: pc })).status === 403, 'a pages code does not open signup');
    check((await req('POST', '/g/unlock', { body: { code: pagesOnly.code } })).status === 401, 'max uses is enforced');
    check(await checkPages(pc) === 204, 'a cookie already issued is not a new use');

    // ── a code LINK opened by someone already let in (owner, 2026-10-25) ──
    const linkCode = await (await req('POST', '/g/codes', { body: { label: 'Link opened by staff', days: 30 }, as: admin })).json();
    const viaLink = (cookie, uri, country) => fetch(`${base}/g/check`, { headers: { ...(cookie ? { cookie } : {}), 'x-original-uri': uri, ...(country ? { 'cf-ipcountry': country } : {}) } }).then((r) => r.status);
    const openedOf = async (id) => (await (await req('GET', `/g/codes/${id}/events`, { as: admin })).json()).events.filter((e) => e.event === 'opened');
    check(await viaLink(c1, `/?code=${encodeURIComponent(linkCode.code)}`, 'RO') === 204, 'a visitor already let in opens a code link and is let in');
    let opened = await openedOf(linkCode.accessCode.id);
    check(opened.length === 1 && opened[0].via === 'link' && opened[0].country === 'RO', 'the link is recorded as opened, by link, with the country');
    const listed = (await (await req('GET', '/g/codes', { as: admin })).json()).codes.find((c) => c.id === linkCode.accessCode.id);
    check(listed.opened === 1 && listed.uses === 0, 'the list shows it opened, and it spent no use');
    await viaLink(c1, `/?code=${encodeURIComponent(linkCode.code)}`, 'RO');
    check((await openedOf(linkCode.accessCode.id)).length === 1, 'a reload within ten minutes is the same visit');
    await viaLink(c1, '/?code=XENO-AAAAA-AAAAA-AAAAA-AAAAA', 'RO');
    check((await pool.query(`SELECT count(*)::int AS n FROM site_access_code_events WHERE event = 'opened'`)).rows[0].n === 1, 'an unknown code records nothing');
    check(await viaLink(null, `/?code=${encodeURIComponent(linkCode.code)}`, 'RO') === 401, 'a visitor not let in still gets Coming soon (which redeems it)');
    check((await openedOf(linkCode.accessCode.id)).length === 1, 'and a refused request records no opening');

    // which account browsed under the code
    await req('GET', '/g/check', { cookie: c1 });
    // (browserSession is not wired in this harness; record directly through the service it calls)
    const { noteAccount } = await import('../services/siteAccessCodes.js');
    await noteAccount(pool, made.accessCode.id, user); await noteAccount(pool, made.accessCode.id, user);

    // ── revoke and expire ──
    check((await req('POST', `/g/codes/${made.accessCode.id}/revoke`, { as: user })).status === 403, 'a non-admin cannot revoke');
    check((await req('POST', `/g/codes/${made.accessCode.id}/revoke`, { as: admin })).status === 200, 'an admin revokes');
    check(await checkPages(c1) === 401, 'a revoked code refuses the cookie it already issued');
    check((await req('POST', '/g/unlock', { body: { code: made.code } })).status === 401, 'a revoked code cannot be redeemed');
    await pool.query(`UPDATE site_access_codes SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE id = $1`, [pagesOnly.accessCode.id]);
    check(await checkPages(pc) === 401, 'an expired code refuses the cookie it already issued');

    // ── audit ──
    const ev = await (await req('GET', `/g/codes/${made.accessCode.id}/events`, { as: admin })).json();
    const kinds = ev.events.map((e) => e.event);
    check(kinds.includes('created') && kinds.includes('revoked') && kinds.filter((k) => k === 'used_by_account').length === 1, 'the audit has created, revoked and the account once');
    const red = ev.events.find((e) => e.event === 'redeemed');
    check(red && red.country === 'DE', 'a redemption records the country and nothing finer');
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('site_access_codes','site_access_code_events')`)).rows.map((r) => r.column_name);
    check(!cols.some((c) => /ip|addr/.test(c)), 'no column holds an address');
    console.log(`\nsite-access-codes: ${passed} passed`);
  } finally { s.close(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
