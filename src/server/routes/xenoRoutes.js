/**
 * Xeno AI proxy routes — all generation requests flow through here
 * so we can check/deduct per-user credits on the server side.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { accessSync, constants, statSync } from 'fs';
import { availableParallelism } from 'os';
import { delimiter, isAbsolute, join } from 'path';

import { Router } from 'express';
import Xeno from 'xeno-ai';
import { getCreditCost } from '../utils/creditCosts.js';
import { logUsage } from '../utils/creditTransactions.js';
import { resolveEntitlements, capDimensions, gateMeta } from '../utils/entitlementGate.js';
import { watermarkResultData, watermarkVideoData } from '../utils/watermark.js';
import { meterMediaGeneration } from '../utils/inferenceMeter.js';
import { MICRO_PER_CREDIT, getBalanceV2 } from '../utils/creditLedgerV2.js';

// Cap image batch size: cost×n is charged, but an unbounded n is still a provider-
// abuse / oversell vector, so clamp requested outputs to a sane maximum.
const MAX_IMAGE_BATCH = 8;

/** Current available balance in whole credits (best-effort; 0 on error). */
async function availableCredits(db, userId) {
  const bal = await getBalanceV2(db, userId).catch(() => null);
  return bal ? bal.availableMicro / MICRO_PER_CREDIT : 0;
}

const router = Router();
const XENO_API_KEY = process.env.XENO_API_KEY || '';
const remoteRuns = new Map();
const MAX_REMOTE_EVENTS = 500;
const DEFAULT_REMOTE_MAX_CONCURRENT = 1;
const DEFAULT_REMOTE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_REMOTE_RETENTION = 100;
const DEFAULT_REMOTE_MAX_PROMPT_CHARS = 20000;
const DEFAULT_REMOTE_MAX_EVENT_TEXT_CHARS = 16000;
const DEFAULT_REMOTE_AUTOSCALE_MIN = 1;
const MAX_REMOTE_OPTION_CHARS = 2048;
const REMOTE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const REMOTE_RUNNER_BASE_ENV = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TMP',
  'TEMP',
  'SHELL',
  'LANG',
  'LC_ALL',
];

const xenoClient = XENO_API_KEY
  ? new Xeno({
      apiKey: XENO_API_KEY,
      baseURL: 'https://api.xenostudio.ai/v1',
    })
  : null;

function getUserId(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return userId;
}

function requireUser(req, res, next) {
  if (!getUserId(req, res)) return;
  res.set('Cache-Control', 'no-store');
  next();
}

function ensureXenoConfigured(res) {
  if (!XENO_API_KEY || !xenoClient) {
    res.status(500).json({ error: 'XENO_API_KEY is not configured on the server' });
    return false;
  }
  return true;
}

function missingPrompt(prompt) {
  return typeof prompt !== 'string' || !prompt.trim();
}

function getApiErrorStatus(apiError) {
  const rawStatus = Number(
    apiError?.statusCode ||
    apiError?.status ||
    apiError?.response?.status
  );

  if (Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599) {
    return rawStatus;
  }

  return 500;
}

function normalizeErrorText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function getApiErrorDetail(apiError) {
  const responseData = apiError?.response?.data;
  const structuredError = responseData?.error;

  const candidates = [
    typeof structuredError === 'string' ? structuredError : '',
    structuredError?.message,
    responseData?.message,
    responseData?.detail,
    responseData?.reason,
    responseData?.error_description,
    apiError?.error?.message,
    apiError?.message,
  ];

  for (const candidate of candidates) {
    const text = normalizeErrorText(candidate);
    if (text) {
      return text;
    }
  }

  return 'Xeno API error';
}

function getApiErrorMessage(apiError, context = {}) {
  const normalizedMessage = getApiErrorDetail(apiError);
  const status = getApiErrorStatus(apiError);

  // Some Xeno SDK errors lose response body and return only this generic message.
  if (/^image generation failed$/i.test(normalizedMessage) && context?.model) {
    return `Xeno image generation failed for model "${context.model}" (status ${status}). Try again later or use another model.`;
  }

  return normalizedMessage;
}

function insufficientCreditsResponse(res, required, currentCredits) {
  return res.status(402).json({
    error: 'Insufficient credits',
    required,
    current: currentCredits,
  });
}

function remoteRunnerCommand() {
  return process.env.XENO_REMOTE_RUNNER_COMMAND?.trim() || '';
}

