import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import path from 'node:path';
import { readFileSync } from 'node:fs';

let React, act, createRoot, Router, Pages, dom;
const previous = new Map();
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'localStorage']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  // jsdom has no layout; explicitly model these fixture controls as visible.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentElement; } });
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ act } = await import('react-dom/test-utils'));
  ({ createRoot } = await import('react-dom/client'));
  Router = await import('react-router-dom');
  await build({
    stdin: { contents: `export { default as Projects } from './src/components/account/ProjectsPage';
      export { default as Settings } from './src/components/account/SettingsPage';
      export { default as Dialog } from './src/components/platform/ActionDialog';`, resolveDir: process.cwd() },
    bundle: true, format: 'esm', jsx: 'automatic', logLevel: 'error',
    external: ['react', 'react-dom', 'react-router-dom'], outfile: 'scripts/harness/.account-actions.generated.mjs',
    alias: {
      '@xenosystem/elements-react': path.resolve('packages/elements-react/src/index.ts'),
      '@xenosystem/elements': path.resolve('packages/elements/src'),
      '@xenosystem/generate': path.resolve('packages/generate/src/index.ts'),
    },
    plugins: [{ name: 'account-fixture-boundaries', setup(builder) {
      builder.onResolve({ filter: /(WorkspaceContext|AuthContext|accountService|userDataService|authService|platformTheme|ProjectTeamAssignments)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => {
        const sources = {
          WorkspaceContext: 'export const useWorkspace = () => globalThis.__accountFixture.workspace;',
          AuthContext: 'export const useAuth = () => ({logout: globalThis.__accountFixture.logout});',
          accountService: ['listProjects', 'createProject', 'updateProject', 'archiveProject', 'getAccountSessions', 'revokeAccountSession']
            .map(method => `export const ${method} = (...args) => globalThis.__accountFixture.api.${method}(...args);`).join('\n'),
          userDataService: 'export const userDataService = {getSettings: async () => ({}), updateSetting: async () => ({})};',
          authService: 'export const authService = {};',
          ProjectTeamAssignments: 'export default function Assignments() { return null; }',
          platformTheme: `export const usePlatformTheme = () => ({resolvedTheme: 'dark', themeStyle: {}});
            export const normalizePlatformTheme = () => 'dark'; export const normalizePlatformThemeBrightness = () => 0;
            export const getPlatformThemePosition = () => 0; export const savePlatformTheme = async () => ({});`,
        };
        return { contents: sources[name], loader: 'js' };
      });
    } }],
  });
  Pages = await import('./harness/.account-actions.generated.mjs');
});
after(() => {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  delete globalThis.__accountFixture;
});

const project = (id = 'p1', name = 'Original') => ({ id, name, settings: {}, updated_at: '2026-09-08T00:00:00Z' });
const session = current => ({ id: 's1', current, browser: 'Fixture browser', created_at: '2026-09-08T00:00:00Z', expires_at: '2026-09-15T00:00:00Z' });
function fixture(current = false) {
  const state = {
    workspace: { activeWorkspace: { id: 'w1', name: 'Workspace one' }, isLoading: false },
    projects: [project()], sessions: [session(current)], calls: [], loggedOut: 0,
  };
  state.logout = () => { state.loggedOut++; };
  state.api = {
    listProjects: async id => { state.calls.push(['list', id]); return { projects: state.projects }; },
    createProject: async () => { throw new Error('Unexpected create'); },
    updateProject: async (id, patch) => { state.calls.push(['update', id, patch]); return { project: { ...project(id), ...patch } }; },
    archiveProject: async id => { state.calls.push(['archive', id]); state.projects = []; return { success: true }; },
    getAccountSessions: async () => { state.calls.push(['sessions']); return { sessions: state.sessions }; },
    revokeAccountSession: async id => { state.calls.push(['revoke', id]); state.sessions = []; return { revoked_session_id: id }; },
  };
  globalThis.__accountFixture = state;
  return state;
}
async function mount(t, component) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); container.remove(); });
  const render = async element => act(async () => root.render(element));
  await render(component);
  return { container, render };
}
function page(kind) {
  function Location() {
    const navigate = Router.useNavigate();
    return React.createElement(React.Fragment, null,
      React.createElement('output', { 'data-location': true }, Router.useLocation().pathname),
      React.createElement('button', { onClick: () => navigate('/overview/projects/p2') }, 'Fixture route switch'));
  }
  return React.createElement(Router.MemoryRouter, { initialEntries: [kind === 'Projects' ? '/overview/projects/p1' : '/overview/settings'] },
    React.createElement(Router.Routes, null, React.createElement(Router.Route, { path: kind === 'Projects' ? '/overview/projects/:projectId?' : '*', element: React.createElement(Pages[kind]) })),
    React.createElement(Location));
}
const button = (name, root = document) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === name);
const dialog = () => document.querySelector('.xeno-modal[role="dialog"]');
async function click(node) { assert.ok(node); await act(async () => { node.focus(); node.click(); }); }
async function input(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function key(node, value, shiftKey = false) {
  await act(async () => { node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })); });
}

