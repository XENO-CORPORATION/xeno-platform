import {
  isSemanticStoreQualified,
  probeEmbeddingRuntime,
} from '../services/library/xenoEmbeddingService.js';

function safeCode(error, fallback) {
  const code = String(error?.code || fallback);
  return /^[a-z0-9_]{1,64}$/i.test(code) ? code : fallback;
}

export async function checkChatProjectWorkerDependencies(db, {
  semanticStoreQualified = isSemanticStoreQualified,
  embeddingProbe = probeEmbeddingRuntime,
} = {}) {
  await db.query('SELECT 1');
  const checkedAt = new Date().toISOString();
  const required = await semanticStoreQualified(db);
  let semantic;
  if (!required) {
    semantic = {
      required: false,
      ready: false,
      status: 'disabled',
      code: 'semantic_store_not_qualified',
    };
  } else {
    try {
      semantic = {
        required: true,
        status: 'ready',
        ...await embeddingProbe(),
        ready: true,
      };
    } catch (error) {
      semantic = {
        required: true,
        ready: false,
        status: 'degraded',
        code: safeCode(error, 'embedding_runtime_unavailable'),
      };
    }
  }
  return {
    checkedAt,
    ready: true,
    components: {
      database: { ready: true },
      scheduler: { ready: true },
      lexicalIngestion: { ready: true },
      semantic,
    },
  };
}

export function chatProjectWorkerProbeStatus(pathname, { processReady, dependencies }) {
  if (!processReady || dependencies?.ready !== true) return 503;
  if (pathname === '/ready/semantic') {
    return dependencies.components?.semantic?.ready === true ? 200 : 503;
  }
  return 200;
}
