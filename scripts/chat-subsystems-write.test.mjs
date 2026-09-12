/**
 * Chat subsystem writes must be reachable from the UI that creates them.
 *
 * Each helper (createArtifact, addMemoryEntry, createChatProject, …) can
 * exist, and each route can INSERT, and the page can still never call the
 * helper — or the helper can exist next to a service call that sits in a
 * different function. That is the forum retract / 76-nodes shape: the
 * pieces are proven, the connection between them is not.
 *
 * This gate extracts the FUNCTION BODY and requires the service call
 * inside it. A repo-wide grep that finds both strings separately still
 * passes a severed caller. Mutation-checked that way.
 *
 * Source-only. No live database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const chat = (...p) => join(ROOT, 'src', 'components', 'playground', 'Chat', ...p);
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ARTIFACTS = codeOnly(readFileSync(chat('chatArtifacts.ts'), 'utf8'));
const ARTIFACTS_PAGE = codeOnly(readFileSync(chat('ChatLibraryPage.tsx'), 'utf8'));
const SCHEDULED = codeOnly(readFileSync(chat('chatScheduled.ts'), 'utf8'));
const SCHEDULED_PAGE = codeOnly(readFileSync(chat('ChatScheduledPage.tsx'), 'utf8'));
const SKILLS = codeOnly(readFileSync(chat('chatSkillsLibrary.ts'), 'utf8'));
const SKILLS_PAGE = codeOnly(readFileSync(chat('ChatSkillsWorkspace.tsx'), 'utf8'));
const CUSTOMIZE = codeOnly(readFileSync(chat('chatCustomize.ts'), 'utf8'));
const SETTINGS_PAGE = codeOnly(readFileSync(chat('ChatGlobalSettingsPage.tsx'), 'utf8'));
const WITH_LLM = codeOnly(readFileSync(chat('ChatWithLLM.tsx'), 'utf8'));
const ROUTES = codeOnly(
  readFileSync(join(ROOT, 'src', 'server', 'routes', 'chatRoutes.js'), 'utf8'),
);
const SCHEDULED_WORKER = codeOnly(
  readFileSync(join(ROOT, 'src', 'server', 'workers', 'chatScheduledWorker.js'), 'utf8'),
);

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

function extractRoute(src, pathLit) {
  const single = src.indexOf(`router.post('${pathLit}'`);
  const dbl = src.indexOf(`router.post("${pathLit}"`);
  const start = single === -1 ? dbl : single;
  if (start === -1) return '';
  return extractFrom(src.slice(start), 'router.post');
}

test('library documents: the page calls createArtifact, and that body hits the service', () => {
  const page = extractFrom(ARTIFACTS_PAGE, 'const createDocument = async');
  assert.match(
    page,
    /await createArtifact\(/,
    'ChatLibraryPage new-document control never calls createArtifact — the form is a dead button.',
  );
  const body = extractFrom(ARTIFACTS, 'export const createArtifact');
  assert.match(
    body,
    /chatService\.createArtifact\(/,
    'createArtifact exists but does not call chatService.createArtifact — a local id is not a row.',
  );
  const route = extractRoute(ROUTES, '/artifacts');
  assert.match(
    route,
    /INSERT INTO chat_artifacts/,
    'POST /artifacts never INSERTs — the UI write has nowhere to land.',
  );
});

test('memories: the settings page calls addMemoryEntry, and that body hits the service', () => {
  const page = extractFrom(SETTINGS_PAGE, 'const handleAddMemory = async');
  assert.match(
    page,
    /await addMemoryEntry\(/,
    'ChatGlobalSettingsPage never calls addMemoryEntry — Saved memories is display-only.',
  );
  const body = extractFrom(CUSTOMIZE, 'export const addMemoryEntry');
  assert.match(
    body,
    /chatService\.addMemory\(/,
    'addMemoryEntry exists but does not call chatService.addMemory.',
  );
  const route = extractRoute(ROUTES, '/memories');
  assert.match(
    route,
    /INSERT INTO chat_user_memories/,
    'POST /memories never INSERTs.',
  );
});

test('projects: createChatProject awaits the service and uses the server id', () => {
  const submit = extractFrom(WITH_LLM, 'const submitCreateProjectModal = async');
  assert.match(
    submit,
    /await createChatProject\(/,
    'the create-project modal never awaits createChatProject.',
  );
  const body = extractFrom(WITH_LLM, 'const createChatProject = useCallback');
  assert.match(
    body,
    /chatService\.createProject\(/,
    'createChatProject never calls chatService.createProject — the project is local-only.',
  );
  assert.match(
    body,
    /id:\s*server\.id/,
    'the UI must keep the server id. A local `project-${now}` id cannot join project files.',
  );
  const route = extractRoute(ROUTES, '/projects');
  assert.match(route, /createAuthorizedProject\(/, 'POST /projects never reaches transactional project creation.');
});

test('project files: handleAddProjectFiles writes through addProjectFile', () => {
  const body = extractFrom(WITH_LLM, 'const handleAddProjectFiles = useCallback');
  assert.match(
    body,
    /chatService\.addProjectFile\(/,
    'handleAddProjectFiles never calls chatService.addProjectFile — files stay in the browser.',
  );
  const route = extractRoute(ROUTES, '/projects/:id/files');
  assert.match(
    route,
    /linkAssetToProject\(/,
    'POST /projects/:id/files never reaches normalized Library membership.',
  );
});

test('authenticated project surfaces never substitute prototype rows', () => {
  assert.doesNotMatch(
    WITH_LLM,
    /MOCK_(?:PROJECT|CHAT_FILES)/,
    'authenticated project/chat surfaces still contain a mock-data fallback.',
  );
  assert.doesNotMatch(
    SCHEDULED,
    /scheduledStore|sessionStorage/,
    'scheduled writes still fail open to browser-only storage.',
  );
});

test('project chat membership persists on create, move, list, and direct load', () => {
  const create = extractFrom(WITH_LLM, 'const createConversationForMessages = async');
  assert.match(create, /project_id:\s*projectId/, 'new project chats omit project_id.');

  const assign = extractFrom(WITH_LLM, 'const handleAssignConversationToProject = async');
  assert.match(
    assign,
    /chatService\.updateConversation\(conversationId, \{ project_id: projectId \}\)/,
    'moving an existing chat between projects is still local-only.',
  );

  assert.match(
    WITH_LLM,
    /projectId:\s*conv\.project_id \?\? null/,
    'conversation lists discard persisted project_id.',
  );
  assert.match(
    WITH_LLM,
    /projectId:\s*fullConversation\.project_id \?\? null/,
    'direct conversation loads discard persisted project_id.',
  );

  assert.match(
    ROUTES,
    /updates\.push\(`project_id =/,
    'the conversation update route cannot persist project_id.',
  );
  assert.match(
    ROUTES,
    /c\.is_archived, c\.project_id/,
    'conversation lists do not return project_id.',
  );
});

test('project files are account Library assets, not browser-only placeholders', () => {
  const upload = extractFrom(WITH_LLM, 'const handleAddProjectFiles = useCallback');
  assert.match(upload, /libraryService\.upload\(/, 'project files do not enter the account Library.');
  assert.match(upload, /storage_key:\s*asset\.assetId/, 'project file membership does not retain the Library asset id.');
  assert.match(
    ROUTES,
    /getAuthorizedLibraryFile\(req\.db, userPrincipal\(userId\), storage_key\)/,
    'project files can link an unowned or deleted Library asset.',
  );
  assert.doesNotMatch(ROUTES, /SELECT id FROM files\b/, 'project file ownership checks query a table that does not exist.');
});

test('scheduled: the page calls createScheduledTask, and that body hits the service', () => {
  const page = extractFrom(SCHEDULED_PAGE, 'await createScheduledTask');
  assert.match(
    SCHEDULED_PAGE,
    /await createScheduledTask\(/,
    'ChatScheduledPage never calls createScheduledTask.',
  );
  assert.ok(page.length > 0, 'the createScheduledTask call site is missing.');
  const body = extractFrom(SCHEDULED, 'export const createScheduledTask');
  assert.match(
    body,
    /chatService\.createScheduledTask\(/,
    'createScheduledTask exists but does not call chatService.createScheduledTask.',
  );
  const route = extractRoute(ROUTES, '/scheduled');
  assert.match(
    route,
    /INSERT INTO chat_scheduled_tasks/,
    'POST /scheduled never INSERTs.',
  );
});

test('project schedules are server-owned and the worker never fabricates an answer', () => {
  const projectCreate = extractFrom(WITH_LLM, 'const submitProjectScheduledCreate = useCallback');
  assert.match(projectCreate, /await createScheduledTask\(/, 'project schedules are still local-only.');
  assert.match(projectCreate, /projectId:\s*activeProjectId/, 'project schedules omit their project id.');
  assert.match(projectCreate, /nextRunAt:/, 'the selected project schedule time is discarded.');
  assert.doesNotMatch(
    SCHEDULED_WORKER,
    /Automated Response for task/,
    'the worker fabricates success when inference is unavailable.',
  );
  assert.match(
    SCHEDULED_WORKER,
    /XENO inference gateway is not configured/,
    'the worker does not fail closed when inference is unavailable.',
  );
});

test('skills: the workspace calls createLibrarySkill, and that body hits the service', () => {
  assert.match(
    SKILLS_PAGE,
    /await createLibrarySkill\(/,
    'ChatSkillsWorkspace never calls createLibrarySkill.',
  );
  const body = extractFrom(SKILLS, 'export const createLibrarySkill');
  assert.match(
    body,
    /chatService\.createSkill\(/,
    'createLibrarySkill exists but does not call chatService.createSkill.',
  );
  const route = extractRoute(ROUTES, '/skills');
  assert.match(route, /INSERT INTO chat_skills/, 'POST /skills never INSERTs.');
});
