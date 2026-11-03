// Walk 1: a new person signs up through the real form, gets the real activation mail, activates, and reaches the workspace.
import fs from 'node:fs'; import path from 'node:path'; // eslint-disable-line no-unused-vars
import { browser, page, go, text, type, clickText, shot, waitMail, ok, failures, wait, here, sql } from './lib.mjs';
const who = { name: 'Dana Walker', email: `dana.${Date.now()}@example.test`, password: 'Walk-the-loop-42!' };
const b = await browser(); const p = await page(b);
try {
  await go(p, '/signup');
  ok(!!(await clickText(p, /continue with email/i)), 'the email form opens'); await wait(600);
  await type(p, 'input[placeholder="Your name"]', who.name);
  await type(p, 'input[type=email]', who.email);
  await type(p, 'input[type=password]', who.password);
  ok(!!(await clickText(p, 'Create account')), 'Create account can be pressed'); await wait(5000);
  await shot(p, 'signup-after');
  const after = await text(p);
  ok(!/error|went wrong/i.test(after.slice(0, 400)), 'signup does not show an error', after.slice(0, 400));
  console.log('after signup at', p.url(), '::', after.slice(0, 300).replace(/\n/g, ' | '));
  const m = await waitMail((x) => x.to === who.email);
  ok(!!m, 'a mail reaches the new address');
  const all = (await import('./lib.mjs')).mail().filter((x) => x.to === who.email);
  console.log('mails:', all.map((x) => x.subject));
  const code = all.map((x) => (x.html.replace(/<[^>]+>/g, ' ').match(/\b([A-Z0-9]{4}[- ]?[A-Z0-9]{4}|\d{6})\b/) || [])[1]).find(Boolean);
  const link = all.map((x) => (x.html.match(/href="([^"]*verify-email[^"]*)"/) || [])[1]).find(Boolean);
  console.log('code found:', !!code, 'verify link found:', !!link);
  ok(/^\d{6}$/.test(code || ''), 'the mail carries a six-digit code', code);
  const inputs = await p.$$eval('input', (n) => n.map((i) => `${i.type}|${i.inputMode}|${i.maxLength}|${i.placeholder}|${i.autocomplete}`));
  console.log('activation inputs:', inputs);
  // Type the code as a person would: focus the first box and type all six digits.
  await p.click('input'); await p.keyboard.type(code, { delay: 60 }); await wait(5000);
  await shot(p, 'activate-after');
  console.log('after code at', p.url(), '::', (await text(p)).slice(0, 300).replace(/\n/g, ' | '));
  const row = sql(`SELECT id, email_verified, is_active FROM users WHERE email='${who.email}'`);
  ok(row.endsWith('|t|t'), 'the account is verified and active after the code', row);
  ok(/all set/i.test(await text(p)), 'the page says the account is active', (await text(p)).slice(0, 200));
  await clickText(p, 'Continue'); await wait(3000);
  ok(/\/workspace|\/onboarding|\/welcome|\/chat/.test(p.url()), 'Continue takes the person inside the product', p.url());
  console.log('page errors:', p.errs.slice(0, 5), 'server 5xx:', p.bad);
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(p, 'signup-crash'); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
