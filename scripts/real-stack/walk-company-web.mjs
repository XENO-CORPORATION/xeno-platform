// Walk 8: XENO Company in the workspace, in a real browser, against this real stack. A person sets a company up on Corpo ›
// Company, issues an invoice, opens it by its address, reverses it, and reads the wallet and activity. Pass SHOTS=<dir> to keep a
// screenshot of each view for a look at the design.
import path from 'node:path';
import { browser, page, ok, failures, newPerson, go, text, fill, submit, dialogWarn, wait } from './lib.mjs';
const b = await browser(); const p = await page(b);
const shot = (name) => (process.env.SHOTS ? p.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }) : null);
const errAt = []; p.on('pageerror', (e) => errAt.push(`${e.message.slice(0, 60)} @ ${p.url()}`));
const select = (id, v) => p.select(`#xdf-${id}`, v);
const tab = async (label) => { await p.evaluate((l) => [...document.querySelectorAll('[data-co2-view]')].find((t) => t.textContent.trim() === l).click(), label); await wait(1800); };
const press = async (attr) => { await p.waitForSelector(`#main [${attr}]`, { timeout: 10000 }); await p.click(`#main [${attr}]`); await wait(700); };
const confirm = async () => { await p.waitForSelector('.xd [data-xd-ok]', { timeout: 10000 }); await p.click('.xd:last-of-type [data-xd-ok]'); await wait(2500); };
try {
  await newPerson(p, 'Cora');
  const id = await p.evaluate(async () => {
    const csrf = document.cookie.match(/xeno_csrf=([^;]+)/)?.[1];
    const r = await fetch('/api/orgs', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-xeno-surface': 'xeno-web', ...(csrf ? { 'x-xeno-csrf': decodeURIComponent(csrf) } : {}) }, body: JSON.stringify({ name: 'Northwind', slug: `northwind-${Date.now()}` }) });
    return (await r.json()).id;
  });
  ok(!!id, 'a company exists for this person', id);
  const home = `/workspace/corpo/spaces/company?ws=${id}`;
  await go(p, home, 3000);
  let t = await text(p, '#main');
  ok(['Overview', 'Invoices', 'Wallet', 'Activity'].every((l) => t.includes(l)), 'the company’s views are tabs on the workspace page', t.slice(0, 300));
  ok(await p.evaluate(() => !!document.querySelector('[data-co2-view]')?.closest('.pg-tabs')), 'and they are the workspace’s own tab bar');
  ok(!(await p.$('.xc-app')), 'nothing of the old dashboard is on it');

  await tab('Invoices');
  t = await text(p, '#main');
  ok(/Add a registration or a tax number first/.test(t), 'before it has a legal identity, Invoices says what to add', t.slice(0, 300));
  ok(!(await p.$('#main [data-co2="newInvoice"]')), 'and offers no invoice it would refuse');

  await tab('Overview');
  await press('data-co2="profile"');
  ok((await p.$eval('#xdf-oK', (e) => e.value)) === '', 'the country isn’t assumed');
  await fill(p, 'name', 'Northwind Holdings LLC'); await fill(p, 'form', 'LLC');
  await fill(p, 'o1', '1 Main Street'); await fill(p, 'oC', 'Austin'); await fill(p, 'oR', 'TX'); await fill(p, 'oP', '78701'); await select('oK', 'US');
  await submit(p); await wait(1500);
  await press('data-co2="addReg"');
  await select('j', 'US'); await fill(p, 'reg', 'Texas Secretary of State'); await fill(p, 'n', '0801234567');
  await submit(p); await wait(1500);
  t = await text(p, '#main');
  ok(/Northwind Holdings LLC/.test(t) && /Texas Secretary of State/.test(t), 'a company in the United States is set up on the page', t.slice(0, 400));
  await shot('overview');

  await tab('Invoices');
  await press('data-co2="newInvoice"');
  await fill(p, 'b', 'A Client GmbH'); await fill(p, 'bc', 'Berlin'); await select('bk', 'DE'); await select('cur', 'USD');
  await fill(p, 'item', 'Design'); await fill(p, 'price', '100.5');
  await submit(p); await wait(500);
  ok(/why no tax/i.test(await dialogWarn(p)), 'no tax has to say why', await dialogWarn(p));
  await fill(p, 'reason', 'Export of services');
  await fill(p, 'more', 'Hosting; 2; 19.99; 10');
  await shot('new-invoice');
  await submit(p);
  await shot('confirm');
  await confirm();
  ok(/\/invoices\/NORTHWIN[^/]*-0001/.test(p.url()), 'issuing opens the invoice at its own address', p.url());
  t = await text(p, '#main');
  ok(/A Client GmbH/.test(t) && /Export of services/.test(t) && /\$144\.48/.test(t), 'it shows the customer, the reason and the exact total', t.slice(0, 500));
  await wait(1200); await shot('invoice');
  const url = p.url();
  await p.reload({ waitUntil: 'networkidle2' }); await wait(3000);
  ok(p.url() === url && /\$144\.48/.test(await text(p, '#main')), 'refresh lands on the same invoice');

  await press('data-co2="credit"');
  await confirm();
  ok(/-0002/.test(p.url()) && /Credit note/.test(await text(p, '#main')), 'a credit note reverses it, at its own address', p.url());
  await tab('Invoices');
  t = await text(p, '#main');
  await shot('invoices');
  ok(/-0001/.test(t) && /-0002/.test(t) && /Reversed/.test(t), 'the list shows both, and the first as reversed', t.slice(0, 500));
  ok(/not this country’s own/.test(t) && /no tax authority/.test(t), 'and says what was checked', t.slice(-300));

  await tab('Wallet'); await wait(800);
  ok(/credits/i.test(await text(p, '#main')), 'the wallet reads'); await shot('wallet');
  await tab('Activity'); await wait(800);
  ok(/Invoice issued/.test(await text(p, '#main')) && /Invoice credited/.test(await text(p, '#main')), 'activity records both', (await text(p, '#main')).slice(0, 300)); await shot('activity');
  await p.goBack({ waitUntil: 'networkidle2' }).catch(() => {}); await wait(1500);
  ok(/\/company\/wallet/.test(p.url()), 'Back returns to the tab before', p.url());
  // The site's signup page can throw on a cold dev server, before this walk's subject has loaded.
  const here = errAt.filter((e) => e.includes('/workspace'));
  ok(!here.length, 'no script errors on the workspace', here.join(' | '));
  ok(!p.bad.length, 'no server errors', p.bad.join(' | '));
} catch (e) { await shot('crash'); ok(false, 'walk crashed', e.stack); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
