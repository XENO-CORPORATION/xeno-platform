# CLAUDE.md — xeno-platform (xenostudio.ai)

This is the **XENO platform**: the marketing site + backend + the release
infrastructure for every XENO product. For the whole ecosystem, see the root
workspace `../CLAUDE.md`.

## 🔴 CI runs HERE — `npm run ci:local`. Do not wait for GitHub Actions.

**We own the compute.** Actions was only ever the *orchestrator* — it decides when a
build runs and records that it ran. It never was the thing that could run it, and as of
2026-09-16 it is not starting jobs for this account at all: every run on `main` and on
every branch reports `failure` in 3–5 seconds with **zero steps executed**.

⚠️ **That is not a red build, it is NO build** — and the distinction is the whole
point. A red X meaning "nothing ran" teaches people to ignore red Xs, and it hid two
real failures here: `erasure.test.mjs` had been broken on `main` since the usage-credit
work, and `browser-bff-session.test.mjs` — a real-Postgres security test — ran in
neither workflow at all.

```bash
npm run ci:local              # every gate CI would run: gates, build, core, money
npm run ci:local -- --only=core     # gates | build | core | money
npm run ci:local:drift        # just check this still matches the YAML
```

It orchestrates its own disposable Postgres (one fresh database per suite, exactly as
the workflows do), carries the workflows' env, and exits non-zero on failure.

🔴 **Its value is FIDELITY, not convenience — so the parity is CHECKED, not claimed.**
`--check-drift` reads the `SUITES=` lists straight out of `core-tests.yml` and
`money-tests.yml` and fails if they disagree with the runner. A local runner that
checks a *different* set of things than CI is worse than none, because it grants
confidence it has not earned. It also reports **stranded** server tests — files that
appear in no workflow suite *and* no `package.json` script. There are 8 today, several
on the money path; a test that never runs is not coverage, it is the appearance of it.

⚠️ **The env is load-bearing, not decoration.** Omitting `REGISTRATION_OPEN` makes
`account-recovery` fail with `Cannot read properties of undefined (reading
'email_verified')` — the signup gate correctly refusing — and omitting `BYOK_ENABLED` /
`SECRET_BOX_KEY` makes `inference-routing-live` assert *nothing at all*. A replication
that drops the workflow's env invents failures and, worse, invents passes.

Both gates are mutation-checked: adding a suite to a workflow fails the drift check, and
a JSX syntax error fails the build gate — the precise defect that reached `main` in
August and was found only when the production Docker build broke mid-deploy.

**Releasing and deploying never needed Actions either** — `scripts/deploy-platform.mjs`
and `xeno-release.mjs` are local Node driving SSH and rclone (`XENO BETA RELEASE -
RUNBOOK.md` §1: *"GitHub is NOT required"*). The durable answer to the orchestration gap
is `xeno-runner/SPEC.md`.

## Releasing — BEFORE any release, read `release-guide/` in full.

This repo ships a portable **`release-guide/`** folder — the single source of truth
for how a release reaches **Cloudflare R2**, the **XENO Hub**, and **xenostudio.ai**.

Before cutting **ANY** release — a new version (installer or CLI) **OR** a
landing/docs content change — read every file in `release-guide/` **in order**,
starting with `release-guide/README.md`. Do **not** improvise release commands; use
the verbatim commands there. Key entry points:

- **Cut a release** → `release-guide/06-release-runbook.md` (installer / CLI / content tracks)
- **How releases are written** (R2, `releases.json`/`version.json`, `xeno-release.mjs`, `publish-cli-releases.mjs`) → `release-guide/03-release-data.md`
- **Build + deploy the site** → `release-guide/04-build-and-deploy.md`
- **When something breaks** → `release-guide/07-troubleshooting.md`

`release-guide/` is copied verbatim into product repos (xeno-hub, xeno-pixel, …) so
their agents follow the same process — keep this folder the canonical copy.

