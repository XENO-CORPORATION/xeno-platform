// Walk 2: two-step sign-in, as a person does it.
//   sign up + activate -> Settings › Sign-in & security -> authenticator app on (code computed from the key on screen,
//   as a phone app would) -> recovery codes shown -> a passkey added with Chrome's virtual authenticator ->
//   sign out -> password alone is not enough -> second step with the app -> sign out -> sign in with only a passkey ->
//   sign out -> a recovery code works once -> each change mailed to the person.
import crypto from 'node:crypto';
import { browser, page, go, text, type, clickText, shot, mail, waitMail, ok, failures, wait, sql } from './lib.mjs';

const totp = (b32, t = Date.now()) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of b32.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
};
const who = { name: 'Sam Rivera', email: `sam.${Date.now()}@example.test`, password: 'Second-step-77!' };
const fill = async (p, id, v) => { const sel = `#xdf-${id}`; await p.waitForSelector(sel, { timeout: 10000 }); await p.click(sel, { clickCount: 3 }); await p.type(sel, v, { delay: 5 }); };
const submit = async (p) => { await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]'); await wait(1500); };
const dialog = (p) => p.evaluate(() => document.querySelector('.xd')?.innerText || '');
const closeDialogs = async (p) => { for (let i = 0; i < 3; i++) { if (!(await p.$('.xd'))) return; await p.keyboard.press('Escape'); await wait(400); } };

async function signUp(p) {
  await go(p, '/signup'); await clickText(p, /continue with email/i); await wait(500);
  await type(p, 'input[placeholder="Your name"]', who.name); await type(p, 'input[type=email]', who.email); await type(p, 'input[type=password]', who.password);
  await clickText(p, 'Create account'); await wait(4000);
  const m = await waitMail((x) => x.to === who.email && /verify/i.test(x.subject));
  const code = m && (m.html.replace(/<[^>]+>/g, ' ').match(/\b(\d{6})\b/) || [])[1];
  await p.click('input'); await p.keyboard.type(code || '', { delay: 50 }); await wait(4000);
  ok(sql(`SELECT email_verified FROM users WHERE email='${who.email}'`) === 't', 'after the emailed code the address reads verified');
  await clickText(p, 'Continue'); await wait(3000);
  console.log('after Continue:', p.url());
}
async function signIn(p, { second } = {}) {
  await go(p, '/login'); await clickText(p, /continue with email/i); await wait(500);
  await type(p, 'input[type=email]', who.email); await type(p, 'input[type=password]', who.password);
  await p.click('form[data-xc=credential-form] button[type=submit]'); await wait(3500);
  const t = await text(p);
  if (!second) return t;
  const asked = /code from your (authenticator )?app|second step|two-step|recovery code/i.test(t);
  ok(asked, 'with two-step on, the password alone leads to a second step', t.slice(0, 300));
  if (second.recovery) await clickText(p, /recovery code/i);
  await wait(400);
  const input = await p.$('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[type=text]');
  await input.click({ clickCount: 3 }); await input.type(second.code, { delay: 30 });
  await clickText(p, /^(Continue|Verify|Sign in|Confirm)$/i); await wait(4000);
  return text(p);
}
const signedIn = async (p) => (await p.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).status)) === 200;
const signOut = async (p) => { const c = await p.cookies(); if (c.length) await p.deleteCookie(...c); await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} }); };

