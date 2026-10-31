// Corpo › Company in a browser, against a stand-in /api/orgs that keeps the server's rules. No sample company, no invented
// wallet; every change goes to the server; a member reads and cannot change; a personal workspace has no legal entity.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5294, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const WP = '22222222-2222-4222-8222-222222222222', WC = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'u1', username: 'ada', email: 'ada@x.test', display_name: 'Ada', email_verified: true, role: 'user' };
const db = { manage: true, writes: [], reg: [], tax: [], customs: [], financial: [], mandates: [], profile: { legalName: null, legalForm: null, governingRegime: null, registeredOffice: null, centralAdministration: null }, vies: 'unverifiable' };
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
function answer(q) {
  const u = new URL(q.url()), m = q.method(), p = u.pathname; let b = null; try { b = JSON.parse(q.postData() || 'null'); } catch {}
  if (p === '/api/auth/me') return json(200, { success: true, user: USER });
  if (p === '/api/auth/activation-status') return json(200, { success: true, activated: true });
  if (p === '/api/workspaces' && m === 'GET') return json(200, { success: true, workspaces: [{ id: WP, workspace_type: 'personal', name: 'ada', member_role: 'owner', member_count: 1 }, { id: WC, workspace_type: 'company', name: 'Acme', member_role: db.manage ? 'owner' : 'editor', member_count: 3 }] });
  if (p === `/api/workspaces/${WC}/billing`) return json(200, { success: true, billing: { wallet: { available_credits: 4200, pending_credits: 300, is_frozen: false }, seats: 3 } });
  if (p === `/api/workspaces/${WP}/billing`) return json(200, { success: true, billing: { wallet: { available_credits: 10, pending_credits: 0, is_frozen: false }, seats: 1 } });
  if (p === `/api/orgs/${WP}`) return json(200, { success: true, org: { id: WP, kind: 'personal', name: 'ada' }, canManage: false, profile: {}, registrations: [], tax: [], customs: [], financial: [], mandates: [] });
  if (p === `/api/orgs/${WC}` && m === 'GET') return json(200, { success: true, org: { id: WC, kind: 'company', name: 'Acme', status: 'active' }, canManage: db.manage, profile: db.profile, registrations: db.reg, tax: db.tax, customs: db.customs, financial: db.financial, mandates: db.mandates });
  const o = p.match(/^\/api\/orgs\/[^/]+\/(.+)$/);
  if (o) {
    db.writes.push([m, o[1], b]);
    if (o[1] === 'profile') { db.profile = { legalName: b.legalName, legalForm: b.legalForm, governingRegime: b.governingRegime, registeredOffice: b.registeredOffice, centralAdministration: b.centralAdministration }; return json(200, { success: true }); }
    if (o[1] === 'registrations') { if (db.reg.some((r) => r.role === 'primary') && b.role === 'primary') return json(409, { success: false, code: 'conflict', error: 'The company already has a primary registration. Add this as a branch.' }); db.reg.push({ id: 'r' + db.reg.length, jurisdiction: b.jurisdiction, register: b.register, number: b.number, euid: b.euid || null, role: b.role }); return json(200, { success: true, id: 'r' }); }
    if (o[1] === 'tax') { if (b.prefix === 'GR') return json(400, { success: false, code: 'bad_prefix', error: 'Greece’s VAT prefix is EL.' }); db.tax.push({ id: 't' + db.tax.length, scheme: b.scheme, prefix: b.prefix || null, number: b.number, jurisdiction: b.jurisdiction, check: null }); return json(200, { success: true, id: 't' }); }
    if (o[1] === 'mandates') { db.mandates.push({ id: 'm' + db.mandates.length, name: b.name, role: b.role, authority: b.authority, scope: b.scope, dateOfBirth: b.dateOfBirth }); return json(200, { success: true, id: 'm' }); }
    if (/^tax\/[^/]+\/check$/.test(o[1])) { const t = db.tax[0]; t.check = { result: db.vies, consultationNumber: db.vies === 'valid' ? 'WAPI1' : null, at: new Date().toISOString() }; return json(200, { success: true, result: db.vies, name: db.vies === 'valid' ? 'ACME SRL' : null }); }
    if (m === 'DELETE') { const [kind, id] = o[1].split('/'); const k = { registrations: 'reg', tax: 'tax', mandates: 'mandates' }[kind]; db[k] = db[k].filter((x) => x.id !== id); return json(200, { success: true }); }
  }
  return json(200, { success: true, items: [], rows: [], projects: [], conversations: [], tasks: [], views: [], threads: [], agents: [], divisions: [], modes: [], tools: [], skills: [], machines: [], sizes: [], people: [], workflows: [], nodes: [], actions: [], channels: [], dms: [], services: [], connections: [], lends: [], transfers: [], summary: {}, areas: {}, unread: 0, total: 0, sessions: [], accounts: [], exports: [], browsers: [], deletion: null, settings: {} });
}
const b = await puppeteer.launch({ headless: true, protocolTimeout: 120000 });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 950 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.startsWith('/api/')) return q.respond(answer(q)); q.continue(); });
await p.setCookie({ name: 'xeno_csrf', value: 'csrf-test-token', url: base });
const main = () => p.evaluate(() => document.querySelector('#main')?.innerText || '');
const fill = (id, v) => p.evaluate((i, x) => { const d = [...document.querySelectorAll('.xd')].pop(), e = d.querySelector(`[data-f="${i}"] input, [data-f="${i}"] textarea, [data-f="${i}"] select`); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
const submit = async () => { await p.evaluate(() => [...document.querySelectorAll('.xd')].pop().querySelector('[data-xd-submit],[data-xd-ok]').click()); await wait(700); };
const press = async (a, arg) => { await p.evaluate((x, g) => { const e = [...document.querySelectorAll(`#main [data-co2="${x}"]`)].find((y) => !g || y.dataset.arg === g); e.click(); }, a, arg); await wait(500); };
const toast = () => p.evaluate(() => document.getElementById('toast')?.innerText || '');
const dlg = () => p.evaluate(() => [...document.querySelectorAll('.xd')].pop()?.innerText || '');
const open = async (ws) => { await p.goto(`${base}/workspace/corpo/spaces/company${ws ? `?ws=${ws}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(2500); };
try {
  await open(WC);
  let t = await main();
  ok(!/XENO Corp|FZ-LLC|0042117|€4,210/.test(t + await p.evaluate(() => document.body.innerText)), 'no sample company anywhere on the page');
  ok(/Not registered anywhere yet/.test(t) && /No tax numbers yet/.test(t), 'a new company says what it doesn’t have yet');
  ok(/4,200 credits/.test(t) && /300 reserved/.test(t) && /3 seats/.test(t), 'the wallet and seats are the workspace’s own');
  ok(!await p.$('#main [data-co2="topup"]'), 'and nothing here moves money');
  ok(!/Company/.test(await p.evaluate(() => document.getElementById('xp-note')?.textContent || '')), 'the preview line no longer lists Company as sample');

  await press('profile');
  await fill('name', 'Acme SRL'); await fill('form', 'SRL'); await fill('regime', 'Romanian law');
  await fill('o1', 'Str. A 1'); await fill('oC', 'Bucharest'); await fill('oP', '010101');
  await fill('a1', 'Unter den Linden 1'); await fill('aC', 'Berlin'); await fill('aP', '10117'); await fill('aK', 'DE');
  await submit(); await wait(500); t = await main();
  ok(/Acme SRL/.test(t) && /Under Romanian law/.test(t), 'the legal name, form and governing law save');
  ok(/Bucharest/.test(t) && /Berlin/.test(t) && /Germany/.test(t), 'the registered office and where it’s run are separate');

  await press('addReg'); await fill('reg', 'ONRC'); await fill('n', 'J40/1/2026'); await submit(); await wait(400); t = await main();
  ok(/J40\/1\/2026/.test(t) && /Primary/.test(t), 'a first registration is primary');
  await press('addReg');
  ok(await p.evaluate(() => document.querySelector('[data-f="r"] select').value) === 'branch', 'the next one defaults to a branch');
  await fill('j', 'DE'); await fill('reg', 'AG Berlin'); await fill('n', 'HRB 1'); await submit(); await wait(400); t = await main();
  ok(/HRB 1/.test(t) && /Branch/.test(t) && /Germany/.test(t), 'branches list beside it');

  await press('addTax'); await fill('j', 'GR'); await fill('n', '123456789'); await submit(); await wait(400);
  const greek = db.writes.filter((x) => x[1] === 'tax').pop();
  ok(greek[2].prefix === 'EL', 'a Greek VAT number goes with the prefix EL');
  t = await main();
  ok(/EL123456789/.test(t), 'and shows with it');
  await press('check'); await wait(600); t = await main();
  ok(/Couldn’t be checked/.test(t) && !/Not valid/.test(t), 'an unreachable register says it couldn’t check, not that the number is bad');
  ok(/says nothing about the number/.test(await toast()), 'and explains itself');
  db.vies = 'valid'; await press('check'); await wait(600); t = await main();
  ok(/Valid/.test(t) && /consultation WAPI1/.test(t), 'a valid answer shows its consultation number');

  await press('addMandate'); await fill('n', 'Ada Lovelace'); await fill('role', 'Director'); await fill('dob', '1815-12-10'); await submit(); await wait(400); t = await main();
  ok(/Ada Lovelace/.test(t) && /Acts alone/.test(t) && /Director/.test(t), 'who may act is recorded, alone or jointly');
  if (process.env.SHOT_DIR) { await p.evaluate(() => document.getElementById('xp-note')?.remove()); await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'company.png') }); }
  await press('remove', 'registrations|r1'); await submit(); await wait(400);
  ok(db.reg.length === 1 && db.writes.some((x) => x[0] === 'DELETE' && x[1] === 'registrations/r1'), 'removing goes to the server');
  await p.evaluate(() => location.reload()); await wait(3000); t = await main();
  ok(/J40\/1\/2026/.test(t) && !/HRB 1/.test(t), 'it’s all there after a reload');

  db.manage = false; await open(WC); t = await main();
  ok(/Acme SRL/.test(t) && !await p.$('#main [data-co2="addReg"]') && !await p.$('#main [data-co2="profile"]'), 'a member reads it and has nothing to change it with');

  await p.evaluate(() => localStorage.setItem('xw.workspace', JSON.stringify('personal'))); await open(null); t = await main();
  ok(/your personal workspace/.test(t) && !/Registrations/.test(t), 'a personal workspace says it has no legal entity');
  ok(errs.length === 0, 'no page errors (' + JSON.stringify(errs.slice(0, 2)) + ')');
} catch (e) { ok(false, 'threw: ' + String(e.message).split('\n')[0]); }
await b.close(); await server.close();
console.log(fails ? fails + ' check(s) failed' : 'ALL PASS'); process.exitCode = fails ? 1 : 0;
