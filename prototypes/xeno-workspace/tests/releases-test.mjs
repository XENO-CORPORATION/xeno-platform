import { shot } from './shot.mjs';
// releases-test — the release record in the workspace, against a stand-in /api/releases that answers what the real
// service answers for each viewer: a customer's staff reads are 404, and What's new carries only {id, title, body, date}.
// Proves: a customer at /workspace/releases sees What's new and no console, nothing staff-only on the page; staff see
// the console, a deploy at /workspace/releases/deploys/<id>, a feature at /workspace/releases/features/<id> that
// survives refresh and a fresh tab; approving a draft posts the approval; the feature form saves; no page errors.
// The deploy's INTERNAL note: shown to staff on the deploy page, Edit note + Sign off in the header bar, edited in the
// dialog; a customer's page never carries it.
import path from 'node:path'; import { fileURLToPath } from 'node:url';
import {readFile} from 'node:fs/promises';import {createServer} from 'node:http';import puppeteer from 'puppeteer';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const PORT = 5247, base = 'http://127.0.0.1:' + PORT;
let failed = 0;
const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
let STAFF = false;
const USER = () => ({ id: 'u1', username: STAFF ? 'mod' : 'ada', email: 'a@x.test', display_name: STAFF ? 'Mod' : 'Ada', avatar_url: null, email_verified: true, role: STAFF ? 'admin' : 'user' });
const DEP = '11111111-1111-4111-8111-111111111111', FEAT = '22222222-2222-4222-8222-222222222222', NOTE = '33333333-3333-4333-8333-333333333333';
const calls = [];let failOlder=true;
const deployPage=()=>Array.from({length:200},(_,i)=>({...deploy,id:i?`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`:DEP}));
const featurePage=()=>Array.from({length:200},(_,i)=>({...feature,id:i?`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`:FEAT}));
const inote = { id: '44444444-4444-4444-8444-444444444444', deployId: DEP, state: 'draft', version: 1, edited: false, provenance: 'drafted_at_deploy', signedBy: null, signedAt: null, signedVersion: null, revisions: [{ version: 1, editedByKind: 'system' }],
  content: { summary: 'backend @ 33909cb7 — deployed. #859 fix(auth): public bypass', why: '#859: the sign-in page was gated', features: '- Site gate', migrations: '- 20261023100000-release-record.sql — down path: guarded.', risks: '- INTERNAL-RISK-MARKER', switches: '- SITE_GATE unchanged', tests: '- npm run test:site-gate', rollback: 'Rollback point: xeno-platform-backend:rollback' } };
const deploy = { id: DEP, repo: 'xeno-platform', service: 'backend', sha: '33909cb7', previousSha: '13cee868', mode: 'swap', status: 'ok', startedAt: '2026-10-20T15:47:00Z', finishedAt: '2026-10-20T15:49:00Z', deployedBy: 'ops@xeno.test', healthcheck: 'passed /api/ready', rollbackPoint: 'xeno-platform-backend:rollback', prs: [859], migrations: ['20261023100000-release-record.sql'], provenance: 'recorded', evidence: null, pullRequests: [{ number: 859, title: 'fix(auth): public bypass', url: 'https://github.com/XENO-CORPORATION/xeno-platform/pull/859', mergedAt: '2026-10-20T15:00:00Z' }] };
const note = { id: NOTE, featureId: FEAT, title: 'Contact XENO privately', body: 'Ask support from Help.', state: 'draft', draftedByKind: 'agent' };
const feature = { id: FEAT, slug: 'platform:support', title: 'Support (platform)', repo: 'xeno-platform', status: 'live', enabled: { scope: 'none', plans: [], workspaces: [] }, specRef: null, testProof: null, provenance: 'derived', evidence: 'grouped', lastChangeAt: '2026-10-20T00:00:00Z', changes: [{ kind: 'pr', id: '850', title: 'feat(support): lane', url: 'https://github.com/XENO-CORPORATION/xeno-platform/pull/850', at: '2026-10-20T00:00:00Z' }], notes: [note] };

