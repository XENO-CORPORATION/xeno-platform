/**
 * The grant-exchange transport gate decides on SOCKET facts, never on headers.
 *
 * Measured on production 2026-09-17 before this gate existed in its current form:
 *   - WireGuard peer, plain HTTP, no header            -> 400 tls_required   (wrong: refused the real caller)
 *   - CDN origin, nginx forwards X-Forwarded-Proto=http -> 400 tls_required   (wrong: refused the real caller)
 *   - plain HTTP + forged `X-Forwarded-Proto: https`     -> 200, resolved      (wrong: trusted a client claim)
 *
 * Every case below is a mutation target. Named mutations, and which test fails:
 *   - re-read `x-forwarded-proto` in transportIsConfidential   -> "a forged X-Forwarded-Proto header is worthless"
 *   - default to trusted when the CIDR list is empty           -> "no configured peers means no trusted peers"
 *   - drop the ::ffff: normalization                            -> "IPv4-mapped IPv6 is the same peer"
 *   - widen a /32 to match neighbours                           -> "a /32 admits exactly one address"
 *   - stop honouring socket.encrypted                           -> "TLS terminated at this process is confidential"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transportIsConfidential, isTrustedPeer, parsePeerEntry, trustedPeerEntries, normalizeAddress, requireTls,
} from '../src/server/routes/inferenceGrantAuth.js';

const PEER = { INFERENCE_TRUSTED_PEER_CIDRS: '10.99.0.2/32' };
const req = (socket, headers = {}) => ({ socket, headers, get: (h) => headers[h.toLowerCase()] });

test('the WireGuard peer over plain HTTP is confidential transport', () => {
  assert.equal(transportIsConfidential(req({ remoteAddress: '10.99.0.2' }), PEER), true);
});

test('IPv4-mapped IPv6 is the same peer — Node reports it that way on dual-stack sockets', () => {
  assert.equal(normalizeAddress('::ffff:10.99.0.2'), '10.99.0.2');
  assert.equal(transportIsConfidential(req({ remoteAddress: '::ffff:10.99.0.2' }), PEER), true);
});

test('a forged X-Forwarded-Proto header is worthless — the decision never reads it', () => {
  // The exact request that resolved with 200 on production: plain HTTP from an
  // address that is not the peer, carrying a header that says https.
  const forged = req({ remoteAddress: '172.20.0.9', encrypted: false }, { 'x-forwarded-proto': 'https' });
  assert.equal(transportIsConfidential(forged, PEER), false);
});

test('the CDN path is not confidential even when nginx would forward https', () => {
  // nginx's container address on the compose bridge, header as the CDN leg would set it.
  const viaNginx = req({ remoteAddress: '::ffff:172.20.0.3' }, { 'x-forwarded-proto': 'https' });
  assert.equal(transportIsConfidential(viaNginx, PEER), false,
    'a CDN that terminated TLS has seen the plaintext; that is not a confidential path for a provider key');
});

test('TLS terminated at this process is confidential regardless of address', () => {
  assert.equal(transportIsConfidential(req({ remoteAddress: '203.0.113.7', encrypted: true }), PEER), true);
  assert.equal(transportIsConfidential(req({ remoteAddress: '203.0.113.7', encrypted: true }), {}), true);
});

test('no configured peers means no trusted peers — fail closed, never open', () => {
  assert.equal(transportIsConfidential(req({ remoteAddress: '10.99.0.2' }), {}), false);
  assert.equal(transportIsConfidential(req({ remoteAddress: '10.99.0.2' }), { INFERENCE_TRUSTED_PEER_CIDRS: '' }), false);
  assert.equal(transportIsConfidential(req({ remoteAddress: '10.99.0.2' }), { INFERENCE_TRUSTED_PEER_CIDRS: ' , ,' }), false);
});

test('a /32 admits exactly one address', () => {
  const entries = trustedPeerEntries(PEER);
  assert.equal(isTrustedPeer('10.99.0.2', entries), true);
  assert.equal(isTrustedPeer('10.99.0.3', entries), false);
  assert.equal(isTrustedPeer('10.99.0.1', entries), false, 'our own wg address is not the peer');
  assert.equal(isTrustedPeer('10.99.1.2', entries), false);
});

test('a wider prefix matches its range and nothing outside it', () => {
  const entries = trustedPeerEntries({ INFERENCE_TRUSTED_PEER_CIDRS: '10.99.0.0/24' });
  assert.equal(isTrustedPeer('10.99.0.2', entries), true);
  assert.equal(isTrustedPeer('10.99.0.254', entries), true);
  assert.equal(isTrustedPeer('10.99.1.1', entries), false);
});

test('malformed entries contribute nothing — a typo must never widen trust', () => {
  assert.equal(parsePeerEntry('10.99.0.2/33'), null);
  assert.equal(parsePeerEntry('10.99.0.256'), null);
  assert.equal(parsePeerEntry('not-an-address'), null);
  assert.equal(parsePeerEntry('10.99.0.2/-1'), null);
  const mixed = trustedPeerEntries({ INFERENCE_TRUSTED_PEER_CIDRS: 'garbage, 10.99.0.2/32, 10.99.0.999' });
  assert.equal(mixed.length, 1, 'only the valid entry survives');
  assert.equal(isTrustedPeer('10.99.0.2', mixed), true);
});

test('an IPv6 peer is exact-match only', () => {
  const entries = trustedPeerEntries({ INFERENCE_TRUSTED_PEER_CIDRS: 'fd00::2' });
  assert.equal(isTrustedPeer('fd00::2', entries), true);
  assert.equal(isTrustedPeer('FD00::2', entries), true);
  assert.equal(isTrustedPeer('fd00::3', entries), false);
  assert.equal(parsePeerEntry('fd00::/64'), null, 'v6 CIDR is deliberately unsupported here');
});

test('the middleware enforces in production and answers the code the gateway already handles', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevPeers = process.env.INFERENCE_TRUSTED_PEER_CIDRS;
  process.env.NODE_ENV = 'production';
  process.env.INFERENCE_TRUSTED_PEER_CIDRS = '10.99.0.2/32';
  try {
    const res = () => {
      const r = { statusCode: 200, body: null };
      r.status = (c) => { r.statusCode = c; return r; };
      r.json = (b) => { r.body = b; return r; };
      return r;
    };
    let passed = false;
    const ok = res();
    requireTls(req({ remoteAddress: '::ffff:10.99.0.2' }), ok, () => { passed = true; });
    assert.equal(passed, true, 'the WireGuard peer passes');

    passed = false;
    const refused = res();
    requireTls(req({ remoteAddress: '172.20.0.9' }, { 'x-forwarded-proto': 'https' }), refused, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(refused.statusCode, 400);
    // The gateway maps exactly this code to a typed 503 (byokEgress.js) so a
    // transport misconfiguration is visible, never a silent fallback to premium.
    assert.equal(refused.body.error.code, 'tls_required');
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
    if (prevPeers === undefined) delete process.env.INFERENCE_TRUSTED_PEER_CIDRS; else process.env.INFERENCE_TRUSTED_PEER_CIDRS = prevPeers;
  }
});
