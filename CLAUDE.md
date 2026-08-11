# CLAUDE.md — xeno-platform (xenostudio.ai)

This is the **XENO platform**: the marketing site + backend + the release
infrastructure for every XENO product. For the whole ecosystem, see the root
workspace `../CLAUDE.md`.

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
| **KIND (`human`/`agent`/`service`) and ROLE (`user`<`moderator`<`admin`) are ORTHOGONAL** | Canonical statement: `XENO ACCOUNT - ARCHITECTURE.md` §2.7. `service` currently sits in the *role* column — a conflation resolved on READ, never by migrating a live column. Authorize on `principal.role` (effective), never `rawRole`. |
| **An agent's effective role is capped by its owner's** | §3 — an agent "inherits a scoped SUBSET of its owner's grants", and a subset cannot exceed the set. Verified: an agent set to `role='admin'` directly in the DB still resolves as non-staff while its owner is a plain user. Escalation requires promoting the human, which is visible. |
| **Human-only actions test `kind === 'human'`, never "not an agent"** | The first version mapped everything-not-agent to human, so a **service account could accept answers** (Forum D6) — a machine ratifying a machine. Service principals are now refused from posting entirely: no owner means nobody to hold responsible. |
| **Auth is `api_keys`, an explicit stand-in** | `XENO ACCOUNT - ARCHITECTURE.md` §2.6 specifies `client_credentials` — **not implemented** on the provider, and adding a grant is gated by `XENO AUTH - SPEC.md` L13. `api_keys` already gives hashed storage, revocation, expiry and per-key rate limits. Swap later; the identity rows do not change. |

⚠️ **Two claims in `XENO ACCOUNT - ARCHITECTURE.md` are aspirational, corrected in-place there:**
`client_credentials` is not implemented, and there is **no `AGENT` role** (live roles are `user`,
`service`, `admin`).

**XENO Forum** (`/forum`, `/api/forum`) is its first consumer — v0.1/v0.2/v0.3 on `feat/forum`,
**not merged, not deployed**; production has no forum tables. Spec: root `XENO FORUM - SPEC.md`.

## Related references

- `security-guide/SKILL.md` — **the callable lockdown procedure** (`xeno-secure-website`): close every account-creation path, make suspension real, de-index correctly, deploy without an outage. Host-agnostic — covers `xeno-post-001`'s no-source-tree GHCR shape and `xeno-mail-001`'s verdaccio shape too.
- `PRODUCT-LANDING-SPEC.md` — the product landing-page + docs authoring contract (the 4-layer model, the docs system).
- `PRODUCT-PAGES-SPEC.md` — URLs, `releases.json` schema, download redirects, prerender.
- `RELEASE-TO-WEBSITE.md` — legacy release note (superseded by `release-guide/`).
- `XENO AUTH - SPEC.md` — **xeno-platform OWNS the account ORIGIN** (OIDC provider `/api/oauth2/*`: `src/server/routes/oauth2Routes.js` + `utils/oidcProvider.js`). The §13 provider prerequisites (loopback port-flex, `id_token` nonce, discovery ES256, scope down-scoping, admin register-client, RFC 8693 token-exchange, step-up, revocation denylist) are HARD-BLOCKERS every other product waits on — ship + verify them here BEFORE any product migrates to the unified auth.
