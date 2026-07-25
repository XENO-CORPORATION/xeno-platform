/**
 * Hermetic tests for shared/xeno-agents-client.ts.
 *
 * Runs a tiny in-process Node http server that emulates xeno-agents-api and
 * asserts the client's wire behavior. NO external deps — uses `node:test`,
 * `node:assert`, `node:http` only.
 *
 * Run:  node --test shared/xeno-agents-client.test.mjs
 *   (Node ≥ 22.6 strips the .ts import types natively; on this repo's Node 24
 *    it is on by default.)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  createAgentsClient,
  AgentsApiError,
  isAgentsApiError,
  TERMINAL_STATUSES,
  isTerminalStatus,
} from "./xeno-agents-client.ts";

/* ----------------------------- mock server ----------------------------- */

function runRecord(over = {}) {
  return {
    schemaVersion: 1,
    runId: "run_abc",
    sessionId: "sess_1",
    rootRunId: "run_abc",
    workspaceId: "ws_1",
    prompt: "Fix the failing tests",
    status: "queued",
    model: "gpt-5.5",
    permissionMode: "auto",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    usage: { input: 0, output: 0, total: 0 },
    children: [],
    tags: [],
    url: "https://api.xenostudio.ai/v1/agents/runs/run_abc",
    ...over,
  };
}

function ev(sequence, type, payload = {}) {
  return {
    schemaVersion: 1,
    runId: "run_abc",
    sequence,
    type,
    timestamp: "2026-07-20T00:00:00.000Z",
    payload,
  };
}

/**
 * @param {(req, res, ctx) => boolean} handler custom routes; return true if handled.
 */
function startServer(handler) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const u = new URL(req.url, "http://localhost");
      const ctx = {
        method: req.method,
        path: u.pathname,
        query: u.searchParams,
        headers: req.headers,
        body: body ? JSON.parse(body) : undefined,
        rawBody: body,
      };
      received.push(ctx);
      if (handler(req, res, ctx)) return;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        received,
        baseUrl: `http://127.0.0.1:${port}/v1/agents`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/* -------------------------------- tests -------------------------------- */

test("createRun sends the correct POST shape and returns the run record", async () => {
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "POST" && ctx.path === "/v1/agents/runs") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ schemaVersion: 1, run: runRecord({ status: "queued" }) }));
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "tok_123", workspace: "ws_1" });
    const run = await client.createRun({
      prompt: "Fix the failing tests",
      model: "gpt-5.5",
      effort: "high",
      budget: { maxCredits: 500 },
      previousRunId: "run_prev",
      idempotencyKey: "idem_1",
    });

    assert.equal(run.runId, "run_abc");
    assert.equal(run.status, "queued");

    const post = srv.received.find((r) => r.method === "POST");
    assert.equal(post.headers.authorization, "Bearer tok_123");
    assert.equal(post.headers["x-xeno-workspace"], "ws_1");
    assert.equal(post.headers["idempotency-key"], "idem_1");
    assert.equal(post.headers["content-type"], "application/json");
    assert.equal(post.body.schemaVersion, 1);
    assert.equal(post.body.prompt, "Fix the failing tests");
    assert.equal(post.body.model, "gpt-5.5");
    assert.equal(post.body.effort, "high");
    assert.deepEqual(post.body.budget, { maxCredits: 500 });
    assert.equal(post.body.previousRunId, "run_prev");
    // idempotencyKey is a header, not a body field
    assert.equal(post.body.idempotencyKey, undefined);
  } finally {
    await srv.close();
  }
});

test("createRun rejects an empty prompt locally without hitting the network", async () => {
  const client = createAgentsClient({ baseUrl: "http://127.0.0.1:1/v1/agents", token: "t" });
  await assert.rejects(
    () => client.createRun({ prompt: "   " }),
    (e) => isAgentsApiError(e) && e.code === "invalid_request",
  );
});

test("getRun / listRuns / stopRun round-trip the projection", async () => {
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs/run_abc") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ schemaVersion: 1, run: runRecord({ status: "running" }) }));
      return true;
    }
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs") {
      assert.equal(ctx.query.get("limit"), "5");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        schemaVersion: 1,
        runs: [{ runId: "run_abc", status: "running", url: "u", createdAt: "t", model: "gpt-5.5", promptPreview: "Fix…" }],
      }));
      return true;
    }
    if (ctx.method === "POST" && ctx.path === "/v1/agents/runs/run_abc/stop") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ schemaVersion: 1, run: runRecord({ status: "cancelled" }) }));
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const got = await client.getRun("run_abc");
    assert.equal(got.status, "running");

    const list = await client.listRuns({ limit: 5 });
    assert.equal(list.length, 1);
    assert.equal(list[0].runId, "run_abc");

    const stopped = await client.stopRun("run_abc");
    assert.equal(stopped.status, "cancelled");
    assert.ok(isTerminalStatus(stopped.status));
  } finally {
    await srv.close();
  }
});

test("attach NDJSON: parses newline-delimited events and stops after terminal", async () => {
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs/run_abc/attach") {
      assert.equal(ctx.query.get("follow"), "true");
      assert.equal(ctx.headers.accept, "application/x-ndjson");
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      // include a split write to exercise buffering
      res.write(JSON.stringify(ev(1, "turn.started")) + "\n");
      res.write(JSON.stringify(ev(2, "model.text.delta", { text: "hi" })).slice(0, 20));
      res.write(JSON.stringify(ev(2, "model.text.delta", { text: "hi" })).slice(20) + "\n");
      res.write(JSON.stringify(ev(3, "run.completed")) + "\n");
      res.end();
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const seen = [];
    for await (const e of client.attach("run_abc", { transport: "ndjson" })) seen.push(e);
    assert.deepEqual(seen.map((e) => e.sequence), [1, 2, 3]);
    assert.deepEqual(seen.map((e) => e.type), ["turn.started", "model.text.delta", "run.completed"]);
    assert.equal(seen[1].payload.text, "hi");
  } finally {
    await srv.close();
  }
});

