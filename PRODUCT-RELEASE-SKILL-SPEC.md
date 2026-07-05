# XENO Product Release Skill — SPEC

Status: Implemented (2026-07-05)
Owner: xeno-platform (xenostudio.ai) — release infrastructure
Created: 2026-07-05
Last updated: 2026-07-05

> **Implemented — for all three agent CLIs.** Canonical sources in
> `release-guide/skill/`: `xeno-product-release.md` (XENO Agent CLI format) and
> `SKILL.md` (the open Agent Skills format shared by Claude Code + Codex). Installed:
> `.xeno/skills/xeno-product-release.md` (XENO Agent CLI),
> `.claude/skills/xeno-product-release/SKILL.md` (Claude Code),
> `.agents/skills/xeno-product-release/SKILL.md` (Codex). Validated: the XENO Agent CLI
> discovers it (`project:xeno-product-release [enabled]`, ~1044 tokens); all frontmatter
> parses (open-standard `name`=folder=`xeno-product-release` + `description`); only real
> scripts referenced; primary command (`xeno-release.mjs publish … --dry-run`)
> dry-run-verified (no upload). Open question §22.1 resolved to v1: publishers run from
> the `xeno-platform` repo (skill Safety §0). NOTE: the open standard requires only
> `name`+`description`; the XENO Agent CLI variant adds `id`/`enabled`/`visibility` (§11).

> Companion to `release-guide/` (the playbook) and `PRODUCT-LANDING-SPEC.md` /
> `PRODUCT-PAGES-SPEC.md` (the surfaces). This spec defines a **XENO Agent CLI
> skill** — `xeno-product-release` — that makes the playbook *invocable* from the
> agent CLI so you can say "release xeno-pixel 0.6.4" and the agent runs the
> release correctly, deferring to the guide for verbatim commands.

---

## 1. Executive Summary

We have a complete, verified release playbook in `release-guide/` (8 files) and the
real publishers (`scripts/xeno-release.mjs`, `scripts/publish-cli-releases.mjs`,
`scripts/seed-releases.mjs`). Today an agent only follows it if a human tells it to
read the folder. This spec defines **`xeno-product-release`**, a XENO Agent CLI skill
that is the *invocable front-end* to that playbook: a thin, progressive-disclosure
markdown skill the agent loads on demand ("release …", "cut a patch", "publish the
new build"), which encodes the **release decision tree** (installer vs CLI vs content
release), enforces the **safety gates** (dry-run, confirm-before-publish, never
overwrite, never print secrets), and points to the exact `release-guide/0X-*.md`
sections for the commands. The skill orchestrates; `release-guide/` remains the single
source of truth.

Outcome: a repeatable, low-risk "release" verb in the agent CLI that produces a
correct R2 + website + Hub update every time, with no re-discovery and no improvised
commands.

## 2. Background & Problem Statement

- **Playbook exists, trigger doesn't.** `release-guide/` + `CLAUDE.md`/`agents.md`
  tags make the process discoverable, but discovery is passive — an agent must be
  told to read it. There is no first-class "release" capability.
- **Releases are error-prone when improvised.** The recurring failures this project
  hit (CLI releases never appearing on the site because no `releases.json` was
  written; naming drift between docs and the real scripts; skipped verification) all
  stem from ad-hoc release execution. A skill that always routes through the guide
  removes that class of error.
