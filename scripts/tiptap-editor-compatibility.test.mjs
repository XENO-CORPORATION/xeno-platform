import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

/*
 * The server is built here rather than loaded from vite.config.ts on purpose —
 * the real config starts a dev proxy and discovers dependencies, neither of
 * which this test wants. But `configFile: false` also drops the alias table, so
 * the moment a production editor reached a component importing
 * `@xenosystem/elements-react`, the module graph broke with "Cannot find module"
 * — a bare specifier that resolves in the app and nowhere else.
 *
 * Mirrors vite.config.ts, INCLUDING its ordering rule: the deeper specifiers
 * come first, or `@xenosystem/elements` swallows `@xenosystem/elements/tokens`
 * and the stylesheet resolves to `.../src/index.ts/xeno-elements.css`.
 */
const xeno = (p) => path.resolve('packages', p);
const XENO_ALIASES = {
  '@xenosystem/elements-react/xeno-elements.css': xeno('elements-react/src/xeno-elements.css'),
  '@xenosystem/elements/schema': xeno('elements/src/schema.ts'),
  '@xenosystem/elements/tokens': xeno('elements/src/tokens/index.ts'),
  '@xenosystem/elements/elements': xeno('elements/src/elements'),
  '@xenosystem/elements': xeno('elements/src/index.ts'),
  '@xenosystem/generate': xeno('generate/src/index.ts'),
  '@xenosystem/elements-react': xeno('elements-react/src/index.ts'),
};

test('Tiptap 3 mounts production editors and preserves controlled video-prompt updates', async (t) => {
  const vite = await createServer({
    appType: 'custom',
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    plugins: [react()],
    resolve: { alias: XENO_ALIASES, dedupe: ['react', 'react-dom'] },
    server: { middlewareMode: true },
  });
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  t.after(async () => {
    await vite.close();
    dom.window.close();
  });

  const [{ default: TipTapEditor }, { default: PaginatedTipTapEditor }, { default: VideoPromptEditor }] = await Promise.all([
    vite.ssrLoadModule('/src/components/playground/Office/TipTapEditor.tsx'),
    vite.ssrLoadModule('/src/components/playground/Office/PaginatedTipTapEditor.tsx'),
    vite.ssrLoadModule('/src/components/playground/Generation/components/VideoPromptEditor.tsx'),
  ]);

  for (const EditorComponent of [TipTapEditor, PaginatedTipTapEditor]) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const ref = createRef();

    root.render(React.createElement(EditorComponent, {
      ref,
      content: '<p>Release compatibility proof</p>',
    }));

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(ref.current?.getEditor(), `${EditorComponent.name} did not create an editor`);
    assert.match(ref.current.getHTML(), /Release compatibility proof/);

    root.unmount();
    host.remove();
  }

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changes = [];
  const props = { onChange: value => changes.push(value) };
  try {
    root.render(React.createElement(VideoPromptEditor, { ...props, value: 'Initial video prompt' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(host.textContent, /Initial video prompt/);
    changes.length = 0;
    root.render(React.createElement(VideoPromptEditor, { ...props, value: 'Reused video prompt' }));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(host.textContent, /Reused video prompt/);
    assert.deepEqual(changes, [], 'external values must not echo through onChange');
  } finally { root.unmount(); host.remove(); }
});
