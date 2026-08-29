/**
 * A local `convo-<timestamp>` id is UI-only. Sending it to Postgres is a 500
 * (`invalid input syntax for type uuid`). After createConversation fails
 * (often because the backend is 502), ChatWithLLM falls through to that
 * local id and the next persist hits this path.
 *
 * Server: 400 with code invalid_conversation_id BEFORE any query.
 * Client: addMessage / addMessagesBatch refuse the fetch entirely.
 *
 * Source-only. Mutation-checked by extracting the handler / function body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = readFileSync(join(ROOT, 'src', 'server', 'routes', 'chatRoutes.js'), 'utf8');
const SERVER = readFileSync(join(ROOT, 'src', 'server', 'index.js'), 'utf8');
const SHARED_VIEW = readFileSync(join(ROOT, 'src', 'pages', 'SharedChatView.tsx'), 'utf8');
const SERVICE = readFileSync(join(ROOT, 'src', 'services', 'chatService.ts'), 'utf8');
const CONTEXT = readFileSync(join(ROOT, 'src', 'server', 'utils', 'workspaceContext.js'), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function extractFrom(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return '';
  const from = src.slice(start);
  const brace = from.indexOf('{');
  if (brace === -1) return from.slice(0, 4000);
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = brace; i < from.length; i++) {
    const c = from[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return from.slice(0, i + 1);
    }
  }
  return from.slice(0, 4000);
}

function extractRoute(src, method, pathLit) {
  const needle = `router.${method}('${pathLit}'`;
  const start = src.indexOf(needle);
  if (start === -1) return '';
  return extractFrom(src.slice(start), `router.${method}`);
}

const UUID_SRC = CONTEXT.match(/export const UUID_RE = \/[^/]+\/i/);
assert.ok(UUID_SRC, 'server UUID_RE is missing — this gate cannot pin the client copies');

test('the two message POST routes reject a non-UUID id before SQL', () => {
  const helper = extractFrom(ROUTES, 'function rejectIfNotPersistedConversationId');
  assert.match(helper, /invalid_conversation_id/, 'the helper must name the code');
  assert.match(helper, /status\(400\)/, 'the helper must be 400, not 500');
  for (const pathLit of ['/conversations/:id/messages', '/conversations/:id/messages/batch']) {
    const body = extractRoute(ROUTES, 'post', pathLit);
    assert.ok(body, `POST ${pathLit} is missing`);
    const firstQuery = body.indexOf('req.db.query');
    const rejectAt = body.indexOf('rejectIfNotPersistedConversationId');
    assert.ok(rejectAt !== -1, `POST ${pathLit} never calls rejectIfNotPersistedConversationId`);
    assert.ok(
      firstQuery === -1 || rejectAt < firstQuery,
      `POST ${pathLit} queries before validating the id — convo-* still 500s`,
    );
  }
});

test('rejectIfNotPersistedConversationId uses the shared UUID_RE', () => {
  const helper = extractFrom(ROUTES, 'function rejectIfNotPersistedConversationId');
  assert.match(helper, /UUID_RE\.test/, 'the helper must use UUID_RE, not a private copy');
});

test('addMessage and addMessagesBatch refuse a local convo-* id', () => {
  // Slice between methods. extractFrom stops at the first `{`, which in
  // addMessage is the TypeScript argument type, not the function body.
  const src = codeOnly(SERVICE);
  const addStart = src.indexOf('async addMessage(');
  const batchStart = src.indexOf('async addMessagesBatch(');
  const nextStart = src.indexOf('async updateMessage(');
  assert.ok(addStart !== -1 && batchStart !== -1 && nextStart !== -1);
  const add = src.slice(addStart, batchStart);
  const batch = src.slice(batchStart, nextStart);
  assert.match(
    add,
    /isPersistedConversationId\(conversationId\)/,
    'addMessage must refuse a non-UUID id before fetch — that is the 500.',
  );
  assert.match(
    batch,
    /isPersistedConversationId\(conversationId\)/,
    'addMessagesBatch must refuse a non-UUID id before fetch.',
  );
  const addFetch = add.indexOf('fetch(');
  const addGuard = add.indexOf('isPersistedConversationId');
  assert.ok(addGuard !== -1 && addGuard < addFetch, 'addMessage guard must precede fetch');
});

test('updateConversation and deleteConversation refuse a local convo-* id', () => {
  const src = codeOnly(SERVICE);
  const updateStart = src.indexOf('async updateConversation(');
  const deleteStart = src.indexOf('async deleteConversation(');
  const nextAfterDelete = src.indexOf('async addMessage(');
  assert.ok(updateStart !== -1 && deleteStart !== -1);
  const update = src.slice(updateStart, deleteStart);
  const del = nextAfterDelete > deleteStart
    ? src.slice(deleteStart, nextAfterDelete)
    : src.slice(deleteStart);
  assert.match(update, /isPersistedConversationId\(id\)/, 'updateConversation must refuse a non-UUID id');
  assert.match(del, /isPersistedConversationId\(id\)/, 'deleteConversation must refuse a non-UUID id');
  const updateFetch = update.indexOf('fetch(');
  const updateGuard = update.indexOf('isPersistedConversationId');
  assert.ok(updateGuard !== -1 && updateGuard < updateFetch, 'updateConversation guard must precede fetch');
});

test('share routes reject a non-UUID id before SQL', () => {
  for (const [method, pathLit] of [
    ['post', '/conversations/:id/share'],
    ['delete', '/conversations/:id/share'],
    ['get', '/conversations/:id/shares'],
  ]) {
    const body = extractRoute(ROUTES, method, pathLit);
    assert.ok(body, `${method.toUpperCase()} ${pathLit} is missing`);
    const firstQuery = body.indexOf('req.db.query');
    const rejectAt = body.indexOf('rejectIfNotPersistedConversationId');
    assert.ok(rejectAt !== -1, `${method.toUpperCase()} ${pathLit} never rejects a local id`);
    assert.ok(
      firstQuery === -1 || rejectAt < firstQuery,
      `${method.toUpperCase()} ${pathLit} queries before validating the id`,
    );
  }
});

test('public share lookup uses the production users.display_name column', () => {
  const body = extractRoute(ROUTES, 'get', '/share/:token');
  assert.ok(body, 'GET /share/:token is missing');
  assert.match(
    body,
    /u\.display_name\s+as\s+owner_name/i,
    'public share lookup must select users.display_name as owner_name',
  );
  assert.doesNotMatch(
    body,
    /u\.displayname\b/i,
    'users.displayname does not exist in the production schema and makes valid shares return 500',
  );
  assert.match(body, /c\.created_at\s+AS\s+conversation_created_at/i, 'share payload needs the conversation date');
  assert.match(body, /created_at:\s*share\.conversation_created_at/, 'share response must expose created_at');
});

test('SharedChatView consumes the service return shape directly', () => {
  assert.match(SHARED_VIEW, /setConversation\(data\)/, 'chatService returns the share object directly');
  assert.doesNotMatch(
    SHARED_VIEW,
    /data\.conversation/,
    'a successful share response has no data.conversation wrapper and would render Unavailable',
  );
});

test('share creation uses the ESM crypto import', () => {
  const body = extractRoute(ROUTES, 'post', '/conversations/:id/share');
  assert.match(ROUTES, /import crypto from 'crypto';/, 'chat routes must import crypto in ESM');
  assert.match(body, /crypto\.randomBytes\(32\)/, 'share tokens must use the imported crypto module');
  assert.doesNotMatch(body, /require\s*\(/, 'require is undefined in this ESM route');
});

test('chat auth exposes the exact shared-conversation GET but not share mutations', () => {
  const middleware = extractFrom(SERVER, 'const chatAuthMiddleware');
  assert.match(middleware, /req\.method\s*===\s*'GET'/, 'public share exemption must be GET-only');
  assert.match(
    middleware,
    /\^\\\/share\\\/\[\^\/\]\+\$/,
    'public share exemption must match exactly /share/:token',
  );
  assert.match(middleware, /if \(isPublicShareRead\)[\s\S]*optionalAuthMiddleware\(req, res, next\)/, 'public share read must reach optional auth');
  assert.doesNotMatch(
    middleware,
    /publicPaths\s*=\s*\[[^\]]*share/,
    'share must not be a prefix exemption or /share/:token/accept would become public',
  );
});

test('full-scale writes authorize every supplied foreign id through ReBAC before inserting', () => {
  const helperStart = ROUTES.indexOf('async function rejectUnownedChatReferences');
  const helperEnd = ROUTES.indexOf('const router = express.Router()', helperStart);
  const helper = ROUTES.slice(helperStart, helperEnd);
  assert.match(helper, /object: `conversation:\$\{conversationId\}`[\s\S]*relation: 'viewer'/, 'conversation references need inherited viewer authority');
  assert.match(helper, /SELECT conversation_id FROM chat_messages[\s\S]*relation: 'reviewer'/, 'message references need parent-conversation authority');
  assert.match(helper, /object: `project:\$\{projectId\}`[\s\S]*relation: 'viewer'/, 'project references need inherited viewer authority');

  for (const pathLit of [
    '/artifacts',
    '/memories',
  ]) {
    const body = extractRoute(ROUTES, 'post', pathLit);
    assert.ok(body, `POST ${pathLit} is missing`);
    const guardAt = body.indexOf('rejectUnownedChatReferences');
    const insertAt = body.indexOf('INSERT INTO');
    assert.ok(guardAt !== -1, `POST ${pathLit} does not authorize its foreign references`);
    assert.ok(insertAt === -1 || guardAt < insertAt, `POST ${pathLit} authorizes after inserting`);
  }
  assert.match(extractRoute(ROUTES, 'post', '/conversations'), /requireResourceRelation[\s\S]*'project'/);
  assert.match(extractRoute(ROUTES, 'post', '/scheduled'), /requireResourceRelation[\s\S]*'conversation'[\s\S]*requireResourceRelation[\s\S]*'project'/);
  assert.match(extractRoute(ROUTES, 'post', '/skills'), /requireResourceRelation[\s\S]*'conversation'[\s\S]*'editor'/);
  assert.match(extractRoute(ROUTES, 'post', '/projects/:id/files'), /linkAssetToProject\(/);
});

test('project conversations cross the client and server persistence boundary', () => {
  const createRoute = extractRoute(ROUTES, 'post', '/conversations');
  assert.match(createRoute, /project_id/, 'conversation create route must accept project_id');
  assert.match(createRoute, /INSERT INTO chat_conversations[\s\S]*project_id/, 'project_id must be persisted');
  const createStart = SERVICE.indexOf('async createConversation(');
  const updateStart = SERVICE.indexOf('async updateConversation(');
  const createClient = SERVICE.slice(createStart, updateStart);
  assert.match(createClient, /project_id\?: string/, 'chat service must carry project_id');
});

test('client conversation-id regex matches the server UUID_RE source', () => {
  const clientRe = SERVICE.match(/export const PERSISTED_CONVERSATION_ID_RE =\s*(\/[^/\n]+\/i)/);
  const serverRe = CONTEXT.match(/export const UUID_RE = (\/[^/\n]+\/i)/);
  assert.ok(clientRe && serverRe, 'could not read both UUID regexes');
  assert.equal(clientRe[1], serverRe[1], 'client regex drifted from server UUID_RE');
});
