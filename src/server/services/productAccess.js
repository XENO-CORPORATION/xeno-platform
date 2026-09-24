/**
 * May THIS account use THIS product? — the door's question, answered per product.
 *
 * ── WHERE IT SITS ───────────────────────────────────────────────────────────
 *
 * Every XENO desktop app puts the same door in front of itself (XENO AUTH - AUTH
 * GATE DELTA §9): the app's main process asks `/api/billing/entitlements`, naming
 * itself in `X-Xeno-Client`, and renders nothing until the answer is yes. This
 * module is that answer. The app never decides it, so changing who may use a
 * product is a row in `product_access_policy`, not a release.
 *
 * ── TWO QUESTIONS THAT MUST STAY SEPARATE ───────────────────────────────────
 *
 *   entitlements.canUse   may this account call OUR SERVERS (fair-use API, etc.)
 *   product.allowed       may this account open THIS PRODUCT
 *
 * `canUse` is left exactly as it was. Folding the product decision into it would
 * change what every other caller of `canUse` means — the in-house quota, the chat
 * routes — to answer a question only the door asks.
 *
 * ── FAIL DIRECTION ──────────────────────────────────────────────────────────
 *
 * 🔴 This is a PAYMENT control, so an unreadable policy table does not quietly
 * admit everyone. It throws; the route answers 500; and the licence client treats
 * a 5xx as OUR fault — the person keeps their offline grace (LICENCE-ENFORCEMENT
 * §4). That is the opposite direction to the version floor, deliberately: the
 * floor is a deprecation control and fails open.
 *
 * No cache: the door is asked at launch and every six hours, so volume is tiny,
 * and revoking access should take effect on the next check — the same property
 * the download grant has ("the entitlement is re-checked per mint").
 */
import { identifyClient } from './clientVersion.js';

export const ACCESS_LEVELS = Object.freeze(['account', 'paid-plan']);

/** The policy row for one product, or null. Throws if the table cannot be read. */
export async function loadProductPolicy(db, product) {
  if (!product) return null;
  const r = await db.query(
    'SELECT product, access, message FROM product_access_policy WHERE product = $1',
    [product],
  );
  return r.rows[0] || null;
}

/**
 * PURE. The verdict for one product, given the account's resolved entitlements.
 *
 *   no row      → `canUse`, unchanged — a product nobody has configured behaves as it
 *                 always did
 *   account     → yes: the caller is authenticated, and suspension was already refused
 *                 before any route ran (middleware/suspensionGate.js)
 *   paid-plan   → an active paid or staff plan. 🔴 Read from `canDownload`, the SAME flag
 *                 the download gate reads, so "paid" has one definition in the platform
 *                 rather than two that can drift apart
 *   anything else in the column → no. A value this code does not understand is not
 *                 permission; the CHECK constraint makes it unreachable, and this makes
 *                 it harmless if the constraint is ever dropped
 */
export function evaluateProductAccess({ product, policy, entitlements }) {
  if (!product) return null;
  const e = entitlements || {};
  if (!policy) {
    return { slug: product, access: 'default', allowed: e.canUse === true, reason: e.canUse === true ? 'default' : 'plan_required', message: null };
  }
  if (policy.access === 'account') {
    return { slug: product, access: 'account', allowed: true, reason: 'account', message: null };
  }
  if (policy.access === 'paid-plan') {
    const allowed = e.canDownload === true;
    return {
      slug: product, access: 'paid-plan', allowed,
      reason: allowed ? 'plan' : 'plan_required',
      message: allowed ? null : (policy.message || 'This product needs an active XENO plan.'),
    };
  }
  return { slug: product, access: String(policy.access), allowed: false, reason: 'unknown_policy', message: policy.message || null };
}

/**
 * The `product` block for `/api/billing/entitlements`, or null when the caller did not
 * name a product. Only an EXPLICIT `X-Xeno-Client` names one here — a product is asking
 * its own door, and the User-Agent fallback exists for old builds, which do not ask.
 */
export async function productAccessFor(req, entitlements) {
  const identity = identifyClient(req);
  if (!identity || identity.source !== 'header') return null;
  const policy = await loadProductPolicy(req.db, identity.product);
  return evaluateProductAccess({ product: identity.product, policy, entitlements });
}