function remoteRunnerArgsTemplate() {
  if (!process.env.XENO_REMOTE_RUNNER_ARGS_JSON) return ['run', '--json', '{prompt}'];
  const parsed = JSON.parse(process.env.XENO_REMOTE_RUNNER_ARGS_JSON);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('XENO_REMOTE_RUNNER_ARGS_JSON must be a JSON string array');
  }
  return parsed;
}

function remoteRunnerCwd() {
  return process.env.XENO_REMOTE_RUNNER_CWD?.trim() || '';
}

function remoteRunnerEnvAllowlist() {
  return (process.env.XENO_REMOTE_RUNNER_ENV_ALLOWLIST || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function remoteRunnerApiKeyEnv() {
  return process.env.XENO_REMOTE_RUNNER_API_KEY_ENV?.trim() || '';
}

function remoteRunnerEnv(run, request) {
  const env = {};
  for (const key of [...REMOTE_RUNNER_BASE_ENV, ...remoteRunnerEnvAllowlist()]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const apiKeyEnv = remoteRunnerApiKeyEnv();
  if (apiKeyEnv && process.env[apiKeyEnv]) env.XENO_API_KEY = process.env[apiKeyEnv];
  return {
    ...env,
    XENO_REMOTE_RUN_ID: run.runId,
    XENO_REMOTE_USER_ID: run.userId,
    XENO_REMOTE_PROMPT: request.prompt,
    XENO_REMOTE_REQUESTED_CWD: request.cwd || '',
    XENO_REMOTE_MODEL: request.model || '',
    XENO_REMOTE_WORKSPACE: request.workspace || '',
  };
}

function isExecutableCommandPath(path) {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function remoteRunnerCommandExists(command) {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return isExecutableCommandPath(command);
  }

  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];
  return (process.env.PATH || '').split(delimiter).some((dir) => (
    dir && extensions.some((extension) => isExecutableCommandPath(join(dir, `${command}${extension}`)))
  ));
}

function remoteRunnerCwdError() {
  const cwd = remoteRunnerCwd();
  if (!cwd) return '';
  try {
    return statSync(cwd).isDirectory() ? '' : `Hosted remote runner cwd is not a directory: ${cwd}`;
  } catch {
    return `Hosted remote runner cwd not found: ${cwd}`;
  }
}

function remoteRunnerConfigError() {
  const command = remoteRunnerCommand();
  if (!command) return '';
  if (!remoteRunnerCommandExists(command)) {
    return `Hosted remote runner command not found: ${command}`;
  }
  const apiKeyEnv = remoteRunnerApiKeyEnv();
  if (apiKeyEnv && !process.env[apiKeyEnv]) {
    return `Hosted remote runner API key env is not set: ${apiKeyEnv}`;
  }
  const cwdError = remoteRunnerCwdError();
  if (cwdError) return cwdError;
  try {
    remoteRunnerArgsTemplate();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanEnv(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function remoteFixedMaxConcurrent() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_MAX_CONCURRENT', DEFAULT_REMOTE_MAX_CONCURRENT);
}

function remoteAutoscaleCapacity() {
  const enabled = booleanEnv('XENO_REMOTE_RUNNER_AUTOSCALE');
  const fixedMax = remoteFixedMaxConcurrent();
  if (!enabled) {
    return {
      enabled: false,
      maxConcurrent: fixedMax,
    };
  }

  const minConcurrent = positiveIntegerEnv('XENO_REMOTE_RUNNER_AUTOSCALE_MIN', DEFAULT_REMOTE_AUTOSCALE_MIN);
  const maxConcurrent = Math.max(
    minConcurrent,
    positiveIntegerEnv('XENO_REMOTE_RUNNER_AUTOSCALE_MAX', fixedMax)
  );
  const hostWorkers = Math.max(1, Math.floor(availableParallelism() / 2));
  return {
    enabled: true,
    mode: 'local-cpu',
    minConcurrent,
    maxConcurrent,
    targetConcurrent: Math.max(minConcurrent, Math.min(maxConcurrent, hostWorkers)),
  };
}

function remoteMaxConcurrent() {
  const autoscale = remoteAutoscaleCapacity();
  return autoscale.enabled ? autoscale.targetConcurrent : autoscale.maxConcurrent;
}

function remoteTimeoutMs() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_TIMEOUT_MS', DEFAULT_REMOTE_TIMEOUT_MS);
}

function remoteRetentionLimit() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_RETENTION', DEFAULT_REMOTE_RETENTION);
}

function remoteMaxPromptChars() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_MAX_PROMPT_CHARS', DEFAULT_REMOTE_MAX_PROMPT_CHARS);
}

function remoteMaxEventTextChars() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_MAX_EVENT_TEXT_CHARS', DEFAULT_REMOTE_MAX_EVENT_TEXT_CHARS);
}

