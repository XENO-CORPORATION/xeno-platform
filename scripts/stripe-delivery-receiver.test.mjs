import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { deliveryReceiver, isolatedEnvironment, probeTunnel } from './lib/stripe-delivery-receiver.mjs';
const require = createRequire(new URL('../src/server/package.json', import.meta.url));
const Stripe = require('stripe');
const stripe = new Stripe('sk_test_fixture');
const secret = 'whsec_fixture';

test('DNS probe refuses arbitrary destinations before network access', async () => {
  for (const url of ['http://abc.trycloudflare.com/api/billing/webhook', 'https://localhost/api/billing/webhook',
    'https://abc.trycloudflare.com.evil.test/api/billing/webhook', 'https://abc.trycloudflare.com/other',
    'https://abc.trycloudflare.com/api/billing/webhook?x=1']) await assert.rejects(probeTunnel(url));
});

test('allowlist strips email, database, queue and loader overrides', () => {
  const env = isolatedEnvironment({ PATH: 'safe', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', RESEND_API_KEY: 'forbidden',
    SENDGRID_API_KEY: 'forbidden', SMTP_PASSWORD: 'forbidden', DATABASE_URL: 'forbidden', PGHOST: 'forbidden',
    REDIS_URL: 'forbidden', NODE_OPTIONS: 'forbidden', CLOUDFLARE_API_TOKEN: 'forbidden', TUNNEL_TOKEN: 'forbidden' });
  assert.equal(env.NODE_ENV, 'test'); assert.equal(env.PATH, 'safe'); assert.equal(env.STRIPE_SECRET_KEY, 'sk_test_fixture');
  assert.equal(env.STRIPE_PUBLISHABLE_KEY, 'pk_test_fixture');
  assert.ok(!Object.values(env).includes('forbidden'));
});
async function fixture(t, options = {}) {
  let calls = 0, enabled = true;
  const services = { constructEvent: (body, sig) => stripe.webhooks.constructEvent(body, sig, secret),
    handleEvent: async () => { calls++; if (options.fail) throw new Error('SECRET_SENTINEL'); if (options.wait) await options.wait; return options.result; } };
  const receiver = deliveryReceiver({ pool: {}, getServices: () => enabled ? services : null, ...options });
  await new Promise(resolve => receiver.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { receiver.server.closeAllConnections(); await new Promise(resolve => receiver.server.close(resolve)); });
  const origin = `http://127.0.0.1:${receiver.server.address().port}`;
  const send = async (event = { id: 'evt_fixture', livemode: false, data: { object: {} } }, overrides = {}, route = '/api/billing/webhook') => {
    const body = JSON.stringify(event);
    return fetch(origin + route, { method: 'POST', body, headers: { 'Content-Type': 'application/json',
      'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: body, secret }) }, ...overrides });
  };
  return { ...receiver, send, origin, calls: () => calls, disable: () => { enabled = false; } };
}
test('only exact POST route exists, readiness fail closed', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.origin + '/api/billing/webhook')).status, 404);
  assert.equal((await f.send(undefined, {}, '/api/billing/webhook?other=1')).status, 404);
  assert.equal((await f.send(undefined, {}, '/login')).status, 404);
  f.disable(); assert.equal((await f.send()).status, 503); assert.equal(f.calls(), 0);
});
test('signed test events dispatch; invalid signature/live/Connect events do not', async t => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 200); assert.equal(f.calls(), 1);
  assert.equal((await f.send(undefined, { headers: { 'Content-Type': 'application/json' } })).status, 400);
  for (const patch of [{ livemode: true }, { livemode: null }, { livemode: false, account: 'acct_other' }]) {
    assert.equal((await f.send({ id: 'evt_fixture', ...patch })).status, 400);
  }
  assert.equal(f.calls(), 1); assert.equal(f.counters.accepted, 1); assert.equal(f.counters.rejected, 4);
});
test('body bound, compression/type refusal and sanitized handler failure', async t => {
  const f = await fixture(t, { maxBytes: 128, fail: true });
  assert.equal((await f.send({ contents: 'a'.repeat(512) })).status, 413);
  assert.equal((await f.send(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.send(undefined, { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } })).status, 415);
  const failed = await f.send(); assert.equal(failed.status, 500); assert.equal(await failed.text(), 'handler failed');
  assert.equal(f.counters.failed, 1);
});

