// Areas are honest, and Publish is XENO Post for real.
//   1. Every area whose rows come from nav.js (not from a platform-*.js module registered in XENO_ZONE_LIVE) shows
//      "Preview — sample data" on its page and in its sidebar; its made-up rail count is not shown. The list is
//      DERIVED from XENO_MODE_ZONES and XENO_ZONE_LIVE at run time, never typed here.
//   2. Social › Publish: compose a draft → schedule it → an agent's proposed time is approved (two clicks: arm, then
//      confirm) — against a stand-in /api/publish. Nothing reaches xeno-post or any social network.
import { createRequire } from 'node:module'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..');
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const { createServer } = await import('vite'); const { xenoWorkspace } = await import('../../../scripts/vite-workspace.mjs');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const PORT = 5197, base = `http://127.0.0.1:${PORT}`;
const server = await createServer({ configFile: false, root: repo, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [xenoWorkspace(repo)], server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const b = await puppeteer.launch({ headless: true, protocolTimeout: 60000 });
const USER = { id: 7, username: 'test-person', email: 'test@example.test', display_name: 'Test Person', avatar_url: null, email_verified: true };
const soon = (h) => new Date(Date.now() + h * 3600000).toISOString();
const db = { calls: [], linked: true, posts: [{ id: 'p-old', state: 'published', text: 'Already out', media: 0, scheduledFor: null, targets: [] }], approvals: [{ kind: 'proposal', id: '00000000-0000-4000-8000-0000000000a1', postId: 'p-old', proposedFor: soon(30), requestedAt: soon(-1) }] };

async function open(hash) {
  const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.setRequestInterception(true);
  p.on('request', async (q) => { const u = new URL(q.url()); const json = (body, status = 200) => q.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!u.pathname.startsWith('/api/')) return q.continue();
    const sent = q.postData() ? JSON.parse(q.postData()) : null;
    if (u.pathname.startsWith('/api/publish')) db.calls.push([q.method(), u.pathname, sent]);
    if (u.pathname === '/api/auth/me') return json({ success: true, user: USER });
    if (u.pathname === '/api/publish/status') return json({ success: true, configured: true, linked: db.linked, workspaceId: 'w1', postWorkspaceId: 'pw1' });
    if (u.pathname === '/api/publish/channels') return json({ success: true, channels: [{ id: 'ch1', platform: 'x', name: 'XENO', handle: '@xeno', status: 'active' }] });
    if (u.pathname === '/api/publish/posts' && q.method() === 'GET') return json({ success: true, posts: db.posts });
    if (u.pathname === '/api/publish/posts' && q.method() === 'POST') { const np = { id: 'p-' + db.posts.length, state: 'draft', text: sent.text, media: sent.media.length, scheduledFor: null, targets: [] }; db.posts.unshift(np); return json({ success: true, post: np }); }
    let m = u.pathname.match(/^\/api\/publish\/posts\/([^/]+)\/schedule$/);
    if (m) { const p0 = db.posts.find((x) => x.id === m[1]); Object.assign(p0, { state: 'queued', scheduledFor: sent.at }); return json({ success: true, scheduled: true, post: p0 }); }
    if (u.pathname === '/api/publish/approvals') return json({ success: true, items: db.approvals });
    m = u.pathname.match(/^\/api\/publish\/approvals\/([a-z]+)\/([^/]+)$/);
    if (m) { if (sent.approve && sent.confirm !== true) return json({ success: false, code: 'confirmation_required', error: 'Confirm' }, 428); db.approvals = db.approvals.filter((a) => a.id !== m[2]); return json({ success: true, decided: sent.approve ? 'confirmed' : 'declined' }); }
    if (u.pathname === '/api/publish/inbox') return json({ success: true, conversations: [{ id: 'cv1', from: 'Ada', snippet: 'Loved it', at: soon(-2) }] });
    if (u.pathname.startsWith('/api/publish/')) return json({ success: false, error: 'unexpected ' + u.pathname }, 500);
    if (u.pathname === '/api/library/assets') return json({ success: true, items: [{ id: 'f-1', source_id: 'asset-1', name: 'Hero.png', mime_type: 'image/png' }] });
    if (u.pathname === '/api/notifications') return json({ success: true, unread: 0, items: [] });
    return json({ success: false, error: 'not found' }, 404); });
  await p.goto(base + '/workspace/' + hash, { waitUntil: 'domcontentloaded' }); await wait(1800);
  return { p, errs };
}
const nav = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await wait(450); };

