/**
 * SandboxSession — one code execution for a conversation (CHAT-CODE-EXECUTION-SPEC.md step 3).
 *
 * Ties the two halves together: restore the conversation's persistent sandbox (chatSandbox.js) INTO
 * an ephemeral xenorun run, then capture what the run leaves back into the sandbox. The compute is
 * one-shot and stateless; statefulness comes entirely from restore-before / capture-after, which is
 * why two turns in a row see each other's files without any long-lived container.
 *
 * xenorun is consumed over HTTP (`${XENORUN_URL}/api/v1/execute`) — the same service the manual Run
 * button already uses. `execute` is injectable so the tool loop and tests can drive it without HTTP.
 */
import { getOrCreateSandbox, restoreSandboxFiles, saveSandboxFiles } from './chatSandbox.js';

const XENORUN_URL = (process.env.XENORUN_URL || 'http://xenorun:3000').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MEMORY_MB = 256;

// Cached reachability probe, so the run_code tool is offered only when the engine is actually up
// (CHAT-CODE-EXECUTION-SPEC.md §5 — never advertise a capability the deploy lacks). Cheap and cached
// because it runs on the hot path of building a turn's tool list.
let _probe = { at: 0, ok: false };
const PROBE_TTL_MS = 60_000;

/** Is the code-execution engine reachable right now (cached ~60 s)? */
export async function codeExecutionAvailable(fetchImpl = globalThis.fetch, now = Date.now()) {
  if (now - _probe.at < PROBE_TTL_MS) return _probe.ok;
  let ok = false;
  try {
    const r = await fetchImpl(`${XENORUN_URL}/api/v1/health`, { method: 'GET' });
    if (r.ok) {
      const body = await r.json().catch(() => ({}));
      ok = body?.docker === true || body?.status === 'healthy';
    }
  } catch {
    ok = false;
  }
  _probe = { at: now, ok };
  return ok;
}

/** Test seam: force the next availability check to re-probe. */
export function _resetCodeAvailabilityProbe() {
  _probe = { at: 0, ok: false };
}

/** POST one run to xenorun and return its ExecutionResult (with outputFiles). */
async function callXenorun(body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${XENORUN_URL}/api/v1/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // A dead engine is a distinct, actionable failure — not a run that "returned nothing".
    throw new Error(`code execution engine unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`code execution engine error ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return response.json();
}

/**
 * Run `code` for a conversation with its sandbox restored, then persist the result.
 *
 * @returns {Promise<{sandboxId, status, stdout, stderr, exitCode, executionTime,
 *   savedFiles: {path,size}[], skippedFiles: {path,reason}[], outputFilesTruncated: boolean}>}
 */
export async function runInSandbox({
  db,
  conversationId,
  ownerUserId = null,
  language,
  code,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  memoryLimit = DEFAULT_MEMORY_MB,
  fetchImpl = globalThis.fetch,
  execute = null,
}) {
  if (!conversationId) throw new Error('runInSandbox requires a conversationId');

  const sandbox = await getOrCreateSandbox(db, conversationId, ownerUserId);
  const files = await restoreSandboxFiles(db, sandbox.id);

  const request = { language, code, files, collectOutput: true, timeout: timeoutMs, memoryLimit };
  const run = execute ? await execute(request) : await callXenorun(request, fetchImpl);

  // Capture whatever the run left in /workspace back into the sandbox, enforcing the quota.
  let persistence = { saved: [], skipped: [] };
  if (Array.isArray(run.outputFiles) && run.outputFiles.length > 0) {
    persistence = await saveSandboxFiles(db, sandbox, run.outputFiles);
  }

  return {
    sandboxId: sandbox.id,
    status: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    exitCode: run.exitCode ?? null,
    executionTime: run.executionTime ?? 0,
    savedFiles: persistence.saved,
    skippedFiles: persistence.skipped,
    outputFilesTruncated: Boolean(run.outputFilesTruncated),
  };
}
