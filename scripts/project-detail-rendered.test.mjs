import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import express from 'express';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('fresh project detail resolves by ID even when absent from the list page', { timeout: 30000 }, async t => {
  const bundle = await build({ write: false, bundle: true, format: 'iife', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: { '@xenosystem/elements-react': resolve(root, 'packages/elements-react/src/index.ts'),
      '@xenosystem/elements/schema': resolve(root, 'packages/elements/src/schema.ts'),
      '@xenosystem/elements/tokens': resolve(root, 'packages/elements/src/tokens/index.ts'),
      '@xenosystem/elements/elements': resolve(root, 'packages/elements/src/elements'),
      '@xenosystem/generate': resolve(root, 'packages/generate/src/index.ts'),
      '@xenosystem/elements': resolve(root, 'packages/elements/src/index.ts') },
    plugins: [{ name: 'fixture-account-context', setup(b) {
      if (process.env.PROJECT_DETAIL_MUTATION === 'omit-read') b.onLoad({ filter: /[\\/]ProjectsPage\.tsx$/ }, async args => {
        const source = await readFile(args.path, 'utf8');
        const anchor = 'void getProject(projectId, abort.signal).then(result => {';
        assert.equal(source.split(anchor).length, 2, 'mutation anchor must be unique');
        return { loader: 'tsx', contents: source.replace(anchor, 'void new Promise<any>(() => {}).then(result => {') };
      });
      b.onLoad({ filter: /[\\/]contexts[\\/]WorkspaceContext\.tsx$/ }, () => ({ loader: 'tsx', contents: `export const useWorkspace=()=>({activeWorkspace:{id:'${wid}',name:'Fixture workspace',workspace_type:'team'},isLoading:false});` }));
      b.onLoad({ filter: /[\\/]contexts[\\/]AuthContext\.tsx$/ }, () => ({ loader: 'tsx', contents: `export const useAuth=()=>({user:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},isAuthenticated:true,isLoading:false});` }));
    } }],
    stdin: { resolveDir: root, loader: 'tsx', contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import ProjectsPage from './src/components/account/ProjectsPage';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/overview/projects/:projectId?" element={<ProjectsPage/>}/></Routes></BrowserRouter>);` },
  });
  const app = express(); let detailReads = 0;
  app.get('/api/chat/projects', (_req, res) => res.json({ success: true, projects: [] }));
  app.get('/api/chat/projects/:id', (req, res) => {
    detailReads++;
    if (req.params.id !== pid) return res.status(404).json({ success: false, code: 'project_not_found', error: 'Project not found' });
    res.json({ success: true, project: { id: pid, workspace_id: wid, name: 'Beyond first page', description: 'Persisted detail', created_at: '2026-09-30', updated_at: '2026-09-30' }, capabilities: { admin: true } });
  });
  app.get('/api/workspaces/:id/teams', (_req, res) => res.json({ success: true, teams: [] }));
  app.post('/api/public-projects/state', (_req, res) => res.status(403).json({ success: false, error: 'Publication is unavailable in this fixture' }));
  app.get('/fixture.js', (_req, res) => res.type('js').send(bundle.outputFiles[0].text));
  // Express 5 (path-to-regexp v8): an optional segment is `{/:id}` — `:id?` is a syntax error.
  app.get('/overview/projects{/:id}', (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script src="/fixture.js"></script>'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const browser = await puppeteer.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/overview/projects/${pid}`;
  await page.goto(url);
  await page.waitForFunction(() => document.body.innerText.includes('Beyond first page'), { timeout: 4000 }).catch(async () => {
    assert.fail(`Direct project unresolved: detailReads=${detailReads}; errors=${JSON.stringify(errors)}; body=${(await page.$eval('body', node => node.innerText)).slice(0, 600)}`);
  });
  assert(detailReads > 0, 'detail must be fetched independently of list membership');
  assert(await page.$('[role="dialog"][aria-label="Beyond first page details"]'));
  await page.reload(); await page.waitForFunction(() => document.body.innerText.includes('Beyond first page'));
  await page.goto(url.replace(pid, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
  await page.waitForFunction(() => document.body.innerText.includes('Project not found'));
  assert.equal(await page.$('[role="dialog"][aria-label="Beyond first page details"]'), null);
  assert.deepEqual(errors, []);
});
