// Test-only preloader: the isolated gateway may open sockets only to this proof's
// loopback fixtures. Enforce before importing server.js, including background probes.
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const ports = new Set(JSON.parse(process.env.WORKFORCE_LOOPBACK_PORTS || '[]'));
if (!ports.size || [...ports].some(p => !Number.isInteger(p) || p < 1 || p > 65535)) throw Error('Explicit fixture ports required');
const allowed = (host, port) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && ports.has(Number(port));
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const opts = typeof first === 'object' && first ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!allowed(opts.host || 'localhost', opts.port)) throw Error('WORKFORCE_FIXTURE_EGRESS_REFUSED');
  return connect.apply(this, args);
};
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80))) throw Error('WORKFORCE_FIXTURE_EGRESS_REFUSED');
  return originalFetch(input, { ...options, redirect: 'error' });
};