- **The agent CLI already has skills** (built-in + user + project), including a
  *generic* built-in "Release" skill ("Prepare a package release without skipping
  publishability gates"). That generic skill is about local publishability; it is
  **not** the XENO-platform release (R2 + `xeno-release.mjs` + site). We need the
  platform-specific counterpart.
- **Multi-repo reality.** Product code lives in product repos (`xeno-pixel`, …) but
  the publishers run **from `xeno-platform`**. A release skill must handle "invoked
  from a product repo" by locating/using the platform tooling.

## 3. Goals

- G1. A single invocable skill that runs a XENO product release end-to-end, correctly, via the existing playbook + publishers.
- G2. Encode the **decision tree** so the agent picks the right path from the product's `delivery` type (desktop / web / cli / soon) and the change kind (new binary vs content/docs).
- G3. Enforce **safety**: dry-run first, explicit human confirmation before any R2 upload or deploy, never overwrite an existing installer, never print/handle secrets.
- G4. **Progressive disclosure** — the skill body stays lean (<~5,000 tokens) and pulls in `release-guide/0X-*.md` only as needed.
- G5. **Portable** — ships and travels with `release-guide/`; one canonical source, copied into any product repo.
- G6. Keep `release-guide/` the **single source of truth** — the skill references it, never forks the commands.

## 4. Non-Goals

- N1. Not re-documenting the release process — the skill points at `release-guide/`, it does not duplicate it.
- N2. Not changing the publishers (`xeno-release.mjs`, etc.), the R2 layout, or the deploy flow — those are fixed by `PRODUCT-PAGES-SPEC.md`/`release-guide/`.
- N3. Not building app code or CI — the skill assumes a build artifact exists (or a content change is committed).
- N4. Not automating irreversible steps without human sign-off (uploads, deploys stay confirmation-gated).
- N5. Not a replacement for the built-in generic "Release" skill (local publishability) — this is the platform release.

## 5. Repository Findings

**Skill system (xeno-agent-cli — `apps/xeno-agent-cli/src/skills/runtime.ts`, `src/commands/skills.ts`):**
- Skills are **markdown files with YAML frontmatter**. `ParsedSkillFrontmatter` fields: `id`, `name`, `title`, `description`, `enabled`, `arguments`/`argumentSchema`, `allowedTools`/`tools`, `agent`/`customAgent`, `team`/`agentTeam`, `visibility`/`visible`.
- Discovery: **project** skills at `<cwd>/.xeno/skills/` and **user** skills at `~/.xeno-agent/skills/` (`getConfigDir()/skills`); plus built-in and plugin sources. Enable/disable state in `.xeno/skills.json` (project) and `~/.xeno-agent/skills.json` (user), shaped `{enabled:[], disabled:[]}`.
- Scaffold (`skillTemplate`): `xeno skills create <name>` writes:
  ```md
  ---
  id: <slug>
  name: "<Name>"
  description: "<desc>"
  enabled: true
  visibility: visible
  ---

  <body>
  ```
- Management: `xeno skills create`; in-session `/skills list | inspect | enable | disable`. Records carry `estimatedTokens` (context cost) and `source`.
- A **built-in "Release" skill** already exists (generic publishability) — ours must be a distinct, clearly-scoped platform skill.

**Release infrastructure (this repo):**
- Publishers: `scripts/xeno-release.mjs publish --app <slug> --version … --channel stable --type release|patch|hotfix [--severity] [--title] (--notes|--notes-file) [--win|--mac|--linux] [--dry-run]` (desktop/installer, canonical); `scripts/publish-cli-releases.mjs --app --pkg --notes [--dry-run]` (CLI/npm, feed = npm dates ∩ the CLI's `RELEASE_NOTES`); `scripts/seed-releases.mjs` (one-off bootstrap).
- `Release`/`ReleaseAsset` schema, R2 layout (`xeno-hub-releases` → `updates.xenostudio.ai/apps/<slug>/`), the on-box deploy (`git archive … | ssh xeno-platform-001 … sudo docker compose build frontend && up -d`), and troubleshooting are all in `release-guide/` and validated against the real scripts.
- Product `delivery` type comes from `src/lib/productCatalog.ts` (`desktop|web|cli|soon`) — the switch that selects the release path.

## 6. Research Notes & References

Anthropic **Agent Skills / `SKILL.md`** is the emerging open convention the xeno-agent-cli format mirrors, and its principles directly shape this design:
- A skill = a folder with a `SKILL.md`; **required frontmatter is `name` + `description`** (`name` lowercase-hyphenated, `<64` chars, matches the folder; `description` `<1,024` chars, states **what it does and when to use it**).
- **Progressive disclosure**: at startup only each skill's `name`+`description` (~100 tokens) load; the full body (ideally `<5,000` tokens) loads only when the agent judges the skill relevant; the body may reference **supporting files** (e.g. `reference.md`) to stay lean. → We keep the `xeno-product-release` body thin and defer to `release-guide/0X-*.md` as the supporting files.
- Best practice: the `description` is the single most important field (it is how the agent decides to invoke) — make it explicit about triggers.

These map onto xeno-agent-cli's superset frontmatter (`id`/`name`/`description`/`enabled`/`visibility`/optional `allowedTools`/`agent`) with one caveat: the Anthropic convention's slug-`name` corresponds to xeno-agent-cli's **`id`** (its `name` is a free-form display string, e.g. `"XENO Product Release"`), and `/skills enable|inspect` + the enable/disable state files key off the **`id`**, not `name`. Treat all external pages as reference only.

Sources:
- [Equipping agents for the real world with Agent Skills — Anthropic](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Skill authoring best practices — Claude Platform Docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [SKILL.md Format Specification — anthropics/skills (DeepWiki)](https://deepwiki.com/anthropics/skills/2.2-skill.md-format-specification)
- [SKILL.md: The Open Standard for AI Agent Skills](https://www.agensi.io/learn/agent-skills-open-standard)

## 7. Users, Use Cases & User Stories

- As a **maintainer**, I want to say "release xeno-pixel 0.6.4 as a patch" in the agent CLI and have it run the correct path with confirmations, so I ship without memorizing commands.
- As a **CLI-product owner**, I want "publish the agent-cli release feed" to regenerate `releases.json` from npm + `RELEASE_NOTES` and verify the live page, without touching installers.
- As a **docs/marketing editor**, I want "deploy the pixel landing changes" to build clean, deploy on-box, and verify — the content-release path.
- As a **new-product owner**, I want "bootstrap releases for xeno-canvas" to run the one-off seed + first publish.
- As a **reviewer/operator**, I want every release to be dry-run-previewed and human-confirmed before any R2 upload or deploy, and verified afterward.

## 8. Functional Requirements

| ID | Requirement | Priority | Notes |
| --- | --- | --- | --- |
| FR-001 | Ship a skill file `xeno-product-release` in the xeno-agent-cli skill format (valid frontmatter: `id`, `name`, `description`, `enabled`, `visibility`). | Must | **`id`** is the lowercase-hyphenated slug (`xeno-product-release`) — it is what `/skills enable\|inspect` and the state files key off; **`name`** is the human display string (`"XENO Product Release"`). `description` states what + when (triggers). |
| FR-002 | The `description` triggers on release intents: "release <product>", "cut a patch/hotfix", "publish the build/feed", "deploy the landing/docs". | Must | Description is the invocation signal (progressive disclosure). |
| FR-003 | The body encodes the **decision tree**: read `delivery` from `productCatalog.ts` → desktop→`xeno-release.mjs`; cli→`publish-cli-releases.mjs`; content/docs change→build+deploy; new product→`seed-releases.mjs` then publish. | Must | See §10. |
| FR-004 | The body defers to `release-guide/` for verbatim commands (cite the exact file per step), never inlining a full command set that could drift. | Must | Single source of truth (G6). Short canonical command stubs allowed; deep detail by reference. |
| FR-005 | Enforce safety gates: (a) run the publisher with `--dry-run` first and show the plan; (b) require explicit human "yes" before the real upload/deploy; (c) never overwrite an existing installer/version; (d) never print or paste secrets/tokens. | Must | §13. |
| FR-006 | Always run the **verification** step (curl the R2 JSON + the live `/product/<slug>` 200 / `download/<os>` 302; headless screenshot for content releases) and report results. | Must | From `release-guide/06`/`07`. |
| FR-007 | Handle "invoked from a product repo": detect that publishers live in `xeno-platform` and operate against the local `xeno-platform` checkout (or instruct the user how). | Must | §22 open question on discovery. |
| FR-008 | Accept structured inputs when given (`<slug>`, `<version>`, `type`, `channel`, notes source) and otherwise ask the minimum needed. | Should | May use frontmatter `arguments`/`argumentSchema`. |
| FR-009 | Be enabled by default in repos that ship it (`enabled: true`), discoverable via `/skills list` and `/skills inspect xeno-product-release`. | Should | Project skill checked into the repo. |
| FR-010 | Provide a canonical source of the skill in `xeno-platform` that installs into `.xeno/skills/` and travels when `release-guide/` is copied to a product repo. | Should | §18 rollout. |
| FR-011 | Distinguish itself from the built-in generic "Release" skill in its description (platform release → R2 + site, not local publishability). | Should | Avoid ambiguous double-trigger. |

## 9. Non-Functional Requirements

| ID | Requirement | Priority | Notes |
| --- | --- | --- | --- |
| NFR-001 | Body ≤ ~5,000 tokens; startup cost ≈ name+description only (progressive disclosure). | Must | Keep detail in `release-guide/`. |
| NFR-002 | Safety: no irreversible action (R2 upload, deploy, git push, tag) without explicit human confirmation; dry-run precedes real run. | Must | Matches platform release-safety norms. |
| NFR-003 | Secret hygiene: never echo tokens/keys; rely on the preconfigured `rclone r2:` remote and `ssh` config; do not embed credentials in the skill. | Must | §13. |
| NFR-004 | Maintainability: zero command duplication that can drift from the publishers; when the guide changes, the skill should not need edits (it references, not copies). | Should | Verified by a drift check (§17). |
| NFR-005 | Portability: repo-agnostic; product-specific values are placeholders (`<slug>`, `<version>`). | Should | Same rules as `release-guide/`. |
| NFR-006 | Observability: each run prints what it did (path chosen, dry-run output, files uploaded, verification results). | Should | §15. |

## 10. Proposed Solution

**Shape.** One markdown skill, `xeno-product-release`, in the xeno-agent-cli format,
checked into each releasing repo at `.xeno/skills/xeno-product-release.md`, with the
canonical source living in `xeno-platform` alongside `release-guide/`.

**Control flow encoded in the body (thin; commands by reference):**

1. **Identify the product + change.** Determine `<slug>` and read its `delivery` from `productCatalog.ts`. Ask: is this a new *binary/version* or a *content/docs* change? (or both.)
2. **Route (decision tree):**
   - `delivery: desktop` + new build → **installer release** via `node scripts/xeno-release.mjs publish …` (see `release-guide/03-release-data.md §6.1`, runbook Track A).
   - `delivery: cli` + new npm version → **CLI feed** via `node scripts/publish-cli-releases.mjs …` (`03 §6.2`).
   - **content/docs change** (landing or docs module) → author (per `05-landing-and-docs.md`) → `npm run build` (clean) → on-box deploy (`04-build-and-deploy.md`) → verify. (Track B.)
   - **new product / empty feed** → `seed-releases.mjs` bootstrap first (`03`).
   - `delivery: web` → no installer; only content releases apply.
3. **Dry-run + confirm.** Run the publisher with `--dry-run`, show the plan (files, versions, R2 targets), and **wait for explicit human confirmation** before the real run / deploy.
4. **Execute** the confirmed path using the verbatim commands from the cited guide file.
5. **Verify** (curl R2 JSON, live page 200 / download 302, screenshot for content) and **report**. On failure → `release-guide/07-troubleshooting.md`.
6. **Record** — commit any content changes with the project's message convention before deploy (Track B); note the version/tag.

**Why a skill, not just the guide:** progressive disclosure gives an on-demand "release" verb without bloating every session's context; the body carries the *decision + safety*, the guide carries the *commands*.

**Alternatives considered:**
- *Global/user skill only* (`~/.xeno-agent/skills/`): available everywhere but not version-controlled and can drift from the repo's `release-guide/`. → Offer as an optional install, but the **project skill checked into the repo is primary** (versioned, travels with the guide).
- *A `xeno release` CLI subcommand instead of a skill*: heavier, needs code in xeno-agent-cli, and duplicates the publishers already in xeno-platform. Rejected — the skill wrapping existing scripts is lighter and keeps one source of truth.
- *Fully autonomous release (no confirm)*: rejected on safety (irreversible R2/deploy).

## 11. Interface Contract (the skill)

**File:** `.xeno/skills/xeno-product-release.md` (project) — canonical source `xeno-platform` (see §18).

**Frontmatter (xeno-agent-cli fields):**
```yaml
---
id: xeno-product-release
name: "XENO Product Release"
description: "Release a XENO product to R2 + xenostudio.ai + Hub. Use when the user
  wants to publish a new version (desktop installer or CLI/npm), cut a patch/hotfix,
  regenerate a release feed, or deploy landing/docs changes. Routes to the correct
  path and follows release-guide/. NOT for local package publishability (that is the
  built-in Release skill)."
enabled: true
visibility: visible
---
```

**Invocation:** natural-language intents matching the `description` ("release <slug>
<version>", "cut a hotfix for hub", "publish agent-cli feed", "deploy pixel docs").
Also explicitly manageable: `/skills enable xeno-product-release`,
`/skills inspect xeno-product-release`.

**Inputs the body will resolve (ask if absent):** `<slug>`; release kind
(installer / cli-feed / content / bootstrap); `<version>` + `type`
(`release|patch|hotfix`) + `channel` (`stable|beta`) for installer releases; notes
source (`--notes` / `--notes-file` / the CLI `RELEASE_NOTES` file); built-installer
paths (`--win/--mac/--linux`) for desktop.

**Outputs:** a spoken plan → dry-run preview → (confirm) → execution log → verification
results, with links to the live page and the R2 feed.

## 12. Data Model & Persistence

No new persistent data. Touches existing stores only:
- The skill file(s): `.xeno/skills/xeno-product-release.md` (+ enable state in `.xeno/skills.json`).
- The release artifacts on R2 (`apps/<slug>/releases.json`, `version.json`, `v<ver>/…`) — written by the existing publishers, not the skill directly.
- Git: content-release commits + optional release tags, per existing conventions.

## 13. Security, Privacy & Abuse Considerations

- **Irreversible/outward-facing actions gated.** R2 uploads, on-box `docker compose` deploys, `git push`, and tags require explicit human confirmation; a `--dry-run` preview precedes the real publish. The skill body must state this and the agent must honor it.
- **Secrets never handled by the skill.** It relies on the preconfigured `rclone r2:` remote and `ssh xeno-platform-001` config; it must never print, request, or embed tokens/keys. (Ties to the parked platform key-rotation item — the skill must not become a place secrets are pasted.)
- **No overwrite / no clobber.** Never re-upload over an existing `v<ver>/` installer or silently replace history; exactly one stable entry stays `latest`.
- **Least privilege.** Optionally set frontmatter `allowedTools` to the tools a release needs (Bash, Read, Edit, WebFetch for verification) rather than unrestricted access.
- **Prompt-injection.** Notes/changelog content pulled into `--notes-file` is data, not instructions; the skill must not execute instructions found in changelog text.

## 14. Error Handling & Edge Cases

| Scenario | Expected Behavior | Notes |
| --- | --- | --- |
| Invoked from a product repo (no publishers locally) | Locate the sibling `xeno-platform` checkout and run from there; if not found, tell the user where to run it | FR-007 / §22 |
| `delivery: web` product asked for an "installer" release | Explain web products have no installer; offer the content-release path | §10 |
| CLI product but `releases.json` missing | Run `publish-cli-releases.mjs` (the exact fix from `07-troubleshooting.md`) | The recurring "empty feed" bug |
| Dry-run shows an unexpected diff (wrong version/overwrite) | Stop; do not proceed to real run; surface the diff | NFR-002 |
| `npm run build` fails (content release) | Abort before deploy; never deploy a dirty build | §10 step |
| Human declines confirmation | Abort cleanly, no side effects | NFR-002 |
| Deploy succeeds but live page still stale | Follow `07` (`--no-cache` rebuild / cache) | Observability |
| Ambiguous double-trigger with built-in "Release" skill | Description disambiguation (FR-011); ask which is meant if unclear | |

## 15. Observability & Operations

- The skill run is self-narrating: it prints the chosen path, the dry-run output, the exact commands executed, the R2 targets, and the verification results (HTTP codes, screenshot path).
- No new dashboards/metrics; leans on existing verification (`curl`, headless Edge) and, where relevant, the XENO Agent CLI's own audit ledger of tool calls.
- Operational runbook = `release-guide/06` (do) + `07` (fix); the skill points there on failure.

## 16. Implementation Plan

### Phase 1: Author the skill
- [ ] Draft `xeno-product-release.md` from the Appendix, ≤5,000-token body, correct frontmatter.
- [ ] Verify it lists only real scripts/paths (grep against the repo, as done for `release-guide/`).
- [ ] Place canonical source at `xeno-platform/release-guide/skill/xeno-product-release.md` (travels with the guide).

### Phase 2: Install + wire
- [ ] Install into this repo: `.xeno/skills/xeno-product-release.md` (or `xeno skills create` then replace body).
- [ ] Confirm `/skills list` shows it enabled and `/skills inspect` renders it.
- [ ] Note in `release-guide/README.md` "Wire it into your project" that copying the folder also installs the skill (add the copy step).

### Phase 3: Dry-run validation
- [ ] Exercise each path in dry-run: an installer release (`--dry-run`), a CLI feed (`--dry-run`), and a content-release plan — without real uploads/deploys.
- [ ] Confirm safety gates fire (no action without confirmation).

### Phase 4: Roll out to product repos
- [ ] With `release-guide/`, copy the skill into the priority product repos; add the tag lines.

## 17. Testing Strategy

| Test Area | Coverage | Notes |
| --- | --- | --- |
| Static / lint | Frontmatter parses (matches `ParsedSkillFrontmatter`); body token estimate under budget; only real script names/paths (grep) | Reuse the `release-guide` verification approach |
| Behavioral (dry-run) | Each decision-tree branch reaches the right publisher with `--dry-run`; no real side effects | Manual, in a scratch session |
| Safety | Real upload/deploy never happens without explicit confirm; declined confirm = no side effect | Must-pass |
| Drift | Commands cited in the skill still exist in the publishers (`--flags` match `xeno-release.mjs`) | Guards NFR-004 |
| Integration (opt-in, real) | One low-risk real CLI-feed publish end-to-end, verified live | Only when a real release is due |

## 18. Rollout, Migration & Rollback

- **Canonical source:** `xeno-platform/release-guide/skill/xeno-product-release.md`. Installers/copies land at `<repo>/.xeno/skills/xeno-product-release.md`.
- **Migration:** additive — no change to publishers, R2, or the deploy. Existing manual runs keep working.
- **Rollback:** delete or `/skills disable xeno-product-release`; the `release-guide/` playbook remains usable directly.
- **Compatibility:** coexists with the built-in generic "Release" skill (distinct description/scope).

## 19. Documentation Updates

- `release-guide/README.md` — add the skill to the "Wire it into your project" section (copy `skill/…` → `.xeno/skills/`) and mention "or just say 'release …' to trigger it."
- `CLAUDE.md` / `agents.md` (repos that ship it) — one line: "A `xeno-product-release` skill wraps this; invoke it by asking to release."
- `PRODUCT-LANDING-SPEC.md` §8 — cross-link the skill as the invocable path.

## 20. Acceptance Criteria

- [ ] `xeno-product-release.md` exists with valid frontmatter and a ≤5,000-token body; `/skills inspect` renders it.
- [ ] Its `description` triggers on release intents and disambiguates from the built-in Release skill.
- [ ] The body routes desktop→`xeno-release.mjs`, cli→`publish-cli-releases.mjs`, content→build+deploy, new→`seed-releases.mjs`, and cites the exact `release-guide/0X-*.md` per step.
- [ ] Every path dry-runs and requires explicit confirmation before any R2 upload / deploy; no secrets are printed.
- [ ] Every path ends with the verification step and a reported result.
- [ ] Only real scripts/paths/flags appear (grep-verified against the repo).
- [ ] The skill travels with `release-guide/` (documented install step).

## 21. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Skill body drifts from the real publishers over time | Wrong commands, failed release | Med | Reference the guide (don't copy commands); drift test (§17); guide is single source |
| Double-trigger with built-in "Release" skill | Wrong path chosen | Med | Explicit disambiguating `description`; ask when unclear (FR-011) |
| Agent skips the confirm/dry-run gate | Irreversible bad upload/deploy | Low/High-impact | Gate stated emphatically in body + NFR-002; least-privilege `allowedTools` |
| Invoked from a repo without the platform tooling | Can't run publishers | Med | FR-007 discovery of the `xeno-platform` checkout; clear fallback message |
| Secret pasted into the skill/session | Leak | Low/High-impact | NFR-003 — skill never handles secrets; rely on preconfigured remotes |
| Token bloat if body grows | Higher per-session cost | Low | Enforce budget; push detail into `release-guide/` (progressive disclosure) |

## 22. Open Questions

| Question | Blocking? | Suggested Owner | Notes |
| --- | --- | --- | --- |
| Where does the skill run publishers from when invoked in a product repo? (locate sibling `xeno-platform` checkout by a known path/env, vs require running from `xeno-platform`) | Yes | platform | Affects FR-007; simplest v1 = "run from xeno-platform; if elsewhere, cd to the local checkout" |
| Project skill (checked-in, versioned) as primary, with an optional user/global install? | No | platform | Recommended yes; confirm |
| Use frontmatter `arguments`/`argumentSchema` for structured inputs, or free-form Q&A? | No | platform | Start free-form; add schema if the CLI supports slash-invocation with args |
| Should it also update git tags automatically, or leave tagging to the human? | No | platform | Default: propose the tag, let the human confirm (safety) |
| Do we want a matching skill for **xeno-comms** (its own `publish-to-platform.mjs` wrapper) or fold it into the decision tree? | No | comms/platform | Comms uses a repo-local wrapper; the skill could special-case it |

## 23. Assumptions

- The XENO Agent CLI is the "codex CLI interface" the user referenced; its skill format (§5) is the target.
- `rclone r2:` and `ssh xeno-platform-001` are preconfigured on the operator's machine (as they are today).
- `release-guide/` is present in the repo where the skill runs (they ship together).
- The build artifact (desktop) or the committed content change (Track B) already exists when the skill is invoked — the skill releases, it does not build the app.
- Product `delivery` in `productCatalog.ts` is the source of truth for the path.

## 24. Appendix — Draft skill body

> Draft of `.xeno/skills/xeno-product-release.md` (frontmatter per §11). Trim to
> stay under the token budget; commands are stubs — the guide holds the full form.

```md
# XENO Product Release

Use this when the user wants to publish a XENO product to R2 + xenostudio.ai + the
Hub. This skill ORCHESTRATES; the exact commands live in `release-guide/` — read the
cited file before running anything. Never improvise release commands.

## 0. Safety (always)
- Preview with `--dry-run` first; show the plan.
- Get an explicit human "yes" before any real R2 upload, on-box deploy, git push, or tag.
- Never overwrite an existing `v<version>/` installer; keep exactly one stable `latest`.
- Never print or paste secrets; rely on the preconfigured `rclone r2:` remote and ssh config.
- Publishers run from the `xeno-platform` repo — if you're elsewhere, use the local xeno-platform checkout.

## 1. Identify
- Get `<slug>`; read its `delivery` from `src/lib/productCatalog.ts`.
- Ask: new binary/version, a content/docs change, or a first-time bootstrap?

## 2. Route  (details: release-guide/06-release-runbook.md)
- desktop + new build  → `node scripts/xeno-release.mjs publish --app <slug> --version <v> --type release|patch|hotfix (--notes|--notes-file) --win/--mac/--linux --dry-run`  (release-guide/03 §6.1)
- cli + new npm version → `node scripts/publish-cli-releases.mjs --app <slug> --pkg <pkg> --notes <RELEASE_NOTES.ts> --dry-run`  (release-guide/03 §6.2)
- landing/docs change   → author (release-guide/05) → `npm run build` (clean) → on-box deploy (release-guide/04) → verify
- new product/empty feed → `node scripts/seed-releases.mjs …` then publish  (release-guide/03)
- web product → no installer; only the content path applies

## 3. Dry-run → confirm → execute
Run the chosen command with `--dry-run`, show the plan, wait for confirmation, then run for real.

## 4. Verify  (release-guide/06 / 07)
- Release: `curl -s https://updates.xenostudio.ai/apps/<slug>/releases.json` (new entry present). Desktop only: `curl -sI https://xenostudio.ai/product/<slug>/download/win` (302 → installer). CLI: also check the live `/product/<slug>/releases` page renders the new version (a CLI has no installer 302).
- Content: `curl -sI https://xenostudio.ai/product/<slug>` (200) + a headless screenshot.
- On any failure → release-guide/07-troubleshooting.md.

## 5. Record
Commit content changes (project message convention) BEFORE deploy; propose a git tag and let the human confirm.
```
