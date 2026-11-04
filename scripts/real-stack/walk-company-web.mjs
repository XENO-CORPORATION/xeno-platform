// Walk 8: XENO Company's dashboard in a real browser, on the visitor's own session, against this real stack.
// Serves xeno-company's production build the way nginx does (/company/*, one page for every address, /api to the backend),
// on its own port. Needs `npx vite build` in xeno-company/apps/web, and XENO_COMPANY_DIR if the checkout isn't beside this repo.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { browser, page, ok, failures, newPerson, text, type, clickText, wait, SITE, here } from './lib.mjs';
const company = process.env.XENO_COMPANY_DIR ? path.resolve(process.env.XENO_COMPANY_DIR) : path.resolve(here, '../../../xeno-company');
const dist = path.join(company, 'apps/web/dist'), PORT = 5184, HOST = `http://localhost:${PORT}`, TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, HOST);
  if (url.pathname.startsWith('/api/')) {
    const up = http.request({ host: '127.0.0.1', port: 8091, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:5183', origin: SITE } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    return req.pipe(up);
  }
  if (!url.pathname.startsWith('/company')) { res.writeHead(302, { location: SITE + req.url }); return res.end(); }
  const asset = /^\/company\/(assets\/.+|favicon\.svg)$/.exec(url.pathname)?.[1];
  const file = path.join(dist, asset ?? 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const b = await browser(); const p = await page(b);
const pick = (label, v) => p.select(`select[aria-label="${label}"]`, v);
const field = (label, v) => type(p, `input[aria-label="${label}"]`, v);
try {
  ok(fs.existsSync(path.join(dist, 'index.html')), 'a production build of the dashboard exists', dist);
  await p.goto(`${HOST}/company/some-link`, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(2500);
  ok(/\/login\?returnUrl=%2Fcompany%2Fsome-link/.test(p.url()), 'signed out, it goes to sign-in and remembers the address', p.url());

  await newPerson(p, 'Cleo');
  await p.goto(`${HOST}/company/`, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(2000);
  ok(/XENO/.test(await text(p)) && !/In-memory preview/.test(await text(p)), 'signed in, the dashboard opens on the same session, and it is not the preview', (await text(p)).slice(0, 200));
  ok(new RegExp('/company/[0-9a-f-]{36}$').test(p.url()), 'and the address names the workspace it opened by id', p.url());

  await clickText(p, 'New company'); await wait(400);
  await field('Company name', `Northwind ${Date.now()}`); await p.click('input[aria-label="This is a registered legal entity"]');
  await pick('Country', 'US'); await wait(200);
  await field('Legal form', 'LLC'); await field('Legal name', 'Northwind Holdings LLC'); await field('Tax or company number', '12-3456789');
  await field('Street', '1 Main Street'); await field('City', 'Austin');
  await clickText(p, 'Create'); await wait(2500);
  const body = await text(p);
  ok(/United States/.test(body) && /As stated by the company/.test(body), 'a company in the United States is founded through the real page, on what it states', body.slice(0, 400));
  ok(!/Verify with register/.test(body), 'nothing offers a register that doesn’t exist');
  const orgUrl = p.url();
  ok(new RegExp('/company/[0-9a-f-]{36}$').test(orgUrl), 'the address follows to the new company', orgUrl);

  await clickText(p, /^Issue$/); await wait(500);
  await field('Buyer name', 'A Client'); await field('Buyer city', 'Berlin'); await pick('Buyer country', 'DE');
  await field('Item', 'Design'); await field('Unit price', '100.00'); await pick('Currency', 'USD');
  await field('Why no tax is charged', 'Export of services');
  await clickText(p, 'Issue invoice'); await wait(2500);
  ok(/100\.00 USD/.test(await text(p)), 'it issues an invoice in dollars, a write that needs the session’s CSRF token', (await text(p)).slice(0, 500));

  await p.reload({ waitUntil: 'networkidle2' }); await wait(2000);
  ok(p.url() === orgUrl && /100\.00 USD/.test(await text(p)) && /Northwind/.test(await text(p)), 'refresh lands on the same company, and the invoice is really stored', p.url());

  // Measured in the page, because only real layout can show this: the roster once collapsed to 2 pixels with every test green.
  const hit = await p.evaluate(() => { const a = document.querySelector('tr.xc-row-click .xc-avatar'); const r = a.getBoundingClientRect(); return a.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  ok(hit, 'the roster is really on screen, and a person can be clicked');
  await p.click('tr.xc-row-click td:first-child .xc-avatar'); await wait(800);
  const personUrl = p.url();
  ok(/\/people\//.test(personUrl), 'opening a person gives them an address', personUrl);
  await p.reload({ waitUntil: 'networkidle2' }); await wait(2000);
  ok(p.url() === personUrl, 'and refresh keeps it', p.url());
  await p.goBack({ waitUntil: 'networkidle2' }).catch(() => {}); await wait(1000);
  ok(p.url() === orgUrl, 'Back returns to the company', p.url());
  ok(!p.errs.length, 'no script errors', p.errs.join(' | '));
  ok(!p.bad.length, 'no server errors', p.bad.join(' | '));
} catch (e) { ok(false, 'walk crashed', e.stack); }
finally { await b.close(); server.close(); process.exitCode = failures() ? 1 : 0; }