const b = await browser(); const p = await page(b);
try {
  // Chrome's own virtual authenticator: a platform passkey with user verification, as Windows Hello would give.
  const cdp = await p.target().createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  await signUp(p);
  await go(p, '/workspace/settings/security', 2500);
  const sec = await text(p, '#main');
  ok(/Two-step sign-in/.test(sec), 'Settings › Sign-in & security shows Two-step sign-in', sec.slice(0, 300));
  await shot(p, 'security-before');

  // ---- authenticator app ----
  ok(!!(await clickText(p, 'Set up')), 'the authenticator row offers Set up');
  await wait(1200);
  let d = await dialog(p); console.log('dialog 1:', d.slice(0, 200).replace(/\n/g, ' | '));
  if (/Confirm it/.test(d)) { await fill(p, 'password', who.password); await submit(p); d = await dialog(p); }
  ok(/Set up an authenticator app/.test(d), 'after confirming it is you, the authenticator setup opens', d.slice(0, 200));
  const key = await p.evaluate(() => document.querySelector('.set-secret code')?.textContent || '');
  ok(/^[A-Z2-7 ]{16,}$/.test(key), 'the setup shows a typeable key', key);
  ok(!!(await p.$('.set-secret .set-qr svg')), 'and a QR code to scan');
  await fill(p, 'code', totp(key)); await submit(p);
  d = await dialog(p);
  const codes = await p.evaluate(() => [...document.querySelectorAll('.set-codes code')].map((c) => c.textContent));
  ok(codes.length >= 8, 'turning it on shows the recovery codes once', d.slice(0, 200));
  await shot(p, 'recovery-codes'); await closeDialogs(p);
  ok(sql(`SELECT count(*) FROM users u JOIN account_totp t ON t.user_id=u.id WHERE u.email='${who.email}'`) !== '0'
    || /On — codes/.test(await text(p, '#main')), 'the authenticator is on', await text(p, '#main'));

  // ---- passkey ----
  ok(!!(await clickText(p, 'Add a passkey')), 'Add a passkey can be pressed'); await wait(1200);
  d = await dialog(p);
  if (/Confirm it/.test(d)) { console.log('passkey asks to confirm:', d.slice(0, 160).replace(/\n/g, ' | ')); const pick = await p.$('#xdf-how'); if (pick) { await p.select('#xdf-how', 'authenticator'); await submit(p); } d = await dialog(p); if (/Code from your app/.test(d)) { await fill(p, 'code', totp(key)); await submit(p); } else if (/password/i.test(d)) { await fill(p, 'password', who.password); await submit(p); } d = await dialog(p); }
  ok(/Add a passkey/.test(d), 'the passkey dialog asks for a name', d.slice(0, 200));
  await submit(p); await wait(2500);
  const afterKey = await text(p);
  ok(/Passkey added/.test(afterKey) || /1 saved/.test(await text(p, '#main')), 'the passkey is added', afterKey.slice(0, 300));
  await closeDialogs(p); await shot(p, 'security-after');

  // ---- the mails a person gets ----
  const notices = mail().filter((m) => m.to === who.email).map((m) => m.subject);
  console.log('mails to the person:', notices);
  ok(notices.filter((s) => !/welcome|verify/i.test(s)).length >= 2, 'each change to how they sign in is mailed to them', notices.join(' / '));

  // ---- the password alone is no longer enough ----
  await signOut(p);
  ok(!(await signedIn(p)), 'signed out');
  // A code already used (at setup) must not work again, so first try the SAME window's code, then wait for a fresh one.
  const reused = await signIn(p, { second: { code: totp(key) } });
  console.log('same-window code says:', reused.slice(0, 200).replace(/\n/g, ' | '));
  const fresh = 30000 - (Date.now() % 30000) + 1500; await wait(fresh);
  await signOut(p);
  const t2 = await signIn(p, { second: { code: totp(key) } });
  if (!(await signedIn(p))) console.log('fresh code page says:', t2.slice(0, 300).replace(/\n/g, ' | '));
  ok(await signedIn(p), 'password + the app code signs in', p.url());

  // ---- a passkey alone ----
  await signOut(p);
  await go(p, '/login');
  ok(!!(await clickText(p, /passkey/i)), 'the sign-in page offers a passkey'); await wait(4000);
  ok(await signedIn(p), 'a passkey alone signs in, nothing typed', (await text(p)).slice(0, 300));

  // ---- a recovery code, once ----
  await signOut(p);
  await signIn(p, { second: { recovery: true, code: codes[0] } });
  ok(await signedIn(p), 'a recovery code signs in when the app is lost', (await text(p)).slice(0, 300));
  await signOut(p);
  const again = await signIn(p, { second: { recovery: true, code: codes[0] } });
  ok(!(await signedIn(p)), 'the same recovery code does not work twice', again.slice(0, 200));

  console.log('page errors:', p.errs.slice(0, 5), 'server 5xx:', p.bad);
  const real5xx = p.bad.filter((x) => !x.includes('/api/automate/catalogue')); // no workflow runner on this local copy
  ok(!real5xx.length, 'no server error along the way', real5xx.join(', '));
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(p, 'twostep-crash'); console.log('dialog at crash:', (await dialog(p)).slice(0, 300)); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
