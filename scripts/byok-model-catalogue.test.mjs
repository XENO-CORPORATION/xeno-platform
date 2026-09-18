/**
 * The picker lists what a request would get — the gateway's catalogue PLUS the models the
 * account's own keys make reachable, each stamped with its route.
 *
 * 2026-09-18: a DeepSeek key was stored and routed account-wide and `deepseek-chat` answered
 * on it over the API — and the web chat never listed it. The picker was the gateway
 * catalogue alone; a BYOK route was a routing rule, never a catalogue entry.
 *
 *   node --test scripts/byok-model-catalogue.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annotateCatalogueRoutes, chooseRouteLevel } from '../src/server/services/providerCredentials.js';
import { mergeCatalogueWithRoutes, vendorLabelForCredential } from '../src/server/utils/modelCatalogueMerge.js';
import { reasoningCapabilityForModel } from '../src/server/lib/chatModelCapabilities.js';

process.env.BYOK_ENABLED = 'true';
const prettyModelName = (id) => id;
const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A db whose only two queries are the route rows and the catalogue rows. */
function fakeDb({ routes = [], catalogue = [] }) {
  return {
    async query(sql, params) {
      if (/FROM inference_routes/.test(sql)) return { rows: routes.filter((r) => params[1].includes(r.surface)) };
      if (/FROM gateway_model_aliases/.test(sql)) return { rows: catalogue.filter((c) => params[0].includes(c.public_id)) };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
}

const deepseek = {
  surface: '*', path: 'byok', mode: 'managed', credential_id: 'cred-ds',
  provider: 'compatible', base_url: 'https://api.deepseek.com/v1', credential_status: 'active',
  key_fingerprint: 'abcd', models: ['deepseek-chat', 'deepseek-reasoner'], label: 'deepseek-api',
};
const catalogue = [{ public_id: 'claude-sonnet-5', provider: 'anthropic' }, { public_id: 'gpt-5.5', provider: 'openai' }];
const gateway = { success: true, companies: { Anthropic: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', maxTokens: 200000 }], OpenAI: [{ id: 'gpt-5.5', name: 'GPT-5.5', maxTokens: 400000 }] } };

test('a pass-through key routed account-wide ADDS its allow-listed models and leaves the gateway models on credits', async () => {
  const db = fakeDb({ routes: [deepseek], catalogue });
  const { routes, extra } = await annotateCatalogueRoutes(db, 'u1', { surface: 'xeno-web', modelIds: ['claude-sonnet-5', 'gpt-5.5'] });
  assert.deepEqual(extra.map((e) => e.id).sort(), ['deepseek-chat', 'deepseek-reasoner'], 'the models the key serves and the gateway does not carry');
  assert.equal(routes.get('deepseek-chat').path, 'byok');
  assert.equal(routes.get('deepseek-chat').credential.label, 'deepseek-api');
  assert.equal(routes.get('claude-sonnet-5').path, 'premium', 'the DeepSeek key cannot answer Claude — provider mismatch stays on credits (the 2026-09-17 defect)');
  assert.equal(routes.get('claude-sonnet-5').reason, 'provider-mismatch');
});

test('a first-party key stamps the gateway models of ITS provider as own-key and adds nothing', async () => {
  const openai = { ...deepseek, credential_id: 'cred-oa', provider: 'openai', base_url: null, models: null, label: 'work openai' };
  const db = fakeDb({ routes: [openai], catalogue });
  const { routes, extra } = await annotateCatalogueRoutes(db, 'u1', { surface: 'xeno-web', modelIds: ['claude-sonnet-5', 'gpt-5.5'] });
  assert.equal(extra.length, 0);
  assert.equal(routes.get('gpt-5.5').path, 'byok');
  assert.equal(routes.get('claude-sonnet-5').path, 'premium');
});

test('a product override wins for its surface and the account default answers everywhere else', async () => {
  const override = { ...deepseek, surface: 'xeno-pixel', path: 'premium', mode: 'managed', credential_id: null, provider: null, models: null, credential_status: null };
  const db = fakeDb({ routes: [deepseek, override], catalogue });
  const pixel = await annotateCatalogueRoutes(db, 'u1', { surface: 'xeno-pixel', modelIds: ['gpt-5.5'] });
  assert.equal(pixel.extra.length, 0, 'Pixel is routed to credits, so the key adds nothing there');
  const web = await annotateCatalogueRoutes(db, 'u1', { surface: 'xeno-web', modelIds: ['gpt-5.5'] });
  assert.equal(web.extra.length, 2);
});

test('a revoked or invalid key adds nothing — the picker never offers a model a request would refuse', async () => {
  const db = fakeDb({ routes: [{ ...deepseek, credential_status: 'revoked' }], catalogue });
  const { extra } = await annotateCatalogueRoutes(db, 'u1', { surface: 'xeno-web', modelIds: ['gpt-5.5'] });
  assert.equal(extra.length, 0);
});

test('with no route, or with BYOK off, the list is exactly the gateway list', async () => {
  const none = await annotateCatalogueRoutes(fakeDb({ routes: [], catalogue }), 'u1', { surface: 'xeno-web', modelIds: ['gpt-5.5'] });
  assert.equal(none.extra.length, 0);
  process.env.BYOK_ENABLED = 'false';
  const off = await annotateCatalogueRoutes(fakeDb({ routes: [deepseek], catalogue }), 'u1', { surface: 'xeno-web', modelIds: ['gpt-5.5'] });
  assert.equal(off.extra.length, 0);
  assert.equal(off.routes.size, 0);
  process.env.BYOK_ENABLED = 'true';
});

test('the resolver and the picker share ONE walk — chooseRouteLevel is what both call', () => {
  const svc = src('../src/server/services/providerCredentials.js');
  const resolver = svc.slice(svc.indexOf('export async function resolveInferenceRoute'), svc.indexOf('export async function annotateCatalogueRoutes'));
  const picker = svc.slice(svc.indexOf('export async function annotateCatalogueRoutes'), svc.indexOf('export async function useCredential'));
  assert.match(resolver, /chooseRouteLevel\(levels, model, catalog\)/);
  assert.match(picker, /chooseRouteLevel\(levels, id, catalog\.get\(id\) \|\| null\)/);
  assert.equal((svc.match(/for \(const \[level, row\] of \[\['product-override'/g) || []).length, 1, 'the level walk exists exactly once');
  const walk = chooseRouteLevel({ override: null, accountDefault: deepseek }, 'deepseek-chat', null);
  assert.equal(walk.chosen.credential_id, 'cred-ds');
});

test('merge: the cached gateway object is NOT mutated, every model gains `route`, extras land under the vendor', () => {
  const routes = new Map([
    ['claude-sonnet-5', { path: 'premium', reason: 'provider-mismatch' }],
    ['gpt-5.5', { path: 'premium', reason: 'provider-mismatch' }],
    ['deepseek-chat', { path: 'byok', mode: 'managed', reason: 'account-default', credential: { id: 'cred-ds', provider: 'compatible', label: 'deepseek-api', baseUrl: 'https://api.deepseek.com/v1', status: 'active' } }],
  ]);
  const extra = [{ id: 'deepseek-chat', credential: routes.get('deepseek-chat').credential }];
  const before = JSON.stringify(gateway);
  const merged = mergeCatalogueWithRoutes(gateway, { routes, extra }, { reasoningCapabilityForModel, prettyModelName });
  assert.equal(JSON.stringify(gateway), before, 'the shared cache is untouched — one user\'s keys never leak into the next response');
  assert.deepEqual(Object.keys(merged.companies).sort(), ['Anthropic', 'DeepSeek', 'OpenAI']);
  assert.equal(merged.companies.Anthropic[0].route.path, 'premium');
  const ds = merged.companies.DeepSeek[0];
  assert.equal(ds.id, 'deepseek-chat');
  assert.deepEqual(ds.route, { path: 'byok', mode: 'managed', key: { label: 'deepseek-api', provider: 'compatible', status: 'active' } });
  assert.deepEqual(ds.paths, ['byok'], 'an own-key-only model has no credits path');
  assert.equal(merged.totalCompanies, 3);
  assert.equal(reasoningCapabilityForModel('deepseek-reasoner'), 'alwaysOn', 'the reasoning model is a reasoning model');
});

test('vendor label: host first, then the key\'s label', () => {
  assert.equal(vendorLabelForCredential({ baseUrl: 'https://api.deepseek.com/v1', label: 'deepseek-api' }), 'DeepSeek');
  assert.equal(vendorLabelForCredential({ baseUrl: 'https://api.mistral.ai/v1' }), 'Mistral');
  assert.equal(vendorLabelForCredential({ baseUrl: 'http://192.168.2.10:11434/v1', label: 'ollama' }), 'Local');
  assert.equal(vendorLabelForCredential({ baseUrl: 'https://llm.example.org/v1', label: 'my box' }), 'My box');
  assert.equal(vendorLabelForCredential({ provider: 'openrouter' }), 'Openrouter');
});

test('reachability: both catalogue endpoints fold the account routes in, and the picker shows the tag on every render site', () => {
  const index = src('../src/server/index.js');
  const handler = index.slice(index.indexOf("app.get('/api/models'"), index.indexOf("app.get('/api/test-db'"));
  assert.equal((handler.match(/withAccountRoutes\(req, /g) || []).length, 2, 'the cached branch AND the fresh branch both merge per user');
  assert.match(handler, /modelsCache = result;/, 'only the gateway result is cached');
  const ai = src('../src/server/routes/aiRoutes.js');
  assert.equal((ai.match(/models: await withAccountRoutes\(req, models\)/g) || []).length, 2, '/api/ai/models: live and synced branches');
  const svc = src('../src/services/modelService.ts');
  assert.match(svc, /'x-xeno-surface': 'xeno-web'/, 'the picker names its surface so per-product overrides apply');
  assert.match(svc, /route\?: ModelRoute;/);
  const picker = src('../src/components/playground/Chat/ChatModelSelector.tsx');
  assert.equal((picker.match(/isOwnKeyRoute\(model\) && <OwnKeyTag model=\{model\} \/>/g) || []).length, 3, 'inline chips, desktop tray, mobile sheet');
  assert.match(picker, /data-own-key-route/);
});
