import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isLocalPreview, matchesPreviewReadiness, hasOnlyLoopbackListeners } from '../src/server/services/runtimePolicy.js';

test('generic or stale API readiness can never qualify the preview instance', () => {
  assert.equal(matchesPreviewReadiness({ status: 'ready' }, 'owned'), false);
  const body = { status: 'ready', preview: { instance: 'owned', backgroundWork: false } };
  assert.equal(matchesPreviewReadiness(body, 'owned'), true);
  assert.equal(matchesPreviewReadiness(body, 'other'), false);
  assert.equal(matchesPreviewReadiness(body, undefined), false);
  assert.equal(matchesPreviewReadiness({ ...body, status: 'not_ready' }, 'owned'), false);
  assert.equal(matchesPreviewReadiness({ ...body, preview: { instance: 'owned', backgroundWork: true } }, 'owned'), false);
});

test('adopted listeners must all be loopback, not wildcard or LAN', () => {
  assert.equal(hasOnlyLoopbackListeners(['127.0.0.1', '::1']), true);
  for (const addresses of [undefined, [], ['0.0.0.0'], ['::'], ['192.168.1.2'], ['::1', '0.0.0.0']]) {
    assert.equal(hasOnlyLoopbackListeners(addresses), false);
  }
});

test('preview policy is explicit, development-only and loopback-only', () => {
  assert.equal(isLocalPreview({ NODE_ENV: 'production' }), false);
  const safe = { XENO_LOCAL_PREVIEW: 'true', NODE_ENV: 'development', DB_HOST: '127.0.0.1', BACKEND_HOST: '127.0.0.1' };
  assert.equal(isLocalPreview(safe), true);
  for (const [key, value] of [['NODE_ENV', 'production'], ['DB_HOST', 'remote'], ['BACKEND_HOST', '0.0.0.0']]) {
    assert.throws(() => isLocalPreview({ ...safe, [key]: value }), /loopback/);
  }
});

test('every API background starter is inside the non-preview gate', () => {
  const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const gate = ast.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === '!isLocalPreview()' && ts.isBlock(node.thenStatement));
  assert.ok(gate);
  const starters = new Set(['initCleanupService', 'startDownloadCleanup', 'startConversionWorker', 'initBackgroundJobs',
    'startNotificationEmailSweep', 'startWebhookPushSweep', 'startScheduledTasksWorker', 'startLibraryIngestionWorker', 'setInterval']);
  const seen = new Set();
  function walk(node) {
    if (ts.isCallExpression(node) && starters.has(node.expression.getText(ast))) {
      seen.add(node.expression.getText(ast));
      assert.ok(node.pos >= gate.thenStatement.pos && node.end <= gate.thenStatement.end);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.deepEqual([...seen].sort(), [...starters].sort());
  assert.match(source, /if \(!isLocalPreview\(\)\) dotenv\.config/);
});

test('conversion import never starts a consumer before the migration boundary', () => {
  const source = readFileSync(new URL('../src/server/services/conversionWorker.js', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('conversionWorker.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const start = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'startConversionWorker');
  assert.ok(start);
  let consumers = 0;
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'conversionQueue.process') {
      consumers++;
      assert.ok(node.pos > start.pos && node.end < start.end);
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.equal(consumers, 1);
  assert.match(start.getText(ast), /if \(workerStarted\) return/);
});
