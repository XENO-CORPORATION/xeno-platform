// /api/mcp is generated from the capability catalogue (SPEC §19.3, §19.5): the old tools stay exactly as they were,
// the canonical ones are added beside them, and visibility is one predicate for the list, the catalogue and the call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mcp from '../src/server/services/xenoMcp.js';
import { CATALOGUE } from '../src/server/capabilities/catalogue.js';
import { toWire, fromWire, defineCapability } from '../src/server/capabilities/define.js';

const before = JSON.parse(readFileSync(new URL('../src/server/tests/xeno-mcp-tools-before.snapshot.json', import.meta.url)));
const ALL = { categories: [...mcp.CATEGORIES] };
const ADDED = new Set(['places', 'storage', 'forum', 'modes', 'workforce', 'publish', 'support', 'analytics', 'docs']);   // categories added after the snapshot: places (2026-10-19), storage + forum (WORKSPACE AGENT SURFACE P1), modes (MODES §8c, 2026-10-20), workforce (WORKSPACE AGENT SURFACE, 2026-10-20), publish (XENO Post, 2026-10-20)

for (const who of ['agent', 'human']) {
  test(`snapshot: every tool ${who}s listed before is listed after, byte for byte`, () => {
    const after = mcp.listTools(ALL, { kind: who });
    // byte for byte for every tool that existed; a tool may be ADDED only by a category folded in since (P1: storage, forum)
    const names = new Set(before[who].map((t) => t.name));
    const legacy = after.filter((t) => !t.name.includes('__'));
    assert.deepEqual(legacy.filter((t) => names.has(t.name)), before[who]);
    assert.deepEqual(legacy.filter((t) => !names.has(t.name)).map((t) => t.name.split('_')[0]).filter((c) => !ADDED.has(c)), []);
    const added = after.filter((t) => t.name.includes('__')).map((t) => t.name).sort();
    const expected = mcp.visibleCapabilities(ALL, { kind: who }).map((c) => toWire(c.name)).sort();
    assert.deepEqual(added, expected);
    assert.equal(after.length, legacy.length + expected.length);
  });
}

test('every Tasks, Canvas and media tool has a catalogue declaration, and every alias is a real tool', () => {
  const legacyNames = new Set(mcp.listTools(ALL, { kind: 'agent' }).filter((t) => !t.name.includes('__')).map((t) => t.name));
  for (const t of before.agent) assert.ok(legacyNames.has(t.name), `${t.name} is no longer served`);
  const aliased = new Set(CATALOGUE.filter((c) => c.surfaces.includes('mcp')).flatMap((c) => c.aliases));
  for (const n of legacyNames) assert.ok(aliased.has(n), `${n} has no declaration`);
  for (const a of aliased) assert.ok(legacyNames.has(a), `alias ${a} is not a served tool`);
});

test('annotations are derived from the class; the contract rides in _meta', () => {
  for (const t of mcp.listTools(ALL, { kind: 'agent' }).filter((x) => x.name.includes('__'))) {
    const c = CATALOGUE.find((x) => x.name === fromWire(t.name));
    assert.equal(t.annotations.readOnlyHint, c.class === 'safe');
    assert.equal(t.annotations.destructiveHint, c.class === 'irreversible');
    for (const k of ['class', 'cost', 'idempotency', 'preview', 'mode', 'provenance', 'version', 'reply']) assert.ok(t._meta[`xeno/${k}`] !== undefined, `${t.name} _meta xeno/${k}`);
  }
});

test('a caller without the category or not an agent sees the capability in NEITHER the catalogue nor tools/list', () => {
  const human = mcp.visibleCapabilities(ALL, { kind: 'human' }).map((c) => c.name);
  assert.ok(!human.includes('studio.image.generate') && !human.includes('agents.self.get'));
  assert.ok(!mcp.listTools(ALL, { kind: 'human' }).some((t) => t.name === 'studio__image__generate'));
  const tasksOnly = { categories: ['tasks'] };
  assert.ok(mcp.visibleCapabilities(tasksOnly, { kind: 'agent' }).every((c) => c.bind.category === 'tasks'));
  assert.ok(!mcp.listTools(tasksOnly, { kind: 'agent' }).some((t) => t.name.startsWith('canvas')));
  assert.notEqual(mcp.catalogueVersion(mcp.visibleCapabilities(tasksOnly, { kind: 'agent' })), mcp.catalogueVersion(mcp.visibleCapabilities(ALL, { kind: 'agent' })));
  assert.ok(mcp.visibleCapabilities(ALL, { kind: 'agent' }).every((c) => !('bind' in mcp.publicDeclaration(c))));
});

test('the canonical name and the alias route to the same service tool; a wire round trip is total', () => {
  for (const c of CATALOGUE.filter((x) => x.surfaces.includes('mcp'))) {
    const a = mcp.route(toWire(c.name)), b = mcp.route(c.aliases[0]);
    assert.equal(a.service, b.service); assert.equal(a.tool, b.tool); assert.equal(a.capability, c); assert.equal(b.capability, c);
    assert.equal(fromWire(toWire(c.name)), c.name);
  }
  // P1: the Forum is folded in; its old wire names are the aliases, and both reach the same tool
  assert.equal(mcp.route('forum__thread__search').tool, 'search');
  assert.equal(mcp.route('forum_search').tool, 'search');
});

