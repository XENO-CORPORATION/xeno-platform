# Platform launch hardening — 2026-09-04

Status: **not yet production-qualified**. This is an evidence record, not a retirement of any requirement. Work is local in the `full-web-context-platform` worktree; no publication, deployment, real payment or paid generation occurred.

## Repairs completed in this pass

- Billing webhook preflight fails closed if discovery is unavailable or malformed. It paginates, verifies the exact application webhook URL, enabled status, test/live mode and handled-event coverage.
- Checkout events with unpaid or unknown payment status cannot activate subscriptions or grant top-up credits. Settled delayed-payment events remain supported and replay-safe.
- The billing return page no longer calls a redirect payment confirmation. It displays confirmed account data, explains that settlement can still be pending, and provides refresh. Loading/error and stale-request handling are explicit.
- Workspace-scope unit and database suites are reachable from the default test command. Database prerequisites remain explicit; missing infrastructure does not become a claimed pass.
- Both checkout paths validate consent ownership, item, acknowledgments, current terms hash, database-clock freshness and unused status. Consent lookup failures fail closed; provider session creation is idempotent per consent and binding cannot be reassigned.
- Credit fulfillment deduplicates provider events, checkout purchases and payment intents in the same transaction as the ledger grant. Distinct event IDs for one purchase cannot grant twice; failed transactions roll back their claims.
- Subscription reconciliation retrieves current provider state under a customer-scoped transaction lock, validates account ownership and personal/workspace scope, and rejects superseded subscriptions. Team renewals update workspace billing rather than the personal plan. Late invoices cannot restore a canceled subscription; terminal subscriptions revoke access even if their price has been retired.
- The return page now queries owner-bound, exact-checkout status. A successful redirect alone cannot confirm payment, and settled provider state is distinguished from persisted fulfillment. Card PaymentIntents use a bounded, Latin-letter-containing statement descriptor suffix.
- Billing cards now share equal page gutters with the header (30px at the inspected desktop width, 24px below 1500px, 14px on narrow screens). Removed the bright card-top stripe, allowed headings/actions to wrap, and disabled competing purchase actions while a checkout is pending. No palette was added.

## Current evidence

| Check | Result | Boundary |
| --- | --- | --- |
| `npm test` | Exit 0; Node test summaries total 1,185 tests: 1,163 passed, 22 skipped | Default local environment; skipped integration checks are not qualified by this run |
| Six targeted payment/foundation suites | 138 passed, zero failed | Source guards and unit behavior; separate from provider delivery |
| `npm run typecheck` | Passed | TypeScript source |
| `npm run build` | Passed; production fixture boundary checked across 418 emitted files; 298 product pages prerendered | Local artifact only; large-chunk warning remains |
| Standalone billing money-in suite | 51 checks passed against isolated PostgreSQL; temporary fixture database removed | Actual consent/ledger/plan transactions, replay, refunds, disputes and rollback; subscription provider responses are controlled fixtures |
| Local raw HTTP webhook | Included in the 51 checks: invalid signatures and payload tampering rejected; valid signed fixture applied once across replay | Actual Express handler and Stripe signature verifier, locally generated test signature; not real Stripe delivery |
| Browser billing return | Success query does not claim settled payment; account balance remains backend-derived | Existing local test account; no checkout created |
| Browser billing layout | Dark expanded/collapsed sidebar and light collapsed sidebar inspected at 1511×1022; equal 30px gutters, no horizontal overflow | Desktop rendered evidence only; mobile rules source-checked, not rendered-qualified; original system theme and expanded sidebar restored |
| Public production `/api/billing/config` | Enabled; all eight catalog items reported available | Read-only public configuration, not webhook/settlement proof |
| Local billing configuration | Disabled, no available paid items | Local UI correctly disables purchase actions |
| Local compliance preflight | Exit 1: automatic tax setting missing; subject-hash secret advisory | Local process configuration only, not a production configuration or legal verdict |

The running local backend is a non-watching Node process and was not restarted during this continuation. Service changes were exercised through isolated integration processes, including local HTTP; this record does not assert that the existing daemon reloaded them. The frontend layout is visible through hot reload. No real account balance was modified; only newly created isolated fixture databases were removed.

