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
  assert.match(route, /INSERT INTO chat_projects/, 'POST /projects never INSERTs.');
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
    /INSERT INTO chat_project_files/,
    'POST /projects/:id/files never INSERTs.',
  );
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