try {
  // ── 1. honesty, every area
  { const { p, errs } = await open('#/social/z/publish');
    // every source of illustrative rows the workspace still has, minus what a platform module made real
    const zones = await p.evaluate(() => { const live = window.XENO_ZONE_LIVE || {}, out = new Map();
      for (const [m, zs] of Object.entries(window.XENO_MODE_ZONES)) for (const z of zs) if (z.work) out.set(m + '.' + z.id, z.work[1].map((r) => r[0]));
      for (const [k, A] of Object.entries(window.XENO_PG_AREAS || {})) out.set(k, [...(out.get(k) || []), ...A.rows.map((r) => r[0])]);
      return [...out].map(([k, rows]) => ({ m: k.split('.')[0], id: k.split('.').slice(1).join('.'), live: !!live[k], rows })); });
    const sample = zones.filter((z) => !z.live);
    ok(sample.length >= 3 && zones.some((z) => z.m === 'social' && z.id === 'publish' && z.live), `derived from code: ${zones.length} areas with sample rows in the source, ${sample.length} not yet live (${sample.map((z) => z.m + '.' + z.id).join(', ')}); Publish is live`);
    let unmarked = [], shown = 0;
    for (const z of sample) {
      await nav(p, `#/${z.m}/z/${z.id}`);
      const r = await p.evaluate((rows) => { const main = document.getElementById('main'), panel = document.getElementById('panel');
        const shows = (el) => rows.some((t) => el.textContent.includes(t));
        return { mainRows: shows(main), mainMark: !!main.querySelector('[data-sample-badge]'), panelRows: shows(panel), panelMark: !!panel.querySelector('[data-sample-badge]') }; }, z.rows);
      if (r.mainRows || r.panelRows) shown++;
      if ((r.mainRows && !r.mainMark) || (r.panelRows && !r.panelMark)) unmarked.push(`${z.m}.${z.id}`);
    }
    ok(shown >= 1 && unmarked.length === 0, `every sample area that shows rows carries "Preview — sample data" (${shown} showed rows; unmarked: ${unmarked.join(', ') || 'none'})`);
    await nav(p, '#/corpo/z/analytics');
    const an = await p.evaluate(() => { const t = document.getElementById('main').textContent; return { money: t.includes('€42k this month'), mark: /Preview — sample data/.test(t) }; });
    ok(!an.money || an.mark, 'the fake "€42k this month" is never shown without the sample mark');
    await nav(p, '#/social/z/message');
    const badge = await p.evaluate(() => [...document.querySelectorAll('#rail [data-zone]')].filter((x) => x.dataset.zone === 'message').map((x) => x.querySelector('.cnt')?.textContent || '').join(''));
    ok(badge === '', `a sample area's made-up rail count is not shown on the platform (${badge || 'none'})`);
    ok(!errs.length, `no page errors (${errs.join(' | ')})`);
    await p.close(); }

  // ── 2. Publish: compose → schedule → approve
  { db.calls.length = 0;
    const { p, errs } = await open('#/social/z/publish');
    const s0 = await p.evaluate(() => ({ page: document.querySelector('[data-pub-page]')?.dataset.pubPage, mark: !!document.querySelector('#main [data-sample-badge]'), sampleRow: document.body.textContent.includes('Launch week thread'), channels: document.querySelectorAll('[data-pub-pick]').length, inbox: document.querySelector('[data-pub-inbox]')?.textContent || '', badge: [...document.querySelectorAll('#rail [data-zone="publish"] .cnt')].map((x) => x.textContent).join('') }));
    ok(s0.page === 'ready' && !s0.mark && !s0.sampleRow, `Publish is the real thing: no sample rows, no sample mark (${JSON.stringify(s0)})`);
    ok(s0.channels === 1 && /Ada/.test(s0.inbox), 'channels and the inbox come from XENO Post');
    ok(s0.badge === '1', `the rail count is the real number waiting for approval (${s0.badge})`);
    // compose a draft with a Storage image
    await p.type('[data-pub-text]', 'Launch day — it is live');
    await p.click('[data-pub-pick="ch1"]'); await p.evaluate(() => { document.querySelector('.pub-media').open = true; }); await p.click('[data-pub-media="asset-1"]');
    await p.click('[data-pub-draft]'); await wait(600);
    const draft = db.calls.find((c) => c[0] === 'POST' && c[1] === '/api/publish/posts');
    ok(draft && draft[2].text === 'Launch day — it is live' && draft[2].channelIds.join() === 'ch1' && draft[2].media.join() === 'asset-1' && /^ws-/.test(draft[2].requestKey), `the draft is sent with its channel, Storage file and a request key (${JSON.stringify(draft && draft[2])})`);
    ok(!('scheduledFor' in (draft ? draft[2] : {})), 'saving a draft sends no time');
    // schedule it
    const pid = await p.evaluate(() => document.querySelector('[data-pub-post][data-state="draft"]')?.dataset.pubPost);
    const local = new Date(Date.now() + 2 * 3600000); local.setSeconds(0, 0);
    const v = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    await p.evaluate((id, val) => { const i = document.querySelector(`[data-pub-at="${id}"]`); i.value = val; }, pid, v);
    await p.click(`[data-pub-schedule="${pid}"]`); await wait(600);
    const sch = db.calls.find((c) => c[1] === `/api/publish/posts/${pid}/schedule`);
    ok(sch && Date.parse(sch[2].at) === local.getTime(), `scheduling sends the chosen time (${sch && sch[2].at})`);
    ok(await p.evaluate((id) => document.querySelector(`[data-pub-post="${id}"]`)?.dataset.state === 'queued', pid), 'the post now reads as scheduled');
    // approve the agent's proposed time: first click only arms
    const before = db.calls.length;
    await p.click('[data-pub-arm="approve"]'); await wait(300);
    ok(db.calls.length === before && await p.evaluate(() => !!document.querySelector('[data-pub-do="approve"][data-pub-confirm="1"]')), 'the first click on Approve sends nothing and asks to confirm');
    await p.click('[data-pub-do="approve"]'); await wait(600);
    const ap = db.calls.find((c) => c[0] === 'POST' && /\/api\/publish\/approvals\/proposal\//.test(c[1]));
    ok(ap && ap[2].approve === true && ap[2].confirm === true, 'the confirmed click approves with confirm: true');
    ok(await p.evaluate(() => !!document.querySelector('[data-pub-noapprovals]')), 'the approvals queue is empty afterwards');
    ok(!db.calls.some((c) => /\/publish$|\/retract$/.test(c[1])), 'nothing was published or retracted');
    ok(!errs.length, `no page errors (${errs.join(' | ')})`);
    await p.close(); }

  // ── 3. not linked: the honest state, never sample rows
  { db.linked = false; const { p } = await open('#/social/z/publish');
    const s = await p.evaluate(() => ({ st: document.querySelector('[data-pub-state]')?.dataset.pubState, sample: document.body.textContent.includes('Launch week thread') }));
    ok(s.st === 'not-linked' && !s.sample, `an unlinked workspace says so and shows no sample posts (${JSON.stringify(s)})`);
    await p.close(); }
} finally { await b.close(); await server.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
