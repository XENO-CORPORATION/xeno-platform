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

## Related references

- `PRODUCT-LANDING-SPEC.md` — the product landing-page + docs authoring contract (the 4-layer model, the docs system).
- `PRODUCT-PAGES-SPEC.md` — URLs, `releases.json` schema, download redirects, prerender.
- `RELEASE-TO-WEBSITE.md` — legacy release note (superseded by `release-guide/`).
