---
name: xeno-secure-website
description: "Take a live XENO web property off the public internet without breaking the products that depend on it: close every account-creation path, make account suspension actually enforced, de-index it from Google, and optionally wall it behind Cloudflare Access. Use when the user says a site is 'public and indexed and we don't want that yet', wants to block or disable signups / registration / new accounts, wants pages removed from Google or search results, wants a property put behind a login or made private, wants existing accounts suspended or purged, or asks to lock down / secure / hide xenostudio.ai or any xeno-* host (xeno-platform-001, xeno-private-api-001, xeno-mail-001, xeno-post-001, xeno-comms-001, xeno-index-001, and hosts added later). Discovery-first: it never assumes a host's shape, because these boxes differ (source-tree + docker compose vs prebuilt GHCR images vs verdaccio vs an API gateway with no HTML at all). Enforces backup-with-proven-restore before anything destructive, and refuses to let a 'suspension' ship that only holds on some login paths. Not for cutting a release — that is xeno-product-release."
---

# XENO Secure Website — take a property private without breaking the stack

Behave like a **senior platform/security engineer**, not a script runner. The job is not
"add `Disallow: /` and turn off the signup button" — both of those are the *wrong* fix and
this document exists because each one fails in a specific, provable way.

Three outcomes, in this order of importance:

1. **Nothing that is already shipped breaks.** Products in the wild depend on these hosts.
2. **The block is real** — enforced server-side, on every path, and verified from outside.
3. **The property stops being discoverable** — which is a *header*, not a robots rule.

> **Canonical source:** `xeno-platform/security-guide/SKILL.md`. Installed copy lives at
> `~/.claude/skills/xeno-secure-website/SKILL.md`. Edit the canonical one and re-copy.
> Companion: `xeno-product-release` §0.5, which re-verifies these invariants after any deploy.

---

## 0. Safety — always

- **Autonomy is for discovery and planning.** Every side effect — deploy, `UPDATE users`,
  Cloudflare change, DNS — needs **one explicit human "yes"** on a stated plan.
- **A purge (DELETE) is a separate decision from a suspension.** Never treat them as the
  same instruction. Suspension is reversible in seconds; deletion is not reversible at all.
  If the user says both, do the suspension and *ask* about the purge.
- **Never sweep another session's WIP.** If the repo is on someone else's branch or has
  uncommitted changes, stop and report (Parallel Development Protocol §5).
- **Read before you write.** These hosts are not identical and several have landmines
  recorded in `docker-compose.yml` comments and in root `CLAUDE.md`.

---

## 1. Discover the host before you touch it — never assume the shape

**The single biggest failure mode is applying the xeno-platform recipe to a host that is
not xeno-platform.** Establish all of this first:

```bash
ssh <host> 'sudo docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}"'
ssh <host> 'ls /mnt/projects /opt 2>/dev/null'      # is there a source tree at all?
```

Then classify the property. The four shapes seen so far need four different plans:

| Shape | Example | How you change it | Does it even have HTML to de-index? |
|---|---|---|---|
| **Source tree + `docker compose build`** | `xeno-platform-001` | `git archive HEAD <files>` → box → rebuild (see §7) | Yes — the full recipe applies |
| **Prebuilt GHCR images, NO source on box** | `xeno-post-001` | You **cannot** ship files. Changes must go through the repo's `v*` release workflow that builds and pushes an image. Budget for that. | Yes, but only via a new image |
| **Third-party service** | `xeno-mail-001` (verdaccio / XENO Index) | Config file + service restart; no build | Mostly no. **`access: $authenticated` already gates reads** — a `401` here means *auth required*, not *missing* |
| **API gateway, no site** | `xeno-private-api-001` | Config/env + restart | **No.** De-indexing is a no-op. The risk here is *availability*, not discovery — see §6 warning |

Record what you found before proposing anything.

---

## 2. Back up first — and prove the restore

Non-negotiable before any `UPDATE`, `DELETE`, or anything that touches accounts.

