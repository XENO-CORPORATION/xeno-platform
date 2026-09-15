# XENO Status — `status.xenosystem.ai`

An external probe, alerter and public status page in one Cloudflare Worker, backed by D1.

| File | What it is |
|---|---|
| `worker.mjs` | The Worker: scheduled probe + alert outbox + heartbeat, and the page/JSON handler |
| `schema.sql` | D1 schema, idempotent |
| `deploy.mjs` | Creates/updates everything. **Dry-run unless `--confirm`** |
| `../scripts/status-worker.test.mjs` | Tests against real SQLite with this exact schema |

## Why it exists

On 2026-09-14 three production defects — every Claude Opus 5 turn failing, web search failing
100% of the time, and search-heavy turns returning an empty answer — were all found by a human
typing into the product. Nothing alerted: Prometheus on `xeno-platform-001` evaluated five alert
rules with **no Alertmanager attached**, so every one fired into nothing.

## Why it is not on our servers

Every XENO VM runs on one Proxmox host whose disks live on a share that freezes guests into
`io-error`. A monitor on that host freezes with the thing it watches, and a frozen monitor reports
nothing — **silence reads as health**. So the probe, its data and the page all run on Cloudflare,
which fails independently.

## How it works

Every 2 minutes the Worker:

1. Probes each component (`COMPONENTS` in `worker.mjs`) with an honest user agent and
   `redirect: 'manual'`.
2. Folds the result into per-component state. **Two** consecutive failures open an incident and
   two successes resolve it, so a single dropped request never pages anyone.
3. Writes the probe, the daily rollup, the state and any incident in **one transaction**.
4. Sends every undelivered alert from the **outbox** (`incidents.*_alert_sent`). A flag is set only
   after delivery succeeds, so a failed email is retried on the next run — delayed, never lost.
5. Pings the healthchecks.io watchdog: the plain URL if everything worked, `/fail` if anything did.

## Who watches the watcher

**healthchecks.io.** If runs stop, the heartbeat stops, and healthchecks.io alerts through its own
channel. If a run fails — the database is unreachable, or an alert cannot be delivered — the run
pings `/fail`, which alerts immediately. An incident nobody can be told about is a pipeline
failure, and it is treated as one.

## What v1 does NOT catch — read this before trusting a green page

These checks detect a component that is **down**. They do not detect one that is **up and wrong**,
and every defect that motivated this project returned HTTP 200.

Catching those needs a synthetic **chat turn** and a real **web search** through the product, which
needs a platform API key for a probe account. That key has to be created by the operator; it is
not built into this version, and chat is deliberately **not** listed as a green component until it
is actually monitored.

Also still open:

- **Phone push** for urgent alerts (Pushover or ntfy) — needs an account the operator creates.
- **Prometheus alerts still go nowhere.** The five in-box SLO rules are evaluated with no
  Alertmanager. This Worker is the working alert path; the in-box rules are not wired to it.

## Deploy

```bash
node status/deploy.mjs            # plan
node status/deploy.mjs --confirm  # apply
```

Needs `CF_API_TOKEN`, `RESEND_API_KEY` and `HEALTHCHECKS_WATCHDOG_PING_URL` in `~/.xeno-secrets`.
Values are read, never printed; the last two reach the Worker as encrypted secret bindings.

## Adding a component

Add an entry to `COMPONENTS`. Choose `expect` so a broken component **cannot** pass: prefer a
status plus a body check (`json: true`, `bodyIncludes`) over a bare 200, because a single-page app
answers 200 for paths that do not exist.

## Rollback

Everything is additive and independent of the platform. To remove it: delete the
`status.xenosystem.ai` Workers custom domain, the `xeno-status` Worker, and the `xeno-status` D1
database. Nothing on `xeno-platform-001` depends on any of them.
