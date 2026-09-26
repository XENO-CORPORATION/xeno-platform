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
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
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

/**
 * Meter one code execution on the credits ledger, when a rate is configured
 * (CHAT-CODE-EXECUTION-SPEC.md §6). Code runs on our servers, so it is a paid cloud capability — but
 * the RATE is the owner's decision (creditCosts.js `CODE_EXECUTION_COST`, default 0). At the free
 * default this touches the ledger not at all; once priced, it holds worst-case, runs, and settles per
 * COMPLETED execution — a run that ran, whatever its exit code — while a thrown/unreachable engine
 * voids the hold (meterMediaGeneration's contract: charge per `result.data` entry, void on throw).
 *
 * @param {object} o
 * @param {function} o.meter        meterMediaGeneration(db, userId, opts)
 * @param {number}   o.unitCredits  credits per execution (0 = free, no ledger touch)
 * @param {function} o.doRun        () => runInSandbox(...) — the execution itself
 * @returns {Promise<{ result, creditsCharged: number }>}
 */
export async function runCodeMetered({ meter, db, userId, unitCredits, microPerCredit, requestId, surface, doRun }) {
  if (!(unitCredits > 0) || typeof meter !== 'function' || !userId) {
    // Free (or unmeterable) path: run without touching the ledger.
    return { result: await doRun(), creditsCharged: 0 };
  }
  const metered = await meter(db, userId, {
    surface,
    operation: 'code_execution',
    model: 'xenorun',
    provider: 'xeno',
    requestId,
    unitCostMicro: Math.round(unitCredits * microPerCredit),
    count: 1,
    // One completed execution = one billable output. A throw (engine unreachable) never reaches
    // here — meterMediaGeneration voids the hold — so nothing is charged for a run that did not run.
    run: async () => ({ data: [await doRun()] }),
  });
  return { result: metered.result.data[0], creditsCharged: metered.creditsCharged ?? 0 };
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
 * Surface files a run produced as managed Library assets, so a person can find and download what
 * the code generated (a chart, a CSV) — the same quarantine→scan→ready path chat images use. The
 * `register` fn and `uploadsDir` are injected (registerManagedLibraryFile + the chat uploads dir),
 * so this stays testable. Best-effort by contract: the caller must not let a Library failure fail a
 * run — a produced file is already safe in the sandbox; the Library copy is a convenience.
 *
 * @returns {Promise<{path, assetId}[]>} the assets that were registered.
 */
export async function surfaceRunFilesToLibrary({ db, userId, uploadsDir, register, conversationId, files }) {
  const registered = [];
  if (!userId || !uploadsDir || typeof register !== 'function') return registered;
  await fs.mkdir(uploadsDir, { recursive: true });
  for (const f of files) {
    try {
      const bytes = Buffer.from(f.content, 'base64');
      const base = path.basename(f.path) || 'file';
      const stored = path.join(uploadsDir, `sandbox-${crypto.randomUUID()}-${base}`);
      await fs.writeFile(stored, bytes);
      const record = await register(db, {
        userId,
        workspaceId: null, // owned by the person who ran the code (conservative; not the tenancy scope)
        filename: path.basename(stored),
        originalName: f.path,
        mimeType: 'application/octet-stream', // registerManagedLibraryFile sniffs the real type from bytes
        fileSize: bytes.length,
        storagePath: stored,
        metadata: { source: 'chat-sandbox', conversationId, sandboxPath: f.path },
      });
      registered.push({ path: f.path, assetId: record.id });
    } catch {
      // Best-effort: a Library registration failure never fails the run.
    }
  }
  return registered;
}

/**
 * Run `code` for a conversation with its sandbox restored, then persist the result. When `library`
 * is given ({ register, uploadsDir }), files the run produced are also surfaced as Library assets
 * owned by ownerUserId, and returned as `libraryAssets`.
 *
 * @returns {Promise<{sandboxId, status, stdout, stderr, exitCode, executionTime,
 *   savedFiles: {path,size}[], skippedFiles: {path,reason}[], outputFilesTruncated: boolean,
 *   libraryAssets: {path,assetId}[]}>}
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
  library = null,
}) {
  if (!conversationId) throw new Error('runInSandbox requires a conversationId');

  const sandbox = await getOrCreateSandbox(db, conversationId, ownerUserId);
  const files = await restoreSandboxFiles(db, sandbox.id);

  const request = { language, code, files, collectOutput: true, timeout: timeoutMs, memoryLimit };
  const run = execute ? await execute(request) : await callXenorun(request, fetchImpl);

  // Capture whatever the run left in /workspace back into the sandbox, enforcing the quota.
  let persistence = { saved: [], skipped: [] };
  let libraryAssets = [];
  if (Array.isArray(run.outputFiles) && run.outputFiles.length > 0) {
    persistence = await saveSandboxFiles(db, sandbox, run.outputFiles);
    if (library && ownerUserId && persistence.saved.length > 0) {
      // Surface only the files that were actually saved this run, with their bytes (from the run).
      const contentByPath = new Map(run.outputFiles.map((f) => [f.path, f.content]));
      libraryAssets = await surfaceRunFilesToLibrary({
        db,
        userId: ownerUserId,
        uploadsDir: library.uploadsDir,
        register: library.register,
        conversationId,
        files: persistence.saved.map((s) => ({ path: s.path, content: contentByPath.get(s.path) })).filter((f) => f.content),
      });
    }
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
    libraryAssets,
  };
}
