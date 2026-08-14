/**
 * Tests for the session User-Agent classifier.
 *
 * `user_sessions.device_type`, `.browser` and `.os` have existed since the baseline
 * and were never written — every session row in production is blank in all three.
 *
 * The interesting cases are the ORDERING traps, which are the whole difficulty of UA
 * parsing: Edge and Opera both contain "Chrome", Chrome contains "Safari", and iPadOS
 * reports itself as Macintosh. A parser that checks in the wrong order labels every
 * Edge user "Chrome" and looks correct in casual testing.
 *
 * Run: node --test scripts/user-agent.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseBrowser, parseOs, parseDeviceType, describeClient } = await import(
  '../src/server/utils/userAgent.js'
);

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWin:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  operaWin:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefoxLin:'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  safariIphone:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeAndroid:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet:'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ipad:      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  curl:      'curl/8.4.0',
};

// ── The ordering traps ──────────────────────────────────────────────────────

test('Edge is not reported as Chrome', () => {
  // Edge's UA contains "Chrome/126". A naive check labels every Edge user Chrome.
  assert.equal(parseBrowser(UA.edgeWin), 'Edge');
});

test('Opera is not reported as Chrome', () => {
  assert.equal(parseBrowser(UA.operaWin), 'Opera');
});

test('Chrome is not reported as Safari', () => {
  // Chrome's UA ends "Safari/537.36".
  assert.equal(parseBrowser(UA.chromeWin), 'Chrome');
});

test('real Safari is still Safari', () => {
  assert.equal(parseBrowser(UA.safariMac), 'Safari');
});

test('an iPad is iPadOS and a tablet, not macOS', () => {
  // iPadOS reports "Mac OS X" in the string; only the iPad token distinguishes it.
  assert.equal(parseOs(UA.ipad), 'iPadOS');
  assert.equal(parseDeviceType(UA.ipad), 'tablet');
});

test('an Android tablet is a tablet, a phone is mobile', () => {
  // The only difference is the "Mobile" token.
  assert.equal(parseDeviceType(UA.androidTablet), 'tablet');
  assert.equal(parseDeviceType(UA.chromeAndroid), 'mobile');
});

// ── Ordinary cases ──────────────────────────────────────────────────────────

test('os detection across the desktop platforms', () => {
  assert.equal(parseOs(UA.chromeWin), 'Windows');
  assert.equal(parseOs(UA.safariMac), 'macOS');
  assert.equal(parseOs(UA.firefoxLin), 'Linux');
});

test('iPhone is iOS and mobile', () => {
  assert.equal(parseOs(UA.safariIphone), 'iOS');
  assert.equal(parseDeviceType(UA.safariIphone), 'mobile');
});

test('desktop is inferred from the platform token', () => {
  assert.equal(parseDeviceType(UA.chromeWin), 'desktop');
  assert.equal(parseDeviceType(UA.firefoxLin), 'desktop');
});

// ── Degrades to null, never to a wrong guess ────────────────────────────────

test('an empty or missing UA yields nulls, not guesses', () => {
  for (const v of ['', null, undefined]) {
    assert.deepEqual(describeClient(v), { browser: null, os: null, deviceType: null });
  }
});

test('an unrecognizable UA yields nulls rather than a wrong label', () => {
  const d = describeClient('SomethingEntirelyNew/1.0');
  assert.equal(d.browser, null);
  assert.equal(d.os, null);
  assert.equal(d.deviceType, null);
});

test('a non-browser client is labelled, not mistaken for a browser', () => {
  assert.equal(parseBrowser(UA.curl), 'curl');
});

test('describeClient returns all three fields together', () => {
  assert.deepEqual(describeClient(UA.edgeWin), { browser: 'Edge', os: 'Windows', deviceType: 'desktop' });
});
