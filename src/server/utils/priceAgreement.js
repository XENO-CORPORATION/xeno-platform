/**
 * Does a Stripe Price agree with the catalogue entry that advertises it?
 *
 * Pure, so it is testable with no Stripe account, no network and no env — which
 * matters because the interesting cases here are ones you cannot conveniently
 * create in a real dashboard on demand (an archived price, a recurring credit
 * pack, a monthly price on an annual item).
 *
 * 🔴 The failure this exists to catch is QUIET. `billingService.getPublicCatalog()`
 * overlays the LIVE Stripe amount onto the static catalogue so the advertised
 * price always equals the charged price. That is the right design, and it has a
 * consequence: a price env pointing at the wrong Stripe Price does not error and
 * does not mismatch — it silently RE-PRICES the product, everywhere, correctly
 * and consistently, at a number nobody chose.
 *
 * So the check cannot be "does the page match the charge". It has to be "does
 * the charge match what a human decided", and the catalogue is that record.
 */

/**
 * @param {{id:string, kind:'credits'|'subscription', price:number, currency:string, interval?:string}} item
 * @param {{active?:boolean, unit_amount?:number, currency?:string, type?:string, recurring?:{interval?:string}}} price
 * @returns {string[]} human-readable problems; empty means they agree
 */
export function priceIssues(item, price) {
  const issues = [];
  if (!price) return ['does not resolve to a Stripe Price'];

  /* Stripe's `active:false` still retrieves fine, so an archived price is a
   * silent 400 at checkout rather than a visible misconfiguration. */
  if (price.active === false) issues.push('the Price is ARCHIVED in Stripe');

  const expected = Math.round(item.price * 100);
  if (price.unit_amount !== expected) {
    issues.push(
      `charges ${(price.unit_amount / 100).toFixed(2)} but the catalogue advertises ${item.price.toFixed(2)}`,
    );
  }
  if (price.currency !== item.currency) {
    issues.push(`is in ${String(price.currency).toUpperCase()} but the catalogue says ${String(item.currency).toUpperCase()}`);
  }

  if (item.kind === 'subscription') {
    if (price.type !== 'recurring') {
      issues.push('is a ONE-TIME price on a subscription item — the plan would never renew');
    } else if (item.interval && price.recurring?.interval !== item.interval) {
      issues.push(`renews ${price.recurring?.interval}ly but the catalogue says ${item.interval}ly`);
    }
  } else if (price.type !== 'one_time') {
    /* The mirror image, and the more expensive one: a credit pack on a recurring
     * price bills the customer again every month for a one-off purchase. */
    issues.push('is RECURRING on a credit pack — buyers would be billed again every period');
  }

  return issues;
}
