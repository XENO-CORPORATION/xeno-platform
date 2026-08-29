import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the fixture adapter is selected only by an explicit development bootstrap flag', async () => {
  const main = await fs.readFile(path.join(root, 'src/main.tsx'), 'utf8');
  assert.match(main, /import\.meta\.env\.DEV\s*&&\s*import\.meta\.env\.VITE_ENABLE_CHAT_FIXTURES\s*===\s*['"]true['"]/);
  assert.match(main, /import\(['"]\.\/components\/playground\/Chat\/chatMock\.ts['"]\)/);

  const authenticatedSources = [
    'src/components/playground/Chat/ChatWithLLM.tsx',
    'src/components/playground/Chat/chatCustomize.ts',
    'src/components/playground/Chat/chatShare.ts',
    'src/components/playground/Chat/chatArtifacts.ts',
    'src/services/chatService.ts',
  ];
  for (const relative of authenticatedSources) {
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /chatMock|xeno_chat_mock|__xenoChatMock/, relative);
  }
});
