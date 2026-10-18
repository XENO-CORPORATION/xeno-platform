/**
 * What one streamed upstream call owes, decided from what it actually produced.
 *
 * 🔴 Found 2026-10-18: four Claude Opus 5 tool-loop calls failed upstream with no
 * output and no usage chunk, and each settled at its full reservation (13.1 credits for
 * ~20 input tokens). The tool loop records a call's usage in a `finally`, so a call that
 * died before producing anything still had `inputTokens` = the caller-side estimate, and
 * "input > 0" was read as "this call consumed something" — with no provider count, the
 * meter then charged the reserved worst case.
 *
 * The worst-case rule exists for ONE situation: the provider produced output and did not
 * say how much. A call with no provider count AND no output produced nothing we can show,
 * so it is voided.
 *
 *   'measured' — the provider reported output usage: charge exactly that.
 *   'unmeasured' — output was produced but never counted: charge the reservation.
 *   'void'     — nothing was produced and nothing was counted: release the reservation.
 */
export function streamCallSettlement(used) {
  if (!used) return 'void';
  if (used.hasOutputUsage !== false) {
    return (Number(used.outputTokens) > 0 || Number(used.inputTokens) > 0) ? 'measured' : 'void';
  }
  return Number(used.outputTokens) > 0 ? 'unmeasured' : 'void';
}

export default streamCallSettlement;
