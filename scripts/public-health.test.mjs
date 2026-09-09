import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { get } from 'node:http';
import express from 'express';

register('./fixtures/public-health-loader.mjs', import.meta.url);
const sentinel = 'PRIVATE_HEALTH_SENTINEL';
let sequence = 0;

async function probe(overrides = {}, path = '/health', migrationsReady = true, repeat = 1) {
  const fixture = {
    ping: async () => 'PONG', readdir: async () => [],
    stat: async () => ({ mtimeMs: Date.now() }),
    configured: true, decrypt: () => 'synthetic-token', edge: async () => ({ status: 404 }),
    query: async sql => sql === 'SELECT 1' ? { rows: [{}] } : { rows: [] },
    ...overrides,
  };
  const originalFetch = globalThis.fetch;
  const originalDir = process.env.BACKUP_DIR;
  globalThis.__publicHealthFixture = fixture;
  process.env.BACKUP_DIR = `/private/${sentinel}`;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://health-fixture.invalid/');
    assert.equal(options.method, 'HEAD');
    return fixture.edge();
  };
  let server;
  try {
    const { default: router } = await import(`../src/server/routes/healthRoutes.js?test=${++sequence}`);
    const app = express();
    app.locals.migrationsReady = migrationsReady;
    app.use((req, _res, next) => { req.db = { query: fixture.query }; next(); });
    app.use(router);
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.on('error', reject);
    });
    const requestOnce = () => new Promise((resolve, reject) => {
      const request = get({ hostname: '127.0.0.1', port: server.address().port, path, agent: false }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(body), raw: body }); }
          catch (error) { reject(error); }
        });
      });
      request.setTimeout(3000, () => request.destroy(new Error('Fixture HTTP timeout')));
      request.on('error', reject);
    });
    const results = [];
    for (let i = 0; i < repeat; i++) results.push(await requestOnce());
    return repeat === 1 ? results[0] : results;
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    if (originalDir === undefined) delete process.env.BACKUP_DIR;
    else process.env.BACKUP_DIR = originalDir;
    delete globalThis.__publicHealthFixture;
  }
}

test('missing backup exposes only the fixed diagnostic, never its directory', async () => {
  const result = await probe();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.checks.backup, { status: 'error', error: 'no dump found' });
  assert.ok(!result.raw.includes(sentinel));
});

const failures = [new Error(sentinel), sentinel, { code: sentinel }, null];
for (const [index, failure] of failures.entries()) {
  for (const stage of ['readdir', 'stat', 'secretbox']) {
    test(`${stage} exception shape ${index} is redacted without hiding the alarm`, async () => {
      const throws = async () => { throw failure; };
      const options = stage === 'secretbox'
        ? { query: async sql => sql === 'SELECT 1' ? { rows: [{}] } : throws() }
        : { readdir: async () => ['fixture.dump'], [stage]: throws };
      const result = await probe(options);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.checks[stage === 'secretbox' ? 'secretbox' : 'backup'], {
        status: 'unknown', error: stage === 'secretbox' ? 'secretbox_unavailable' : 'backup_unavailable',
      });
      assert.ok(!result.raw.includes(sentinel));
    });
  }
}

test('backup and secretbox alarm semantics remain intact', async () => {
  for (const age of [1, 36, 38]) {
    const result = await probe({ readdir: async () => ['fixture.dump'], stat: async () => ({ mtimeMs: Date.now() - age * 3600000 }) });
    assert.equal(result.status, 200);
    assert.equal(result.body.checks.backup.status, age > 36 ? 'stale' : 'ok');
    assert.equal(result.body.checks.backup.count, 1);
  }
  assert.equal((await probe({ configured: false })).body.checks.secretbox.status, 'missing');
  assert.equal((await probe()).body.checks.secretbox.status, 'no-data');
  const query = async sql => ({ rows: sql === 'SELECT 1' ? [{}] : [{ access_token: sentinel }] });
  assert.deepEqual((await probe({ query })).body.checks.secretbox, { status: 'ok', sampled: 1 });
  const mismatch = await probe({ query, decrypt: () => { throw new Error(sentinel); } });
  assert.deepEqual(mismatch.body.checks.secretbox, { status: 'mismatch', sampled: 1, opened: 0 });
  assert.ok(!mismatch.raw.includes(sentinel));
});

test('critical dependency failures still reject health and readiness without raw errors', async () => {
  for (const path of ['/health', '/ready']) {
    for (const dependency of ['query', 'ping']) {
      const result = await probe({ [dependency]: async () => { throw new Error(sentinel); } }, path);
      assert.equal(result.status, 503);
      assert.equal(result.body.checks[dependency === 'query' ? 'database' : 'redis'].status, 'down');
      assert.ok(!result.raw.includes(sentinel));
    }
  }
  assert.equal((await probe({}, '/ready', false)).status, 503);
  assert.equal((await probe({}, '/ready')).status, 200);
});

test('R2 root 404 means reachable while 5xx and network failures remain degraded', async () => {
  for (const status of [200, 404, 500, 503]) {
    const result = await probe({ edge: async () => ({ status }) });
    assert.equal(result.status, status >= 500 ? 503 : 200);
    assert.equal(result.body.checks.r2_cdn.statusCode, status);
    assert.equal(result.body.checks.r2_cdn.status, status >= 500 ? 'degraded' : 'ok');
  }
  const result = await probe({ edge: async () => { throw new Error(sentinel); } });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body.checks.r2_cdn, { status: 'degraded', error: 'unreachable' });
  assert.ok(!result.raw.includes(sentinel));
});

test('repeated health requests retain the secretbox cache without skipping dependency checks', async () => {
  let samples = 0, pings = 0, dbChecks = 0, decryptions = 0;
  const results = await probe({
    query: async sql => {
      if (sql === 'SELECT 1') { dbChecks++; return { rows: [{}] }; }
      samples++; return { rows: [{ access_token: 'synthetic-sealed-token' }] };
    },
    decrypt: () => { decryptions++; return 'synthetic-open-token'; },
    ping: async () => { pings++; return 'PONG'; },
  }, '/health', true, 2);
  assert.equal(samples, 1);
  assert.equal(decryptions, 1);
  assert.equal(dbChecks, 2);
  assert.equal(pings, 2);
  assert.deepEqual(results[0].body.checks.secretbox, results[1].body.checks.secretbox);
});
