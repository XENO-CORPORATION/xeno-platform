import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertOwnedLibraryAttachments,
  createSignedLibraryContentPath,
  decodeLegacyLibraryImageDataUrl,
  listLibraryItems,
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
const overviewTaskbar = read('src', 'components', 'overview', 'OverviewTaskbar.tsx');
const styles = read('src', 'index.css');
const app = read('src', 'App.tsx');
const legacyMigration = read('src', 'server', 'migrate-legacy-library-images.js');

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

test('legacy generation bytes map to managed assets without duplicate Library rows', async () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const decoded = decodeLegacyLibraryImageDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`);
  assert.equal(decoded.declaredMime, 'image/jpeg');
  assert.equal(decoded.mimeType, 'image/png');
  assert.equal(decoded.extension, 'png');

  let capturedSql = '';
  await listLibraryItems({ query: async (sql) => { capturedSql = sql; return { rows: [] }; } }, '20000000-0000-4000-8000-000000000002');
  assert.match(capturedSql, /AS asset_id/);
  assert.match(capturedSql, /legacy-image-generation/);
  assert.match(capturedSql, /legacy_generation_id/);
  assert.match(capturedSql, /migrated\.id/);
  assert.match(legacyMigration, /DRY RUN/);
  assert.match(legacyMigration, /pg_advisory_lock/);
  assert.match(legacyMigration, /registerManagedLibraryFile/);
  assert.match(legacyMigration, /if \(confirm\) await fs\.promises\.mkdir/);
  assert.match(legacyMigration, /if \(createdStorageFile\) await fs\.promises\.unlink/);
  assert.match(routes, /listLibraryItems\(req\.db, userId, req\.query\)/);
  assert.match(libraryClient, /item\.asset_id/);
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

test('Library list is metadata-only and grid thumbnails load only near the viewport', () => {
  assert.match(page, /new IntersectionObserver/);
  assert.match(page, /rootMargin: '160px'/);
  assert.match(page, /variant=thumbnail/);
  const listBranch = page.slice(page.indexOf("view === 'list'"), page.indexOf("<ul className=\"grid grid-cols-2"));
  assert.doesNotMatch(listBranch, /<LibraryThumbnail/);
  assert.match(libraryRoutes, /req\.query\.variant === 'thumbnail'/);
  assert.match(libraryRoutes, /resize\(384, 384/);
  assert.match(libraryRoutes, /webp\(\{ quality: 78 \}\)/);
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

test('Library viewer is a shell-isolated portal with bounded, honest preview states', () => {
  assert.match(page, /createPortal\(/);
  assert.match(page, /document\.body/);
  assert.match(page, /leftInset=\{viewerLeft\}/);
  assert.match(chat, /const TASKBAR_WIDTH_PX = 52/);
  assert.match(chat, /viewerLeft=\{\(isTaskbarHidden \? 0 : TASKBAR_WIDTH_PX\) \+ historyWorkspaceInsetPx\}/);
  assert.match(chat, /leftInset=\{\(isTaskbarHidden \? 0 : TASKBAR_WIDTH_PX\) \+ historyWorkspaceInsetPx\}/);
  assert.match(viewer, /data-library-asset-viewer="true"/);
  assert.match(viewer, /style=\{\{ left: Math\.max\(0, leftInset\) \}\}/);
  assert.match(viewer, /MAX_VISIBLE_THUMBNAILS = 9/);
  assert.match(viewer, /Preview unavailable/);
  assert.match(viewer, /disabled=\{!canExport\}/);
  assert.match(image, /data-library-image-state=\{state\}/);
  assert.match(image, /state !== 'ready' \|\| !url/);
  assert.doesNotMatch(image, /src=\{url \|\| undefined\}/);
  assert.doesNotMatch(styles, /body > \*:not\(\[data-library-asset-viewer='true'\]\)/);
});

test('Library viewer header shares the permanent taskbar top-row height', () => {
  assert.match(viewer, /<header className="grid h-\[50px\]/);
  assert.doesNotMatch(viewer, /<header className="grid h-14/);
});

test('Library image history is a semantic right-side rail', () => {
  assert.ok(viewer.indexOf('<main className=') < viewer.indexOf('<aside'));
  assert.match(viewer, /aria-label="Image history"/);
  assert.match(viewer, /data-library-preview-rail="right"/);
  assert.match(viewer, /overflow-y-auto border-l border-white\/10/);
  assert.doesNotMatch(viewer, /overflow-y-auto border-r border-white\/10/);
});

test('Overview taskbar divider sits on the right edge without changing rail width', () => {
  assert.match(overviewTaskbar, /relative box-border h-screen/);
  assert.match(overviewTaskbar, /data-overview-taskbar-divider="right"/);
  assert.match(overviewTaskbar, /absolute inset-y-0 right-0 z-10 w-px bg-white\/10/);
  assert.doesNotMatch(overviewTaskbar, /backdrop-blur-md border-r border-white\/10/);
});

test('legacy artifacts paths remain a compatibility boundary', () => {
  assert.match(app, /path="\/artifacts" element=\{<LibraryRouteRedirect/);
  assert.match(chat, /path\.startsWith\('\/artifacts'\)/);
  const compatibility = read('src', 'components', 'playground', 'Chat', 'ChatArtifactsPage.tsx');
  assert.match(compatibility, /export \{ default \} from '\.\/ChatLibraryPage'/);
});
