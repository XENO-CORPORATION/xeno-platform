/**
 * Shared service-token + confidential-transport gate for the grant-exchange surfaces.
 * INFERENCE_GRANT_TOKEN, fail-closed, constant-time. Not the ledger token.
 *
 * ── WHY THE TRANSPORT CHECK LOOKS THE WAY IT DOES ──────────────────────────
 *
 * /service/credential hands the gateway a customer's PLAINTEXT provider key
 * (spec §6). The transport that carries it must be confidential, and the
 * previous guard tried to establish that by reading `X-Forwarded-Proto`. That
 * was wrong in both directions, and both were measured on production
 * 2026-09-17:
 *
 *   - It REFUSED every legitimate caller. The gateway reaches this box over
 *     WireGuard as plain HTTP (no header at all), and via the CDN the header
 *     arrives as `http` because the tunnel leg into nginx is plain. Both got
 *     `400 tls_required`, so no BYOK route could ever resolve and the whole
 *     pipeline sat unreachable from the only caller that matters.
 *   - It ACCEPTED anyone who set the header. Plain HTTP over WireGuard with a
 *     forged `X-Forwarded-Proto: https` resolved with a 200. A header is a
 *     claim the client makes about itself; it is not evidence of anything.
 *
 * So the header is no longer consulted at all, and the decision is made on
 * facts the client cannot write:
 *
 *   1. `socket.encrypted` — TLS terminated at THIS process. Not how production
 *      is wired today, but it is the honest general case and costs nothing.
 *   2. `socket.remoteAddress` inside INFERENCE_TRUSTED_PEER_CIDRS — the
 *      WireGuard peer. The backend listens on 10.99.0.1 and loopback only, and
 *      wg0 has one peer whose AllowedIPs is 10.99.0.2/32: WireGuard's cryptokey
 *      routing drops any packet whose decrypted source does not match that
 *      peer's key, so a TCP connection arriving from 10.99.0.2 can only have
 *      come from the peer holding it. That is peer authentication AND
 *      confidentiality at the network layer — the same property TLS would give
 *      us, without a second PKI to rotate.
 *
 * The CDN path is deliberately NOT trusted, even when the header would be
 * `https`. "TLS to Cloudflare" means Cloudflare terminated it and saw the
 * plaintext — for a customer's provider key that is a third party in the
 * secret's path, which is exactly what confidential transport is meant to
 * exclude. If a future consumer genuinely needs the public origin for these
 * endpoints, that is a decision with a name, not a header to trust.
 *
 * Fail-closed: no CIDR list configured means no peer is trusted, so a fresh
 * or misconfigured deployment refuses rather than quietly opening.
 */
import crypto from 'node:crypto';
import net from 'node:net';

export function unauthorized(res) {
  return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
}

export function requireGrantToken(req, res, next) {
  const expected = process.env.INFERENCE_GRANT_TOKEN;
  if (!expected) return unauthorized(res);

  const header = req.headers.authorization || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return unauthorized(res);
  const presented = header.slice(prefix.length);
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return unauthorized(res);
  if (!crypto.timingSafeEqual(a, b)) return unauthorized(res);
  return next();
}

/** `::ffff:10.99.0.2` and `10.99.0.2` are the same peer. */
export function normalizeAddress(ip) {
  const s = String(ip || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  return mapped ? mapped[1] : s;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Parse `a.b.c.d/nn` or a bare address. Returns null for anything malformed —
 * a malformed entry must never widen trust, so it contributes nothing.
 */
export function parsePeerEntry(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const [addr, bitsStr] = raw.split('/');
  const ip = normalizeAddress(addr);
  if (net.isIPv4(ip)) {
    const base = ipv4ToInt(ip);
    if (base === null) return null;
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return { kind: 'v4', base: (base & mask) >>> 0, mask };
  }
  if (net.isIPv6(ip) && bitsStr === undefined) {
    // Exact-match only for v6. A v6 CIDR matcher is more surface than this
    // gate needs while the only trusted peer is a v4 WireGuard address.
    return { kind: 'v6', exact: ip.toLowerCase() };
  }
  return null;
}

export function trustedPeerEntries(env = process.env) {
  return String(env.INFERENCE_TRUSTED_PEER_CIDRS || '')
    .split(',')
    .map(parsePeerEntry)
    .filter(Boolean);
}

export function isTrustedPeer(remoteAddress, entries) {
  const ip = normalizeAddress(remoteAddress);
  if (!ip) return false;
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    if (n === null) return false;
    return entries.some((e) => e.kind === 'v4' && ((n & e.mask) >>> 0) === e.base);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return entries.some((e) => e.kind === 'v6' && e.exact === low);
  }
  return false;
}

/**
 * The transport decision, separated from the middleware so it can be asserted
 * against arbitrary socket shapes without standing up a listener.
 */
export function transportIsConfidential(req, env = process.env) {
  const socket = req.socket || {};
  if (socket.encrypted === true) return true;
  return isTrustedPeer(socket.remoteAddress, trustedPeerEntries(env));
}

export function requireTls(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (!transportIsConfidential(req)) {
    return res.status(400).json({
      error: {
        code: 'tls_required',
        message: 'grant exchange requires a confidential transport (TLS to this process, or a trusted peer link)',
      },
    });
  }
  return next();
}

export function sendGrantError(res, err) {
  const http = err && err.http ? err.http : 500;
  const code = (err && err.code) || 'PLATFORM_ERROR';
  const message = http === 500 ? 'grant exchange failed' : (err && err.message) || 'request failed';
  if (http === 500) console.error('[inference-grant] unhandled');
  return res.status(http).json({ error: { code, message } });
}
