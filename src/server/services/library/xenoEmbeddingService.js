import { CHAT_PROJECT_CONTRACTS } from '../../config/chatProjectContracts.js';

const contract = CHAT_PROJECT_CONTRACTS.retrieval;

function embeddingEndpoint() {
  const base = String(process.env.XENO_EMBEDDING_BASE_URL || process.env.XENO_RT_BASE_URL || '').trim();
  if (!base) {
    throw Object.assign(new Error('XENO embedding runtime is not configured'), {
      code: 'embedding_runtime_unavailable',
    });
  }
  return `${base.replace(/\/+$/, '')}/v1/embeddings`;
}

function embeddingBaseUrl() {
  const base = String(process.env.XENO_EMBEDDING_BASE_URL || process.env.XENO_RT_BASE_URL || '').trim();
  if (!base) {
    throw Object.assign(new Error('XENO embedding runtime is not configured'), {
      code: 'embedding_runtime_unavailable',
    });
  }
  return base.replace(/\/+$/, '');
}

function assertResponseContract(payload) {
  const observed = payload?.xeno_contract;
  if (payload?.model !== contract.embeddingModelId
      || observed?.revision !== contract.embeddingRevision
      || observed?.output_dimensions !== contract.embeddingDimensions
      || observed?.normalization !== contract.embeddingNormalization
      || observed?.pooling !== contract.embeddingPooling) {
    throw Object.assign(new Error('XENO embedding runtime contract does not match the locked index'), {
      code: 'embedding_contract_mismatch',
    });
  }
}

async function requestEmbeddings(input, task) {
  const response = await fetch(embeddingEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.XENO_EMBEDDING_API_KEY
        ? { Authorization: `Bearer ${process.env.XENO_EMBEDDING_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model: contract.embeddingModelId,
      input,
      task,
      dimensions: contract.embeddingDimensions,
      encoding_format: 'float',
    }),
    signal: AbortSignal.timeout(Number(process.env.XENO_EMBEDDING_TIMEOUT_MS || 10_000)),
  }).catch((cause) => {
    throw Object.assign(new Error('XENO embedding runtime request failed'), {
      code: 'embedding_runtime_unavailable',
      cause,
    });
  });
  if (!response.ok) {
    throw Object.assign(new Error(`XENO embedding runtime returned HTTP ${response.status}`), {
      code: response.status >= 500 ? 'embedding_runtime_unavailable' : 'embedding_request_rejected',
    });
  }
  const payload = await response.json();
  assertResponseContract(payload);
  const vectors = payload.data?.map((entry) => entry.embedding);
  if (!Array.isArray(vectors) || vectors.length !== input.length
      || vectors.some((vector) => !Array.isArray(vector)
        || vector.length !== contract.embeddingDimensions
        || vector.some((value) => !Number.isFinite(value)))) {
    throw Object.assign(new Error('XENO embedding runtime returned an invalid vector batch'), {
      code: 'embedding_invalid_response',
    });
  }
  return vectors;
}

export async function embedQuery(query) {
  return (await requestEmbeddings([String(query || '')], 'query'))[0];
}

export async function embedDocuments(documents) {
  const result = [];
  for (let index = 0; index < documents.length; index += contract.maxEmbeddingBatchSize) {
    const batch = documents.slice(index, index + contract.maxEmbeddingBatchSize);
    result.push(...await requestEmbeddings(batch, 'document'));
  }
  return result;
}

export async function probeEmbeddingRuntime() {
  const response = await fetch(`${embeddingBaseUrl()}/v1/runtime/status`, {
    headers: process.env.XENO_EMBEDDING_API_KEY
      ? { Authorization: `Bearer ${process.env.XENO_EMBEDDING_API_KEY}` }
      : {},
    signal: AbortSignal.timeout(Number(process.env.XENO_EMBEDDING_HEALTH_TIMEOUT_MS || 2_000)),
  }).catch((cause) => {
    throw Object.assign(new Error('XENO embedding runtime readiness request failed'), {
      code: 'embedding_runtime_unavailable',
      cause,
    });
  });
  if (!response.ok) {
    throw Object.assign(new Error(`XENO embedding runtime readiness returned HTTP ${response.status}`), {
      code: 'embedding_runtime_unavailable',
    });
  }
  const payload = await response.json();
  if (payload?.ready !== true
      || payload?.embedding_auth_required !== true
      || payload?.embedding_model !== contract.embeddingModelId
      || payload?.embedding_dimensions !== contract.embeddingDimensions) {
    throw Object.assign(new Error('XENO embedding runtime readiness does not match the locked service boundary'), {
      code: 'embedding_contract_mismatch',
    });
  }
  assertResponseContract({
    model: payload.embedding_model,
    xeno_contract: payload.embedding_contract,
  });
  return {
    ready: true,
    model: payload.embedding_model,
    revision: payload.embedding_contract.revision,
    dimensions: payload.embedding_dimensions,
    authRequired: payload.embedding_auth_required,
  };
}

export function toPgVector(vector) {
  if (!Array.isArray(vector) || vector.length !== contract.embeddingDimensions) {
    throw Object.assign(new Error('Embedding vector does not match the locked dimension'), {
      code: 'embedding_dimension_mismatch',
    });
  }
  return `[${vector.map((value) => Number(value).toString()).join(',')}]`;
}

export async function isSemanticStoreQualified(db) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_extension WHERE extname = 'vector'
     ) AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'library_asset_chunks' AND column_name = 'embedding'
     ) AND EXISTS (
       SELECT 1 FROM chat_embedding_contracts
       WHERE active = TRUE AND model_id = $1 AND revision = $2 AND dimensions = $3
         AND normalization = $4 AND pooling = $5
     ) AS qualified`,
    [
      contract.embeddingModelId,
      contract.embeddingRevision,
      contract.embeddingDimensions,
      contract.embeddingNormalization,
      contract.embeddingPooling,
    ],
  ).catch((error) => {
    if (['42P01', '42703'].includes(error.code)) return { rows: [{ qualified: false }] };
    throw error;
  });
  return rows[0]?.qualified === true;
}
