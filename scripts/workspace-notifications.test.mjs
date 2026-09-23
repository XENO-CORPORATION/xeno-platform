import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { readNotificationSettings, saveNotificationSettings, admitAgentNotification, notificationScope } from '../src/server/services/workspaceNotificationService.js';
import { WebhookDeliveryWorker } from '../src/server/services/webhookDelivery.js';
import { executeNotificationDestinationOperation, prepareNotificationDestinationOperation, readNotificationDestinationOperation } from '../src/server/services/workspaceNotificationDestinationOperations.js';

const url = process.env.NOTIFICATION_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.pathname !== '/notificationproof') throw new Error('Only isolated loopback notificationproof is permitted');
}
test('scope requires exact ancestry and generation, not a cwd', () => {
  assert.throws(() => notificationScope({ workspaceId: '/tmp' }));
  assert.throws(() => notificationScope({ workspaceId: 'w', agentId: 'a', workspaceCreatedAt: new Date().toISOString() }));
});
test('real PostgreSQL scope authority, settings CAS and durable admission', { skip: !url, timeout: 30000 }, async t => {
  const schema = `notification_scope_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5 });
  try {
    await pool.query(`CREATE SCHEMA ${schema}; CREATE TABLE users(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),is_active boolean NOT NULL DEFAULT true)`);
    for (const file of ['20260318000001-infrastructure-tables.sql','20260711120000-workspaces.sql','20260904120000-durable-webhook-delivery.sql','20260904121000-agent-notification-scopes.sql','20260904200000-workspace-key-operations.sql','20260904210000-workspace-membership-operations.sql','20260904270000-notification-destination-operations.sql']) {
      await pool.query((await fs.readFile(new URL(`../src/server/database/migrations/${file}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    const owner = crypto.randomUUID(), stranger = crypto.randomUUID(), workspace = crypto.randomUUID();
    await pool.query('INSERT INTO users VALUES($1),($2)', [owner, stranger]);
    await pool.query("INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Fixture','fixture')", [workspace, owner]);
    await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)", [workspace, owner]);
    const endpoint = (await pool.query("INSERT INTO webhooks(user_id,notification_workspace_id,url,secret,events) VALUES($1,$2,'https://example.com/hooks/SECRET_PATH','PRIVATE_SECRET',ARRAY[]::text[]) RETURNING id", [owner, workspace])).rows[0].id;
    const foreign = (await pool.query("INSERT INTO webhooks(user_id,notification_workspace_id,url,secret,events) VALUES($1,$2,'https://example.com/foreign','FOREIGN_SECRET',ARRAY[]::text[]) RETURNING id", [stranger, workspace])).rows[0].id;
    const scope = { workspaceId: 'local-w', workspaceCreatedAt: new Date().toISOString() };
    const rule = { event: 'agent.finished', channel: 'webhook', destinationId: endpoint, enabled: true };
    let snapshot;
    let createdDestination;
    await t.test('fresh scope CAS cannot reuse revision zero even after saving empty rules', async () => {
      snapshot = await saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: '0', rules: [] });
      await assert.rejects(saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: '0', rules: [rule] }), { status: 409 });
      snapshot = await saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: snapshot.revision, rules: [rule] });
      const revisions = await Promise.allSettled([false, true].map(enabled => saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: snapshot.revision, rules: [{ ...rule, enabled }] })));
      assert.equal(revisions.filter(v => v.status === 'fulfilled').length, 1);
      snapshot = await readNotificationSettings(pool, workspace, owner, scope);
      snapshot = await saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: snapshot.revision, rules: [rule] });
    });
    await t.test('owner and channel admission fails closed; destination projection excludes secrets', async () => {
      await assert.rejects(readNotificationSettings(pool, workspace, stranger, scope), { status: 403 });
      for (const override of [{ destinationId: foreign }, { channel: 'email' }, { event: 'arbitrary' }]) {
        await assert.rejects(saveNotificationSettings(pool, workspace, owner, { scope, expectedRevision: snapshot.revision, rules: [{ ...rule, ...override }] }), { status: 400 });
      }
      assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
      assert.deepEqual(snapshot.destinations.map(v => v.label), ['example.com']);
    });
    const input = { scope: { ...scope, teamId: 't', agentId: 'a' }, event: 'agent.finished', eventId: 'a'.repeat(64), occurredAt: new Date().toISOString(), conversationId: 'conv', requestId: 'run', prompt: 'NEVER_TRANSPORT_PROMPT' };
    await t.test('event replay is immutable and one destination receives metadata only', async () => {
      assert.equal((await admitAgentNotification(pool, workspace, owner, input)).duplicate, false);
      assert.equal((await admitAgentNotification(pool, workspace, owner, input)).duplicate, true);
      await assert.rejects(admitAgentNotification(pool, workspace, owner, { ...input, requestId: 'different' }), { status: 409 });
      const rows = (await pool.query('SELECT * FROM webhook_deliveries')).rows;
      assert.equal(rows.length, 1); assert.ok(!JSON.stringify(rows).includes('NEVER_TRANSPORT_PROMPT'));
      let calls = 0;
      await new WebhookDeliveryWorker(pool, { transport: async () => { calls++; return { status: 204, body: '' }; } }).tick();
      assert.equal(calls, 1); assert.equal((await pool.query('SELECT state FROM webhook_deliveries')).rows[0].state, 'delivered');
    });
    await t.test('destination prepare is immutable and lost execute acknowledgement recovers without another secret', async () => {
      const operationId = crypto.randomUUID();
      const intent = { action: 'create', url: 'https://notify.example.test/private-path' };
      const prepared = await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId, intent);
      assert.equal(prepared.state, 'prepared'); assert.equal(prepared.replayed, false);
      assert.equal((await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId, intent)).replayed, true);
      await assert.rejects(prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId, { ...intent, url: 'https://other.example.test/' }), { code: 'workspace_operation_conflict' });
      const committed = await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId);
      assert.equal(committed.state, 'committed'); assert.match(committed.secret, /^[a-f0-9]{64}$/); assert.equal(committed.replayed, false);
      const lookup = await readNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId);
      assert.equal(lookup.state, 'committed'); assert.equal(lookup.operation.destination.label, 'notify.example.test');
      assert.ok(!JSON.stringify(lookup).includes('private-path')); assert.ok(!JSON.stringify(lookup).includes(committed.secret)); assert.ok(!('request' in lookup.operation));
      const replay = await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId);
      assert.equal(replay.replayed, true); assert.ok(!('secret' in replay));
      assert.equal(Number((await pool.query("SELECT count(*) FROM webhooks WHERE user_id=$1 AND url='https://notify.example.test/private-path'", [owner])).rows[0].count), 1);
      createdDestination = committed.operation.destination;
    });
    await t.test('permission loss blocks prepared execution and stale destination generation rejects durably', async () => {
      const destination = createdDestination;
      const operationId = crypto.randomUUID();
      const intent = { action: 'update', destination_id: destination.id, expected_updated_at: destination.updated_at, enabled: false };
      await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId, intent);
      await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2", [workspace, owner]);
      await assert.rejects(executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId), { status: 403 });
      assert.equal((await pool.query('SELECT is_active FROM webhooks WHERE id=$1', [destination.id])).rows[0].is_active, true);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)", [workspace, owner]);
      const committed = await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', operationId);
      assert.equal(committed.operation.destination.enabled, false);
      const staleId = crypto.randomUUID();
      const staleIntent = { action: 'update', destination_id: destination.id, expected_updated_at: committed.operation.destination.updated_at, enabled: true };
      await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', staleId, staleIntent);
      await pool.query("UPDATE webhooks SET updated_at=clock_timestamp()+interval '1 second' WHERE id=$1", [destination.id]);
      const rejected = await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', staleId);
      assert.equal(rejected.state, 'rejected'); assert.equal(rejected.operation.rejection, 'notification_destination_generation_conflict');
      assert.equal((await pool.query('SELECT is_active FROM webhooks WHERE id=$1', [destination.id])).rows[0].is_active, false);
    });
    await t.test('delivery cancel/retry is workspace-bound, receipted and duplicate-safe', async () => {
      const queuedInput = { ...input, eventId: 'f'.repeat(64) };
      await admitAgentNotification(pool, workspace, owner, queuedInput);
      const delivery = (await pool.query("SELECT id FROM webhook_deliveries WHERE event_id LIKE '%:ffff%'" )).rows[0];
      const cancelId = crypto.randomUUID();
      await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', cancelId, { action: 'delivery-control', destination_id: endpoint, delivery_id: delivery.id, operation: 'cancel' });
      const cancelled = await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', cancelId);
      assert.equal(cancelled.operation.delivery.state, 'cancelled');
      assert.equal((await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', cancelId)).replayed, true);
      const retryId = crypto.randomUUID();
      await prepareNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', retryId, { action: 'delivery-control', destination_id: endpoint, delivery_id: delivery.id, operation: 'retry' });
      assert.equal((await executeNotificationDestinationOperation(pool, workspace, owner, 'xeno-agent-interface', retryId)).operation.delivery.state, 'queued');
      const foreignWorkspace = crypto.randomUUID();
      await pool.query("INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Foreign','foreign')", [foreignWorkspace, owner]);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)", [foreignWorkspace, owner]);
      const foreignId = crypto.randomUUID();
      await prepareNotificationDestinationOperation(pool, foreignWorkspace, owner, 'xeno-agent-interface', foreignId, { action: 'delivery-control', destination_id: endpoint, delivery_id: delivery.id, operation: 'cancel' });
      const rejected = await executeNotificationDestinationOperation(pool, foreignWorkspace, owner, 'xeno-agent-interface', foreignId);
      assert.equal(rejected.state, 'rejected'); assert.equal(rejected.operation.rejection, 'notification_delivery_transition_unavailable');
    });
    await t.test('nearest scope can disable inherited destination without disabling siblings', async () => {
      const child = { ...scope, teamId: 't', agentId: 'a' };
      await saveNotificationSettings(pool, workspace, owner, { scope: child, expectedRevision: '0', rules: [{ ...rule, enabled: false }] });
      await admitAgentNotification(pool, workspace, owner, { ...input, eventId: 'b'.repeat(64) });
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM webhook_deliveries WHERE event_id LIKE '%:bbbb%'")).rows[0].n, 0);
      await admitAgentNotification(pool, workspace, owner, { ...input, scope: { ...child, agentId: 'sibling' }, eventId: 'c'.repeat(64) });
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM webhook_deliveries WHERE event_id LIKE '%:cccc%'")).rows[0].n, 1);
    });
    await t.test('admission quota refuses new events but preserves replay acknowledgment', async () => {
      await pool.query("INSERT INTO agent_notification_events(workspace_id,owner_user_id,event_id,envelope) SELECT $1,$2,'fixture-' || generate_series(1,10000),'{}'::jsonb", [workspace, owner]);
      await assert.rejects(admitAgentNotification(pool, workspace, owner, { ...input, eventId: 'e'.repeat(64) }), { status: 429 });
      assert.equal((await admitAgentNotification(pool, workspace, owner, input)).duplicate, true);
    });
    await t.test('revoked workspace grant prevents already queued notification dispatch', async () => {
      await pool.query('DELETE FROM relationship_tuples WHERE subject_id=$1', [owner]);
      let calls = 0;
      const worker = new WebhookDeliveryWorker(pool, { transport: async () => { calls++; return { status: 204, body: '' }; } });
      while (await worker.tick()) {}
      assert.equal(calls, 0);
      assert.equal((await pool.query("SELECT state FROM webhook_deliveries WHERE event_id LIKE '%:cccc%'")).rows[0].state, 'cancelled');
      await assert.rejects(admitAgentNotification(pool, workspace, owner, { ...input, eventId: 'd'.repeat(64) }), { status: 403 });
    });
    await t.test('approved Slack and Discord webhooks use the real queue and require receiver acknowledgements', async () => {
      const actor = crypto.randomUUID(), space = crypto.randomUUID();
      await pool.query('INSERT INTO users(id) VALUES($1)', [actor]);
      await pool.query("INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Receivers','receivers')", [space, actor]);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)", [space, actor]);
      const urls = ['https://hooks.slack.com/services/T123/B123/receiver-token', `https://discord.com/api/webhooks/123456789012345678/${'x'.repeat(68)}`];
      const ids = [];
      for (const target of urls) {
        const operationId = crypto.randomUUID();
        await prepareNotificationDestinationOperation(pool, space, actor, 'xeno-agent-interface', operationId, { action: 'create', url: target });
        ids.push((await executeNotificationDestinationOperation(pool, space, actor, 'xeno-agent-interface', operationId)).operation.destination.id);
      }
      await assert.rejects(prepareNotificationDestinationOperation(pool, space, actor, 'xeno-agent-interface', crypto.randomUUID(), { action: 'create', url: 'https://hooks.slack.com/wrong-path' }), { code: 'invalid_notification_destination_operation' });
      const receiverScope = { workspaceId: 'local-receivers', workspaceCreatedAt: new Date().toISOString() };
      const settings = await saveNotificationSettings(pool, space, actor, { scope: receiverScope, expectedRevision: '0', rules: ids.map(destinationId => ({ event: 'agent.finished', channel: 'webhook', destinationId, enabled: true })) });
      assert.ok(!JSON.stringify(settings).includes('receiver-token')); assert.equal(settings.destinations.every(destination => destination.ready), true);
      const rich = await readNotificationSettings(pool, space, actor, receiverScope, { channelVersion: 2 });
      assert.equal(rich.channelVersion, 2);
      assert.deepEqual(new Set(rich.destinations.map(value => value.channel)), new Set(['slack', 'discord']));
      assert.equal(rich.channels.find(value => value.id === 'email').available, false);
      assert.equal(rich.channels.filter(value => ['slack', 'discord'].includes(value.id)).every(value => value.available), true);
      await assert.rejects(saveNotificationSettings(pool, space, actor, { scope: receiverScope, expectedRevision: rich.revision, rules: [{ ...rich.rules[0], channel: 'webhook' }] }, { channelVersion: 2 }), { status: 400 });
      const saved = await saveNotificationSettings(pool, space, actor, { scope: receiverScope, expectedRevision: rich.revision, rules: rich.rules }, { channelVersion: 2 });
      assert.deepEqual(saved.rules, rich.rules);
      const legacy = await readNotificationSettings(pool, space, actor, receiverScope);
      assert.equal(legacy.rules.every(value => value.channel === 'webhook'), true, 'older clients retain their documented projection');
      assert.equal(legacy.destinations.every(value => value.channel === 'webhook'), true);
      const eventId = crypto.randomBytes(32).toString('hex');
      await admitAgentNotification(pool, space, actor, { ...input, eventId, scope: receiverScope });
      let calls = 0;
      const worker = new WebhookDeliveryWorker(pool, { transport: async (target, options) => {
        calls++; const payload = JSON.parse(options.body);
        assert.ok(!options.body.includes('NEVER_TRANSPORT_PROMPT')); assert.equal(options.headers['X-Webhook-Signature'], undefined);
        if (new URL(target).hostname === 'hooks.slack.com') {
          assert.equal(payload.blocks[0].text.type, 'plain_text'); return { status: 200, body: 'ok' };
        }
        assert.equal(new URL(target).searchParams.get('wait'), 'true'); assert.deepEqual(payload.allowed_mentions, { parse: [] });
        return { status: 200, body: '{"id":"123456789012345678"}' };
      } });
      while (await worker.tick()) {} worker.close();
      assert.equal(calls, 2);
      assert.equal(Number((await pool.query("SELECT count(*) FROM webhook_deliveries WHERE notification_workspace_id=$1 AND state='delivered'", [space])).rows[0].count), 2);
      await admitAgentNotification(pool, space, actor, { ...input, eventId: crypto.randomBytes(32).toString('hex'), scope: receiverScope });
      const unconfirmed = new WebhookDeliveryWorker(pool, { transport: async () => ({ status: 204, body: '' }) });
      while (await unconfirmed.tick()) {} unconfirmed.close();
      assert.equal(Number((await pool.query("SELECT count(*) FROM webhook_deliveries WHERE notification_workspace_id=$1 AND state='failed' AND error_code='delivery_ack_unconfirmed'", [space])).rows[0].count), 2);
    });
  } finally { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
});
