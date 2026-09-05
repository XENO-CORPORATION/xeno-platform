import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

test('palette contains tab focus, preserves native button keys and returns focus on dismissal', async t => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root, act;
  t.after(async () => {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await build({
    entryPoints: ['src/components/platform/PlatformCommandPalette.tsx'], bundle: true,
    format: 'esm', jsx: 'automatic', external: ['react', 'react-dom'],
    outfile: 'scripts/harness/.command-keyboard.generated.mjs', logLevel: 'error',
    plugins: [{ name: 'isolated-resource-fixture', setup(b) {
      b.onResolve({ filter: /services\/accountService$/ }, () => ({ path: 'resources', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export async function listWorkspaces(){return {workspaces:[]}}; export async function listProjects(){return {projects:[]}};' }));
    } }],
  });
  const React = await import('react');
  ({ act } = await import('react-dom/test-utils'));
  const { createRoot } = await import('react-dom/client');
  const { default: Palette } = await import('./harness/.command-keyboard.generated.mjs');
  const navigations = [];
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Search'),
      React.createElement(Palette, { open, onClose: () => setOpen(false), onNavigate: path => navigations.push(path) }));
  }
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Harness)));
  const opener = document.getElementById('opener');
  async function open() { opener.focus(); await act(async () => opener.click()); }
  async function key(target, value, extra = {}) {
    const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
    await act(async () => target.dispatchEvent(event));
    return event;
  }
  await open();
  const input = document.querySelector('input');
  assert.equal(document.activeElement, input);
  const controls = [...document.querySelector('[role="dialog"]').querySelectorAll('input,button')];
  const last = controls.at(-1);
  await key(input, 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, last);
  await key(last, 'Tab');
  assert.equal(document.activeElement, input);
  const close = document.querySelector('[aria-label="Close command palette"]');
  close.focus();
  assert.equal((await key(close, 'Enter')).defaultPrevented, false);
  assert.deepEqual(navigations, [], 'Enter on a button must not choose the search result');
  await act(async () => close.click()); // jsdom does not synthesize native button clicks from keys.
  assert.equal(document.activeElement, opener);
  await open();
  await key(document.querySelector('input'), 'Escape');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, opener);
  await open();
  const search = document.querySelector('input');
  await key(search, 'Enter', { isComposing: true });
  assert.deepEqual(navigations, []);
  await key(search, 'ArrowDown');
  await key(search, 'Enter');
  assert.deepEqual(navigations, ['/overview/chat/search']);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