function remoteRunnerCapabilities() {
  return remoteRunnerCommand() && !remoteRunnerConfigError()
    ? ['runs.start', 'runs.list', 'runs.get', 'runs.events', 'runs.attach', 'runs.stop']
    : [];
}

function optionalRemoteText(value, field) {
  if (value === undefined || value === null || value === '') return { value: undefined };
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined };
  if (trimmed.length > MAX_REMOTE_OPTION_CHARS) {
    return { error: `${field} must be ${MAX_REMOTE_OPTION_CHARS} characters or fewer` };
  }
  return { value: trimmed };
}

function remoteWorkspace(req) {
  return optionalRemoteText(req.get('x-xeno-workspace') || req.body?.workspace || req.query.workspace, 'workspace');
}

function remoteRunRef(run) {
  return {
    runId: run.runId,
    status: run.status,
    url: `/api/xeno/remote/runs/${run.runId}`,
    ...(run.workspace ? { workspace: run.workspace } : {}),
  };
}

function truncateRemotePrompt(prompt) {
  if (typeof prompt !== 'string') return undefined;
  return prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt;
}

function remoteRunSummary(run) {
  return {
    ...remoteRunRef(run),
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.workspace ? { workspace: run.workspace } : {}),
    ...(run.prompt ? { promptPreview: truncateRemotePrompt(run.prompt) } : {}),
  };
}

function remoteRunDatabase(reqOrRun) {
  const db = reqOrRun?.db;
  return db && typeof db.query === 'function' ? db : null;
}

function isoFromDb(value) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

function remoteRunFromRow(row, events = [], db) {
  return {
    runId: row.run_id,
    userId: row.user_id,
    workspace: row.workspace || undefined,
    status: row.status,
    prompt: row.prompt,
    requestedCwd: row.requested_cwd || undefined,
    model: row.model || undefined,
    permissionMode: row.permission_mode || undefined,
    createdAt: isoFromDb(row.created_at),
    startedAt: isoFromDb(row.started_at),
    endedAt: isoFromDb(row.ended_at),
    exitCode: row.exit_code,
    signal: row.signal,
    events,
    subscribers: new Set(),
    db,
  };
}

async function reconcilePersistedRemoteRun(run) {
  const liveRun = remoteRuns.get(run.runId);
  if (liveRun) return liveRun;
  if (isRemoteTerminalStatus(run.status)) return run;

  run.status = 'failed';
  run.endedAt = new Date().toISOString();
  run.signal = 'server_restart';
  const event = {
    timestamp: new Date().toISOString(),
    type: 'run_recovered_failed',
    reason: 'Hosted remote runner process is no longer live on this server.',
  };
  run.events.push(event);
  await persistRemoteRun(run);
  await persistRemoteEvent(run, event);
  return run;
}

async function persistRemoteRun(run) {
  const db = remoteRunDatabase(run);
  if (!db) return;
  await db.query(
    `
      INSERT INTO xeno_remote_runs (
        run_id, user_id, workspace, status, prompt, requested_cwd, model, permission_mode,
        created_at, started_at, ended_at, exit_code, signal
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (run_id) DO UPDATE SET
        workspace = EXCLUDED.workspace,
        status = EXCLUDED.status,
        requested_cwd = EXCLUDED.requested_cwd,
        model = EXCLUDED.model,
        permission_mode = EXCLUDED.permission_mode,
        started_at = COALESCE(EXCLUDED.started_at, xeno_remote_runs.started_at),
        ended_at = EXCLUDED.ended_at,
        exit_code = EXCLUDED.exit_code,
        signal = EXCLUDED.signal
    `,
    [
      run.runId,
      run.userId,
      run.workspace || null,
      run.status,
      run.prompt,
      run.requestedCwd || null,
      run.model || null,
      run.permissionMode || null,
      run.createdAt,
      run.startedAt || null,
      run.endedAt || null,
      Number.isInteger(run.exitCode) ? run.exitCode : null,
      run.signal || null,
    ]
  );
}

function persistRemoteRunSoon(run) {
  persistRemoteRun(run).catch((error) => {
    console.error('[XenoRoutes] Failed to persist remote run:', error.message);
  });
}

