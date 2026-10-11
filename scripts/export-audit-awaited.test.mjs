// The export audit events must be WRITTEN before the response leaves: an un-awaited insert lets a
// download succeed with no record, and lets a reader see the response before the event exists.
// Mutation: removing either `await` fails this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/server/routes/accountSecurityRoutes.js', import.meta.url), 'utf8');

test('the export-request audit event is awaited before the 202', () => {
  assert.match(src, /await recordSecurityEvent\(req\.db, EVENTS\.DATA_EXPORT_REQUESTED/);
});

test('the export-download audit event is awaited before the file is sent', () => {
  assert.match(src, /await recordSecurityEvent\(req\.db, EVENTS\.DATA_EXPORT_DOWNLOADED/);
});
