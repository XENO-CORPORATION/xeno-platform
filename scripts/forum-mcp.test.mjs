/**
 * WP8 — the MCP server.
 *
 * `dispatch` and `callTool` are pure enough to exercise with a stub db, so
 * unlike most gates in this work these are BEHAVIOURAL. The source gates that
 * remain cover the two things behaviour cannot show: that the tools call the
 * same service functions REST does, and that the route wires auth per-tool.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dispatch, callTool, manifest, TOOLS } from '../src/server/services/forumMcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES = readFileSync(
  join(__dirname, '..', 'src', 'server', 'routes', 'forumRoutes.js'), 'utf8');
const MCP = readFileSync(
  join(__dirname, '..', 'src', 'server', 'services', 'forumMcp.js'), 'utf8');

const noDb = { query: async () => ({ rows: [] }) };

// ── protocol ───────────────────────────────────────────────────────────────

test('rejects anything that is not JSON-RPC 2.0', async () => {
  const r = await dispatch(noDb, null, { id: 1, method: 'tools/list' });
  assert.equal(r.error.code, -32600, 'a missing jsonrpc field must be a protocol error');
});

test('initialize advertises tools and a protocol version', async () => {
  const r = await dispatch(noDb, null, { jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.ok(r.result.protocolVersion, 'clients negotiate on this');
  assert.deepEqual(r.result.capabilities.tools, {}, 'tools capability must be declared');
  assert.equal(r.result.serverInfo.name, 'xeno-forum');
});

test('an unknown method is -32601, not a crash', async () => {
  const r = await dispatch(noDb, null, { jsonrpc: '2.0', id: 1, method: 'resources/list' });
  assert.equal(r.error.code, -32601);
});

test('tools/call without a name is -32602', async () => {
  const r = await dispatch(noDb, null, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} });
  assert.equal(r.error.code, -32602);
});

// ── the auth boundary, which is per-tool ───────────────────────────────────

test('🔴 READS work with no credentials, WRITES do not', async () => {
  // The Record is public (§5.1) and the first thing a new agent does is look,
  // not write. But one endpoint carries every verb, so the boundary has to live
  // in the tool, not the route.
  const search = await callTool(noDb, null, 'forum_search', { query: 'anything at all' });
  assert.equal(search.isError, false, 'search must work unauthenticated');

  for (const t of ['forum_create_thread', 'forum_reply', 'forum_subscribe', 'forum_digest']) {
    const r = await callTool(noDb, null, t, {});
    assert.equal(r.isError, true, `${t} must refuse an unauthenticated caller`);
    assert.match(r.content[0].text, /requires authentication/);
  }
});

test('the route does NOT gate the whole endpoint', () => {
  // authMiddleware here would lock out the public read tools; no middleware at
  // all would expose the write ones. optionalAuth + per-tool checks is the only
  // combination that is right for both.
  const route = ROUTES.slice(ROUTES.indexOf("router.post('/mcp'"));
  assert.match(route.slice(0, 120), /optionalAuthMiddleware/,
    'the MCP endpoint must accept anonymous callers and check per tool.');
});

test('a suspended owner cannot post through MCP either', () => {
  // Same principal resolution as every other write path. An alternate surface
  // that skips the owner-cascade is a hole in it.
  const route = ROUTES.slice(ROUTES.indexOf("router.post('/mcp'"));
  const body = route.slice(0, route.indexOf('\n});'));
  assert.match(body, /resolvePrincipal\(req\.db, req\.user\.id\)/);
  assert.match(body, /assertPrincipalUsable\(principal\)/);
});

test('an unknown tool is an error, never a silent empty result', async () => {
  const r = await callTool(noDb, null, 'forum_delete_everything', {});
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Unknown tool/);
});

// ── the rules that make the tools worth calling ────────────────────────────

test('🔴 tools call the SAME service functions as REST', () => {
  // Not "mostly the same query". A second code path is how the two surfaces
  // drift until an agent and a browser disagree about what the forum contains —
  // and the agent is the one nobody is watching.
  assert.match(MCP, /import \* as svc from '\.\/forumService\.js'/);
  assert.match(MCP, /import \* as write from '\.\/forumWrite\.js'/);
  assert.doesNotMatch(MCP, /db\.query\(/,
    'MCP must not run its own SQL — that is the second code path.');
});

test('🔴 every read result carries a citable URL', () => {
  // §6.1 — an agent answering inside Pixel should cite a link the user can
  // click. A tool returning prose an agent must paraphrase turns a permanent
  // record into hearsay.
  assert.match(MCP, /const threadUrl = /, 'there must be one URL builder.');
  const get = MCP.slice(MCP.indexOf("case 'forum_get_thread'"));
  assert.match(get.slice(0, 900), /url: `\$\{threadUrl\(t\)\}#p\$\{p\.position\}`/,
    'posts need their own anchor, so an agent can cite the ANSWER rather than '
    + 'the thread and make the reader hunt for it.');
});

test('the dedup tool exists and says to call it FIRST', () => {
  // Joining an existing report is what makes the distinct-reporter count
  // meaningful. An agent will only do that if the tool description tells it to.
  const t = TOOLS.find((x) => x.name === 'forum_suggest_duplicate');
  assert.ok(t, 'forum_suggest_duplicate must exist');
  assert.match(t.description, /BEFORE forum_create_thread/,
    'the description is the only instruction an agent reads.');
});

test('the digest description warns against re-summarising', () => {
  // An agent handed aggregates and left to its own devices will expand them
  // back into per-thread prose, which is the thing aggregation prevented.
  const t = TOOLS.find((x) => x.name === 'forum_digest');
  assert.match(t.description, /Aggregated on purpose/);
});

test('tools/list does not leak our routing flags', async () => {
  const r = await dispatch(noDb, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const t of r.result.tools) {
    assert.equal(t.auth, undefined,
      '`auth` is our concern; a client seeing it might try to honour it.');
    assert.ok(t.inputSchema, `${t.name} must publish a schema`);
    assert.ok(t.description.length > 40, `${t.name} needs a description an agent can act on`);
  }
});

test('the manifest is honest about what needs a key', () => {
  const m = manifest();
  assert.equal(m.authentication.required, false, 'reads are public');
  const write = m.tools.find((t) => t.name === 'forum_create_thread');
  assert.equal(write.requiresAuth, true, 'and writes must be marked');
});