async function persistRemoteEvent(run, event) {
  const db = remoteRunDatabase(run);
  if (!db) return;
  await db.query(
    `
      INSERT INTO xeno_remote_run_events (run_id, event_type, event)
      VALUES ($1, $2, $3::jsonb)
    `,
    [run.runId, event.type || 'event', JSON.stringify(event)]
  );
}

function persistRemoteEventSoon(run, event) {
  persistRemoteEvent(run, event).catch((error) => {
    console.error('[XenoRoutes] Failed to persist remote run event:', error.message);
  });
}

async function loadRemoteEvents(db, runId, tail = MAX_REMOTE_EVENTS) {
  const limit = Math.max(0, Number(tail) || MAX_REMOTE_EVENTS);
  if (limit === 0) return [];
  const { rows } = await db.query(
    `
      SELECT event
      FROM xeno_remote_run_events
      WHERE run_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [runId, limit]
  );
  return rows.reverse().map((row) => (
    typeof row.event === 'string' ? JSON.parse(row.event) : row.event
  ));
}

async function remoteRunFor(req, res) {
  const workspace = remoteWorkspace(req);
  if (workspace.error) {
    res.status(400).json({ error: workspace.error });
    return null;
  }
  const liveRun = remoteRuns.get(req.params.runId);
  if (liveRun) {
    if (liveRun.userId === req.user.id && (!workspace.value || liveRun.workspace === workspace.value)) return liveRun;
    res.status(404).json({ error: 'Remote run not found' });
    return null;
  }

  const db = remoteRunDatabase(req);
  if (db) {
    const { rows } = await db.query(
      `
        SELECT run_id, user_id, workspace, status, prompt, requested_cwd, model, permission_mode,
               created_at, started_at, ended_at, exit_code, signal
        FROM xeno_remote_runs
        WHERE run_id = $1 AND user_id = $2 AND ($3::text IS NULL OR workspace = $3)
      `,
      [req.params.runId, req.user.id, workspace.value || null]
    );
    if (rows[0]) {
      return reconcilePersistedRemoteRun(
        remoteRunFromRow(rows[0], await loadRemoteEvents(db, req.params.runId), db)
      );
    }
  }

  res.status(404).json({ error: 'Remote run not found' });
  return null;
}

async function listRemoteRuns(req, limit, workspace) {
  const userId = req.user.id;
  const db = remoteRunDatabase(req);
  if (db) {
    const { rows } = await db.query(
      `
        SELECT run_id, user_id, workspace, status, prompt, requested_cwd, model, permission_mode,
               created_at, started_at, ended_at, exit_code, signal
        FROM xeno_remote_runs
        WHERE user_id = $1 AND ($3::text IS NULL OR workspace = $3)
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, limit, workspace || null]
    );
    return Promise.all(rows.map((row) => reconcilePersistedRemoteRun(remoteRunFromRow(row, [], db))));
  }

  return [...remoteRuns.values()]
    .filter((run) => run.userId === userId && (!workspace || run.workspace === workspace))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function isRemoteTerminalStatus(status) {
  return REMOTE_TERMINAL_STATUSES.has(status);
}

function activeRemoteRunCount() {
  return [...remoteRuns.values()].filter((run) => !isRemoteTerminalStatus(run.status)).length;
}

function remoteCapacityReport() {
  const activeRuns = activeRemoteRunCount();
  const maxConcurrent = remoteMaxConcurrent();
  return {
    activeRuns,
    maxConcurrent,
    availableSlots: Math.max(0, maxConcurrent - activeRuns),
    autoscale: remoteAutoscaleCapacity(),
  };
}

function pruneRemoteRuns() {
  const removable = [...remoteRuns.values()]
    .filter((run) => isRemoteTerminalStatus(run.status))
    .sort((a, b) => String(a.endedAt || a.createdAt).localeCompare(String(b.endedAt || b.createdAt)));
  while (remoteRuns.size > remoteRetentionLimit() && removable.length > 0) {
    const run = removable.shift();
    remoteRuns.delete(run.runId);
  }
}

function addRemoteEvent(run, event) {
  const next = { timestamp: new Date().toISOString(), ...event };
  const maxText = remoteMaxEventTextChars();
  if (typeof next.text === 'string' && next.text.length > maxText) {
    next.textOriginalLength = next.text.length;
    next.textTruncated = true;
    next.text = `${next.text.slice(0, Math.max(0, maxText - 3))}...`;
  }
  run.events.push(next);
  if (run.events.length > MAX_REMOTE_EVENTS) run.events.splice(0, run.events.length - MAX_REMOTE_EVENTS);
  persistRemoteEventSoon(run, next);
  for (const subscriber of run.subscribers) subscriber(next);
}