**Invocable skill:** `xeno-product-release` wraps this playbook — say "**release
&lt;product&gt;**" / "cut a patch" / "publish the feed" / "deploy the docs" and it routes
to the right path with dry-run + confirm gates. It is installed as a **global/user
skill** (available in every project): Claude Code `~/.claude/skills/`, XENO Agent CLI
`~/.xeno-code/skills/` (your `xeno skills` "User dir"), Codex `~/.agents/skills/` +
`~/.codex/skills/`. Canonical sources to (re)install from: `release-guide/skill/`
(`SKILL.md` = open Agent Skills for Claude Code + Codex; `xeno-product-release.md` =
XENO Agent CLI). Install steps: `release-guide/README.md`. Spec: `PRODUCT-RELEASE-SKILL-SPEC.md`.

## 🔒 The site is DELIBERATELY locked down (2026-08-11) — do not "fix" this

**xenostudio.ai is not meant to be publicly discoverable yet, and public signup is closed.**
Both are a deployed state that a routine deploy can silently undo. Before changing anything
in `nginx/default.conf`, `public/robots.txt`, `scripts/prerender-products.mjs` or
`src/server/routes/authRoutes.js`, read this.

| What | Where | Reverting it by accident looks like |
|---|---|---|
| **Signup gated on all 3 paths** | `src/server/middleware/registrationGate.js` — one choke point for `POST /register`, `POST /register-with-handle`, **and the OAuth auto-create** in `findOrCreateOAuthUser` | ⚠️ **TEMPORARILY OPEN until 2026-08-28** for the YC review window — `REGISTRATION_OPEN_UNTIL=2026-08-28` is set in the **box's** `docker-compose.yml` (not the repo's). It **closes itself** on the 29th with no action needed; unset/malformed/past all resolve CLOSED. Pinned by `scripts/registration-gate.test.mjs` |
| **Suspension actually enforced** | `assertAccountUsable()` on every OAuth branch | Password login always checked `is_active`; **OAuth never did**. Removing those calls makes a suspension unenforced for the 162 OAuth accounts |
| **`X-Robots-Tag: noindex, nofollow, noarchive`** | `nginx/default.conf` — server level **and** the 3 `location` blocks that set their own headers | nginx drops **all** inherited `add_header` in any block that declares one. Delete a copy and the header vanishes on static assets — and Google indexes images independently of their page |
| **No sitemap** | `scripts/prerender-products.mjs` (generation commented out, stale `dist/sitemap.xml` removed) | Restoring it re-advertises 268 URLs with a fresh `<lastmod>` |
| **robots.txt still ALLOWS crawling** | `public/robots.txt` | 🔴 **Do not add `Disallow: /`.** It blocks crawling, so Googlebot can never see the `noindex`, and already-indexed URLs strand as bare links. Header first; `Disallow` only after Google has dropped the pages |

⚠️ **Never wall `/api/`** — the OIDC provider is at `/api/oauth2/*` and blocking it breaks
sign-in for every shipped product. `updates.xenostudio.ai` (R2) and `api.xenostudio.ai` are
**different hosts**, so the site can be locked hard without breaking installed apps.

⚠️ **De-indexed ≠ inaccessible, and that distinction is deliberate.** Every page still returns
200 to anyone with the URL — a YC reviewer clicking the link in the application sees the full
site. `noindex` is a note to crawlers only. **Do not put up the Cloudflare Access wall while
the YC application is live** (decision made 2026-08-11); that is the one control that would
actually block a reviewer.

**Client IP capture was broken and is fixed (`src/server/utils/clientIp.js`).** `req.ip` plus
`app.set('trust proxy', 1)` still recorded the Docker bridge gateway for all 408 historical
sessions — the hop count does not match the real visitor→Cloudflare→nginx→backend chain. Read
`CF-Connecting-IP`. Verified live: a real signup now records a routable public address.
**Historical session/security rows before 2026-08-11 have worthless IPs** — do not treat them
as audit data.

