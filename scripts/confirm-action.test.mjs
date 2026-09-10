/**
 * The promise-based confirm/prompt host, driven through a real DOM.
 *
 * This is the piece 41 `confirm()`/`prompt()` conversions rest on, so it has to
 * behave exactly like the blocking calls it replaces: resolve false on cancel,
 * resolve the typed value on submit, and — the part that is easy to get wrong —
 * settle EXACTLY ONCE per question.
 *
 * ⚠️ On that last one, be precise about what this file does and does not prove.
 * It asserts the OUTCOME — two overlapping questions each resolve on their own
 * answer — which is the behaviour callers depend on. It does NOT prove the
 * settle-once guard in confirmAction.tsx is load-bearing: removing that guard
 * leaves every test here green, because ActionDialog's onClose is itself guarded
 * by `mounted.current` and the `key` remount fires first. The guard is retained
 * as defence against a refactor that drops the key, and is documented there as
 * unexercised rather than as a bug that was caught.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import path from 'node:path';

let React, act, createRoot, Host, confirmAction, promptAction, dom, root, container;
const previous = new Map();

before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'localStorage']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    configurable: true, get() { return this.parentElement; },
  });
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ act } = await import('react-dom/test-utils'));
  ({ createRoot } = await import('react-dom/client'));

  await build({
    stdin: {
      contents: `export { ConfirmActionHost, confirmAction, promptAction } from './src/components/platform/confirmAction';`,
      resolveDir: process.cwd(),
    },
    bundle: true, format: 'esm', jsx: 'automatic', logLevel: 'error',
    external: ['react', 'react-dom'],
    outfile: 'scripts/harness/.confirm-action.generated.mjs',
    define: { 'import.meta.env.DEV': 'false' },
    alias: {
      '@xenosystem/elements-react': path.resolve('packages/elements-react/src/index.ts'),
      '@xenosystem/elements': path.resolve('packages/elements/src'),
      '@xenosystem/generate': path.resolve('packages/generate/src/index.ts'),
    },
    plugins: [{
      name: 'confirm-fixture-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /platformTheme$/ }, () => ({ path: 'platformTheme', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: "export const usePlatformTheme = () => ({ resolvedTheme: 'dark', themeStyle: {} });",
          loader: 'js',
        }));
      },
    }],
  });
  ({ ConfirmActionHost: Host, confirmAction, promptAction } = await import('./harness/.confirm-action.generated.mjs'));
});

after(() => {
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function mount() {
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(React.createElement(Host)); });
}

function unmount() {
  act(() => { root.unmount(); });
  container.remove();
}

const dialog = () => dom.window.document.querySelector('[role="dialog"]');
const buttonNamed = (label) => [...dom.window.document.querySelectorAll('button')]
  .find((b) => b.textContent.trim().toLowerCase() === label.toLowerCase());

async function flush() { await act(async () => { await Promise.resolve(); }); }

test('confirm resolves true only when confirmed', async () => {
  mount();
  const answer = confirmAction({ title: 'Delete this?', detail: 'It cannot be undone.', confirmLabel: 'Delete' });
  await flush();
  assert.ok(dialog(), 'a dialog is showing');
  act(() => { buttonNamed('Delete').click(); });
  await flush();
  assert.equal(await answer, true);
  assert.equal(dialog(), null, 'and it closed itself');
  unmount();
});

test('cancel resolves false, like a dismissed confirm()', async () => {
  mount();
  const answer = confirmAction({ title: 'Delete this?', detail: 'It cannot be undone.' });
  await flush();
  act(() => { buttonNamed('Cancel').click(); });
  await flush();
  assert.equal(await answer, false);
  unmount();
});

test('prompt returns the typed value, and null when cancelled — prompt()’s contract', async () => {
  mount();
  const typed = promptAction({ title: 'Rename', detail: 'Pick a new name.', fieldLabel: 'Name', initialValue: 'old' });
  await flush();
  const field = dom.window.document.querySelector('input[type="text"], input:not([type])');
  assert.ok(field, 'a text field is showing');
  assert.equal(field.value, 'old', 'seeded with the initial value');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(field, 'new name');
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await flush();
  act(() => { buttonNamed('Save').click(); });
  await flush();
  assert.equal(await typed, 'new name');

  const cancelled = promptAction({ title: 'Rename', detail: 'Pick a new name.', fieldLabel: 'Name' });
  await flush();
  act(() => { buttonNamed('Cancel').click(); });
  await flush();
  assert.equal(await cancelled, null);
  unmount();
});

test('a choice question can only return one of its choices', async () => {
  mount();
  const chosen = promptAction({
    title: 'Flag', detail: 'Why?', fieldLabel: 'Reason',
    choices: [{ value: 'spam', label: 'Spam' }, { value: 'abuse', label: 'Abuse' }],
    confirmLabel: 'Send',
  });
  await flush();
  assert.equal(dom.window.document.querySelectorAll('input[type="radio"]').length, 2);
  assert.equal(buttonNamed('Send').disabled, true, 'nothing chosen yet, so it cannot be sent');
  const radio = dom.window.document.querySelector('input[value="abuse"]');
  act(() => { radio.click(); });
  await flush();
  act(() => { buttonNamed('Send').click(); });
  await flush();
  assert.equal(await chosen, 'abuse');
  unmount();
});

test('each question settles EXACTLY once, and a queued one is not stolen', async () => {
  /* Two overlapping questions is the shape a queue exists for, and the outcome
   * callers depend on: each resolves on its own answer, and neither is stolen by
   * the other's close. See the file header on what this does not prove. */
  mount();
  const first = confirmAction({ title: 'First', detail: 'one', confirmLabel: 'Yes' });
  const second = confirmAction({ title: 'Second', detail: 'two', confirmLabel: 'Yes' });
  await flush();
  assert.match(dialog().textContent, /First/, 'the first question is showing');

  act(() => { buttonNamed('Yes').click(); });
  await flush();
  assert.equal(await first, true, 'the first resolved true');

  assert.ok(dialog(), 'the second question is now showing, not silently resolved');
  assert.match(dialog().textContent, /Second/);
  act(() => { buttonNamed('Yes').click(); });
  await flush();
  assert.equal(await second, true, 'the second resolved on its OWN answer');
  unmount();
});

test('with no host mounted a question resolves rather than hanging forever', async () => {
  // A promise that never settles is a caller frozen on a dialog nobody can see.
  // Cancelled is the safe answer: it performs no action.
  assert.equal(await confirmAction({ title: 'Nothing is mounted', detail: 'x' }), false);
  assert.equal(await promptAction({ title: 'Nothing is mounted', detail: 'x', fieldLabel: 'y' }), null);
});
