# Automate = XENO Workflow — decision record (2026-10-23)

**Owner, 2026-10-23:** *"for automate we already have xeno workflow that needs to power this … why are you inventing
stuff that we already have as products?"*, then *"right away full scale"*.

## Context
The workspace's Dev › Automate area listed sample runs. A first attempt built a second, smaller engine inside the
platform (`worktree-agent-a0c4cae82a79874b3`, never merged: trigger → conditions → actions, its own scheduler). That
duplicated a shipping product. XENO Workflow already has the engine: a token scheduler with dead-path elimination,
iterators, error strategies, a journal per run with crash-resume, a QuickJS sandbox and 146 node types. It ran only
inside Electron.

## Decision
Automate is a **front-end to XENO Workflow**. No engine lives in xeno-platform.

| Layer | Owner | What |
|---|---|---|
| Engine | `xeno-workflow` `src/headless/` (PR #9) | The SAME `WorkflowEngine`, node definitions and journal, bundled as a Node service (`out/headless/server.mjs`, `docker/headless/Dockerfile`). It offers an allowlist of nodes that run with no desktop, plus `xeno-platform-trigger` and `xeno-platform-capability`. Contract: `xeno-workflow/docs/HEADLESS-RUNNER.md`. |
| Record + triggers + authority | `services/xenoWorkflow.js` | Workflows stored as xeno-workflow graphs (`workspace_workflows`). Runs form the durable delivery queue (`workspace_workflow_runs`). Platform events become runs. The run credential comes from here. |
| Screens | `prototypes/xeno-workspace/platform-automate.js` | List, a builder using the runner's catalogue, runs and run details, at `…/automate/workflows/<id>` and `…/automate/runs/<id>`. |
| Agents | `services/automateMcp.js`, `automate.*` capabilities | Agents can list, read, draft, edit (a running workflow they change goes back to draft) and disable. No tool enables, deletes, runs or retries. |

### How a run acts
1. A **person** (a workspace admin) turns a workflow on. It gets its OWN platform agent (`Flow <id>`). That agent is
   granted **exactly** the capabilities its graph's action steps name, in that workspace. A database trigger refuses
   an agent as the enabler.
2. An event arrives (a task move, a ticket, a form answer, a schedule, a signed webhook). The platform queues one run
   per (workflow, event key). The workflow's own agent never re-triggers it. A workflow that starts more than
   100 runs in 10 minutes is turned off.
3. The leader-only worker claims the run under a lease. It mints **one** short-lived `xwk_` key per run (60 minutes,
   the workflow's scopes, reused across delivery attempts so idempotency keys dedupe on one connection). It then posts
   the graph, the event and the key to the runner with a 60-second ES256 assertion: `aud xeno-workflow`, the run id,
   and the SHA-256 of the exact body.
4. Each action step calls `POST /api/v1/<capability>` with that key and `Idempotency-Key: xwf:<run>:<step>`.
   The platform applies the same checks it applies to any key: scope, grant, the person's own rights and step-up.
   A headless key never passes step-up, so irreversible actions are refused at save time. Run admission and the
   sales gate apply inside the services the capability calls. Nothing is bypassed.
5. The result is recorded and the key is revoked. Busy, 5xx or unreachable answers back off and retry with the same
   run id; after 5 attempts the run is dead and a person decides. If the enabler is no longer an admin, the workflow
   is turned off before it acts.

## Options considered
1. **A platform engine** (the abandoned branch). This is a second engine beside a shipping product, which the owner
   refused. It also drifts: every node, retry rule and journal behaviour would be written twice.
2. **Drive the desktop app's unattended mode** (Electron under xvfb). That is one person's machine, with no tenancy,
   no egress policy and a desktop credential vault. It is the wrong trust boundary for a multi-tenant service.
3. **A headless build of the same engine, called with a platform assertion** (chosen). This is the RFC 7523
   JWT-bearer shape Publish already uses for XENO Post (`docs/PUBLISH-XENO-POST.md`). n8n and Windmill split the same
   way: an editor/control plane plus workers that run the identical engine.

## Blast radius
- Platform tables `workspace_workflows` and `workspace_workflow_runs` are additive (DOWN drops exactly them). Scopes
  `automate:read`/`automate:write` and six `automate.*` capabilities are additive. `workspaceCredentials.createRunKey`
  and `revokeRunKey` are additive. Two hooks call it and never throw: `xenoTasks.transitionTask` and
  `supportTickets.createTicket`.
- New env `XENO_WORKFLOW_RUNNER_URL`. Without it nothing is delivered and the screen says so.
- Runner: a new service to host (below). It does not affect the desktop app.

## Hosting (not deployed by this change)
Run `xeno-workflow-runner` beside the platform backend on `xeno-platform-001`, on the backend's private Docker
network. It must never have a public port. Use a named volume on `/data`, with
`XENO_PLATFORM_URL=http://backend:<port>`, `XENO_WORKFLOW_ALLOW_HTTP_PLATFORM=1` and
`XENO_PLATFORM_ISSUER` = the issuer the backend signs with (`issuer()` in `config/hosts.js`, published at `/api/oauth2/.well-known/openid-configuration`; `https://xenostudio.ai` as of 2026-10-24, not the site host — a wrong value makes the runner refuse every assertion). The service is declared in `docker-compose.yml` as `xeno-workflow-runner` (no `ports:`). Build it from the xeno-workflow repo:
`docker build -f docker/headless/Dockerfile -t xeno-workflow-runner .`. Then set
`XENO_WORKFLOW_RUNNER_URL=http://xeno-workflow-runner:8790` in the box `.env`. It is already passed through
`docker-compose.yml`. Check it with `docker exec xenostudio-backend printenv | grep XENO_WORKFLOW_RUNNER_URL`.

## Rollback
Unset `XENO_WORKFLOW_RUNNER_URL`. Runs then stay queued and nothing acts. Stop the runner. Run the migration's DOWN.
Grants live in `relationship_tuples` under each workflow's agent: `revokeGrants(agent, workspace)`.

## Proof
- `npm run test:xeno-workflow` (real Postgres, fake runner verifying every assertion): 75 checks.
- `npm run test:xeno-workflow-e2e` (real Postgres + the **built xeno-workflow runner** + the real `/api/v1`): a task
  move runs the workflow on xeno-workflow's engine and creates a task through `/api/v1` with the run key. A
  re-delivery does not act twice. Taking the grant away makes `/api/v1` refuse the same workflow (`grant_missing`).
- `npm run test:automate-mutation`: 11 protections removed one at a time, each caught.
- `npm run test:automate-ui`: the browser test.

## Not built yet
- **Vault-backed connectors** (Slack, GitHub, …) are not offered. Workflow nodes have no per-workspace credential
  binding yet, and the platform refuses to store a secret in a graph.
- **A forms product does not call `onFormResponse` yet.** The trigger and its entry point exist and are tested.
- A visual canvas editor. Straight-line flows are edited here. Branched graphs are built in the desktop app, imported,
  and shown read-only.

## Revisit when
The platform implements `client_credentials` with token exchange (RFC 8693): an exchanged token with the same claims
then replaces the run key. Also revisit when the runner needs more than one replica: the run-record idempotency then
moves from its local volume to shared storage.
