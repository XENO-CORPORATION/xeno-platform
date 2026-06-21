import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
          workspace: params[2],
          status: params[3],
          prompt: params[4],
          requested_cwd: params[5],
          model: params[6],
          permission_mode: params[7],
          created_at: params[8],
          started_at: params[9],
          ended_at: params[10],
          exit_code: params[11],
          signal: params[12],
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
          .filter((record) => record.user_id === params[0] && (!params[2] || record.workspace === params[2]))
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .slice(0, Number(params[1]) || 50);
        return { rows };
      }
      if (normalized.includes('from xeno_remote_runs')) {
        const record = records.get(params[0]);
        return { rows: record && record.user_id === params[1] && (!params[2] || record.workspace === params[2]) ? [record] : [] };
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

const unauthApp = express();
unauthApp.use(express.json());
unauthApp.use('/api/xeno', xenoRoutes);

const unauthServer = createServer(unauthApp);
unauthServer.listen(0, '127.0.0.1');
await once(unauthServer, 'listening');

const server = createServer(app);
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const { port: unauthPort } = unauthServer.address();
  const unauthResponse = await fetch(`http://127.0.0.1:${unauthPort}/api/xeno/remote/status`);
  assert.equal(unauthResponse.status, 401);
  assert.equal((await unauthResponse.json()).error, 'Not authenticated');

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'xeno-platform-remote');
  assert.deepEqual(payload.capabilities, []);
  assert.ok(!payload.capabilities.includes('runs.start'));
  assert.deepEqual(payload.deployment, {
    configured: false,
    ready: false,
    storage: 'durable',
    rolloutState: 'disabled',
  });
  assert.equal(payload.capacity.activeRuns, 0);
  assert.equal(payload.capacity.maxConcurrent, 1);
  assert.equal(payload.capacity.availableSlots, 1);
  assert.equal(payload.capacity.autoscale.enabled, false);

  const dir = mkdtempSync(join(tmpdir(), 'xeno-remote-runner-'));
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, [
    "console.log('runner:' + process.env.XENO_REMOTE_PROMPT);",
    "console.log('secret:' + (process.env.XENO_REMOTE_SECRET_SHOULD_NOT_LEAK || ''));",
    "setTimeout(() => console.log('runner:done'), 100);",
    '',
  ].join('\n'));
  process.env.XENO_REMOTE_SECRET_SHOULD_NOT_LEAK = 'leaked-secret';

  const commandDir = join(dir, 'command-dir');
  mkdirSync(commandDir);
  process.env.XENO_REMOTE_RUNNER_COMMAND = commandDir;
  delete process.env.XENO_REMOTE_RUNNER_ARGS_JSON;

  const directoryCommandStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const directoryCommandPayload = await directoryCommandStatus.json();
  assert.equal(directoryCommandPayload.ok, false);
  assert.deepEqual(directoryCommandPayload.capabilities, []);
  assert.match(directoryCommandPayload.error, /command not found/i);

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
  process.env.XENO_REMOTE_RUNNER_CWD = join(dir, 'missing-cwd');

  const missingCwdStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const missingCwdPayload = await missingCwdStatus.json();
  assert.equal(missingCwdPayload.ok, false);
  assert.deepEqual(missingCwdPayload.capabilities, []);
  assert.match(missingCwdPayload.error, /cwd not found/i);

  const missingCwdStart = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'missing cwd' }),
  });
  assert.equal(missingCwdStart.status, 503);

  delete process.env.XENO_REMOTE_RUNNER_CWD;

  const enabledStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const enabledPayload = await enabledStatus.json();
  assert.ok(enabledPayload.capabilities.includes('runs.start'));
  assert.ok(enabledPayload.capabilities.includes('runs.list'));
  assert.equal(enabledPayload.deployment.ready, true);
  assert.equal(enabledPayload.deployment.rolloutState, 'ready');

  process.env.XENO_REMOTE_RUNNER_AUTOSCALE = 'true';
  process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MIN = '2';
  process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MAX = '2';
  const autoscaleStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const autoscalePayload = await autoscaleStatus.json();
  assert.equal(autoscalePayload.capacity.maxConcurrent, 2);
  assert.equal(autoscalePayload.capacity.availableSlots, 2);
  assert.equal(autoscalePayload.capacity.autoscale.enabled, true);
  assert.equal(autoscalePayload.capacity.autoscale.mode, 'local-cpu');
  assert.equal(autoscalePayload.capacity.autoscale.targetConcurrent, 2);
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE;
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MIN;
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MAX;

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
    headers: { 'content-type': 'application/json', 'x-xeno-workspace': 'workspace-a' },
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
  assert.equal(remoteDb.records.get(runId)?.workspace, 'workspace-a');

  const run = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}`);
  assert.equal((await run.json()).run.runId, runId);

  const wrongWorkspaceRun = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}`, {
    headers: { 'x-xeno-workspace': 'workspace-b' },
  });
  assert.equal(wrongWorkspaceRun.status, 404);

  const runList = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs?limit=5`);
  const runListPayload = await runList.json();
  assert.ok(runListPayload.runs.some((run) => (
    run.runId === runId &&
    run.status === 'completed' &&
    run.promptPreview === 'hello remote'
  )));

  const scopedRunList = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs?limit=5`, {
    headers: { 'x-xeno-workspace': 'workspace-a' },
  });
  assert.ok((await scopedRunList.json()).runs.some((run) => run.runId === runId && run.workspace === 'workspace-a'));

  const emptyScopedRunList = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs?limit=5`, {
    headers: { 'x-xeno-workspace': 'workspace-b' },
  });
  assert.ok(!(await emptyScopedRunList.json()).runs.some((run) => run.runId === runId));

  const staleRunId = 'remote_stale_after_restart';
  remoteDb.records.set(staleRunId, {
    run_id: staleRunId,
    user_id: 'test-user',
    status: 'running',
    prompt: 'stale run',
    requested_cwd: null,
    model: null,
    permission_mode: null,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    signal: null,
  });
  const staleRun = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${staleRunId}`);
  assert.equal((await staleRun.json()).run.status, 'failed');
  assert.equal(remoteDb.records.get(staleRunId)?.status, 'failed');
  assert.equal(remoteDb.records.get(staleRunId)?.signal, 'server_restart');
  assert.ok((remoteDb.events.get(staleRunId) || []).some((entry) => entry.event.type === 'run_recovered_failed'));

  const events = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/events`);
  const eventPayload = await events.json();
  assert.ok(eventPayload.events.some((event) => event.type === 'stdout' && event.text.includes('runner:hello remote')));
  assert.ok(!eventPayload.events.some((event) => String(event.text || '').includes('leaked-secret')));

  const attach = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/attach?tail=2`);
  const attachPayload = await attach.json();
  assert.equal(attachPayload.run.runId, runId);
  assert.ok(Array.isArray(attachPayload.events));

  const stopped = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/stop`, { method: 'POST' });
  assert.equal((await stopped.json()).run.runId, runId);

  const noisyRunner = join(dir, 'noisy-runner.mjs');
  writeFileSync(noisyRunner, "console.log('abcdefghijklmnopqrst');\n");
  process.env.XENO_REMOTE_RUNNER_ARGS_JSON = JSON.stringify([noisyRunner]);
  process.env.XENO_REMOTE_RUNNER_MAX_EVENT_TEXT_CHARS = '8';
  const noisy = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'noisy' }),
  });
  assert.equal(noisy.status, 202);
  const noisyRun = await noisy.json();
  const noisyFollow = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${noisyRun.run.runId}/attach?follow=true`);
  assert.match(await noisyFollow.text(), /run_finished/);
  const noisyEvents = remoteDb.events.get(noisyRun.run.runId) || [];
  const noisyOutput = noisyEvents.map((entry) => entry.event).find((event) => event.type === 'stdout');
  assert.equal(noisyOutput.text, 'abcde...');
  assert.equal(noisyOutput.textTruncated, true);
  assert.ok(noisyOutput.textOriginalLength > 8);
  delete process.env.XENO_REMOTE_RUNNER_MAX_EVENT_TEXT_CHARS;

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
  assert.equal(secondSlow.headers.get('retry-after'), '15');
  assert.equal((await secondSlow.json()).capacity.availableSlots, 0);
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
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE;
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MIN;
  delete process.env.XENO_REMOTE_RUNNER_AUTOSCALE_MAX;
  delete process.env.XENO_REMOTE_RUNNER_MAX_PROMPT_CHARS;
  delete process.env.XENO_REMOTE_RUNNER_MAX_EVENT_TEXT_CHARS;
  delete process.env.XENO_REMOTE_RUNNER_CWD;
  delete process.env.XENO_REMOTE_RUNNER_ENV_ALLOWLIST;
  delete process.env.XENO_REMOTE_SECRET_SHOULD_NOT_LEAK;
  await new Promise((resolve) => unauthServer.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
