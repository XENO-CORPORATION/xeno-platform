/**
 * Opening a chat that belongs to a project keeps the user in that project.
 *
 * The bug: selecting a project's chat "teleported" to the global Chats and Tasks view - the load
 * handler dismissed every overlay (the project included) and pushed `/c/:id`, and the first message
 * from the project composer did the same. The fix makes the URL the source of truth
 * (`/overview/chat/projects/:p/c/:id`) and the project a derived context.
 *
 * (a) pure unit tests of the URL module, (b) source gates on the wiring, each extracting the body it
 * asserts about so that deleting the behaviour fails the gate. The real-browser walk is
 * chat-project-context-browser.test.mjs.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildChatConversationPath,
  buildProjectConversationPath,
  buildProjectPath,
  buildProjectsPath,
  conversationUrlCorrection,
  normalizeChatPathname,
  parseChatLocation,
} from '../src/components/playground/Chat/chatRoutes.ts';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const chat = await read('../src/components/playground/Chat/ChatWithLLM.tsx');
const app = await read('../src/App.tsx');
const overview = await read('../src/pages/Overview.tsx');

const P = 'p-1';
const C = '33333333-3333-4333-8333-333333333333';

test('parses every project and conversation URL form', () => {
  assert.deepEqual(parseChatLocation('/overview/chat/llm'), { view: 'chat', projectId: null, conversationId: null });
  assert.deepEqual(parseChatLocation('/overview/chat/llm/' + C), { view: 'conversation', projectId: null, conversationId: C });
  assert.deepEqual(parseChatLocation('/overview/chat/projects'), { view: 'projects', projectId: null, conversationId: null });
  assert.deepEqual(parseChatLocation('/overview/chat/projects/' + P), { view: 'project', projectId: P, conversationId: null });
  assert.deepEqual(parseChatLocation(`/overview/chat/projects/${P}/c/${C}`), { view: 'project-conversation', projectId: P, conversationId: C });
});

test('compact aliases mean the same thing as the canonical forms', () => {
  assert.deepEqual(parseChatLocation('/c/' + C), parseChatLocation('/overview/chat/llm/' + C));
  assert.deepEqual(parseChatLocation('/chat/c/' + C), parseChatLocation('/overview/chat/llm/' + C));
  assert.deepEqual(parseChatLocation('/overview/c/' + C), parseChatLocation('/overview/chat/llm/' + C));
  assert.deepEqual(parseChatLocation('/projects'), parseChatLocation('/overview/chat/projects'));
  assert.deepEqual(parseChatLocation('/projects/' + P), parseChatLocation('/overview/chat/projects/' + P));
  assert.deepEqual(parseChatLocation(`/projects/${P}/c/${C}`), parseChatLocation(`/overview/chat/projects/${P}/c/${C}`));
  assert.equal(parseChatLocation('/c').view, 'chat');
  assert.equal(parseChatLocation('/chat').view, 'chat');
});

test('odd inputs: trailing slashes, query, hash, encoded ids, garbage', () => {
  assert.deepEqual(parseChatLocation(`/overview/chat/projects/${P}/c/${C}/?x=1#y`), { view: 'project-conversation', projectId: P, conversationId: C });
  assert.equal(parseChatLocation('/overview/chat/projects/').view, 'projects');
  assert.equal(parseChatLocation('//overview//chat//projects//' + P).projectId, P);
  assert.equal(parseChatLocation('/overview/chat/projects/' + encodeURIComponent('a b')).view, 'projects', 'an id with a space is not an id');
  assert.equal(parseChatLocation('/overview/chat/projects/%E0%A4%A').view, 'projects', 'malformed escapes do not throw');
  assert.equal(parseChatLocation('/overview/chat/llm/%2e%2e%2Fx').view, 'other');
  assert.equal(parseChatLocation('/overview/chat/projects/' + P + '/c').view, 'project', 'a half-formed conversation path is the project home');
  assert.equal(parseChatLocation('/overview/chat/projects/' + P + '/files/x').view, 'project');
  assert.equal(parseChatLocation('').view, 'chat');
  assert.equal(parseChatLocation(undefined).view, 'chat');
  assert.equal(parseChatLocation('/overview/chat/llm/' + 'x'.repeat(200)).view, 'other');
});

test('other surfaces, and the ACCOUNT projects page, are not chat locations', () => {
  for (const path of ['/overview/projects', '/overview/projects/abc', '/overview/chat/library', '/scheduled', '/settings', '/overview/generation/image', '/overview/home']) {
    assert.equal(parseChatLocation(path).view, 'other', path);
  }
});

test('builders produce the canonical URL and round-trip through the parser', () => {
  assert.equal(buildProjectsPath(), '/chat/projects');
  assert.equal(buildProjectPath(P), '/chat/projects/p-1');
  assert.equal(buildProjectConversationPath(P, C), `/chat/projects/p-1/c/${C}`);
  assert.equal(buildChatConversationPath(null, C), '/chat/c/' + C);
  assert.equal(buildChatConversationPath(P, C), buildProjectConversationPath(P, C));
  for (const [p, c] of [[P, C], [null, C], ['convo-1', 'convo-1790000000000']]) {
    const parsed = parseChatLocation(buildChatConversationPath(p, c));
    assert.equal(parsed.projectId, p);
    assert.equal(parsed.conversationId, c);
  }
  assert.equal(normalizeChatPathname('a//b/?q#h'), '/a/b');
});

test('URL correction: wrong or missing project is replaced; project home and other chats are never rewritten', () => {
  // conversation belongs to B, URL says A -> B
  assert.equal(conversationUrlCorrection(`/overview/chat/projects/A/c/${C}`, C, 'B'), `/chat/projects/B/c/${C}`);
  // plain URL, conversation has a project -> project URL
  assert.equal(conversationUrlCorrection('/overview/chat/llm/' + C, C, P), buildProjectConversationPath(P, C));
  // moved OUT of a project -> plain URL
  assert.equal(conversationUrlCorrection(buildProjectConversationPath(P, C), C, null), '/chat/c/' + C);
  // already right
  assert.equal(conversationUrlCorrection(buildProjectConversationPath(P, C), C, P), null);
  assert.equal(conversationUrlCorrection('/overview/chat/llm/' + C, C, null), null);
  // a project HOME must not be rewritten into a conversation, nor another conversation's URL
  assert.equal(conversationUrlCorrection(buildProjectPath(P), C, P), null);
  assert.equal(conversationUrlCorrection('/overview/chat/llm/other', C, P), null);
});

function body(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

test('handleLoadConversation keeps the project: no blanket dismissal-and-/c/ push', () => {
  const load = body(chat, 'const handleLoadConversation = async', 'const conversationToLoad = conversationHistory.find');
  assert.doesNotMatch(load, /pushState\([^)]*`\/c\//, 'must not push the compact /c/ URL');
  assert.match(load, /buildChatConversationPath\(resolvedProjectId, conversationId\)/);
  assert.match(load, /cachedRecord\.projectId/);
  assert.match(load, /pendingChatProjectIdRef\.current = null/);
  assert.match(load, /activeConversationIdRef\.current = conversationId/);
});

test('the project composer start does not dismiss the project context', () => {
  const effect = body(chat, 'Leave project overlays once a *different* conversation', '// --- NEW: State for Context Limit Warning');
  assert.doesNotMatch(effect, /dismissChatOverlays\(\)/);
  assert.doesNotMatch(effect, /setHistoryNavView\('chats'\)/);
  assert.match(effect, /setActiveProjectId\(null\)/);
  const register = body(chat, 'const register = (id: string): string => {', 'return id;');
  assert.match(register, /buildChatConversationPath\(projectId \?\? null, id\)/);
  assert.doesNotMatch(register, /`\/c\/\$\{id\}`/);
});

test('the URL, not storage, decides the initial project and projects page', () => {
  const init = body(chat, 'const [activeProjectId, setActiveProjectId] = useState', 'const [projectsPageSearch');
  assert.doesNotMatch(init, /localStorage/);
  assert.match(init, /parseChatLocation\(window\.location\.pathname\)/);
  const page = body(chat, 'const [isProjectsPageOpen, setIsProjectsPageOpen] = useState', 'const [isArtifactsPageOpen');
  assert.doesNotMatch(page, /localStorage/);
});

test('New chat inside a project stays in the project; leaving is explicit', () => {
  const fn = body(chat, 'const handleNewChat = (options?: unknown) => {', 'void clearPendingChatSkills()');
  assert.match(fn, /leaveProject/);
  assert.match(fn, /projectContextIdRef\.current/);
  assert.match(fn, /openProject\(stayInProjectId\)/);
  assert.match(fn, /pendingChatProjectIdRef\.current = null/);
});

test('one apply-location path serves mount, router changes and Back/Forward; a mismatch is replaced, not pushed', () => {
  assert.match(chat, /applyChatLocationRef\.current\(window\.location\.pathname\)/);
  const pop = body(chat, 'const handlePopState = () =>', 'window.addEventListener');
  assert.match(pop, /applyChatLocationRef/);
  const fix = body(chat, 'conversationUrlCorrection(', 'if (correction)');
  assert.ok(fix.length > 0);
  assert.match(chat, /window\.history\.replaceState\(window\.history\.state, '', correction\)/);
  assert.doesNotMatch(chat, /openProject\(match\[1\]\)/, 'the hand-rolled /projects regex is gone');
});

test('the project sidebar section, breadcrumb and route notices are mounted', () => {
  assert.match(chat, /<ProjectChatsSidebarSection[\s\S]*?projectId=\{projectContextId\}/);
  assert.match(chat, /!isProjectScopedSidebar && historyNavView === 'chats'/);
  assert.match(chat, /<ChatBreadcrumb[\s\S]*?projectId=\{conversationProjectId\}/);
  assert.match(chat, /kind=\{projectsLoaded \? 'project-missing' : 'project-loading'\}/);
  assert.match(chat, /kind=\{conversationLoad\.status === 'loading' \? 'chat-loading' : 'chat-unavailable'\}/);
  assert.match(chat, /setConversationLoad\(\{ id: conversationId, status: 'unavailable' \}\)/);
});

test('the routes exist: Overview mounts the surface and App redirects the compact form', () => {
  assert.match(overview, /path="chat\/projects\/:projectId\/c\/:conversationId" element=\{<MultiChatContainer \/>\}/);
  assert.match(app, /path="\/projects\/:projectId\/c\/:conversationId" element=\{<ProjectRouteRedirect \/>\}/);
  assert.match(app, /\/chat\/projects\/\$\{encodeURIComponent\(projectId\)\}\/c\/\$\{encodeURIComponent\(conversationId\)\}/);
  // the chat has its own address: /chat/* mounts the surface, and that shell answers it with the chat routes
  assert.match(app, /<Route path="\/chat\/\*" element=\{/);
  assert.match(overview, /chatMount \? <Routes>[\s\S]*?path="projects\/:projectId\/c\/:conversationId" element=\{<MultiChatContainer \/>\}/);
});

test('a project deleted while open does not leave its address behind', () => {
  const del = body(chat, 'A project deleted while open', 'setActiveProjectId((current)');
  assert.match(del, /replaceState\(\{ view: 'projects' \}, '', buildProjectsPath\(\)\)/);
});

test('the project panel is a drawer on a phone', () => {
  assert.match(chat, /useState\(\(\) => typeof window === 'undefined' \|\| window\.innerWidth > MOBILE_BREAKPOINT_PX\)/);
  assert.match(chat, /data-project-panel-scrim/);
  assert.match(chat, /event\.key === 'Escape'/);
});
