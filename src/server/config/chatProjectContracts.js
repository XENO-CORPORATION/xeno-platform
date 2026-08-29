export const CHAT_PROJECT_CONTRACTS = Object.freeze({
  schemaVersion: 1,
  recurrence: Object.freeze({
    package: 'rrule',
    version: '2.8.1',
    springGap: 'pre_gap_offset',
    fallOverlap: 'first_occurrence',
    maxPreviewOccurrences: 20,
    maxCatchUpRuns: 24,
    maxCatchUpWindowSeconds: 7 * 24 * 60 * 60,
  }),
  retrieval: Object.freeze({
    lexicalRequired: true,
    semanticEnabledByDefault: true,
    embeddingModelId: 'nomic-ai/nomic-embed-text-v1.5',
    embeddingRevision: 'a15734e81021ea6c92b09050d2c7085001db8f36',
    embeddingDimensions: 512,
    embeddingNormalization: 'layer_norm_768_then_truncate_512_then_l2',
    embeddingPooling: 'attention_mask_mean',
    maxEmbeddingBatchSize: 64,
    pgvectorVersion: '0.8.6',
    hnsw: Object.freeze({
      iterativeScan: 'strict_order',
      efSearch: 400,
      maxScanTuples: 100_000,
      scanMemMultiplier: 4,
      reciprocalRankConstant: 60,
      minimumRecallAt12: 0.98,
    }),
  }),
  ingestion: Object.freeze({
    scannerRequired: true,
    scannerMode: process.env.CHAT_ASSET_SCANNER || 'clamav-cli-v1',
    maxExtractedBytes: 20 * 1024 * 1024,
    maxSourceBytes: 100 * 1024 * 1024,
    maxPagesPerAsset: 500,
    maxArchiveEntries: 10_000,
    maxArchiveExpandedBytes: 100 * 1024 * 1024,
    maxCompressionRatio: 100,
    maxImagePixels: 100_000_000,
    maxChunksPerAsset: 10_000,
  }),
  catalogs: Object.freeze({
    connectors: Object.freeze([]),
    plugins: Object.freeze([]),
  }),
  gateway: Object.freeze({
    runKeyHeader: 'x-xeno-run-key',
    ambiguousOutcomePolicy: 'reconciliation_required',
  }),
});

export function assertChatProjectContracts() {
  if (CHAT_PROJECT_CONTRACTS.retrieval.semanticEnabledByDefault
      && (!CHAT_PROJECT_CONTRACTS.retrieval.embeddingModelId
        || !CHAT_PROJECT_CONTRACTS.retrieval.embeddingDimensions)) {
    throw new Error('Semantic retrieval requires a locked embedding model contract');
  }
  if (!CHAT_PROJECT_CONTRACTS.ingestion.scannerRequired) {
    throw new Error('Chat project ingestion cannot disable mandatory scanning');
  }
  return CHAT_PROJECT_CONTRACTS;
}
