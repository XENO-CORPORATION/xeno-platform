import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

import xenoRoutes from '../routes/xenoRoutes.js';

function createRemoteRunDb() {
  let nextEventId = 1;
  const records = new Map();
  const events = new Map();
  return {
    records,
    events,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('insert into xeno_remote_runs')) {
        records.set(params[0], {
          run_id: params[0],
          user_id: params[1],
          status: params[2],
          prompt: params[3],
          requested_cwd: params[4],
          model: params[5],
          permission_mode: params[6],
          created_at: params[7],
          started_at: params[8],
          ended_at: params[9],
          exit_code: params[10],
          signal: params[11],
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes('insert into xeno_remote_run_events')) {
        const list = events.get(params[0]) || [];
        list.push({ id: nextEventId++, event: JSON.parse(params[2]) });
        events.set(params[0], list);
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes('from xeno_remote_runs') && normalized.includes('where user_id = $1')) {
        const rows = [...records.values()]
          .filter((record) => record.user_id === params[0])
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, Number(params[1]) || 50);
        return { rows };
      }
      if (normalized.includes('from xeno_remote_runs')) {
        const record = records.get(params[0]);
        return { rows: record && record.user_id === params[1] ? [record] : [] };
      }
      if (normalized.includes('from xeno_remote_run_events')) {
        const list = events.get(params[0]) || [];
        const limit = Number(params[1]) || list.length;
        return { rows: list.slice(-limit).reverse().map((entry) => ({ event: entry.event })) };
      }
      throw new Error(`Unexpected SQL in remote status test: ${normalized}`);
    },
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

const remoteDb = createRemoteRunDb();
const app = express();
app.use(express.json());
app.use((_req, _res, next) => {
  _req.user = { id: 'test-user' };
  _req.db = remoteDb;
  next();
});
app.use('/api/xeno', (_req, _res, next) => next(), xenoRoutes);

const server = createServer(app);
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  assert.equal(response.status, 200);
  const payload = await response.json();

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'xeno-platform-remote');
  assert.deepEqual(payload.capabilities, []);
  assert.ok(!payload.capabilities.includes('runs.start'));

  const dir = mkdtempSync(join(tmpdir(), 'xeno-remote-runner-'));
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, "console.log('runner:' + process.env.XENO_REMOTE_PROMPT);\nsetTimeout(() => console.log('runner:done'), 100);\n");

  process.env.XENO_REMOTE_RUNNER_COMMAND = join(dir, 'missing-runner.exe');
  delete process.env.XENO_REMOTE_RUNNER_ARGS_JSON;

  const missingCommandStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const missingCommandPayload = await missingCommandStatus.json();
  assert.equal(missingCommandPayload.ok, false);
  assert.deepEqual(missingCommandPayload.capabilities, []);
  assert.match(missingCommandPayload.error, /command not found/i);

  const missingCommandStart = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'missing command' }),
  });
  assert.equal(missingCommandStart.status, 503);

  process.env.XENO_REMOTE_RUNNER_COMMAND = process.execPath;
  process.env.XENO_REMOTE_RUNNER_ARGS_JSON = JSON.stringify([42]);

  const invalidStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const invalidPayload = await invalidStatus.json();
  assert.equal(invalidPayload.ok, false);
  assert.deepEqual(invalidPayload.capabilities, []);
  assert.match(invalidPayload.error, /XENO_REMOTE_RUNNER_ARGS_JSON/);

  const invalidStart = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'bad config' }),
  });
  assert.equal(invalidStart.status, 503);

  process.env.XENO_REMOTE_RUNNER_ARGS_JSON = JSON.stringify([runner]);

  const enabledStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const enabledPayload = await enabledStatus.json();
  assert.ok(enabledPayload.capabilities.includes('runs.start'));
  assert.ok(enabledPayload.capabilities.includes('runs.list'));

  process.env.XENO_REMOTE_RUNNER_MAX_PROMPT_CHARS = '8';
  const oversizedPrompt = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello remote' }),
  });
  assert.equal(oversizedPrompt.status, 413);
  assert.equal((await oversizedPrompt.json()).maxPromptChars, 8);
  delete process.env.XENO_REMOTE_RUNNER_MAX_PROMPT_CHARS;

  const badCwd = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'ok', cwd: { nested: true } }),
  });
  assert.equal(badCwd.status, 400);
  assert.match((await badCwd.json()).error, /cwd must be a string/);

  const started = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello remote' }),
  });
  assert.equal(started.status, 202);
  const startPayload = await started.json();
  const runId = startPayload.run.runId;
  assert.equal(startPayload.run.status, 'running');

  const followAbort = new AbortController();
  const followTimeout = setTimeout(() => followAbort.abort(), 2000);
  const follow = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/attach?tail=10&follow=true`, {
    signal: followAbort.signal,
  });
  const followText = await follow.text();
  clearTimeout(followTimeout);
  assert.match(followText, /run_finished/);
  await waitFor(
    () => remoteDb.records.get(runId)?.status === 'completed',
    'expected completed remote run to be persisted'
  );
  await waitFor(
    () => (remoteDb.events.get(runId) || []).some((entry) => entry.event.type === 'run_finished'),
    'expected terminal remote event to be persisted'
  );
  assert.equal(remoteDb.records.get(runId)?.prompt, 'hello remote');

  const run = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}`);
  assert.equal((await run.json()).run.runId, runId);

  const runList = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs?limit=5`);
  const runListPayload = await runList.json();
  assert.ok(runListPayload.runs.some((run) => (
    run.runId === runId &&
    run.status === 'completed' &&
    run.promptPreview === 'hello remote'
  )));

  const events = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/events`);
  const eventPayload = await events.json();
  assert.ok(eventPayload.events.some((event) => event.type === 'stdout' && event.text.includes('runner:hello remote')));

  const attach = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/attach?tail=2`);
  const attachPayload = await attach.json();
  assert.equal(attachPayload.run.runId, runId);
  assert.ok(Array.isArray(attachPayload.events));

  const stopped = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/stop`, { method: 'POST' });
  assert.equal((await stopped.json()).run.runId, runId);

  const slowRunner = join(dir, 'slow-runner.mjs');
  writeFileSync(slowRunner, "setTimeout(() => console.log('slow:done'), 1000);\n");
  process.env.XENO_REMOTE_RUNNER_ARGS_JSON = JSON.stringify([slowRunner]);
  process.env.XENO_REMOTE_RUNNER_MAX_CONCURRENT = '1';

  const firstSlow = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'slow one' }),
  });
  assert.equal(firstSlow.status, 202);
  const firstSlowRun = await firstSlow.json();

  const secondSlow = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'slow two' }),
  });
  assert.equal(secondSlow.status, 429);
  await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${firstSlowRun.run.runId}/stop`, { method: 'POST' });

  process.env.XENO_REMOTE_RUNNER_TIMEOUT_MS = '50';
  const timed = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'times out' }),
  });
  assert.equal(timed.status, 202);
  const timedRun = await timed.json();
  const timedFollow = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${timedRun.run.runId}/attach?follow=true`);
  assert.match(await timedFollow.text(), /run_timed_out/);

  console.log('remote-status.test.js passed');
} finally {
  delete process.env.XENO_REMOTE_RUNNER_COMMAND;
  delete process.env.XENO_REMOTE_RUNNER_ARGS_JSON;
  delete process.env.XENO_REMOTE_RUNNER_MAX_CONCURRENT;
  delete process.env.XENO_REMOTE_RUNNER_TIMEOUT_MS;
  delete process.env.XENO_REMOTE_RUNNER_MAX_PROMPT_CHARS;
  await new Promise((resolve) => server.close(resolve));
}
