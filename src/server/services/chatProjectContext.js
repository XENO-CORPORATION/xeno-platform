import crypto from 'crypto';
import { requireResourceRelation } from './chatProjectAuthority.js';
import { retrieveAuthorizedAssetChunks } from './library/assetRetrievalService.js';

export async function assembleProjectContext({
  db,
  principal,
  projectId,
  conversationId,
  query,
  modelId,
  maxInputTokens = 16_000,
  requiredRelation = 'viewer',
}) {
  await requireResourceRelation(db, principal, 'project', projectId, requiredRelation);
  await requireResourceRelation(db, principal, 'conversation', conversationId, requiredRelation);
  const project = (await db.query(
    `SELECT id, name, custom_instructions, instructions_revision, updated_at
     FROM chat_projects WHERE id = $1 AND is_archived = FALSE`,
    [projectId],
  )).rows[0];
  if (!project) throw Object.assign(new Error('Project not found'), { code: 'project_not_found' });

  const reserved = Math.min(Math.max(2_000, Math.ceil(maxInputTokens * 0.45)), maxInputTokens);
  let available = Math.max(0, maxInputTokens - reserved);
  const retrievalResult = await retrieveAuthorizedAssetChunks(db, { principal, projectId, query, limit: 24 });
  const candidates = retrievalResult.chunks;
  const selected = [];
  for (const chunk of candidates) {
    if (chunk.token_count > available) continue;
    available -= chunk.token_count;
    selected.push(chunk);
  }
  const contentBlocks = selected.map((chunk, index) => ({
    type: 'untrusted_project_source',
    asset_id: chunk.asset_id,
    chunk_id: chunk.id,
    locator: chunk.source_locator,
    content: JSON.stringify({
      source_number: index + 1,
      asset_id: chunk.asset_id,
      chunk_id: chunk.id,
      ordinal: chunk.ordinal,
      locator: chunk.source_locator,
      content: chunk.content,
    }),
  }));
  const manifest = {
    schema_version: 1,
    project_id: project.id,
    conversation_id: conversationId,
    model_id: modelId,
    instructions_revision: Number(project.instructions_revision),
    instructions_digest: crypto.createHash('sha256').update(project.custom_instructions || '').digest('hex'),
    sources: selected.map((chunk) => ({
      asset_id: chunk.asset_id,
      chunk_id: chunk.id,
      ordinal: chunk.ordinal,
      locator: chunk.source_locator,
      display_name: chunk.display_name,
      mime_type: chunk.mime_type || 'application/octet-stream',
      digest: crypto.createHash('sha256').update(chunk.content).digest('hex'),
      token_count: chunk.token_count,
    })),
    token_allocation: { max_input: maxInputTokens, reserved, retrieval: maxInputTokens - reserved - available },
    semantic_status: retrievalResult.diagnostic.semantic_status,
    semantic_diagnostic: retrievalResult.diagnostic,
  };
  return {
    instructions: project.custom_instructions || '',
    instructionRevision: Number(project.instructions_revision),
    contentBlocks,
    manifest,
  };
}