function isRemoteTerminalEvent(event) {
  return ['run_finished', 'run_failed', 'run_cancelled'].includes(event.type);
}

function remoteRunnerArgs(run, request) {
  const args = remoteRunnerArgsTemplate();
  const replacements = {
    '{runId}': run.runId,
    '{prompt}': request.prompt,
    '{cwd}': request.cwd || '',
    '{model}': request.model || '',
    '{permissionMode}': request.permissionMode || '',
    '{workspace}': request.workspace || '',
  };
  return args.map((arg) => replacements[arg] ?? arg);
}

function startRemoteRunner(run, request) {
  const command = remoteRunnerCommand();
  if (!command) throw new Error('Hosted remote runner is not configured');
  const timeoutMs = remoteTimeoutMs();

  const child = spawn(command, remoteRunnerArgs(run, request), {
    cwd: remoteRunnerCwd() || process.cwd(),
    env: remoteRunnerEnv(run, request),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  run.child = child;
  run.timeout = setTimeout(() => {
    if (isRemoteTerminalStatus(run.status)) return;
    run.status = 'failed';
    run.endedAt = new Date().toISOString();
    persistRemoteRunSoon(run);
    addRemoteEvent(run, { type: 'run_timed_out', timeoutMs });
    child.kill('SIGTERM');
  }, timeoutMs);
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  persistRemoteRunSoon(run);
  addRemoteEvent(run, { type: 'run_started', runId: run.runId });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => addRemoteEvent(run, { type: 'stdout', text }));
  child.stderr.on('data', (text) => addRemoteEvent(run, { type: 'stderr', text }));
  child.on('error', (error) => {
    run.status = 'failed';
    run.endedAt = new Date().toISOString();
    clearTimeout(run.timeout);
    persistRemoteRunSoon(run);
    addRemoteEvent(run, { type: 'run_failed', error: error.message });
    pruneRemoteRuns();
  });
  child.on('close', (code, signal) => {
    run.exitCode = code;
    run.signal = signal;
    run.endedAt = new Date().toISOString();
    clearTimeout(run.timeout);
    if (run.status !== 'cancelled') run.status = code === 0 ? 'completed' : 'failed';
    persistRemoteRunSoon(run);
    addRemoteEvent(run, { type: 'run_finished', exitCode: code, signal, status: run.status });
    pruneRemoteRuns();
  });
}

router.use('/remote', requireUser);

// ---------- GET /api/xeno/remote/status ----------
router.get('/remote/status', (req, res) => {
  const capabilities = remoteRunnerCapabilities();
  const configError = remoteRunnerConfigError();
  const capacity = remoteCapacityReport();
  res.json({
    schemaVersion: 1,
    ok: !configError,
    service: 'xeno-platform-remote',
    version: process.env.npm_package_version || '1.0.0',
    capabilities,
    deployment: {
      configured: Boolean(remoteRunnerCommand()),
      ready: capabilities.includes('runs.start'),
      storage: remoteRunDatabase(req) ? 'durable' : 'memory',
      rolloutState: capabilities.includes('runs.start')
        ? 'ready'
        : remoteRunnerCommand()
          ? 'misconfigured'
          : 'disabled',
    },
    capacity,
    ...(configError ? { error: configError } : {}),
    message: capabilities.includes('runs.start')
      ? 'Hosted remote runner is configured.'
      : configError || 'Hosted remote runs are not deployed on this backend yet.',
  });
});

// ---------- POST /api/xeno/remote/runs ----------
router.get('/remote/runs', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const workspace = remoteWorkspace(req);
  if (workspace.error) return res.status(400).json({ error: workspace.error });
  const runs = await listRemoteRuns(req, limit, workspace.value);
  return res.json({ schemaVersion: 1, runs: runs.map(remoteRunSummary) });
});

