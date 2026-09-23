import assert from 'node:assert/strict';
import test from 'node:test';
import { agentWebhookRequest, agentWebhookAcknowledged } from '../src/server/services/agentWebhookFormat.js';
const slack = 'https://hooks.slack.com/services/T123/B123/fixture-token';
const discord = `https://discord.com/api/webhooks/123456789012345678/${'x'.repeat(68)}`;
const delivery = { id: 'delivery-1', notification_workspace_id: 'workspace-1', event: 'agent.finished', payload: { event: 'agent.finished', scope: { workspaceId: 'local-w' }, conversationId: 'conv', requestId: 'run', occurredAt: '2026-09-05T12:00:00Z', prompt: 'PRIVATE_PROMPT', authorization: 'PRIVATE_KEY' } };
test('Slack gets bounded plain metadata and no automatic unfurling or private payload fields', () => {
  const request = agentWebhookRequest(slack, delivery), body = JSON.parse(request.body);
  assert.equal(request.receiver, 'slack'); assert.equal(body.blocks[0].text.type, 'plain_text');
  assert.equal(body.unfurl_links, false); assert.equal(body.unfurl_media, false);
  assert.match(body.text, /XENO Agent completed/); assert.ok(!request.body.includes('PRIVATE'));
});
test('Discord waits for acknowledgement and suppresses mention expansion', () => {
  const request = agentWebhookRequest(`${discord}?wait=false`, delivery);
  assert.equal(new URL(request.url).search, '?wait=true');
  assert.deepEqual(JSON.parse(request.body).allowed_mentions, { parse: [] });
  assert.ok(!request.body.includes('PRIVATE'));
});
test('generic and legacy webhook behavior is unchanged', () => {
  assert.equal(agentWebhookRequest('https://example.test/webhook', delivery), null);
  assert.equal(agentWebhookRequest(slack, { ...delivery, notification_workspace_id: null }), null);
});
test('invalid receiver paths, routing overrides, and untrusted metadata refuse safely', () => {
  for (const url of ['http://hooks.slack.com/services/T/B/token', 'https://hooks.slack.com/arbitrary', `${slack}?redirect=elsewhere`, `${discord}?thread_id=123`, `${discord}?wait=true&wait=false`, `${discord}#fragment`]) {
    assert.throws(() => agentWebhookRequest(url, delivery), { code: 'notification_receiver_invalid' });
  }
  assert.throws(() => agentWebhookRequest(slack, { ...delivery, payload: { ...delivery.payload, requestId: '@everyone' } }), { code: 'notification_receiver_invalid' });
  assert.throws(() => agentWebhookRequest(slack, { ...delivery, event: 'constructor', payload: { ...delivery.payload, event: 'constructor' } }), { code: 'notification_receiver_invalid' });
});
test('only receiver-specific acknowledgements count as accepted delivery', () => {
  assert.equal(agentWebhookAcknowledged('slack', { status: 200, body: 'ok' }), true);
  assert.equal(agentWebhookAcknowledged('slack', { status: 200, body: 'invalid_payload' }), false);
  assert.equal(agentWebhookAcknowledged('discord', { status: 204, body: '' }), false);
  assert.equal(agentWebhookAcknowledged('discord', { status: 200, body: '{"id":"123456789012345678"}' }), true);
  assert.equal(agentWebhookAcknowledged('discord', { status: 200, body: '{}' }), false);
});
