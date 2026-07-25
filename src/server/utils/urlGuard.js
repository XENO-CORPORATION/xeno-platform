/**
 * URL guard — SSRF protection helper.
 *
 * assertPublicHttpUrl(url) validates that a user-supplied URL:
 *   - parses as a URL,
 *   - uses http: or https:,
 *   - does NOT point at loopback, private, link-local, CGNAT, or unspecified
 *     addresses (checked both for literal-IP hosts and for every address the
 *     hostname resolves to).
 *
 * Used by the browser proxy (/api/browser/*), webhook create/update, and the
 * media download routes. Throws an Error with .code = 'ERR_URL_FORBIDDEN' (or
 * 'ERR_URL_INVALID') so callers can map it to a 400.
 */

import dns from 'dns/promises';
import net from 'net';

function fail(message, code = 'ERR_URL_FORBIDDEN') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * True if an IPv4 dotted-quad string is loopback/private/link-local/etc.
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true; // be safe
  const [a, b] = parts;
  if (a === 0) return true;                       // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 10) return true;                      // 10.0.0.0/8
  if (a === 127) return true;                     // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;        // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;        // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * True if an IP (v4 or v6) is non-public.
 */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    if (lower === '::1' || lower === '::') return true;        // loopback / unspecified
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(lower)) return true;                  // fe80::/10 link-local
    return false;
  }
  return true; // not a recognizable IP — treat as unsafe
}

/**
 * Validate that `rawUrl` is an http(s) URL pointing at a PUBLIC host.
 * Resolves the hostname and rejects if ANY resolved address is private.
 * Returns the parsed URL object on success; throws on failure.
 */
export async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw fail('Invalid URL format', 'ERR_URL_INVALID');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw fail('URL must use http or https');
  }

  // URL puts IPv6 literals in brackets — strip them for net.isIP
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname) throw fail('URL has no hostname', 'ERR_URL_INVALID');

  // Obvious internal-name shortcuts
  const lowerHost = hostname.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost.endsWith('.local') ||
    lowerHost.endsWith('.internal')
  ) {
    throw fail('URL host is not allowed');
  }

  // Literal IP host
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw fail('URL resolves to a non-public address');
    return parsed;
  }

  // Hostname — resolve and check every address
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw fail('URL hostname could not be resolved');
  }
  if (!addresses || addresses.length === 0) {
    throw fail('URL hostname could not be resolved');
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw fail('URL resolves to a non-public address');
    }
  }

  return parsed;
}

export default { assertPublicHttpUrl, isPrivateIp };
