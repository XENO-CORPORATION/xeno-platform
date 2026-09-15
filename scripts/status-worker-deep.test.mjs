/**
 * XENO Status deep checks — a real chat turn and a real web search (status/worker.mjs).
 *
 * The availability sweep in status-worker.test.mjs finds components that are DOWN. These find
 * the ones that are UP AND WRONG, and every defect of 2026-09-14 was that kind: each answered
 * HTTP 200. The fixtures below are those exact failures, so a regression in the judges would
 * be a regression in catching the week that motivated them.
 *
 * SQL runs for real against node:sqlite with the deployed schema, as in the sibling suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  CHAT_MARKER, DEEP_COMPONENTS, USER_AGENT,
  judgeChat, judgeSearch, loadModel, parseSseFrames, runDeepCheck, runScheduled,
} from '../status/worker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readFileSync(join(ROOT, 'status', 'schema.sql'), 'utf8');

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  const statement = (sql, params = []) => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
    execSync: () => sqlite.prepare(sql).run(...params),
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { for (const s of statements) s.execSync(); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
}

const ENV = {
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_TO: 'ops@example.com',
  ALERT_EMAIL_FROM: 'XENO Status <noreply@example.com>',
  HEALTHCHECKS_PING_URL: 'https://hc-ping.com/00000000-0000-4000-8000-000000000000',
};
const quiet = { error() {} };
const noSleep = async () => {};

const sse = (...frames) => `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`;
const chatOk = () => sse({ type: 'delta', text: CHAT_MARKER }, { type: 'result', text: CHAT_MARKER });
const judgeChatBody = (status, body) => judgeChat({ status, frames: status === 200 ? parseSseFrames(body) : [] });
const judgeSearchBody = (body) => judgeSearch({ status: 200, frames: parseSseFrames(body) });

test('SSE frames are parsed, and junk lines are skipped rather than failing the check', () => {
  const frames = parseSseFrames('event: x\ndata: {"type":"delta","text":"a"}\n\ndata: not json\n\ndata: [DONE]\n');
  assert.deepEqual(frames, [{ type: 'delta', text: 'a' }]);
});

test('🔴 chat: each of this week\'s failure shapes is caught, with an actionable reason', () => {
  assert.equal(judgeChatBody(200, chatOk()).ok, true);

  // 2026-09-14: Opus 5 refused `temperature`. The route answered 200, carrying an error frame.
  const refused = judgeChatBody(200, sse({ type: 'error', error: 'inference_error', message: 'The inference stream failed.' }));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /inference stream failed/);

  // 2026-09-14: a turn completed with NO answer at all.
  const empty = judgeChatBody(200, sse({ type: 'delta', text: '' }, { type: 'result', text: '' }));
  assert.equal(empty.ok, false);
  assert.match(empty.error, /EMPTY answer/);

  assert.match(judgeChatBody(200, sse({ type: 'result', text: 'Hello there' })).error, /expected text/);
  assert.match(judgeChatBody(200, sse({ type: 'delta', text: CHAT_MARKER })).error, /without a result/,
    'a stream that stops before its result frame is a broken turn, even if the words arrived');
  assert.match(judgeChatBody(402, '').error, /out of credits/,
    'an empty probe wallet must say so plainly — it is not a product outage');
  assert.match(judgeChatBody(401, '').error, /probe key was rejected/);
});

test('🔴 search: a search that returns nothing is caught, and the refusal code is named', () => {
  const good = sse(
    { type: 'search_start', query: 'current year' },
    { type: 'search_result', query: 'current year', count: 6 },
    { type: 'result', text: '2026' },
  );
  assert.equal(judgeSearchBody(good).ok, true);

  // 2026-09-14: EVERY search was refused on a licensing error, and the turn still answered 200.
  const refused = judgeSearchBody(sse(
    { type: 'search_start', query: 'q' },
    { type: 'search_error', query: 'q', code: 'web_context_storage_not_approved' },
    { type: 'result', text: 'My searches errored out.' },
  ));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /web_context_storage_not_approved/);

  assert.match(judgeSearchBody(sse({ type: 'result', text: '2026' })).error, /never searched/,
    'an answer from memory is no proof that search works');
  assert.match(judgeSearchBody(sse(
    { type: 'search_start', query: 'q' }, { type: 'search_result', query: 'q', count: 6 }, { type: 'result', text: '' },
  )).error, /EMPTY answer/);
});

test('a deep check retries once in-run, but never retries an account problem', async () => {
  const env = { PROBE_API_KEY: 'xk_test', PROBE_MODEL: 'claude-opus-5' };
  let calls = 0;
  const sleeps = [];
  const failOnce = async () => {
    calls += 1;
    return new Response(calls === 1 ? sse({ type: 'error', message: 'blip' }) : chatOk(), { status: 200 });
  };
  const recovered = await runDeepCheck(DEEP_COMPONENTS[0], env, failOnce, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(recovered.ok, true, 'one transient failure recovered inside the run is not an outage');
  assert.equal(calls, 2);
  assert.equal(sleeps.length, 1);

  calls = 0;
  const broke = async () => { calls += 1; return new Response('', { status: 402 }); };
  const out = await runDeepCheck(DEEP_COMPONENTS[0], env, broke, { sleep: noSleep });
  assert.equal(out.ok, false);
  assert.equal(calls, 1, 'an empty wallet will not refill in 20 seconds — do not spend a second turn');
});

test('the deep turn uses the probe key, the configured model, and an honest identity', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(chatOk(), { status: 200 });
  };
  await runDeepCheck(DEEP_COMPONENTS[0], { PROBE_API_KEY: 'xk_probe', PROBE_MODEL: 'claude-opus-5' }, fetchImpl, { sleep: noSleep });
  assert.equal(seen.url, 'https://xenostudio.ai/api/ai/chat/stream', "the same route a user's browser drives");
  assert.equal(seen.init.headers.authorization, 'Bearer xk_probe');
  assert.equal(seen.body.model, 'claude-opus-5', "this week's worst bug was specific to the model users actually use");
  assert.equal(seen.init.headers['user-agent'], USER_AGENT);
});

test('🔴 without a probe key the deep pass does NOTHING — no requests, no failures recorded', async () => {
  const db = d1();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('OK'); };
  const r = await runScheduled({ db, env: ENV, fetchImpl, mode: 'deep', log: quiet });
  assert.match(r.skipped, /no probe key/);
  assert.equal(calls, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM checks').get().n, 0,
    'a check nobody switched on must not be recorded as failing');
});

test('🔴 a broken chat opens an incident in ONE run and alerts; deep components appear only once measured', async () => {
  const db = d1();
  const emails = [];
  const env = { ...ENV, PROBE_API_KEY: 'xk_probe' };

  const before = await loadModel(db);
  assert.ok(!before.components.some((c) => c.id === 'chat'),
    'an unmeasured deep check is absent from the page, never drawn green');

  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') { emails.push(JSON.parse(init.body)); return new Response('{}'); }
    if (u.startsWith(ENV.HEALTHCHECKS_PING_URL)) return new Response('OK');
    const prompt = JSON.parse(init.body).messages[0].content;
    if (/four-digit year/.test(prompt)) {
      return new Response(sse(
        { type: 'search_start', query: 'y' }, { type: 'search_result', query: 'y', count: 6 }, { type: 'result', text: '2026' },
      ), { status: 200 });
    }
    return new Response(sse({ type: 'error', message: 'The inference stream failed.' }), { status: 200 });
  };
  await runScheduled({ db, env, fetchImpl, mode: 'deep', log: quiet, sleep: noSleep });

  const incidents = db.sqlite.prepare('SELECT component, summary FROM incidents').all();
  assert.equal(incidents.length, 1, 'one failed run opens the incident — the in-run retry is the flap protection');
  assert.equal(incidents[0].component, 'chat');
  assert.match(incidents[0].summary, /inference stream failed/);
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /Chat is DOWN/);

  const after = await loadModel(db);
  assert.equal(after.components.find((c) => c.id === 'chat').status, 'down');
  assert.equal(after.components.find((c) => c.id === 'web-search').status, 'operational');
});
