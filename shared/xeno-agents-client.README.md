# @xeno/agents-client — vendored client for the hosted agent-runs API

`shared/xeno-agents-client.ts` is the single-file, dependency-light, framework-agnostic
client every XENO product vendors to dispatch and stream **cloud agent runs** against the
live `xeno-agents-api` (`https://api.xenostudio.ai/v1/agents`). It is the generalized form
of the contract the XENO Agent CLI already speaks in its `remote.ts`. Source of truth:
`XENO AGENTS API - SPEC.md` §4–6.

- **Runtime:** Node ≥ 18, Electron (main or renderer), and browsers. Uses only global
  `fetch` / `ReadableStream` / `TextDecoder` / `AbortController`. **No npm deps, no
  node-only imports.**
- **Auth reality (2026-07):** the server today accepts a platform **OIDC JWT**. **API-key
  support is being added separately** (SPEC §13 caveat). The client is auth-agnostic — it
  just sends `Authorization: Bearer <token>` — so it works with either the moment the
  server accepts it.

## How to vendor

Copy the one file into your product (same pattern as `shared/xeno-account.ts`):

```
cp xeno-platform/shared/xeno-agents-client.ts <your-repo>/src/shared/xeno-agents-client.ts
```

No build step or package install is required — it is plain TypeScript with zero imports.
Keep this copy in sync when the wire contract changes (it is a LOCKED cross-repo interface).

## Quickstart

```ts
import { createAgentsClient, isAgentsApiError } from "./xeno-agents-client";

// token may be a string or a (possibly async) getter.
const agents = createAgentsClient({
  token: myPlatformJwt,          // OIDC JWT today; platform API key once the server accepts it
  // baseUrl defaults to https://api.xenostudio.ai/v1/agents
  // workspace: "ws_123",        // optional → x-xeno-workspace
});

// 1. Start a durable, asynchronous run (returns immediately, status "queued").
const run = await agents.createRun({
  prompt: "Fix the failing tests",
  model: "gpt-5.5",
  effort: "high",
  budget: { maxCredits: 500 },   // hard cap; sizes the ledger hold
});

// 2. Stream events live. Default transport is NDJSON; pass { transport: "sse" } for SSE.
try {
  for await (const ev of agents.attach(run.runId, { reconnect: true })) {
    console.log(ev.sequence, ev.type, ev.payload);   // e.g. "model.text.delta", { text }
  }
} catch (err) {
  if (isAgentsApiError(err) && err.isBudgetExceeded) console.error("out of budget");
  else throw err;
}

// 3. Stop it (graceful).
await agents.stopRun(run.runId);
```

Callback style instead of `for await`:

```ts
const { close, done } = agents.onEvent(run.runId, (ev) => render(ev), { transport: "sse" });
// … later: close();  // or: await done;  (resolves when the stream ends)
```

## API surface

| Method | HTTP | Returns |
|---|---|---|
| `status()` | `GET /status` | `AgentsApiStatus` (capability negotiation) |
| `supportsRequiredCapabilities()` | `GET /status` | `boolean` |
| `createRun(input, {signal?})` | `POST /runs` | `AgentRunRecord` |
| `listRuns({limit?, signal?})` | `GET /runs?limit=` | `RunListItem[]` |
| `getRun(runId, {signal?})` | `GET /runs/:id` | `AgentRunRecord` |
| `getEvents(runId, {tail?, since?, signal?})` | `GET /runs/:id/events` | `RunEvent[]` |
| `stopRun(runId, {signal?})` | `POST /runs/:id/stop` | `AgentRunRecord` |
| `attach(runId, opts?)` | `GET /runs/:id/attach?follow=true` | `AsyncIterable<RunEvent>` |
| `onEvent(runId, handler, opts?)` | (wraps `attach`) | `{ close, done }` |

`attach` options: `{ tail?, since?, signal?, transport?: "ndjson"|"sse", reconnect?,
reconnectDelayMs?, maxReconnects? }`. With `reconnect: true` a dropped stream auto-resumes
from the last seen `sequence` (`Last-Event-ID` for SSE, `?since=` for NDJSON), stopping
after a terminal lifecycle event (`run.completed` / `run.failed` / `run.cancelled`) or on
abort.

### Types

`AgentRunRecord` (public projection), `RunStatus` (the 15-state union), `RunListItem`,
`RunEvent`, `XenoRuntimeEvent` / `XenoRuntimeEventType` (relayed verbatim in
`RunEvent.payload`, SPEC §6.1), `CreateRunInput`, plus helpers `TERMINAL_STATUSES`,
`isTerminalStatus`, `TERMINAL_LIFECYCLE_EVENTS`, `REQUIRED_CAPABILITIES`.

### Errors

Every non-2xx throws a typed `AgentsApiError` with `.code` and `.status`. The server
serializes a **bare** `{ "error": "<code>" }` body (SPEC §4). Codes: `unauthorized` (401),
`forbidden` (403), `run_not_found` / `not_found` (404), `insufficient_credits` /
`budget_exceeded` (402), `invalid_request` (400), plus client-side `rate_limited` (429),
`http_error`, and `network_error` (fetch threw / aborted / timed out). Convenience getters:
`isBudgetExceeded`, `isInsufficientCredits`, `isUnauthorized`, `isNotFound`, `isNetwork`.
Guard with `isAgentsApiError(err)`.

## Config

```ts
createAgentsClient({
  token,                 // string | () => string | Promise<string>   (required)
  baseUrl?,              // default "https://api.xenostudio.ai/v1/agents"
  workspace?,            // → x-xeno-workspace
  fetchImpl?,            // custom fetch (Node < 18 / testing)
  timeoutMs?,            // non-streaming request timeout; default 30000. attach() is not timed out.
});
```

## Tests

```
node --test shared/xeno-agents-client.test.mjs
```

Hermetic — spins up an in-process `node:http` mock server. Covers the createRun POST shape,
getRun/listRuns/stopRun, NDJSON + SSE parsing, `since`/`Last-Event-ID` resume, the `onEvent`
wrapper, and the full error taxonomy. No external deps (Node ≥ 22.6 strips the `.ts` import
types natively).
