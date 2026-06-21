/**
 * Xeno AI proxy routes — all generation requests flow through here
 * so we can check/deduct per-user credits on the server side.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, statSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

import { Router } from 'express';
import Xeno from 'xeno-ai';
import { getCreditCost } from '../utils/creditCosts.js';
import { deductCredits, refundCredits, logUsage } from '../utils/creditTransactions.js';

const router = Router();
const XENO_API_KEY = process.env.XENO_API_KEY || '';
const remoteRuns = new Map();
const MAX_REMOTE_EVENTS = 500;
const DEFAULT_REMOTE_MAX_CONCURRENT = 1;
const DEFAULT_REMOTE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_REMOTE_RETENTION = 100;
const DEFAULT_REMOTE_MAX_PROMPT_CHARS = 20000;
const MAX_REMOTE_OPTION_CHARS = 2048;
const REMOTE_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

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

function remoteRunnerCommandExists(command) {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return existsSync(command);
  }

  const extensions = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')]
    : [''];
  return (process.env.PATH || '').split(delimiter).some((dir) => (
    dir && extensions.some((extension) => existsSync(join(dir, `${command}${extension}`)))
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

function remoteMaxConcurrent() {
  return positiveIntegerEnv('XENO_REMOTE_RUNNER_MAX_CONCURRENT', DEFAULT_REMOTE_MAX_CONCURRENT);
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

function remoteRunRef(run) {
  return {
    runId: run.runId,
    status: run.status,
    url: `/api/xeno/remote/runs/${run.runId}`,
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

async function persistRemoteRun(run) {
  const db = remoteRunDatabase(run);
  if (!db) return;
  await db.query(
    `
      INSERT INTO xeno_remote_runs (
        run_id, user_id, status, prompt, requested_cwd, model, permission_mode,
        created_at, started_at, ended_at, exit_code, signal
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (run_id) DO UPDATE SET
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
  const liveRun = remoteRuns.get(req.params.runId);
  if (liveRun) {
    if (liveRun.userId === (req.user?.id || 'anonymous')) return liveRun;
    res.status(404).json({ error: 'Remote run not found' });
    return null;
  }

  const db = remoteRunDatabase(req);
  if (db) {
    const { rows } = await db.query(
      `
        SELECT run_id, user_id, status, prompt, requested_cwd, model, permission_mode,
               created_at, started_at, ended_at, exit_code, signal
        FROM xeno_remote_runs
        WHERE run_id = $1 AND user_id = $2
      `,
      [req.params.runId, req.user?.id || 'anonymous']
    );
    if (rows[0]) {
      return remoteRunFromRow(rows[0], await loadRemoteEvents(db, req.params.runId), db);
    }
  }

  res.status(404).json({ error: 'Remote run not found' });
  return null;
}

async function listRemoteRuns(req, limit) {
  const userId = req.user?.id || 'anonymous';
  const db = remoteRunDatabase(req);
  if (db) {
    const { rows } = await db.query(
      `
        SELECT run_id, user_id, status, prompt, requested_cwd, model, permission_mode,
               created_at, started_at, ended_at, exit_code, signal
        FROM xeno_remote_runs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );
    return rows.map((row) => remoteRunFromRow(row, [], db));
  }

  return [...remoteRuns.values()]
    .filter((run) => run.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

function isRemoteTerminalStatus(status) {
  return REMOTE_TERMINAL_STATUSES.has(status);
}

function activeRemoteRunCount() {
  return [...remoteRuns.values()].filter((run) => !isRemoteTerminalStatus(run.status)).length;
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
  };
  return args.map((arg) => replacements[arg] ?? arg);
}

function startRemoteRunner(run, request) {
  const command = remoteRunnerCommand();
  if (!command) throw new Error('Hosted remote runner is not configured');
  const timeoutMs = remoteTimeoutMs();

  const child = spawn(command, remoteRunnerArgs(run, request), {
    cwd: remoteRunnerCwd() || process.cwd(),
    env: {
      ...process.env,
      XENO_REMOTE_RUN_ID: run.runId,
      XENO_REMOTE_USER_ID: run.userId,
      XENO_REMOTE_PROMPT: request.prompt,
      XENO_REMOTE_REQUESTED_CWD: request.cwd || '',
      XENO_REMOTE_MODEL: request.model || '',
    },
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

// ---------- GET /api/xeno/remote/status ----------
router.get('/remote/status', (_req, res) => {
  const capabilities = remoteRunnerCapabilities();
  const configError = remoteRunnerConfigError();
  res.json({
    schemaVersion: 1,
    ok: !configError,
    service: 'xeno-platform-remote',
    version: process.env.npm_package_version || '1.0.0',
    capabilities,
    ...(configError ? { error: configError } : {}),
    message: capabilities.includes('runs.start')
      ? 'Hosted remote runner is configured.'
      : configError || 'Hosted remote runs are not deployed on this backend yet.',
  });
});

// ---------- POST /api/xeno/remote/runs ----------
router.get('/remote/runs', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const runs = await listRemoteRuns(req, limit);
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
    return res.status(429).json({
      error: 'Hosted remote runner concurrency limit reached',
      maxConcurrent,
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
  for (const field of [cwd, model, permissionMode]) {
    if (field.error) return res.status(400).json({ error: field.error });
  }
  const remoteRequest = {
    prompt,
    cwd: cwd.value,
    model: model.value,
    permissionMode: permissionMode.value,
  };

  const run = {
    runId: `remote_${randomUUID()}`,
    userId: req.user?.id || 'anonymous',
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
    const { model = 'auto', prompt, width, height, seed, n, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('image', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.image.generate({
        model,
        prompt: prompt.trim(),
        width: width || 1024,
        height: height || 1024,
        seed,
        n: n || 1,
        ...rest,
      });

      await logUsage(req.db, userId, `image:${model}`, cost, {
        route: '/api/xeno/images/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Image generate API error:', apiError);
      const status = getApiErrorStatus(apiError);
      return res.status(status).json({
        error: getApiErrorMessage(apiError, { model }),
        model,
        status,
        credits_refunded: true,
      });
    }
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
    const { image, prompt, model = 'auto', ...rest } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('edit', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.image.edit({
        image,
        prompt: prompt.trim(),
        model,
        ...rest,
      });

      await logUsage(req.db, userId, `edit:${model}`, cost, {
        route: '/api/xeno/images/edit',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Image edit API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
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
    const { model = 'auto', prompt, image, duration, aspect_ratio, resolution, fps, seed, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('video', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
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

      await logUsage(req.db, userId, `video:${model}`, cost, {
        route: '/api/xeno/videos/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Video generate API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
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
    const { model = 'auto', prompt, duration, seed, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('audio', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.music.generate({
        model,
        prompt: prompt.trim(),
        duration,
        seed,
        wait: true,
        ...rest,
      });

      await logUsage(req.db, userId, `audio:${model}`, cost, {
        route: '/api/xeno/audio/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Audio generate API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
  } catch (error) {
    console.error('[XenoRoutes] Audio generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
