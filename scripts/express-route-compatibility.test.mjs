import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const backendRequire = createRequire(new URL('../src/server/package.json', import.meta.url));
const express = backendRequire('express');
const { parse } = createRequire(backendRequire.resolve('router'))('path-to-regexp');
const root = new URL('../', import.meta.url);
const files = ['src/server/index.js', ...readdirSync(new URL('src/server/routes/', root))
  .filter(file => /\.[cm]?js$/.test(file)).map(file => 'src/server/routes/' + file)];
const routes = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        /^(app|router)$/i.test(node.expression.expression.getText(source)) &&
        /^(get|post|put|patch|delete|use|options|all|head|route)$/.test(node.expression.name.text)) {
      const arg = node.arguments[0];
      if (node.expression.name.text !== 'get' || node.arguments.length > 1) {
        const values = arg && ts.isArrayLiteralExpression(arg) ? arg.elements : [arg];
        for (const value of values) {
          if (value && ts.isStringLiteralLike(value)) routes.push({ file, method: node.expression.name.text, pattern: value.text });
          else if (value && ts.isRegularExpressionLiteral(value)) {
            routes.push({ file, method: node.expression.name.text, pattern: new Function('return ' + value.getText(source))() });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

test('all statically declared app/router path strings use the installed Express grammar', () => {
  assert.ok(routes.length > 500, 'route inventory unexpectedly shrank');
  for (const { file, pattern } of routes) if (typeof pattern === 'string') {
    assert.doesNotThrow(() => parse(pattern), file + ': ' + pattern);
  }
});

test('migrated route patterns preserve captures, optional versions and target restrictions', async () => {
  const app = express();
  const select = (file, predicate) => {
    const found = routes.filter(route => route.file.endsWith(file) && predicate(String(route.pattern)));
    assert.equal(found.length, 1, file);
    return found[0];
  };
  for (const [prefix, route] of [
    ['/browser', select('browserRoutes.js', p => p === String(/^\/(.*)$/))],
    ['/forum', select('forumRoutes.js', p => p.includes('targetType') && p.includes('vote'))],
    ['/forum', select('forumRoutes.js', p => p.includes('targetType') && p.includes('flag'))],
    ['/products', select('productDownloadRoutes.js', p => p.includes(':slug/download/:os'))],
  ]) {
    const router = express.Router();
    router[route.method](route.pattern, (req, res) => res.json(req.params));
    app.use(prefix, router);
  }
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const [method, path, expected] of [
      ['GET','/browser/', {0:''}], ['GET','/browser/a/b.js', {0:'a/b.js'}],
      ['POST','/forum/threads/abc/vote', {targetType:'threads',id:'abc'}],
      ['POST','/forum/posts/def/flag/', {targetType:'posts',id:'def'}],
      ['GET','/products/pixel/download/win', {slug:'pixel',os:'win'}],
      ['GET','/products/pixel/download/win/1.2.3', {slug:'pixel',os:'win',version:'1.2.3'}],
    ]) {
      const response = await fetch(base + path, {method,signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200,path);
      assert.deepEqual(await response.json(),expected,path);
    }
    for (const path of ['/forum/users/abc/vote','/forum/threads/abc/extra/vote']) {
      const response = await fetch(base + path,{method:'POST',signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,404,path); await response.arrayBuffer();
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
