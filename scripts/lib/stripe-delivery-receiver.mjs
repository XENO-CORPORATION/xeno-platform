import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

// Resolve only the generated quick-tunnel host; preserve SNI and TLS validation.
export async function probeTunnel(url) {
  const target = new URL(url);
  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/api\/billing\/webhook$/.test(url)) throw new Error('invalid_probe_target');
  const answer = await fetch(`https://dns.google/resolve?name=${target.hostname}&type=A`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  const addresses = (answer.Status === 0 ? answer.Answer || [] : []).filter(a => a.type === 1 && isIP(a.data) === 4).map(a => a.data);
  const address = addresses.find(ip => { const [a, b] = ip.split('.').map(Number); return (a === 104 && b >= 16 && b <= 31) || (a === 172 && b >= 64 && b <= 71); });
  if (!address) throw new Error('probe_dns_unresolved');
  return new Promise((resolve, reject) => {
    const req = https.request(target, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      lookup: (_host, options, done) => options.all ? done(null, [{ address, family: 4 }]) : done(null, address, 4) }, res => {
      let body = ''; res.on('data', chunk => { body = (body + chunk).slice(0, 256); });
      res.on('end', () => resolve({ status: res.statusCode, valid: res.statusCode === 400 && body === 'invalid event' }));
    });
    const timer = setTimeout(() => req.destroy(new Error('probe_timeout')), 5000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end('{}');
  });
}

export function isolatedEnvironment(source) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|LANG|LC_ALL|TEMP|TMP)$/i;
  return { ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key))),
    NODE_ENV: 'test', STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY: source.STRIPE_PUBLISHABLE_KEY,
    STRIPE_EXPECTED_ACCOUNT_ID: source.STRIPE_EXPECTED_ACCOUNT_ID, STRIPE_EXPECTED_MODE: source.STRIPE_EXPECTED_MODE };
}

export function deliveryReceiver({ getServices, pool, maxBytes = 1024 * 1024, maxInFlight = 8 }) {
  const counters = { accepted: 0, rejected: 0, failed: 0 };
  const receipts = [];
  const outageReceipts = [];
  let paused = false;
  let inFlight = 0;
  const idleWaiters = [];
  const server = http.createServer(async (req, res) => {
    const reply = (status, message) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(message); } };
    if (req.method !== 'POST' || req.url !== '/api/billing/webhook') return reply(404, 'not found');
    if (!getServices()) return reply(503, 'not ready');
    if (inFlight >= maxInFlight) return reply(503, 'busy');
    if (req.headers['content-encoding'] || req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(415, 'unsupported body');
    inFlight++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) { counters.rejected++; reply(413, 'too large'); return; }
        chunks.push(chunk);
      }
      const services = getServices();
      let event;
      try {
        event = services.constructEvent(Buffer.concat(chunks), req.headers['stripe-signature']);
        if (event?.livemode !== false || event.account != null) throw new Error('wrong_event_mode');
      } catch { counters.rejected++; reply(400, 'invalid event'); return; }
      if (paused) {
        counters.rejected++;
        if (/^evt_[A-Za-z0-9_]+$/.test(event.id || '') && /^[a-z_.]+$/.test(event.type || '')
          && /^[a-z]+_[A-Za-z0-9_]+$/.test(event.data?.object?.id || '')) {
          outageReceipts.push({ id: event.id, type: event.type, objectId: event.data.object.id, status: 503 });
          if (outageReceipts.length > 1000) outageReceipts.shift();
        }
        reply(503, 'qualification outage'); return;
      }
      const result = await services.handleEvent(pool, event);
      if (/^evt_[A-Za-z0-9_]+$/.test(event.id || '') && /^[a-z_.]+$/.test(event.type || '')
        && /^[a-z]+_[A-Za-z0-9_]+$/.test(event.data?.object?.id || '')) {
        receipts.push({ id: event.id, type: event.type, objectId: event.data.object.id,
          reconciled: result?.handled === true && !result.reason });
        if (receipts.length > 1000) receipts.shift();
      }
      counters.accepted++; reply(200, 'received');
    } catch { counters.failed++; reply(500, 'handler failed'); }
    finally { inFlight--; if (!inFlight) for (const resolve of idleWaiters.splice(0)) resolve(); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 15_000; server.timeout = 15_000;
  server.on('timeout', socket => socket.destroy());
  return { server, counters, receipts, outageReceipts,
    setPaused(value) { if (typeof value !== 'boolean') throw new Error('invalid_pause'); paused = value; },
    waitForIdle: (timeoutMs = 15_000) => inFlight === 0 ? Promise.resolve() : new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = idleWaiters.indexOf(done); if (index >= 0) idleWaiters.splice(index, 1);
        reject(new Error('receiver_drain_timeout'));
      }, timeoutMs);
      idleWaiters.push(done);
    }) };
}
