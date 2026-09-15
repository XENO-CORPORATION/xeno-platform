/**
 * XENO Status — the external probe, the alerter, and status.xenosystem.ai, in one Worker.
 *
 * ## Why this exists
 *
 * On 2026-09-14 chat failed for every Claude Opus 5 turn, web search failed 100% of the time,
 * and a search-budgeted turn returned an empty answer — and nothing told anyone. Each was
 * found by a human typing into the product. Prometheus on xeno-platform-001 evaluated five
 * alert rules with no Alertmanager attached, so every alert fired into nothing.
 *
 * ## Why it runs on Cloudflare, not on our servers
 *
 * Every XENO VM runs on one Proxmox host whose disks sit on a share that freezes guests into
 * `io-error`. A monitor on that host freezes with it, and a frozen monitor reports nothing —
 * silence reads as health. So the probe, its database and the status page all live on
 * infrastructure that fails independently of what they watch.
 *
 * ## Who watches this Worker
 *
 * healthchecks.io. Every run ends with a ping: the plain URL when the whole pipeline worked,
 * `/fail` when any part did. If runs stop, the pings stop, and healthchecks.io alerts through
 * its own channel. A monitor cannot report its own failure, so this one never tries to.
 *
 * ## The honest limit of v1
 *
 * These checks detect a component that is DOWN. They do not detect one that is up and wrong:
 * every defect listed above returned HTTP 200. That needs a real chat turn and a real search,
 * which needs an API key the operator creates — tracked in status/README.md, and deliberately
 * NOT shown as a green component until it exists.
 */

export const COMPONENTS = Object.freeze([
  Object.freeze({ id: 'website', name: 'Website', url: 'https://xenostudio.ai/', expect: { status: 200, bodyIncludes: '<html' } }),
  Object.freeze({ id: 'platform-api', name: 'Platform API', url: 'https://xenostudio.ai/api/ready', expect: { status: 200 } }),
  Object.freeze({ id: 'inference-gateway', name: 'Inference Gateway', url: 'https://api.xenostudio.ai/health', expect: { status: 200 } }),
  Object.freeze({ id: 'downloads', name: 'Downloads & Updates', url: 'https://updates.xenostudio.ai/apps/hub/version.json', expect: { status: 200, json: true } }),
  Object.freeze({ id: 'post', name: 'XENO Post', url: 'https://post.xenosystem.ai/', expect: { status: 200 } }),
]);

/** Consecutive failures before an incident opens, and successes before it resolves. */
export const FAIL_THRESHOLD = 2;
export const RECOVER_THRESHOLD = 2;
export const PROBE_TIMEOUT_MS = 10_000;
export const CHECK_RETENTION_DAYS = 7;
export const UPTIME_WINDOW_DAYS = 90;
export const STATUS_PAGE_URL = 'https://status.xenosystem.ai';

/**
 * An honest, identifying user agent — the same principle as Web Context's crawler fix of
 * 2026-09-14: a probe that refuses to say what it is gets refused, and should be.
 */
export const USER_AGENT = 'XenoStatus/1.0 (+https://status.xenosystem.ai)';

const DAY_MS = 86_400_000;

export const utcDay = (ts) => new Date(ts).toISOString().slice(0, 10);

// ─── The state machine ──────────────────────────────────────────────────────────────────

/**
 * Fold one probe result into a component's state.
 *
 * 🔴 One failed probe never opens an incident and one success never closes it. Networks drop
 * single requests; an alert per dropped request trains everyone to ignore alerts, which is
 * worse than having none. `event` is set only on a real transition.
 */
export function nextState(prev, ok, ts, { failThreshold = FAIL_THRESHOLD, recoverThreshold = RECOVER_THRESHOLD } = {}) {
  const base = prev ?? { status: 'operational', since: ts, consecutiveFail: 0, consecutiveOk: 0 };
  if (ok) {
    const consecutiveOk = base.consecutiveOk + 1;
    if (base.status === 'down' && consecutiveOk >= recoverThreshold) {
      return { state: { status: 'operational', since: ts, consecutiveFail: 0, consecutiveOk }, event: 'resolved' };
    }
    return { state: { ...base, consecutiveFail: 0, consecutiveOk }, event: null };
  }
  const consecutiveFail = base.consecutiveFail + 1;
  if (base.status === 'operational' && consecutiveFail >= failThreshold) {
    return { state: { status: 'down', since: ts, consecutiveFail, consecutiveOk: 0 }, event: 'opened' };
  }
  return { state: { ...base, consecutiveFail, consecutiveOk: 0 }, event: null };
}

