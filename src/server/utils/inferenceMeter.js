/**
 * inferenceMeter — the ONE way premium inference is charged. Wraps a provider
 * call in the creditLedgerV2 two-phase flow (hold the worst-case cost → run the
 * provider → settle the actual cost / void on failure). Reused by the chat route
 * and by the image/video endpoints so every premium spend meters identically and
 * the money journal stays single-writer (see credit-metering map + Arch §4.7).
 *
 * Why hold→settle and not check-then-charge: an LLM's real cost is only known
 * AFTER the response (token counts), and settleHoldV2 CLAMPS the charge to the
 * held amount — so we must reserve the worst case up front (max_tokens as output)
 * or we under-charge, and the reservation also prevents oversell across concurrent
 * requests during the provider call.
 */
import {
  holdV2, settleHoldV2, voidHoldV2, deterministicTxnId, MICRO_PER_CREDIT,
} from './creditLedgerV2.js';
import { getChatCostMicro, estimateChatCostMicro } from './creditCosts.js';

/**
 * Bounded retry with small linear backoff. Makes the streaming settle/void resilient
 * to a transient ledger/DB blip so a failed FIRST attempt does not leave the hold to
 * expire. Single-shot idempotency is enforced by the caller's `done` guard (flipped
 * BEFORE the first attempt), so a retry can never double-charge; settleHoldV2/voidHoldV2
 * are themselves idempotent (they no-op once the hold is not 'held').
 */
async function withRetry(fn, { attempts = 3, baseMs = 50 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
    }
  }
  throw lastErr;
}

/** Map a ledger error code to an HTTP-shaped error the route can return directly. */
function meteringError(code) {
  if (code === 'INSUFFICIENT_CREDITS') {
    const e = new Error('Insufficient credits'); e.code = code; e.http = 402; return e;
  }
  if (code === 'ACCOUNT_FROZEN') {
    const e = new Error('Account frozen'); e.code = code; e.http = 403; return e;
  }
  const e = new Error('Metering failed'); e.code = code || 'METERING_ERROR'; e.http = 500; return e;
}

/**
 * Meter a premium CHAT completion.
 *
 * @param db pg pool (req.db)
 * @param userId uuid (req.user.id)
 * @param opts {
 *   model, provider, requestId,          // requestId → deterministic, idempotent hold
 *   estInputTokens, maxTokens,           // for the worst-case hold estimate
 *   run: async () => providerResponse    // MUST return { usage:{prompt_tokens,completion_tokens,total_tokens}, ... }
 * }
 * @returns { result, costMicro, creditsCharged, holdId }
 * @throws  err with err.http (402/403/500) on metering failure; provider errors bubble up after the hold is voided.
 */
export async function meterPremiumChat(db, userId, opts) {
  const {
    model, provider, requestId,
    estInputTokens = 0, maxTokens = 1024, run,
  } = opts;

  const holdId = deterministicTxnId(userId, requestId, model).slice(0, 64);
  const estimateMicro = estimateChatCostMicro(model, {
    inputTokens: estInputTokens,
    maxOutputTokens: maxTokens,
  });

  // Phase 1 — reserve worst-case cost. INSUFFICIENT_CREDITS → 402 before we spend
  // a cent on the provider. Idempotent on holdId so client retries don't stack holds.
  try {
    await holdV2(db, userId, {
      holdId,
      amountMicro: estimateMicro,
      surface: 'ai_chat',
      operation: 'chat.completion',
      expiresInSeconds: 900,
    });
  } catch (e) {
    throw meteringError(e.code);
  }

  // Run the provider. Any failure → void the hold (full refund) and bubble up.
  let result;
  try {
    result = await run();
  } catch (e) {
    await voidHoldV2(db, userId, holdId).catch(() => {});
    throw e;
  }

  // Phase 2 — settle the ACTUAL token cost (clamped to the hold; the remainder is
  // released). Best-effort: a settle failure must not fail the user's completion,
  // but it does leave the hold to expire (900s) rather than charging.
  const usage = result?.usage || {};
  const inputTokens = usage.prompt_tokens ?? estInputTokens;
  const hasOutputUsage = usage.completion_tokens != null || usage.total_tokens != null;
  const outputTokens = usage.completion_tokens
    ?? (usage.total_tokens != null ? Math.max(0, usage.total_tokens - (usage.prompt_tokens || 0)) : 0);
  // If the provider did not report output tokens, the real cost is unknowable —
  // charge the worst-case we already reserved (max_tokens as output) rather than
  // billing a full completion as zero output (output is ~4× input cost).
  const actualMicro = hasOutputUsage
    ? getChatCostMicro(model, { inputTokens, outputTokens })
    : estimateMicro;

  let costMicro = Math.min(actualMicro, estimateMicro);
  try {
    const settled = await settleHoldV2(db, userId, holdId, actualMicro);
    costMicro = settled?.settledMicro ?? costMicro;
  } catch {
    // leave hold to expire; do not fail the response
  }

  return {
    result,
    costMicro,
    creditsCharged: costMicro / MICRO_PER_CREDIT,
    holdId,
    meteredTokens: { inputTokens, outputTokens, provider, model },
  };
}