test('MUTATION: an invalid declaration cannot load', () => {
  const ok = { name: 'x.y.z', version: '1.0.0', division: 'x', title: 't', description: 'long enough description here', input: { type: 'object', properties: {} }, reply: { type: 'object' }, class: 'undoable', cost: { model: 'free' }, idempotency: { strategy: 'natural', note: 'n' }, bind: { category: 'c', tool: 't' }, scope: 'tasks:write' };
  assert.ok(defineCapability(ok));
  for (const bad of [{ name: 'x.y' }, { class: 'maybe' }, { cost: { model: 'cheap' } }, { idempotency: { strategy: 'key', key: 'nope' } }, { preview: {} }, { division: 'q' }, { name: 'x.y__a.z' }, { scope: 'everything:*' }]) {
    assert.throws(() => defineCapability({ ...ok, ...bad }), /Invalid capability/, JSON.stringify(bad));
  }
});

// a db that implements just mcp_idempotency, to prove the replay logic without Postgres
function fakeDb() {
  const rows = new Map();
  return { rows, async query(sql, p) {
    if (sql.startsWith('DELETE FROM mcp_idempotency WHERE connection_id = $1 AND key = $2 AND created_at')) return { rowCount: 0 };
    if (sql.startsWith('INSERT INTO mcp_idempotency')) { const k = p[0] + '|' + p[1]; if (rows.has(k)) return { rowCount: 0, rows: [] }; rows.set(k, { capability: p[2], result: null }); return { rowCount: 1, rows: [{}] }; }
    if (sql.startsWith('SELECT capability, result FROM mcp_idempotency')) return { rows: rows.has(p[0] + '|' + p[1]) ? [rows.get(p[0] + '|' + p[1])] : [] };
    if (sql.startsWith('UPDATE mcp_idempotency')) { rows.get(p[0] + '|' + p[1]).result = JSON.parse(p[2]); return { rowCount: 1 }; }
    if (sql.startsWith('DELETE FROM mcp_idempotency WHERE connection_id = $1 AND key = $2')) { rows.delete(p[0] + '|' + p[1]); return { rowCount: 1 }; }
    throw new Error('unexpected ' + sql);
  } };
}
const fakeTasks = (calls, fail = false) => [{ ...mcp.SERVICES[0], call: async (db, actor, name, args) => { calls.push({ name, args }); if (fail) return { isError: true, content: [], structuredContent: { code: 'nope' } }; return { content: [], structuredContent: { task: { key: 'T-' + calls.length } } }; } }];

test('Idempotency-Key: the first call acts, a repeat replays, a different capability is refused, a failure can retry', async () => {
  const db = fakeDb(), calls = [], conn = { id: 'c1', categories: ['tasks'] };
  const svc = fakeTasks(calls);
  const one = await mcp.callTool(db, { kind: 'agent' }, conn, 'tasks__task__create', { title: 'a' }, { idempotencyKey: 'k' }, svc);
  const two = await mcp.callTool(db, { kind: 'agent' }, conn, 'tasks_create_task', { title: 'a' }, { idempotencyKey: 'k' }, svc);
  assert.equal(calls.length, 1, 'acted once');
  assert.equal(two.result.structuredContent.task.key, one.result.structuredContent.task.key);
  assert.equal(two.result._meta['xeno/replayed'], true);
  const other = await mcp.callTool(db, { kind: 'agent' }, conn, 'tasks__comment__create', { key: 'T-1', body: 'x' }, { idempotencyKey: 'k' }, svc);
  assert.equal(other.result.structuredContent.code, 'idempotency_key_reused');
  const failing = fakeTasks([], true);
  await mcp.callTool(db, { kind: 'agent' }, conn, 'tasks__task__create', {}, { idempotencyKey: 'f' }, failing);
  assert.ok(!db.rows.has('c1|f'), 'a refused call releases its key');
  // a safe capability never touches the store
  await mcp.callTool(db, { kind: 'agent' }, conn, 'tasks__project__list', {}, { idempotencyKey: 's' }, svc);
  assert.ok(!db.rows.has('c1|s'));
});

test('run id fills a declared run_id; the reply says what it charged', async () => {
  const calls = [], conn = { categories: ['tasks'] };
  const r = await mcp.callTool(null, { kind: 'agent' }, conn, 'tasks__task__claim', { key: 'T-1' }, { runId: 'run-7' }, fakeTasks(calls));
  assert.equal(calls[0].args.run_id, 'run-7');
  assert.deepEqual(r.result._meta['xeno/charged'], { credits: 0, settled: true });
  const ask = CATALOGUE.find((c) => c.name === 'chat.model.ask');
  assert.deepEqual(mcp.chargedOf(ask, { structuredContent: { credits: 3 } }), { credits: 3, settled: true });
  assert.equal(mcp.chargedOf(ask, { structuredContent: {} }).credits, null, 'an unreported charge is null, never a guess');
  const gen = CATALOGUE.find((c) => c.name === 'studio.image.generate');
  assert.equal(mcp.chargedOf(gen, { structuredContent: { max_credits: 40 } }).reservedCredits, 40);
});
