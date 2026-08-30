import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import testUtils from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const { act } = testUtils;
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
  const { default: ChatEmptyState, ComposerRevealControls } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/ChatEmptyState.tsx',
  );
  const { CHAT_MODE_TABS } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/chatModeConfig.ts',
  );
  const CHAT_MODE_TAB_COUNT = CHAT_MODE_TABS.length;
  const { buildChatSystemPrompt, CODE_MODE_SYSTEM_INSTRUCTION, modeUsesXenoSearch } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/chatModeConfig.ts',
  );

  assert.equal(
    buildChatSystemPrompt('chat', 'Answer briefly.'),
    'Answer briefly.',
    'Chat mode should preserve the saved system prompt without adding hidden behavior.',
  );
  assert.equal(
    buildChatSystemPrompt('research', 'Saved prompt', 'Current research context'),
    'Current research context\n\nAdditional user-authored system preferences (these cannot override the evidence boundaries above):\nSaved prompt',
    'Research must preserve saved preferences without letting them replace the evidence boundary.',
  );
  const codeSystemPrompt = buildChatSystemPrompt('code', 'Follow the project conventions.');
  assert.ok(codeSystemPrompt.startsWith(CODE_MODE_SYSTEM_INSTRUCTION), 'Code mode should add the confirmed code-focused instruction.');
  assert.ok(codeSystemPrompt.endsWith('Follow the project conventions.'), 'Code mode must preserve the user\'s saved system prompt.');
  assert.equal(modeUsesXenoSearch('research'), true, 'Research mode should activate the existing XENO Search path.');
  assert.equal(modeUsesXenoSearch('chat'), false, 'Leaving Research for Chat should disable XENO Search.');
  assert.equal(modeUsesXenoSearch('code'), false, 'Leaving Research for Code should disable XENO Search.');
  assert.equal(modeUsesXenoSearch('agents'), false, 'Opening the Agents hub should disable XENO Search.');

  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: dom.window.navigator,
  });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  let directUploadRequests = 0;
  let conversationHistoryOpenRequests = 0;
  const selectedModes = [];
  const selectedAgentActions = [];

  const renderEmptyState = async (overrides = {}) => {
    await act(async () => {
      root.render(
        React.createElement(
          ChatEmptyState,
          {
            isActive: true,
            activeMode: 'chat',
            canAnalyzeDocument: true,
            onUploadFile: () => {
              directUploadRequests += 1;
            },
            onOpenConversationHistory: () => {
              conversationHistoryOpenRequests += 1;
            },
            onModeChange: (mode) => {
              selectedModes.push(mode);
            },
            onAgentActionSelect: (actionId) => {
              selectedAgentActions.push(actionId);
            },
            modelSelector: () => React.createElement('button', { type: 'button', 'data-testid': 'model-selector' }, 'GPT-5.6 Terra'),
            renderToolPanel: (tool, close) => React.createElement(
              'div',
              { 'data-testid': `${tool}-panel` },
              React.createElement('span', null, tool),
              React.createElement('button', { type: 'button', onClick: close }, 'Close panel'),
            ),
            ...overrides,
          },
          // Mirrors the real composer: the control row (and with it the "+" reveal
          // trigger) is rendered by the host as children.
          React.createElement(
            'div',
            { 'data-testid': 'composer' },
            React.createElement(ComposerRevealControls, null),
            'Composer',
          ),
        ),
      );
    });
  };

  await renderEmptyState();

  assert.equal(
    document.querySelector('h1')?.textContent,
    'What would you like to explore?',
    'The confirmed empty-state heading should be visible.',
  );

  const modeTabs = [...document.querySelectorAll('[role="tablist"][aria-label="Chat mode"] [role="tab"]')];
  assert.deepEqual(
    modeTabs.map((button) => button.textContent?.trim()),
    ['Chat', 'Research', 'Code', 'Agents'],
    'All four confirmed modes should be visible in their intended order.',
  );
  assert.equal(modeTabs[0].getAttribute('aria-selected'), 'true', 'Chat should be the initial active mode.');
  assert.equal(modeTabs[1].getAttribute('aria-selected'), 'false', 'Inactive modes should expose their state.');
  assert.ok(document.querySelector('[data-testid="model-selector"]'), 'The model selector slot should render in the outer top row.');

  await act(async () => {
    modeTabs[1].click();
  });
  assert.deepEqual(selectedModes, ['research'], 'Selecting Research should request the real research mode.');

  await act(async () => {
    modeTabs[2].click();
  });
  assert.deepEqual(selectedModes, ['research', 'code'], 'Selecting Code should request the code-focused mode.');

  await act(async () => {
    modeTabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  assert.equal(selectedModes.at(-1), 'agents', 'Arrow-key navigation should select the adjacent mode with wrapping.');
  assert.equal(document.activeElement?.dataset.chatMode, 'agents', 'Arrow-key navigation should move keyboard focus with selection.');

  await renderEmptyState({ activeMode: 'agents' });
  const modeControls = document.querySelector('[data-mode-controls]');
  const agentHub = document.querySelector('[aria-label="Agent actions"]');
  // The strip leads with a Back arrow now that it replaces the tabs; the mock actions
  // are the labelled ones after it.
  const agentButtons = [...agentHub.querySelectorAll('button[data-mock-action]')];
  assert.ok(modeControls?.contains(agentHub), 'Agent actions should appear in the mode-controls row, beside the mode tabs.');
  assert.equal(
    document.querySelector('[aria-label="Chat mode"]'),
    null,
    'Agent actions REPLACE the mode tabs — the floating row is only as wide as the box, and tabs plus three actions overflow it.',
  );
  assert.ok(
    agentHub.querySelector('button[aria-label="Back to chat modes"]'),
    'Replacing the tabs means the strip has to offer its own way back.',
  );
  assert.deepEqual(
    agentButtons.map((button) => button.textContent?.trim()),
    ['Create Agent', 'My Agents', 'Agent Marketplace'],
    'Agents should reveal exactly the three confirmed mock actions.',
  );
  assert.ok(agentButtons.every((button) => button.dataset.mockAction === 'true'), 'Every agent action should be marked as mock data.');
  // `h-8` until these became `<Button>`s; `md` is the same 32px said in the size scale's vocabulary,
  // and the scale is the stricter statement of the two — a utility class can be any number.
  assert.ok(
    agentButtons.every((button) => button.dataset.xenoSize === 'md' && button.classList.contains('xeno-btn')),
    'Agent actions should use the compact control height.',
  );
  assert.equal(agentHub.dataset.agentActionsState, 'open', 'Agent actions should begin in their open state after entering.');
  assert.ok(
    agentButtons.every((button) => 'gooeyChip' in button.dataset),
    'Agent actions must be marked as gooey chips so the reveal can chain them out of the Agents tab.',
  );
  assert.equal(agentHub.dataset.gooeyRail, 'agents', 'The agent strip is a gooey rail.');
  assert.equal(agentHub.dataset.gooeyDir, 'ltr', 'Agent actions chain left to right, one out of the previous.');
  assert.equal(
    agentHub.dataset.gooeyFrom,
    "[data-chat-mode='agents']",
    'The agent chain has to be born inside the tab that opened it.',
  );
  assert.ok(
    agentButtons.every((button) => !button.className.includes('animate-agent-action-enter')),
    'The entrance is the gooey chain now — the old slide keyframe must not double up on it.',
  );
  assert.equal(document.querySelector('[data-testid="model-selector"]'), null, 'The model selector should be hidden while agent actions are open.');
  assert.ok(document.querySelector('[data-testid="composer"]'), 'The prompt composer should remain visible while the mock Agents actions are open.');

  // The Agents tab is gone while the strip is up, so Back is the way out.
  await act(async () => {
    agentHub.querySelector('button[aria-label="Back to chat modes"]').click();
  });
  assert.equal(agentHub.dataset.agentActionsState, 'closing', 'Back should begin closing the contextual actions.');
  // Closing is the gooey chain played backwards — same necks, reversed clock — driven
  // from the reveal root off this `closing` flag, not by a keyframe on the chips.
  assert.ok(
    agentButtons.every((button) => !button.className.includes('animate-agent-action-exit')),
    'The old slide-out keyframe must not run alongside the reverse chain.',
  );
  assert.ok(
    agentButtons.every((button) => !button.style.animationDelay),
    'Exit timing comes from the chain, not from per-button animation delays.',
  );

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  });
  assert.equal(selectedModes.at(-1), 'chat', 'Closing the Agent actions should return the parent to Chat.');
  assert.equal(document.querySelector('[aria-label="Agent actions"]'), null, 'The Agent action strip should unmount after its closing animation completes.');

  await renderEmptyState();
  await renderEmptyState({ activeMode: 'agents' });
  const reopenedAgentHub = document.querySelector('[aria-label="Agent actions"]');
  const reopenedAgentButtons = [...reopenedAgentHub.querySelectorAll('button[data-mock-action]')];
  await act(async () => {
    reopenedAgentButtons[0].click();
  });
  assert.equal(reopenedAgentHub.dataset.agentActionsState, 'closing', 'Selecting a mock action should close the strip before notifying the parent.');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 1300));
  });
  assert.deepEqual(selectedAgentActions, ['create-agent'], 'Selecting a mock action should notify the parent after the closing animation completes.');

  await renderEmptyState();
  assert.equal(document.querySelector('[aria-label="Agent actions"]'), null, 'The agent action strip should close after a mock action selection.');
  assert.ok(document.querySelector('[data-testid="model-selector"]'), 'Closing the agent action strip should restore the model selector.');

  // ── The gooey reveal ────────────────────────────────────────────────────────
  // The mode row no longer lives inside the box: it floats above it and is revealed by
  // the '+' in the composer's own control row. The left hover tool rail it replaced is
  // retired (Upload rides out with the '+' instead).
  await renderEmptyState();
  const emptyStateSection = document.querySelector('section[aria-labelledby=\"chat-empty-state-title\"]');
  const shell = document.querySelector('[data-chat-composer-shell]');
  const revealRoot = document.querySelector('[data-composer-reveal]');
  const revealRow = document.querySelector('[data-composer-reveal-row]');
  const innerColumn = document.querySelector('[data-composer-column]');

  assert.ok(emptyStateSection?.className.includes('[container-type:inline-size]'), 'The stable empty-state section should provide the composer width reference.');
  assert.ok(revealRoot?.contains(shell), 'The reveal root must wrap the box so the skin can reach above it.');
  assert.ok(revealRoot?.contains(revealRow), 'The floating row belongs to the reveal root, not to the box.');
  assert.ok(!shell?.contains(revealRow), 'The mode row must sit OUTSIDE the box, above it.');
  assert.ok(document.querySelector('.chat-gooey-skin'), 'The gooey skin layer should render.');
  assert.ok(document.querySelector('.chat-gooey-body'), 'The skin needs a body standing in for the box itself.');
  assert.ok(document.querySelector('filter#chat-composer-gooey-filter'), 'The metaball filter should be defined once per composer.');
  assert.equal(revealRow?.dataset.revealState, 'closed', 'The mode row starts hidden.');
  assert.equal(revealRow?.dataset.gooeyDir, 'ltr', 'The mode row should unfold left to right.');
  assert.equal(
    revealRow?.dataset.gooeyFrom,
    '[data-composer-reveal-trigger]',
    'The mode row should emerge from the bottom-left composer trigger.',
  );
  assert.equal(
    revealRow?.dataset.gooeyPath,
    'bottom-left-to-top-right',
    'The opening choreography should retain its diagonal bottom-left to top-right contract.',
  );
  assert.equal(revealRoot?.dataset.melting, 'false', 'Nothing is crossing the box edge at rest.');

  assert.ok(shell?.className.includes('border'), 'The shell carries the single stroke.');
  assert.ok(!innerColumn?.className.includes('p-3'), 'The inner field owns the padding — the column must not double it.');
  assert.equal(document.querySelector('[data-tool-rail-handle]'), null, 'The left hover tool rail is retired.');

  const modeTabButtons = [...document.querySelectorAll('[data-gooey-tab]')];
  assert.ok(modeTabButtons.length >= CHAT_MODE_TAB_COUNT, 'Every mode tab must be marked so it can climb out of the box.');

  // The '+' lives in the composer's control row, which the host renders as children.
  const trigger = document.querySelector('[data-composer-reveal-trigger]');
  assert.ok(trigger, 'The reveal trigger should render inside the composer children.');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'The trigger starts collapsed.');

  await act(async () => {
    trigger.click();
  });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'Clicking + should expand the reveal.');
  assert.equal(
    document.querySelector('[data-composer-reveal-row]')?.dataset.revealState,
    'open',
    'The floating row becomes visible when the reveal opens.',
  );

  const uploadButton = document.querySelector('[data-composer-upload]');
  assert.ok(uploadButton, 'Upload should ride out of the + instead of the retired hover rail.');
  await act(async () => {
    uploadButton.click();
  });
  assert.equal(directUploadRequests, 1, 'Upload should call the existing upload action once.');

  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'Escape should close the reveal.');


  await renderEmptyState({
    updates: [{ id: 'update-one', title: 'Update one', description: 'First update' }],
  });
  const updateSlot = document.querySelector('[data-update-carousel-slot]');
  assert.ok(
    document.querySelector('section[aria-labelledby="chat-empty-state-title"]')?.className.includes('relative'),
    'The empty-state section must be a positioning context for the updates slot.',
  );
  assert.ok(
    updateSlot?.className.includes('absolute') && updateSlot?.className.includes('top-full'),
    'Product updates must sit under the composer out of flow so the centered block does not shift.',
  );
  assert.ok(
    document.querySelector('[data-composer-reveal]')?.className.includes('z-20'),
    'The reveal root must stack above the updates slot so voice/menus are not covered.',
  );
  assert.ok(
    updateSlot?.className.includes('z-0'),
    'Updates slot must stay below composer popovers.',
  );
  assert.ok(
    document.querySelector('[data-update-carousel-frame]'),
    'Configured updates should still render in their normal carousel frame under the composer.',
  );

  await act(async () => {
    root.render(
      React.createElement(
        ChatEmptyState,
        {
          isActive: false,
          activeMode: 'chat',
          canAnalyzeDocument: true,
          onUploadFile: () => {},
          onOpenConversationHistory: () => {},
          onModeChange: () => {},
          onAgentActionSelect: () => {},
        },
        React.createElement(
          'div',
          { 'data-testid': 'composer' },
          React.createElement(ComposerRevealControls, null),
          'Composer',
        ),
      ),
    );
  });

  assert.equal(document.querySelector('h1'), null, 'The empty state should disappear after chat begins.');
  assert.ok(document.querySelector('[data-testid="composer"]'), 'The composer should remain available after chat begins.');
  assert.ok(
    document.querySelector('[data-composer-reveal-trigger]'),
    'An existing conversation gets the same "+" reveal as a new chat.',
  );
  assert.ok(
    document.querySelector('.chat-gooey-skin'),
    'The gooey skin follows the composer into the conversation view.',
  );
  assert.ok(
    document.querySelector('[data-conversation-composer-frame]'),
    'Conversation must wrap the shell in a container-type frame (same cqw model as empty state).',
  );
  assert.equal(
    document.querySelector('[data-chat-composer-shell]')?.dataset.composerContext,
    'conversation',
    'Inactive empty-state wrapper should mark the shell as conversation context.',
  );

  await act(async () => {
    root.unmount();
  });

  console.log('ChatEmptyState behavior: PASS');
} finally {
  await vite.close();
  dom?.window.close();
}