**216 of 218 accounts are suspended** (`is_active = false`); only the admin and one `service`
account remain active. Reopening signup did **not** unsuspend them — that is intentional and
independent. Backup before the lockdown, with a proven restore:
`_backups/2026-08-11-xenostudio-preblock/` in the workspace root (outside any repo — it holds
password hashes).

**Procedure for this, and for any other host:** the **`xeno-secure-website`** skill —
canonical at **`security-guide/SKILL.md`**, installed at `~/.claude/skills/xeno-secure-website/`.
`release-guide/skill/SKILL.md` §0.5 carries the matching pre/post-deploy gate.

Still open (operator): Cloudflare Access wall, Google Search Console removal request, the
purge decision, and a "signups are closed" state in the signup UI (the form currently 403s).

## 🤖 Agent identity lives HERE and other products consume it

`agent_identities` + `services/agentIdentity.js` + `/api/v2/agents` (added 2026-08-11) is a
**platform primitive**, not a Forum feature. Marketplace (agents as goods), xeno-company
(agents as staff) and xeno-comms (agents as members) all need the identical concept and should
read these rows rather than adding their own agent flag.

| Rule | Why it is that way |
|---|---|
| **It is a RELATION table, never a column on `users`** | `XENO ACCOUNT - ARCHITECTURE.md` §3 — an agent is *"a subject whose permissions are a scoped relation off its owner — never special-cased in business logic."* A `kind` column invites `if (user.kind === 'agent')` in every consumer. `XENO IDENTITY - Migration & Versioning Plan` §3/R3 also forbids touching a live table's columns, and `users` has 218 rows + 33 inbound FKs. |
| **Presence of the row IS the fact** | `is_agent(u)` == "a row exists", and the owner is on the same row, so the two cannot drift apart. |
| **The owner-cascade is DERIVED at read time** | `resolvePrincipal()` cannot return a usable agent whose owner is unusable. A write-time cascade only works if every suspension path remembers — which is exactly how the OAuth suspension hole happened here. Costs one join; cannot be forgotten. |
| **An agent cannot own an agent** | API check **plus** a DB trigger. Without it the owner chain stops terminating at a human. |
| **KIND (`human`/`agent`/`service`) and ROLE (`user`<`moderator`<`admin`) are ORTHOGONAL** | 🔒 LOCKED — canonical statement + legal-combination grid in `XENO ACCOUNT - ARCHITECTURE.md` §2.7. 🔴 **THREE roles, not four: `service` is a KIND**, stored in the role column for historical reasons; its role is `user`. `moderator` is the new role, `service` is not. `service` currently sits in the *role* column — a conflation resolved on READ, never by migrating a live column. Authorize on `principal.role` (effective), never `rawRole`. |
| **An agent's effective role is capped by its owner's** | §3 — an agent "inherits a scoped SUBSET of its owner's grants", and a subset cannot exceed the set. Verified: an agent set to `role='admin'` directly in the DB still resolves as non-staff while its owner is a plain user. Escalation requires promoting the human, which is visible. |
| **Human-only actions test `kind === 'human'`, never "not an agent"** | The first version mapped everything-not-agent to human, so a **service account could accept answers** (Forum D6) — a machine ratifying a machine. Service principals are now refused from posting entirely: no owner means nobody to hold responsible. |
| **Auth is `api_keys`, an explicit stand-in** | `XENO ACCOUNT - ARCHITECTURE.md` §2.6 specifies `client_credentials` — **not implemented** on the provider, and adding a grant is gated by `XENO AUTH - SPEC.md` L13. `api_keys` already gives hashed storage, revocation, expiry and per-key rate limits. Swap later; the identity rows do not change. |

⚠️ **Two claims in `XENO ACCOUNT - ARCHITECTURE.md` are aspirational, corrected in-place there:**
`client_credentials` is not implemented, and there is **no `AGENT` role** (live roles are `user`,
`service`, `admin`).

