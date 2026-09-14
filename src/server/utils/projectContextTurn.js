/**
 * Project context for a chat turn: assemble it, record it, and close the record afterwards.
 *
 * ## What this is
 *
 * A project-backed conversation grounds each answer in the project's own documents. Before
 * the model runs, the relevant sources are assembled and the exact inputs are RECORDED; after
 * it answers, the record is closed with a hash of what came back. That pair is an audit trail:
 * for any project answer it can be shown which sources were in context and that the response
 * has not been altered since.
 *
 * 🔴 EXTRACTED (2026-09-14) so `/api/ai/chat/stream` can serve project conversations. It lived
 * only in `/api/chat/generate`, and a route without it would answer project questions from
 * the model's own knowledge with no sources and no record — confidently, and wrongly, with
 * nothing in the audit trail to show it happened.
 *
 * ## The two halves, and why they are one module
 *
 * `openProjectContextTurn` writes a row with the request hash and leaves `response_hash` NULL.
 * `closeProjectContextTurn` fills it in. A row that is opened and never closed is a turn that
 * started and did not finish — which is INFORMATION, not corruption, and is why the close is a
 * separate UPDATE rather than one write at the end.
 *
 * ⚠️ The close is guarded on `request_hash` AND `response_hash IS NULL`, so it can only ever
 * complete the row it opened, and only once. Two turns racing on one conversation cannot
 * overwrite each other's record, and a retry cannot re-close a settled one.
 */
import { randomUUID, createHash } from 'crypto';

/**
 * Assemble project context and open its audit record.
 *
 * @param {object} o
 * @param {object} o.db              pg pool
 * @param {string} o.userId
 * @param {string} o.projectId
 * @param {string} o.conversationId  REQUIRED — `chat_generation_contexts.conversation_id` is
 *                                   NOT NULL, so there is nowhere to record a project turn
 *                                   without one. The caller refuses before reaching here.
 * @param {Array}  o.messages        the full turn, hashed so the record pins its exact inputs
 * @param {string} o.selectedModelId
 * @param {function} o.assemble      `assembleProjectContext`, injected so this is testable
 *                                   without a database or a live project
 * @returns {Promise<{context: object, recordId: string, requestHash: string}>}
 * @throws the assembler's error, carrying `status`/`code` for the caller to map
 */
export async function openProjectContextTurn({
  db, userId, projectId, conversationId, messages, selectedModelId, assemble,
}) {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  // The client's parts[] shape, or a plain OpenAI string — both reach this route.
  const query = Array.isArray(lastUser?.parts)
    ? (lastUser.parts.find((part) => part.type === 'text')?.text || '')
    : (typeof lastUser?.content === 'string' ? lastUser.content : '');

  const context = await assemble({
    db,
    principal: { type: 'user', id: userId },
    projectId,
    conversationId,
    query,
    modelId: selectedModelId,
    maxInputTokens: 16_000,
    requiredRelation: 'reviewer',
  });

  const recordId = randomUUID();
  /*
   * The hash covers the WHOLE turn — conversation, project, model, query and every message.
   * Hashing only the query would let two different conversations produce the same request
   * hash, and the close below keys on it.
   */
  const requestHash = createHash('sha256').update(JSON.stringify({
    conversationId, projectId, modelId: selectedModelId, query, messages,
  })).digest('hex');

  await db.query(
    `INSERT INTO chat_generation_contexts(
       id, conversation_id, project_id, user_id, request_hash, context_manifest, safe_sources
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      recordId, conversationId, projectId, userId, requestHash,
      JSON.stringify(context.manifest),
      JSON.stringify(context.manifest.sources),
    ],
  );

  return { context, recordId, requestHash };
}

/**
 * Close the record with a hash of the answer.
 *
 * ⚠️ Guarded on `request_hash` and `response_hash IS NULL`: it can only complete the row it
 * opened, and only once. Without the NULL check a retry would silently rewrite the recorded
 * answer for a turn that already settled — which is exactly the thing an audit trail exists
 * to make impossible.
 */
export async function closeProjectContextTurn({ db, recordId, requestHash, responseText }) {
  const responseHash = createHash('sha256').update(String(responseText || '')).digest('hex');
  await db.query(
    `UPDATE chat_generation_contexts SET response_hash=$2
     WHERE id=$1 AND request_hash=$3 AND response_hash IS NULL`,
    [recordId, responseHash, requestHash],
  );
  return responseHash;
}
