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

### 🔒 The SITE GATE is ON (owner, 2026-10-18) — pages are invitation-only

`SITE_GATE=on` in the box `.env`, enforced by `nginx` (`auth_request /__site_gate` →
`src/server/routes/siteGateRoutes.js`, `public/coming-soon.html`). Nothing outside the gate:
the API, OAuth, static assets, `/install/spawn.ps1`, and the sign-in/legal pages.

| Way in | How | Note |
|---|---|---|
| **Access code** | `SITE_GATE_CODE` typed on Coming soon → signed `__Host-xeno_gate` cookie, 7 days, 10 attempts / 15 min per address | Opens **pages only**. Rotating the code invalidates every issued cookie; there is no per-person revocation |
| **Account** | An ACTIVE account that is an admin or matches `SITE_GATE_ALLOW` (`@xenosystem.ai,@bnkrsys.com`) | Signed in alone is NOT access — signup is open |
| **Personal code** (owner, 2026-10-20) | Admin creates one per person/fund at `/workspace/support/access` (`/api/site-gate/codes`, admin only; `services/siteAccessCodes.js`). Shown ONCE; only a SHA-256 is stored. Scope `pages` (default) or `account` | The cookie (`v2.<exp>.<code id>.<hmac>`) names the code and `/check` re-reads its row, so **revoke/expiry shut every browser at once**. `account` also sets the PR #824 share invitation (24 h) so registrationGate admits signup — no second signup path. Expiry required (default 30 d, max 365), optional max uses, audit in `site_access_code_events` (country only, never an IP) |
| Off | `SITE_GATE=` (anything but `on`) → 204 for everyone | The flag is the whole switch |

**One host:** `www.xenosystem.ai` 301s every page to `https://xenosystem.ai` (path + query kept; `/api/` 308 so POSTs survive), because the `__Host-` gate cookie is per host. No OAuth client registers a www redirect URI (box, 2026-10-20).
⚠️ Not built: a code that INVITES a specific email, and linking a created account back to the code it was created under (only "browsed under it while signed in" is recorded).

🔴 **The sign-in page must never be gated.** The bypass serves the shell from the named
`@spa_shell` location; `try_files … /index.html` is an internal redirect that re-enters the
gated `location /`, and on 2026-10-18 that served "Coming soon" on `/login` and locked
everyone out. `scripts/site-gate.test.mjs` pins it, plus robots.txt answering as itself and
the disabled sitemap staying a true 404.

⚠️ **The code and its cookie are not auth.** `/api/` still requires an account, and
`/workspace` still redirects to `/login` for a code holder. A client-rendered site cannot hide
its JS bundle either: the gate hides pages, not compiled assets.

**Homepage is Home v21, a static document (owner, 2026-10-22).** `/` is served by nginx
`location = /` from `public/home-v21/index.html` — the owner's `XENOsystem Home v21.dc.html`
handoff forked verbatim with its dc-runtime (React/Babel vendored under `home-v21/vendor/`,
no CDN), because its ~1,100 lines of DOM/canvas logic do not survive transcription.
Re-import with `node scripts/import-homepage-v21.mjs <extracted zip dir>`. The SPA route `/`
is only `HomeV21Redirect` (in-app navigation hands back to nginx); the previous React
homepage stays at `/v3`. `/home-v21/` is `no-cache`, never the 1y immutable rule.
`npm run test:homepage-v21` pins all of it. Its demo panels call `window.claude.complete`
when a host provides it and otherwise toast that no model is reachable — that degradation
is the prototype's own, not a bug.

**Product pages are the v2 designs (owner, 2026-10-22).** `/products` and bare
`/product/<slug>` serve the owner's XO PRODUCTS designs as static documents
(`public/product-pages/…`, runtime under `public/products-v2/`), forked verbatim
like the homepage; spec + falsification record: `specs/products-pages-v2.md`.
Re-import with `node scripts/import-products-v2.mjs <extracted zip dir>` — it
regenerates `src/lib/productDesigns.ts`, rewrites design cross-links and forces
downloads through `/product/<slug>/download/win` (raw R2 installer URLs in a
design are a gate bypass, never shipped). `sdk`, `acp`, `research`, `use`, `audio`
have no design and keep their React pages; sub-addresses (download/releases/docs)
are untouched. `npm run test:products-v2` pins all of it.


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

