/**
 * Per-user project pins: source-level wiring and REACHABILITY gate.
 *
 * "Built, tested, unreachable" is this repo's recurring failure, so these assertions are about the
 * connections, not the parts: route -> service, GET /projects -> annotation, client -> endpoint,
 * sidebar -> mounted component -> handlers. The behavioural proof is the DB-gated
 * scripts/chat-project-pins-database.test.mjs.
 *
 * Run: node --test scripts/chat-project-pins.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const routes = read('src/server/routes/chatRoutes.js');
const service = read('src/server/services/chatProjectPins.js');
const chatService = read('src/services/chatService.ts');
const monolith = read('src/components/playground/Chat/ChatWithLLM.tsx');
const section = read('src/components/playground/Chat/PinnedProjectsSection.tsx');

test('migration is additive, per-user and cascades with the project and the user', () => {
  const file = readdirSync(join(ROOT, 'src/server/database/migrations')).find((f) => /^\d{14}-chat-project-pins\.sql$/.test(f));
  assert.ok(file, 'chat-project-pins migration must exist where the runner looks');
  const sql = read('src/server/database/migrations', file);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_project_pins/);
  assert.match(sql, /PRIMARY KEY \(user_id, project_id\)/);
  assert.match(sql, /project_id UUID NOT NULL REFERENCES chat_projects\(id\) ON DELETE CASCADE/);
  assert.match(sql, /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql.split('-- DOWN')[0], /\b(DROP|ALTER)\b/i, 'the UP half must be additive');
});

test('routes are wired to the service and authorized per user', () => {
  assert.match(routes, /router\.put\('\/projects\/:id\/pin'[\s\S]{0,400}pinProject\(req\.db, userId, req\.params\.id\)/);
  assert.match(routes, /router\.delete\('\/projects\/:id\/pin'[\s\S]{0,400}unpinProject\(req\.db, userId, req\.params\.id\)/);
  assert.match(routes, /router\.put\('\/projects\/pins\/order'[\s\S]{0,400}reorderPins\(req\.db, userId, req\.body\?\.ids\)/);
  assert.match(service, /requireResourceRelation\(db, userPrincipal\(userId\), 'project', projectId, 'viewer'\)/, 'pin needs viewer');
  assert.match(service, /WHERE user_id = \$1/, 'reads are scoped to the caller');
});

test('GET /projects and GET /projects/:id carry pinned + pin_position, and a pin survives the page limit', () => {
  const list = routes.slice(routes.indexOf("router.get('/projects', async"), routes.indexOf("router.get('/projects/:id', async"));
  assert.match(list, /annotateProjectPins\(/);
  assert.match(list, /offset === 0 && p\.pinned/);
  const one = routes.slice(routes.indexOf("router.get('/projects/:id', async"), routes.indexOf("router.post('/projects', async"));
  assert.match(one, /annotateProjectPins\(req\.db, userId, \[project\]\)/);
});

test('client functions hit the pin endpoints', () => {
  assert.match(chatService, /async pinProject\([\s\S]{0,300}\/pin`[\s\S]{0,80}method: 'PUT'/);
  assert.match(chatService, /async unpinProject\([\s\S]{0,300}\/pin`[\s\S]{0,80}method: 'DELETE'/);
  assert.match(chatService, /async reorderPinnedProjects\([\s\S]{0,300}\/projects\/pins\/order/);
});

test('the sidebar MOUNTS PinnedProjectsSection (chat list and Projects tab) with live handlers', () => {
  assert.match(monolith, /import PinnedProjectsSection from '\.\/PinnedProjectsSection'/);
  const mounts = [...monolith.matchAll(/<PinnedProjectsSection\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(mounts.length, 2, 'one mount in the chat list, one in the Projects tab');
  for (const mount of mounts) {
    assert.match(mount, /onOpen=\{openProject\}/, 'opening goes through the app\'s own openProject path');
    assert.match(mount, /onUnpin=\{handleToggleProjectPin\}/);
    assert.match(mount, /onReorder=\{handleReorderPinnedProjects\}/);
    assert.match(mount, /projects=\{pinnedProjects\.map/);
  }
  assert.ok(mounts.some((m) => /showEmptyHint/.test(m)), 'the Projects tab shows the empty hint');
  assert.match(monolith, /isPinned: Boolean\(p\.pinned\)/, 'server pin state is read on load');
  assert.match(monolith, /chatService\.pinProject\(projectId\)/);
  assert.match(monolith, /chatService\.unpinProject\(projectId\)/);
  assert.match(monolith, /chatService\.reorderPinnedProjects\(orderedIds\)/);
});

test('every entry point offers Pin/Unpin: project card menu and project header', () => {
  assert.match(monolith, /onSelect=\{\(\) => handleToggleProjectPin\(project\.id\)\}/);
  assert.match(monolith, /onClick=\{\(\) => handleToggleProjectPin\(project\.id\)\}/);
});

test('mutations roll back and tell the person when the server refuses', () => {
  const fn = monolith.slice(monolith.indexOf('const handleToggleProjectPin'), monolith.indexOf('const handleReorderPinnedProjects'));
  assert.match(fn, /catch \(error\)[\s\S]*\.\.\.previous[\s\S]*setProjectFileNotice\(/);
  const reorder = monolith.slice(monolith.indexOf('const handleReorderPinnedProjects'), monolith.indexOf('const handleToggleProjectArchive'));
  assert.match(reorder, /catch \(error\)[\s\S]*snapshot[\s\S]*setProjectFileNotice\(/);
});

test('the component is props-in/callbacks-out and reorder is operable without a mouse', () => {
  assert.doesNotMatch(section, /chatService|accountService|fetch\(/, 'no service access inside the component');
  assert.match(section, /event\.altKey/);
  assert.match(section, /'ArrowUp'/);
  assert.match(section, /'ArrowDown'/);
  assert.match(section, /aria-live="polite"/);
  assert.match(section, /onPointerMove/);
  assert.match(section, /Unpin \$\{project\.name\}/);
});
