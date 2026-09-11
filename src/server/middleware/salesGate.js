/**
 * Sales gate — the ONE place that decides whether this server may take money.
 *
 * WHY IT EXISTS. Live Stripe is fully provisioned (catalog, prices, portal,
 * webhook, account binding), and provisioning is irreversible-ish: pulling the
 * live keys to "turn sales off" would also break the billing portal existing
 * customers cancel through, break webhook signature verification, and unbind the
 * account — then have to be reassembled correctly under pressure. Being *able to*
 * take money and *choosing to* are different facts, and only the second one
 * should be a switch.
 *
 * 🔴 WHY IN THE SERVICE AND NOT ON THE ROUTES. There are TWO functions that
 * create a Stripe Checkout Session, and they are reached from DIFFERENT route
 * files:
 *
 *   createCheckout               ← routes/billingRoutes.js   (has requireEnabled)
 *   createWorkspaceSeatCheckout  ← routes/workspaceRoutes.js (has no such guard)
 *
 * Gating the billing routes would therefore have left the Team seat path — the
 * most expensive item on the price list — selling. That is exactly the failure
 * `registrationGate.js` was built to stop ("two closed doors and one open one"),
 * and the same shape as the approval bypass in xeno-post where two of three
 * paths called the gate. **Gate the choke point every path must pass, then
 * ASSERT THE COVERAGE SET** — scripts/sales-gate.test.mjs fails if any function
 * that creates a checkout session does not call assertSalesOpen().
 *
 * FAIL-CLOSED. Sales are CLOSED unless SALES_OPEN is the exact string 'true'.
 * Missing, empty, misspelled, 'TRUE', '1', or accidentally cleared all resolve
 * to CLOSED. The asymmetry is deliberate and is the whole point: an outage that
 * stops sales is recoverable, an env var that silently starts charging cards is
 * not. Same posture as REGISTRATION_OPEN and as the ecosystem's signing
 * resolver, which resolves to `unsigned` on any ambiguity.
 *
 *   SALES_OPEN=true              → checkout works, money moves
 *   SALES_OPEN unset / anything  → checkout refuses 503 `sales_closed`
 *
 * ⚠️ WHAT THIS DOES **NOT** CLOSE, deliberately:
 *   - the billing PORTAL. That is how an existing customer cancels, updates a
 *     card and downloads invoices. Trapping paying customers to stop new sales
 *     would be a worse outcome than the one being prevented.
 *   - the WEBHOOK. Stripe retries for days; an in-flight payment must still
 *     settle, grant its credits and send its receipt even with sales closed.
 *   - metering/consumption of credits somebody already bought.
 *
 * ⚠️ SETTING IT IN `.env` IS NOT ENOUGH. docker-compose reads `.env` for `${}`
 * SUBSTITUTION only — a value that is not also forwarded in the service's
 * `environment:` block reaches no container. That exact gap silently disabled
 * REGISTRATION_OPEN, RESEND_API_KEY and all five STRIPE_* keys on 2026-08-24.
 * Verify with `docker exec <container> printenv | grep SALES_OPEN`, never by
 * grepping `.env`.
 */

/** Thrown when the server is configured not to sell. Routes map it to 503. */
export class SalesClosedError extends Error {
  constructor() {
    super('Purchases are not open on this server yet');
    this.name = 'SalesClosedError';
    this.code = 'sales_closed';
    /* Both spellings on purpose: billingRoutes reads `err.status`, the auth
     * middleware family reads `err.statusCode`. Setting one leaves the other
     * path answering 500 — a server error — for a deliberate policy refusal. */
    this.status = 503;
    this.statusCode = 503;
  }
}

/**
 * Is this server allowed to take money right now?
 * @param {NodeJS.ProcessEnv} [env] injectable for tests; never read implicitly elsewhere.
 */
export function salesOpen(env = process.env) {
  return env?.SALES_OPEN === 'true';
}

/** Throws SalesClosedError unless sales are explicitly open. */
export function assertSalesOpen(env = process.env) {
  if (!salesOpen(env)) throw new SalesClosedError();
}

/** Express guard for routes that must not run at all while sales are closed. */
export function requireSalesOpen(req, res, next) {
  if (!salesOpen()) {
    return res.status(503).json({
      success: false,
      error: 'Purchases are not open on this server yet',
      code: 'sales_closed',
    });
  }
  next();
}
