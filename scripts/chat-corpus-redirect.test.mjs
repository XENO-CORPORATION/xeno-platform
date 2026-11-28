// The Corpus's first address, /projects/<id>/notebook, must keep working: over real HTTP, the API answers 308 to
// /corpus (method, body and query kept), the chat host's nginx answers 308 for the page, and nothing else is caught.
//   node --test scripts/chat-corpus-redirect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { legacyNotebookRedirect } from '../src/server/routes/chatCorpusRedirect.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const express = createRequire(path.join(repo, 'src/server/package.json'))('express');
const P = '2f6b0c1e-4a52-4c8e-9d1a-7b3e5f9a0c21';

async function withServer(fn) {
  const app = express();
  const router = express.Router();
  router.use(express.json());
  router.use(legacyNotebookRedirect);
  router.get('/projects/:id/corpus', (req, res) => res.json({ at: 'corpus', id: req.params.id, q: req.query }));
  router.patch('/projects/:id/corpus/sources/:sourceId', (req, res) => res.json({ at: 'source', body: req.body }));
  router.get('/projects/:id', (req, res) => res.json({ at: 'project' }));
  app.use('/api/chat', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test('the old API address answers 308 to /corpus, keeping the query', () => withServer(async (base) => {
  const r = await fetch(`${base}/api/chat/projects/${P}/notebook?x=1`, { redirect: 'manual' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), `/api/chat/projects/${P}/corpus?x=1`);
  const followed = await (await fetch(`${base}/api/chat/projects/${P}/notebook?x=1`)).json();
  assert.deepEqual(followed, { at: 'corpus', id: P, q: { x: '1' } }, 'a client following it lands on the Corpus');
}));

test('a PATCH to the old source address is still a PATCH with its body after the redirect', () => withServer(async (base) => {
  const r = await fetch(`${base}/api/chat/projects/${P}/notebook/sources/abc`, { method: 'PATCH', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: '{"selected":false}' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), `/api/chat/projects/${P}/corpus/sources/abc`);
  const followed = await (await fetch(`${base}/api/chat/projects/${P}/notebook/sources/abc`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"selected":false}' })).json();
  assert.deepEqual(followed, { at: 'source', body: { selected: false } });
}));

test('only the old addresses are caught: the project and the Corpus answer as themselves', () => withServer(async (base) => {
  assert.equal((await (await fetch(`${base}/api/chat/projects/${P}`)).json()).at, 'project');
  const r = await fetch(`${base}/api/chat/projects/${P}/corpus`, { redirect: 'manual' });
  assert.equal(r.status, 200);
  const other = await fetch(`${base}/api/chat/projects/${P}/notebookish`, { redirect: 'manual' });
  assert.notEqual(other.status, 308, 'a path that merely starts with "notebook" is not redirected');
}));

test('the redirect never leaves this router: an encoded slash stays inside the segment', () => withServer(async (base) => {
  const r = await fetch(`${base}/api/chat/projects/..%2F..%2Fevil/notebook`, { redirect: 'manual' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), '/api/chat/projects/..%2F..%2Fevil/corpus');
}));

test('with sign-in required behind it, an unsigned caller still gets the 308 (and the new address still asks to sign in)', async () => {
  const app = express();
  app.use('/api/chat', legacyNotebookRedirect);
  app.use('/api/chat', (req, res) => res.status(401).json({ error: 'sign in' }));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const old = await fetch(`${base}/api/chat/projects/${P}/notebook`, { redirect: 'manual' });
    assert.equal(old.status, 308);
    assert.equal(old.headers.get('location'), `/api/chat/projects/${P}/corpus`);
    assert.equal((await fetch(`${base}/api/chat/projects/${P}/corpus`, { redirect: 'manual' })).status, 401);
  } finally { server.close(); }
});

test('the chat host 308s the old page address before its generic page location', () => {
  const conf = fs.readFileSync(path.join(repo, 'nginx/default.conf'), 'utf8');
  const start = conf.indexOf('server_name chat.xenosystem.ai;');
  assert.ok(start > 0, 'the chat host block exists');
  const block = conf.slice(start, conf.indexOf('\n}', start));
  const legacy = block.search(/location ~ "\^\/\(chat\/\)\?projects\/\(\[\^\/\]\+\)\/notebook\$" \{ return 308 \/\$1projects\/\$2\/corpus\$is_args\$args; \}/);
  assert.ok(legacy > 0, 'a 308 from /[chat/]projects/<id>/notebook to /corpus, query kept');
  const generic = block.indexOf('location ~ "^/((c|projects|library|images)(/[^.]*)?)?$"');
  const app = block.indexOf('location ~ ^/chat(/|$)');
  assert.ok(generic > legacy && app > legacy, 'regex locations match in order: the redirect must come before both page locations');
});

test('the server mounts the redirect ahead of the chat sign-in check, so any caller gets the 308', () => {
  // behind chatAuthMiddleware an unsigned caller got 401 at the old address (measured live 2026-11-28 18:19Z): the
  // redirect is a path rewrite that reveals nothing, so it answers before sign-in is asked for
  const index = fs.readFileSync(path.join(repo, 'src/server/index.js'), 'utf8');
  const mount = index.indexOf("app.use('/api/chat', legacyNotebookRedirect);");
  assert.ok(mount > 0, 'index.js mounts legacyNotebookRedirect on /api/chat');
  assert.ok(mount < index.indexOf("app.use('/api/chat', databaseMiddleware, chatAuthMiddleware, chatRoutes);"), 'before the chat auth and routes');
  const routes = fs.readFileSync(path.join(repo, 'src/server/routes/chatRoutes.js'), 'utf8');
  assert.equal(routes.includes("'/projects/:id/notebook"), false, 'no route is still registered at the old address');
});
