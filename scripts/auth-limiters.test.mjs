/**
 * The auth surface throttles FAILURES, per account, and never a correct password.
 *
 * Found by dogfooding 2026-09-17: one IP-keyed bucket of 10 requests / 15 min
 * sat in front of login, register, forgot, reset, verify and resend, counting
 * successes — a normal sign-up → verify → sign-in → change → reset run tripped it
 * in eight calls, and every address behind the same NAT was locked out with it.
 *
 * Real express-rate-limit, real express, stub handlers that answer 200 or 401
 * from the body so no database is needed. Cloudflare's CF-Connecting-IP is the
 * key, as in production.
 *
 * Mutations: drop `skipSuccessfulRequests` from loginFailureLimiter -> "ten
 * successful sign-ins never lock anyone out" fails. Key on IP alone -> "another
 * account behind the same address is untouched" fails. Put register on the login
 * bucket -> "sign-up and sign-in are separate budgets" fails. Restore the single
 * shared bucket in index.js -> the wiring test fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import express from 'express';
import {
  loginFailureLimiter, loginAddressCeiling, registerLimiter, recoveryMailLimiter, tokenRedeemLimiter,
} from '../src/server/middleware/rateLimiter.js';

async function withApp(fn) {
  const app = express();
  app.use(express.json());
  const outcome = (req, res) => res.status(req.body?.ok ? 200 : 401).json({ ok: Boolean(req.body?.ok) });
  app.post('/login', loginAddressCeiling, loginFailureLimiter, outcome);
  app.post('/register', registerLimiter, outcome);
  app.post('/forgot', recoveryMailLimiter, outcome);
  app.post('/reset', tokenRedeemLimiter, outcome);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, ip = '203.0.113.10') => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body),
  });
  try { await fn(post); } finally { await new Promise((r) => server.close(r)); }
}

const statuses = async (n, call) => { const out = []; for (let i = 0; i < n; i += 1) out.push((await call()).status); return out; };

test('ten successful sign-ins from one address never lock anyone out', async () => {
  await withApp(async (post) => {
    const s = await statuses(25, () => post('/login', { email: 'a@x.test', ok: true }));
    assert.deepEqual([...new Set(s)], [200]);
  });
});

test('the eleventh FAILED sign-in for one account is refused; another account behind the same address is untouched', async () => {
  await withApp(async (post) => {
    const s = await statuses(11, () => post('/login', { email: 'victim@x.test', ok: false }));
    assert.deepEqual(s.slice(0, 10), Array(10).fill(401));
    assert.equal(s[10], 429, 'the 11th failure is throttled');
    const r = await post('/login', { email: 'victim@x.test', ok: false });
    assert.equal(r.status, 429);
    assert.ok(r.headers.get('retry-after'), 'Retry-After is sent');
    assert.equal((await post('/login', { email: 'neighbour@x.test', ok: true })).status, 200, 'a different account on the same NAT signs in');
    assert.equal((await post('/login', { email: 'neighbour@x.test', ok: false })).status, 401, '…and is still counted on its own budget');
  });
});

test('the address ceiling stops credential stuffing across many accounts', async () => {
  await withApp(async (post) => {
    let i = 0;
    // Own address: the limiters are module singletons, so the earlier tests' failures
    // on 203.0.113.10 would otherwise count here.
    const s = await statuses(101, () => post('/login', { email: `u${i++}@x.test`, ok: false }, '198.51.100.99'));
    assert.equal(s[99], 401);
    assert.equal(s[100], 429, 'the 101st failure from one address is refused whatever the account');
  });
});

test('sign-up, recovery mail and token redemption are separate budgets from sign-in', async () => {
  await withApp(async (post) => {
    await statuses(11, () => post('/login', { email: 'v@x.test', ok: false }));
    assert.equal((await post('/register', { email: 'new@x.test', ok: true })).status, 200, 'a locked login does not block sign-up');
    assert.equal((await post('/forgot', { email: 'v@x.test', ok: true })).status, 200, '…or recovery');
    const reg = await statuses(11, () => post('/register', { email: 'spam@x.test', ok: true }, '198.51.100.7'));
    assert.equal(reg[9], 200); assert.equal(reg[10], 429, 'sign-up: the 11th per address per hour is refused');
    const mail = await statuses(6, () => post('/forgot', { email: 'target@x.test', ok: true }, '198.51.100.8'));
    assert.equal(mail[4], 200); assert.equal(mail[5], 429, 'recovery mail: the 6th per address+target per hour is refused');
    const redeem = await statuses(21, () => post('/reset', { ok: false }, '198.51.100.9'));
    assert.equal(redeem[19], 401); assert.equal(redeem[20], 429, 'token redemption: the 21st FAILURE is refused');
    assert.equal((await post('/reset', { ok: true }, '198.51.100.9')).status, 429, '…and stays refused for the window');
  });
});

test('index.js mounts the split limiters and the shared bucket is gone', () => {
  const src = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.match(src, /app\.use\('\/api\/auth\/login', loginAddressCeiling, loginFailureLimiter\)/);
  assert.match(src, /app\.use\('\/api\/auth\/register', registerLimiter\)/);
  assert.match(src, /app\.use\('\/api\/auth\/forgot-password', recoveryMailLimiter\)/);
  assert.match(src, /app\.use\('\/api\/auth\/reset-password', tokenRedeemLimiter\)/);
  assert.match(src, /app\.use\('\/api\/auth\/verify-email', tokenRedeemLimiter\)/);
  assert.ok(!/app\.use\('\/api\/auth\/login', authLimiter\)/.test(src), 'the single shared auth bucket is gone');
});
