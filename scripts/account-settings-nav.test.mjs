import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

test('compact dashboard search stays named and mobile chat stays inside its interface slot', () => {
  const dashboard = readFileSync('src/components/overview/Overview.tsx', 'utf8');
  const command = dashboard.match(/<button\b[^>]*className="xeno-dashboard-command"[^>]*>/)?.[0];
  assert.ok(command);
  assert.match(command, /aria-label="Search or enter a command"/);
  assert.match(command, /onClick=\{onOpenCommandPalette\}/);
  const chat = readFileSync('src/components/playground/Chat/ChatWithLLM.tsx', 'utf8');
  const mobile = chat.match(/\.chat-mobile-container\s*\{([^}]+)\}/)?.[1];
  assert.ok(mobile);
  assert.match(mobile, /position:\s*absolute;/);
  assert.doesNotMatch(mobile, /position:\s*fixed;/);
  const container = readFileSync('src/components/playground/Chat/MultiChatContainer.tsx', 'utf8');
  assert.match(container, /className=\{`relative h-full min-h-0 overflow-hidden/);
  const workbench = readFileSync('src/components/overview/platform-workbench.css', 'utf8');
  assert.match(workbench, /\.xeno-session-row\s*\{\s*flex-wrap:\s*wrap;/);
  assert.match(workbench, /\.xeno-session-row \.xeno-row-action:not\(\.is-danger\)\s*\{\s*display:\s*inline-flex;/);
});

test('account navigation retains names when mobile labels are hidden and navigates all destinations', async t => {
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
    entryPoints: ['src/components/account/AccountSettingsNav.tsx'], bundle: true,
    format: 'esm', jsx: 'automatic', external: ['react', 'react-dom', 'react-router-dom'],
    outfile: 'scripts/harness/.account-nav.generated.mjs', logLevel: 'error',
  });
  const React = await import('react');
  ({ act } = await import('react-dom/test-utils'));
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, useLocation } = await import('react-router-dom');
  const { default: Nav } = await import('./harness/.account-nav.generated.mjs');
  function Location() {
    const location = useLocation();
    return React.createElement('output', null, location.pathname + location.hash);
  }
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/overview/settings'] },
    React.createElement(Nav), React.createElement(Location))));
  const destinations = {
    Profile: '/overview/profile', Preferences: '/overview/settings', Members: '/overview/team',
    Teams: '/overview/teams', Security: '/overview/settings#security', Integrations: '/overview/integrations',
    Billing: '/overview/billing', Notifications: '/overview/notifications',
  };
  assert.equal(document.querySelectorAll('nav button').length, Object.keys(destinations).length);
  for (const [label, destination] of Object.entries(destinations)) {
    const button = document.querySelector(`nav button[aria-label="${label}"]`);
    assert.ok(button, `${label} must be named independently of its hidden span`);
    button.querySelector('span').style.display = 'none'; // jsdom is not a layout proof.
    assert.equal(button.title, label);
    assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
    button.focus();
    assert.equal(document.activeElement, button);
    await act(async () => button.click());
    assert.equal(document.querySelector('output').textContent, destination);
    assert.equal(button.getAttribute('aria-current'), 'page');
    assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
  }
});
