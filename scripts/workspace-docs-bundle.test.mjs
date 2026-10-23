/**
 * The workspace's Write / Notes editor and the server's validator are XENO Docs' — generated from ONE build of
 * `@xenosystem/blocks/docs` by scripts/build-workspace-docs.mjs — and they stay that way:
 *
 *   - both generated files exist, carry the generator's banner, and name the SAME build (an editor from one version
 *     and a validator from another would accept and refuse different documents);
 *   - the server's file is the format only: no import, no editor, no DOM;
 *   - the workspace's file is the framework-free surface: no React;
 *   - the service validates with it, and the screen mounts it — the screen has no Markdown renderer or serializer of
 *     its own any more (the third editor this replaced), and never assigns document text as HTML;
 *   - the page loads the editor through a content-hashed address.
 *
 *   node --test scripts/workspace-docs-bundle.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const editor = fs.readFileSync('prototypes/xeno-workspace/docs-editor.js', 'utf8');
const server = fs.readFileSync('src/server/vendor/xdoc-format.mjs', 'utf8');
const screen = fs.readFileSync('prototypes/xeno-workspace/platform-docs.js', 'utf8');
const service = fs.readFileSync('src/server/services/workspaceDocs.js', 'utf8');
const page = fs.readFileSync('prototypes/xeno-workspace/index.html', 'utf8');
const stampOf = (src) => (/^\/\/ GENERATED from (@xenosystem\/blocks@[\d.]+\/docs \(xeno-blocks [0-9a-f]{7,40}|@xenosystem\/blocks@[\d.]+\/docs \(xeno-blocks npm)\) by scripts\/build-workspace-docs\.mjs/.exec(src) || [])[1];

test('both files are generated, and from the same build', async () => {
  const a = stampOf(editor), b = stampOf(server);
  assert.ok(a, 'docs-editor.js carries the generator banner');
  assert.ok(b, 'xdoc-format.mjs carries the generator banner');
  assert.equal(a, b, 'the editor and the validator come from one build');
  const mod = await import('../src/server/vendor/xdoc-format.mjs');
  assert.equal(`${mod.BUILT_FROM.replace(/\)$/, '')}`, a, 'the module says the build its banner says');
  assert.ok(editor.includes(JSON.stringify(mod.BUILT_FROM)), 'the editor bundle exports the same BUILT_FROM');
});

test('the server file is the format only', async () => {
  assert.doesNotMatch(server, /^\s*import\b/m, 'no imports');
  assert.doesNotMatch(server, /prosemirror|@tiptap|document\.|window\./i, 'no editor, no DOM');
  const X = await import('../src/server/vendor/xdoc-format.mjs');
  for (const name of ['parseXdoc', 'serializeXdoc', 'validateContent', 'plainText', 'pageLinksIn', 'markdownToDocument', 'documentToMarkdown']) assert.equal(typeof X[name], 'function', name);
  // it works on its own: the XSS refusal the editor relies on is the server's too
  assert.ok(X.validateContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }).length > 0);
});

test('the workspace file is the framework-free surface, no React', () => {
  assert.doesNotMatch(editor, /react-dom|__SECRET_INTERNALS|useSyncExternalStore/);
  assert.match(editor, /var XenoDocs\s*=/);
  assert.ok(editor.length < 600 * 1024, `the editor bundle is ${Math.round(editor.length / 1024)} KB — a jump means something it should not carry was pulled in`);
});

test('the service validates with it; the screen mounts it and carries no editor of its own', () => {
  assert.match(service, /from '\.\.\/vendor\/xdoc-format\.mjs'/);
  assert.match(service, /X\.validateContent\(c\)/, 'every write is validated');
  assert.match(service, /readContent\(text, f\.metadata\.xeno_doc\)/, 'every read is parsed (and so validated) on the way out');
  assert.match(screen, /Lib\.mountDocumentSurface\(/, 'the screen mounts XENO Docs’ surface');
  assert.match(screen, /new Lib\.DocumentController\(/);
  for (const own of [/function render\(md\)/, /function serialize\(root\)/, /function inlineMd\(/, /execCommand\(/, /XENO_DOCS_MD/, /contenteditable="true"/]) assert.doesNotMatch(screen, own, `the screen has its own editor again (${own})`);
  // nothing in the screen assigns document text as HTML: the only innerHTML-like sink is the page string, built with esc()
  assert.doesNotMatch(screen, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
});

test('the page loads the editor through a content-hashed address', () => {
  assert.match(page, /<link rel="prefetch" as="script" href="docs-editor\.js" data-docs-editor>/);
  assert.match(screen, /link\[data-docs-editor\]/);
});
