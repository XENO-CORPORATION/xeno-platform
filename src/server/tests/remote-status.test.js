import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';

import express from 'express';

import xenoRoutes from '../routes/xenoRoutes.js';

const app = express();
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

  console.log('remote-status.test.js passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
