import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Real components + real account transport. Only the signed-in React context is a fixture. */
export async function provePublicationBrowser({ app, baseUrl, projectId, accountId, token, milestone = null, forbidden = [] }) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const bundle = await build({ write: false, bundle: true, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'fixture-auth-context', setup(builder) {
      builder.onLoad({ filter: /[\\/]contexts[\\/]AuthContext\.tsx$/ }, () => ({ contents: `
        import {useSyncExternalStore} from 'react';
        let id=${JSON.stringify(accountId)}; const listeners=new Set();
        window.fixtureAccount=value=>{id=value;listeners.forEach(fn=>fn());};
        export const useAuth=()=>({user:{id:useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>id)},isAuthenticated:true,isLoading:false});`, loader: 'tsx' }));
    } }],
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route} from 'react-router-dom';
      import ProjectPublication from './src/components/account/ProjectPublication';
      import PublicProjects from './src/pages/PublicProjects';
      import {setAccessToken} from './src/lib/authSession';
      setAccessToken(${JSON.stringify(token)});
      createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
        <Route path="/fixture/manage" element={<ProjectPublication projectId=${JSON.stringify(projectId)} />} />
        <Route path="/public-projects" element={<PublicProjects />} />
        <Route path="/public-projects/:projectId" element={<PublicProjects />} />
      </Routes></BrowserRouter>);
    ` },
  });
  const script = bundle.outputFiles[0].text;
  app.get('/fixture/publication.js', (_req, res) => res.type('js').send(script));
  app.get(['/fixture/manage', '/public-projects', '/public-projects/:id'], (_req, res) => res.type('html').send('<!doctype html><div id="root"></div><script src="/fixture/publication.js"></script>'));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const click = async label => {
      await page.waitForFunction(label => [...document.querySelectorAll('button')].some(b => b.textContent === label && !b.disabled), {}, label);
      await page.evaluate(label => [...document.querySelectorAll('button')].find(b => b.textContent === label).click(), label);
    };
    const has = text => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
    await page.goto(baseUrl + '/fixture/manage'); await page.waitForSelector('textarea');
    const fields = ['Browser publication', 'Only this purpose is public', 'All rights reserved', 'terms-1', 'Contact the maintainer', 'Reviewed roadmap', 'Selected update'];
    await page.evaluate(fields => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      [...document.querySelectorAll('textarea')].forEach((input, i) => { setter.call(input, fields[i]); input.dispatchEvent(new Event('input', { bubbles: true })); });
    }, fields);
    if (milestone) {
      await click('Load accepted milestones'); await click(`Select ${milestone.title}`);
      await page.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const inputs = [...document.querySelectorAll('textarea')].slice(7);
        for (const [i, value] of ['Reviewed delivery', 'The selected delivery has been accepted.'].entries()) {
          setter.call(inputs[i], value); inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
    await click('Save private draft'); await has('Draft revision: 1');
    await page.reload(); await page.waitForSelector('textarea');
    assert.equal(await page.$eval('textarea', node => node.value), fields[0], 'saved draft survives refresh');
    await click('Preview saved draft'); await has('Exact disclosure preview');
    assert.equal(await page.$eval('.legal-prose h2', node => node.textContent), fields[0]);
    if (milestone) assert((await page.$eval('.legal-prose', node => node.innerText)).includes('The selected delivery has been accepted.'), 'accepted summary renders in exact preview');
    // The server commits but its acknowledgement is lost at the transport boundary.
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window); let drop = true;
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (drop && String(args[0]).endsWith('/operations')) { drop = false; await response.text(); throw new Error('Fixture lost acknowledgement'); }
        return response;
      };
    });
    await click('Confirm publication'); await has('An operation needs reconciliation');
    await page.reload(); await has('An operation needs reconciliation');
    await click('Check saved operation'); await has('Current visibility: unlisted');
    await has('Draft revision: 2');
    // Two tabs have independent durable request identities. Reconciling one must
    // never remove the other tab's record, even if both saw the same revision.
    await page.evaluate(({ accountId, projectId }) => {
      const prefix = `xeno-project-publication:${accountId}:${projectId}:`;
      for (const operationId of ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']) {
        localStorage.setItem(prefix + operationId, JSON.stringify({ projectId, expectedActorAccountId: accountId, operationId,
          action: 'revoke', expectedRevision: '2' }));
      }
    }, { accountId, projectId });
    await page.reload(); await has('An operation needs reconciliation');
    await click('Retry same operation');
    await page.waitForFunction(({ accountId, projectId }) => Object.keys(localStorage).filter(key => key.startsWith(`xeno-project-publication:${accountId}:${projectId}:`)).length === 1, {}, { accountId, projectId });
    const remaining = await page.evaluate(({ accountId, projectId }) => Object.keys(localStorage).filter(key => key.startsWith(`xeno-project-publication:${accountId}:${projectId}:`)), { accountId, projectId });
    assert.equal(remaining.length, 1, 'settling one tab preserves the other recovery identity');
    assert(remaining[0].endsWith('22222222-2222-4222-8222-222222222222'));
    await click('Retry same operation'); await has('publication_revision_conflict');
    await page.waitForFunction(() => !document.body.innerText.includes('An operation needs reconciliation'));
    await click('Preview saved draft'); await has('Exact disclosure preview');
    await click('Confirm publication'); await has('Current visibility: unlisted');
    await page.click(`a[href="/public-projects/${projectId}"]`); await has(fields[1]);
    assert.equal(new URL(page.url()).pathname, '/public-projects/' + projectId);
    await page.reload(); await has(fields[1]);
    assert(!(await page.content()).includes('PRIVATE-INSTRUCTIONS'));
    if (milestone) {
      assert((await page.$eval('body', node => node.innerText)).includes('The selected delivery has been accepted.'), 'accepted summary survives public direct entry and reload');
      const html = await page.content();
      for (const secret of forbidden) assert(!html.includes(secret), `public HTML excludes ${secret}`);
    }
    await page.goBack(); await has('Current visibility: unlisted');
    await page.goForward(); await has(fields[1]);
    await page.goto(baseUrl + '/fixture/manage'); await has('Current visibility: unlisted');
    await click('Make private'); await click('Confirm make private'); await has('Current visibility: private');
    await page.goto(baseUrl + '/public-projects/' + projectId); await has('private or withdrawn');
    await page.goto(baseUrl + '/public-projects'); await has('No public projects');
    // A preview may finish after account A -> B -> A. The response belongs to
    // the old generation even though the current account ID matches again.
    await page.goto(baseUrl + '/fixture/manage'); await has('Current visibility: private');
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await fetch(...args);
        if (String(args[0]).endsWith('/preview')) {
          const text = await response.text();
          window.fixturePreviewWaiting = true;
          await new Promise(resolve => { window.releaseFixturePreview = resolve; });
          return new Response(text, { status: response.status, headers: response.headers });
        }
        return response;
      };
    });
    await click('Preview saved draft');
    await page.waitForFunction(() => window.fixturePreviewWaiting === true);
    await page.evaluate(() => window.fixtureAccount('dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
    await has('actor_changed');
    await page.evaluate(accountId => window.fixtureAccount(accountId), accountId);
    await has('Current visibility: private');
    await page.evaluate(() => window.releaseFixturePreview());
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Preview saved draft' && !b.disabled));
    assert.equal(await page.$('.legal-prose h2'), null, 'late preview from prior account generation is discarded');
    if (milestone) {
      await page.reload(); await has('Current visibility: private');
      await page.evaluate(() => {
        const fetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const response = await fetch(...args);
          if (String(args[0]).endsWith('/milestones')) {
            const text = await response.text(); window.fixtureMilestonesWaiting = true;
            await new Promise(resolve => { window.releaseFixtureMilestones = resolve; });
            return new Response(text, { status: response.status, headers: response.headers });
          }
          return response;
        };
      });
      await click('Load accepted milestones');
      await page.waitForFunction(() => window.fixtureMilestonesWaiting === true);
      await page.evaluate(() => window.fixtureAccount('dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
      await has('actor_changed');
      await page.evaluate(accountId => window.fixtureAccount(accountId), accountId);
      await has('Current visibility: private');
      await page.evaluate(() => window.releaseFixtureMilestones());
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Load accepted milestones' && !b.disabled));
      assert.equal(await page.evaluate(title => [...document.querySelectorAll('button')].some(b => b.textContent === `Select ${title}`), milestone.title), false,
        'late milestone list from prior account generation is discarded');
    }
    const recoveryKey = `xeno-project-publication:${accountId}:${projectId}:corrupt-fixture`;
    await page.evaluate(key => localStorage.setItem(key, '{invalid-json'), recoveryKey);
    await page.goto(baseUrl + '/fixture/manage'); await has('Publication changes are blocked');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Save private draft')), false, 'corrupt recovery cannot be overwritten by a new operation');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recoveryKey), '{invalid-json');
    assert.deepEqual(errors, [], 'publication journey has no React/browser exceptions');
  } finally { await browser.close(); }
}