// ─── The probe ──────────────────────────────────────────────────────────────────────────

/**
 * Check one component.
 *
 * ⚠️ `redirect: 'manual'`: a component that starts redirecting to an error or login page is
 * not healthy just because the page it lands on answers 200.
 */
export async function probe(component, fetchImpl, now = Date.now) {
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const result = (ok, httpStatus, error) => ({
    component: component.id,
    ok,
    httpStatus,
    latencyMs: Math.max(0, now() - started),
    error: error ? String(error).slice(0, 200) : null,
  });
  try {
    const response = await fetchImpl(component.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' },
    });
    const body = await response.text();
    if (response.status !== component.expect.status) return result(false, response.status, `HTTP ${response.status}`);
    if (component.expect.json) {
      try { JSON.parse(body); } catch { return result(false, response.status, 'response was not valid JSON'); }
    }
    if (component.expect.bodyIncludes && !body.includes(component.expect.bodyIncludes)) {
      return result(false, response.status, 'response body was not the expected page');
    }
    return result(true, response.status, null);
  } catch (error) {
    const reason = error?.name === 'AbortError' ? `timed out after ${PROBE_TIMEOUT_MS} ms` : `network error: ${error?.message || 'unknown'}`;
    return result(false, null, reason);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Deep checks: a real chat turn and a real web search ────────────────────────────────

/**
 * The checks that catch a product that is UP AND WRONG.
 *
 * Every defect of 2026-09-14 answered HTTP 200: Opus 5 rejecting `temperature`, search
 * failing on a licensing refusal, a search-heavy turn ending with no answer. None of them is
 * visible to a status code. These drive the same route a user's browser drives, with the same
 * model, and judge the ANSWER.
 *
 * ⚠️ They cost credits, so they run on their own slower schedule (DEEP_CRON), and they only
 * exist when a probe key is configured. Without one they are not probed and not drawn —
 * a component nobody monitors must not appear on a status page as green.
 *
 * Each makes a second attempt inside the same run before counting as failed. That in-run
 * retry is the flap protection, so ONE failed run opens the incident: at a 15-minute cadence,
 * waiting for two runs would mean half an hour before anyone hears about a broken chat.
 */
export const DEEP_CRON = '*/30 * * * *';
export const DEEP_TIMEOUT_MS = 120_000;
export const DEEP_RETRY_DELAY_MS = 20_000;
export const PROBE_MODEL_DEFAULT = 'claude-opus-5';
export const CHAT_MARKER = 'XENO-STATUS-OK';
const CHAT_STREAM_URL = 'https://xenostudio.ai/api/ai/chat/stream';

/** Read a chat SSE body into frames. Same framing the product's own client reads. */
export function parseSseFrames(text) {
  const frames = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { frames.push(JSON.parse(payload)); } catch { /* an unreadable frame is skipped, as the client does */ }
  }
  return frames;
}

