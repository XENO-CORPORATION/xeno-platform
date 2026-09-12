import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { upstreamFetch, UpstreamError, breakerSnapshot, _resetForTests } from '../services/upstream.js';

let hits = 0, mode = 'ok';
const server = http.createServer((req, res) => {
  hits += 1;
  if (mode === 'hang') return;                       // accept, never answer
  if (mode === '500') { res.writeHead(500); return res.end('nope'); }
  if (mode === '400') { res.writeHead(400); return res.end('bad'); }
  if (mode === 'slow') { setTimeout(() => { res.writeHead(200); res.end('ok'); }, 300); return; }
  res.writeHead(200); res.end('ok');
});
const base = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
const reset = (m = 'ok') => { hits = 0; mode = m; _resetForTests(); };

test('a hanging upstream TIMES OUT instead of holding the worker forever', async () => {
  reset('hang');
  const t0 = Date.now();
  await assert.rejects(
    () => upstreamFetch(`${base}/x`, { target: 'hangtest', timeoutMs: 250, retries: 0 }),
    (e) => e instanceof UpstreamError && e.code === 'upstream_timeout',
  );
  assert.ok(Date.now() - t0 < 2000, 'must fail fast, not hang');
});

test('retry happens ONLY when the caller declares the call idempotent', async () => {
  reset('500');
  await upstreamFetch(`${base}/x`, { target: 'r1', retries: 2, idempotent: false, timeoutMs: 500 });
  assert.equal(hits, 1, 'a non-idempotent call must NOT be retried — it could double-charge');

  reset('500');
  await upstreamFetch(`${base}/x`, { target: 'r2', retries: 2, idempotent: true, timeoutMs: 500 });
  assert.equal(hits, 3, 'an idempotent 5xx should be retried to the bound');
});

test('a 4xx is NOT retried — the request is wrong, repeating it is just load', async () => {
  reset('400');
  const res = await upstreamFetch(`${base}/x`, { target: 'r3', retries: 3, idempotent: true, timeoutMs: 500 });
  assert.equal(res.status, 400);
  assert.equal(hits, 1);
});

test('the breaker OPENS and then fails fast without touching the upstream', async () => {
  reset('500');
  for (let i = 0; i < 5; i += 1) {
    await upstreamFetch(`${base}/x`, { target: 'brk', retries: 0, timeoutMs: 500, failureThreshold: 5 });
  }
  assert.equal(breakerSnapshot().find((b) => b.target === 'brk').state, 'open');

  const before = hits;
  await assert.rejects(
    () => upstreamFetch(`${base}/x`, { target: 'brk', retries: 0, timeoutMs: 500 }),
    (e) => e.code === 'circuit_open',
  );
  assert.equal(hits, before, 'an open breaker must not reach the upstream at all');
});

test('the BULKHEAD caps concurrency so one target cannot starve the rest', async () => {
  reset('slow');
  let peak = 0;
  const probe = setInterval(() => {
    const b = breakerSnapshot().find((x) => x.target === 'bh');
    if (b) peak = Math.max(peak, b.inFlight);
  }, 10);
  await Promise.all(Array.from({ length: 12 }, () =>
    upstreamFetch(`${base}/x`, { target: 'bh', maxConcurrent: 3, timeoutMs: 3000, retries: 0 })));
  clearInterval(probe);
  assert.ok(peak <= 3, `in-flight peaked at ${peak}, must never exceed maxConcurrent=3`);
  assert.equal(hits, 12, 'every request still completes — capped, not dropped');
});

test.after(() => server.close());
