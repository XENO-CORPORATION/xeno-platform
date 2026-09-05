import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

test('Tiptap 3 mounts production editors and preserves controlled video-prompt updates', async (t) => {
  const vite = await createServer({
    appType: 'custom',
    configFile: false,
    optimizeDeps: { noDiscovery: true },
    plugins: [react()],
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
