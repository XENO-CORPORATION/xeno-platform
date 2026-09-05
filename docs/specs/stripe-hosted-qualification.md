# Hosted payment and lifecycle qualification

Contract: complete real Stripe TEST hosted Checkout, prove the same subscription
activates the isolated account, then prove refund and cancellation provider state.
Continue renewal, delayed payment, receipt and browser-account/public-ingress gates
as separately measured requirements, not implied by this first slice.

User approved continuing remaining sandbox payment checks on 2026-09-04. No live
charges, production deployment, merchant-profile edits or real recipient email.
Test provider objects/history persist; existing isolated cleanup applies.

KNOWN: scripts/lib/paid-loop-proof.mjs runProof currently creates an open session
then a DIFFERENT direct API subscription. It cannot qualify hosted completion.
KNOWN: billingService.js createCheckout binds required consent and provider price;
handleEvent reconciles subscription and invoice events from the current resource.
KNOWN: stripe-delivered-loop.mjs isolates account, environment, PostgreSQL and CLI
receiver; four real delivered events passed on run 8a29208f57420676649fcda5d568bd96.
KNOWN: charge.refunded proportionally reverses credit-pack grants; subscription
refunds do not imply cancellation. Do not assert access revocation from refund alone.
UNKNOWN: hosted Checkout can complete under this sandbox's tax/account settings.
Resolve with browser using synthetic identity and Stripe's documented test card.

Interfaces: optional hostedCheckout callback in runProof, selected only by explicit
XENO_PAID_LOOP_JOURNEY=hosted. Runner emits synthetic session URL and polls its exact
ID up to 15 minutes. Callback return is NOT evidence; proof retrieves session again,
requires test mode, same customer, complete, paid, consent accepted, subscription ID.
Retrieve that exact subscription; no direct subscription fallback in hosted mode.
Browser return goes to isolated loopback receiver (404 is expected, not app proof).

INV1: target remains dedicated sandbox and marked disposable DB; existing guards.
INV2: hosted proof cannot pass from direct API subscription or arbitrary callback;
tests reject unpaid/open, wrong owner/mode and absent subscription/consent.
INV3: pending and timeout sessions never grant readiness; 15m timeout fails then
expires owned open session, cancels owned subscription, deletes synthetic customer.
INV4: only test card/synthetic identity; no real card, merchant details or email.
INV5: refund bound to paid invoice on the verified owned subscription, real test
charge retrieved and verified before refund; idempotent full refund, verify amount
and succeeded status. Access must remain pro until explicit cancellation. Do not
call this credit-pack refund/ledger proof. Tests reject mismatched charge/invoice.
INV6: handlers drained and counters checked before final report, as existing runner.

Plan: falsify, add optional hosted path/tests, execute browser test, reconcile.
Failure states: provider refusal/timeout/browser unavailable fail with owned cleanup;
tax/legal business settings are not invented to pass. Raw exceptions/CLI secrets
never logged. Recovery locators are run ID and provider object IDs in report.
Rollback: local source changes reversible; fixture cleanup already tested on lost
responses and failures. Real provider history is retained; no existing objects touched.
Acceptance: unit suite green plus hosted paid/consent proof, delivered entitlement,
verified full subscription-charge refund and subsequent cancellation/access closure.
Lenses: money, security, concurrency, network, observability. No UI restyle or live
release. CLI delivery remains different from public webhook ingress.

Independent falsification P2 ACCEPTED: activation and cancellation must assert
xeno_account_plans.stripe_subscription_id equals the verified hosted subscription,
not only pro/active or canceled. Regression injects a different subscription owner.

Hosted slice VERIFIED: run 817e4c4be1efab81555b9ff2843833e7 completed hosted
Checkout, seven accepted signed CLI events / zero handler failures, full EUR 24
subscription-charge refund and delivered cancellation/access closure. Owned customer
cleanup and stopped retained database verified. Public ingress remains unproven.