Credential discovery found no Stripe test credential in the process environment, worktree environment files, shared secret store or Stripe CLI configuration. Stripe CLI is installed, but installation does not prove an authenticated test-mode connection. No credential values were printed or changed, and no provider customers, checkouts or subscriptions were created.

### Design-system conformance boundary

The billing surface inventory is two card sections and five button JSX sites (the pack button repeats per catalog entry), reusing existing platform navigation, consent UI and theme CSS. This pass repairs that existing implementation; it does not introduce canonical declaration-backed Elements rendering. Conformance remains **DRIFTED**, with adoption tracked in the hierarchy status. No ON-SYSTEM or all-platform visual qualification is claimed.

### Provider contract references

Stripe documents duplicate and unordered webhook delivery and retrieving current resources in its [webhook guidance](https://docs.stripe.com/webhooks). Checkout fulfillment must be safe to repeat per checkout session; see [fulfillment guidance](https://docs.stripe.com/checkout/fulfillment). Card descriptor suffix constraints are documented under [statement descriptors](https://docs.stripe.com/get-started/account/statement-descriptors).

## Open launch gates, in dependency order

1. **Complete and qualify the hierarchy contract.** See [workspace hierarchy status](../workspace-hierarchy-implementation-status.md). Host identity/folder grants, canonical runtime-persona bindings, effective permission intersection, task/schedule bindings and fleet/folder navigation remain open. Agent Interface authority files have existing WIP; coordinate ownership before changing them. Organizational team assignments are not execution permission grants.
2. **Qualify the whole purchase journey in Stripe test mode.** Securely configure a test-mode provider connection, then verify signup/activation/onboarding, hosted checkout, signed provider webhook delivery, persisted entitlements, exact-checkout status, refresh/relogin, delayed payment, cancellation/refund and actual transactional email together. The per-checkout status endpoint and return UI are now implemented and locally tested, but local fixture-based tests do not substitute for this journey.
3. **Run the repaired read-only billing preflight in the intended backend environment.** Verify configured prices, webhook signing configuration, endpoint mode and event coverage. Public configuration availability does not establish these facts.
4. **Close operator-owned commercial checks.** Confirm legal entity/customer-facing terms, tax configuration and support/refund ownership. Source checks are not a legal or tax opinion.
5. **Prepare a scoped release artifact from reviewed changes.** This worktree contains extensive pre-existing work. Do not sweep it into a release. Bind the intended source revision, migration order, health checks, backup/rollback procedure and deployed smoke evidence before a production rollout.
6. **Finish product-surface qualification.** Canonical declaration-backed design-system adoption remains tracked in the hierarchy status. Account-area native prompt/confirm sites and the build's large main bundle are remaining polish/performance work; no complete all-page visual/accessibility/performance claim is made here.

Production deployment and real-charge/provider-spend checks require separate explicit authorization. Search-engine indexing is currently disabled by existing policy; this pass did not change that policy.

## Repeatable local qualification continuation

Implemented `npm run qualify:platform-local` under the [qualification contract](../specs/platform-launch-qualification.md). This command creates a new loopback-only PostgreSQL container from the installed immutable pgvector image, with separately owned platform/payment databases. It refuses arbitrary target overrides, remote Docker contexts, skipped/TODO/cancelled tests and incomplete migration prerequisites. Child processes receive only allowlisted OS variables and explicit local fixture configuration, not inherited provider credentials. Test uploads and temporary extraction files stay inside one parent-owned scratch boundary.

The runner exercises all four production startup schema steps twice, real workspace/project database suites, the 100k synthetic-vector isolation/recall/latency suite, all 51 payment checks, and fresh-target custom-format dump/restore. Restore compares table content fingerprints, column/constraint/index definitions, triggers/enabled state, functions, RLS policies/flags, partition properties, views, enums and sequence state; payment restore also verifies every fixture account's ledger chain. A transactional negative control disables the restored ledger trigger, requires rejection, rolls back and rechecks the healthy state. It does not prove production-data migration compatibility or real embedding quality. Reports explicitly list unexercised external gates.

Independent contract review required three improvements before implementation: TODO rejection, all four startup schema steps, and parent-owned child artifact cleanup. Final code review additionally required nonempty legacy SQL input checks and executable-schema fingerprints so absent money-protection triggers cannot pass. The first actual run caught equivalent PostgreSQL array-cast serialization in the schema comparator. The narrow normalization has regression tests rejecting actual value/operator/type changes; this was a checker defect, not evidence of lost account data.

- Final default regression: **1,195 tests; 1,173 passed, 22 skipped, zero failed/cancelled/TODO**, exit 0. The default-environment skips are not counted as live qualification.
- Qualification safety/parser/comparison unit tests: **10 passed**, including remote/ownership refusal, missing legacy input checks and negative restore comparisons; included in the default chain.
- `npm run typecheck`: passed again in this continuation.
- Source: HEAD `9278420998c6d0d51d43fa3aa5ebfb5472679e9f` plus dirty worktree changes, explicitly recorded as such, not an approved release artifact.

The final full isolated run completed at **2026-09-04T06:48:14Z**, exit 0, `passed-local-only`:

| Check | Measured result |
| --- | --- |
| Fresh startup and replay | 49 versioned migrations plus required legacy/account/OIDC steps; no deferred migrations |
| Workspace/project DB suites | 25 passed; zero failed/skipped/cancelled/TODO |
| Search scale | 100,000 synthetic-vector rows; recall@12 1.0, p95 88.26ms over 16 measured queries; isolation/index/pruning assertions passed |
| Payment accounting and signed local HTTP | 51 passed, zero failed |
| Payment restore | 25 tables, 93 fixture rows, eight ledger account chains; disabled-trigger negative control rejected and rolled back |
| Platform restore | 204 tables, 200,539 fixture rows; content and schema/security fingerprints matched |
| Cleanup | Passed; owned container and host scratch directory independently confirmed absent |

Evidence is retained at `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-fjFc8F/report.json` and sibling logs. Earlier rejected/completed checker runs remain separately logged; they are not overwritten. Only freshly created test databases, containers/anonymous volumes and scratch files were removed. No production deployment, customer checkout, external email, paid generation or existing-account balance mutation occurred. Full launch remains blocked on the open gates above, not on this local qualification slice.

## Startup integrity and route-loading continuation

The [launch closure register](../specs/platform-launch-closure.md) now consolidates ten remaining workstreams with their owning boundary and required evidence. Production startup now shares the qualifier's required schema pipeline, refuses missing/unreadable/empty legacy files, propagates all SQL errors, rejects deferred migrations and awaits schema success before listeners, readiness and service starters. Download cleanup no longer starts during module import. Independent final review found no material remaining omission within this startup scope.

Default regression: **1,234 tests; 1,212 passed, 22 skipped, zero failed/cancelled/TODO**, exit 0. This includes 37 startup-integrity tests and two route-loading DOM/source tests. TypeScript and the production build pass. The built entry module is 2,951,875 uncompressed bytes, down from 7,174,902; this is not a claim about total session transfer or browser latency. New loading/retry UI uses existing Elements Card, ProgressBar and Button renderers; it does not qualify the rest of the platform as ON-SYSTEM.

Canonical isolated qualification completed at **2026-09-04T07:31:26Z**, `passed-local-only`, in `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-3zkQQY/report.json`: 49 migrations and replay; 25 workspace/project DB tests; 51 payment tests; 100k synthetic-vector recall@12 0.99479 and p95 137.15ms; payment restore 25 tables/93 rows/eight ledger chains; platform restore 204 tables/200,303 rows. Successful-run cleanup passed and absence of its container and scratch directory was independently checked.

The earlier interrupted `xeno-launch-evidence-rtW31b` run is not passing evidence; its fixture container was stopped and volume/scratch retained after cleanup was denied. The existing local backend has not been restarted with the new startup code. Current browser navigation reaches login, so authenticated billing/chat navigation is not qualified by this continuation. Hosted provider journeys, production-shaped data, hierarchy permissions, remaining UI adoption, operations, commercial confirmation and approved deployment remain open as enumerated in the register.

## Local preview restart and data-preserving recovery

The subsequent restart was completed on 2026-09-04. The fail-closed startup correctly rejected the old local plain PostgreSQL 17.11 database: semantic-vector migration `20260829121000` needed pgvector >=0.8.6. This supersedes the preceding continuation's "not restarted" state.

`scripts/local-preview.mjs recover` copied `xwc-gate-pg/xeno_ui_local_qual` into an independently pinned PostgreSQL 17 / pgvector 0.8.6 container. Before migrations, all **140 public tables / 296 rows**, schema fingerprints, effective ACLs, owners, function security configuration, default privileges and exact sequence values/`is_called` matched. Source writes were held with bounded-acquisition table locks while dumping/comparing; the source was not migrated or reset. The missing migration applied and replay reported **0 applied / 49 total**. A post-start check also confirmed both user rows, both credit-account rows and both credit-transaction rows were unchanged.

Verified current resources:

- PostgreSQL: `b17a88e96e3153429142e25d1498b17214ab59f314452eebbbb07c08f1bbc8a7`.
- Dedicated empty Redis: `5fc9471b84a2a02d4a8e4389c0714a19f1bc73307e2d0c6d0412244b91fec0f0`.
- Original database and protected container-local dump `/tmp/xeno-preview-0f381d377b5013c0cfb10895e311c1b1.dump` retained; three earlier rejected diagnostic copies remain stopped, not selected.
- Nonsecret state and runtime logs: `C:/Users/bnkr/AppData/Local/XENO/local-preview/`.

Direct API and frontend-proxied readiness passed, including a per-launch instance match. The launcher verifies listener PID, Node executable and loopback bindings; adopted Vite must come from this worktree. Repeated `start` succeeded without replacing services. `X:/code/xeno-corporation/start-xeno-local-preview.bat` now starts/verifies both services and opens login only after readiness succeeds. A fresh in-app browser tab rendered the login page successfully; no authenticated browser journey or external checkout is claimed here.

Preview uses actual account authentication and the required migration pipeline, not an auth bypass. It excludes inherited provider variables and dotenv, uses the owned Redis, and disables embedded background jobs, scheduled tasks, notifications and physical-file cleanup. Normal runtime conversion consumption was also moved out of static import and behind startup migrations. Preview readiness is explicitly marked as preview/background-disabled; it is not worker qualification.

Default `npm test` and TypeScript passed in this recovery. Focused tests cover invalid/stale instance adoption, wildcard/LAN listener refusal, development/loopback policy, all background starters inside the policy gate and conversion-import consumer exclusion. Restore-checker corrections preserve semantics: PostgreSQL dump can omit explicit owner-default ACLs, and different container locales can order identical ACL items differently. Compare `acldefault`-expanded items in C collation, retaining grantees, grantors and grant options, rather than weakening privilege checks.

All external launch gates in the closure register remain open. No production deployment, real payment, external email, password reset or welcome-credit regrant was performed.

## Billing price-shape preflight continuation

The existing preflight accepted a three-month recurring Price as monthly because
it compared interval but not interval_count. It also omitted licensed usage,
per-unit billing and quantity/custom-amount controls. The shared pure validator
now checks these fields, explicit active state, and non-recurring pack shape.
Price lookup errors now print fixed diagnostics instead of provider messages.

Verification: 32 preflight tests passed; combined with pricing, pricing-contract
and payment-operations, **91 passed / 0 failed / 0 skipped**. Child-process tests
execute the actual CLI with synthetic catalog/provider import boundaries and real
validation helpers: valid configuration exits 0, isolated shape errors exit 1,
and a sentinel provider secret never appears in stdout/stderr. No real Stripe
requests, charges or configuration changes were made. Worktree diff check passed
(line-ending warnings only). Local `/api/ready` was healthy through port 5183.

This is configuration-validator qualification, not checkout runtime enforcement,
target price/tax verification or hosted webhook delivery proof. See
`../specs/billing-price-shape-qualification.md` for the bounded contract.

## Runtime checkout price guard and eligibility crash repair

Both new-checkout producers now retrieve and validate the server-selected Stripe
Price against the shared priceIssues contract after consent validation and before
customer creation, session creation or consent consumption. Failure gives safe
503 billing_price_unavailable. Display caching cannot authorize a purchase.
The guard combines a 10-second SDK inactivity timeout (no retries) with an
independent wall-clock deadline; late provider rejection cannot cause effects or
an unhandled rejection. Existing subscriptions and fulfillment were not changed.

The service-execution tests discovered both subscription producers called an
undefined `isOffered`. Both now use the existing `isOfferable` catalog predicate.
Behavior checks exercise real producers, not only source regexes: correct packs,
monthly/annual personal and Team, retired/list/founding eligibility, invalid
prices, stale display cache, missing provider, consent refusal and deadlines.

Results: **122 adjacent checks passed, 0 failed/skipped; full npm test exited 0**.
The checkout/preflight suites also passed **39 checks on Node 20.20.2** using an
existing cached runtime. The prior newer registerHooks-based preflight fixture
was changed to module.register for CI compatibility. The attempted npm runtime
download was stopped after it stalled; the passing run used the verified cache.

No actual Stripe requests or database mutations occur in the synthetic service
fixtures. No deployment, charge or backend restart was performed. The running
preview's database/Redis/migration readiness remained healthy; its existing
session was preserved. See `../specs/billing-checkout-price-guard.md`.

## Full local test pass (2026-09-04, final rerun included)

Revision `9278420998c6d0d51d43fa3aa5ebfb5472679e9f`, with existing uncommitted
platform work preserved. No deployment, live charge, provider configuration change
or preview backend restart. This is local evidence, not release approval.

- Final default regression: 1,241 passed, 22 skipped, zero failures (initial run:
  1,240 passed before adding one qualification-parser test). The 22 are 16 DB,
  one scale, and five real-embedding checks. DB/scale checks were separately
  executed without skips in the isolated runner; the five real-embedding checks
  remain unqualified. Final log: `C:/Users/bnkr/AppData/Local/Temp/xeno-final-regression-0d017ea34634404981546ffd3f57412b.log`.
- TypeScript: `npm run typecheck`, exit zero.
- Production build: exit zero; Chat fixture-boundary scan passed across 495
  emitted files; 298 product pages prerendered, sitemap intentionally disabled.
  Existing ambiguous Tailwind utility warnings remain, along with large chunks;
  build success does not qualify performance or all visual states. Log:
  `C:/Users/bnkr/AppData/Local/Temp/xeno-full-build-68a8eda4cc26444191b965a54790d855.log`.
- Platform fixture run: all 49 versioned migrations plus startup/replay, 25
  workspace/project DB tests, and 51 payment/signed-HTTP checks passed. The 100k
  same-partition synthetic-vector test had recall@12 1.0 and p95 145.77ms across
  16 measured queries. Payment restore verified 25 tables, 93 rows and eight
  account chains; platform restore verified 204 tables and 200,217 fixture rows.
  Cleanup passed. Receipt: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-ZzfEEp/report.json`.
- Expanded backend: 226 assertions across twelve suites plus the BFF lifecycle
  suite passed in fresh databases (ledger, metering, wallet, ReBAC, OIDC,
  erasure, recovery, token confusion, API keys, opaque cookie/CSRF/revocation).
  Receipt: `C:/Users/bnkr/AppData/Local/Temp/xeno-launch-evidence-PKRgGI/report.json`.
  The first run is retained as failed at `xeno-launch-evidence-bbpoPe`: all API-key
  assertions passed, but Node exited with a Windows libuv closing-handle assertion.
  The test now awaits HTTP shutdown and drains naturally instead of forcing exit;
  the complete backend batch then passed. No auth behavior changed.
- Additional checks: chat model selector, carousel, theme selector, composer
  shadow and empty-state behavior passed; workspace equilibrium 3/3; tool
  passthrough 6/6 and entitlement gate 26/26. Node 20.20.2 checkout/preflight 39/39.
- Browser: authenticated local dashboard, billing, settings, teams, projects,
  integrations and notifications loaded with real account/empty states;
  command palette search for billing reduced to one result and Enter navigated
  correctly. The local ledger displayed 1,000 credits; unavailable checkout was
  visibly disabled and credit purchases explained their unavailable state.
  This was read-only desktop smoke, not all routes, mobile, themes or CRUD.
  Opened the empty project Board view without creating project data.
- Preview `/api/ready` remained healthy: DB, Redis and migrations OK, background
  work disabled, original instance unchanged.

Not proved: hosted Stripe checkout/webhook delivery, real email/Google onboarding,
embedding provider quality, production-shaped migration/restore, cross-product
execution boundaries, comprehensive responsive/theme/accessibility matrix,
commercial launch settings or deployment. The auth-system skill's required
ecosystem execution/inventory briefs dated 2026-08-27 are absent in this checkout;
no complete auth conformance verdict is asserted.
