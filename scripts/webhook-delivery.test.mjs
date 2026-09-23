import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import express from 'express';
import webhookRoutes from '../src/server/routes/webhookRoutes.js';
import { enqueueWebhookEvent, WebhookDeliveryWorker, controlWebhookDelivery, startWebhookDeliveryWorker } from '../src/server/services/webhookDelivery.js';

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/notificationproof') throw new Error('Only the isolated loopback notificationproof database is permitted');
}
test('private notification events cannot broadcast or exceed payload bounds', async () => {
  const db = { query: () => { throw new Error('must not query'); } };
  await assert.rejects(enqueueWebhookEvent(db, 'agent.finished', {}, null), /owner/);
  await assert.rejects(enqueueWebhookEvent(db, 'agent.finished', 'a'.repeat(140_000), crypto.randomUUID()), /limit/);
});

test('runtime and legacy producer use the one durable webhook queue', async () => {
  const [index, routes, forum] = await Promise.all([
    fs.readFile(new URL('../src/server/index.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/server/routes/webhookRoutes.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../src/server/services/forumWebhookPush.js', import.meta.url), 'utf8'),
  ]);
  assert.equal((index.match(/startWebhookDeliveryWorker\(pool\)/g) || []).length, 1);
  assert.ok(index.indexOf('startWebhookDeliveryWorker(pool)') > index.indexOf('runStartupMigrations()'));
  assert.ok(index.indexOf('startWebhookDeliveryWorker(pool)') < index.indexOf('app.locals.migrationsReady = true', index.indexOf('runStartupMigrations()')));
  assert.ok(index.indexOf('await deliveryStopped') < index.indexOf('await pool.end()'));
  assert.doesNotMatch(routes, /deliverWebhook|from ['"]node-fetch['"]/);
  assert.match(routes, /return enqueueWebhookEvent\(db, event, payload, userId, options\)/);
  assert.match(forum, /dispatchWebhookEvent\(\s*client,[\s\S]*eventId: `forum\.digest:/);
});

test('real PostgreSQL durable webhook queue, controlled receiver and killed-worker recovery', { skip: !databaseUrl, timeout: 30_000 }, async t => {
  const schema = `delivery_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5 });
  let receiver; let child; let api;
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query('CREATE TABLE users(id uuid PRIMARY KEY)');
    const migration = await fs.readFile(new URL('../src/server/database/migrations/20260318000001-infrastructure-tables.sql', import.meta.url), 'utf8');
    await pool.query(migration.split('-- DOWN')[0]);
    const owner = crypto.randomUUID(); const stranger = crypto.randomUUID();
    await pool.query('INSERT INTO users VALUES($1),($2)', [owner, stranger]);
    const { rows: endpoints } = await pool.query(`INSERT INTO webhooks(user_id,url,secret,events) VALUES
      ($1,'https://public.example/first','fixture-secret',ARRAY['agent.finished']),
      ($1,'https://public.example/second','fixture-secret',ARRAY['agent.finished']),
      ($2,'https://public.example/foreign','fixture-secret',ARRAY['agent.finished']) RETURNING *`, [owner, stranger]);
    const webhook = endpoints[0];
    await pool.query(`INSERT INTO webhook_deliveries(webhook_id,event,payload,delivered_at) VALUES($1,'legacy','{}',NOW())`, [webhook.id]);
    await pool.query(await fs.readFile(new URL('../src/server/database/migrations/20260904120000-durable-webhook-delivery.sql', import.meta.url), 'utf8'));
    await pool.query((await fs.readFile(new URL('../src/server/database/migrations/20260711120000-workspaces.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    for (const file of ['20260904200000-workspace-key-operations.sql','20260904210000-workspace-membership-operations.sql','20260904270000-notification-destination-operations.sql']) {
      await pool.query((await fs.readFile(new URL(`../src/server/database/migrations/${file}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    assert.equal((await pool.query(`SELECT state FROM webhook_deliveries WHERE event='legacy'`)).rows[0].state, 'delivered');
    const received = [];
    receiver = http.createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString() }); response.writeHead(204); response.end();
    });
    receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
    const receiverUrl = `http://127.0.0.1:${receiver.address().port}/`;
    const localFixtureTransport = async (_url, options) => {
      const result = await fetch(receiverUrl, { method: 'POST', headers: options.headers, body: options.body, signal: options.signal });
      return { status: result.status, body: '' };
    };
    const worker = new WebhookDeliveryWorker(pool, { transport: localFixtureTransport });
    await t.test('fanout is per destination and owner; repeated event ID creates no duplicates', async () => {
      assert.equal(await enqueueWebhookEvent(pool, 'agent.finished', { summary: 'fixture' }, owner, { eventId: 'same-event' }), 2);
      assert.equal(await enqueueWebhookEvent(pool, 'agent.finished', { summary: 'fixture' }, owner, { eventId: 'same-event' }), 2, 'matching replay acknowledges existing admission');
      await assert.rejects(enqueueWebhookEvent(pool, 'agent.finished', { summary: 'changed' }, owner, { eventId: 'same-event' }), { code: '23514' });
      await Promise.all([worker.tick(), new WebhookDeliveryWorker(pool, { transport: localFixtureTransport }).tick()]);
      assert.equal(received.length, 2);
      for (const entry of received) assert.equal(entry.headers['x-webhook-signature'], `sha256=${crypto.createHmac('sha256', 'fixture-secret').update(entry.body).digest('hex')}`);
      assert.equal((await pool.query(`SELECT COUNT(*)::int count FROM webhook_deliveries WHERE event_id='same-event' AND state='delivered'`)).rows[0].count, 2);
    });
    await pool.query('UPDATE webhooks SET is_active=false WHERE id=$1', [endpoints[1].id]);
    await t.test('restart retries persisted failures and strips response/error content', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'retry' });
      await new WebhookDeliveryWorker(pool, { transport: async () => ({ status: 429, body: 'SECRET_NOT_FOR_JOURNAL', retryAfter: '120' }) }).tick();
      const row = (await pool.query(`SELECT * FROM webhook_deliveries WHERE event_id='retry'`)).rows[0];
      assert.equal(row.state, 'queued'); assert.equal(row.attempt, 1); assert.equal(row.response_body, null); assert.ok(row.next_retry_at);
      const delay = (await pool.query("SELECT extract(epoch FROM (next_retry_at-clock_timestamp())) AS seconds FROM webhook_deliveries WHERE id=$1", [row.id])).rows[0];
      assert.ok(Number(delay.seconds) > 110 && Number(delay.seconds) <= 120, 'receiver backoff is persisted, not just a process timer');
      assert.equal(await new WebhookDeliveryWorker(pool, { transport: localFixtureTransport }).tick(), false, 'a new worker cannot claim before receiver Retry-After');
      await pool.query(`UPDATE webhook_deliveries SET next_retry_at=clock_timestamp()-interval '1 second' WHERE event_id='retry'`);
      await new WebhookDeliveryWorker(pool, { transport: localFixtureTransport }).tick();
      assert.equal((await pool.query(`SELECT state FROM webhook_deliveries WHERE event_id='retry'`)).rows[0].state, 'delivered');
    });
    await t.test('owner cancel fences stale completion; foreign retry denied; retry requires explicit owner', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'cancel' });
      const leased = await worker.claim();
      assert.equal(await controlWebhookDelivery(pool, stranger, webhook.id, leased.id, 'cancel'), null);
      assert.equal((await controlWebhookDelivery(pool, owner, webhook.id, leased.id, 'cancel')).state, 'cancelled');
      assert.equal(await worker.settle(leased, { state: 'delivered' }), false);
      assert.equal(await controlWebhookDelivery(pool, stranger, webhook.id, leased.id, 'retry'), null);
      assert.equal((await controlWebhookDelivery(pool, owner, webhook.id, leased.id, 'retry')).state, 'queued');
      await worker.tick();
    });
    await t.test('destination changes cancel admitted work without delivering to a replacement URL', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'changed' });
      await pool.query(`UPDATE webhooks SET url='https://replacement.example/',updated_at=clock_timestamp() WHERE id=$1`, [webhook.id]);
      const count = received.length; await worker.tick(); assert.equal(received.length, count);
      assert.equal((await pool.query(`SELECT state FROM webhook_deliveries WHERE event_id='changed'`)).rows[0].state, 'cancelled');
    });
    await t.test('crash after receiver acceptance reclaims lease with stable delivery identity', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'crash' });
      child = fork(new URL('./fixtures/webhook-crash-worker.mjs', import.meta.url), [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, NOTIFICATION_TEST_DATABASE_URL: databaseUrl, NOTIFICATION_TEST_SCHEMA: schema, NOTIFICATION_TEST_RECEIVER: receiverUrl } });
      await Promise.race([once(child, 'message'), once(child, 'exit').then(([code]) => { throw new Error(`Fixture exited early: ${code}`); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Fixture receipt timed out')), 5000); timer.unref(); })]);
      const first = received.at(-1); const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; child = null;
      assert.equal((await pool.query(`SELECT state FROM webhook_deliveries WHERE event_id='crash'`)).rows[0].state, 'leased');
      await pool.query(`UPDATE webhook_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE event_id='crash'`);
      await new WebhookDeliveryWorker(pool, { transport: localFixtureTransport }).tick();
      assert.equal(received.at(-1).body, first.body, 'receiver can dedupe exact stable delivery id across crash retry');
      const row = (await pool.query(`SELECT state,attempt FROM webhook_deliveries WHERE event_id='crash'`)).rows[0];
      assert.equal(row.state, 'delivered'); assert.equal(row.attempt, 2);
      assert.equal(received.at(-1).headers['x-webhook-signature'], first.headers['x-webhook-signature']);
    });
    await t.test('real asynchronous claimer resumes queued rows and shutdown awaits settlement', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'async-loop' });
      const loop = startWebhookDeliveryWorker(pool, { intervalMs: 10, transport: localFixtureTransport });
      try {
        const deadline = Date.now() + 3000;
        while ((await pool.query(`SELECT state FROM webhook_deliveries WHERE event_id='async-loop'`)).rows[0].state !== 'delivered') {
          if (Date.now() > deadline) throw new Error('Asynchronous worker did not settle');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { await loop.close(); }
    });
    await t.test('expired leases fence old writers and final attempt exhausts durably', async () => {
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'fence' });
      const old = await worker.claim();
      await pool.query(`UPDATE webhook_deliveries SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [old.id]);
      const nextWorker = new WebhookDeliveryWorker(pool, { transport: localFixtureTransport });
      const next = await nextWorker.claim();
      assert.equal(await worker.settle(old, { state: 'delivered' }), false);
      assert.equal(await nextWorker.settle(next, { state: 'delivered' }), true);
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'exhausted' });
      await pool.query(`UPDATE webhook_deliveries SET max_attempts=1 WHERE event_id='exhausted'`);
      await new WebhookDeliveryWorker(pool, { transport: async () => { throw new Error('PRIVATE_UPSTREAM_DETAIL'); } }).tick();
      const row = (await pool.query(`SELECT state,error_code,response_body FROM webhook_deliveries WHERE event_id='exhausted'`)).rows[0];
      assert.equal(row.state, 'failed'); assert.equal(row.error_code, 'delivery_transport_failed'); assert.equal(row.response_body, null);
    });
    await t.test('default production transport records forbidden local destination without a connection', async () => {
      await pool.query(`UPDATE webhooks SET url='https://127.0.0.1/',updated_at=clock_timestamp() WHERE id=$1`, [webhook.id]);
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'unsafe' });
      const count = received.length; await new WebhookDeliveryWorker(pool).tick(); assert.equal(received.length, count);
      const row = (await pool.query(`SELECT state,error_code FROM webhook_deliveries WHERE event_id='unsafe'`)).rows[0];
      assert.equal(row.state, 'failed'); assert.equal(row.error_code, 'endpoint_forbidden_address');
    });
    await t.test('HTTP controls keep real delivery history and mutations owner-scoped', async () => {
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => { req.db = pool; req.user = { id: req.headers['x-fixture-owner'] }; next(); });
      app.use('/webhooks', webhookRoutes);
      api = app.listen(0, '127.0.0.1'); await once(api, 'listening');
      const base = `http://127.0.0.1:${api.address().port}/webhooks`;
      const request = (path, user, method = 'GET', body) => fetch(`${base}${path}`, { method,
        headers: { 'x-fixture-owner': user, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      assert.deepEqual((await (await request(`/${webhook.id}/deliveries`, stranger)).json()).deliveries, []);
      const history = await (await request(`/${webhook.id}/deliveries`, owner)).json();
      assert.ok(history.deliveries.length > 0);
      assert.ok(history.deliveries.every(row => row.state && !('payload' in row) && !('secret' in row) && !('lease_token' in row)));
      await enqueueWebhookEvent(pool, 'agent.finished', {}, owner, { eventId: 'http-control' });
      const delivery = (await pool.query(`SELECT id FROM webhook_deliveries WHERE event_id='http-control'`)).rows[0];
      assert.equal((await request(`/${webhook.id}/deliveries/${delivery.id}/cancel`, stranger, 'POST')).status, 409);
      const cancelled = await (await request(`/${webhook.id}/deliveries/${delivery.id}/cancel`, owner, 'POST')).json();
      assert.equal(cancelled.delivery.state, 'cancelled'); assert.match(cancelled.notice, /cannot be recalled/);
      assert.equal((await request('', owner, 'POST', { url: 'https://public.example/', events: ['agent.finished'] })).status, 400, 'scoped agent ingress is not yet exposed');
      assert.equal((await request('', owner, 'POST', { url: 'http://public.example/', events: ['forum.digest'] })).status, 400);
    });
    await t.test('owned worker shutdown stops future claiming', async () => {
      const loop = startWebhookDeliveryWorker(pool, { intervalMs: 10, transport: localFixtureTransport });
      await loop.close();
    });
  } finally {
    if (child) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    if (receiver) await new Promise(resolve => receiver.close(resolve));
    if (api) await new Promise(resolve => api.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end();
  }
});