router.post('/remote/runs', async (req, res) => {
  const configError = remoteRunnerConfigError();
  if (!remoteRunnerCommand()) {
    return res.status(503).json({ error: 'Hosted remote runner is not configured' });
  }
  if (configError) {
    return res.status(503).json({ error: configError });
  }
  pruneRemoteRuns();
  const maxConcurrent = remoteMaxConcurrent();
  if (activeRemoteRunCount() >= maxConcurrent) {
    res.set('Retry-After', '15');
    return res.status(429).json({
      error: 'Hosted remote runner concurrency limit reached',
      maxConcurrent,
      capacity: remoteCapacityReport(),
    });
  }
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const maxPromptChars = remoteMaxPromptChars();
  if (prompt.length > maxPromptChars) {
    return res.status(413).json({
      error: `Prompt must be ${maxPromptChars} characters or fewer`,
      maxPromptChars,
    });
  }
  const cwd = optionalRemoteText(req.body?.cwd, 'cwd');
  const model = optionalRemoteText(req.body?.model, 'model');
  const permissionMode = optionalRemoteText(req.body?.permissionMode, 'permissionMode');
  const workspace = remoteWorkspace(req);
  for (const field of [cwd, model, permissionMode, workspace]) {
    if (field.error) return res.status(400).json({ error: field.error });
  }
  const remoteRequest = {
    prompt,
    cwd: cwd.value,
    model: model.value,
    permissionMode: permissionMode.value,
    workspace: workspace.value,
  };

  const run = {
    runId: `remote_${randomUUID()}`,
    userId: req.user.id,
    workspace: remoteRequest.workspace,
    status: 'queued',
    prompt,
    requestedCwd: remoteRequest.cwd,
    model: remoteRequest.model,
    permissionMode: remoteRequest.permissionMode,
    createdAt: new Date().toISOString(),
    events: [],
    subscribers: new Set(),
    db: remoteRunDatabase(req),
  };

  try {
    await persistRemoteRun(run);
  } catch (error) {
    console.error('[XenoRoutes] Failed to create durable remote run:', error.message);
    return res.status(500).json({ error: 'Failed to create durable remote run' });
  }

  remoteRuns.set(run.runId, run);

  try {
    startRemoteRunner(run, remoteRequest);
  } catch (error) {
    run.status = 'failed';
    run.endedAt = new Date().toISOString();
    persistRemoteRunSoon(run);
    addRemoteEvent(run, { type: 'run_failed', error: error.message });
  }

  return res.status(202).json({ schemaVersion: 1, run: remoteRunRef(run) });
});

// ---------- GET /api/xeno/remote/runs/:runId ----------
router.get('/remote/runs/:runId', async (req, res) => {
  const run = await remoteRunFor(req, res);
  if (!run) return;
  res.json({ schemaVersion: 1, run: remoteRunRef(run) });
});

router.get('/remote/runs/:runId/events', async (req, res) => {
  const run = await remoteRunFor(req, res);
  if (!run) return;
  const tail = Math.max(0, Number(req.query.tail) || run.events.length);
  res.json({ schemaVersion: 1, events: run.events.slice(-tail) });
});

router.get('/remote/runs/:runId/attach', async (req, res) => {
  const run = await remoteRunFor(req, res);
  if (!run) return;
  const tail = Math.max(0, Number(req.query.tail) || run.events.length);
  if (req.query.follow !== 'true') {
    return res.json({ schemaVersion: 1, run: remoteRunRef(run), events: run.events.slice(-tail) });
  }

  const liveRun = remoteRuns.get(req.params.runId);
  if (!liveRun && !isRemoteTerminalStatus(run.status)) {
    return res.status(409).json({ error: 'Remote run is not live on this server' });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const event of run.events.slice(-tail)) res.write(`data: ${JSON.stringify(event)}\n\n`);
  const subscriber = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (isRemoteTerminalEvent(event)) res.end();
  };
  run.subscribers.add(subscriber);
  req.on('close', () => run.subscribers.delete(subscriber));
  if (['completed', 'failed', 'cancelled'].includes(run.status)) res.end();
});

router.post('/remote/runs/:runId/stop', async (req, res) => {
  const run = await remoteRunFor(req, res);
  if (!run) return;
  if (!remoteRuns.has(req.params.runId) && !isRemoteTerminalStatus(run.status)) {
    return res.status(409).json({ error: 'Remote run is not live on this server' });
  }
  if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
    run.status = 'cancelled';
    run.endedAt = new Date().toISOString();
    clearTimeout(run.timeout);
    run.child?.kill('SIGTERM');
    persistRemoteRunSoon(run);
    addRemoteEvent(run, { type: 'run_cancelled', runId: run.runId });
  }
  pruneRemoteRuns();
  res.json({ schemaVersion: 1, run: remoteRunRef(run) });
});

