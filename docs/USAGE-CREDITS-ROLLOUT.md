# Usage-credit consent rollout

Status: implemented and tested on the platform branch; not deployed.

## Account contract

One weekly allowance belongs to the paying user. Agents use that same allowance and the owner's preference. The absence of a preference means OFF. Buying a pack never enables consumption. Only a usable human principal may change the preference.

- GET `/api/v2/ledger/quota`: existing quota fields plus `usageCreditsEnabled`, `usageCreditsBalance` (credits, not a currency conversion), and `canManageUsageCredits`.
- PATCH `/api/v2/ledger/usage-credits`: `{ "enabled": true | false }`, returning the updated quota view. Browser authentication and CSRF protections are inherited from the existing account session.
- Refused admission: HTTP 402 with `error.code = QUOTA_EXCEEDED`, `error.message`, `error.resetsAt`, and `error.usageCreditsEnabled = false`.
- When opted in but genuinely short of eligible funding: existing `INSUFFICIENT_CREDITS`.
- Existing user-set spend caps remain independent and may still return 429.

The setting is global for this user's metered ledger consumption, including API calls, media and agents. It does not apply to local/BYOK execution that does not use this ledger. No per-agent allowance is created.

## Transaction behaviour

Admission under the account row lock allocates eligible grant lots. OFF permits allowance lots only. ON permits the remaining lots in their explicit priority/expiry/FIFO order. Standard priorities consume allowance before promotional before purchased credits. Each hold persists its exact funding allocation; later admissions subtract active allocations. Direct debits use the same allocation check.

Settlement consumes the saved allocation, not the current toggle, and only up to the actual charge. Disabling usage credits does not invalidate already-admitted work. Voiding releases the reservation by changing hold state. Lot allocations remain reserved while a hold is held, including late settlement. The existing expiry sweeper releases them by voiding the hold. A voided hold cannot settle. Pre-migration holds with no funding rows finish under the pre-migration policy. Existing historical ledger/lot differences are not reconciled by this feature.

## Required gateway coordination BEFORE activation

Gateway candidate `19b80db` maps every HTTP 402 to `no_credits` and discards `resetsAt`. Update the gateway first:

1. Preserve `error.resetsAt` and `usageCreditsEnabled` in its ledger error type.
2. Handle `QUOTA_EXCEEDED` before the generic 402 branch. Return a distinct `quota_exceeded` error with the reset time and a link to `/overview/usage-analytics`, never an instruction to buy credits when the switch is off.
3. Keep the authenticated actor on balance, hold, settle and void. Never enable credits on an agent's behalf.
4. Test both 402 classes and prove a refused hold dispatches no provider request.
5. Media admission must happen before generation. The current gateway's caller-priced debit helper does not itself prove this ordering; verify its call sites. A post-generation refusal cannot prevent incurred cost.

Do not deploy the platform enforcement until the gateway is ready and the operator accepts the default-OFF rollout. Existing exhausted accounts, including the operator's high-volume account, will stop new over-quota work until the human enables usage credits. Do not silently seed ON preferences or change plans as a workaround.

Deploy the account UI and backend as a coordinated release. The new UI refuses to invent a setting if connected to an old backend. Keep the old backend image for rollback; the additive tables preserve data, and the migration DOWN is intentionally non-destructive. An old backend would ignore consent, so rollback is not an acceptable long-term enforcement state.

## Verification performed

- Full `npm test` passed.
- Production frontend build and TypeScript checks passed.
- Funding tests cover missing/default-OFF preferences, ON overflow, quota vs balance refusal, active/legacy reservations, and settlement funding.
- Owner-only PATCH/GET tests cover human, agent, service, suspended and unknown principals, strict booleans, and audit events.
- Real browser proof covers mobile overflow, mouse toggle, keyboard toggle and persisted reload against a controlled API fixture. It does not claim a live signed-in account test.
- Real PostgreSQL proof uses temporary shadow tables and an outer rollback. Both admission paths, reservation competition, OFF-after-ON settlement, actual-cost settlement, retry idempotency, void/reopen and new-week funding passed. No production account or preference was changed.
- Deliberately removing OFF enforcement, changing the default to ON, or ignoring legacy reservations fails the funding tests.

Proof commands: `node --test scripts/usage-credit-*.test.mjs`, `node scripts/usage-credit-browser-proof.mjs`, and the explicitly gated `scripts/usage-credit-postgres-proof.mjs` in a backend environment. Browser proof screenshots are local scratch outputs, not published artifacts.
