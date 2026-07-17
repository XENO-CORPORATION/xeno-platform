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

## Related references

- `PRODUCT-LANDING-SPEC.md` — the product landing-page + docs authoring contract (the 4-layer model, the docs system).
- `PRODUCT-PAGES-SPEC.md` — URLs, `releases.json` schema, download redirects, prerender.
- `RELEASE-TO-WEBSITE.md` — legacy release note (superseded by `release-guide/`).
- `XENO AUTH - SPEC.md` — **xeno-platform OWNS the account ORIGIN** (OIDC provider `/api/oauth2/*`: `src/server/routes/oauth2Routes.js` + `utils/oidcProvider.js`). The §13 provider prerequisites (loopback port-flex, `id_token` nonce, discovery ES256, scope down-scoping, admin register-client, RFC 8693 token-exchange, step-up, revocation denylist) are HARD-BLOCKERS every other product waits on — ship + verify them here BEFORE any product migrates to the unified auth.