/** One chat turn through the real route. Returns the frames plus the HTTP status. */
async function runTurn(env, fetchImpl, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(CHAT_STREAM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.PROBE_API_KEY}`,
        accept: 'text/event-stream',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        model: env.PROBE_MODEL || PROBE_MODEL_DEFAULT,
        messages: [{ role: 'user', content: prompt }],
        chatSurface: 'chat',
      }),
    });
    const body = await response.text();
    return { status: response.status, frames: response.ok ? parseSseFrames(body) : [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Why an HTTP-level refusal happened, in words the person reading the alert can act on. */
function httpReason(status) {
  if (status === 401 || status === 403) return `probe key was rejected (HTTP ${status}) — the probe account may be revoked`;
  if (status === 402) return 'probe account is out of credits (HTTP 402) — top it up; this is not a product outage';
  return `chat route answered HTTP ${status}`;
}

/** The answer a turn produced: the terminal result's text, falling back to the streamed deltas. */
const answerOf = (frames) => {
  const result = frames.find((f) => f.type === 'result');
  const text = typeof result?.text === 'string' ? result.text : '';
  return text || frames.filter((f) => f.type === 'delta').map((f) => f.text || '').join('');
};

/** Judge a plain chat turn: it must complete and actually say what it was asked to say. */
export function judgeChat({ status, frames }) {
  if (status !== 200) return { ok: false, error: httpReason(status) };
  const failure = frames.find((f) => f.type === 'error');
  if (failure) return { ok: false, error: `turn failed: ${failure.message || failure.error || 'unknown error'}` };
  if (!frames.some((f) => f.type === 'result')) return { ok: false, error: 'turn ended without a result' };
  const answer = answerOf(frames);
  if (!answer.trim()) return { ok: false, error: 'turn completed with an EMPTY answer' };
  if (!answer.includes(CHAT_MARKER)) return { ok: false, error: 'answer did not contain the expected text' };
  return { ok: true, error: null };
}

/** Judge a search turn: a search must return sources, and the answer must use them. */
export function judgeSearch({ status, frames }) {
  if (status !== 200) return { ok: false, error: httpReason(status) };
  const failure = frames.find((f) => f.type === 'error');
  if (failure) return { ok: false, error: `turn failed: ${failure.message || failure.error || 'unknown error'}` };
  const results = frames.filter((f) => f.type === 'search_result');
  const errors = frames.filter((f) => f.type === 'search_error');
  if (!frames.some((f) => f.type === 'search_start')) return { ok: false, error: 'the model never searched' };
  if (!results.some((r) => Number(r.count) > 0)) {
    const codes = [...new Set(errors.map((e) => e.code).filter(Boolean))];
    return { ok: false, error: `no search returned sources${codes.length ? ` (${codes.join(', ')})` : ''}` };
  }
  const answer = answerOf(frames);
  if (!answer.trim()) return { ok: false, error: 'search turn completed with an EMPTY answer' };
  if (!/\b20\d\d\b/.test(answer)) return { ok: false, error: 'search answer did not contain a year' };
  return { ok: true, error: null };
}

/**
 * Run a deep check with ONE in-run retry. `sleep` is injectable so tests do not wait.
 * A thrown error (timeout, network) counts as a failed attempt, not a crashed run.
 */
export async function runDeepCheck(component, env, fetchImpl, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const started = now();
  let verdict = { ok: false, error: 'not attempted' };
  let httpStatus = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const turn = await runTurn(env, fetchImpl, component.prompt);
      httpStatus = turn.status;
      verdict = component.judge(turn);
    } catch (error) {
      verdict = { ok: false, error: error?.name === 'AbortError' ? `timed out after ${DEEP_TIMEOUT_MS} ms` : `network error: ${error?.message || 'unknown'}` };
    }
    // An account problem will not fix itself in 20 seconds; do not spend a second turn on it.
    if (verdict.ok || httpStatus === 401 || httpStatus === 402 || httpStatus === 403) break;
    if (attempt === 1) await sleep(DEEP_RETRY_DELAY_MS);
  }
  return {
    component: component.id,
    ok: verdict.ok,
    httpStatus,
    latencyMs: Math.max(0, now() - started),
    error: verdict.error ? String(verdict.error).slice(0, 200) : null,
  };
}

export const DEEP_COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'chat', name: 'Chat',
    prompt: `Reply with exactly this text and nothing else: ${CHAT_MARKER}`,
    judge: judgeChat, failThreshold: 1, recoverThreshold: 1,
  }),
  Object.freeze({
    id: 'web-search', name: 'Web Search',
    prompt: 'Use web search to find the current year, then reply with only the four-digit year.',
    judge: judgeSearch, failThreshold: 1, recoverThreshold: 1,
  }),
]);

/** Every component the page may draw, and every id an alert may name. */
export const ALL_COMPONENTS = Object.freeze([...COMPONENTS, ...DEEP_COMPONENTS]);

// ─── Storage ────────────────────────────────────────────────────────────────────────────

export async function loadStates(db) {
  const { results } = await db.prepare(
    'SELECT component, status, since, consecutive_fail, consecutive_ok FROM component_state',
  ).all();
  return new Map((results || []).map((row) => [row.component, {
    status: row.status, since: row.since, consecutiveFail: row.consecutive_fail, consecutiveOk: row.consecutive_ok,
  }]));
}

// ─── Alerting ───────────────────────────────────────────────────────────────────────────

/**
 * Send one alert.
 *
 * 🔴 It THROWS when it cannot deliver — including when alerting is not configured. An
 * incident nobody can be told about is a failure of the pipeline, and the run must end in a
 * `/fail` ping so healthchecks.io raises it through its own channel instead.
 */
export async function sendAlert(event, env, fetchImpl, now = Date.now) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO || !env.ALERT_EMAIL_FROM) {
    throw new Error('alert delivery is not configured');
  }
  const component = ALL_COMPONENTS.find((c) => c.id === event.component);
  const name = component?.name ?? event.component;
  const down = event.type === 'opened';
  const subject = down ? `[XENO Status] ${name} is DOWN` : `[XENO Status] ${name} has RECOVERED`;
  const text = [
    down ? `${name} has failed ${FAIL_THRESHOLD} consecutive checks.` : `${name} has passed ${RECOVER_THRESHOLD} consecutive checks again.`,
    '',
    `Component: ${name} (${event.component})`,
    `Checked:   ${component?.url ?? 'a real chat turn through the product'}`,
    down ? `Reason:    ${event.error ?? 'unknown'}` : `Down for:  ${formatDuration(event.durationMs ?? 0)}`,
    `At:        ${new Date(now()).toISOString()}`,
    '',
    `Status page: ${STATUS_PAGE_URL}`,
  ].join('\n');

  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.ALERT_EMAIL_FROM, to: [env.ALERT_EMAIL_TO], subject, text }),
  });
  if (!response.ok) throw new Error(`alert email was refused: HTTP ${response.status}`);
}

/**
 * Send every alert that has not been delivered yet, oldest first.
 *
 * 🔴 A flag is set only AFTER `sendAlert` succeeds. If delivery throws, the loop stops, the
 * flag stays 0, the run ends in a `/fail` ping, and the next run tries again. Delivery is
 * at-least-once: a crash between sending and marking can repeat one email, which is the
 * right side to err on for an outage alert.
 */
export async function deliverPendingAlerts(db, env, fetchImpl, now = Date.now) {
  const { results } = await db.prepare(
    'SELECT id, component, started_at, resolved_at, summary, opened_alert_sent, resolved_alert_sent FROM incidents '
    + 'WHERE opened_alert_sent = 0 OR (resolved_at IS NOT NULL AND resolved_alert_sent = 0) '
    + 'ORDER BY started_at ASC LIMIT 20',
  ).all();
  const delivered = [];
  for (const row of results || []) {
    if (!row.opened_alert_sent) {
      await sendAlert({ type: 'opened', component: row.component, error: row.summary }, env, fetchImpl, now);
      await db.prepare('UPDATE incidents SET opened_alert_sent = 1 WHERE id = ?').bind(row.id).run();
      delivered.push({ id: row.id, type: 'opened' });
    }
    if (row.resolved_at !== null && row.resolved_at !== undefined && !row.resolved_alert_sent) {
      await sendAlert(
        { type: 'resolved', component: row.component, durationMs: row.resolved_at - row.started_at },
        env, fetchImpl, now,
      );
      await db.prepare('UPDATE incidents SET resolved_alert_sent = 1 WHERE id = ?').bind(row.id).run();
      delivered.push({ id: row.id, type: 'resolved' });
    }
  }
  return delivered;
}

/**
 * End every run with a heartbeat. Never throws: if the watchdog is unreachable there is
 * nothing further this Worker can do, and healthchecks.io will notice the silence itself.
 */
export async function pingWatchdog(env, fetchImpl, failed, log = console) {
  if (!env.HEALTHCHECKS_PING_URL) return;
  const url = failed ? `${env.HEALTHCHECKS_PING_URL}/fail` : env.HEALTHCHECKS_PING_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetchImpl(url, { method: 'POST', signal: controller.signal, headers: { 'user-agent': USER_AGENT } });
  } catch (error) {
    log.error('[status] watchdog ping failed', { failed, message: error?.message });
  } finally {
    clearTimeout(timer);
  }
}

// ─── One scheduled run ──────────────────────────────────────────────────────────────────

/**
 * `mode` selects the component set. 'basic' is the cheap availability sweep every 2 minutes,
 * and it owns the heartbeat. 'deep' is the credit-spending chat + search pass on DEEP_CRON; with
 * no probe key configured it does nothing at all, rather than recording failures for checks
 * nobody has switched on.
 */
export async function runScheduled({ db, env, fetchImpl, now = Date.now, log = console, mode = 'basic', sleep }) {
  if (mode === 'deep' && !env.PROBE_API_KEY) return { events: [], skipped: 'no probe key configured' };
  const ts = now();
  let failure = null;
  const events = [];
  const components = mode === 'deep' ? DEEP_COMPONENTS : COMPONENTS;
  try {
    const states = await loadStates(db);
    const results = await Promise.all(components.map((component) => (
      mode === 'deep'
        ? runDeepCheck(component, env, fetchImpl, { now, ...(sleep ? { sleep } : {}) })
        : probe(component, fetchImpl, now)
    )));
    const day = utcDay(ts);
    const statements = [];

    for (const r of results) {
      const prev = states.get(r.component);
      const definition = components.find((c) => c.id === r.component);
      const { state, event } = nextState(prev, r.ok, ts, {
        failThreshold: definition?.failThreshold, recoverThreshold: definition?.recoverThreshold,
      });

      statements.push(db.prepare(
        'INSERT INTO checks (component, ts, ok, http_status, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(r.component, ts, r.ok ? 1 : 0, r.httpStatus, r.latencyMs, r.error));

      statements.push(db.prepare(
        'INSERT INTO daily (component, day, total, ok) VALUES (?, ?, 1, ?) '
        + 'ON CONFLICT (component, day) DO UPDATE SET total = total + 1, ok = ok + excluded.ok',
      ).bind(r.component, day, r.ok ? 1 : 0));

      statements.push(db.prepare(
        'INSERT INTO component_state (component, status, since, consecutive_fail, consecutive_ok, last_checked, last_latency_ms, last_error) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (component) DO UPDATE SET '
        + 'status = excluded.status, since = excluded.since, consecutive_fail = excluded.consecutive_fail, '
        + 'consecutive_ok = excluded.consecutive_ok, last_checked = excluded.last_checked, '
        + 'last_latency_ms = excluded.last_latency_ms, last_error = excluded.last_error',
      ).bind(r.component, state.status, state.since, state.consecutiveFail, state.consecutiveOk, ts, r.latencyMs, r.error));

      if (event === 'opened') {
        statements.push(db.prepare(
          'INSERT INTO incidents (component, started_at, summary) VALUES (?, ?, ?)',
        ).bind(r.component, ts, r.error ?? 'failed its checks'));
        events.push({ type: 'opened', component: r.component, error: r.error });
      } else if (event === 'resolved') {
        statements.push(db.prepare(
          'UPDATE incidents SET resolved_at = ? WHERE component = ? AND resolved_at IS NULL',
        ).bind(ts, r.component));
        events.push({ type: 'resolved', component: r.component, durationMs: ts - (prev?.since ?? ts) });
      }
    }

    statements.push(db.prepare('DELETE FROM checks WHERE ts < ?').bind(ts - CHECK_RETENTION_DAYS * DAY_MS));

    // One batch, one transaction: a check, its rollup, the state and the incident are
    // written together or not at all, so the state can never say "down" with no incident.
    await db.batch(statements);

    // Alerts go out from the OUTBOX, not from this run's transitions — so one that failed on
    // an earlier run is retried now, rather than lost because the state already says "down".
    await deliverPendingAlerts(db, env, fetchImpl, now);
  } catch (error) {
    failure = error;
    log.error('[status] run failed', { message: error?.message });
  }
  await pingWatchdog(env, fetchImpl, Boolean(failure), log);
  if (failure) throw failure;
  return { events };
}

// ─── The page ───────────────────────────────────────────────────────────────────────────

/**
 * Per-day uptime for one component, oldest first.
 *
 * 🔴 A day with no probes is `null`, never 100%. Before this Worker existed nobody measured
 * anything, and drawing those days green would be a claim the data cannot support.
 */
export function dayBuckets(rows, today, days = UPTIME_WINDOW_DAYS) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(Date.parse(`${today}T00:00:00Z`) - i * DAY_MS);
    const row = byDay.get(day);
    out.push({ day, ratio: row && row.total > 0 ? row.ok / row.total : null });
  }
  return out;
}

export function uptimePercent(rows) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total === 0) return null;
  return (rows.reduce((sum, row) => sum + row.ok, 0) / total) * 100;
}

export async function loadModel(db, now = Date.now) {
  const ts = now();
  const today = utcDay(ts);
  const windowStart = utcDay(ts - (UPTIME_WINDOW_DAYS - 1) * DAY_MS);
  const [states, daily, incidents] = await Promise.all([
    db.prepare('SELECT component, status, since, last_checked, last_latency_ms FROM component_state').all(),
    db.prepare('SELECT component, day, total, ok FROM daily WHERE day >= ?').bind(windowStart).all(),
    db.prepare('SELECT component, started_at, resolved_at, summary FROM incidents WHERE started_at >= ? ORDER BY started_at DESC LIMIT 30')
      .bind(ts - UPTIME_WINDOW_DAYS * DAY_MS).all(),
  ]);
  const stateBy = new Map((states.results || []).map((row) => [row.component, row]));
  // Deep components are drawn only once they have been measured: a check that was never
  // switched on is absent from the page, never shown as operational.
  const components = ALL_COMPONENTS.filter((c) => COMPONENTS.includes(c) || stateBy.has(c.id)).map((component) => {
    const rows = (daily.results || []).filter((row) => row.component === component.id);
    const state = stateBy.get(component.id);
    return {
      id: component.id,
      name: component.name,
      status: state ? state.status : 'unknown',
      since: state?.since ?? null,
      lastChecked: state?.last_checked ?? null,
      latencyMs: state?.last_latency_ms ?? null,
      uptime: uptimePercent(rows),
      days: dayBuckets(rows, today),
    };
  });
  const measured = components.filter((c) => c.status !== 'unknown');
  const down = measured.filter((c) => c.status === 'down').length;
  const overall = measured.length === 0 ? 'unknown'
    : down === 0 ? 'operational'
      : down === measured.length ? 'major_outage' : 'partial_outage';
  return {
    generatedAt: new Date(ts).toISOString(),
    overall,
    components,
    incidents: (incidents.results || []).map((row) => ({
      component: row.component,
      name: ALL_COMPONENTS.find((c) => c.id === row.component)?.name ?? row.component,
      startedAt: row.started_at,
      resolvedAt: row.resolved_at,
      summary: row.summary,
    })),
  };
}

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

const OVERALL_TEXT = {
  operational: 'All systems operational',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Collecting data',
};

export function renderPage(model) {
  const bar = (d) => {
    const cls = d.ratio === null ? 'none' : d.ratio >= 0.999 ? 'up' : d.ratio >= 0.95 ? 'degraded' : 'down';
    const label = d.ratio === null ? `${d.day}: no data` : `${d.day}: ${(d.ratio * 100).toFixed(2)}% uptime`;
    return `<span class="bar ${cls}" title="${escapeHtml(label)}"></span>`;
  };
  const componentRows = model.components.map((c) => `
      <section class="component">
        <div class="component-head">
          <span class="name">${escapeHtml(c.name)}</span>
          <span class="state ${escapeHtml(c.status)}">${escapeHtml(c.status === 'unknown' ? 'No data yet' : c.status === 'down' ? 'Down' : 'Operational')}</span>
        </div>
        <div class="bars">${c.days.map(bar).join('')}</div>
        <div class="component-foot">
          <span><span class="wide">${UPTIME_WINDOW_DAYS} days ago</span><span class="narrow">30 days ago</span></span>
          <span>${c.uptime === null ? 'No data yet' : `${c.uptime.toFixed(2)}% uptime`}</span>
          <span>Today</span>
        </div>
      </section>`).join('');

  const incidentRows = model.incidents.length === 0
    ? '<p class="empty">No incidents in the last 90 days.</p>'
    : model.incidents.map((i) => `
      <article class="incident">
        <h3>${escapeHtml(i.name)} ${i.resolvedAt ? 'was unavailable' : 'is unavailable'}</h3>
        <p class="summary">${escapeHtml(i.summary)}</p>
        <p class="when">${escapeHtml(new Date(i.startedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC
          ${i.resolvedAt ? `— resolved after ${escapeHtml(formatDuration(i.resolvedAt - i.startedAt))}` : '— <strong>ongoing</strong>'}</p>
      </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>XENO Status</title>
<style>
  :root { --page:#060606; --card:#101010; --line:rgba(255,255,255,.06); --title:#ece7df; --body:#948d83; --dim:#69635b;
          --up:#ece7df; --degraded:#948d83; --down:#e5484d; --none:#1c1c1c; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--body); font:15px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:880px; margin:0 auto; padding:48px 16px 64px; }
  header h1 { color:var(--title); font-size:clamp(22px,4vw,30px); font-weight:600; letter-spacing:-.01em; margin:0 0 28px; }
  .overall { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; color:var(--title); font-weight:600; margin-bottom:32px; }
  .overall.partial_outage, .overall.major_outage { border-color:rgba(229,72,77,.45); }
  .component { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin-bottom:10px; }
  .component-head { display:flex; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .name { color:var(--title); font-weight:500; }
  .state.operational { color:var(--up); } .state.down { color:var(--down); font-weight:600; } .state.unknown { color:var(--dim); }
  .bars { display:flex; gap:2px; height:30px; }
  .bar { flex:1; border-radius:2px; min-width:2px; }
  .bar.up { background:var(--up); opacity:.85; } .bar.degraded { background:var(--degraded); }
  .bar.down { background:var(--down); } .bar.none { background:var(--none); }
  .component-foot { display:flex; justify-content:space-between; color:var(--dim); font-size:12px; margin-top:8px; }
  h2 { color:var(--title); font-size:17px; font-weight:600; margin:40px 0 14px; }
  .incident { border-left:2px solid var(--line); padding:2px 0 2px 14px; margin-bottom:18px; }
  .incident h3 { color:var(--title); font-size:15px; font-weight:500; margin:0 0 4px; }
  .incident p { margin:0 0 2px; } .when, .empty, footer { color:var(--dim); font-size:13px; }
  footer { margin-top:48px; }
  .narrow { display:none; }
  /* Narrow screens show the last 30 days, and the axis label says so rather than claiming 90. */
  @media (max-width:560px) { .bars .bar:nth-child(-n+60) { display:none; } .wide { display:none; } .narrow { display:inline; } }
</style>
</head>
<body>
<main>
  <header><h1>XENO Status</h1></header>
  <div class="overall ${escapeHtml(model.overall)}">${escapeHtml(OVERALL_TEXT[model.overall] ?? OVERALL_TEXT.unknown)}</div>
  ${componentRows}
  <h2>Past incidents</h2>
  ${incidentRows}
  <footer>Availability is checked every 2 minutes, and chat and web search by a real conversation every 30, from outside XENO's own infrastructure. Updated ${escapeHtml(model.generatedAt.replace('T', ' ').slice(0, 19))} UTC.</footer>
</main>
</body>
</html>`;
}

const PAGE_HEADERS = {
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'cache-control': 'public, max-age=30',
};

export async function handleFetch(request, env, now = Date.now) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const { pathname } = new URL(request.url);
  if (pathname !== '/' && pathname !== '/api/status.json') {
    return new Response('Not found', { status: 404, headers: PAGE_HEADERS });
  }
  let model;
  try {
    model = await loadModel(env.DB, now);
  } catch {
    // Never claim "operational" when the data could not be read.
    return new Response('Status is temporarily unavailable.', {
      status: 503, headers: { ...PAGE_HEADERS, 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (pathname === '/api/status.json') {
    return new Response(JSON.stringify(model), { headers: { ...PAGE_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
  }
  return new Response(renderPage(model), { headers: { ...PAGE_HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  fetch: (request, env) => handleFetch(request, env),
  scheduled: (controller, env, ctx) => {
    const mode = controller.cron === DEEP_CRON ? 'deep' : 'basic';
    ctx.waitUntil(runScheduled({ db: env.DB, env, fetchImpl: fetch, mode }));
  },
};
