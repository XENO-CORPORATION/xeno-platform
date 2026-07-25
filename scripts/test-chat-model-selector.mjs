import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import testUtils from 'react-dom/test-utils';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const { act } = testUtils;
const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});
let dom;

try {
  const { default: ChatModelSelector } = await vite.ssrLoadModule(
    '/src/components/playground/Chat/ChatModelSelector.tsx',
  );

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
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });

  const root = createRoot(document.getElementById('root'));
  const modelA = {
    id: 'xeno/model-a',
    name: 'Model A',
    maxTokens: 64_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
  };
  const modelB = {
    id: 'xeno/model-b',
    name: 'Model B',
    maxTokens: 128_000,
    inputModalities: ['text', 'file'],
    outputModalities: ['text'],
  };
  const extraModels = Array.from({ length: 4 }, (_, index) => ({
    id: `xeno/model-${index + 3}`,
    name: `Model ${index + 3}`,
    maxTokens: 32_000 * (index + 1),
    inputModalities: ['text'],
    outputModalities: ['text'],
  }));
  const groupedModels = [{ companyName: 'XENO', models: [modelA, modelB] }];
  const providerGroupedModels = [
    { companyName: 'OpenAI', models: [modelA, modelB, ...extraModels] },
    {
      companyName: 'Anthropic',
      models: [{ ...modelA, id: 'anthropic/model-c', name: 'Model C' }],
    },
  ];
  let selectedModelId = null;
  const waitForInlineMotion = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
  };

  const renderSelector = async (selectedModel, props = {}) => {
    await act(async () => {
      root.render(
        React.createElement(ChatModelSelector, {
          groupedModels,
          isLoading: false,
          isReasoningActive: false,
          onSelect: (model) => {
            selectedModelId = model.id;
          },
          selectedModel,
          ...props,
        }),
      );
    });
  };

  await renderSelector(modelA);
  const trigger = document.querySelector('[aria-label^="Select model"]');
  assert.ok(trigger, 'The model selector should render in the composer controls.');

  await act(async () => {
    trigger.click();
  });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'The model tray should open.');
  assert.ok(document.querySelector('[data-model-tray]'), 'The selector should render the confirmed grouped model tray.');

  const modelBButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('Model B'),
  );
  assert.ok(modelBButton, 'Opening the tray should reveal models without an extra provider-expansion click.');
  assert.ok(modelBButton.className.includes('animate-model-tray-item-enter'), 'Models should use the confirmed staggered right-to-left entrance motion.');

  await act(async () => {
    modelBButton.click();
  });
  assert.equal(selectedModelId, modelB.id, 'Selecting a model should call the existing selection behavior.');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'The model tray should close after selection.');

  await renderSelector(modelB);
  assert.match(trigger.textContent ?? '', /Model B/, 'The selected model should remain visible.');

  const inlineOpenStates = [];
  await renderSelector(modelA, {
    isInlineTray: true,
    onOpenChange: (isOpen) => inlineOpenStates.push(isOpen),
  });
  const inlineTrigger = document.querySelector('[aria-label^="Select model"]');
  await act(async () => {
    inlineTrigger.click();
  });
  assert.ok(document.querySelector('[data-inline-model-actions]'), 'The empty-chat selector should show provider choices inline instead of over the composer.');
  assert.equal(document.querySelectorAll('[data-inline-model-provider]').length, 1, 'The inline selector should start with providers, not a long model list.');
  assert.deepEqual(inlineOpenStates, [true], 'Opening the inline selector should notify its composer parent.');

  const xenoProviderButton = document.querySelector('[data-inline-model-provider="XENO"]');
  await act(async () => {
    xenoProviderButton.click();
  });
  await waitForInlineMotion();
  const inlineModelBButton = [...document.querySelectorAll('[data-inline-model-action]')].find(
    (button) => button.textContent?.includes('Model B'),
  );
  await act(async () => {
    inlineModelBButton.click();
  });
  await waitForInlineMotion();
  assert.equal(selectedModelId, modelB.id, 'Selecting an inline model should keep the existing selection behavior.');
  assert.deepEqual(inlineOpenStates, [true, false], 'Selecting an inline model should close the composer tray.');

  const providerOpenStates = [];
  await renderSelector(modelA, {
    groupedModels: providerGroupedModels,
    isInlineTray: true,
    onOpenChange: (isOpen) => providerOpenStates.push(isOpen),
  });
  const providerTrigger = document.querySelector('[aria-label^="Select model"]');
  await act(async () => {
    providerTrigger.click();
  });
  assert.equal(document.querySelectorAll('[data-inline-model-provider]').length, 2, 'The inline rail should remain compact even when there are many models.');
  assert.equal(document.querySelector('[data-inline-model-catalog]'), null, 'The inline selector should not render the old vertical catalog.');

  const openAiProviderButton = document.querySelector('[data-inline-model-provider="OpenAI"]');
  await act(async () => {
    openAiProviderButton.click();
  });
  await waitForInlineMotion();
  assert.equal(document.querySelectorAll('[data-inline-model-action]').length, 6, 'Choosing a provider should reveal only that provider\'s models inline.');
  assert.ok(document.querySelector('[data-inline-model-provider-back]'), 'The provider models should offer a compact way back to providers.');

  const providerModelButton = [...document.querySelectorAll('[data-inline-model-action]')].find(
    (button) => button.textContent?.includes('Model 6'),
  );
  assert.ok(providerModelButton, 'The selected provider should expose every one of its models.');
  await act(async () => {
    providerModelButton.click();
  });
  await waitForInlineMotion();
  assert.equal(selectedModelId, 'xeno/model-6', 'Selecting a provider model should keep the existing model selection behavior.');
  assert.equal(document.querySelector('[data-inline-model-actions]'), null, 'The provider rail should close after selection.');
  assert.deepEqual(providerOpenStates, [true, false], 'Selecting a provider model should close the parent composer tray.');

  await act(async () => {
    root.unmount();
  });
  console.log('Chat model selector behavior: PASS');
} finally {
  await vite.close();
  dom?.window.close();
}