```bash
# Stream it OFF the box — leaves no copy of PII on the server
ssh <host> "sudo docker exec -i <pg-container> pg_dump -U postgres -d <db> \
  --no-owner --no-privileges | gzip -9" > <name>-$(date +%F).sql.gz
```

Then **prove it** — a backup that has not been restored is a hope:

1. `gunzip -t` (not truncated)
2. Extract per-table row counts from inside the dump, diff against live — expect **identical**
3. **Restore it into a throwaway container** and diff row counts again
4. Spot-check a real table (`SELECT count(*), count(DISTINCT email) FROM users`)
5. `sha256sum` everything, write a `README.md` recording what was verified and how to restore

⚠️ **psql version:** `pg_dump` ≥ 15.14 emits `\restrict` / `\unrestrict` tokens. An older
`psql` cannot parse them and the restore dies. Match or exceed the source version.

⚠️ Store it **outside any git repo**. It contains password hashes.

---

## 3. Close account creation — find EVERY door

**Do not gate the endpoints you can name. Enumerate them from the database writes.**

```bash
grep -rn "INSERT INTO users" src/ --include=*.js | grep -v node_modules
```

Sort the hits into *public signup* vs *admin bootstrap* — both exist and only the first
kind matters. On xeno-platform this found **five** writes: two obvious `/register*`
endpoints, two admin-bootstrap routes (irrelevant), and:

🔴 **The OAuth auto-create.** `findOrCreateOAuthUser` creates a fully-verified account on
first "Sign in with Google" — no form, no friction, no email confirmation. **160 of 218
accounts arrived this way.** Gating only the two `/register` endpoints would have left the
door that three-quarters of users walked through wide open.

**Build ONE choke point**, not three checks:

- A single module every path calls (`middleware/registrationGate.js` is the reference).
- **Fail-safe default: CLOSED unless the flag is the exact string `'true'`.** A missing,
  empty, misspelled or cleared env var must keep signups closed. This mirrors the signing
  resolver, which resolves to `unsigned` on any ambiguity rather than claiming a guarantee.
- An allowlist (individual emails and `@domain` entries) so deliberate onboarding still works.
- Refusals return a **machine-readable code** (`registration_closed`), and OAuth refusals
  redirect with *that* code — not a generic `callback_failed`, which sends a permanently
  refused user into a retry loop against a door that will never open.

**Hiding the signup button is not blocking.** It is an API; the form is decoration.

---

## 4. Make suspension real — audit every login path

🔴 **The trap that makes a suspension fake.** Password login checked `is_active`. The three
OAuth callbacks did not — they took whatever the user-lookup returned straight to
`issueSessionToken`. With most accounts on OAuth, setting `is_active = false` would have
produced a confident "216 accounts suspended" report while those users kept signing in.

So: **before** claiming a suspension works, enumerate every path that mints a session and
prove each one refuses a disabled account.

```bash
grep -rn "issueSessionToken\|jwt.sign\|createSession" src/server --include=*.js | grep -v node_modules
```

Add one shared `assertAccountUsable(user)` and call it on **every** branch — including the
"matched an existing user by email" branch, or the suspension is bypassable by linking a
provider. Assert **before** touching `last_login`: a refused attempt is not a login and must
not be recorded as one.

Then suspend, in a transaction, reporting before/after:

```sql
BEGIN;
UPDATE users SET is_active = false, status = 'suspended', updated_at = NOW()
 WHERE role = 'user' AND is_active = true;
COMMIT;
```

Decide **explicitly** about non-person accounts. A `service` role is technically "non-admin"
but suspending it can break metering or a gateway. Leave it, say so, and offer the command.

---

## 5. De-index — the header, not the robots rule

🔴 **`Disallow: /` does not remove anything from Google.** It blocks *crawling*. Already
indexed URLs persist as bare links, and — worse — once Googlebot cannot fetch the page it
can **never see a `noindex` you add later**. You lock yourself out of the actual fix.

**Correct order:**

1. **`X-Robots-Tag: noindex, nofollow, noarchive`** on responses, with **crawling still allowed**.
2. **Stop emitting `sitemap.xml`** and remove the `Sitemap:` line. A sitemap is an active
   invitation — a URL list plus a fresh `<lastmod>` saying *recrawl me*. Delete any stale
   `dist/sitemap.xml` at build time so one cannot survive inside the image.
