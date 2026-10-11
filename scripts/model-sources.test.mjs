// Per-model source selection (XENO INFERENCE ROUTING - SPEC.md, "Per-model sources").
// Pure rules + the listCredentials account scope. Run: node --test scripts/model-sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRequestedSource, pathForSource, sourcesForModel, refusalForSource,
} from '../src/server/services/modelSources.js';
import { listCredentials } from '../src/server/services/providerCredentials.js';

test('no source expressed keeps today’s resolution (value null)', () => {
  assert.deepEqual(parseRequestedSource({ headers: {}, body: {} }), { value: null });
});

test('header and body both read; each value is case-insensitive', () => {
  assert.deepEqual(parseRequestedSource({ headers: { 'x-xeno-source': 'BYOK' } }), { value: 'byok' });
  assert.deepEqual(parseRequestedSource({ body: { source: 'Credits' } }), { value: 'credits' });
});

test('an unknown source is refused with a typed error, never ignored', () => {
  const r = parseRequestedSource({ body: { source: 'deepseek' } });
  assert.equal(r.error, 'invalid_source');
});

test('header and body that disagree are refused, not resolved in one side’s favour', () => {
  const r = parseRequestedSource({ headers: { 'x-xeno-source': 'credits' }, body: { source: 'byok' } });
  assert.equal(r.error, 'source_conflict');
});

test('quota and credits run on premium; byok on byok; auto on premium EXPLICITLY', () => {
  assert.equal(pathForSource('quota'), 'premium');
  assert.equal(pathForSource('credits'), 'premium');
  assert.equal(pathForSource('byok'), 'byok');
  // auto must never inherit an account default of byok
  assert.equal(pathForSource('auto'), 'premium');
  assert.equal(pathForSource(null), null);
});

test('auto defaults to credits when quota is not offered, and never to the own key', () => {
  const d = sourcesForModel({
    balanceMicro: 5_000_000n,
    credentials: [{ id: 'c1', provider: 'openai', label: 'mine', status: 'active', verified_at: '2026-10-01' }],
  });
  assert.equal(d.default_source, 'credits');
});

test('auto picks quota before credits when quota remains', () => {
  const d = sourcesForModel({ balanceMicro: 5_000_000n, quota: { remaining: 3 }, credentials: [] });
  assert.equal(d.default_source, 'quota');
});

test('auto has NO default when only the own key could serve: it is refused, not switched', () => {
  const d = sourcesForModel({
    balanceMicro: 0n,
    credentials: [{ id: 'c1', provider: 'openai', label: 'mine', status: 'active', verified_at: '2026-10-01' }],
  });
  assert.equal(d.default_source, null);
  const own = d.sources.find((s) => s.source === 'byok');
  assert.equal(own.state, 'available', 'the key is usable, but only when chosen');
  assert.equal(refusalForSource('auto', d.sources).code, 'no_source_available');
  assert.equal(refusalForSource('byok', d.sources).actionUrl, '/overview/integrations');
});

test('credits below the price of one call are unavailable, and say why', () => {
  const d = sourcesForModel({ balanceMicro: 100n, minCostMicro: 5_000n, credentials: [] });
  const credits = d.sources.find((s) => s.source === 'credits');
  assert.equal(credits.state, 'unavailable');
  assert.equal(credits.reason, 'no_balance');
  assert.equal(credits.actionUrl, '/overview/billing');
});

test('an unknown balance is never reported as available', () => {
  const d = sourcesForModel({ balanceMicro: null, credentials: [] });
  assert.equal(d.sources.find((s) => s.source === 'credits').state, 'unavailable');
});

test('a revoked key is listed, unavailable, and marked as revoked', () => {
  const d = sourcesForModel({
    balanceMicro: 1n,
    credentials: [{ id: 'c1', provider: 'openai', label: 'old', status: 'revoked', verified_at: null }],
  });
  const own = d.sources.find((s) => s.source === 'byok');
  assert.equal(own.state, 'unavailable');
  assert.equal(own.reason, 'no_key');
  assert.equal(own.actionUrl, '/overview/integrations');
});

test('a chosen source that cannot serve is refused with its own code, never another source', () => {
  const d = sourcesForModel({ balanceMicro: 0n, credentials: [] });
  assert.equal(refusalForSource('credits', d.sources).code, 'no_balance');
  assert.equal(refusalForSource('byok', d.sources).code, 'no_key');
  assert.equal(refusalForSource('quota', d.sources).code, 'quota_exhausted');
});

test('the output never carries key material, even if the row has it', () => {
  const d = sourcesForModel({
    balanceMicro: 1n,
    credentials: [{ id: 'c1', provider: 'openai', label: 'mine', status: 'active', verified_at: '2026-10-01',
      secret_ciphertext: 'SECRET-CIPHER', key_fingerprint: 'FP', key_last4: '1234' }],
  });
  const text = JSON.stringify(d);
  assert.ok(!text.includes('SECRET-CIPHER'));
  assert.ok(!text.includes('FP'));
  assert.ok(!text.includes('1234'));
});

test('cross-account: the credential list is scoped to the caller’s user id', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; } };
  await listCredentials(db, 'user-A');
  assert.match(calls[0].sql, /WHERE c\.user_id = \$1/);
  assert.deepEqual(calls[0].params, ['user-A']);
});

test('an unverified active key is unavailable with key_unverified, not offered as usable', () => {
  const d = sourcesForModel({ balanceMicro: 1n, credentials: [{ id: 'c1', provider: 'openai', label: 'x', status: 'active', verified_at: null }] });
  const own = d.sources.find((s) => s.source === 'byok');
  assert.equal(own.state, 'unavailable');
  assert.equal(own.reason, 'key_unverified');
});

test('every unavailable source names a reason from the locked vocabulary and a real page', () => {
  const REASONS = new Set(['no_key', 'no_balance', 'quota_exhausted', 'key_unverified']);
  const PAGES = new Set(['/overview/integrations', '/overview/billing', '/pricing']);
  const d = sourcesForModel({ balanceMicro: 0n, credentials: [{ id: 'c1', provider: 'openai', label: 'x', status: 'invalid', verified_at: null }] });
  for (const src of d.sources.filter((x) => x.state === 'unavailable')) {
    assert.ok(REASONS.has(src.reason), `reason ${src.reason}`);
    assert.ok(PAGES.has(src.actionUrl), `actionUrl ${src.actionUrl}`);
  }
});
