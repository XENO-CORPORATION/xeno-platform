import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedLibraryAttachments,
  createSignedLibraryContentPath,
  verifySignedLibraryContentRequest,
} from '../src/server/services/libraryAssets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');
const routes = read('src', 'server', 'routes', 'chatRoutes.js');
const libraryRoutes = read('src', 'server', 'routes', 'libraryRoutes.js');
const libraryAssets = read('src', 'server', 'services', 'libraryAssets.js');
const server = read('src', 'server', 'index.js');
const userData = read('src', 'server', 'routes', 'userDataRoutes.js');
const service = read('src', 'services', 'chatService.ts');
const libraryClient = read('src', 'services', 'libraryService.ts');
const page = read('src', 'components', 'playground', 'Chat', 'ChatLibraryPage.tsx');
const chat = read('src', 'components', 'playground', 'Chat', 'ChatWithLLM.tsx');
const image = read('src', 'components', 'library', 'LibraryAssetImage.tsx');
const viewer = read('src', 'components', 'library', 'LibraryAssetViewer.tsx');
const app = read('src', 'App.tsx');

test('account Library aggregates every live account-owned chat/media store', () => {
  assert.match(libraryRoutes, /router\.get\('\/assets'/);
  for (const table of ['chat_artifacts', 'user_files', 'image_generations', 'image_assets']) {
    assert.match(libraryAssets, new RegExp(`FROM ${table.replace('_', '\\_')}`));
  }
  assert.match(libraryAssets, /a\.user_id = \$1/);
  assert.match(libraryAssets, /f\.user_id = \$1/);
  assert.match(libraryAssets, /g\.user_id = \$1/);
  assert.match(libraryAssets, /ia\.user_id = \$1/);
  assert.match(libraryAssets, /\['all', 'images', 'files'\]/);
  assert.match(server, /app\.use\('\/api\/library', databaseMiddleware, libraryRoutes\)/);
});

test('Library blob reads require ownership and a server-managed upload record', () => {
  assert.match(libraryRoutes, /router\.get\('\/assets\/:id\/content'/);
  assert.match(libraryAssets, /id = \$1 AND user_id = \$2 AND deleted_at IS NULL/);
  assert.match(libraryAssets, /storage_type = 'platform-upload'/);
  assert.match(libraryAssets, /allowedRoots\.some/);
  assert.match(libraryRoutes, /X-Content-Type-Options/);
  assert.match(userData, /storage_type === 'platform-upload' \? 'client-reference'/);
});

test('uploads and conversational image generation both persist Library rows', () => {
  assert.match(server, /app\.post\('\/api\/upload'[\s\S]*?registerManagedLibraryFile/);
  assert.match(server, /source: req\.body\?\.source \|\| 'upload'/);
  assert.match(server, /source: 'chat-generation'/);
  assert.match(server, /libraryContentUrl/);
  assert.match(chat, /libraryService\.upload\(file, 'chat-attachment'\)/);
  assert.match(chat, /generatedImageAsset/);
  assert.match(chat, /attachments: messageLibraryAttachments\(persistedImageMessage\)/);
});

test('Library UI owns canonical URL tabs and real list/grid controls', () => {
  assert.match(app, /path="\/library" element=\{<LibraryRouteRedirect/);
  assert.match(page, /\/library\?tab=\$\{tab\}/);
  assert.match(page, /value === 'files' \|\| value === 'documents'/);
  assert.match(page, /libraryService\.list/);
  assert.match(page, /libraryService\.upload/);
  assert.match(page, /aria-label="List view"/);
  assert.match(page, /aria-label="Grid view"/);
  assert.match(page, /<LibraryAssetViewer/);
  assert.match(chat, /<span>Library<\/span>/);
});

test('signed Library links are short-lived account-bound capabilities', () => {
  process.env.LIBRARY_CONTENT_SECRET = 'test-only-library-secret-with-enough-entropy';
  const assetId = '10000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000002';
  const path = createSignedLibraryContentPath({ assetId, userId, ttlSeconds: 600 });
  const url = new URL(path, 'https://xenostudio.ai');
  assert.equal(url.pathname, `/api/library/assets/${assetId}/content`);
  const request = {
    assetId,
    userId: url.searchParams.get('uid'),
    expires: url.searchParams.get('expires'),
    download: url.searchParams.get('download') === '1',
    signature: url.searchParams.get('sig'),
  };
  assert.equal(verifySignedLibraryContentRequest(request), true);
  assert.equal(verifySignedLibraryContentRequest({ ...request, userId: '30000000-0000-4000-8000-000000000003' }), false);
  const tamperedSignature = `${request.signature.slice(0, -1)}${request.signature.endsWith('0') ? '1' : '0'}`;
  assert.equal(verifySignedLibraryContentRequest({ ...request, signature: tamperedSignature }), false);
  assert.match(libraryRoutes, /Access-Control-Allow-Origin/);
  assert.match(libraryRoutes, /Cross-Origin-Resource-Policy/);
  assert.match(libraryRoutes, /url: `\$\{siteOrigin\(\)\}\$\{contentPath\}`/);
  assert.doesNotMatch(libraryRoutes, /url: `\$\{req\.protocol\}:\/\//);
});

test('message asset references are ownership checked before SQL persistence', async () => {
  const userId = '20000000-0000-4000-8000-000000000002';
  const owned = '10000000-0000-4000-8000-000000000001';
  const db = { query: async (_sql, values) => ({ rows: values[1].includes(owned) ? [{ id: owned }] : [] }) };
  await assert.doesNotReject(() => assertOwnedLibraryAttachments(db, userId, [{ asset_id: owned }]));
  await assert.rejects(() => assertOwnedLibraryAttachments(db, userId, [{ asset_id: '30000000-0000-4000-8000-000000000003' }]), /unavailable/);
  assert.match(routes, /assertOwnedLibraryAttachments/);
  assert.match(service, /asset_id\?: string/);
});

test('shared image component exports draggable signed URLs and chat persists references, not duplicate bytes', () => {
  for (const transferType of ['text/uri-list', 'text/plain', 'DownloadURL']) assert.match(image, new RegExp(transferType.replace('/', '\\/')));
  assert.match(image, /createSignedLink/);
  assert.match(viewer, /Library \/|>Library</);
  assert.match(viewer, /Copy share link/);
  assert.match(chat, /assetId: asset\.assetId/);
  assert.match(chat, /if \(attachment\.assetId && attachment\.contentUrl\)/);
  assert.match(chat, /delete message\.imageData/);
  assert.match(libraryClient, /\/api\/library\/assets/);
});

test('legacy artifacts paths remain a compatibility boundary', () => {
  assert.match(app, /path="\/artifacts" element=\{<LibraryRouteRedirect/);
  assert.match(chat, /path\.startsWith\('\/artifacts'\)/);
  const compatibility = read('src', 'components', 'playground', 'Chat', 'ChatArtifactsPage.tsx');
  assert.match(compatibility, /export \{ default \} from '\.\/ChatLibraryPage'/);
});
