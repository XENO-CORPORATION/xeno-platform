/**
 * `/api/favicon` resolves a cited site's icon THROUGH US, and cannot be turned into a pivot.
 *
 * Driven with a fake fetch so nothing leaves the machine: the direct `/favicon.ico` path, the
 * `<link rel="icon">` fallback, the image sniff that refuses an HTML error page served as an
 * icon, the redirect hop that is guarded like the first request, and the domain validation
 * that keeps IP literals, single labels and paths out of the upstream URL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { iconLinkFromHtml, normalizeDomain, resolveFavicon, sniffImageType } from '../src/server/routes/faviconRoutes.js';
import { assertPublicHttpUrl } from '../src/server/utils/urlGuard.js';

// made-up hostnames resolve no DNS; an IP literal goes through the REAL guard, which is what the SSRF test proves
const guard = async (url) => { if (net.isIP(new URL(url).hostname.replace(/^\[|\]$/g, ''))) await assertPublicHttpUrl(url); };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]);

const response = (status, body, type, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (k) => ({ 'content-type': type, ...headers })[k.toLowerCase()] ?? null },
  body: null,
  arrayBuffer: async () => Buffer.from(body),
});

test('domain validation: hostnames only — no IPs, single labels, ports or paths', () => {
  assert.equal(normalizeDomain('Bloomberg.com'), 'bloomberg.com');
  assert.equal(normalizeDomain('en.wikipedia.org.'), 'en.wikipedia.org');
  for (const bad of ['127.0.0.1', '10.0.0.1', 'localhost', 'a/b.com', 'x.com:8080', '', ' ', '-bad.com', 'a..b']) {
    assert.equal(normalizeDomain(bad), null, `${bad} must be refused`);
  }
});

test('the sniff accepts real images and refuses an HTML page served as an icon', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(ICO), 'image/x-icon');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImageType(Buffer.from('<!doctype html><html>404</html>')), null);
});

test('the <link rel=icon> is found, resolved against the page, and preferred over apple-touch-icon', () => {
  const html = '<head><link rel="apple-touch-icon" href="/apple.png"><link rel="shortcut icon" href="static/fav.ico"></head>';
  assert.equal(iconLinkFromHtml(html, 'https://site.test/news/'), 'https://site.test/news/static/fav.ico');
  assert.equal(iconLinkFromHtml('<link rel="apple-touch-icon" href="/apple.png">', 'https://site.test/'), 'https://site.test/apple.png');
  assert.equal(iconLinkFromHtml('<link rel="stylesheet" href="/a.css">', 'https://site.test/'), null);
});

test('/favicon.ico first; when that is an HTML 404 in disguise, the page\'s <link> icon', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://site.test/favicon.ico') return response(200, '<html>not found</html>', 'text/html');
    if (url === 'https://site.test/') return response(200, '<html><head><link rel="icon" href="/i/fav.png"></head></html>', 'text/html; charset=utf-8');
    if (url === 'https://site.test/i/fav.png') return response(200, PNG, 'image/png');
    return response(404, '', 'text/plain');
  };
  const icon = await resolveFavicon('site.test', { fetchImpl, guard });
  assert.equal(icon?.type, 'image/png');
  assert.deepEqual(calls, ['https://site.test/favicon.ico', 'https://site.test/', 'https://site.test/i/fav.png']);
});

test('🔴 a redirect to a private address is refused — every hop is guarded, not just the first', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://site.test/favicon.ico') return response(302, '', '', { location: 'http://169.254.169.254/latest/meta-data/' });
    if (url === 'https://site.test/') return response(302, '', '', { location: 'http://127.0.0.1:5432/' });
    return response(200, PNG, 'image/png');
  };
  const icon = await resolveFavicon('site.test', { fetchImpl, guard });
  assert.equal(icon, null);
  assert.ok(!calls.some((u) => /169\.254|127\.0\.0\.1/.test(u)), `the private hop must never be fetched: ${calls.join(', ')}`);
});

test('no icon anywhere is a null, never a throw — the route turns it into a cached 404', async () => {
  const icon = await resolveFavicon('site.test', { fetchImpl: async () => { throw new Error('ECONNRESET'); }, guard });
  assert.equal(icon, null);
});