## ✅ XENO Tasks lives HERE (server + screens); the product and agent contract live in `../xeno-tasks`

XENO Tasks (codename Telos) is the work tracker for people and agents. **Read `../xeno-tasks/agents.md` (the agent
contract) and `../xeno-tasks/SPEC.md` (state machine §3, agent sign-in §4a) before changing it.**

| What | File |
|---|---|
| The one service every surface calls (REST, MCP, screens) | `src/server/services/xenoTasks.js` |
| MCP server (`/api/tasks/mcp`, Streamable HTTP 2025-06-18, twelve tools incl. `heartbeat`/`release` for claim leases) | `src/server/services/tasksMcp.js` |
| Routes, `xtk_` credentials, the OAuth 401 challenge, scope rules | `src/server/routes/xenoTasksRoutes.js` |
| Self-registered MCP clients (RFC 7591), the `xeno-tasks` token audience, consent | `src/server/utils/oidcProvider.js`, `src/server/routes/oauth2Routes.js` |
| Screens | `prototypes/xeno-workspace/platform-tasks.js` |
| Tests | `src/server/tests/xeno-tasks.test.mjs`, `tasks-mcp-oauth.test.mjs`; browser `prototypes/xeno-workspace/tests/tasks-test.mjs`, `tasks-agents-test.mjs` |