test('shared dialog: cancellation, focus entry/return and both Tab edges; no native dialogs', async t => {
  let calls = 0;
  function Harness() {
    const [open, setOpen] = React.useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      open && React.createElement(Pages.Dialog, { title: 'Confirm fixture', detail: 'Fixture only', confirmLabel: 'Confirm', onConfirm: async () => { calls++; }, onClose: () => setOpen(false) }));
  }
  fixture(); await mount(t, React.createElement(Harness));
  const opener = button('Open'); await click(opener);
  assert.equal(document.activeElement, dialog());
  await key(dialog(), 'Tab', true);
  assert.equal(document.activeElement, button('Confirm'));
  await key(button('Confirm'), 'Tab');
  assert.equal(document.activeElement, dialog().querySelector('button'));
  await key(document.activeElement, 'Escape');
  assert.equal(dialog(), null); assert.equal(document.activeElement, opener); assert.equal(calls, 0);
  for (const file of ['ProjectsPage.tsx', 'SettingsPage.tsx']) assert.doesNotMatch(readFileSync(`src/components/account/${file}`, 'utf8'), /window\.(prompt|confirm|alert)\(/);
});

test('pending operation blocks duplicate submit and every dismissal; rejected operation can retry', async t => {
  fixture(); let finish, calls = 0, closes = 0;
  await mount(t, React.createElement(Pages.Dialog, { title: 'Fixture', detail: 'Fixture', confirmLabel: 'Confirm',
    onConfirm: () => { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); }, onClose: () => { closes++; } }));
  const form = dialog().querySelector('form');
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.equal(calls, 1);
  assert.equal(document.activeElement, dialog());
  assert.ok([...dialog().querySelectorAll('button')].every(node => node.disabled));
  await key(dialog(), 'Escape');
  const scrim = document.querySelector('.xeno-modal-overlay');
  await act(async () => { scrim.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })); scrim.click(); });
  assert.equal(closes, 0);
  await act(async () => finish.reject(new Error('Retryable fixture failure')));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Retryable fixture failure/);
  await click(button('Confirm')); assert.equal(calls, 2);
  await act(async () => finish.resolve()); assert.equal(closes, 1);
});

