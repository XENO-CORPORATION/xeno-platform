// REST + OpenAPI are GENERATED from the capability catalogue (XENO WORKSPACE AGENT SURFACE - SPEC.md P1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE, restCapabilities } from '../src/server/capabilities/catalogue.js';
import { WORKSPACE_SCOPES } from '../src/server/capabilities/scopes.js';
import { openapi, restPath } from '../src/server/routes/workspaceApiRoutes.js';
import * as mcp from '../src/server/services/xenoMcp.js';

test('every REST capability is one generated OpenAPI path, and nothing else is', () => {
  const doc = openapi('https://example.test');
  assert.equal(doc.openapi, '3.1.0');
  const want = restCapabilities().map((c) => `/api/v1${restPath(c.name)}`).sort();
  assert.deepEqual(Object.keys(doc.paths).sort(), want);
  for (const c of restCapabilities()) {
    const op = doc.paths[`/api/v1${restPath(c.name)}`].post;
    assert.equal(op['x-xeno-capability'], c.name);
    assert.deepEqual(op.security[0], { oauth2: [c.scope] });
    assert.deepEqual(op.requestBody.content['application/json'].schema, c.input, 'the input schema is the bound tool’s own');
  }
  assert.deepEqual(Object.keys(doc.components.securitySchemes.oauth2.flows.authorizationCode.scopes), [...WORKSPACE_SCOPES]);
});

test('Storage is the first division on REST and MCP; the Forum and Tasks MCPs are folded in as categories', () => {
  for (const n of ['storage.folder.list', 'storage.folder.create', 'storage.file.upload', 'storage.link.create', 'forum.thread.search', 'tasks.task.create']) {
    const c = CATALOGUE.find((x) => x.name === n);
    assert.ok(c && c.surfaces.includes('rest') && c.surfaces.includes('mcp'), n);
  }
  assert.ok(mcp.CATEGORIES.includes('storage') && mcp.CATEGORIES.includes('forum'));
  assert.equal(CATALOGUE.find((c) => c.name === 'storage.link.create').scope, 'share:create');
});

test('agents create sign-in links only: no storage tool makes a public link (owner, 2026-10-20 §5 Q1)', () => {
  const src = readFileSync(new URL('../src/server/services/storageMcp.js', import.meta.url), 'utf8');
  assert.ok(!/createFileLink|createPublicLink|\/assets\/:id\/link/.test(src));
  assert.ok(/createFolderLink/.test(src));
});

test('the REST router is generated: no hand-written per-capability route in it', () => {
  const src = readFileSync(new URL('../src/server/routes/workspaceApiRoutes.js', import.meta.url), 'utf8');
  const routes = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(routes.sort(), ['get /:division/:domain/:verb', 'get /openapi.json', 'post /:division/:domain/:verb']);
});
