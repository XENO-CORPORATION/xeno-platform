# Real-stack walks

Every other browser test in this repo stubs the server, and every server test skips the screens. These walks run the
two together: the real site (Vite), the real backend (`src/server/index.js`), Postgres from production's own image and
Redis, with nothing stubbed. Each walk is a person using the product through the screens, typing and clicking.

| Walk | What a person does |
|---|---|
| `walk-signup` | signs up through the form, types the code from the activation mail |
| `walk-twostep` | turns on an authenticator app and a passkey (Chrome's virtual authenticator), signs in with each, uses a recovery code once |
| `walk-forms` | makes a form, a public link; someone signed out, with no JavaScript, answers it; it becomes a customer; the link is revoked |
| `walk-providers` | adds a provider key: a made-up key and private endpoints are refused, in plain words |
| `walk-market` | three people: a seller builds a company, agent, persona and team and publishes it; a reviewer approves; a buyer brings it in |
| `walk-libraries` | saves a Stock item to the Library and uploads a font |
| `walk-company` | xeno-company's own contract suite runs against this stack through its real client, with the live ANAF register. Needs a current xeno-company checkout beside this repo |

## Run

```bash
node scripts/real-stack/start.mjs      # prints READY http://localhost:5183 and stays up
npm run walk:real-stack                 # every walk; or: node scripts/real-stack/run-all.mjs forms
node scripts/real-stack/stop.mjs        # ends the stack and removes its containers
```

- Postgres and Redis run as throwaway containers on `xeno-platform-001`, bound to `127.0.0.1` there and reached through
  an SSH tunnel. They hold only test accounts and are removed by `stop.mjs`. Nothing touches production data.
- Mail goes to a catcher on loopback through the mail service's `RESEND_API_BASE_URL` seam, so activation codes and
  security notices are read like a person reads them.
- `start.mjs` sets the feature switches production runs with (`OIDC_ENABLED`, `LEDGER_V2_ENABLED`, `BYOK_ENABLED` …).
  Without them whole route groups do not exist and a walk fails for the wrong reason.
- Output (logs, caught mail, screenshots, the test font) goes to `scratchpad/real-stack/`, which git ignores.
- Not covered here: a provider key that works (it needs a real paid key), the workflow runner and the inference
  gateway (not configured on this local copy, so `/api/automate/catalogue` and `/api/models` answer 503/500).

Found by these walks on 2026-11-03, each fixed with a test that fails without the fix: activation left the address
"unverified", provider-key refusals blamed the key for a refused address, teams made on the Teams screen packaged with
no agents, the seller console answered 500 for every seller, buyers could never bring a team in, reviewers could not
read a team's instructions, font uploads were refused by the CSRF check, and one person could spend the per-address
rate limit in four or five page loads.
