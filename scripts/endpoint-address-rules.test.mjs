/**
 * The address rules behind every user-supplied endpoint: BYOK inference bases, webhook
 * destinations, notification receivers. They decide whether a URL the user chose is allowed
 * to become a request from inside our network, so each rule is pinned here rather than left
 * to be re-derived by whoever next edits the file.
 *
 * WHY THIS SUITE EXISTS: the durable webhook worker made these rules reachable from a new
 * direction -- a POST body, to a URL the user registered. A mutation sweep then found that
 * removing the IPv4-mapped IPv6 decode broke NOTHING, because no test covered it. A fix with
 * no failing gate is indistinguishable from a comment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isForbiddenAddress, isXenoHost, assertSafeEndpointUrl } from '../src/server/utils/safeEndpoint.js';

test('private, loopback and metadata IPv4 is refused; ordinary public IPv4 is not', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1',
                    '169.254.169.254', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isForbiddenAddress(ip), true, `${ip} must be refused`);
  }
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '192.169.0.1']) {
    assert.equal(isForbiddenAddress(ip), false, `${ip} is public and must be allowed`);
  }
});

test('documentation ranges are refused — reserved, never a real destination', () => {
  for (const ip of ['198.51.100.7', '203.0.113.9']) {
    assert.equal(isForbiddenAddress(ip), true, `${ip} is TEST-NET and must be refused`);
  }
});

test('an IPv4-mapped IPv6 loopback cannot smuggle a private address past the IPv4 rules', () => {
  // THE BYPASS THIS PINS, measured against the version that shipped before it: the dotted
  // form was unwrapped, the HEX form was not. `::ffff:7f00:1` is the same loopback and
  // `::ffff:a9fe:a9fe` is the cloud metadata address -- both were ALLOWED, and a user-supplied
  // endpoint (BYOK inference base, webhook destination) could therefore reach either.
  //
  // Two independent rules now refuse them -- the mapped decode and the global-unicast floor --
  // so removing either ALONE still passes. That is deliberate defence in depth, and it is why
  // this asserts the OUTCOME rather than a mechanism: only removing both reproduces the old
  // behaviour, and then these assertions fail.
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
                    '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1']) {
    assert.equal(isForbiddenAddress(ip), true, `${ip} decodes to a private address and must be refused`);
  }
  // The same decode must not refuse a mapped PUBLIC address: over-blocking is a real bug too.
  assert.equal(isForbiddenAddress('::ffff:1.1.1.1'), false);
});

test('IPv6 is restricted to global unicast, and the tunnelling prefixes are refused', () => {
  for (const ip of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
                    '2002::1',        // 6to4 — carries an embedded IPv4 destination
                    '2001:0::1',      // Teredo
                    '2001:db8::1']) { // documentation
    assert.equal(isForbiddenAddress(ip), true, `${ip} must be refused`);
  }
  assert.equal(isForbiddenAddress('2606:4700:4700::1111'), false, 'public IPv6 must be allowed');
});

test('a value that is not an address at all is refused, never assumed safe', () => {
  for (const value of ['', 'localhost', 'example.com', '999.999.999.999', 'not-an-ip', null, undefined]) {
    assert.equal(isForbiddenAddress(value), true, `${String(value)} must fail closed`);
  }
});

test('the endpoint itself must be https, hostless and credential-free', () => {
  const refused = (url, code) => assert.throws(() => assertSafeEndpointUrl(url),
    (error) => { assert.equal(error.code, code, `${url} -> ${error.code}`); return true; });
  refused('http://example.com/v1', 'endpoint_not_https');
  refused('https://user:pass@example.com/v1', 'endpoint_has_credentials');
  refused('https://127.0.0.1/v1', 'endpoint_forbidden_address');
  refused('https://[::ffff:127.0.0.1]/v1', 'endpoint_forbidden_address');
  assert.ok(assertSafeEndpointUrl('https://api.example.com/v1'));
});

test('XENO itself is refused as an endpoint — it is how the gateway called itself in a loop', () => {
  for (const host of ['xenostudio.ai', 'api.xenostudio.ai', 'XENOSYSTEM.AI', 'registry.xenosystem.ai', 'a.b.xenostudio.ai.']) {
    assert.equal(isXenoHost(host), true, `${host} is ours`);
  }
  for (const host of ['example.com', 'notxenostudio.ai', 'xenostudio.ai.evil.com']) {
    assert.equal(isXenoHost(host), false, `${host} is not ours`);
  }
  assert.throws(() => assertSafeEndpointUrl('https://api.xenostudio.ai/v1'), (e) => e.code === 'endpoint_is_xeno');
});

test('a refused endpoint is the caller\'s mistake, so it carries a 400 rather than reading as a fault', () => {
  for (const url of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://api.xenostudio.ai/v1']) {
    assert.throws(() => assertSafeEndpointUrl(url), (error) => { assert.equal(error.http, 400); return true; });
  }
});
