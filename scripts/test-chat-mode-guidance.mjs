import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = await readFile(
  new URL('../src/components/playground/Chat/chatModeConfig.ts', import.meta.url),
  'utf8',
);
const chat = await readFile(
  new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url),
  'utf8',
);

assert.match(config, /CHAT_MODE_PLACEHOLDERS/, 'Each chat mode should provide its own first-use guidance');
assert.match(config, /Ask XENO anything — plan, explain, or rewrite/, 'Chat mode should state its everyday capabilities');
assert.match(config, /Research a topic with cited web sources/, 'Research mode should promise cited sources');
assert.match(config, /Write, review, or debug code/, 'Code mode should state its intent');
assert.match(config, /Choose an agent or describe the task/, 'Agents mode should guide users before an agent is selected');
assert.match(chat, /placeholder=\{CHAT_MODE_PLACEHOLDERS\[emptyStateMode\]\}/, 'Composer placeholder should follow the selected mode');

console.log('Chat mode guidance checks passed.');
