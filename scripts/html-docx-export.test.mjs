import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import express from 'express';
import ts from 'typescript';

const backendRequire = createRequire(new URL('../src/server/package.json', import.meta.url));
const JSZip = createRequire(backendRequire.resolve('docx'))('jszip');

// Exercise the actual source handler with the real backend libraries and HTTP
// serialization, without importing unrelated upload/DB/queue startup. Auth and
// complete router mounting remain covered by their separate qualification suites.
function actualExportHandler() {
  const file = new URL('../src/server/routes/conversionRoutes.js', import.meta.url);
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'router.post' &&
        ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/html-to-docx') matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(matches.length, 1, 'production must register the exact export route once');
  const call = matches[0];
  assert.equal(call.arguments.length, 2, 'new middleware/context requires updating the integration harness');
  assert.ok(ts.isArrowFunction(call.arguments[1]));
  const compiled = ts.transpileModule('export default ' + call.arguments[1].getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const require = name => {
    assert.ok(['cheerio', 'docx'].includes(name), 'unexpected export dependency: ' + name);
    return backendRequire(name);
  };
  new Function('exports', 'require', compiled)(exports, require);
  return exports.default;
}

test('actual HTML export produces a DOCX without the unused legacy dependency', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/conversion/html-to-docx', actualExportHandler());
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const url = 'http://127.0.0.1:' + server.address().port + '/api/conversion/html-to-docx';
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'export-proof.docx', html: '<h1>Release export proof</h1><p><strong>Bold text</strong> &amp; content</p><ul><li>List item</li></ul><table><tr><td>Cell value</td></tr></table><script>DO_NOT_EXPORT</script>' }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /wordprocessingml.document/);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    assert.ok(zip.file('[Content_Types].xml'));
    const xml = await zip.file('word/document.xml').async('string');
    for (const value of ['Release export proof','Bold text','List item','Cell value']) assert.ok(xml.includes(value), value);
    assert.match(xml, /<w:tbl>/);
    assert.doesNotMatch(xml, /DO_NOT_EXPORT/);
    const missing = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body:'{}', signal:AbortSignal.timeout(5000) });
    assert.equal(missing.status, 400);
    await missing.arrayBuffer();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
