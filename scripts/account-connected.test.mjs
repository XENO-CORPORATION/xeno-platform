// /account/connected: the one page every third-party return lands on. The query string only SELECTS from a closed
// vocabulary; nothing from the URL is ever rendered, and it is outside the site gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const src = readFileSync(new URL('../src/lib/accountConnected.ts', import.meta.url), 'utf8');
const { code } = transformSync(src, { loader: 'ts', format: 'esm' });
const { connectedView, RESULTS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('every result has its own page, for Google Drive returning to Storage', () => {
  const seen = new Set();
  for (const r of RESULTS) {
    const v = connectedView(`?result=${r}&provider=google&service=drive&app=storage`);
    assert.equal(v.result, r); seen.add(v.title);
    assert.match(v.body, /XENO Storage/);
  }
  assert.equal(seen.size, RESULTS.length);
  assert.equal(connectedView('?result=completed&provider=google&service=drive&app=storage').title, 'Google Drive connected');
  assert.match(connectedView('?result=scope_not_granted&provider=google&service=drive&app=storage').body, /see, edit, create and delete your Google Drive files/);
});
test('the URL can choose, never write: unknown values fall back, nothing is echoed', () => {
  const evil = '<script>alert(1)</script>';
  const v = connectedView(`?result=${encodeURIComponent(evil)}&provider=${encodeURIComponent(evil)}&service=__proto__&app=constructor`);
  assert.equal(v.result, 'failed');
  assert.ok(!JSON.stringify(v).includes('script'));
  assert.match(v.body, /XENO and try again/);
  assert.equal(connectedView('?result=completed&provider=meta&service=drive').title, 'Meta connected', 'a service must belong to its provider');
});
test('it is outside the site gate', () => {
  const conf = readFileSync(new URL('../nginx/default.conf', import.meta.url), 'utf8');
  assert.match(conf, /location ~ \^\/\(account\/connected\|login\|/);
});