// ---------- POST /api/xeno/images/generate ----------
router.post('/images/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, width, height, seed, n, requestId, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Entitlement gate: Free = standard resolution + watermark; Pro/Team = 4K + clean.
    const ent = await resolveEntitlements(req.db, userId);
    const dims = capDimensions(ent, width, height);
    const count = Math.min(Math.max(1, Math.floor(Number(n) || 1)), MAX_IMAGE_BATCH);
    const unitCost = getCreditCost('image', model);
    const reqId = requestId || req.headers['x-request-id'] || randomUUID();

    let metered;
    try {
      // Reserve unitCost × count up front, run the provider, settle the actual count.
      metered = await meterMediaGeneration(req.db, userId, {
        surface: 'image_generation',
        operation: `image.generate:${model}`,
        model,
        provider: 'xeno',
        requestId: reqId,
        unitCostMicro: unitCost * MICRO_PER_CREDIT,
        count,
        run: async () => {
          const result = await xenoClient.image.generate({
            model,
            prompt: prompt.trim(),
            width: dims.width,
            height: dims.height,
            seed,
            n: count,
            ...rest,
          });
          // Watermark BEFORE settle so a watermark failure voids the hold (no charge, no leak).
          if (ent.watermark && Array.isArray(result?.data)) {
            result.data = await watermarkResultData(result.data);
          }
          return result;
        },
      });
    } catch (err) {
      if (err?.http === 402) {
        return insufficientCreditsResponse(res, unitCost * count, await availableCredits(req.db, userId));
      }
      if (err?.http === 403) {
        return res.status(403).json({ error: 'Account frozen', code: 'ACCOUNT_FROZEN' });
      }
      // Provider error — the hold was already voided (no charge).
      console.error('[XenoRoutes] Image generate API error:', err);
      const status = getApiErrorStatus(err);
      return res.status(status).json({
        error: getApiErrorMessage(err, { model }),
        model,
        status,
        credits_refunded: true,
      });
    }

    const data = metered.result?.data || [];
    await logUsage(req.db, userId, `image:${model}`, metered.creditsCharged, {
      route: '/api/xeno/images/generate',
      model,
      count: metered.actualCount,
      prompt_length: prompt.trim().length,
    });

    return res.json({
      data,
      model: metered.result?.model || model,
      credits_used: metered.creditsCharged,
      count: metered.actualCount,
      remaining_credits: await availableCredits(req.db, userId),
      entitlement: gateMeta(ent),
      resolution_capped: dims.capped,
    });
  } catch (error) {
    console.error('[XenoRoutes] Image generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/images/edit ----------
router.post('/images/edit', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    // Strip any `n` so the edit is single-output (flat EDIT_COST) and cannot be
    // batched-for-free through the `...rest` passthrough (IMG-COST-N-2).
    const { image, prompt, model = 'auto', requestId, n: _ignoredN, ...rest } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Entitlement gate resolved BEFORE generation (Free = watermarked; Pro/Team = clean).
    const ent = await resolveEntitlements(req.db, userId);
    const unitCost = getCreditCost('edit', model);
    const reqId = requestId || req.headers['x-request-id'] || randomUUID();

    let metered;
    try {
      metered = await meterMediaGeneration(req.db, userId, {
        surface: 'image_edit',
        operation: `image.edit:${model}`,
        model,
        provider: 'xeno',
        requestId: reqId,
        unitCostMicro: unitCost * MICRO_PER_CREDIT,
        count: 1,
        run: async () => {
          const result = await xenoClient.image.edit({
            image,
            prompt: prompt.trim(),
            model,
            ...rest,
          });
          if (ent.watermark && Array.isArray(result?.data)) {
            result.data = await watermarkResultData(result.data);
          }
          return result;
        },
      });
    } catch (err) {
      if (err?.http === 402) {
        return insufficientCreditsResponse(res, unitCost, await availableCredits(req.db, userId));
      }
      if (err?.http === 403) {
        return res.status(403).json({ error: 'Account frozen', code: 'ACCOUNT_FROZEN' });
      }
      console.error('[XenoRoutes] Image edit API error:', err);
      const status = getApiErrorStatus(err);
      return res.status(status).json({
        error: getApiErrorMessage(err),
        status,
        credits_refunded: true,
      });
    }

    const data = metered.result?.data || [];
    await logUsage(req.db, userId, `edit:${model}`, metered.creditsCharged, {
      route: '/api/xeno/images/edit',
      model,
      prompt_length: prompt.trim().length,
    });

    return res.json({
      data,
      model: metered.result?.model || model,
      credits_used: metered.creditsCharged,
      remaining_credits: await availableCredits(req.db, userId),
      entitlement: gateMeta(ent),
    });
  } catch (error) {
    console.error('[XenoRoutes] Image edit error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/videos/generate ----------
router.post('/videos/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, image, duration, aspect_ratio, resolution, fps, seed, requestId, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Entitlement gate (was MISSING entirely): Free = watermarked, non-commercial;
    // Pro/Team = clean. Video is Free-eligible (XENO-MONETIZATION §Free) but must be
    // watermarked — so we gate + watermark, we do NOT block.
    const ent = await resolveEntitlements(req.db, userId);
    const unitCost = getCreditCost('video', model);
    const reqId = requestId || req.headers['x-request-id'] || randomUUID();

    let metered;
    try {
      metered = await meterMediaGeneration(req.db, userId, {
        surface: 'video_generation',
        operation: `video.generate:${model}`,
        model,
        provider: 'xeno',
        requestId: reqId,
        unitCostMicro: unitCost * MICRO_PER_CREDIT,
        count: 1,
        run: async () => {
          const result = await xenoClient.video.generate({
            model,
            prompt: prompt.trim(),
            image,
            duration,
            aspect_ratio,
            resolution,
            fps,
            seed,
            wait: true,
            ...rest,
          });
          // Free tier: watermark every frame (ffmpeg overlay → self-contained data URL).
          // FAIL-CLOSED — watermarkVideoData throws on failure, which voids the hold
          // (user not charged) rather than leaking clean, commercial-usable video.
          if (ent.watermark && Array.isArray(result?.data)) {
            result.data = await watermarkVideoData(result.data);
          }
          return result;
        },
      });
    } catch (err) {
      if (err?.http === 402) {
        return insufficientCreditsResponse(res, unitCost, await availableCredits(req.db, userId));
      }
      if (err?.http === 403) {
        return res.status(403).json({ error: 'Account frozen', code: 'ACCOUNT_FROZEN' });
      }
      console.error('[XenoRoutes] Video generate API error:', err);
      const status = getApiErrorStatus(err);
      return res.status(status).json({
        error: getApiErrorMessage(err, { model }),
        model,
        status,
        credits_refunded: true,
      });
    }

    await logUsage(req.db, userId, `video:${model}`, metered.creditsCharged, {
      route: '/api/xeno/videos/generate',
      model,
      prompt_length: prompt.trim().length,
    });

    return res.json({
      data: metered.result?.data || [],
      model: metered.result?.model || model,
      credits_used: metered.creditsCharged,
      remaining_credits: await availableCredits(req.db, userId),
      entitlement: gateMeta(ent),
    });
  } catch (error) {
    console.error('[XenoRoutes] Video generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/audio/generate ----------
router.post('/audio/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, duration, seed, requestId, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    // Entitlement gate (was MISSING): resolves plan for commercial/limit labelling.
    // Audio has no visual watermark path, so the gate metadata is the enforcement seam.
    const ent = await resolveEntitlements(req.db, userId);
    const unitCost = getCreditCost('audio', model);
    const reqId = requestId || req.headers['x-request-id'] || randomUUID();

    let metered;
    try {
      metered = await meterMediaGeneration(req.db, userId, {
        surface: 'audio_generation',
        operation: `audio.generate:${model}`,
        model,
        provider: 'xeno',
        requestId: reqId,
        unitCostMicro: unitCost * MICRO_PER_CREDIT,
        count: 1,
        run: async () => xenoClient.music.generate({
          model,
          prompt: prompt.trim(),
          duration,
          seed,
          wait: true,
          ...rest,
        }),
      });
    } catch (err) {
      if (err?.http === 402) {
        return insufficientCreditsResponse(res, unitCost, await availableCredits(req.db, userId));
      }
      if (err?.http === 403) {
        return res.status(403).json({ error: 'Account frozen', code: 'ACCOUNT_FROZEN' });
      }
      console.error('[XenoRoutes] Audio generate API error:', err);
      const status = getApiErrorStatus(err);
      return res.status(status).json({
        error: getApiErrorMessage(err),
        status,
        credits_refunded: true,
      });
    }

    await logUsage(req.db, userId, `audio:${model}`, metered.creditsCharged, {
      route: '/api/xeno/audio/generate',
      model,
      prompt_length: prompt.trim().length,
    });

    return res.json({
      data: metered.result?.data || [],
      model: metered.result?.model || model,
      credits_used: metered.creditsCharged,
      remaining_credits: await availableCredits(req.db, userId),
      entitlement: gateMeta(ent),
    });
  } catch (error) {
    console.error('[XenoRoutes] Audio generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