**XENO Forum** (`/forum`, `/api/forum`) is its first consumer. ✅ **MERGED AND LIVE** — verified
2026-08-13: `/api/forum/threads` and `/api/forum/spaces` both 200 in production with real rows, and
all four migrations are applied. v0.1 Record · v0.2 participation · v0.3 agent identity · **v0.4 the
Feed** (`services/forumRanker.js`, 23 tests) all shipped. ⚠️ The line that stood here — *"not merged,
not deployed; production has no forum tables"* — was **false**, and stale by two versions.

`/api/forum/feed` answers **401 unauthenticated, and that is correct** — it is a personalized
surface. `Forum.tsx` guards the call on `signedIn`, so a logged-out visitor never triggers it; do not
"fix" the 401.

**It is an APP surface, so it runs its own chrome** (`components/forum/ForumHeader.tsx`), not
`landing-v3/Header`. Mounting the marketing header there put Products/Marketplace/Solutions
mega-menus and a dead `Pricing → #pricing` hash anchor above a feed, and pulled in the retired
purple through the import. Keep marketing nav on marketing pages.

**Nobody has posted yet** — ⚠️ but "0 threads" was wrong: verified 2026-08-16 the corpus is
**9 threads and 18 posts, every one of them seeded**. `0 posts by REAL USERS` is the true and
important half. Also 0 moderators, 0 agent identities and 0 predicates, so the moderation queue
and Loop D have no live participants — which is exactly why both shipped broken and nobody
noticed. Spec: root `XENO FORUM - SPEC.md`; plan of record: root
`XENO FORUM - v1.0 RELEASE PLAN.md`.

**Proofs live in `scripts/`** and each runs against the real database inside a transaction that is
always rolled back — `proof:forum-push`, `proof:forum-report`, `proof:forum-throttle`,
`proof:forum-moderation`, `proof:forum-erasure`, `proof:forum-agent-surface`,
`proof:forum-notify-email`, plus `smoke:forum` and `smoke:forum-ui` against the live site.
🔴 **Run the proof before believing a Forum feature works.** Eleven features here have been
built, unit-tested and unreachable.

## 🧭 Workforce runs are ADMITTED, then RE-ASKED — the authority lives HERE (2026-09-25/26)

XENO-WORKFORCE-01's run authority is a **platform primitive**, like agent identity above: every
runtime (SDK, Interface, CLI, hosted agents) asks this repo, and none of them may decide on its own.
Full record, reasoning and evidence: `../docs/specs/xeno-workforce-implementation-status.md`
→ *"Four families closed on the platform — 2026-09-25/26"*.

