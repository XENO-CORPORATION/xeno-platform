// A workforce capability answers EXACTLY what its route answers (one shaping function), and spend step-up uses the
// SERVER-derived cost, never a caller-stated one. Each property is mutation-checked. (WORKSPACE AGENT SURFACE.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKFORCE_SHAPES } from '../src/server/routes/workforceRoutes.js';
import { TOOL_ROUTE, TOOLS, shapeResult } from '../src/server/services/workforceMcp.js';
import { stepUpFor, stepUpReason, STEP_UP_EUR, CREDITS_PER_EUR } from '../src/server/services/workspaceCredentials.js';

const ROUTES = readFileSync(new URL('../src/server/routes/workforceRoutes.js', import.meta.url), 'utf8');
const ID = '11111111-1111-4111-8111-111111111111';

test('every workforce tool is shaped as its route: by the route’s own projection, or by the route’s own wrapper', () => {
  for (const t of TOOLS) {
    const r = TOOL_ROUTE[t.name];
    assert.ok(r, `${t.name} has no route shape`);
    if (r.path) {
      assert.ok(WORKFORCE_SHAPES[r.path], `${t.name} → ${r.path} is not a shaped route`);
      assert.ok(ROUTES.includes(`...shaped('${r.path}')`), `the route ${r.path} does not use the shared shape`);
    }
  }
});

test('run.* family: a field the route hides is absent from the capability result', () => {
  const authority = { schemaVersion: 1, admissionId: ID, revoked: true, reason: 'owner', internalLeaseKey: 'SECRET' };
  const out = shapeResult('authority_get', authority, { admissionId: ID });
  assert.equal(out.revoked, true);
  assert.equal(out.internalLeaseKey, undefined);
  assert.equal(JSON.stringify(out).includes('SECRET'), false);
  // MUTATION: an unshaped pass-through would leak it
  const leaked = { ...authority };
  assert.equal(leaked.internalLeaseKey, 'SECRET');
});

test('agent.* family: the definition read hides what the route hides, and refuses a swapped identity', () => {
  const hash = 'a'.repeat(64);
  const v = { schemaVersion: 1, access: { allowed: true, why: 'owner-internal' }, version: { resourceId: ID, version: 2, contentHash: hash, schemaVersion: 1,
    content: { instructions: 'x', skills: [], requestedCapabilities: [], secretReferences: [] }, provenance: {}, license: {}, createdByUserId: null, createdAt: new Date().toISOString(), privateNote: 'SECRET' } };
  const req = { resourceId: ID, version: 2, contentHash: hash };
  const out = shapeResult('resource_get', v, req);
  assert.equal(JSON.stringify(out).includes('SECRET'), false, 'a field outside the documented version fields is hidden');
  assert.equal(JSON.stringify(out).includes('owner-internal'), false);
  assert.throws(() => shapeResult('resource_get', v, { ...req, version: 3 }), /failed/, 'a reply for another version is refused, as on the route');
});

test('division/objective/funding: their routes return the service result unprojected, so the capability wraps it the same way', () => {
  assert.deepEqual(shapeResult('division_get', { id: 'd' }, {}), { division: { id: 'd' } });
  assert.deepEqual(shapeResult('division_list', { divisions: [] }, {}), { divisions: [] });
  assert.deepEqual(shapeResult('funding_budget_get', { b: 1 }, {}), { result: { b: 1 } });
  assert.deepEqual(shapeResult('objective_get', { o: 1 }, {}), { result: { o: 1 } });
});

// ── step-up: server-derived cost
const SPEND = { name: 'studio.image.generate', class: 'undoable', cost: { model: 'quoted' } };
const models = (credits) => async () => ({ models: [{ id: 'm1', maxCredits: credits }, { id: 'm2', maxCredits: 10 }] });
const LIMIT = STEP_UP_EUR * CREDITS_PER_EUR;

test('step-up: an UNDERSTATED caller cost is ignored — the model’s server price decides', async () => {
  assert.equal(await stepUpFor(null, SPEND, { model: 'm1', max_credits: 1 }, { id: 'a' }, { mediaModels: models(LIMIT + 1), teamLeftCredits: null }), 'spend');
  assert.equal(await stepUpFor(null, SPEND, { model: 'm2', max_credits: 999999 }, { id: 'a' }, { mediaModels: models(LIMIT + 1), teamLeftCredits: null }), null, 'an overstated one does not force it either');
});

test('step-up: an OMITTED cost and an underivable one both step up (fail closed); the lower team budget applies', async () => {
  assert.equal(await stepUpFor(null, SPEND, {}, { id: 'a' }, { mediaModels: models(LIMIT + 1), teamLeftCredits: null }), 'spend', 'no model named: the dearest one');
  assert.equal(await stepUpFor(null, { ...SPEND, name: 'chat.model.ask', cost: { model: 'metered' } }, {}, { id: 'a' }, { teamLeftCredits: null }), 'spend', 'no server price: step up');
  assert.equal(await stepUpFor(null, SPEND, { model: 'm2' }, { id: 'a' }, { mediaModels: models(1), teamLeftCredits: 5 }), 'spend', '10 credits above a team budget of 5');
  assert.equal(await stepUpFor(null, SPEND, { model: 'm2' }, { id: 'a' }, { mediaModels: models(1), teamLeftCredits: 50 }), null);
});

test('MUTATION: the rule never reads a caller-stated cost', () => {
  assert.equal(stepUpReason(SPEND, { serverCredits: null, estimatedCredits: 1 }), 'spend');
  const src = readFileSync(new URL('../src/server/services/xenoMcp.js', import.meta.url), 'utf8');
  assert.ok(!/max_credits/.test(src.slice(src.indexOf('const wt = workspaceTokenOf(actor);'), src.indexOf('const argKey'))), 'the gate must not consult max_credits');
});
