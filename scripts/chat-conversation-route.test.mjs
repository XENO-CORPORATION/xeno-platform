import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/*
 * The chat's canonical address is /chat/... (src/components/playground/Chat/chatRoutes.ts): /chat,
 * /chat/c/:id, /chat/projects/:pid, /chat/projects/:pid/c/:cid. The compact forms (/c/:id, /projects/...)
 * redirect there, and the old /overview/chat/... forms still mount the same surface so old links keep working.
 */
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const overviewSource = await readFile(new URL('../src/pages/Overview.tsx', import.meta.url), 'utf8');

test('compact conversation URLs redirect to the canonical reloadable chat route', () => {
  assert.match(appSource, /path="\/c\/:conversationId" element=\{<ConversationRouteRedirect \/>\}/);
  assert.match(appSource, /path="\/c" element=\{<ConversationRouteRedirect \/>\}/);
  assert.match(appSource, /`\/chat\/c\/\$\{encodeURIComponent\(conversationId\)\}`/, 'the redirect lands on /chat/c/:id');
  assert.match(appSource, /path="\/chat\/\*"[\s\S]*?<OverviewPage \/>/, '/chat/* mounts the chat surface');
  assert.match(appSource, /path="\/overview\/\*"[\s\S]*?<OverviewPage \/>/, 'old /overview/* links still mount it');
});

test('the canonical nested route mounts the chat surface with a conversation id', () => {
  assert.match(overviewSource, /path="chat\/c\/:conversationId" element=\{<MultiChatContainer \/>\}/);
  // the old form keeps working
  assert.match(overviewSource, /path="chat\/llm\/:conversationId" element=\{<MultiChatContainer \/>\}/);
});

test('compact project URLs survive a hard reload through the canonical chat route', () => {
  assert.match(appSource, /path="\/projects\/:projectId" element=\{<ProjectRouteRedirect \/>\}/);
  assert.match(appSource, /path="\/projects\/:projectId\/c\/:conversationId" element=\{<ProjectRouteRedirect \/>\}/);
  assert.match(appSource, /`\/chat\/projects\/\$\{encodeURIComponent\(projectId\)\}`/);
  assert.match(appSource, /`\/chat\/projects\/\$\{encodeURIComponent\(projectId\)\}\/c\/\$\{encodeURIComponent\(conversationId\)\}`/, 'the parent stays in the path');
  assert.match(overviewSource, /path="chat\/projects\/:projectId" element=\{<MultiChatContainer \/>\}/);
  assert.match(overviewSource, /path="chat\/projects\/:projectId\/c\/:conversationId" element=\{<MultiChatContainer \/>\}/);
});
