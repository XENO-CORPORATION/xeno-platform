import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import testUtils from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const { act } = testUtils;
const storageKey = 'xeno_chat_update_carousel_test';
const motionStubPath = fileURLToPath(new URL('./framer-motion-test-stub.mjs', import.meta.url));
const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'framer-motion': motionStubPath } },
  server: { middlewareMode: true },
});
let dom;

try {
  const {
    default: ChatUpdateCarousel,
    MAX_UPDATE_DESCRIPTION_CHARS,
    clampUpdateDescription,
  } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/ChatUpdateCarousel.tsx',
  );

  assert.equal(MAX_UPDATE_DESCRIPTION_CHARS, 82, 'Update descriptions are capped at 82 characters.');
  assert.equal(
    clampUpdateDescription('a'.repeat(90)).length,
    82,
    'Long descriptions must be clamped to the max character count.',
  );

  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  let copiedValue = null;
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value) => { copiedValue = value; } },
  });

  const rootElement = document.getElementById('root');
  let root = createRoot(rootElement);
  const updates = [
    {
      id: 'update-one',
      title: 'Update one',
      description: 'First update',
      demo: {
        header: 'Copy example',
        copyValue: 'Example command',
        body: { kind: 'code', text: 'Example command' },
      },
    },
    {
      id: 'update-two',
      title: 'Update two',
      description: 'Second update',
      demo: {
        header: 'Open in XENO',
        body: {
          kind: 'flow-link',
          from: 'Chat',
          to: 'Workspace',
          href: 'https://xenostudio.ai',
          linkLabel: 'Learn more',
        },
      },
    },
    {
      id: 'update-three',
      title: 'Update three',
      description: 'Third update',
      demo: {
        header: 'Composer',
        headerMeta: 'Live preview',
        body: { kind: 'composer-controls' },
      },
    },
    { id: 'update-four', title: 'Update four', description: 'Must not render' },
  ];

  const renderCarousel = async () => {
    await act(async () => {
      root.render(React.createElement(ChatUpdateCarousel, { storageKey, updates }));
    });
  };

  const themedRoot = document.createElement('div');
  themedRoot.className = 'chat-themed chat-theme-light';
  document.body.appendChild(themedRoot);

  window.localStorage.removeItem(storageKey);
  await renderCarousel();
  assert.match(document.body.textContent, /Update one/, 'The first update should be visible.');
  assert.ok(
    document.querySelector('article[aria-label="1 of 3"]'),
    'The carousel should expose exactly the first three configured updates.',
  );
  const fixedFrameClasses = document.querySelector('[data-update-carousel-frame]')?.className;
  assert.ok(fixedFrameClasses?.includes('h-[14rem]'), 'The carousel should reserve one fixed mobile height.');
  assert.ok(fixedFrameClasses?.includes('sm:h-[10.5rem]'), 'The carousel should reserve one fixed desktop height.');

  assert.ok(
    document.querySelector('[data-update-carousel-content]'),
    'Slide content should expose a dedicated node for the fall-in entrance animation.',
  );
  assert.equal(
    document.querySelector('[data-update-carousel-dismiss]'),
    null,
    'The first slide should keep a next arrow instead of a dismiss control.',
  );
  assert.ok(
    document.querySelector('[aria-label="Show next update"]'),
    'Non-final slides should expose the next arrow in the pinned nav.',
  );

  assert.equal(
    document.querySelector('[data-update-demo="code"]')?.getAttribute('data-update-demo'),
    'code',
    'Each update should fill the shared Example-prompt showcase shell.',
  );
  assert.match(
    document.querySelector('[data-update-demo-shell]')?.textContent ?? '',
    /Copy example/,
    'Each notification passes its own header into the shared showcase layout.',
  );
  const demoShellClasses = document.querySelector('[data-update-demo-shell]')?.className;
  assert.ok(
    demoShellClasses?.includes('h-[8rem]') && demoShellClasses?.includes('w-full'),
    'Demo shells must keep a fixed size across updates.',
  );
  const copyButton = document.querySelector('[aria-label="Copy example"]');
  await act(async () => {
    copyButton.click();
  });
  assert.equal(copiedValue, 'Example command', 'The copy demo action should work.');

  const nav = document.querySelector('[data-update-carousel-nav]');
  assert.ok(nav, 'Carousel navigation should render outside the sliding article.');
  assert.equal(
    document.querySelector('article [data-update-carousel-nav]'),
    null,
    'Navigation must not live inside the animated slide.',
  );
  assert.equal(
    document.querySelector('article [aria-label="Show next update"]'),
    null,
    'Arrow controls must stay outside the animated slide.',
  );

  const nextButton = document.querySelector('[aria-label="Show next update"]');
  await act(async () => {
    nextButton.click();
  });
  assert.ok(document.querySelector('article[aria-label="2 of 3"]'), 'Next should display the second update.');
  assert.equal(
    document.querySelector('[data-update-carousel-nav]'),
    nav,
    'Navigation should remain the same pinned element after changing slides.',
  );
  assert.ok(
    document.querySelector('[data-update-demo="flow-link"]'),
    'The second update should show a different body kind (flow-link) in the same shell.',
  );
  assert.doesNotMatch(
    document.querySelector('[data-update-demo-shell]')?.textContent ?? '',
    /Copy example|Example command/,
    'Switching slides must replace the previous showcase content, not only restyle it.',
  );
  assert.equal(
    document.querySelector('[data-update-demo-shell]')?.className,
    demoShellClasses,
    'Demo shell size classes must stay identical when the demo content changes.',
  );
  assert.equal(
    document.querySelector('a[href="https://xenostudio.ai"]')?.textContent?.trim(),
    'Learn more',
    'The link demo should expose a real link.',
  );

  await act(async () => {
    document.querySelector('[aria-label="Show next update"]').click();
  });
  assert.ok(document.querySelector('article[aria-label="3 of 3"]'), 'Next should reach the final update.');
  assert.ok(
    document.querySelector('[data-update-demo="composer-controls"]'),
    'The third update should show its composer-controls body in the same shell.',
  );
  assert.equal(
    document.querySelector('[aria-label="Show next update"]'),
    null,
    'The final slide should replace the next arrow with dismiss.',
  );
  assert.ok(
    document.querySelector('[data-update-carousel-dismiss]'),
    'The final slide should expose dismiss as the right nav control.',
  );
  assert.equal(
    document.querySelector('[data-update-nav-morph]')?.getAttribute('data-update-nav-morph'),
    'dismiss',
    'On the final slide the next control should morph into the dismiss icon.',
  );
  assert.equal(
    document.querySelector('article [data-update-carousel-dismiss]'),
    null,
    'Dismiss must stay outside the animated slide.',
  );

  const dismissThird = document.querySelector('[aria-label="Dismiss Update three"]');
  await act(async () => {
    dismissThird.click();
  });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(storageKey)), ['update-three']);
  assert.ok(document.querySelector('article[aria-label="1 of 2"]'), 'Dismissing the final update should leave the earlier updates.');
  assert.equal(
    document.querySelector('[data-update-carousel-frame]')?.className,
    fixedFrameClasses,
    'The carousel frame classes must remain identical when a shorter update appears.',
  );
  const shorterSlideClasses = document.querySelector('article[aria-label="1 of 2"]')?.className;
  assert.ok(shorterSlideClasses?.includes('h-[14rem]') && shorterSlideClasses?.includes('sm:h-[10.5rem]'), 'Every slide should occupy the same responsive frame height.');
  assert.ok(
    document.querySelector('[data-update-carousel-content]')?.className.includes('pb-14'),
    'Slide content should keep bottom padding for the pinned navigation controls.',
  );

  await act(async () => {
    document.querySelector('[aria-label="Show next update"]').click();
  });
  assert.ok(document.querySelector('article[aria-label="2 of 2"]'), 'Next should reach the new final update.');
  const dismissSecond = document.querySelector('[aria-label="Dismiss Update two"]');
  await act(async () => {
    dismissSecond.click();
  });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(storageKey)), ['update-three', 'update-two']);
  assert.ok(document.querySelector('article[aria-label="1 of 1"]'), 'One remaining update should still render.');
  assert.equal(document.querySelector('[aria-label="Show next update"]'), null, 'One update should hide the next arrow.');
  assert.equal(document.querySelector('[aria-label="Show previous update"]'), null, 'One update should hide the previous arrow.');
  assert.doesNotMatch(document.body.textContent, /1 \/ 1/, 'One update should hide the position indicator.');
  assert.ok(
    document.querySelector('[data-update-carousel-dismiss]'),
    'A lone remaining update should still expose dismiss in the nav.',
  );

  await act(async () => {
    root.unmount();
  });
  rootElement.innerHTML = '';
  root = createRoot(rootElement);

  await renderCarousel();
  assert.match(document.body.textContent, /Update one/, 'The remaining update should survive remount.');
  assert.doesNotMatch(document.body.textContent, /Update two|Update three/, 'Dismissed updates should remain hidden.');

  const dismissFirst = document.querySelector('[aria-label="Dismiss Update one"]');
  await act(async () => {
    dismissFirst.click();
  });
  const restoreButton = document.querySelector('[data-update-carousel-restore]');
  assert.equal(
    restoreButton?.textContent?.replace(/\s+/g, ' ').trim(),
    "What's new",
    'When every update is dismissed, a minimal restore control should appear.',
  );
  assert.ok(
    restoreButton?.className.includes('fixed')
      && restoreButton?.className.includes('bottom-5')
      && restoreButton?.className.includes('right-5'),
    'The restore control should sit fixed at the bottom-right of the page.',
  );
  assert.ok(
    restoreButton?.className.includes('h-9')
      && restoreButton?.className.includes('rounded-lg')
      && restoreButton?.className.includes('border-white/[0.08]'),
    'The restore control should use the same bordered control chrome as the top-right chat buttons.',
  );
  assert.equal(
    restoreButton?.parentElement,
    themedRoot,
    'The restore control must portal into .chat-themed so Light theme tokens still apply.',
  );
  assert.equal(document.querySelector('[data-update-carousel-frame]'), null, 'Dismissed state must not keep the large carousel frame.');
  assert.equal(document.querySelector('article'), null, 'No slides should remain while the restore control is shown.');

  await act(async () => {
    root.unmount();
  });
  rootElement.innerHTML = '';
  root = createRoot(rootElement);

  await renderCarousel();
  assert.ok(
    document.querySelector('[data-update-carousel-restore]'),
    'The restore control should survive refresh after every update is dismissed.',
  );
  assert.doesNotMatch(document.body.textContent, /Update one|Update two|Update three/, 'Dismissed updates stay hidden until restored.');

  await act(async () => {
    document.querySelector('[data-update-carousel-restore]').click();
  });
  assert.equal(window.localStorage.getItem(storageKey), null, 'Restore should clear persisted dismissals.');
  assert.ok(
    document.querySelector('[data-update-carousel-frame]'),
    'Restore should put the carousel back in its normal frame below the composer.',
  );
  assert.ok(document.querySelector('article[aria-label="1 of 3"]'), 'Restore should bring back the full carousel.');
  assert.match(document.body.textContent, /Update one/, 'The first update should be visible again after restore.');
  assert.equal(document.querySelector('[data-update-carousel-restore]'), null, 'Restore control should hide once updates are visible.');

  const nextAfterRestore = document.querySelector('[aria-label="Show next update"]');
  await act(async () => {
    nextAfterRestore.click();
  });
  assert.match(document.body.textContent, /Update two/, 'Previously dismissed updates should return after restore.');

  await act(async () => {
    root.unmount();
  });
  console.log('Chat update carousel behavior: PASS');
} finally {
  await vite.close();
  dom?.window.close();
}