test('project rename validates, trims and requires the exact server result', async t => {
  const state = fixture(); await mount(t, page('Projects'));
  await click(button('Rename'));
  const field = dialog().querySelector('input');
  assert.equal(field.value, 'Original'); assert.equal(field.maxLength, 255);
  await input(field, '   '); assert.equal(button('Save name').disabled, true);
  await input(field, '  Renamed  '); await click(button('Save name'));
  assert.deepEqual(state.calls.find(call => call[0] === 'update'), ['update', 'p1', { name: 'Renamed' }]);
  assert.equal(dialog(), null); assert.ok(document.body.textContent.includes('Renamed'));
  state.api.updateProject = async () => ({ project: project('wrong', 'Bad') });
  await click(button('Rename')); await input(dialog().querySelector('input'), 'Another'); await click(button('Save name'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /did not confirm/);
});

test('project archive requires explicit confirmation and a read-back showing no active target', async t => {
  const state = fixture(); await mount(t, page('Projects'));
  await click(button('Archive')); await click(button('Cancel'));
  assert.equal(state.calls.filter(call => call[0] === 'archive').length, 0);
  await click(button('Archive'));
  state.api.archiveProject = async id => { state.calls.push(['archive', id]); return { success: true }; };
  await click(button('Archive project'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /still active/);
  state.projects = []; await click(button('Archive project'));
  assert.equal(document.querySelector('[data-location]').textContent, '/overview/projects');
  assert.equal(state.calls.filter(call => call[0] === 'archive').length, 1);
});

test('workspace A to B to A invalidates pending project completion and its draft', async t => {
  const state = fixture(); let resolve;
  state.api.updateProject = () => new Promise(done => { resolve = done; });
  const screen = await mount(t, page('Projects'));
  await click(button('Rename')); await input(dialog().querySelector('input'), 'Stale result'); await click(button('Save name'));
  state.workspace = { activeWorkspace: { id: 'w2', name: 'Two' }, isLoading: false };
  state.projects = [project('p2', 'Other workspace')]; await screen.render(page('Projects'));
  assert.equal(dialog(), null);
  state.workspace = { activeWorkspace: { id: 'w1', name: 'One' }, isLoading: false };
  state.projects = [project()]; await screen.render(page('Projects'));
  await act(async () => resolve({ project: project('p1', 'Stale result') }));
  assert.ok(!document.body.textContent.includes('Stale result'));
  await click(button('Rename')); assert.equal(dialog().querySelector('input').value, 'Original');
});

test('current-session revocation validates receipt and logs out without a post-revocation inventory request', async t => {
  const state = fixture(true); await mount(t, page('Settings'));
  await click(button('Log out')); assert.equal(state.calls.filter(call => call[0] === 'revoke').length, 0);
  await click(button('Revoke session'));
  assert.equal(state.loggedOut, 1);
  assert.equal(state.calls.filter(call => call[0] === 'sessions').length, 1);
  assert.equal(document.querySelector('[data-location]').textContent, '/login');
});

test('same-workspace selection change invalidates a pending archive completion', async t => {
  const state = fixture(); let resolve;
  state.projects = [project(), project('p2', 'Other project')];
  state.api.archiveProject = () => new Promise(done => { resolve = done; });
  await mount(t, page('Projects'));
  await click(button('Archive')); await click(button('Archive project'));
  await click(button('Fixture route switch'));
  assert.equal(dialog(), null);
  state.projects = [project('p2', 'Other project')];
  const listCalls = state.calls.filter(call => call[0] === 'list').length;
  await act(async () => resolve({ success: true }));
  assert.equal(document.querySelector('[data-location]').textContent, '/overview/projects/p2');
  assert.equal(state.calls.filter(call => call[0] === 'list').length, listCalls);
  assert.ok(document.body.textContent.includes('Other project'));
});

test('uncertain current-session result offers sign-in recovery, never a blind second delete', async t => {
  const state = fixture(true);
  state.api.revokeAccountSession = async id => { state.calls.push(['revoke', id]); return { revoked_session_id: 'wrong' }; };
  await mount(t, page('Settings')); await click(button('Log out')); await click(button('Revoke session'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /not confirmed/);
  assert.equal(button('Revoke session'), undefined); assert.equal(state.loggedOut, 0);
  await click(button('Sign in again')); assert.equal(state.loggedOut, 1);
  assert.equal(state.calls.filter(call => call[0] === 'revoke').length, 1);
});

test('other-session read-back failure retries inventory, not confirmed deletion', async t => {
  const state = fixture(); await mount(t, page('Settings'));
  let reads = 0;
  state.api.getAccountSessions = async () => { reads++; if (reads === 1) throw new Error('Inventory unavailable'); return { sessions: [] }; };
  await click(button('Revoke')); await click(button('Revoke session'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Inventory unavailable/);
  await click(button('Check revocation'));
  assert.equal(dialog(), null); assert.equal(state.loggedOut, 0);
  assert.equal(state.calls.filter(call => call[0] === 'revoke').length, 1); assert.equal(reads, 2);
});

test('current-session transport failure has the same explicit recovery as an uncertain receipt', async t => {
  const state = fixture(true);
  state.api.revokeAccountSession = async () => { throw new Error('Connection interrupted'); };
  await mount(t, page('Settings')); await click(button('Log out')); await click(button('Revoke session'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /Connection interrupted/);
  assert.ok(button('Sign in again')); assert.equal(button('Revoke session'), undefined);
  assert.equal(state.loggedOut, 0);
  assert.equal(state.calls.filter(call => call[0] === 'sessions').length, 1);
});

test('a still-listed revoked session cannot produce a success notice', async t => {
  const state = fixture();
  state.api.revokeAccountSession = async id => ({ revoked_session_id: id });
  await mount(t, page('Settings')); await click(button('Revoke')); await click(button('Revoke session'));
  assert.match(dialog().querySelector('[role="alert"]').textContent, /still active/);
  assert.ok(!document.body.textContent.includes('confirmed absent'));
  assert.ok(button('Check revocation')); assert.equal(state.loggedOut, 0);
});
