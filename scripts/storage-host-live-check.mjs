// storage-host-live-check — after a deploy, checks storage.xenosystem.ai from OUTSIDE (no account, no credential):
//   1. /health answers, and an anonymous page is the gate page (with its silent sign-in), never the old redirect;
//   2. the host sign-in starts as client xeno-storage-web with PKCE, and the silent start asks with prompt=none;
//   3. xenosystem.ai's authorize endpoint accepts that client and its one callback (a signed-out request comes back to
//      the callback with login_required, never "unknown client" or "redirect_uri mismatch");
// The served bytes are read on the box (the workspace files are behind the site gate): see the deploy record.
// The one thing it cannot prove: that a person signed in on xenosystem.ai lands signed in here with no click. That
// needs a real signed-in browser (the owner's or a team member's), never a test account made for it.
//   node scripts/storage-host-live-check.mjs
const HOST = 'https://storage.xenosystem.ai';
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const get = (url, opts = {}) => fetch(url, { redirect: 'manual', headers: { 'user-agent': 'xeno-storage-live-check' }, ...opts });

const health = await get(`${HOST}/health`);
ok(health.status === 200 && (await health.text()).trim() === 'ok', `/health answers ok (${health.status})`);
const page = await get(`${HOST}/`);
const pageText = await page.text();
ok(page.status !== 302 || !/workspace\/corpo\/apps\/storage/.test(page.headers.get('location') || ''), `the old redirect is gone (${page.status} ${page.headers.get('location') || ''})`);
ok(page.status === 200 && /silent-signin/.test(pageText) && /storage/.test(pageText.match(/\^\(([a-z|]+)\)\\\./)?.[1] || ''), 'signed out, / is the gate page, and its silent sign-in includes this host');
ok(/noindex/.test(page.headers.get('x-robots-tag') || ''), `kept out of search (${page.headers.get('x-robots-tag')})`);

const start = await get(`${HOST}/api/auth/host/start?silent=1&return=%2Frecent`);
const to = new URL(start.headers.get('location') || 'about:blank');
ok(start.status === 302 && to.origin === 'https://xenosystem.ai' && to.pathname === '/api/oauth2/authorize', `the silent start goes to the XENO sign-in (${start.status} ${to.origin}${to.pathname})`);
ok(to.searchParams.get('client_id') === 'xeno-storage-web' && to.searchParams.get('code_challenge_method') === 'S256' && to.searchParams.get('prompt') === 'none'
  && to.searchParams.get('redirect_uri') === `${HOST}/api/auth/host/callback`, `as xeno-storage-web, PKCE S256, prompt=none, back to this host (${to.searchParams.get('client_id')}, ${to.searchParams.get('prompt')})`);
// The provider answers a signed-out prompt=none from its sign-in page's own script (the session lives in that page's
// storage, so only the browser can tell): followed here in a real browser, signed out, from storage.'s front door. It must
// reach xenosystem.ai's authorize as this client, come back to this host's callback with login_required, and stop on the
// gate page with no loop (the page asks once per tab every ten minutes).
{
  const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
  const puppeteer = require('puppeteer');   // its own throwaway profile, removed when the browser closes
  const br = await puppeteer.launch({ headless: true });
  try {
    const p = await br.newPage(); const hops = [];
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) hops.push(f.url()); });
    await p.goto(`${HOST}/recent`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    const authz = hops.find((u) => u.startsWith('https://xenosystem.ai/api/oauth2/authorize'));
    const cb = hops.find((u) => u.startsWith(`${HOST}/api/auth/host/callback`));
    const end = p.url(), title = await p.title();
    console.log('  hops:', hops.map((u) => u.replace(/\?.*/, '')).join(' → '));
    ok(!!authz && new URL(authz).searchParams.get('client_id') === 'xeno-storage-web' && new URL(authz).searchParams.get('prompt') === 'none', 'signed out, the browser asks xenosystem.ai silently as xeno-storage-web');
    ok(!!cb && /login_required/.test(cb), `and xenosystem.ai answers this host's callback with login_required (${cb ? new URL(cb).searchParams.get('error') : 'no callback'})`);
    ok(end.startsWith(HOST) && hops.filter((u) => u.startsWith('https://xenosystem.ai/api/oauth2/authorize')).length === 1, `it stops on this host, asked once, no loop (${end.replace(/\?.*/, '')}, "${title}")`);
  } finally { await br.close(); }
}

console.log(failed ? `${failed} FAILED` : 'storage-host-live: all passed'); process.exit(failed ? 1 : 0);
