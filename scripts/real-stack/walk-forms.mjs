// Walk 3: Corpo › Forms. A person makes a form, opens it, makes a PUBLIC link; a stranger with no account and no
// JavaScript answers it; the person sees the response, turns it into a customer, and revokes the link, which then stops working.
import { browser, page, go, text, clickText, shot, ok, failures, wait, sql, newPerson, submit, dialog } from './lib.mjs';
const flat = (s, n = 300) => String(s).slice(0, n).replace(/\n/g, ' | ');
const b = await browser(); const p = await page(b);
try {
  await newPerson(p, 'Fran');
  await go(p, '/workspace/corpo/spaces/forms', 2500);
  ok(!!(await clickText(p, 'New form')), 'New form can be pressed'); await wait(900);
  await p.type('#xdf-title', 'Event sign-up'); await submit(p); await wait(2000);
  ok(/\/forms\/[0-9a-f-]{36}/.test(p.url()), 'a new form has its own address', p.url());
  const formId = p.url().split('/forms/')[1].split('/')[0];

  ok(!!(await clickText(p, 'Open the form')), 'Open the form can be pressed'); await wait(1500);
  ok(/taking responses/.test(await text(p, '#main')), 'the form says it is open', flat(await text(p, '#main')));
  await clickText(p, 'Share', '[data-fm-tab]'); await wait(1200);
  ok(!!(await clickText(p, 'New public link')), 'New public link can be pressed'); await wait(800);
  console.log('confirm:', flat(await dialog(p), 160));
  await submit(p); await wait(1500);
  const url = await p.$eval('[data-fm-shown] input', (x) => x.value).catch(() => '');
  ok(url.includes('/api/forms/public/'), 'the public link is shown once to copy', url);
  console.log('public link:', url);
  await shot(p, 'forms-share');

  // ---- a stranger, no account, no JavaScript ----
  const ctx = await b.createBrowserContext(); const s = await ctx.newPage(); await s.setJavaScriptEnabled(false);
  const target = url.replace(/^https?:\/\/[^/]+/, 'http://localhost:5183');
  const res = await s.goto(target, { waitUntil: 'domcontentloaded' });
  ok(res.status() === 200, 'the public link opens for someone signed out', `${res.status()} ${target}`);
  console.log('stranger sees:', flat(await s.evaluate(() => document.body.innerText), 400));
  console.log('stranger fields:', await s.$$eval('form input, form textarea, form select', (n) => n.map((x) => `${x.type}|${x.name}|${x.required}`)));
  for (const f of await s.$$('form input, form textarea')) {
    // "Visible" the way a person means it: on screen and bigger than a pixel (the spam trap sits at -10000px, 1px wide).
    const [t, n, hidden] = await f.evaluate((x) => { const r = x.getBoundingClientRect(); return [x.type, x.name, r.width <= 1 || r.height <= 1 || r.right < 0 || r.bottom < 0]; });
    if (t === 'hidden' || t === 'submit' || hidden) continue;
    if (t === 'checkbox' || t === 'radio') { await f.click(); continue; }
    await f.type(t === 'email' ? 'stranger@example.test' : t === 'number' ? '3' : t === 'url' ? 'https://example.test' : t === 'tel' ? '+15550100' : 'Pat Stranger', { delay: 3 });
  }
  await Promise.all([s.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), s.click('form button[type=submit], form input[type=submit]')]);
  const done = await s.evaluate(() => document.body.innerText);
  console.log('after submit:', flat(done));
  ok(sql(`SELECT count(*) FROM form_responses WHERE form_id='${formId}' AND NOT spam`) === '1', 'the stranger’s answer is stored, and not as spam', flat(done));

  // ---- back with the person ----
  await go(p, `/workspace/corpo/spaces/forms/${formId}/responses`, 2500);
  const resp = await text(p, '#main'); console.log('responses tab:', flat(resp, 500));
  ok(/Pat Stranger|stranger@example\.test/.test(resp), 'the person sees the stranger’s answer');
  ok(!!(await clickText(p, /Add to Customers/)), 'a response can become a customer'); await wait(2000);
  ok(sql(`SELECT count(*) FROM crm_contacts WHERE email='stranger@example.test'`) === '1', 'the customer exists in Customers');
  await shot(p, 'forms-responses');

  // ---- revoke, and the link stops working ----
  await go(p, `/workspace/corpo/spaces/forms/${formId}/share`, 2000);
  ok(!!(await clickText(p, 'Revoke')), 'the link can be revoked'); await wait(1500);
  const after = await s.goto(target, { waitUntil: 'domcontentloaded' });
  const gone = await s.evaluate(() => document.body.innerText);
  ok(after.status() >= 400 || /no longer|not available|revoked|closed/i.test(gone), 'a revoked link no longer takes answers', `${after.status()} ${flat(gone, 200)}`);
  await ctx.close();
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(p, 'forms-crash'); }
finally { console.log('5xx:', p.bad, 'errors:', p.errs.slice(0, 3)); await b.close(); process.exitCode = failures() ? 1 : 0; }
