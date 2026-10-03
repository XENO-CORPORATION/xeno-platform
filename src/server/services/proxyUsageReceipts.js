// Verifies a late-usage correction against the inner xeno-proxy's durable usage receipt.
//
// The proxy is the process that read the provider's own usage block; it files one receipt per
// dispatch id (= the draw's provider_request_id). This verifier FETCHES that receipt itself with a
// dedicated read-only credential. Nothing in the correction request body is ever trusted as a count.
//
// Token mapping is CONSERVATIVE in the payer's disfavour on purpose: a downward correction must never
// refund more than was really overcharged. Claude reports input excluding cache tokens; OpenAI-style
// reports prompt_tokens including them. Billing input as input + cacheRead + cacheCreation can only
// over-count, which only ever shrinks a refund.
const ID = /^[A-Za-z0-9._:-]{8,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const nonNeg = v => Number.isSafeInteger(v) && v >= 0;

export function createProxyReceiptVerifier({ baseUrl, readerKey, fetchImpl = globalThis.fetch, actorService = 'xeno-proxy' } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base || !readerKey) return null; // unconfigured => the correction route stays closed (503)
  return async ({ target, draw, signal }) => {
    if (!draw || draw.state !== 'settled' || draw.outcome !== 'unmeasured' || !ID.test(draw.providerRequestId || '')) return null;
    const res = await fetchImpl(`${base}/v0/usage-receipts/${encodeURIComponent(draw.providerRequestId)}`, {
      headers: { Authorization: `Bearer ${readerKey}` }, signal, redirect: 'error',
    });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error('usage receipt source unavailable'), { code: 'RECEIPT_SOURCE_UNAVAILABLE' });
    const body = await res.json();
    const r = body?.receipt;
    if (body?.certifies !== true || r?.status !== 'completed' || r.dispatchId !== draw.providerRequestId || !HASH.test(body.evidenceHash || '')) return null;
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens']) if (!nonNeg(r[k])) return null;
    return {
      verified: true, correctionSourceId: `proxy:${r.dispatchId}`, providerReceiptId: r.dispatchId,
      providerRequestId: draw.providerRequestId, provider: draw.provider, model: draw.model, actorService,
      evidenceHash: body.evidenceHash,
      inputTokens: r.inputTokens + r.cacheReadTokens + r.cacheCreationTokens, outputTokens: r.outputTokens,
    };
  };
}

// Codes that mean "not yet / not this time", so the draw is retried on a later sweep.
const RETRY_LATER = new Set(['RUN_NOT_TERMINAL', 'RECEIPT_SOURCE_UNAVAILABLE', 'FUNDING_CONFLICT']);

/**
 * Apply proxy receipts to every unmeasured draw still inside the correction window. The ledger is the
 * work queue: a draw qualifies while it is settled unmeasured, has retained consumption evidence, is
 * younger than the window and has no proxy correction yet. Nothing is kept in memory, so a restart
 * loses nothing, and a correction is idempotent per source, so overlapping sweeps are harmless.
 */
export async function reconcileUnmeasuredDraws(pool, verifier, { ledger, limit = 100, signal } = {}) {
  const out = { scanned: 0, corrected: 0, pending: 0, failed: 0 };
  if (typeof verifier !== 'function' || !ledger) return out;
  const { rows } = await pool.query(`SELECT d.admission_id,d.draw_id FROM credit_hold_draws d
      JOIN credit_draw_consumption_receipts r ON r.draw_row_id=d.id
     WHERE d.state='settled' AND d.outcome='unmeasured'
       AND d.resolved_at > clock_timestamp()-make_interval(secs=>$1)
       AND NOT EXISTS (SELECT 1 FROM credit_draw_corrections c WHERE c.draw_row_id=d.id AND c.correction_source_id='proxy:'||d.provider_request_id)
     ORDER BY d.resolved_at LIMIT $2`, [ledger.RUN_DRAW_CORRECTION_WINDOW_SECONDS, limit]);
  for (const row of rows) {
    if (signal?.aborted) break;
    out.scanned++;
    const target = Object.freeze({ admissionId: row.admission_id, drawId: row.draw_id });
    try {
      const draw = Object.freeze(await ledger.readRunDrawDispatchV2(pool, target));
      const receipt = await verifier({ target, draw, signal });
      if (!receipt) { out.pending++; continue; }
      await ledger.correctRunDrawV2(pool, target, receipt);
      out.corrected++;
    } catch (error) {
      if (RETRY_LATER.has(error?.code) || error?.code === 'CORRECTION_NOT_DOWNWARD') out.pending++;
      else { out.failed++; console.error('[DrawReconciler]', row.draw_id, error?.code || error?.message); }
    }
  }
  return out;
}

/** Production wiring: both settings or nothing. */
export function proxyReceiptVerifierFromEnv(env = process.env) {
  return createProxyReceiptVerifier({ baseUrl: env.XENO_USAGE_RECEIPT_URL, readerKey: env.XENO_USAGE_RECEIPT_READER_KEY });
}