| Piece | Where | Rule |
|---|---|---|
| **One team model** (D21, #413) | `workforce_resources` kind `team` | `workspace_teams` was absorbed and dropped. Never add a team table or a team flag again. |
| **Team packages** (MKT-04/D22, #415) | `services/marketplaceTeamPackages.js` | Listing kind `team`, built by the platform from one canonical team. Humans and non-redistributable agents never leave. |
| **Admission** (RUN-01/02, #416) | `services/workforceRunAdmission.js`, `POST /api/workforce/run-admissions` | Every term read from its own row, never from the request. Effective = request ∩ definition ∩ target ∩ runtime ∩ entitlement, and the DB CHECK holds it too. |
| **Live authority** (RUN-03/NFR-06/10, #420) | `services/workforceRunAuthority.js`, `…/run-admissions/authorize-step`, `/revoke`, `/authority` | Re-derived from LIVE rows before each privileged call and provider dispatch. It only narrows. A step returns an ES256 lease, ≤60 s, signed with the key at `/api/oauth2/jwks`. |

**Why:** the workforce schema existed and nothing used it to decide anything at run time. A UI's
request is not proof. A pin fixes the DEFINITION, not the AUTHORITY. And without a bounded lease a
disconnected worker spends forever. Every later family — child runs, loops, nested budgets, pooled
funding, division boundaries — needs this record and this check first.

🔴 **Do not widen these by editing the service alone.** Each intersection term is enforced twice: in
the service, and by a CHECK or trigger on `workforce_run_admissions` / `workforce_run_leases`. The
tables are immutable and retained, and `workforce-migration-chain.test.mjs` pins the schema. A new
table fails that gate on purpose: the requirement it implements must be cited by a real test first.

⚠️ **Not built:**
- ~~No runtime calls `authorize-step` yet; the SDK has no pre-dispatch hook.~~ ✅ **The SDK half
  landed 2026-09-26** (xeno-agent-sdk #54, #55): the loop asks a `runAuthority` before every dispatch
  and tool call, and `@xenosystem/agent-sdk/workforce` `createWorkforceRunAuthority` is the one client
  that calls `authorize-step`. 🔴 **No host passes one yet** — the Interface pins an older SDK and has
  no admission flow — so runs are still not revocation-enforced end to end.
- DIV-08: admission does not yet check that the actor sits inside the division.
- The payer is always the actor's own account. No workspace or project pool exists (FUND-06), and there is no silent fallback.

Do not describe runs as revocation-enforced end to end until a runtime calls `authorize-step`.

## Working in `../xeno-elements-foundations` from this repo

The chat's design-system adoption edits both repos in one session. The element library has its own
protocol and it is **not restated here** — a second copy is how two documents drift apart, which is
the same argument the library makes for not storing geometry twice. Read the canonical text before
touching that repo: `../xeno-elements-foundations/CLAUDE.md` and `agents.md`.

What it means for work started from this side:

- **Two owners, two constructions, two files.** `chrome-unified.css` (Soft) and
  `chrome-separated.css` (Industrial) each belong to one person. Never push to or rebase the other
  owner's branch; check `git log --format='%an'` first. Nothing at the platform level enforces this —
  the org is on the free tier and branch protection is a paid feature — so the absence of a guard is
  the reason to be careful, not permission to skip it.
- **Both branches come off `main`, never off each other.** A branch stacked on the other owner's work
  goes stale on every push they make, and the person who fixes it is not the person who pushed.
- **Never type a colour, padding or radius into a COMPONENT stylesheet.** Those files are shared: a
  literal typed into one changes both constructions. This has already shipped once — seven values
  altered Soft during an Industrial pass.
- **A chrome token is a two-file change.** `theme.test.ts` fails in both directions if only one side
  declares it; declare it in both or it half-renders where no component test can see it.
- **Verify in Compare mode, not in the suite.** `npm run dev -w @xenosystem/preview`, the Compare
  column in the header switch. A whole-axis bug is invisible to unit tests: the axis was once
  declared on `.xeno`, a selector apps nest, so every nested scope reset it and both constructions
  rendered identically — with 864 tests green.
- **When the base moves, merge it in — never rebase.** Someone else's history is not ours to rewrite.

## 💳 Billing is LIVE-provisioned and SALES ARE CLOSED BY A SWITCH (2026-09-11)

**Read `docs/BILLING-GO-LIVE.md` before touching anything that takes money.**

Stripe is fully live on `acct_1TwgCrLBe83UKv9x` — 10 products + prices, portal,
webhook, account binding, tax codes, `charges_enabled` and `payouts_enabled` true,
**zero requirements outstanding** — and a real live checkout has been driven end to
end. Money is then held behind one env var, deliberately: **everything else proven
first, money last.**

```
SALES_OPEN=true   → checkout works
anything else     → 503 sales_closed      ← current state
```

🔴 **The gate is in the SERVICE (`middleware/salesGate.js`, called from
`billingService.js`), NOT on the routes.** Two functions create a Checkout Session
and they are reached from two different route files — `createCheckout` from
`billingRoutes.js` and `createWorkspaceSeatCheckout` from **`workspaceRoutes.js`,
which has no billing guard at all**. A route-level switch leaves the Team seat
path — the most expensive item sold — selling with the shop shut. Same shape as
`registrationGate`'s "two closed doors and one open one".
`scripts/sales-gate.test.mjs` asserts the **coverage set**: every function
containing `checkout.sessions.create` must call `assertSalesOpen()` before
reaching the provider, so a new checkout path fails the build until it is gated.

⚠️ **Deliberately NOT gated:** the billing portal (customers must be able to
cancel and get invoices), the webhook (Stripe retries for days; in-flight
payments must still settle), and spending credits already bought. A test pins all
three — do not "tidy" the gate onto them.

⚠️ **`getConfig()` returns `enabled` AND `salesOpen` as separate facts** —
wired-to-a-provider vs willing-to-charge. Collapsing them makes a deliberately
shut shop render as a broken one.

⚠️ **Setting `SALES_OPEN` in `.env` alone does nothing** — compose reads `.env`
for `${}` substitution only, so it must stay listed in the service's
`environment:` block. Verify with
`docker exec xenostudio-backend printenv | grep SALES_OPEN`, never by grepping
`.env`. That exact gap silently disabled `REGISTRATION_OPEN`, `RESEND_API_KEY`
and all five `STRIPE_*` keys on 2026-08-24.

🔴 **WE are the merchant of record.** Every checkout session passes
`managed_payments: { enabled: false }` — Stripe's Managed Payments default makes
*Stripe* the seller and then refuses our 14-day withdrawal notice. The whole
locked posture (`docs/TAX-POSTURE.md`: Kleinunternehmer § 19, our Impressum, our
terms) assumes we are the seller. Do not let a dashboard default decide it.

⚠️ **The statement descriptor lives in TWO places and they must agree** — Stripe
(`XENOSYSTEM` / short `XENO`) and `src/content/support.ts`, which is what tells a
cardholder what the charge is. Change one, change the other.

## 🎨 EVERY page uses the site's design system — never hand-roll chrome

**DIRECTIVE 2026-09-11.** A new or edited public page composes the EXISTING shell.
Do not write a `<header>`, a `<footer>`, a background colour or a type scale by hand.

| Need | Use | Never |
|---|---|---|
| Any secondary public page (legal, policy, resource, marketing) | **`components/marketing/MarketingPage`** — `eyebrow` / `title` / `subtitle` / `updated` / `heroAlign` / `heroActions` / `contentMaxWidth`. Gives Header, Footer, radial hero glow, `Reveal`, the v3 type scale | a bespoke `<header>` with a logo and a "Back to Home" link |
| Long-form authored document markup inside it | wrap in **`<div className="legal-prose">`** (`src/index.css`) — one descendant rule set styles every `h2`/`h3`/`p`/`ul`/`li`/`a`/`table` | a Tailwind class on each element |
| A bespoke landing-style page (`/`, `/support`) | compose `landing-v3/Header` + `Footer` + `primitives` (`T`, `Reveal`, `Eyebrow`, `cx`) directly, as `Home3` does | inventing a parallel shell |

**The tokens are `landing-v3/primitives.tsx` `T`** — `#060606` page, `#101010`/`#151515` cards,
`border-white/[0.06]`, text ramp `#ece7df` title → `#948d83` body → `#69635b` dim. Fluid
`clamp()` type. `Reveal` for scroll-in, staggered `delay={i * 70}`.

🔴 **BEFORE building a shell, grep for one.** On 2026-09-11 a session built
`landing-v3/PageShell` and only then found `MarketingPage`, which 14 pages already used —
the inventory had grepped page files for `landing-v3/Header` and missed that those pages
inherit it *through* the shell. The duplicate was deleted. **Grep for the CAPABILITY
(`Header`, `Footer`, "shell", "layout") across `components/`, not for the symptom.**

⚠️ **Text inputs take NO focus ring.** The global `:focus-visible` outline sits *outside*
the field and reads as a stray stroke — `outline-none ring-0` plus a border/fill change.
(Mandated by the LOCKED `DESIGN_SYSTEM.md`; this is a spec violation, not a preference.)

⚠️ **Restyling a legal page must never reword it.** Prove it: diff the rendered text
against `HEAD` and confirm the only removals are chrome. `Withdrawal.tsx` is **statutory** —
its own header explains that reproducing the prescribed wording loosely loses the safe
harbour. Link statutory text, never restate it.

⚠️ **A page that renders only under JavaScript is indistinguishable from an unfinished one.**
The prerender injects `<head>` only, so `/privacy` is a correct title over an empty
`#root`. Where a page's *content* must exist for a non-JS reader — `/support`, handed to
Stripe and card-network partners whose rule is "placeholder or under-construction sites
aren't supported" — generate the body too, from the SAME source the React page renders
(`src/content/support.ts` → `scripts/lib/support-page.mjs`). Never two copies.

Authority: `../xeno-elements/DESIGN_SYSTEM.md` (LOCKED) and
`../xeno-design-guide/XENO CHROME - CONSTRUCTION PLAYBOOK.md` (the callable HOW).

## Related references

- `security-guide/SKILL.md` — **the callable lockdown procedure** (`xeno-secure-website`): close every account-creation path, make suspension real, de-index correctly, deploy without an outage. Host-agnostic — covers `xeno-post-001`'s no-source-tree GHCR shape and `xeno-mail-001`'s verdaccio shape too.
- `PRODUCT-LANDING-SPEC.md` — the product landing-page + docs authoring contract (the 4-layer model, the docs system).
- `PRODUCT-PAGES-SPEC.md` — URLs, `releases.json` schema, download redirects, prerender.
- `RELEASE-TO-WEBSITE.md` — legacy release note (superseded by `release-guide/`).
- `XENO AUTH - SPEC.md` — **xeno-platform OWNS the account ORIGIN** (OIDC provider `/api/oauth2/*`: `src/server/routes/oauth2Routes.js` + `utils/oidcProvider.js`). The §13 provider prerequisites (loopback port-flex, `id_token` nonce, discovery ES256, scope down-scoping, admin register-client, RFC 8693 token-exchange, step-up, revocation denylist) are HARD-BLOCKERS every other product waits on — ship + verify them here BEFORE any product migrates to the unified auth.

## 🏗️ The platform hierarchy & naming — build under the lock (LOCKED 2026-09-17)

Two ladders, five rungs, meeting at the App — `../XENO FULL-STACK HIERARCHY.md` (master),
`../XENO FRONT-END HIERARCHY.md` (Elements → Components → Blocks → Templates → Apps — rung 3 is BLOCKS; a panel is the slot a block sits in),
`../XENO BACK-END HIERARCHY.md` (Primitives → Capabilities → Nodes → Blueprints → Apps).
One naming rule on every rung — `../XENO PACKAGE NAMING - STANDARD.md`:
`@xenosystem/<rung>/<family>` → one named export per unit. Gate: `node ../scripts/check-package-naming.mjs`.

**This repo is:** **BACK rung 1 — a Primitive.** A platform service or runtime the back ladder is built on (inference, processing, device actions, the OIDC origin and ledger, hosted runs, the registry). It exposes capabilities (rung 2) through ONE code path; nothing on the front ladder imports it, and proprietary consumers reach AGPL primitives out of process (root CLAUDE.md §5b).

🔴 **Never create a temporary name, package, path or layer "for now"** (root `CLAUDE.md`
§BUILD UNDER THE LOCK FROM DAY ONE). Concretely:
- depend DOWN only — never on a rung above, never on `xeno-apps`;
- never re-implement a lower rung here — extract DOWN to its repo and mount it;
- never publish a per-unit package on a ladder rung (`@xenosystem/block-<x>`/`panel-<x>`, `component-<x>`, `node-<x>`) — a unit is a named export in a family subpath;
- never commit a `file:` dependency to a `.tgz` in a Temp directory or an absolute path — publish, wait for npm's read replica, depend on the range;
- seen before used — it renders or runs standalone in `xeno-apps` before this repo relies on it.