/**
 * Meter a premium STREAMING chat completion.
 *
 * Streaming inverts control: the provider call is not a single awaited response we
 * can wrap, it is a long-lived SSE loop the ROUTE drives. So instead of running the
 * provider for the caller, this places the worst-case hold up front (Phase 1 — same
 * INSUFFICIENT_CREDITS→402 discipline as meterPremiumChat) and hands back a small
 * controller the route settles/voids EXACTLY ONCE when the stream resolves:
 *
 *   - normal completion → controller.settle({ inputTokens, outputTokens }) with the
 *     real usage from the upstream `usage` chunk (charge CLAMPED to the hold);
 *   - client disconnect / upstream error mid-stream → settle best-effort from the
 *     tokens seen so far, OR controller.voidHold() if nothing streamed.
 *
 * The controller is single-shot (`settled` guard) so the hold is never double-settled
 * and never left open: whichever of settle/voidHold fires first wins, later calls no-op.
 * settleHoldV2/voidHoldV2 are themselves idempotent, so this is belt-and-suspenders.
 *
 * @param db pg pool (req.db)
 * @param userId uuid (req.user.id)
 * @param opts { model, provider, requestId, estInputTokens, maxTokens }
 * @returns { holdId, estimateMicro, settled:boolean, settle(fn), voidHold() }
 * @throws  err with err.http (402/403/500) if the Phase-1 hold fails (BEFORE any stream).
 */
export async function meterPremiumChatStream(db, userId, opts) {
  const {
    model, provider, requestId,
    estInputTokens = 0, maxTokens = 1024,
  } = opts;

  const holdId = deterministicTxnId(userId, requestId, model).slice(0, 64);
  const estimateMicro = estimateChatCostMicro(model, {
    inputTokens: estInputTokens,
    maxOutputTokens: maxTokens,
  });

  // Phase 1 — reserve worst-case cost BEFORE opening the stream. A failure here is
  // a normal HTTP error (402/403) the route returns before switching to SSE.
  // SHORT expiry (120s, not 900s): streaming settles/voids the hold the instant the
  // stream resolves, so if a settle ultimately fails the reserve frees fast instead
  // of locking the user's balance for 15 minutes.
  try {
    await holdV2(db, userId, {
      holdId,
      amountMicro: estimateMicro,
      surface: 'ai_chat',
      operation: 'chat.completion.stream',
      expiresInSeconds: 120,
    });
  } catch (e) {
    throw meteringError(e.code);
  }

  let done = false; // single-shot guard: settle XOR void, exactly once

  /**
   * Phase 2 — settle the ACTUAL cost (clamped to the hold). `hasOutputUsage=false`
   * means the provider never reported output tokens → charge the reserved worst case
   * rather than billing a real completion as zero output (same rule as meterPremiumChat).
   */
  async function settle({ inputTokens, outputTokens = 0, hasOutputUsage = true } = {}) {
    if (done) return { alreadySettled: true, costMicro: 0, creditsCharged: 0 };
    done = true;
    const inTok = inputTokens ?? estInputTokens;
    const actualMicro = hasOutputUsage
      ? getChatCostMicro(model, { inputTokens: inTok, outputTokens: outputTokens || 0 })
      : estimateMicro;
    let costMicro = Math.min(actualMicro, estimateMicro);
    try {
      const settled = await withRetry(() => settleHoldV2(db, userId, holdId, actualMicro));
      costMicro = settled?.settledMicro ?? costMicro;
    } catch {
      // All retries failed — leave the hold to expire (short 120s stream expiry)
      // rather than failing the user's stream. `done` is already set, so this is final.
    }
    return {
      costMicro,
      creditsCharged: costMicro / MICRO_PER_CREDIT,
      inputTokens: inTok,
      outputTokens: outputTokens || 0,
      provider,
      model,
    };
  }

  /** Release the hold without charging (nothing usable streamed). */
  async function voidHold() {
    if (done) return;
    done = true;
    await withRetry(() => voidHoldV2(db, userId, holdId)).catch(() => {});
  }

  return {
    holdId,
    estimateMicro,
    get settled() { return done; },
    settle,
    voidHold,
  };
}
