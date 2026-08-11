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
