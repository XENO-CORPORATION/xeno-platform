import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('compact conversation URLs redirect to the canonical reloadable chat route', () => {
  assert.match(appSource, /path="\/c\/:conversationId" element=\{<ConversationRouteRedirect \/>\}/);
  assert.match(appSource, /path="\/c" element=\{<ConversationRouteRedirect \/>\}/);
  assert.match(appSource, /path="\/chat\/c\/:conversationId"[\s\S]*?<ConversationRouteRedirect \/>/);
  assert.match(appSource, /`\/overview\/chat\/llm\/\$\{encodeURIComponent\(conversationId\)\}`/);
  assert.match(appSource, /path="\/overview\/\*"[\s\S]*?<OverviewPage \/>/);
});

test('the canonical nested route mounts the chat surface with a conversation id', async () => {
  const overviewSource = await readFile(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8');
  assert.match(overviewSource, /path="chat\/llm\/:conversationId" element=\{<MultiChatContainer \/>\}/);
});

test('compact project URLs survive a hard reload through the canonical Overview route', async () => {
  assert.match(appSource, /path="\/projects\/:projectId" element=\{<ProjectRouteRedirect \/>\}/);
  assert.match(appSource, /`\/overview\/chat\/projects\/\$\{encodeURIComponent\(projectId\)\}`/);

  const overviewSource = await readFile(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8');
  assert.match(overviewSource, /path="chat\/projects\/:projectId" element=\{<MultiChatContainer \/>\}/);
});
