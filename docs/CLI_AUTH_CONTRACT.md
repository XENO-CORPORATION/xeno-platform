# XENO CLI Auth Contract

Locked spec for the Codex-CLI-style 3-option login UX in `xeno-agent-cli`,
shared by backend (xenostudio-backend), frontend (xenostudio-frontend), and CLI.

**Goal:** When `xeno` starts and no creds exist, show a 3-option welcome screen
(Sign in with XENO Account / Device Code / Provide your own API token).
`/login` and `/logout` slash commands trigger the same flow. After `/logout`,
running `xeno` again returns to the welcome screen.

---

## 1. Backend endpoints

All under `/api/auth/cli/`, mounted in `xenostudio-backend` (xeno-platform-001).
Short-lived state in Redis (TTL 600s for browser, 900s for device-code, 300s after completion).

### Browser flow

#### `POST /api/auth/cli/start`
Public. CLI calls this to start a session.
- Body: `{ redirect_uri: string, cli_version?: string }`
- Validation: `redirect_uri` MUST match `^http://(127\.0\.0\.1|localhost):\d{1,5}/callback$`
- 200: `{ session_id: string, auth_url: string, expires_in: 600 }`
  - `session_id`: 32 random bytes, URL-safe base64
  - `auth_url`: `${WEB_BASE_URL}/cli-auth?session=${session_id}`
- 400: `{ error: 'invalid_redirect_uri' }`
- Side effect: Redis `SET cli:browser:{session_id}` `{ status:'pending', redirect_uri, created_at }` EX 600

#### `POST /api/auth/cli/complete`
Auth required (Bearer JWT). Frontend calls this when user clicks "Authorize CLI".
- Body: `{ session_id: string }`
- 200: `{ status: 'ok', redirect_uri: string }` — original `redirect_uri` with `?session={id}` appended
- 401: missing/invalid JWT
- 404: session not found
- 410: session expired
- 409: session already completed
- Side effect: Redis update `cli:browser:{session_id}` `{ status:'complete', token, user, completed_at }` EX 300

#### `GET /api/auth/cli/poll?session_id=X`
Public (session_id IS the secret).
- 200 pending: `{ status: 'pending' }`
- 200 complete: `{ status: 'complete', token: string, user: {id,email,display_name,username} }`
- 404: `{ status: 'not_found' }`
- Side effect on complete return: DELETE the Redis key (one-shot)

#### `POST /api/auth/cli/cancel`
Public. Best-effort.
- Body: `{ session_id }`
- 200: `{ status: 'ok' }`

### Device-code flow

#### `POST /api/auth/cli/device-code`
Public.
- Body: `{ cli_version? }`
- 200: `{ device_code, user_code, verification_url, expires_in: 900, interval: 5 }`
  - `device_code`: 32 random bytes, URL-safe base64
  - `user_code`: 8 chars from `[A-HJ-NP-Z2-9]` (no ambiguous: I, O, L, 0, 1), formatted `XXXX-XXXX`
  - `verification_url`: `${WEB_BASE_URL}/cli-auth/device`
- Side effect: Redis `SET cli:device:{device_code}` `{ status:'pending', user_code, created_at }` EX 900
  AND `SET cli:user-code:{user_code}` `{ device_code }` EX 900

#### `POST /api/auth/cli/device-code/verify`
Auth required (Bearer JWT). Frontend calls this when user enters the code.
- Body: `{ user_code }`
- 200: `{ status: 'ok' }`
- 404: `{ error: 'invalid_code' }`
- 410: `{ error: 'expired' }`
- 409: `{ error: 'already_used' }`
- Side effect: update `cli:device:{device_code}` to `{ status:'complete', token, user, completed_at }` EX 300

#### `POST /api/auth/cli/device-code/poll`
Public.
- Body: `{ device_code }`
- 200 pending: `{ status: 'pending' }`
- 200 slow_down: `{ status: 'slow_down' }` (if polled too fast — interval doubles)
- 200 complete: `{ status: 'complete', token, user }` (and DELETE both Redis keys)
- 410: `{ status: 'expired' }`

---

## 2. Frontend pages (static HTML, served from xenostudio-frontend)

