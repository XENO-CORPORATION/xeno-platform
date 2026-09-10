# Platform deploy — 2026-09-10

`92c36f8`, backend + frontend, `deploy-platform.mjs both --execute`. Both services
swapped after their own healthcheck passed; no rollback was triggered.

## Why this deploy existed

Signup was reopened earlier the same day while production was still serving the
image built on 2026-08-31. Everything a new account touches — the welcome mail, the
activation mail, the password reset — was the old build. Reopening the door and
leaving the mail behind it stale is the half-done version of the change.

## What went live

| | |
|---|---|
| **Account recovery for Google accounts** | `/forgot-password` no longer requires an existing `password_hash`. 162 of 218 accounts had none, so every one of them was silently excluded from recovery |
| **401 instead of 500** on a password-less account | `bcrypt.compare(pw, null)` throws; that threw inside the login handler, making the status code an oracle for which accounts have no password |
| **One email shell** | `.btn` lived in a `<style>` block, which Gmail's clipping and Outlook's Word engine strip — the reset button was arriving as a bare link |
| **Receipt currency and § 19 notice** | it printed `$` against EUR prices, and claimed to be a tax receipt with no VAT line and no explanation |
| **The three account dialogs** | project rename, project archive, session revoke — off `window.prompt`/`confirm` |
| **Public health redaction** | the backup directory and raw exceptions no longer serialise into a public response |
| **Read-only preview sessions** | shipped **off**; `XENO_READONLY_PREVIEW_ENABLED` is unset, and every path fails closed at 503 without it |
| **Source revision stamping** | the reason this record can name a revision at all |

## Verified after the swap, on the live site

- `/api/health` → `revision: 92c36f8`. **Production could not name its own commit
  before this deploy**; the image carried no label and no revision file, and the
  deploy SHA existed only as an image tag a running container does not report.
- `/api/auth/browser-session` → **400**, previously **404**. The endpoint exists now;
  400 is the empty body.
- Migration `20260908180000-readonly-preview-sessions` applied, and both CHECK
  constraints exist exactly once.
- In the running container: `settingFirstPassword` ×3, `ABSENT_PASSWORD_HASH` ×2,
  `wrapChrome` ×3, `/app/.xeno-revision` = `92c36f8`.
- Signup still open — `POST /api/auth/register` with an empty body answers 400
  "All fields are required", not 403 `registration_closed`.
- `/`, `/login`, `/forgot-password`, `/reset-password`, `/product/hub`, `/forum`,
  `/impressum` all 200.

### The lockdown survived, and that was the risk

A `frontend` deploy ships `nginx/` and `docker-compose.yml`, which is the documented
way a routine deploy silently un-de-indexes the site. Checked afterwards rather than
assumed:

- `X-Robots-Tag: noindex, nofollow, noarchive` on `/`, `/product/hub`, `/forum`
  **and on a hashed static asset** — the asset is the one that goes missing when a
  `location` block declares its own headers, and Google indexes images independently.
- `/sitemap.xml` → 404.
- `robots.txt` still does **not** `Disallow: /` — blocking the crawl would stop
  Googlebot ever seeing the `noindex`.

The compose file was diffed against the box's before deploying: the only difference
was this branch **adding** `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_EXPECTED_MODE` and
`STRIPE_BILLING_PORTAL_CONFIGURATION` as `${VAR}` lines. Without them, setting those
values in `.env` would not have reached the container — which is the same trap that
silently closed signup for twelve days.

## Not proven by this deploy

The reset email's **rendering in a real client** is unverified. The code is live and
its output was screenshotted through headless Chrome before shipping, but no message
has been sent through the deployed path yet — the first real password reset is what
exercises it. Nothing here was tested by mailing a real user.

Payments are unchanged: production still runs Stripe **test** keys.
