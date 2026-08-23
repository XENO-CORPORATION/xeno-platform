/**
 * recordInferenceUsage — write a usage row that is NOT a credit charge.
 *
 * Spec D4: BYOK still records usage. cost_micro is 0, always, for this
 * helper. Premium continues to go through creditLedgerV2, which writes its
 * own row. Do not call this from a metered path — that would double-count.
 */

export async function recordInferenceUsage(db, userId, event) {
  const costMicro = 0;
  await db.query(
    `INSERT INTO api_usage_logs
       (user_id, surface, operation, model, provider, actual_cost_micro, estimated_cost_micro,
        input_tokens, output_tokens, status, request_id, endpoint, method, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,'ok',$9,$10,'POST', now())`,
    [
      userId,
      event.surface,
      event.operation || 'chat.completion',
      event.model ?? null,
      event.provider ?? null,
      String(costMicro),
      event.inputTokens ?? 0,
      event.outputTokens ?? 0,
      event.requestId ?? null,
      event.endpoint || '/api/ai/chat',
    ],
  );
}

export default { recordInferenceUsage };