3. **Google Search Console → Removals → temporary removal by prefix.** This is the fast
   lever (hides within ~a day, ~6 months, renewable). **Operator-only** — needs a verified
   property. The header only works as fast as Google recrawls; GSC is what makes it immediate.
4. Only *after* Google has dropped the pages may you add `Disallow: /` to stop crawl traffic.

🔴 **nginx `add_header` inheritance will eat the header.** A child `location` that declares
**any** `add_header` drops **all** inherited ones. A single server-level `X-Robots-Tag` is
silently missing from every block that sets its own headers — including the static-asset
block, and **Google indexes images independently of the page that embeds them**. Declare it
at server level *and* in every `location` that sets headers of its own. Then prove it on a
real asset URL, not just on `/`.

Where a CDN sits in front (Cloudflare on all of these), a **Transform Rule** adding the
response header is the lower-risk equivalent and avoids the inheritance trap entirely.

---

## 6. The hard wall — only if asked, and never over `/api/`

Cloudflare Access / Basic Auth in front of the HTML surface deindexes fastest (Google sees
401/403) and makes the property genuinely private.

🔴 **Exempt `/api/`.** The XENO **OIDC provider lives at `xenostudio.ai/api/oauth2/*`**.
Walling it breaks sign-in for **every shipped product**. Same class of error on any host
that serves both a site and an API.

✅ **What survives a wall, and is worth telling the user:** `updates.xenostudio.ai` is
**R2 on a different hostname**, so auto-update for Hub, Canvas, Workflow, Browser and Shell
keeps working. `api.xenostudio.ai` is a **different host** (`xeno-private-api-001`) too.
So the marketing site can be locked hard without breaking a single installed app.

---

## 7. Deploy without causing an outage

Follow the property's own runbook (`release-guide/04-build-and-deploy.md` for xeno-platform).
Four traps, all seen in practice:

1. 🔴 **A long build will exceed your tool timeout and kill the SSH client mid-`up -d`,
   taking a container down and 502-ing the site.** This happened. **Run the build detached**
   (`nohup … &` / `setsid`, or `run_in_background`) and poll, rather than holding an
   interactive SSH session across a ten-minute image build.
2. **Commit before deploying.** `git archive HEAD <files>` ships only *committed* content;
   uncommitted edits silently do not ship.
3. 🔴 **Verify the box's copy matches `origin/main` before shipping single files.** These
   boxes run trees that are hundreds of commits behind. Shipping one file from a newer tree
   into an older one can break imports at startup. Compare normalized hashes first.
4. 🔴 **Do not ship `package.json`/lockfiles to a box whose lockfile is older.** `npm ci`
   inside the image build will fail on the mismatch. Ship only what the change needs.

Deploys are **build-before-swap**: a failed build leaves the running container serving.

---

## 8. Verify from outside — by content, never by status code

🔴 **On an SPA, an unrouted path returns `200` with the app shell.** A status-code check
cannot tell you a resource exists. This is how "the privacy page is live" was believed for
weeks, and how a *deleted* `sitemap.xml` still answers `200`.

Check the **body and the content-type**:

```bash
curl -sI https://<host>/ | grep -i x-robots-tag                    # on a PAGE
curl -sI https://<host>/assets/<hashed>.js | grep -i x-robots-tag  # and on an ASSET
curl -s  https://<host>/sitemap.xml | head -c 120                  # HTML? then it is gone
curl -s  https://<host>/robots.txt | sed -n '/END Cloudflare/,$p'  # our block, past CF's
curl -s -X POST -H 'Content-Type: application/json' -d '{...}' \
     https://<host>/api/auth/register -w '\nHTTP %{http_code}\n'   # expect 403 + code
```

Then confirm **no account was created by your own probes** (`SELECT count(*) FROM users`).

⚠️ `robots.txt` on these hosts is **Cloudflare-managed**: CF injects its own block ahead of
yours. Read past `# END Cloudflare Managed Content` to see the site's real rules. Two
`User-agent: *` groups is normal here, not a bug.

