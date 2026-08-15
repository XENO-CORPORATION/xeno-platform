/**
 * Pins client-IP resolution (src/server/utils/clientIp.js).
 *
 * Written because `req.ip` + `trust proxy` looked correct and produced a Docker
 * bridge address for every real session ever recorded. The tests therefore assert
 * the ORDER of precedence, not just that a value comes back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, normalizeIp, isPrivateIp } from '../src/server/utils/clientIp.js';

const req = (headers = {}, ip = undefined) => ({ headers, ip });

test('CF-Connecting-IP wins — it is the one Cloudflare guarantees', () => {
  assert.equal(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }, '172.20.0.1')), '203.0.113.7');
});

test('falls back to the LEFTMOST X-Forwarded-For entry', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 172.68.1.1, 172.20.0.5' }, '172.20.0.1')), '203.0.113.7');
});

test('falls back to req.ip only when no proxy headers exist', () => {
  assert.equal(clientIp(req({}, '203.0.113.9')), '203.0.113.9');
});

test('strips the IPv4-mapped IPv6 prefix', () => {
  // The exact shape found in production: ::ffff:172.20.0.5
  assert.equal(clientIp(req({}, '::ffff:172.20.0.5')), '172.20.0.5');
  assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
});

test('the regression itself: a container address is recognised as NOT a visitor', () => {
  // The bug that hid this for months — these all read as real IPs to a naive check.
  for (const ip of ['172.20.0.1', '172.18.0.3', '::ffff:172.20.0.5', '10.0.0.4', '127.0.0.1', '192.168.1.9']) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be recognised as private/internal`);
  }
  for (const ip of ['203.0.113.7', '8.8.8.8', '::ffff:203.0.113.7']) {
    assert.equal(isPrivateIp(ip), false, `${ip} is a real visitor address`);
  }
});

test('survives a request with no headers and no ip', () => {
  assert.equal(clientIp({ headers: undefined, ip: undefined }), null);
  assert.equal(clientIp(req({}, undefined)), null);
});

// ── IPv6 rate-limit keying ─────────────────────────────────────────────────
//
// 🔴 Found from a startup warning that had been printing on every boot and read
// by nobody: ERR_ERL_KEY_GEN_IPV6. An IPv6 user is not one address, it is a
// whole ISP allocation, so keying a rate limit on the full address lets them
// rotate freely and never hit it. IPv4 has no equivalent problem, which is why
// this stays invisible in any v4-only test and then does nothing in production.
//
// Not theoretical here: one of the three accounts created after the 2026-08-11
// lockdown signed up from an IPv6 address.

import { readFileSync } from 'node:fs';
import { rateLimitKey } from '../src/server/utils/clientIp.js';

const reqFrom = (ip) => ({ headers: { 'cf-connecting-ip': ip }, ip });

test('IPv4 keys are unchanged', () => {
  assert.equal(rateLimitKey(reqFrom('45.160.243.255')), '45.160.243.255');
});

test('two IPv6 addresses in ONE allocation share a bucket', () => {
  // The whole point. Without this, 18 quintillion addresses = 18 quintillion
  // buckets, and the limit is decorative.
  const a = rateLimitKey(reqFrom('2600:1702:7fc8:e00:35ea:1:2:3'));
  const b = rateLimitKey(reqFrom('2600:1702:7fc8:e00:ffff:9:9:9'));
  assert.equal(a, b, 'same allocation must produce the same key');
  assert.notEqual(a, '2600:1702:7fc8:e00:35ea:1:2:3', 'the full address must not be the key');
});

test('...but different allocations stay separate', () => {
  // Asserted in BOTH directions: a key that collapsed everyone into one bucket
  // would pass the test above and lock out the whole internet.
  assert.notEqual(
    rateLimitKey(reqFrom('2600:1702:7fc8:e00::1')),
    rateLimitKey(reqFrom('2600:1702:7fc8:f00::1')),
  );
});

test('a missing address does not become a shared bucket by accident', () => {
  assert.equal(rateLimitKey({ headers: {} }), 'unknown');
});

test('the limiters USE it — clientIp is no longer a keyGenerator', () => {
  const index = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(index, /keyGenerator:\s*clientIp\b/,
    'clientIp as a keyGenerator is the IPv6 bypass. It stays correct for '
    + 'LOGGING, where the exact address is the point.');
  assert.match(index, /keyGenerator:\s*rateLimitKey/, 'the limiters must use the safe key.');

  const limiter = readFileSync(new URL('../src/server/middleware/rateLimiter.js', import.meta.url), 'utf8');
  assert.match(limiter, /return rateLimitKey\(req\)/,
    'rateLimiter.normalizeIp feeds five limiters; it was named for IPv6 '
    + 'compatibility and provided none.');
});
