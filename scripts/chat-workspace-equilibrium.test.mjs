import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('the overview shell cannot be focus-scrolled as one oversized surface', async () => {
  const [overview, taskbar] = await Promise.all([
    read('src/pages/Overview.tsx'),
    read('src/components/overview/OverviewTaskbar.tsx'),
  ]);

  assert.match(overview, /data-overview-shell[\s\S]*?overflow: 'clip'/);
  assert.match(taskbar, /data-overview-taskbar-scroll[\s\S]*?min-h-0[\s\S]*?overflow-y-auto/);
});

test('chat panels feed one workspace inset contract', async () => {
  const chat = await read('src/components/playground/Chat/ChatWithLLM.tsx');

  assert.match(chat, /const HISTORY_SIDEBAR_WIDTH_PX = 260/);
  assert.match(chat, /const historyWorkspaceInsetPx =[\s\S]*?HISTORY_SIDEBAR_WIDTH_PX/);
  assert.match(chat, /const contextWorkspaceInsetPx =[\s\S]*?contextPanelWidth/);
  assert.match(chat, /'--chat-history-inset': `\$\{historyWorkspaceInsetPx\}px`/);
  assert.match(chat, /'--chat-context-inset': `\$\{contextWorkspaceInsetPx\}px`/);
  assert.match(chat, /className="hide-scrollbar flex-grow[\s\S]*?paddingLeft: historyWorkspaceInsetPx[\s\S]*?paddingRight: contextWorkspaceInsetPx/);
  assert.match(chat, /Bottom Input Section[\s\S]*?left: `\$\{historyWorkspaceInsetPx\}px`[\s\S]*?right: `\$\{contextWorkspaceInsetPx\}px`/);
  assert.match(chat, /className={`chat-top-bar[\s\S]*?left: `\$\{historyWorkspaceInsetPx\}px`[\s\S]*?right: `\$\{contextWorkspaceInsetPx\}px`/);
  assert.doesNotMatch(chat, /isHistoryOpen && !isMobile \? 260 : 0/);
});

test('top bar and composer compact from available width, not viewport width', async () => {
  const [emptyState, css] = await Promise.all([
    read('src/components/playground/Chat/ChatEmptyState.tsx'),
    read('src/index.css'),
  ]);

  assert.match(emptyState, /data-chat-mode-label/);
  assert.equal((emptyState.match(/\[container-name:chat-composer\]/g) ?? []).length, 2);
  assert.match(css, /container: chat-topbar \/ inline-size/);
  assert.match(css, /@container chat-topbar \(max-width: 48rem\)/);
  assert.match(css, /@container chat-composer \(max-width: 32rem\)/);
  assert.match(css, /\[data-chat-mode-label\][\s\S]*?display: none/);
});