---

## 9. Report honestly, and name what is still open

State plainly: what is enforced, what is operator-only, what you broke, and what would
silently revert the work.

🔴 **The revert risk is the one people forget.** If the lockdown was deployed from a branch
that is not merged, **a future deploy from `main` silently undoes all of it.** Merging is
part of the job, not a follow-up.

Always-operator items: Google Search Console removal, Cloudflare Access/DNS, Stripe-side
cleanup for any deleted billing customer, and the purge decision itself.

---

## 10. Host map (update as hosts are added)

| Host | Serves | Shape | Notes |
|---|---|---|---|
| `xeno-platform-001` | xenostudio.ai | source tree + compose | **Locked down 2026-08-11** — reference implementation. Serves the OIDC origin at `/api/oauth2/*` |
| `xeno-private-api-001` | api.xenostudio.ai | API gateway | **No HTML.** De-index is a no-op. Meters credits for every product — availability risk is the concern |
| `xeno-post-001` | post.xenostudio.ai | **prebuilt GHCR images, no source tree** | Changes require the repo's `v*` release workflow. Has its own auth (Argon2id/JWT/TOTP). ⚠️ VM disk is on a `soft`-mounted CIFS share — check `qm status 115` for `io-error` before debugging |
| `xeno-mail-001` / `xeno-index-001` | registry.xenosystem.ai | verdaccio | `access: $authenticated` already gates reads. **`401` = auth required, `404` = missing** — do not misread |
| `xeno-comms-001` | comms.xenostudio.ai | compose, non-git rsync snapshot | Every service reports `environment: development`; secrets are literals. Not production |

---

## 11. Paste-in audit

```
[ ] Host shape identified (§1) — source tree? GHCR? third-party? API-only?
[ ] Backup taken, restored into a throwaway, row counts diffed identical (§2)
[ ] ALL `INSERT INTO users` sites enumerated; OAuth auto-create found and gated (§3)
[ ] Gate is ONE choke point, fail-safe CLOSED on a missing env var (§3)
[ ] Every session-minting path asserts account usability (§4)
[ ] Suspension run in a transaction; service/admin accounts decided explicitly (§4)
[ ] X-Robots-Tag present at server level AND every add_header location (§5)
[ ] Header proven on a real hashed asset URL, not just on / (§5)
[ ] sitemap.xml no longer generated; stale copy removed from dist (§5)
[ ] robots.txt still ALLOWS crawling; no Sitemap: line (§5)
[ ] /api/ NOT walled (OIDC origin) (§6)
[ ] Build run detached so a tool timeout cannot kill it mid-swap (§7)
[ ] Verified by response BODY, not status code (§8)
[ ] Probe requests created no accounts (§8)
[ ] Lockdown branch merged, or the revert risk stated loudly (§9)
[ ] Operator list handed over: GSC removal, Cloudflare, purge decision (§9)
```

---

## Appendix — failure modes seen in practice

| What was believed | What was true |
|---|---|
| "Blocking `/register` blocks signup" | OAuth auto-create was a third door; 73% of accounts used it |
| "`is_active=false` suspends the account" | Only on password login. OAuth never checked it |
| "`Disallow: /` removes us from Google" | It blocks crawling, guarantees the noindex is never seen, and strands indexed URLs |
| "The header is set at server level, so it applies" | nginx drops inherited `add_header` in any block that sets its own |
| "sitemap.xml returns 404 now" | It returned **200** with the SPA shell via `try_files` |
| "The deploy command finished" | The tool timeout killed the SSH client mid-swap; the site 502'd |
| "The site is quiet, nobody is signing up" | 66 real signups in 30 days, two the previous day |
| "There are paying customers, we can't purge" | `billing_charges` was **0** — no external customer had ever been billed |
| "We have IPs/locations for auditing" | Every session row held a **Docker-internal** IP; the proxy never forwarded the client address |
| "Downloads are tracked" | `analytics_events` and `analytics_daily_stats` were both **empty** |
