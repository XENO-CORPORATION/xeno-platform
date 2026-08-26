import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const routes = read('src', 'server', 'routes', 'chatRoutes.js');
const server = read('src', 'server', 'index.js');
const userData = read('src', 'server', 'routes', 'userDataRoutes.js');
const service = read('src', 'services', 'chatService.ts');
const page = read('src', 'components', 'playground', 'Chat', 'ChatLibraryPage.tsx');
const chat = read('src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx');
const app = read('src', 'App.tsx');

test('account Library aggregates every live account-owned chat/media store', () => {
  assert.match(routes, /router\.get\('\/library'/);
  for (const table of ['chat_artifacts', 'user_files', 'image_generations', 'image_assets']) {
    assert.match(routes, new RegExp(`FROM ${table.replace('_', '\\_')}`));
  }
  assert.match(routes, /a\.user_id = \$1/);
  assert.match(routes, /f\.user_id = \$1/);
  assert.match(routes, /g\.user_id = \$1/);
  assert.match(routes, /ia\.user_id = \$1/);
  assert.match(routes, /\['all', 'images', 'files'\]/);
});

test('Library blob reads require ownership and a server-managed upload record', () => {
  assert.match(routes, /router\.get\('\/library\/file\/:id\/content'/);
  assert.match(routes, /id = \$1 AND user_id = \$2 AND deleted_at IS NULL/);
  assert.match(routes, /storage_type = 'platform-upload'/);
  assert.match(routes, /allowedRoots\.some/);
  assert.match(routes, /X-Content-Type-Options/);
  assert.match(userData, /storage_type === 'platform-upload' \? 'client-reference'/);
});

test('uploads and conversational image generation both persist Library rows', () => {
  assert.match(server, /app\.post\('\/api\/upload'[\s\S]*?INSERT INTO user_files/);
  assert.match(server, /source: req\.body\?\.source \|\| 'upload'/);
  assert.match(server, /source: 'chat-generation'/);
  assert.match(server, /libraryContentUrl/);
  assert.match(chat, /chatService\.uploadLibraryFile\(file, 'chat-attachment'\)/);
});

test('Library UI owns canonical URL tabs and real list/grid controls', () => {
  assert.match(app, /path="\/library" element=\{<LibraryRouteRedirect/);
  assert.match(page, /\/library\?tab=\$\{tab\}/);
  assert.match(page, /value === 'files' \|\| value === 'documents'/);
  assert.match(page, /chatService\.getLibraryItems/);
  assert.match(page, /chatService\.uploadLibraryFile/);
  assert.match(page, /aria-label="List view"/);
  assert.match(page, /aria-label="Grid view"/);
  assert.match(chat, /<span>Library<\/span>/);
});

test('legacy artifacts paths remain a compatibility boundary', () => {
  assert.match(app, /path="\/artifacts" element=\{<LibraryRouteRedirect/);
  assert.match(chat, /path\.startsWith\('\/artifacts'\)/);
  const compatibility = read('src', 'components', 'playground', 'Chat', 'ChatArtifactsPage.tsx');
  assert.match(compatibility, /export \{ default \} from '\.\/ChatLibraryPage'/);
});
