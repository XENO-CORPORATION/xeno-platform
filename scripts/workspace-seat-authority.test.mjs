/**
 * Seats are capacity; membership spends it. They must serialize.
 *
 * Without one shared gate, `setWorkspacePlan` (a seat-limit write) and an invitation
 * acceptance each take a DIFFERENT lock — billing took none, the invite path took a row
 * lock — so an acceptance that read the old limit and a seat reduction can both commit,
 * and the workspace ends up over its paid seat count with no error anywhere.
 *
 * This asserts the gate is SHARED, by holding it and watching both paths block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');

test('the seat-limit write takes the shared workspace authority gate', () => {
  const billing = read('src/server/services/billingService.js');
  const start = billing.indexOf('async function setWorkspacePlan(');
  assert.ok(start > -1, 'setWorkspacePlan is gone or renamed');
  const fn = billing.slice(start, billing.indexOf('\n/** Stripe billing portal', start));
  assert.ok(fn.includes('lockWorkspaceAuthority('),
    'setWorkspacePlan writes the seat limit without taking the shared gate — it can ' +
    'interleave with an invitation acceptance reading the old limit');
  assert.ok(fn.includes("typeof db.release === 'function'"),
    'setWorkspacePlan must work on BOTH a pool and an in-transaction client, and must ' +
    'discriminate on `release`: a pg PoolClient INHERITS `connect` from Client, so testing ' +
    'for `connect` treats a checked-out client as a pool and reuses it');
});

test('invitation acceptance takes the SAME gate, not merely a row lock', () => {
  const routes = read('src/server/routes/workspaceRoutes.js');
  const start = routes.indexOf("inviteRouter.post('/:inviteId/accept'");
  assert.ok(start > -1, 'the accept route is gone or renamed');
  const fn = routes.slice(start, start + 3000);
  assert.ok(fn.includes('lockWorkspaceAuthority(tx,'),
    'accept takes only a row lock; billing writes the same row from another path, so the ' +
    'two do not serialize');
  assert.ok(fn.indexOf('lockWorkspaceAuthority(tx,') < fn.indexOf("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE"),
    'the advisory gate must be taken BEFORE the row lock, matching every other ' +
    'workspace authority path — a consistent order is what prevents deadlock');
});