const server = createServer(async(req,res)=>{try{let rel=new URL(req.url,'http://local').pathname.replace(/^\/workspace\/?/,'');if(!/\.[a-z]+$/i.test(rel))rel='index.html';const file=path.resolve(repo,'prototypes/xeno-workspace',rel);if(!file.startsWith(path.join(repo,'prototypes/xeno-workspace')+path.sep))throw new Error('outside workspace');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const br = await puppeteer.launch({headless:true});
const handler = (q) => {
  const u = new URL(q.url());
  if (u.pathname.startsWith('/overview/')) return q.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' });
  if (!u.pathname.startsWith('/api/')) return q.continue();
  const method = q.method(); let b = {}; try { b = q.postData() ? JSON.parse(q.postData()) : {}; } catch { b = {}; }
  calls.push([method, u.pathname, b]);
  const json = (s, body) => q.respond({ status: s, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/auth/me') return json(200, { success: true, user: USER() });
  if (u.pathname === '/api/notifications') return json(200, { success: true, unread: 0, items: [] });
  if (u.pathname === '/api/releases/whats-new') return json(200, { success: true, notes: [{ id: NOTE, title: 'Contact XENO privately', body: 'Ask support from Help.', date: '2026-10-20T16:00:00Z' }] });
  if (u.pathname.startsWith('/api/releases/') && !STAFF) return json(404, { success: false, error: 'Not found', code: 'not_found' });
  if (u.pathname === '/api/releases/summary') return json(200, { success: true, summary: { deploys: 1, lastDeploy: deploy.startedAt, features: 1, changes: 1, drafts: 1, repos: [{ repo: 'xeno-platform', changes: 1 }] } });
  if (u.pathname === '/api/releases/deploys') {if(u.searchParams.has('beforeId')){if(failOlder){failOlder=false;return json(503,{error:'History temporarily unavailable'});}return json(200,{success:true,deploys:[{...deploy,id:'55555555-5555-4555-8555-555555555555',sha:'older-july-14',startedAt:'2026-07-14T14:28:44Z'}]});}return json(200,{success:true,deploys:deployPage()});}
  if (u.pathname === `/api/releases/deploys/${DEP}`) return json(200, { success: true, deploy });
  if (u.pathname === `/api/releases/deploys/${DEP}/internal-note` && method === 'GET') return json(200, { success: true, note: inote });
  if (u.pathname === `/api/releases/deploys/${DEP}/internal-note` && method === 'PATCH') { Object.assign(inote.content, b.content); inote.version += 1; return json(200, { success: true, note: inote }); }
  if (u.pathname === `/api/releases/deploys/${DEP}/internal-note/sign`) { inote.state = 'signed'; inote.signedByName = 'Mod'; inote.signedAt = '2026-10-21T10:00:00Z'; inote.signedVersion = inote.version; return json(200, { success: true, note: inote }); }
  if (u.pathname === '/api/releases/features') return json(200, { success: true, features: u.searchParams.has('offset')?[{...feature,id:'66666666-6666-4666-8666-666666666666',title:'Older January feature',lastChangeAt:'2026-01-06T14:09:25Z'}]:featurePage() });
  if (u.pathname === `/api/releases/features/${FEAT}` && method === 'GET') return json(200, { success: true, feature });
  if (u.pathname === `/api/releases/features/${FEAT}` && method === 'PATCH') { feature.enabled.scope = b.enabledScope; return json(200, { success: true, feature }); }
  if (u.pathname === `/api/releases/notes/${NOTE}/approve`) { note.state = 'approved'; return json(200, { success: true, note }); }
  if (u.pathname === '/api/releases/notes') return json(200, { success: true, notes: [{ ...note, feature: { slug: feature.slug, title: feature.title, status: feature.status } }] });
  const EMPTY = { '/api/forum/threads': { success: true, threads: [], total: 0 }, '/api/forum/me': { success: true, actor: {}, capabilities: {} }, '/api/workspace/summary': { success: true, days: 7, areas: {} }, '/api/workspace/pins': { success: true, items: [] }, '/api/v2/ledger/usage': { rows: [] }, '/api/account/overview': { success: true, overview: { user: USER(), credits: { balance: 0 }, workspace_count: 1 } }, '/api/user-data/settings': { success: true, settings: {} }, '/api/workspaces': { success: true, workspaces: [] }, '/api/chat/projects': { success: true, projects: [] }, '/api/chat/conversations': { success: true, conversations: [] }, '/api/library/assets': { success: true, items: [] }, '/api/billing/overview': { success: true, overview: { credits: { balance: 0 }, subscription: null } }, '/api/tasks': { success: true, tasks: [] } }[u.pathname];
  if (EMPTY) return json(200, EMPTY);
  return json(404, { success: false, error: 'not found' });
};
const open = async () => { const p = await br.newPage(); await p.setViewport({ width: 1400, height: 900 }); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); await p.setRequestInterception(true); p.on('request', handler); return p; };
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const main = (p) => p.$eval('#main', (e) => e.innerText).catch(() => '');
const html = (p) => p.$eval('#main', (e) => e.innerHTML).catch(() => '');
try {
  // a customer
  const c = await open();
  await c.goto(base + '/workspace/releases', { waitUntil: 'domcontentloaded' }); await settle(2000);
  ok(/Contact XENO privately/.test(await main(c)), 'a customer at /workspace/releases sees What’s new');
  const ch = await html(c);
  ok(!/Deploys|Features|Notes to approve|pull\/|platform:support|xeno-platform/.test(ch), 'a customer sees no console, PR, slug or repository');
  await c.goto(base + `/workspace/releases/deploys/${DEP}`, { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(!/INTERNAL-RISK-MARKER|Internal release note|Sign off/.test(await html(c)), 'a customer at a deploy address sees no internal note');
  await c.goto(base + '/workspace/releases/whats-new', { waitUntil: 'domcontentloaded' }); await settle(1800);
  ok(/Ask support from Help/.test(await main(c)), 'What’s new has its own address');
  ok(c.errs.length === 0, 'no page errors for the customer' + (c.errs.length ? ': ' + c.errs.join(' | ') : ''));
  await c.close();

  // staff
  STAFF = true;
  const s = await open();
  await s.goto(base + '/workspace/releases', { waitUntil: 'domcontentloaded' }); await settle(2000); await shot(s, 'releases');
  ok(/Notes to approve/.test(await main(s)) && /Deploys/.test(await main(s)), 'staff see the release console');
  ok(!!(await s.$('#main .topbar .pg-top-tabs [data-rl-go="deploys"]')) && !(await s.$('#main .mview .pg-tabs')), 'the console views are tabs in the header bar, not a row in the body');
  await s.click('#main [data-rl-go="deploys"]'); await settle();
  ok(new URL(s.url()).pathname === '/workspace/releases/deploys' && /33909cb7/.test(await main(s)), 'deploys have their own address and list the deploy');
  await s.click('#main [data-rl-more="deploys"]');await settle();ok(/History temporarily unavailable/.test(await main(s))&&/33909cb7/.test(await main(s)),'an older-page failure preserves current rows and offers retry');
  await s.click('#main [data-rl-more="deploys"]');await settle();ok(/older-july-14/.test(await main(s))&&/201 records shown/.test(await main(s))&&!await s.$('#main [data-rl-more="deploys"]'),'Load older reaches the July deployment and stops at the end');
  await s.click(`#main [data-rl-go="deploys/${DEP}"]`); await settle();
  ok(new URL(s.url()).pathname === `/workspace/releases/deploys/${DEP}` && /passed \/api\/ready/.test(await main(s)) && /#859/.test(await main(s)) && /20261023100000-release-record\.sql/.test(await main(s)), 'a deploy page by id shows healthcheck, PRs and migrations');
  ok(/Internal release note/.test(await main(s)) && /INTERNAL-RISK-MARKER/.test(await main(s)) && /Staff only/.test(await main(s)), 'the deploy page shows its internal note, marked staff only');
  ok(!!(await s.$('#main .topbar .pg-top-acts [data-rl-inote="edit"]')) && !!(await s.$('#main .topbar .pg-top-acts [data-rl-inote="sign"]')), 'Edit note and Sign off sit in the header bar');
  await s.click('#main .topbar [data-rl-inote="edit"]'); await settle(400);
  ok(!!(await s.$('.xd-sh[role="dialog"] #xdf-risks')), 'the internal note is edited in the workspace dialog');
  await s.$eval('.xd-sh[role="dialog"] #xdf-risks', (e) => { e.value = '- watch the mail queue'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await s.$eval('.xd-sh[role="dialog"] form', (f) => f.requestSubmit()); await settle(900);
  ok(calls.some(([m, pth, b]) => m === 'PATCH' && pth === `/api/releases/deploys/${DEP}/internal-note` && b.content && b.content.risks === '- watch the mail queue' && b.expectedVersion === 1), 'saving the dialog patches the note with the version it was read at');
  await s.click('#main .topbar [data-rl-inote="sign"]'); await settle(900);
  ok(calls.some(([m, pth]) => m === 'POST' && pth === `/api/releases/deploys/${DEP}/internal-note/sign`) && /Signed off by Mod/.test(await main(s)), 'Sign off posts the sign-off and the page says who signed');
  await s.goto(base+'/workspace/releases/features',{waitUntil:'domcontentloaded'});await settle(1500);await s.click('#main [data-rl-more="features"]');await settle();ok(/Older January feature/.test(await main(s))&&/201 records shown/.test(await main(s)),'feature history loads beyond its first 200 records');
  await s.goto(base + `/workspace/releases/features/${FEAT}`, { waitUntil: 'domcontentloaded' }); await settle(2000); await shot(s, 'releases-feature');
  ok(/Support \(platform\)/.test(await main(s)) && /Draft by an agent/.test(await main(s)), 'a feature page by id shows its notes, the agent draft marked as a draft');
  ok(!!(await s.$('#main .topbar .pg-top-acts [data-rl-create="note"]')) && !(await s.$('#main .mview [data-rl-form="note"]')), 'New customer note sits right in the header bar; no note form is stacked in the body');
  await s.click('#main .topbar [data-rl-create="note"]'); await settle(400);
  ok(!!(await s.$('.xd-sh[role="dialog"] #xdf-title')), 'a customer note is drafted in the workspace dialog');
  await s.keyboard.press('Escape'); await settle(300);
  await s.reload({ waitUntil: 'domcontentloaded' }); await settle(2000);
  ok(/Support \(platform\)/.test(await main(s)), 'refresh lands on the same feature');
  const s2 = await open(); await s2.goto(base + `/workspace/releases/features/${FEAT}`, { waitUntil: 'domcontentloaded' }); await settle(2000);
  ok(/Support \(platform\)/.test(await main(s2)), 'a fresh tab lands on the same feature'); await s2.close();
  await s.click(`#main [data-rl-approve="${NOTE}"]`); await settle();
  ok(calls.some(([m, pth]) => m === 'POST' && pth === `/api/releases/notes/${NOTE}/approve`), 'Approve posts the approval');
  await s.select('#main [data-rl-form="feature"] select[name="enabledScope"]', 'all');
  await s.click('#main [data-rl-form="feature"] button[type="submit"]'); await settle();
  ok(calls.some(([m, pth, b]) => m === 'PATCH' && pth === `/api/releases/features/${FEAT}` && b.enabledScope === 'all'), 'the feature form saves where it is enabled');
  await s.goBack(); await settle(1500);
  ok(new URL(s.url()).pathname.startsWith('/workspace/releases'), 'Back stays in the release record');
  ok(s.errs.length === 0, 'no page errors for staff' + (s.errs.length ? ': ' + s.errs.join(' | ') : ''));
} finally {
  await br.close(); await new Promise(r=>server.close(r));
}
console.log(failed ? `${failed} FAILED` : 'releases-test: all passed');
process.exit(failed ? 1 : 0);
