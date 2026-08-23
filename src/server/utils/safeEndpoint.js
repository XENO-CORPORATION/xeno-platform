/**
 * safeEndpoint — outbound HTTP to a URL the USER chose.
 *
 * WHY THIS EXISTS
 * ---------------
 * BYOK has to accept an OpenAI-compatible `base_url`: Ollama, self-hosted
 * gateways, Azure OpenAI, and our own xeno-rt. Refusing arbitrary endpoints
 * would exclude our own product, so an allow-list was rejected (spec §12.3).
 *
 * That makes a user-supplied URL a **server-side request forgery primitive**,
 * aimed at a host that shares a private network with `xeno-proxy` on loopback
 * :8317, Postgres, Redis and Meilisearch. "Verify this key for me" would
 * otherwise be a free GET from inside the perimeter.
 *
 * WHAT MAKES THIS DIFFERENT FROM A URL REGEX
 * ------------------------------------------
 * Validating the hostname proves nothing: DNS answers can change between the
 * check and the connect (rebinding), and a name can simply resolve to 127.0.0.1
 * on the first try. So the guard runs at **connect time**, inside the socket
 * `lookup` hook, on the address the socket is actually about to use. A hostname
 * that resolves to a private address fails there, every time, with no window.
 *
 * Redirects are refused outright rather than followed-and-rechecked. A 302 to
 * 169.254.169.254 is the classic bypass, and nothing legitimate needs a redirect
 * to answer "list your models".
 *
 * Built on node:https with a custom `lookup` rather than fetch/undici: undici is
 * only transitively present here, and a security control must not rest on a
 * dependency that `npm prune` can remove.
 */

import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

/** Hard ceilings. A verification call is a small GET; nothing here is a stream. */
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

/**
 * Is this address one we must never let a user-supplied URL reach?
 *
 * Deliberately a DENY list of address SPACE, not of hosts. Cloud metadata
 * (169.254.169.254) is covered by link-local rather than named specially —
 * naming it invites the belief that naming it is sufficient.
 */
export function isForbiddenAddress(ip) {
  if (typeof ip !== 'string' || !ip) return true; // unparseable → refuse

  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is the same machine as the v4 address.
  // Checking only the v6 form is a real bypass.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isForbiddenAddress(mapped[1]);

  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 0) return true;                          // "this network"
    if (a === 10) return true;                         // RFC1918
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // RFC1918
    if (a === 192 && b === 168) return true;           // RFC1918
    if (a === 192 && b === 0) return true;             // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                         // multicast + reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;        // unspecified, loopback
    const head = v.split(':')[0];
    if (/^f[cd]/.test(head)) return true;              // fc00::/7 unique-local
    if (/^fe[89ab]/.test(head)) return true;           // fe80::/10 link-local
    if (/^ff/.test(head)) return true;                 // multicast
    return false;
  }

  return true; // not an IP at all → refuse
}

/**
 * Structural check on the URL itself. Runs BEFORE any DNS, so an obviously bad
 * value never becomes a network operation.
 *
 * Throws with a `code` the caller can turn into a typed 4xx.
 */
export function assertSafeEndpointUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    const e = new Error('endpoint is not a valid URL');
    e.code = 'endpoint_invalid';
    throw e;
  }

  // https only. Plaintext http would put the user's provider key on the wire in
  // the clear; "but it's only localhost" does not apply — a managed credential
  // is used from OUR server, where localhost is OUR network.
  if (url.protocol !== 'https:') {
    const e = new Error('endpoint must use https');
    e.code = 'endpoint_not_https';
    throw e;
  }

  // Credentials in the URL end up in logs and Referer headers.
  if (url.username || url.password) {
    const e = new Error('endpoint must not embed credentials');
    e.code = 'endpoint_has_credentials';
    throw e;
  }

  // A literal private address needs no DNS to be dangerous.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if ((net.isIP(literal) && isForbiddenAddress(literal))) {
    const e = new Error('endpoint resolves to a non-public address');
    e.code = 'endpoint_forbidden_address';
    throw e;
  }

  return url;
}

/**
 * DNS lookup hook that refuses to hand the socket a forbidden address.
 *
 * This is the actual control. Everything above is early rejection; this is what
 * closes the rebinding window, because it runs on the address being connected to.
 */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const safe = list.filter((a) => !isForbiddenAddress(a.address));
    if (safe.length === 0) {
      const e = new Error(`refusing to connect to ${hostname}: resolves to a non-public address`);
      e.code = 'endpoint_forbidden_address';
      return callback(e);
    }
    // Node calls back with (err, address, family) unless `all` was requested by
    // the CALLER — options.all reflects what the socket asked for, not our probe.
    if (options && options.all) return callback(null, safe);
    return callback(null, safe[0].address, safe[0].family);
  });
}

/**
 * GET a user-chosen endpoint and return { status, body }.
 *
 * Never throws on a non-2xx — an upstream 401 is a RESULT (the key is wrong),
 * not an error of ours. It throws only when we refuse to make the call, or the
 * network fails.
 *
 * 🔴 The caller passes the provider key in `headers`. Nothing in here logs
 * `headers`, and errors are constructed from status + host, never from the
 * request. A stack trace carrying the request object is a leak.
 */
export function safeGet(rawUrl, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const url = assertSafeEndpointUrl(rawUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        lookup: guardedLookup,
        timeout: timeoutMs,
      },
      (res) => {
        // Refuse redirects rather than following and re-checking. A 302 into the
        // metadata service is the textbook bypass and nothing legitimate needs
        // one to answer a models listing.
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          const e = new Error('endpoint issued a redirect, which is refused');
          e.code = 'endpoint_redirect_refused';
          return reject(e);
        }

        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            const e = new Error('endpoint response exceeded the size cap');
            e.code = 'endpoint_response_too_large';
            return reject(e);
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => reject(scrub(err)));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const e = new Error('endpoint timed out');
      e.code = 'endpoint_timeout';
      reject(e);
    });
    req.on('error', (err) => reject(scrub(err)));
    req.end();
  });
}

/**
 * Never let a transport error carry the request (and therefore the Authorization
 * header) out of this module.
 */
function scrub(err) {
  const e = new Error(err && err.code === 'endpoint_forbidden_address'
    ? err.message
    : `endpoint request failed (${(err && err.code) || 'network error'})`);
  e.code = (err && err.code) || 'endpoint_unreachable';
  return e;
}

export default { safeGet, assertSafeEndpointUrl, isForbiddenAddress };