test("attach SSE: parses id/data frames, skips ping heartbeat, honors [DONE]", async () => {
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs/run_abc/attach") {
      assert.equal(ctx.headers.accept, "text/event-stream");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": ping\n\n"); // heartbeat comment — must be skipped
      res.write(`id: 1\ndata: ${JSON.stringify(ev(1, "turn.started"))}\n\n`);
      res.write(`id: 2\ndata: ${JSON.stringify(ev(2, "run.completed"))}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const seen = [];
    for await (const e of client.attach("run_abc", { transport: "sse" })) seen.push(e);
    assert.deepEqual(seen.map((e) => e.sequence), [1, 2]);
    assert.equal(seen[1].type, "run.completed");
  } finally {
    await srv.close();
  }
});

test("attach SSE resume: passes Last-Event-ID header from `since`", async () => {
  let sawLastEventId;
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs/run_abc/attach") {
      sawLastEventId = ctx.headers["last-event-id"];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`id: 6\ndata: ${JSON.stringify(ev(6, "model.text.delta", { text: "resumed" }))}\n\n`);
      res.write(`id: 7\ndata: ${JSON.stringify(ev(7, "run.completed"))}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const seen = [];
    for await (const e of client.attach("run_abc", { transport: "sse", since: 5 })) seen.push(e);
    assert.equal(sawLastEventId, "5");
    assert.deepEqual(seen.map((e) => e.sequence), [6, 7]);
  } finally {
    await srv.close();
  }
});

test("attach NDJSON resume: passes ?since query param", async () => {
  let sawSince;
  const srv = await startServer((req, res, ctx) => {
    if (ctx.method === "GET" && ctx.path === "/v1/agents/runs/run_abc/attach") {
      sawSince = ctx.query.get("since");
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify(ev(11, "run.completed")) + "\n");
      res.end();
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const seen = [];
    for await (const e of client.attach("run_abc", { transport: "ndjson", since: 10 })) seen.push(e);
    assert.equal(sawSince, "10");
    assert.equal(seen[0].sequence, 11);
  } finally {
    await srv.close();
  }
});

test("onEvent callback wrapper delivers events and resolves done", async () => {
  const srv = await startServer((req, res, ctx) => {
    if (ctx.path === "/v1/agents/runs/run_abc/attach") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(JSON.stringify(ev(1, "turn.started")) + "\n");
      res.write(JSON.stringify(ev(2, "run.completed")) + "\n");
      res.end();
      return true;
    }
    return false;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    const seen = [];
    const { done } = client.onEvent("run_abc", (e) => { seen.push(e.type); });
    await done;
    assert.deepEqual(seen, ["turn.started", "run.completed"]);
  } finally {
    await srv.close();
  }
});

test("error taxonomy: status codes + { error } body map to typed codes", async () => {
  const cases = [
    { status: 401, body: { error: "unauthorized" }, code: "unauthorized" },
    { status: 402, body: { error: "insufficient_credits" }, code: "insufficient_credits" },
    { status: 402, body: { error: "budget_exceeded" }, code: "budget_exceeded" },
    { status: 404, body: { error: "run_not_found" }, code: "run_not_found" },
    { status: 429, body: { error: "rate_limited" }, code: "rate_limited" },
  ];
  for (const c of cases) {
    const srv = await startServer((req, res) => {
      res.writeHead(c.status, { "content-type": "application/json" });
      res.end(JSON.stringify(c.body));
      return true;
    });
    try {
      const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
      await assert.rejects(
        () => client.getRun("run_x"),
        (e) => {
          assert.ok(e instanceof AgentsApiError, "is AgentsApiError");
          assert.equal(e.code, c.code, `code for ${c.status}`);
          assert.equal(e.status, c.status);
          return true;
        },
      );
      // spot-check the boolean helpers
      if (c.code === "budget_exceeded") {
        try { await createAgentsClient({ baseUrl: srv.baseUrl, token: "t" }).getRun("x"); }
        catch (e) { assert.equal(e.isBudgetExceeded, true); }
      }
    } finally {
      await srv.close();
    }
  }
});

test("error taxonomy: falls back to status when body has no code", async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(402, { "content-type": "text/plain" });
    res.end("nope");
    return true;
  });
  try {
    const client = createAgentsClient({ baseUrl: srv.baseUrl, token: "t" });
    await assert.rejects(
      () => client.getRun("x"),
      (e) => isAgentsApiError(e) && e.code === "insufficient_credits" && e.status === 402,
    );
  } finally {
    await srv.close();
  }
});

test("network error normalizes to network_error and honors AbortSignal", async () => {
  const client = createAgentsClient({ baseUrl: "http://127.0.0.1:1/v1/agents", token: "t", timeoutMs: 0 });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => client.getRun("x", { signal: ac.signal }),
    (e) => isAgentsApiError(e) && e.code === "network_error" && e.isNetwork === true,
  );
});

test("TERMINAL_STATUSES matches the locked set", () => {
  assert.deepEqual(
    [...TERMINAL_STATUSES].sort(),
    ["cancelled", "completed", "failed", "interrupted", "skipped"],
  );
});
