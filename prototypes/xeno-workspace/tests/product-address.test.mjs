// product-address — the product hosts' addresses (address.js HOST_ROUTES), with no browser: address.js is run against a
// stub `location` per host, and every address a person can hold is mapped to the router's form and back unchanged.
//   node --test prototypes/xeno-workspace/tests/product-address.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const SRC = readFileSync(new URL('../address.js', import.meta.url), 'utf8');
function addrOn(host, pathname = '/') {
  const ctx = { location: { hostname: host, origin: 'https://' + host, pathname, search: '', hash: '', href: 'https://' + host + pathname },
    document: { documentElement: { dataset: {} } }, history: { pushState() {}, replaceState() {}, state: null },
    addEventListener() {}, dispatchEvent() {}, PopStateEvent: class {}, HashChangeEvent: class {}, URL };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { A: ctx.XENO_ADDR, ctx };
}
const ID = '00000001-0000-4000-8000-000000000000', PJ = '0000000a-0000-4000-8000-00000000000a';

test('chat.xenosystem.ai: the chat, its conversations and projects have the host\'s own addresses', () => {
  const { A, ctx } = addrOn('chat.xenosystem.ai');
  assert.equal(A.product, 'chat'); assert.equal(ctx.document.documentElement.dataset.product, 'chat');
  const url = (h) => A.url(h).replace('https://chat.xenosystem.ai', '');
  for (const [hash, path] of [
    ['#/overview/p/chat', '/'],
    [`#/overview/p/chat/${ID}`, `/c/${ID}`],
    [`#/overview/p/chat/projects/${PJ}`, `/projects/${PJ}`],
    [`#/overview/p/chat/projects/${PJ}/c/${ID}`, `/projects/${PJ}/c/${ID}`],
    ['#/overview/g/library', '/library'],
    ['#/studio/p/image', '/images'],
  ]) {
    assert.equal(url(hash), path, `${hash} is shown as ${path}`);
    ctx.location.pathname = path; assert.equal(A.current(), hash, `${path} opens ${hash}`);
  }
  // a chat started in another area is still the chat; a place that is not the host's opens in the full workspace
  assert.equal(A.url('#/overview/g/tasks/T-4'), 'https://xenosystem.ai/workspace/tasks/T-4');
  assert.equal(A.url('#/studio/p/video'), 'https://xenosystem.ai/workspace/studio/generate/video');
  // an old workspace link still opens on the host
  ctx.location.pathname = `/workspace/apps/chat/${ID}`; assert.equal(A.current(), `#/overview/p/chat/${ID}`);
});

test('tasks.xenosystem.ai keeps its addresses', () => {
  const { A, ctx } = addrOn('tasks.xenosystem.ai');
  assert.equal(A.url('#/overview/g/tasks/T-4'), 'https://tasks.xenosystem.ai/T-4');
  assert.equal(A.url('#/overview/g/tasks'), 'https://tasks.xenosystem.ai/');
  ctx.location.pathname = '/My%20tasks'; assert.equal(A.current(), '#/overview/g/tasks/My%20tasks');
  ctx.location.pathname = '/'; assert.equal(A.current(), '#/overview/g/tasks');
  assert.equal(A.url('#/overview/p/chat'), 'https://xenosystem.ai/workspace/apps/chat');
});

test('the main site is not a product host', () => {
  const { A } = addrOn('xenosystem.ai', '/workspace');
  assert.equal(A.product, null);
  assert.equal(A.url('#/overview/p/chat'), 'https://xenosystem.ai/workspace/apps/chat');
});