Next slice: explicit journey=renewal, using a NEW uniquely named test clock and NEW
customer on that clock. Seed only the disposable DB's customer mapping; all plan
writes must still come from delivered production handlers. No existing customer
may be attached. Persist clock ID in report before subsequent operations; recover
lost responses by exact random run-name discovery. Clock cleanup verifies test mode,
exact ID/name; customer discovery must include test_clock (default lists omit these
customers). Retain clock and flag failure if customer cleanup is incomplete.
Advance from the initial paid monthly subscription through period_end + 2 hours
(within two billing intervals), await ready with 120-second bound. Require a NEW
paid subscription_cycle invoice, same customer/subscription, positive EUR amount,
and increased provider period end. Then require DB period_end equals that provider
value on the exact pro/active subscription; entitlements remain open. Cancel and
verify access closes through the existing proof. This does not prove delayed
settlement, receipt delivery, credit-pack reversals or hosted renewal checkout.
Unit counterexamples: wrong clock name/mode/id, unchanged period/invoice, unpaid
invoice, wrong owner, timeout; exact cleanup ownership plus lost-create recovery.

Independent renewal falsification MATERIAL ACCEPTED: subscription.updated alone
can synchronize period end without invoice delivery. Receiver must retain only safe
event ID/type/object ID receipts after successful handler completion. Renewal also
requires a handled invoice.paid or invoice.payment_succeeded receipt for the exact
new invoice (no reason/no-op result), not merely aggregate accepted counters.

Renewal VERIFIED: f87fde0cb32d6e82b8f8fd11ae96b736, exact cycle invoice paid EUR24,
invoice.paid and invoice.payment_succeeded both reconciled, DB period extended,
access stayed open, cancellation closed it. Seven accepted events, zero failures.
New customer and clock deletion verified; disposable database stopped/retained.

Credit-pack slice: journey=credits uses the same isolated synthetic user/customer
and normal subscription/cancellation proof, plus a separate credits_small Checkout
via canonical recordConsent/createCheckout. Browser completes with test card only.
Baseline ledger balance must be zero. Require exact test session/customer/user,
mode payment, paid, consent accepted, item/credits match canonical catalog, exact
price line with quantity one and EUR total equal catalog. Bind its succeeded
PaymentIntent and latest charge by IDs, customer, amount, currency and test mode.
Poll for ONE paid grant, exact billing_charges mapping to user/PI/credits and
available balance == catalog credits * MICRO_PER_CREDIT. Correlate successful
checkout.session.completed/async_payment_succeeded receipt to exact session ID.
Refund 40 percent then remainder with distinct stable idempotency keys. Before
each refund, retrieve owned charge and verify cumulative refund baseline; verify
provider succeeded refund and final charge cumulative amount, then exact ledger
balance and billing_charges.refunded_micro plus reconciled charge.refunded receipt.
No user spending occurs, so shortfall is not expected. Check grant count stays one
after refunds. Existing cleanup discovers every session for owned customer, expires
open sessions and cancels owned subscriptions. No provider invoice/email sent to
real recipients. Real provider history remains. Delayed settlement and provider
replay remain separate requirements; local fixture replay tests are not relabeled.

Independent credit-pack falsification: no material findings. Added distinct receipt
IDs for each refund so the first event cannot qualify the second reversal.
Credit-pack VERIFIED: 4b742ab50858c53472e379cb640fe634. Hosted EUR10 payment,
1,000-credit grant, EUR4 refund -> 600 credits, EUR6 refund -> zero. Nine accepted
events, zero handler failures, exact checkout and distinct charge-refund receipts.
Invoice events for this one-time payment correctly report no subscription/no-op.
Customer cleanup verified, disposable DB stopped/retained. This run's original
subscription Checkout remained open; its subscription used the direct API path.
The separate hosted-subscription run above supplies that distinct evidence.