Rules that are easy to break:
- **Never add a second code path.** REST, MCP tools and screens all call `xenoTasks.js`; an MCP tool that queries on its own will drift.
- **A self-registered client's token is `aud: xeno-tasks` and must stay refused by every other API.** `authMiddleware` requires `xeno-api`; do not widen it.
- **An OAuth sign-in acts as the person's own per-app agent (`agent_origin='mcp'`), never as the person.**
- **Only whoever holds a task works on it** (owner, 2026-10-23; `../xeno-tasks/SPEC.md` §3a): anyone who can see it reads it and may take it; comment, images, sub-tasks, links, folders, moves and copy for agent need `mayWork` (assignee, agent delegate, creator, project admin) — the reviewer only reviews. New task actions go through `mayWork`/`mayComment` in `xenoTasks.js`, and screens read `can.work`/`can.comment`/`can.take`.
- **Only a failed token verification may answer "sign in again".** The first live sign-in hid an agent-cap error behind that message (#675).
- Public docs for Tasks on the site are **not** written yet, on purpose (owner, 2026-10-11).

## 🧰 XENO Tools (tools.xenosystem.ai) is its OWN product, served from HERE (owner, 2026-10-28)

`src/toolHost/` (`Picker.tsx`, `chrome.tsx`, `main.tsx`, `tools.css`, served by `tool-host.html`) over
`routes/toolsRoutes.js` → `services/toolPackages.js`. It is not a workspace page: XENO Workshop's 44px header, no side
panel, results update as you type, **Create my own only after something is typed** (→ `workshop.xenosystem.ai/?start=`,
xeno-workshop #26). The tools themselves, their signing (key #2 since 2026-10-28; Hub ≥ 0.11.22) and the rule that a
person's own tool is never signed by XENO and only runs sealed are in `../xeno-tools/CLAUDE.md` §🌐. Design:
https://claude.ai/artifact/EYy1EHJsDN8nFDecuBvi21 · test: `prototypes/xeno-workspace/tests/tools-test.mjs`.

## 🛟 XENO support lives HERE — Help ▸ Contact support (2026-10-20)

Private requests to XENO: `services/supportTickets.js` (the one service), `routes/supportRoutes.js` (`/api/support`),
`services/supportMcp.js` (`support.ticket.*`), screens `prototypes/xeno-workspace/platform-support.js` at
`/workspace/support[/new|/queue|/macros|/T-<n>]`. Product bug reports from apps stay `forumTickets.js` (dev-agent lane).

- **A ticket is never a private Forum thread.** Only the requester may make it public (a Forum Help thread).
- **The requester's response is filtered on the SERVER**: internal notes, internal files and unsent drafts are not in it.
- **Agents propose, humans ratify.** A staff-side agent's reply is a draft; only a HUMAN moderator/admin sends it
  (`ratifyDraft`). A CHECK and a trigger on `support_messages` hold the same rule. There is no agent tool that sends.
- **An agent is never staff**, whatever its role column says (`isStaff` tests `kind === 'human'`).
- Engineering work is a XENO Tasks task (`linkTask`); moving it to done writes the fix back (`taskDone`, called from
  `xenoTasks.transitionTask`). Mail only when `SUPPORT_EMAILS` is exactly `true` (in compose's `environment:` too).
- Proofs: `npm run test:support-tickets` (real Postgres, mutation-checked) and `npm run test:support-ui` (browser).

## 🤝 XENO Customers lives HERE — Corpo › Customers, the workspace CRM (2026-10-20)

`services/customers.js` (the one service), `routes/customersRoutes.js` (`/api/customers`), `services/customersMcp.js`
(`customers.*`), screens `prototypes/xeno-workspace/platform-customers.js` at
`/workspace/corpo/spaces/customers[/contacts|/pipeline|/companies|/import|/duplicates|/contacts/<id>]`.

- **The WORKSPACE owns contacts, companies and deals** (§8.11): viewers read, editors write, a HUMAN admin deletes
  and GDPR-erases (erasure leaves a tombstone in `crm_erasures` with no personal data).
- **Agents read and DRAFT.** An agent's note is `state='draft'` and its deal `state='draft'` until a person keeps or
  confirms it; a CHECK and a trigger on `crm_activities` hold the note rule. No agent tool deletes, erases, merges,
  exports, keeps, confirms or runs an import (it may preview one).
- **Links, not copies.** Support tickets on a contact come from `supportTickets.getTicket` as the caller (explicit
  links + tickets raised from this workspace by that email); tasks are XENO Tasks. A link never shows what its owner hides.
- **Dedupe**: one contact per email per workspace (unique index); CSV import is a dry run unless `confirm`, skips or
  fills blanks on an existing email, never overwrites.
- Proofs: `npm run test:customers` (real Postgres, 60 checks, mutation-checked ×4) and `npm run test:customers-ui`.
## ✉️ Office › Mail is a FRONT-END to XENO Mail (2026-10-23)

`services/xenoMail.js` (the one service) → xeno-mail's capability surface, server-to-server, with a 60 s platform-signed
assertion (`aud xeno-mail`, same contract as Publish). Routes `mailRoutes.js` (`/api/mail`), agents `mailMcp.js`
(`mail.*`), screen `platform-mail.js` at `/workspace/office/spaces/mail/<folder>[/<thread id>]`. Record: `docs/MAIL-XENO-MAIL.md`.
- **No mail is stored here** — only which of the person's own addresses a workspace reads (`mail_workspace_mailboxes`,
  carried as `mail_address`; mail-core binds it or refuses, never falls back) and ids of agent drafts.
- **Sending is a person's, with `confirm: true`** (the screen asks twice). An agent's send becomes a draft; MCP has no
  send/discard/mailbox tool; mail-core refuses `act` on irreversible capabilities too.
- Fails closed without `XENO_MAIL_API_URL`. mail-core's VM (132) was STOPPED on 2026-10-23 — see the record's Hosting.
Proofs: `npm run test:workspace-mail` (real Postgres + fake mail-core), `scripts/workspace-mail-mutation-check.mjs`, `npm run test:mail-ui`.

## 📅 Corpo › Scheduling lives HERE (2026-10-20)

`services/scheduling.js` is the one service (screen `platform-scheduling.js`, routes `schedulingRoutes.js`, agents
`schedulingMcp.js`, read-only). Rules that are easy to break:
- **Time off is People's** (`workforce_time_off`, written only by `workforcePeople.js`); hours default to the People
  profile, `scheduling_availability` is the booking-hours override. Never add a second time-off table.
- **A booking page is a public link — a person's act.** The service refuses agents and a trigger refuses an
  agent-created page. Double bookings are refused by the service lock AND the `scheduling_booking_no_overlap` trigger.
- Guest pages (`/api/scheduling/book/<slug>`, `/manage/<token>`, `/feed/<token>.ics`) need no account and no JS;
  they sit under `/api/` so the site gate does not hide them. Tokens are stored as hashes only.
- Mail is OFF unless `SCHEDULING_EMAILS=true` (listed in compose). Bookings show in Places/assignment through
  `workforcePeople.availability*` (`reason: 'in_meeting'`).
Proofs: `npm run test:scheduling` (real Postgres, 58 checks, mutation-checked ×4), `npm run test:scheduling-ui`.

## ⚙️ Dev › Automate IS XENO Workflow — never a second engine here (owner, 2026-10-23)

*"for automate we already have xeno workflow that needs to power this … why are you inventing stuff that we already
have as products?"* Decision record: `docs/AUTOMATE-XENO-WORKFLOW.md`. The engine is xeno-workflow's own, run by its
headless runner (`xeno-workflow/src/headless`, `docs/HEADLESS-RUNNER.md`). This repo stores the graphs, delivers the
triggers and owns the authority: `services/xenoWorkflow.js`, `routes/automateRoutes.js` (`/api/automate`, webhooks
at `/api/automate/hooks/:id`), `workers/automateWorker.js` (leader only), `services/automateMcp.js`, screens
`platform-automate.js`.
- **Never add workflow execution logic here.** A node type, a retry rule or a step runner belongs in xeno-workflow.
- **A run acts only through `/api/v1`**, with a per-run `xwk_` key for the workflow's OWN agent. That agent is granted
  exactly the capabilities its graph calls, and only once a PERSON enables the workflow (a DB trigger refuses an
  agent). Do not hand the runner any other credential.
- Events are idempotent per `(workflow, event_key)`. A ticket event carries no title or body.
- Unset `XENO_WORKFLOW_RUNNER_URL` means nothing runs (fail closed). Proofs: `test:xeno-workflow`,
  `test:xeno-workflow-e2e` (needs the built runner bundle), `test:automate-mutation`, `test:automate-ui`.

## 📦 The release record is XENO Index's governance core — HOSTED here (owner, 2026-10-20; owner moved, 2026-10-23)

🔴 **The code is OWNED by `xeno-index`** (`packages/index/src/governance/`, `@xenosystem/index/governance`; decision
`xeno-index/docs/decisions/0001-release-governance-record.md`). This repo HOSTS it: the tables (its migrations), identity,
entitlements (injected in `services/releaseRecord.js`, fail-closed), `/api/releases`, the MCP transport and the screens —
which are the Index's UI surface. The code is vendored byte-identical in `src/server/vendor/xeno-index/governance/`
(+ `SOURCE.json`); `services/release*.js` are re-export shims so every import, URL and tool is unchanged.
**Never edit the vendored files** — change xeno-index, then `node scripts/index-governance-vendor.mjs --sync --confirm`.
`npm run test:index-governance-vendor` fails on an edited copy, a stale copy, or a migration that differs from the Index
schema. A schema change = a new migration here AND the same bytes in `xeno-index/packages/index/schema/`. Never start a
second release/changelog record.

One record, three layers: the service (vendored, via `services/releaseRecord.js`), `routes/releaseRoutes.js` (`/api/releases`),
`services/releasesMcp.js` (`releases.*`), screens `prototypes/xeno-workspace/platform-releases.js` at
`/workspace/releases[/deploys[/<id>]|/features[/<id>]|/notes|/whats-new]`.

- **Deploys are written by the deploy, never by hand.** `scripts/deploy-platform.mjs` pipes the facts it observed to
  `src/server/scripts/record-deploy.mjs` inside the backend container at the end of every deploy, OK or failed. A
  "RELEASE RECORD NOT WRITTEN" line is a defect to fix, not noise.
- **History is imported, never typed:** `npm run release-history -- collect --out h.json` (gh + the box's
  `.deploy/deploy.log`, read-only), then `import --file h.json` — DRY-RUN by default, `--confirm` to write, idempotent.
  Deploys from the log are `reconstructed` with the log as evidence; the log never recorded who deployed, so that stays
  empty. Features grouped from PR titles are `derived`.
- **A PR names its feature** with a `Feature: <slug>` line (`.github/pull_request_template.md`).
- **Nothing is public by default.** A customer's What's new shows a note only when it is APPROVED by a human on staff,
  its feature is LIVE, and the feature is enabled for them (all / plans / workspaces). The customer read selects only
  the note's words and date. Approving or enabling is a person's act: no agent tool, and a trigger refuses an agent's
  or non-staff approval.
- Proofs: `npm run test:release-record` (real Postgres), `test:release-record-mutation` (5 mutations, all caught),
  `test:releases-ui` (browser), `scripts/release-history.test.mjs`.

## Project-aware chat: context must reach the model, not only the audit

`services/chatProjectContext.js` supplies persisted project identity, instructions and authorized file retrieval.
`routes/aiRoutes.js` must inject `buildUntrustedProjectDataMessage(contentBlocks)` BEFORE token estimation
and provider dispatch, exactly as the non-streamed and scheduled paths do. Reporting `projectSources` is
not proof the model received them: streamed turns previously reported sources while omitting their contents.
`services/chatProjectKnowledge.js` exposes bounded read-only `read_project` sections through the existing
streamed tool loop: conversations/active history, project-linked library files/search, canonical XENO Tasks,
schedules and activity. Bind scope server-side, recheck access on every call, refuse mismatched persisted
conversation/project pairs, and treat returned content as untrusted evidence. This grants no local-machine
access or access to unrelated library records. Regression suites: `stream-project-context.test.mjs` and
`chat-tool-loop.test.mjs`. Local source work is not deployment or real-model acceptance evidence.

## 🪪 An agent's identity is an Anima Mind; skills are the open Agent Skills format (owner, 2026-10-24)

Decision record: `docs/AGENT-IDENTITY-SKILLS-CORPUS.md`. WHO an agent is lives in its version as `persona: { role, body }`
(an Anima Mind body: `# Voice`, `# Style`, `# Boundaries`, `# Output` …) and is composed by `@xenosystem/anima-mind`'s own
`composePersonaPrompt` in `agentGuidance.identityOf` — first in every brief, task guidance and `agents_whoami`. Import and
export are mind.xeno through Anima's parser and injection scanner (`services/agentMind.js`). Never write a second
persona composer or format. Skills (`skills.js`) and their Marketplace listings (`marketplaceSkillPackages.js`, kind `skill`) are
immutable, hashed, pinned and never auto-updated; storage is moving into XENO Corpus per the record's §7 4a — follow
Corpus's record and digest, never invent a third skills model.
- **Corpus's code is vendored, never copied:** `src/server/vendor/xeno-corpus/` (`corpus-skill-format.mjs` = digest and
  records, `corpus-secret-rules.mjs` = THE skill secret gate), byte-identical, pinned in `SOURCE.json`, gated by
  `npm run test:corpus-skill-format-vendor`. Change xeno-corpus, then `--sync --commit <sha> --confirm`.
- **A skill file's bytes never change:** text inline (BOM/CRLF kept), anything else in `skill_objects` by its digest.
  Never decode an upload "to be safe" — that is what made binary skills impossible and digests disagree with Corpus.
- **`npm run test:skills-corpus-import`** with `XENO_CORPUS_STORE=<corpus>/skills` imports a real store read-only and
  fails if the platform ever disagrees with Corpus about a digest; with `XENO_REAL_SKILL_ROOTS=1` it also picks this
  machine's Claude Code / Codex / agy / workspace skill folders and requires Corpus's survey and digests exactly.
- **What a folder holds is Corpus's `detectBundles`; what a skill may do is `inspect`** (Corpus secrets + Anima
  take-over + Corpus malicious-skill rules). Never add a detection or risk rule here — change xeno-corpus and re-sync.
  block = never, confirm = a person's yes (`acknowledge`, people only), review = kept with the version.

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
| **Pin** (RUN-01's precondition) | `readRunnablePin`, `POST /api/workforce/run-admissions/pin` (`workforce:read`) | The CURRENT `{ resourceId, version, contentHash }` of an agent as runnable at one target, by this actor — what an admission must name. Resolved by the SAME `resolveRunnable` admission calls, so it refuses exactly where admission refuses. Writes nothing. Not resolved: conversation, root, entitlement, budget. It is NOT §11.1's `agent.resource.get`, which is still unbuilt. |
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
  that calls `authorize-step`. ✅ **The host half landed too** (xeno-agent-interface #73): a turn that
  names an admission runs under a `runAuthority`, on the SDK lane only. SDK #59/#60 add
  `createWorkforceRunAdmissionClient` (admit / revoke / authority), and `/run-admissions/pin` gives a
  host the pin it must name.
- ✅ **A real user action admits a run (2026-10-19).** Pressing Run on the agent page
  (`agentCloudRuns.start`) admits through `admitAccountRun` before anything starts; the run row carries
  `admission_id`. Revoking that admission (from anywhere) stops the hosted run on the next refresh, revokes
  its credential, and the runner can no longer mint one — the service checks the fence and a trigger
  (`20261019090000-agent-cloud-runs-admission.sql`) refuses it too. Gate: `agent-cloud-runs.test.mjs`,
  mutation-checked on both halves. ⚠️ The hosted runner bills its own ledger hold as well, so a run reserves
  its budget twice while live (the admission hold is released when the run ends). Removing the duplicate is
  the runner forwarding leases (xeno-agents-api), not a platform change.
- ✅ DIV-08 **is** checked at admission (`resolveRunnable` → `actsInDivision`) and on every step. This line
  said otherwise; re-measured 2026-10-19.
- ✅ FUND-06 project pools exist: `budget.fundingBudgetId` admits against a project funding pool
  (`workforceRunFunding.js`), with no personal fallback. This line said none existed; re-measured 2026-10-19.

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

## 🔗 The credit ledger proves itself, and the app does not run as the database admin (owner, 2026-10-30)

Read `docs/LEDGER-OPERATIONS.md` before touching `credit_transactions` or reacting to a `[LedgerChain]` log line, and
`docs/DATABASE-ROLES.md` before changing a migration or a database credential. Record:
`docs/decisions/2026-10-30-ledger-chain-v2.md`.

- **The DATABASE numbers and fingerprints every journal row** (trigger `ledger_chain_append`), from any writer. Never compute
  a chain hash in application code, and never recompute an existing one: history is sealed, not rewritten.
- **Every hour the heads are signed and written to `xeno-artifacts/ledger-anchors/`** under a ten-year retention lock. A
  disagreement with the bucket blocks new checkpoints on purpose. Do not "clear" it; read the operations doc.
- **The app connects as `xeno_app`: data only.** Never run DDL during a request: it fails in production on whichever request
  reaches it, and tests run as a superuser so they will not notice. `scripts/no-request-time-ddl.test.mjs` refuses it.
- **Schema changes go in a migration, applied by the `migrate` job before the swap.** That job is the only service holding
  `POSTGRES_PASSWORD`, and a gate refuses it anywhere else.
- A scripted fake DB in a test must answer `to_regclass` presence checks; billing helpers ask before any fallback DDL.

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

## 🧭 EVERY view has a real address — id-based, parent in the path (MANDATORY, owner 2026-10-11)

Every page, record, tab and nested object in the workspace gets a URL that survives refresh, Back/Forward
and sharing. It is built from **stable ids, never display names**, and the **parent is in the path**; the
breadcrumb shows the same hierarchy by name. Found the hard way: project chats lived at
`/workspace/apps/chat/<chat-id>` with "Chat / New chat" on a project page, and projects and members were
addressed by name, so a rename broke every link and two same-named records collided.

| View | Address |
|---|---|
| chat in a project · project home · loose chat | `/workspace/apps/chat/projects/<pid>/c/<cid>` · `…/chat/projects/<pid>` · `…/chat/<cid>` |
| project + tab | `/workspace/projects/<pid>[/tasks\|conversations\|team\|resources\|funding\|activity]` · archived: `/workspace/projects/archived` |
| workspace member / agent | `/workspace/workspace/Members/<member id>` · `…/Agents/<id>` |
| task | `/workspace/[<area>/]tasks/T-<n>` |
| library selection | `?sel=<id>,<id>` on the page's own path |

**How it is built, so the next view follows it:** inside the router a record may keep its listing key; the
translation to the id form happens **only at the address** (`stateToHash` / the start of `mainHTML` in
`prototypes/xeno-workspace/app.js`: `XENO_PROJECT_ROUTE`, `XENO_MEMBER_ROUTE`; the chat's in
`platform-chat.js` `pathFor`/`itemIn`). An id read before its list has loaded is kept and resolves when the list
arrives, and an **old link by name becomes the id link in place** (no extra Back step). Decide a new view's
URL before building it; prove refresh, Back and a fresh tab on it in a browser test (see `work-test.mjs`).

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
