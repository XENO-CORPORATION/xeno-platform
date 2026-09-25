import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

test('real lazy route delays loading, preserves surrounding state and recovers from rejection', async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root, React, act;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  React = await import('react');
  ({ act } = await import('react-dom/test-utils'));
  const { createRoot } = await import('react-dom/client');
  await build({
    entryPoints: ['src/components/platform/lazyRoute.tsx'], bundle: true, format: 'esm', jsx: 'automatic',
    external: ['react', 'react-dom'], outfile: 'scripts/harness/.lazy-route.generated.mjs', logLevel: 'error',
    alias: {
      '@xenosystem/elements-react': path.resolve('packages/elements-react/src/index.ts'),
      '@xenosystem/elements': path.resolve('packages/elements/src'),
      '@xenosystem/generate': path.resolve('packages/generate/src/index.ts'),
    },
  });
  const { lazyRoute, ROUTE_LOADING_DELAY_MS } = await import('./harness/.lazy-route.generated.mjs');
  let rejectFirst, calls = 0;
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  const Route = lazyRoute(() => {
    calls++;
    return calls === 1 ? first : Promise.resolve({ default: props => React.createElement('p', null, props.label) });
  });
  assert.equal(calls, 0, 'declaring a route must not fetch its module');
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement('section', null,
    React.createElement('input', { defaultValue: 'unsaved draft' }), React.createElement(Route, { label: 'Loaded route' }))));
  assert.equal(calls, 1);
  const input = document.querySelector('input');
  input.value = 'still editing';
  const status = document.querySelector('[role="status"][aria-busy="true"]');
  assert.ok(status, 'a loading route announces itself');
  assert.match(status.textContent, /Loading page/, 'and says what is loading — to assistive technology');
  // it takes the page's theme — a bare `.xeno` is the library's DARK default, which is how the old
  // card rendered dark on a light page (2026-09-25)
  assert.ok(status.classList.contains('xeno') && ['light', 'dark'].includes(status.getAttribute('data-theme')),
    `the loader carries the resolved platform theme (data-theme=${status.getAttribute('data-theme')})`);
  assert.equal(status.querySelector('.xeno-card'), null, 'no card: a loading route is a bar, not a block in the page');
  // nothing visible for a fast load — the bar appears only once the delay has passed
  assert.equal(document.querySelector('[role="progressbar"]'), null, 'no bar before the delay, so a fast chunk never flashes');
  await act(async () => { await new Promise(r => setTimeout(r, ROUTE_LOADING_DELAY_MS + 40)); });
  const bar = document.querySelector('[role="progressbar"]');
  assert.ok(bar, 'the bar appears once the route has taken longer than the delay');
  assert.equal(bar.hasAttribute('aria-valuenow'), false, 'indeterminate: it claims no position');
  assert.equal(document.querySelector('.xeno-progressbar-header'), null, 'no visible "Loading page —" caption');
  t.mock.method(console, 'error', () => {}); // Expected React error-boundary diagnostic.
  await act(async () => { rejectFirst(new Error('fixture chunk unavailable')); });
  assert.ok(document.querySelector('[role="alert"]'));
  assert.match(document.body.textContent, /Reloading may discard unsaved changes/);
  assert.equal(document.querySelector('input'), input);
  assert.equal(input.value, 'still editing');
  const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Try again');
  assert.equal(document.activeElement, retry);
  await act(async () => retry.click());
  assert.equal(calls, 2, 'retry must replace the failed React.lazy instance');
  assert.match(document.body.textContent, /Loaded route/);
  assert.equal(document.querySelector('[role="alert"]'), null);
  assert.equal(document.querySelector('[role="status"]'), null);
  assert.equal(document.querySelector('input'), input);
  assert.equal(input.value, 'still editing');
});

test('workspace and creative routes are not eager imports; fallback has no local visual controls', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const name of [
    'OverviewPage', 'MultiChatContainer', 'OSHomeInterface', 'OSAuthWithContainers',
    'ProductPage', 'Privacy', 'Pricing', 'Onboarding', 'OSAuthInterface', 'OSContainerWizard', 'AuthContent'
  ]) {
    assert.match(app, new RegExp(`const ${name} = lazyRoute\\(`));
    assert.doesNotMatch(app, new RegExp(`import ${name} from`));
  }
  const overview = readFileSync(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(overview, /^import .* from ['"].*\/playground\//m);
  const fallback = readFileSync(new URL('../src/components/platform/lazyRoute.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(fallback, /<button\b|<progress\b|style=|#[a-fA-F\d]{3,8}\b/);
  assert.match(fallback, /from '@xenosystem\/elements-react'/);
  assert.equal((fallback.match(/window\.location\.reload/g) || []).length, 1);
  assert.match(fallback, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
});
