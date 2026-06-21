import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

import xenoRoutes from '../routes/xenoRoutes.js';

const app = express();
app.use(express.json());
app.use((_req, _res, next) => {
  _req.user = { id: 'test-user' };
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
  writeFileSync(runner, "console.log('runner:' + process.env.XENO_REMOTE_PROMPT);\n");
  process.env.XENO_REMOTE_RUNNER_COMMAND = process.execPath;
  process.env.XENO_REMOTE_RUNNER_ARGS_JSON = JSON.stringify([runner]);

  const enabledStatus = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/status`);
  const enabledPayload = await enabledStatus.json();
  assert.ok(enabledPayload.capabilities.includes('runs.start'));

  const started = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'hello remote' }),
  });
  assert.equal(started.status, 202);
  const startPayload = await started.json();
  const runId = startPayload.run.runId;
  assert.equal(startPayload.run.status, 'running');

  await new Promise((resolve) => setTimeout(resolve, 250));

  const run = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}`);
  assert.equal((await run.json()).run.runId, runId);

  const events = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/events`);
  const eventPayload = await events.json();
  assert.ok(eventPayload.events.some((event) => event.type === 'stdout' && event.text.includes('runner:hello remote')));

  const attach = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/attach?tail=2`);
  const attachPayload = await attach.json();
  assert.equal(attachPayload.run.runId, runId);
  assert.ok(Array.isArray(attachPayload.events));

  const stopped = await fetch(`http://127.0.0.1:${port}/api/xeno/remote/runs/${runId}/stop`, { method: 'POST' });
  assert.equal((await stopped.json()).run.runId, runId);

  console.log('remote-status.test.js passed');
} finally {
  delete process.env.XENO_REMOTE_RUNNER_COMMAND;
  delete process.env.XENO_REMOTE_RUNNER_ARGS_JSON;
  await new Promise((resolve) => server.close(resolve));
}
