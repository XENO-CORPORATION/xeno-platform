import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePublicationContent, publicProjectPath, publicationVisibility, publicationRevision } from '../src/server/config/projectPublicationContract.js';
const content = () => ({ schemaVersion: 1, title: ' Project ', purpose: 'Explicit purpose', license: 'All rights reserved', termsVersion: '1', contributionGuide: 'Contact the maintainer; no execution permission implied.', roadmap: '', updates: '' });
test('publication accepts only explicitly authored bounded disclosure fields', () => {
  assert.equal(normalizePublicationContent(content()).title, 'Project');
  for (const field of ['custom_instructions', 'settings', 'workspace_id', 'chat_count', 'credentials', 'localPath', 'fundingTotals']) {
    assert.throws(() => normalizePublicationContent({ ...content(), [field]: 'private' }), /unknown_field/);
  }
  assert.throws(() => normalizePublicationContent({ ...content(), license: '' }), /required_text/);
  assert.throws(() => normalizePublicationContent({ ...content(), purpose: 'x'.repeat(8001) }), /invalid_text/);
  assert.throws(() => normalizePublicationContent({ ...content(), title: 'bad\0text' }), /invalid_text/);
});
test('publication validation never invokes a supplied getter or inherited field', () => {
  let called = false;
  const value = content(); Object.defineProperty(value, 'title', { enumerable: true, get() { called = true; return 'secret'; } });
  assert.throws(() => normalizePublicationContent(value), /invalid_shape/);
  assert.equal(called, false);
  assert.throws(() => normalizePublicationContent(Object.assign(Object.create({ private: true }), content())), /invalid_shape/);
});
test('public paths use validated stable IDs and cannot collide with private project redirects', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(publicProjectPath(id), `/public-projects/${id}`);
  assert.throws(() => publicProjectPath('../overview'), /invalid_id/);
  for (const visibility of ['private', 'unlisted', 'public']) assert.equal(publicationVisibility(visibility), visibility);
  assert.throws(() => publicationVisibility('workspace'), /invalid_visibility/);
  assert.equal(publicationRevision('0'), '0');
  for (const bad of [0, '-1', '01', '1.5']) assert.throws(() => publicationRevision(bad), /invalid_revision/);
});

test('publication service, public routes and project controls are mounted in their real owners', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert(read('src/server/index.js').includes("app.use('/api/public-projects', databaseMiddleware, projectPublicationRoutes)"));
  const app = read('src/App.tsx');
  assert(app.includes('path="/public-projects" element={<PublicProjects />}'));
  assert(app.includes('path="/public-projects/:projectId" element={<PublicProjects />}'));
  assert.match(read('src/components/account/ProjectsPage.tsx'), /<ProjectPublication[^>]*projectId=\{selected\.id\}/);
  const proof = read('scripts/project-publication.test.mjs');
  assert(proof.includes('await provePublicationBrowser('));
  assert.doesNotMatch(proof, /PUBLICATION_BROWSER_PROOF/);
});
