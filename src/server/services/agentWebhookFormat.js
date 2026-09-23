// Receiver-specific formatting for the existing approved workspace webhook lane.
// URL custody and DNS/redirect policy remain with the server's bounded transport.
const statuses = { 'agent.finished': 'completed', 'agent.failed': 'failed', 'agent.cancelled': 'cancelled' };
function refuse() { const error = new Error('Workspace notification receiver configuration is invalid'); error.code = 'notification_receiver_invalid'; throw error; }
function identifier(value) { if (typeof value !== 'string' || !/^[a-z0-9_:-]{1,240}$/i.test(value)) refuse(); return value; }

export function agentWebhookReceiver(destinationUrl) {
  const url = new URL(destinationUrl);
  if (!['hooks.slack.com', 'discord.com'].includes(url.hostname)) return null;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) refuse();
  let receiver;
  if (url.hostname === 'hooks.slack.com') {
    if (!/^\/services\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname) || url.search) refuse();
    receiver = 'slack';
  } else {
    if (!/^\/api(?:\/v\d{1,2})?\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]{40,200}$/.test(url.pathname)
      || [...url.searchParams.keys()].some(key => key !== 'wait') || url.searchParams.getAll('wait').length > 1) refuse();
    url.searchParams.set('wait', 'true'); // Discord's no-wait success is not a saved-message ACK.
    receiver = 'discord';
  }
  return { receiver, url: url.toString() };
}

export function agentWebhookRequest(destinationUrl, delivery) {
  // Never reinterpret legacy/global webhook payloads as Agent metadata.
  if (!delivery.notification_workspace_id) return null;
  const target = agentWebhookReceiver(destinationUrl);
  if (!target) return null;
  const payload = delivery.payload;
  if (!Object.hasOwn(statuses, delivery.event) || !payload || payload.event !== delivery.event || typeof payload.occurredAt !== 'string' || !Number.isFinite(Date.parse(payload.occurredAt))) refuse();
  const text = `XENO Agent ${statuses[delivery.event]}\nWorkspace: ${identifier(payload.scope?.workspaceId)}\nConversation: ${identifier(payload.conversationId)}\nRun: ${identifier(payload.requestId)}\nTime: ${new Date(payload.occurredAt).toISOString()}\nDelivery: ${identifier(delivery.id)}`;
  const body = target.receiver === 'slack'
    ? { text, blocks: [{ type: 'section', text: { type: 'plain_text', text, emoji: false } }], unfurl_links: false, unfurl_media: false }
    : { content: text, allowed_mentions: { parse: [] } };
  return { ...target, body: JSON.stringify(body) };
}

export function agentWebhookAcknowledged(receiver, response) {
  if (receiver === 'slack') return response.status === 200 && typeof response.body === 'string' && response.body.trim() === 'ok';
  if (receiver === 'discord') {
    if (response.status !== 200 || typeof response.body !== 'string') return false;
    try { const id = JSON.parse(response.body)?.id; return typeof id === 'string' && /^\d{17,20}$/.test(id); } catch { return false; }
  }
  return false;
}