test('delivery receipts only attest completed handlers and distinguish no-op results', async t => {
  for (const result of [{ handled: true, plan: 'pro' }, { handled: true, reason: 'superseded subscription' }, undefined]) {
    const f = await fixture(t, { result });
    await f.send({ id: 'evt_renewal', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_renewal', private: 'SECRET_SENTINEL' } } });
    assert.deepEqual(f.receipts, [{ id: 'evt_renewal', type: 'invoice.paid', objectId: 'in_renewal', reconciled: result?.plan === 'pro' }]);
    assert.doesNotMatch(JSON.stringify(f.receipts), /SECRET_SENTINEL/);
  }
  const f = await fixture(t, { fail: true });
  await f.send({ id: 'evt_renewal', type: 'invoice.paid', livemode: false, data: { object: { id: 'in_renewal' } } });
  assert.deepEqual(f.receipts, []);
});
test('concurrent handler ceiling rejects overflow', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { wait, maxInFlight: 1 });
  const first = f.send();
  for (let i = 0; f.calls() === 0 && i < 100; i++) await new Promise(r => setTimeout(r, 5));
  try { assert.equal(f.calls(), 1); assert.equal((await f.send()).status, 503); }
  finally { release(); }
  assert.equal((await first).status, 200);
});

test('outage control cannot bypass signature validation and never dispatches handlers', async t => {
  const f = await fixture(t); f.setPaused(true);
  const event = { id: 'evt_owned', type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_owned' } } };
  assert.equal((await f.send(event)).status, 503); assert.equal(f.calls(), 0);
  assert.equal(f.outageReceipts.length, 1); assert.equal(f.receipts.length, 0);
  assert.equal((await f.send(event, { headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal(f.outageReceipts.length, 1);
  assert.equal((await f.send(event, {}, '/control/resume')).status, 404);
  assert.throws(() => f.setPaused('false'));
  f.setPaused(false); assert.equal((await f.send(event)).status, 200); assert.equal(f.calls(), 1);
});

test('stalled handler drain times out but later completion can still drain', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { wait });
  const request = f.send();
  try {
    for (let i = 0; f.calls() === 0 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(f.calls(), 1);
    await assert.rejects(f.waitForIdle(10), /receiver_drain_timeout/);
  } finally { release(); await request; }
  await f.waitForIdle(10);
});

test('idle barrier waits for a handler after the HTTP client disconnects', async t => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { wait });
  const request = f.send().catch(() => null);
  for (let i = 0; f.calls() === 0 && i < 100; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(f.calls(), 1);
  f.server.closeAllConnections();
  let idle = false; const barrier = f.waitForIdle().then(() => { idle = true; });
  await new Promise(r => setTimeout(r, 10)); assert.equal(idle, false);
  release(); await barrier; await request;
  assert.equal(f.counters.accepted, 1); assert.equal(idle, true);
});
test('runner defaults offline and refuses live credentials without disclosure', () => {
  const plan = spawnSync(process.execPath, ['scripts/stripe-delivered-loop.mjs'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(plan.status, 0); assert.equal(JSON.parse(plan.stdout).status, 'UNEXECUTED');
  const refused = spawnSync(process.execPath, ['scripts/stripe-delivered-loop.mjs', '--confirm'], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, STRIPE_SECRET_KEY: 'sk_live_SECRET_SENTINEL' } });
  assert.equal(refused.status, 1); assert.doesNotMatch(refused.stdout + refused.stderr, /SECRET_SENTINEL/);
});
