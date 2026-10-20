// SES-08 (host half), RUN-09 and NFR-05 over HTTP against real PostgreSQL (TEST_DATABASE_URL): providerSelection's
// acknowledgements, sessionBudgetAdmission and turnReads are REACHABLE through /api/workforce/sessions.
//
// PROVEN: a selection completes only on an ack from a DPoP-bound host session of the selecting person, and a
// command result reads only after its own host ack; a plain session cannot forge either receipt; a stranger's
// selection answers not_found. A personal charge needs BYOK acceptance; a pool charge is a host act and is
// refused from a plain session and through a non-enforceable adapter. Turn pages are bounded, chain by cursor,
// and a stranger's conversation answers not_found.
//
// Mutation-checked 2026-10-20, each fails its named assertion; restored passes:
//   - drop the host requirement on /models/ack          -> "a plain session cannot forge the provider's ack"
//   - drop BYOK acceptance in admitSessionCharge          -> "personal charging needs BYOK acceptance first"
//   - drop the PAGE_CAP clamp in turnReads                -> "a page is clamped to the cap"
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';

const url = process.env.TEST_DATABASE_URL; if (url) requireProofDatabase(url);

test('SES-08 / RUN-09 / NFR-05: the session wiring', { skip: !url, timeout: 180000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 }); t.after(() => pool.end());
  const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
  await runAllMigrations(pool);
  const { createWorkforceSessionRouter } = await import('../src/server/routes/workforceSessionRoutes.js');
  const { PAGE_CAP } = await import('../src/server/services/turnReads.js');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.workforceContext = { actorUserId: req.get('x-actor') };
    req.auth = req.get('x-host') ? { kind: 'oidc', dpopJkt: 'test-jkt' } : { kind: 'legacy' }; next(); });
  app.use(createWorkforceSessionRouter({ env: {} }));
  const server = http.createServer(app); await new Promise((r) => server.listen(0, r)); t.after(() => server.close());
  const call = async (path, body, actor, host = false) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-actor': actor, ...(host ? { 'x-host': '1' } : {}) } });
    return { status: r.status, d: await r.json() };
  };
  const marker = `sw-${randomUUID().slice(0, 8)}`;
  const user = async (s) => (await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id", [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const alice = await user('alice'), mallory = await user('mallory');
  const provider = `prov-${marker}`, model = `${marker}-model`;
  await pool.query('INSERT INTO gateway_model_aliases(public_id,internal_id,provider) VALUES($1,$1,$2)', [model, provider]);
  await pool.query("INSERT INTO provider_native_commands(provider,command,gui_supported) VALUES($1,'compact',true)", [provider]);

  await t.test('SES-08: selection and command complete only on host acks', async () => {
    const sel = (await call('/models/select', { provider, publicId: model }, alice)).d.result;
    const ack = { selectionId: sel.selectionId, provider, publicId: model, nonce: sel.nonce };
    assert.equal((await call('/models/ack', ack, alice)).status, 403, "a plain session cannot forge the provider's ack");
    assert.equal((await call('/models/ack', ack, mallory, true)).status, 404, "a stranger's selection does not exist for them");
    assert.equal((await call('/models/ack', ack, alice, true)).status, 200, 'the host acks the selection');
    const cmd = (await call('/commands/execute', { selectionId: sel.selectionId, command: 'compact', surface: 'gui' }, alice)).d.result;
    assert.equal((await call('/commands/read', { commandId: cmd.commandId }, alice)).status, 409, 'no result before the ack');
    assert.equal((await call('/commands/ack', { commandId: cmd.commandId, nonce: cmd.nonce, receipt: { ok: 1 } }, alice)).status, 403);
    assert.equal((await call('/commands/ack', { commandId: cmd.commandId, nonce: cmd.nonce, receipt: { ok: 1 } }, alice, true)).status, 200);
    assert.deepEqual((await call('/commands/read', { commandId: cmd.commandId }, alice)).d.result.receipt, { ok: 1 });
  });

  await t.test('RUN-09: BYOK for personal, a host and an enforceable adapter for a pool', async () => {
    const personal = { sessionKind: 'tui-direct', target: 'personal', amountMicro: 1000 };
    assert.equal((await call('/charges/admit', personal, alice)).d.reason, 'byok_policy_required', 'personal charging needs BYOK acceptance first');
    assert.equal((await call('/byok/accept', {}, alice)).status, 200);
    assert.equal((await call('/charges/admit', personal, alice)).status, 200, 'after acceptance a personal charge admits');
    const poolCharge = { sessionKind: 'managed', adapterName: 'nope', target: 'project-pool', poolId: randomUUID(), amountMicro: 1000 };
    assert.equal((await call('/charges/admit', poolCharge, alice)).d.reason, 'host_session_required', 'a pool charge is a host act');
    assert.equal((await call('/charges/admit', poolCharge, alice, true)).d.reason, 'pool_charge_requires_enforceable_adapter');
    assert.equal((await call('/charges/admit', { ...poolCharge, sessionKind: 'tui-direct' }, alice, true)).d.reason, 'pool_charge_requires_enforceable_adapter', 'a direct TUI never charges a pool');
    assert.ok(Array.isArray((await call('/adapters/parity', {}, alice)).d.result));
  });

  await t.test('NFR-05: turn pages are bounded and chain by cursor', async () => {
    const conv = (await pool.query("INSERT INTO chat_conversations(owner_user_id,user_id,title) VALUES($1,$1,'T') RETURNING id", [alice])).rows[0].id;
    await pool.query("INSERT INTO conversation_turns(conversation_id,turn_index,content_hash,status) SELECT $1, g, 'h'||g, 'complete' FROM generate_series(0,$2) g", [conv, PAGE_CAP + 20]);
    const first = (await call('/turns/page', { conversationId: conv, limit: 10000 }, alice)).d.result;
    assert.equal(first.turns.length, PAGE_CAP, 'a page is clamped to the cap');
    assert.equal(first.total, PAGE_CAP + 21);
    const next = (await call('/turns/page', { conversationId: conv, cursor: first.nextCursor, limit: 50 }, alice)).d.result;
    assert.equal(next.turns[0].turnIndex, PAGE_CAP); assert.equal(next.nextCursor, null);
    assert.equal((await call('/turns/count', { conversationId: conv }, alice)).d.result.total, PAGE_CAP + 21);
    assert.equal((await call('/turns/page', { conversationId: conv }, mallory)).status, 404, "a stranger's conversation does not exist for them");
    assert.equal((await call('/turns/page', { conversationId: conv, limit: -1 }, alice)).status, 400);
  });
});
