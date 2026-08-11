/**
 * The visitor's real IP address.
 *
 * WHY THIS EXISTS: `req.ip` was already being used, and `app.set('trust proxy', 1)`
 * was already set — and every one of the 408 rows in `user_sessions` still recorded
 * a Docker-internal address (`172.20.0.1`, the bridge gateway). Real browser
 * sessions from real users logged the container network, not the internet. Every
 * security event, every session row and every audit trail was therefore blind.
 *
 * The chain is  visitor → Cloudflare → nginx → backend , and the hop count that
 * `trust proxy: 1` assumes does not match it. Rather than guess at a number that
 * silently breaks again whenever the ingress changes, read the header Cloudflare
 * guarantees.
 *
 * ORDER, and why:
 *   1. `CF-Connecting-IP` — set by Cloudflare on every proxied request, always the
 *      true client. Cloudflare STRIPS any client-supplied copy, so it cannot be
 *      spoofed from outside as long as Cloudflare is the only ingress.
 *   2. `X-Forwarded-For` leftmost — standard fallback if the request somehow
 *      arrives without Cloudflare.
 *   3. `req.ip` — last resort; may be a container address, which is the bug above.
 *
 * ⚠️ `X-Forwarded-For` IS client-spoofable. It is used only as a fallback, and
 * anything derived from it should be treated as a hint, not as an identity.
 */

/** Strip the IPv4-mapped IPv6 prefix. `::ffff:172.20.0.1` → `172.20.0.1`. */
export function normalizeIp(value) {
  const ip = String(value || '').trim();
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** True for loopback / RFC1918 / Docker-bridge space — i.e. "this is not a visitor". */
export function isPrivateIp(value) {
  const ip = normalizeIp(value);
  if (!ip) return true;
  return /^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd)/.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function clientIp(req) {
  const cf = normalizeIp(req.headers?.['cf-connecting-ip']);
  if (cf) return cf;

  const xff = req.headers?.['x-forwarded-for'];
  if (xff) {
    // Leftmost entry is the originating client; the rest are proxies.
    const first = normalizeIp(String(xff).split(',')[0]);
    if (first) return first;
  }

  return normalizeIp(req.ip) || null;
}

export default clientIp;