Both pages are **self-contained vanilla HTML+CSS+JS**, no React, dropped into
`/usr/share/nginx/html/cli-auth/index.html` and `/usr/share/nginx/html/cli-auth/device/index.html`.
Match xenostudio.ai branding (dark theme #121212, Inter/system fonts, accent color tbd from existing site).

### `/cli-auth?session=X`

1. Read `session` from URL. If missing → "Invalid CLI auth link." error state.
2. Check `localStorage.getItem('xeno_token')`:
   - If absent → render login form (email + password). On submit POST `/api/auth/login`. Store `token` in localStorage + render step 3.
   - If present → call `GET /api/auth/me` with Bearer. If 401, clear token + render login form.
3. Render "Authorize XENO CLI" card:
   - User avatar/email/display name (from `/api/auth/me`)
   - Text: "A XENO command-line tool wants to sign in to your account."
   - Buttons: `[Cancel]` `[Authorize]`
4. On Authorize: POST `/api/auth/cli/complete` `{ session_id }` with Bearer. On 200, set `window.location.href = response.redirect_uri`.
5. On Cancel: POST `/api/auth/cli/cancel` `{ session_id }`. Show "Cancelled. You can close this tab."
6. After redirect to localhost callback: the static localhost handler page in CLI will say "Signed in. You can close this tab."

### `/cli-auth/device`

1. Check token via same logic as above.
2. If logged in: render "Connect XENO CLI" card with input box for code (auto-formats to `XXXX-XXXX`).
3. On submit: POST `/api/auth/cli/device-code/verify` `{ user_code }` with Bearer.
   - 200: show "✓ Connected. Return to your terminal."
   - 4xx: show specific error and let user retry.

---

## 3. CLI implementation (xeno-agent-cli)

### Welcome screen (on `xeno` startup if `!signedIn`)

Rendered via `ScreenManager` in `apps/xeno-agent-cli/src/ui/screen.ts`.
Layout:

```
  Welcome to XENO, the AI-native command-line agent

  Sign in with your XENO Studio account to use XENO with your plan
  or paste an API token for usage-based billing

> 1. Sign in with XENO Account
     Browser-based login with your XENO Studio account

  2. Sign in with Device Code
     Sign in from another device with a one-time code

  3. Provide your own API token
     Paste an existing XENO token

  Press enter to continue
```

Up/Down to select. Enter to continue. Esc to exit.

### Hook points
- `apps/xeno-agent-cli/src/commands/chat.ts:1018` (TTY): before trust prompt, gate on `getXenoAuthStatus({ validate: false }).signedIn`. If false → run welcome flow. If user esc's → exit. On success → continue.
- `apps/xeno-agent-cli/src/commands/chat.ts:3424` (simpleChat / non-TTY): same gate using readline-style prompts (no fancy TUI).
- `apps/xeno-agent-cli/src/index.ts:325` (`xeno login` subcommand): when no flags given, run welcome flow.
- `/login` slash command (chat.ts:2538 + chat.ts:3985): trigger welcome flow inline, on success refresh agent's auth state.
- `/logout` slash command: clear creds (existing) + show "Signed out. Run `xeno` to sign in again." + exit chat.

### Browser OAuth flow — `apps/xeno-agent-cli/src/auth/browser-flow.ts`

1. Start localhost callback server: try port 1455, fall back to ephemeral. URL `http://127.0.0.1:PORT/callback`. Server responds with a small static HTML page: "Signed in to XENO. You can close this tab and return to your terminal." Reads `?session=X` from query.
2. POST `/api/auth/cli/start { redirect_uri }` → `{ session_id, auth_url }`.
3. Render TUI: "Finish signing in via your browser. If the link doesn't open automatically, open the following link to authenticate: <auth_url>. Press esc to cancel." Open browser via `child_process.spawn('start', [auth_url])` on Win, `open` on Mac, `xdg-open` on Linux.
4. Two parallel waiters:
   - HTTP callback hit → captures `session_id` from query → calls poll once.
   - Polling timer: every 2s `GET /api/auth/cli/poll?session_id=X`.
5. On `complete` → save creds (`accountToken=token`, `apiKey=token` for now — same JWT for both), close server, show "✓ Signed in as <email>". Continue.
6. On esc → POST `/api/auth/cli/cancel`, close server, return to welcome.

### Device-code flow — `apps/xeno-agent-cli/src/auth/device-code-flow.ts`

1. POST `/api/auth/cli/device-code` → `{ device_code, user_code, verification_url, expires_in, interval }`.
2. Render TUI:
   ```
   Finish signing in via your browser
   1. Open this link in your browser and sign in
      <verification_url>
   2. Enter this one-time code after you are signed in (expires in 15 minutes)
      XXXX-XXXX
   Device codes are a common phishing target. Never share this code.
   Press esc to cancel
   ```
3. Poll `POST /api/auth/cli/device-code/poll { device_code }` every `interval` seconds. On `slow_down`, double interval. On `expired`, show error and return to welcome.
4. On `complete` → save creds, "✓ Signed in as <email>", continue.

### API token paste — `apps/xeno-agent-cli/src/auth/token-paste-flow.ts`

1. Render input box: "Paste or type your API token. It will be stored locally in `~/.xeno/credentials.json`."
2. On enter: validate by trying both `validateXenoApiKey()` (`GET /v1/models`) AND `validateXenoAccountToken()` (`/api/auth/me`). If either succeeds, save accordingly. If neither, show "Invalid token, please try again."

### Credential storage (no schema change)
Reuses existing `~/.xeno/credentials.json` schema from `apps/xeno-agent-cli/src/config/auth.ts:14-28`. Browser/device-code flows set `source: 'browser-oauth'` or `'device-code'`.

### Cleanup
- Remove the calls to non-existent `/api/keys`, `/api/api-keys`, `/api/auth/api-keys` endpoints in `provisionXenoModelApiKey()` (`auth.ts:407-411`). Replace with: just store the JWT as both `accountToken` and `apiKey`. Leave a TODO comment for proper key provisioning.

---

## 4. Files touched

### Backend (xeno-platform-001, deployed via SSH)
- NEW: `/app/routes/cliAuthRoutes.js` (≈300 LOC)
- EDIT: `/app/index.js` — mount `app.use('/api/auth/cli', databaseMiddleware, cliAuthRoutes)`
- Backup with `.bak-YYYYMMDD-cli-auth` before edits

### Frontend (xeno-platform-001, static HTML)
- NEW: `/usr/share/nginx/html/cli-auth/index.html`
- NEW: `/usr/share/nginx/html/cli-auth/device/index.html`

### CLI (xeno-agent-cli local)
- NEW: `apps/xeno-agent-cli/src/auth/browser-flow.ts`
- NEW: `apps/xeno-agent-cli/src/auth/device-code-flow.ts`
- NEW: `apps/xeno-agent-cli/src/auth/token-paste-flow.ts`
- NEW: `apps/xeno-agent-cli/src/auth/welcome-screen.ts` (or extend ui/screen.ts)
- EDIT: `apps/xeno-agent-cli/src/config/auth.ts` (add browser/device-code helpers, clean up bad provisioning)
- EDIT: `apps/xeno-agent-cli/src/commands/chat.ts` (welcome gate at 1018 + 3424; update /login, /logout slash commands)
- EDIT: `apps/xeno-agent-cli/src/index.ts` (bare `xeno login` runs welcome)
- NEW: `tests/welcome-flow.test.ts`, `tests/browser-flow.test.ts`, `tests/device-code-flow.test.ts`

---

## 5. Security notes
- All `redirect_uri`s validated against `^http://(127\.0\.0\.1|localhost):\d{1,5}/callback$`.
- session_id and device_code are 256-bit random.
- user_code uses unambiguous alphabet, mapped via separate Redis key for lookup.
- Tokens are NEVER placed in URL query params — only session_id is.
- All Redis keys have TTL. No PG persistence of these short-lived auth states.
- CSP on cli-auth pages disables eval, only allows same-origin XHR.
- `/api/auth/cli/complete` requires Bearer JWT — must come from a logged-in xenostudio.ai session.
- `/api/auth/cli/device-code/verify` requires Bearer JWT.
- Localhost callback HTTP server only listens on 127.0.0.1, not 0.0.0.0.

## 6. Backwards compatibility
- Existing `xeno login --email/--password/--api-key/--token` flag forms continue to work unchanged.
- Existing `~/.xeno/credentials.json` schema unchanged.
- The CLI's `/login` slash command keeps `/login api-key <key>` as a one-shot for power users.
