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
  const { default: ChatEmptyState } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/ChatEmptyState.tsx',
  );
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
    'Current research context',
    'Research context should continue to replace the older saved base prompt.',
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
          React.createElement('div', { 'data-testid': 'composer' }, 'Composer'),
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
  const agentButtons = [...agentHub.querySelectorAll('button')];
  assert.ok(modeControls?.contains(agentHub), 'Agent actions should appear in the outer mode-controls row, directly beside the Agents tab.');
  assert.deepEqual(
    agentButtons.map((button) => button.textContent?.trim()),
    ['Create Agent', 'My Agents', 'Agent Marketplace'],
    'Agents should reveal exactly the three confirmed mock actions.',
  );
  assert.ok(agentButtons.every((button) => button.dataset.mockAction === 'true'), 'Every agent action should be marked as mock data.');
  assert.ok(agentButtons.every((button) => button.className.includes('h-8')), 'Agent actions should use the compact control height.');
  assert.equal(agentHub.dataset.agentActionsState, 'open', 'Agent actions should begin in their open state after entering.');
  assert.ok(agentButtons.every((button) => button.className.includes('animate-agent-action-enter')), 'Agent actions should enter with the confirmed transform-and-opacity animation.');
  assert.deepEqual(agentButtons.map((button) => button.style.animationDelay), ['0ms', '40ms', '80ms'], 'Agent actions should enter left-to-right with a staggered delay.');
  assert.equal(document.querySelector('[data-testid="model-selector"]'), null, 'The model selector should be hidden while agent actions are open.');
  assert.ok(document.querySelector('[data-testid="composer"]'), 'The prompt composer should remain visible while the mock Agents actions are open.');

  await act(async () => {
    document.querySelector('[data-chat-mode="agents"]').click();
  });
  assert.equal(agentHub.dataset.agentActionsState, 'closing', 'Clicking Agents again should begin closing its contextual actions.');
  assert.ok(agentButtons.every((button) => button.className.includes('animate-agent-action-exit')), 'Closing actions should use the reverse animation.');
  assert.deepEqual(agentButtons.map((button) => button.style.animationDelay), ['80ms', '40ms', '0ms'], 'Agent actions should close right-to-left with a reverse stagger.');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 260));
  });
  assert.equal(selectedModes.at(-1), 'chat', 'Closing Agent actions with the Agents tab should return the parent to Chat.');
  assert.equal(document.querySelector('[aria-label="Agent actions"]'), null, 'The Agent action strip should unmount after its closing animation completes.');

  await renderEmptyState();
  await renderEmptyState({ activeMode: 'agents' });
  const reopenedAgentHub = document.querySelector('[aria-label="Agent actions"]');
  const reopenedAgentButtons = [...reopenedAgentHub.querySelectorAll('button')];
  await act(async () => {
    reopenedAgentButtons[0].click();
  });
  assert.equal(reopenedAgentHub.dataset.agentActionsState, 'closing', 'Selecting a mock action should close the strip before notifying the parent.');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 260));
  });
  assert.deepEqual(selectedAgentActions, ['create-agent'], 'Selecting a mock action should notify the parent after the closing animation completes.');

  await renderEmptyState();
  assert.equal(document.querySelector('[aria-label="Agent actions"]'), null, 'The agent action strip should close after a mock action selection.');
  assert.ok(document.querySelector('[data-testid="model-selector"]'), 'Closing the agent action strip should restore the model selector.');

  await renderEmptyState();
  const emptyStateSection = document.querySelector('section[aria-labelledby="chat-empty-state-title"]');
  const shell = document.querySelector('[data-chat-composer-shell]');
  const railHandle = document.querySelector('[data-tool-rail-handle]');
  const toolbarExtension = document.querySelector('[data-toolbar-extension]');
  const innerColumn = document.querySelector('[data-composer-column]');
  assert.ok(emptyStateSection?.className.includes('[container-type:inline-size]'), 'The stable empty-state section should provide the composer width reference.');
  assert.ok(innerColumn?.className.includes('md:pl-3'), 'Desktop composer spacing should be 12px on both the left and right.');
  assert.ok(!innerColumn?.className.includes('md:pl-4'), 'The previous 16px desktop left padding should not remain.');
  assert.equal(shell?.dataset.railOpen, 'false', 'The tool rail should begin collapsed.');
  assert.ok(shell?.className.includes('w-full'), 'The actual outer container should begin at its base width.');
  assert.ok(shell?.className.includes('transition-[width]'), 'Only the isolated outer container width should animate.');
  assert.ok(railHandle?.className.includes('left-[-1.25rem]'), 'The collapsed trigger line should sit 8px farther outside the outer container.');
  assert.ok(document.querySelector('[data-tool-rail-indicator]'), 'The collapsed trigger should expose a dedicated visual indicator for its motion hint.');
  assert.equal(document.querySelectorAll('[data-tool-rail-echo]').length, 1, 'The collapsed trigger should render one smaller faded motion stroke beside the persistent main line.');

  await act(async () => {
    railHandle.click();
  });
  assert.equal(shell?.dataset.railOpen, 'true', 'Touch/click on the vertical handle should open the rail.');
  assert.ok(shell?.className.includes('w-[calc(100%_+_3.25rem)]'), 'The actual outer container should expand toward the left.');
  assert.ok(toolbarExtension?.className.includes('bg-transparent'), 'The toolbar must remain content inside the outer container, not draw a second surface.');
  assert.ok(document.querySelector('[aria-label="Composer tools"] > div')?.className.includes('delay-100'), 'Toolbar icons should appear after the outer container starts expanding.');
  assert.ok(innerColumn?.className.includes('[width:calc(100cqw_-_2px)]'), 'The inner composer should keep the stable section width while the outer container expands.');
  assert.deepEqual(
    [...document.querySelectorAll('[aria-label="Composer tools"] button')].map((button) => button.getAttribute('aria-label')),
    ['Upload file', 'Conversation history', 'System Prompt'],
    'The expanded rail should expose exactly the three confirmed tools.',
  );

  const conversationHistoryButton = document.querySelector('button[aria-label="Conversation history"]');
  await act(async () => {
    conversationHistoryButton.click();
  });
  assert.equal(conversationHistoryOpenRequests, 1, 'Conversation history should open the existing history sidebar.');
  assert.equal(shell?.dataset.railOpen, 'false', 'Opening conversation history should close the rail.');
  assert.ok(!shell?.dataset.activeTool, 'Conversation history must not open an in-shell tool panel.');

  await act(async () => {
    railHandle.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });
  assert.equal(
    shell?.dataset.railOpen,
    'false',
    'Hover must not reopen the rail immediately after Conversation history closes it under the pointer.',
  );

  await act(async () => {
    railHandle.click();
  });
  const systemPromptButton = document.querySelector('button[aria-label="System Prompt"]');
  await act(async () => {
    systemPromptButton.click();
  });
  assert.ok(document.querySelector('[data-testid="system-prompt-panel"]'), 'System Prompt should open inside the shell.');
  assert.equal(shell?.dataset.activeTool, 'system-prompt', 'The shell should expand for the active panel.');
  assert.ok(toolbarExtension?.className.includes('md:w-[15rem]'), 'The visual extension should provide the panel width outside the fixed shell.');
  assert.ok(railHandle?.className.includes('opacity-0'), 'The collapsed line should disappear while tools are visible.');

  await act(async () => {
    document.querySelector('[data-testid="system-prompt-panel"] button').click();
  });
  assert.equal(shell?.dataset.railOpen, 'false', 'Closing the panel should collapse the rail.');

  await act(async () => {
    // Wait out the short hover-reopen suppress used after intentional tool closes.
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  });

  await act(async () => {
    shell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  assert.equal(shell?.dataset.railOpen, 'false', 'Hovering the main shell must not reveal the toolbar.');

  await act(async () => {
    railHandle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  assert.equal(shell?.dataset.railOpen, 'true', 'Pointer hover on the collapsed line should reveal the toolbar.');

  await act(async () => {
    railHandle.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 150));
  });
  assert.equal(shell?.dataset.railOpen, 'true', 'The toolbar should remain open during the one-second pointer grace period.');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 950));
  });
  assert.equal(shell?.dataset.railOpen, 'false', 'The toolbar should close after the pointer has remained outside for one second.');

  await act(async () => {
    railHandle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    railHandle.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    railHandle.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 950));
  });
  assert.equal(shell?.dataset.railOpen, 'true', 'Returning the pointer during the grace period should cancel the scheduled close.');

  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(shell?.dataset.railOpen, 'false', 'Escape should close the rail.');

  await act(async () => {
    railHandle.click();
  });
  const uploadFileButton = document.querySelector('button[aria-label="Upload file"]');
  await act(async () => {
    uploadFileButton.click();
  });
  assert.equal(directUploadRequests, 1, 'Upload file should call the existing upload action once.');
  assert.equal(shell?.dataset.railOpen, 'false', 'A direct tool action should close the rail after selection.');

  assert.ok(innerColumn?.className.includes('[width:calc(100cqw_-_2px)]'), 'The inner composer should use the same stable width before, during, and after toolbar closure.');
  assert.ok(shell?.className.includes('duration-200'), 'Outer expansion and contraction should use the confirmed 200ms transition.');

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
    document.querySelector('[data-chat-composer-shell]')?.className.includes('z-20'),
    'Composer shell must stack above the updates slot so voice/menus are not covered.',
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
        React.createElement('div', { 'data-testid': 'composer' }, 'Composer'),
      ),
    );
  });

  assert.equal(document.querySelector('h1'), null, 'The empty state should disappear after chat begins.');
  assert.ok(document.querySelector('[data-testid="composer"]'), 'The composer should remain available after chat begins.');
  assert.ok(
    document.querySelector('[data-tool-rail-handle]'),
    'Conversation composer should keep the same hover tool rail as the empty state.',
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
  assert.ok(
    document.querySelector('[data-chat-composer-shell]')?.className.includes('self-end'),
    'Conversation shell must self-end so the open rail grows beside the prompt, not over it.',
  );

  await act(async () => {
    root.unmount();
  });

  console.log('ChatEmptyState behavior: PASS');
} finally {
  await vite.close();
  dom?.window.close();
}
