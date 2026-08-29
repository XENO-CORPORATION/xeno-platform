import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CHAT_PROJECT_CONTRACTS } from '../src/server/config/chatProjectContracts.js';
import { probeEmbeddingRuntime } from '../src/server/services/library/xenoEmbeddingService.js';
import {
  checkChatProjectWorkerDependencies,
  chatProjectWorkerProbeStatus,
} from '../src/server/workers/chatProjectWorkerReadiness.js';
import {
  activeChatWorkerNames,
  resolveChatWorkerActivation,
} from '../src/server/workers/chatWorkerActivation.js';

const db = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const retrieval = CHAT_PROJECT_CONTRACTS.retrieval;

test('scheduler and ingestion are explicit opt-ins for staged production enablement', () => {
  assert.deepEqual(resolveChatWorkerActivation({}), { scheduler: false, ingestion: false });
  assert.deepEqual(
    resolveChatWorkerActivation({ CHAT_INGESTION_ENABLED: 'true' }),
    { scheduler: false, ingestion: true },
  );
  const enabled = resolveChatWorkerActivation({
    CHAT_SCHEDULER_ENABLED: '1',
    CHAT_INGESTION_ENABLED: 'yes',
  });
  assert.deepEqual(enabled, { scheduler: true, ingestion: true });
  assert.deepEqual(activeChatWorkerNames(enabled), ['scheduled-chat', 'library-ingestion']);
});

async function withEmbeddingProbe({ apiKey = 'worker-secret', response }, assertion) {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.XENO_EMBEDDING_BASE_URL;
  const originalKey = process.env.XENO_EMBEDDING_API_KEY;
  let request;
  process.env.XENO_EMBEDDING_BASE_URL = 'http://embedding.internal:8099';
  if (apiKey == null) delete process.env.XENO_EMBEDDING_API_KEY;
  else process.env.XENO_EMBEDDING_API_KEY = apiKey;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return response;
  };
  try {
    await assertion(() => request);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase == null) delete process.env.XENO_EMBEDDING_BASE_URL;
    else process.env.XENO_EMBEDDING_BASE_URL = originalBase;
    if (originalKey == null) delete process.env.XENO_EMBEDDING_API_KEY;
    else process.env.XENO_EMBEDDING_API_KEY = originalKey;
  }
}

function healthyRuntimePayload(overrides = {}) {
  return {
    ready: true,
    embedding_auth_required: true,
    embedding_model: retrieval.embeddingModelId,
    embedding_dimensions: retrieval.embeddingDimensions,
    embedding_contract: {
      revision: retrieval.embeddingRevision,
      output_dimensions: retrieval.embeddingDimensions,
      normalization: retrieval.embeddingNormalization,
      pooling: retrieval.embeddingPooling,
    },
    ...overrides,
  };
}

test('embedding outage keeps scheduler and lexical ingestion ready while semantic fails closed', async () => {
  const dependencies = await checkChatProjectWorkerDependencies(db, {
    semanticStoreQualified: async () => true,
    embeddingProbe: async () => {
      throw Object.assign(new Error('offline'), { code: 'embedding_runtime_unavailable' });
    },
  });
  assert.equal(dependencies.ready, true);
  assert.deepEqual(dependencies.components.database, { ready: true });
  assert.deepEqual(dependencies.components.scheduler, { ready: true });
  assert.deepEqual(dependencies.components.lexicalIngestion, { ready: true });
  assert.deepEqual(dependencies.components.semantic, {
    required: true,
    ready: false,
    status: 'degraded',
    code: 'embedding_runtime_unavailable',
  });
  assert.equal(chatProjectWorkerProbeStatus('/ready', { processReady: true, dependencies }), 200);
  assert.equal(chatProjectWorkerProbeStatus('/ready/semantic', { processReady: true, dependencies }), 503);
});

test('unqualified semantic schema is explicit and cannot satisfy the semantic release probe', async () => {
  const dependencies = await checkChatProjectWorkerDependencies(db, {
    semanticStoreQualified: async () => false,
    embeddingProbe: async () => assert.fail('runtime must not be probed without a qualified store'),
  });
  assert.deepEqual(dependencies.components.semantic, {
    required: false,
    ready: false,
    status: 'disabled',
    code: 'semantic_store_not_qualified',
  });
  assert.equal(chatProjectWorkerProbeStatus('/ready', { processReady: true, dependencies }), 200);
  assert.equal(chatProjectWorkerProbeStatus('/ready/semantic', { processReady: true, dependencies }), 503);
});

test('the semantic release probe opens only for the locked healthy runtime contract', async () => {
  const dependencies = await checkChatProjectWorkerDependencies(db, {
    semanticStoreQualified: async () => true,
    embeddingProbe: async () => ({
      ready: true,
      model: 'nomic-ai/nomic-embed-text-v1.5',
      revision: 'locked',
      dimensions: 512,
      authRequired: true,
    }),
  });
  assert.equal(dependencies.components.semantic.status, 'ready');
  assert.equal(dependencies.components.semantic.ready, true);
  assert.equal(chatProjectWorkerProbeStatus('/ready/semantic', { processReady: true, dependencies }), 200);
});

test('database loss closes every worker readiness surface', async () => {
  await assert.rejects(
    checkChatProjectWorkerDependencies({ query: async () => { throw Object.assign(new Error('db down'), { code: 'ECONNREFUSED' }); } }),
    /db down/,
  );
  assert.equal(chatProjectWorkerProbeStatus('/ready', { processReady: true, dependencies: null }), 503);
});

test('runtime probe sends the service credential and validates the complete locked contract', async () => {
  await withEmbeddingProbe({
    response: { ok: true, status: 200, json: async () => healthyRuntimePayload() },
  }, async (getRequest) => {
    const result = await probeEmbeddingRuntime();
    assert.equal(result.ready, true);
    assert.equal(result.authRequired, true);
    assert.equal(getRequest().url, 'http://embedding.internal:8099/v1/runtime/status');
    assert.equal(getRequest().init.headers.Authorization, 'Bearer worker-secret');
  });
});

test('missing runtime credentials and runtime/database contract drift fail semantic readiness', async () => {
  await withEmbeddingProbe({
    apiKey: null,
    response: { ok: false, status: 401, json: async () => ({}) },
  }, async () => {
    await assert.rejects(probeEmbeddingRuntime(), { code: 'embedding_runtime_unavailable' });
  });
  await withEmbeddingProbe({
    response: {
      ok: true,
      status: 200,
      json: async () => healthyRuntimePayload({
        embedding_contract: {
          ...healthyRuntimePayload().embedding_contract,
          revision: 'drifted-revision',
        },
      }),
    },
  }, async () => {
    await assert.rejects(probeEmbeddingRuntime(), { code: 'embedding_contract_mismatch' });
  });
});

test('deployment passes embedding URL, credential, and both timeouts to backend and workers', () => {
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  for (const variable of [
    'XENO_EMBEDDING_BASE_URL',
    'XENO_EMBEDDING_API_KEY',
    'XENO_EMBEDDING_TIMEOUT_MS',
    'XENO_EMBEDDING_HEALTH_TIMEOUT_MS',
  ]) {
    assert.equal((compose.match(new RegExp(`- ${variable}=`, 'g')) || []).length, 2, `${variable} must reach backend and chat-workers`);
  }
  assert.match(compose, /CHAT_SCHEDULER_ENABLED=\$\{CHAT_SCHEDULER_ENABLED:-0\}/);
  assert.match(compose, /CHAT_INGESTION_ENABLED=\$\{CHAT_INGESTION_ENABLED:-0\}/);
});
