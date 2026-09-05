import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runMigrations, LEGACY_SCHEMA_FILES } from '../src/server/services/migrationService.js';
import { runRequiredStartupMigrations } from '../src/server/services/startupSchema.js';

function mockSchemas(t, read) {
  t.mock.method(fs, 'readFileSync', read);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
}

test('required legacy manifest is immutable and startup executes every schema in order', async t => {
  assert.ok(Object.isFrozen(LEGACY_SCHEMA_FILES));
  const reads = [], queries = [];
  mockSchemas(t, file => { reads.push(path.basename(file)); return `SELECT '${path.basename(file)}';`; });
  await runMigrations({ query: async sql => {
    assert.deepEqual(reads, [...LEGACY_SCHEMA_FILES], 'all inputs must be checked before any SQL');
    queries.push(sql);
  } });
  assert.deepEqual(queries, LEGACY_SCHEMA_FILES.map(file => `SELECT '${file}';`));
});

for (const file of LEGACY_SCHEMA_FILES) {
  for (const failure of ['ENOENT', 'EACCES', 'empty']) {
    test(`${file}: ${failure} prevents every SQL query and identifies the input`, async t => {
      const cause = Object.assign(new Error('fixture file failure'), { code: failure });
      mockSchemas(t, target => {
        if (path.basename(target) !== file) return 'SELECT 1;';
        if (failure === 'empty') return ' \r\n\t';
        throw cause;
      });
      let queries = 0;
      await assert.rejects(runMigrations({ query: async () => { queries++; } }), error => {
        assert.ok(error.message.includes(file));
        if (failure !== 'empty') assert.equal(error.cause, cause);
        return true;
      });
      assert.equal(queries, 0);
    });
  }
  for (const code of ['42P07', '42710', '42701', '42P06', '42723', '42P04', '42P16', '08006']) {
    test(`${file}: SQL ${code} propagates unchanged and stops the sequence`, async t => {
      mockSchemas(t, target => path.basename(target));
      const error = Object.assign(new Error('fixture SQL failure'), { code });
      const queries = [];
      await assert.rejects(runMigrations({ query: async sql => {
        queries.push(sql);
        if (sql === file) throw error;
      } }), value => value === error);
      assert.deepEqual(queries, LEGACY_SCHEMA_FILES.slice(0, LEGACY_SCHEMA_FILES.indexOf(file) + 1));
      assert.ok(!console.log.mock.calls.some(call => String(call.arguments[0]).includes('migrations complete')));
    });
  }
}

const phases = ['runMigrations', 'runAllMigrations', 'migrateAccountV2', 'migrateOidcClients', 'migrationStatus'];
const resultFor = phase => phase === 'runAllMigrations' ? { total: 2, applied: 2, skipped: [] }
  : phase === 'migrationStatus' ? [{ status: 'applied' }, { status: 'applied' }] : undefined;

for (const phase of phases) {
  for (const reject of [false, true]) {
    test(`${phase}: ${reject ? 'failure refuses' : 'pending delays'} later phases and service startup`, async () => {
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const calls = [], pool = {};
      const error = new Error(`fixture ${phase}`);
      const steps = Object.fromEntries(phases.map(name => [name, async actualPool => {
        assert.equal(actualPool, pool);
        calls.push(name);
        if (name === phase) { await pending; if (reject) throw error; }
        return resultFor(name);
      }]));
      let started = false;
      const boot = (async () => { await runRequiredStartupMigrations(pool, steps); started = true; })();
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, phases.slice(0, phases.indexOf(phase) + 1));
      assert.equal(started, false);
      release();
      if (reject) {
        await assert.rejects(boot, value => value === error);
        assert.equal(started, false);
        assert.equal(calls.at(-1), phase);
      } else {
        await boot;
        assert.deepEqual(calls, phases);
        assert.equal(started, true);
      }
    });
  }
}

test('deferred migrations and missing manifests fail before account migrations', async () => {
  for (const result of [undefined, { total: 0 }, { total: 2, skipped: [{ version: '123' }] }]) {
    const calls = [];
    const steps = Object.fromEntries(phases.map(name => [name, async () => {
      calls.push(name);
      return name === 'runAllMigrations' ? result : resultFor(name);
    }]));
    await assert.rejects(runRequiredStartupMigrations({}, steps));
    assert.deepEqual(calls, phases.slice(0, 2));
  }
});

test('final pending or empty migration status refuses startup', async () => {
  for (const status of [[], [{ status: 'pending' }]]) {
    const steps = Object.fromEntries(phases.map(name => [name, async () => name === 'migrationStatus' ? status : resultFor(name)]));
    await assert.rejects(runRequiredStartupMigrations({}, steps), /status is incomplete/);
  }
});

test('actual entrypoint awaits fail-closed schema startup before listeners, workers and readiness', () => {
  const source = fs.readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const gate = ast.statements.find(node => ts.isTryStatement(node) && node.tryBlock.statements.some(statement =>
    ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) &&
    statement.expression.expression.getText(ast) === 'runStartupMigrations()'));
  assert.ok(gate, 'startup must be a top-level awaited boundary');
  assert.match(gate.catchClause.getText(ast), /process\.exit\(1\)/);
  const startup = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runStartupMigrations');
  assert.match(startup.body.statements[0].getText(ast), /^await runRequiredStartupMigrations\(pool\)/);
  const starters = new Set(['initCleanupService', 'startDownloadCleanup', 'initBackgroundJobs', 'startNotificationEmailSweep', 'startWebhookPushSweep',
    'startScheduledTasksWorker', 'startLibraryIngestionWorker', 'server.listen', 'setInterval']);
  const seen = new Set();
  function walk(node) {
    if (ts.isCallExpression(node) && starters.has(node.expression.getText(ast))) {
      seen.add(node.expression.getText(ast));
      assert.ok(node.pos >= gate.end, `${node.expression.getText(ast)} starts before schema gate`);
    }
    if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'app.locals.migrationsReady' && node.right.kind === ts.SyntaxKind.TrueKeyword) {
      seen.add('ready'); assert.ok(node.pos >= gate.end, 'readiness opens before schema gate');
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.deepEqual([...seen].sort(), [...starters, 'ready'].sort());
  const qualifier = fs.readFileSync(new URL('./qualify-platform-local.mjs', import.meta.url), 'utf8');
  assert.match(qualifier, /await runRequiredStartupMigrations\(pool\)/);
});

test('download service import starts no cleanup timer; explicit start/stop is idempotent', async t => {
  // Prevent module directory creation and never execute the destructive callback.
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'mkdirSync', () => { throw new Error('Unexpected directory creation'); });
  const timer = { unref() {} }, callbacks = [], cleared = [];
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { callbacks.push({ callback, delay }); return timer; });
  t.mock.method(globalThis, 'clearInterval', value => { cleared.push(value); });
  const service = await import('../src/server/services/downloadService.js');
  assert.equal(callbacks.length, 0);
  t.after(() => service.stopDownloadCleanup());
  service.startDownloadCleanup(); service.startDownloadCleanup();
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].delay, 15 * 60 * 1000);
  service.stopDownloadCleanup(); service.stopDownloadCleanup();
  assert.deepEqual(cleared, [timer]);
  service.startDownloadCleanup();
  assert.equal(callbacks.length, 2);
});
