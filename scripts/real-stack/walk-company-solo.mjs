// Walk 9: one person running a business, in a real browser, the way a German Kleingewerbe would set up on Corpo › Company: a
// sole proprietor with only a tax number and a small-business note, then the day the exemption ends. Pass SHOTS=<dir> to keep the views.
import path from 'node:path';
import { browser, page, ok, failures, newPerson, go, text, fill, submit, wait } from './lib.mjs';
const b = await browser(); const p = await page(b);
const shot = (name) => (process.env.SHOTS ? p.screenshot({ path: path.join(process.env.SHOTS, `solo-${name}.png`) }) : null);
const errAt = []; p.on('pageerror', (e) => errAt.push(`${e.message.slice(0, 60)} @ ${p.url()}`));
const select = (id, v) => p.select(`#xdf-${id}`, v);
const tab = async (label) => { await p.evaluate((l) => [...document.querySelectorAll('[data-co2-view]')].find((t) => t.textContent.trim() === l).click(), label); await wait(1800); };
const press = async (attr) => { await p.waitForSelector(`#main [${attr}]`, { timeout: 10000 }); await p.click(`#main [${attr}]`); await wait(700); };
const choose = (field, v) => p.click(`.xd [data-f="${field}"] [data-v="${v}"]`);
const NOTE = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG';
try {
  await newPerson(p, 'Erika');
  await go(p, '/workspace/corpo/spaces/company', 3000);
  await press('data-xa="newCompany"');
  await fill(p, 'name', 'Northwind Media');
  await submit(p); await wait(3000);

  await press('data-co2="profile"');
  await choose('kind', 'sole_proprietor'); await choose('tax', 'small_business');
  await fill(p, 'name', 'Erika Mustermann'); await fill(p, 'form', 'Kleingewerbe');
  await shot('details');
  await submit(p); await wait(600);
  ok(/what invoices should state/.test(await text(p, '.xd')), 'a small business has to say what its invoices say');
  await fill(p, 'note', NOTE);
  await fill(p, 'o1', 'Hauptstraße 1'); await fill(p, 'oC', 'Musterstadt'); await fill(p, 'oP', '10115'); await select('oK', 'DE');
  await submit(p); await wait(1500);
  let t = await text(p, '#main');
  ok(/Sole proprietor/.test(t) && /Owner/.test(t) && /Trading as/.test(t) && /Northwind Media/.test(t), 'the page reads as one person trading', t.slice(0, 400));
  ok(/same legal person/.test(t), 'and says what that means for them');
  ok(!/Central administration/.test(t) && !/Who may act for the company/.test(t), 'with nothing that only fits a company', t.slice(0, 600));
  await shot('overview');

  await tab('Invoices');
  t = await text(p, '#main');
  ok(/Add your tax number first/.test(t) && !!(await p.$('#main [data-co2="addTax"]')), 'Invoices asks for what a sole proprietor actually has', t.slice(0, 300));
  await press('data-co2="addTax"');
  await select('s', 'tin'); await select('j', 'DE'); await fill(p, 'n', '12/345/67890');
  await submit(p); await wait(1800);
  await press('data-co2="newInvoice"');
  ok(!(await p.$('#xdf-rate')) && !(await p.$('#xdf-reason')), 'a new invoice doesn’t ask about tax');
  ok((await text(p, '.xd')).includes(NOTE), 'and shows what it will say');
  await fill(p, 'b', 'A Client GmbH'); await fill(p, 'bc', 'Berlin'); await select('bk', 'DE'); await select('cur', 'EUR');
  await fill(p, 'item', 'Video edit'); await fill(p, 'price', '250');
  await fill(p, 'more', 'Thumbnail; 2; 25');
  await submit(p);
  await p.waitForSelector('.xd [data-xd-ok]', { timeout: 10000 }); await p.click('.xd:last-of-type [data-xd-ok]'); await wait(3000);
  t = await text(p, '#main');
  ok(/Erika Mustermann/.test(t) && /Northwind Media/.test(t), 'the seller is the person, trading as the business', t.slice(0, 500));
  ok(/Tax number 12\/345\/67890/.test(t), 'with their tax number', t.slice(0, 600));
  ok(/10115 Musterstadt/.test(t), 'and their whole address', t.slice(0, 600));
  ok(t.includes(NOTE) && /300\.00/.test(t), 'the note is on it, and no tax was added', t.slice(0, 700));
  await shot('invoice');

  await tab('Overview');
  await press('data-co2="profile"');
  await choose('tax', 'standard');
  await submit(p); await wait(1500);
  await tab('Invoices');
  await press('data-co2="newInvoice"');
  ok(!!(await p.$('#xdf-rate')), 'the day the exemption ends, invoices ask about tax again');
  await p.keyboard.press('Escape'); await wait(500);
  ok(!!(await p.$('[data-co2-open]')) || /-0001/.test(await text(p, '#main')), 'and the invoice from before is still there');
  await p.evaluate(() => document.querySelector('[data-co2-open]')?.click()); await wait(2000);
  ok((await text(p, '#main')).includes(NOTE), 'still saying what it said');

  const here = errAt.filter((e) => e.includes('/workspace'));
  ok(!here.length, 'no script errors on the workspace', here.join(' | '));
  ok(!p.bad.length, 'no server errors', p.bad.join(' | '));
} catch (e) { await shot('crash'); ok(false, 'walk crashed', e.stack); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
