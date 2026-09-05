/** Read-only qualification. Unknown provider state must never produce a green gate. */
export async function verifyBillingWebhooks({ stripe, source, expectedUrl, liveMode }) {
  const handled = [...new Set([...source.matchAll(/case '([a-z_]+\.[a-z_.]+)':/g)].map(match => match[1]))].sort();
  if (handled.length < 5) throw new Error('Handled billing events could not be derived; webhook coverage is unverified.');
  const target = new URL(expectedUrl);
  if (target.username || target.password || target.search || target.hash || !['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Billing webhook URL must be an HTTP(S) endpoint without credentials, query or fragment.');
  }
  if (liveMode && target.protocol !== 'https:') throw new Error('Live billing requires an HTTPS webhook endpoint.');
  const matching = [];
  let cursor;
  const visited = new Set();
  for (let page = 0; page < 100; page++) {
    const result = await stripe.webhookEndpoints.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(result?.data) || typeof result.has_more !== 'boolean') throw new Error('Malformed webhook listing; coverage is unverified.');
    matching.push(...result.data.filter(endpoint => endpoint.url === target.href));
    if (!result.has_more) {
      if (!matching.length) throw new Error('No webhook endpoint matches this billing application.');
      const problems = [];
      for (const endpoint of matching) {
        if (endpoint.status !== 'enabled') problems.push('A matching billing webhook is disabled.');
        if (endpoint.livemode !== liveMode) problems.push('Billing webhook mode differs from the configured Stripe key.');
        const enabled = new Set(endpoint.enabled_events || []);
        const missing = enabled.has('*') ? [] : handled.filter(event => !enabled.has(event));
        if (missing.length) problems.push(`Billing webhook is missing handled events: ${missing.join(', ')}.`);
      }
      if (problems.length) throw new Error(problems.join(' '));
      return { endpointCount: matching.length, eventCount: handled.length };
    }
    cursor = result.data.at(-1)?.id;
    if (!cursor || visited.has(cursor)) throw new Error('Webhook pagination did not advance; coverage is unverified.');
    visited.add(cursor);
  }
  throw new Error('Webhook listing exceeded its safety bound; coverage is unverified.');
}
