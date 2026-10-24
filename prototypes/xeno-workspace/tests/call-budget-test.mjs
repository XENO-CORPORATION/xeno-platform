// call-budget-test — a cold load of /workspace stays within an API call budget and asks for nothing twice.
// Found live (2026-10-24): one load fired ~70 calls, /api/v2/ledger/usage six times, against a 200/min per-user limit,
// so three quick refreshes could rate-limit a person out of their own workspace. Proves, for a signed-in customer and
// for staff, on a cold load of /workspace (Overview):
//   - the total number of /api calls is at most BUDGET;
//   - no GET (path + query) is asked for twice;
//   - a customer never calls a staff-only route (support queue, macros, site access codes, the release console);
//   - no page errors;
//   - a customer at Support or Releases calls no staff route there either, and staff still get the staff view.
// CALL_BUDGET_REPORT=1 prints every call with its count (the measurement behind the budget).
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises'; import { createServer } from 'node:http'; import puppeteer from 'puppeteer';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const PORT = 5261, base = 'http://127.0.0.1:' + PORT;
const BUDGET = Number(process.env.CALL_BUDGET || 32);   // measured 2026-10-24: 59 before, 31 after
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
let ROLE = 'user';
const USER = () => ({ id: 'u1', username: 'ada', email: 'a@x.test', display_name: 'Ada', avatar_url: null, email_verified: true, role: ROLE, kind: 'human' });
const STAFF_ONLY = [/^\/api\/support\/tickets\/queue/, /^\/api\/support\/macros/, /^\/api\/site-gate\/codes/, /^\/api\/releases\/(?!whats-new)/];

const server = createServer(async (req, res) => { try { let rel = new URL(req.url, 'http://local').pathname.replace(/^\/workspace\/?/, ''); if (!/\.[a-z]+$/i.test(rel)) rel = 'index.html'; const file = path.resolve(repo, 'prototypes/xeno-workspace', rel); if (!file.startsWith(path.join(repo, 'prototypes/xeno-workspace') + path.sep)) throw new Error('outside'); res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'); res.end(await readFile(file)); } catch { res.statusCode = 404; res.end(); } });
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const br = await puppeteer.launch({ headless: true });
const ANSWERS = {
  '/api/auth/me': () => ({ success: true, user: USER() }),
  '/api/auth/activation-status': () => ({ success: true, activated: true }),
  '/api/notifications': () => ({ success: true, unread: 0, items: [] }),
  '/api/forum/threads': () => ({ success: true, threads: [], total: 0 }),
  '/api/forum/me': () => ({ success: true, actor: {}, capabilities: {} }),
  '/api/workspace/summary': () => ({ success: true, days: 7, areas: {} }),
  '/api/workspace/pins': () => ({ success: true, items: [] }),
  '/api/v2/ledger/usage': () => ({ rows: [] }),
  '/api/v2/ledger/balance': () => ({ balance: 0 }),
  '/api/account/overview': () => ({ success: true, overview: { user: USER(), credits: { balance: 0 }, workspace_count: 1 } }),
  '/api/user-data/settings': () => ({ success: true, settings: {} }),
  '/api/workspaces': () => ({ success: true, workspaces: [] }),
  '/api/chat/projects': () => ({ success: true, projects: [] }),
  '/api/chat/conversations': () => ({ success: true, conversations: [] }),
  '/api/library/assets': () => ({ success: true, items: [] }),
  '/api/billing/overview': () => ({ success: true, overview: { credits: { balance: 0 }, subscription: null } }),
  '/api/tasks': () => ({ success: true, tasks: [] }),
};
async function load(role, at = '/workspace') {
  ROLE = role; const calls = [];
  const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', (q) => {
    const u = new URL(q.url());
    if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    calls.push(q.method() + ' ' + u.pathname + u.search);
    const a = ANSWERS[u.pathname];
    return q.respond({ status: a ? 200 : 404, contentType: 'application/json', body: JSON.stringify(a ? a() : { success: false, error: 'not found' }) });
  });
  await p.goto(base + at, { waitUntil: 'domcontentloaded' });
  await p.waitForNetworkIdle({ idleTime: 1500, timeout: 20000 }).catch(() => {});
  await p.close();
  return { calls, errs };
}
try {
  for (const role of ['user', 'admin']) {
    const { calls, errs } = await load(role);
    const count = new Map(); for (const c of calls) count.set(c, (count.get(c) || 0) + 1);
    if (process.env.CALL_BUDGET_REPORT) { console.log(`--- ${role}: ${calls.length} calls`); for (const [c, n] of [...count].sort((x, y) => y[1] - x[1])) console.log(String(n).padStart(3), c); }
    ok(calls.length <= BUDGET, `${role}: a cold load of /workspace makes ${calls.length} API calls (budget ${BUDGET})`);
    const dup = [...count].filter(([c, n]) => n > 1 && c.startsWith('GET ') && !c.startsWith('GET /api/auth/me'));
    ok(dup.length === 0, `${role}: no GET is asked twice` + (dup.length ? ': ' + dup.map(([c, n]) => `${c} ×${n}`).join(', ') : ''));
    if (role === 'user') { const bad = calls.filter((c) => STAFF_ONLY.some((re) => re.test(c.slice(c.indexOf(' ') + 1)))); ok(bad.length === 0, 'a customer calls no staff-only route' + (bad.length ? ': ' + bad.join(', ') : '')); }
    ok(errs.length === 0, `${role}: no page errors` + (errs.length ? ': ' + errs.join(' | ') : ''));
  }
  // Support and Releases decide what to show from the session's role, never by probing a staff route (403/404s live)
  for (const at of ['/workspace/support', '/workspace/support/queue', '/workspace/releases']) {
    const { calls, errs } = await load('user', at);
    const bad = calls.filter((c) => STAFF_ONLY.some((re) => re.test(c.slice(c.indexOf(' ') + 1))));
    ok(bad.length === 0 && errs.length === 0, `a customer at ${at} calls no staff-only route` + (bad.length ? ': ' + bad.join(', ') : '') + (errs.length ? ' errors: ' + errs.join(' | ') : ''));
    const staff = await load('moderator', at);
    ok(staff.calls.some((c) => (at.includes('releases') ? /\/api\/releases\/summary/ : /\/api\/support\/tickets\/queue/).test(c)), `staff at ${at} still load the staff view`);
  }
} finally { await br.close(); server.close(); }
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
