/**
 * XENO Status — the external probe, alerter and status page (status/worker.mjs).
 *
 * The SQL runs for real: D1 is SQLite, so the tests drive the Worker against `node:sqlite`
 * with the exact schema that deploys. Upserts, the batch transaction, retention and the alert
 * outbox are therefore exercised as they will run, not as a mock believes they run.
 *
 * What these tests hold, in order of how badly it goes wrong if they stop holding:
 *
 *   1. An outage alert is never LOST. Delivery failures retry from an outbox, and the run
 *      ends in a `/fail` heartbeat so the independent watchdog raises it meanwhile.
 *   2. A monitor that cannot read its data never says "operational".
 *   3. One dropped request never pages anyone (flap protection).
 *   4. Days that were never measured are never drawn as 100%.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  COMPONENTS, FAIL_THRESHOLD, RECOVER_THRESHOLD, USER_AGENT,
  dayBuckets, escapeHtml, handleFetch, loadModel, nextState, probe, renderPage, runScheduled, uptimePercent,
} from '../status/worker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readFileSync(join(ROOT, 'status', 'schema.sql'), 'utf8');

/** A D1-shaped adapter over a real SQLite database. */
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  const statement = (sql, params = []) => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
    execSync: () => sqlite.prepare(sql).run(...params),
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) s.execSync();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const ENV = {
  RESEND_API_KEY: 're_test',
  ALERT_EMAIL_TO: 'ops@example.com',
  ALERT_EMAIL_FROM: 'XENO Status <noreply@example.com>',
  HEALTHCHECKS_PING_URL: 'https://hc-ping.com/00000000-0000-4000-8000-000000000000',
};
const quiet = { error() {} };

/**
 * A network where each component can be made to fail, plus recorders for the email and
 * heartbeat endpoints. `emailStatus` lets delivery be broken and then repaired.
 */
function network({ failing = new Set(), emailStatus = 200 } = {}) {
  const emails = [];
  const pings = [];
  const state = { failing, emailStatus };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(init.body));
      return new Response('{}', { status: state.emailStatus });
    }
    if (u.startsWith(ENV.HEALTHCHECKS_PING_URL)) {
      pings.push(u.endsWith('/fail') ? 'fail' : 'ok');
      return new Response('OK');
    }
    const component = COMPONENTS.find((c) => c.url === u);
    if (!component) throw new Error(`unexpected fetch ${u}`);
    if (state.failing.has(component.id)) return new Response('bad gateway', { status: 502 });
    return new Response(component.expect.json ? '{"version":"1.0.0"}' : '<html><body>ok</body></html>', { status: 200 });
  };
  return { fetchImpl, emails, pings, state };
}

const clock = (start = Date.parse('2026-09-15T10:00:00Z')) => {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

// ─── State machine ─────────────────────────────────────────────────────────────────────

test('🔴 one failed probe never opens an incident; FAIL_THRESHOLD consecutive failures do', () => {
  let s = nextState(undefined, false, 1);
  assert.equal(s.event, null, 'a single dropped request must not page anyone');
  assert.equal(s.state.status, 'operational');
  for (let i = 2; i <= FAIL_THRESHOLD; i += 1) s = nextState(s.state, false, i);
  assert.equal(s.event, 'opened');
  assert.equal(s.state.status, 'down');
});

test('a success between failures resets the count — flapping is not an outage', () => {
  let s = nextState(undefined, false, 1);
  s = nextState(s.state, true, 2);
  s = nextState(s.state, false, 3);
  assert.equal(s.event, null);
  assert.equal(s.state.status, 'operational');
});

test('recovery also needs consecutive successes, and reports the transition once', () => {
  let s = { state: { status: 'down', since: 1, consecutiveFail: 5, consecutiveOk: 0 } };
  s = nextState(s.state, true, 2);
  if (RECOVER_THRESHOLD > 1) assert.equal(s.state.status, 'down', 'one success must not close an incident');
  for (let i = 3; s.state.status === 'down'; i += 1) s = nextState(s.state, true, i);
  assert.equal(s.event, 'resolved');
  assert.equal(nextState(s.state, true, 99).event, null, 'and never again for further successes');
});

// ─── Probe ─────────────────────────────────────────────────────────────────────────────

test('the probe identifies itself honestly and does not follow redirects', async () => {
  let seen;
  await probe(COMPONENTS[0], async (url, init) => { seen = init; return new Response('<html>', { status: 200 }); });
  assert.equal(seen.headers['user-agent'], USER_AGENT);
  assert.doesNotMatch(USER_AGENT, /Mozilla|Chrome|Safari/, 'never impersonate a browser');
  assert.equal(seen.redirect, 'manual', 'a redirect to an error page is not health');
});

test('a wrong status, invalid JSON, the wrong page, and a timeout are each failures with a reason', async () => {
  const json = COMPONENTS.find((c) => c.expect.json);
  const page = COMPONENTS.find((c) => c.expect.bodyIncludes);
  const cases = [
    [COMPONENTS[1], async () => new Response('x', { status: 503 }), /HTTP 503/],
    [json, async () => new Response('<html>not json</html>', { status: 200 }), /not valid JSON/],
    [page, async () => new Response('Service Unavailable', { status: 200 }), /not the expected page/],
    [COMPONENTS[1], async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, /timed out/],
    [COMPONENTS[1], async () => { throw new TypeError('fetch failed'); }, /network error/],
  ];
  for (const [component, fetchImpl, reason] of cases) {
    const r = await probe(component, fetchImpl);
    assert.equal(r.ok, false, `${reason} must be a failure`);
    assert.match(r.error, reason);
  }
});

// ─── A scheduled run, against real SQL ─────────────────────────────────────────────────

test('🔴 an outage opens ONE incident, sends ONE alert, and the run still heartbeats OK', async () => {
  const db = d1();
  const net = network({ failing: new Set(['platform-api']) });
  const c = clock();
  for (let i = 0; i < FAIL_THRESHOLD + 2; i += 1) {
    await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet });
    c.advance(120_000);
  }
  const incidents = db.sqlite.prepare('SELECT * FROM incidents').all();
  assert.equal(incidents.length, 1, 'continued failure must not open a new incident every run');
  assert.equal(incidents[0].component, 'platform-api');
  assert.match(incidents[0].summary, /HTTP 502/);
  assert.equal(net.emails.length, 1, 'and must not re-send the alert every run');
  assert.match(net.emails[0].subject, /Platform API is DOWN/);
  assert.deepEqual([...new Set(net.pings)], ['ok'], 'a working pipeline reports ok even while a component is down');

  const state = db.sqlite.prepare("SELECT status FROM component_state WHERE component = 'platform-api'").get();
  assert.equal(state.status, 'down');
});

test('recovery resolves the incident and sends the recovery alert with the duration', async () => {
  const db = d1();
  const net = network({ failing: new Set(['website']) });
  const c = clock();
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) { await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }); c.advance(120_000); }
  net.state.failing = new Set();
  for (let i = 0; i < RECOVER_THRESHOLD; i += 1) { await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }); c.advance(120_000); }

  const incident = db.sqlite.prepare('SELECT * FROM incidents').get();
  assert.ok(incident.resolved_at, 'the incident must be resolved');
  assert.equal(net.emails.length, 2);
  assert.match(net.emails[1].subject, /Website has RECOVERED/);
  assert.match(net.emails[1].text, /Down for:/);
});

test('🔴 a FAILED alert is never lost — it retries from the outbox, and the run reports /fail meanwhile', async () => {
  const db = d1();
  const net = network({ failing: new Set(['post']), emailStatus: 500 });
  const c = clock();
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) {
    await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }).catch(() => {});
    c.advance(120_000);
  }
  assert.equal(net.pings.at(-1), 'fail', 'an incident nobody could be told about is a pipeline failure');
  assert.equal(db.sqlite.prepare('SELECT opened_alert_sent FROM incidents').get().opened_alert_sent, 0,
    'the flag must not be set when delivery failed');

  // The component stays down (no new transition), email delivery is repaired.
  net.state.emailStatus = 200;
  await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet });

  const delivered = net.emails.filter((e) => /XENO Post is DOWN/.test(e.subject));
  assert.ok(delivered.length >= 2, 'the alert must be retried on a later run, not dropped');
  assert.equal(db.sqlite.prepare('SELECT opened_alert_sent FROM incidents').get().opened_alert_sent, 1);
  assert.equal(net.pings.at(-1), 'ok', 'and the heartbeat recovers once delivery works');
});

test('🔴 unconfigured alerting is a failure, not a silent skip', async () => {
  const db = d1();
  const net = network({ failing: new Set(['downloads']) });
  const c = clock();
  const env = { HEALTHCHECKS_PING_URL: ENV.HEALTHCHECKS_PING_URL };
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) {
    await runScheduled({ db, env, fetchImpl: net.fetchImpl, now: c.now, log: quiet }).catch(() => {});
    c.advance(120_000);
  }
  assert.equal(net.pings.at(-1), 'fail');
});

test('🔴 a database failure heartbeats /fail and rejects — never ok', async () => {
  const net = network();
  const broken = { prepare: () => ({ bind() { return this; }, all: async () => { throw new Error('D1 unavailable'); } }) };
  await assert.rejects(runScheduled({ db: broken, env: ENV, fetchImpl: net.fetchImpl, log: quiet }), /D1 unavailable/);
  assert.deepEqual(net.pings, ['fail']);
});

test('the daily rollup counts every probe, and old raw checks are pruned', async () => {
  const db = d1();
  const net = network({ failing: new Set(['website']) });
  const c = clock();
  await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet });
  c.advance(120_000);
  await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }).catch(() => {});

  const website = db.sqlite.prepare("SELECT total, ok FROM daily WHERE component = 'website'").get();
  assert.deepEqual({ total: website.total, ok: website.ok }, { total: 2, ok: 0 });
  const api = db.sqlite.prepare("SELECT total, ok FROM daily WHERE component = 'platform-api'").get();
  assert.deepEqual({ total: api.total, ok: api.ok }, { total: 2, ok: 2 });

  c.advance(8 * 86_400_000);
  await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }).catch(() => {});
  const oldest = db.sqlite.prepare('SELECT MIN(ts) AS ts FROM checks').get().ts;
  assert.ok(oldest >= c.now() - 7 * 86_400_000, 'raw checks older than the retention window must be deleted');
});

// ─── The page ──────────────────────────────────────────────────────────────────────────

test('🔴 a day that was never measured is "no data", never 100%', () => {
  const days = dayBuckets([{ day: '2026-09-15', total: 10, ok: 10 }], '2026-09-15', 3);
  assert.deepEqual(days.map((d) => d.ratio), [null, null, 1]);
  assert.equal(uptimePercent([]), null, 'no measurements is unknown, not perfect uptime');
});

test('🔴 the status page says "Collecting data" before anything is measured — not "operational"', async () => {
  const model = await loadModel(d1());
  assert.equal(model.overall, 'unknown');
  assert.match(renderPage(model), /Collecting data/);
  assert.doesNotMatch(renderPage(model), /All systems operational/);
});

test('one component down reads as a partial outage, with the incident listed', async () => {
  const db = d1();
  const net = network({ failing: new Set(['inference-gateway']) });
  const c = clock();
  for (let i = 0; i < FAIL_THRESHOLD; i += 1) { await runScheduled({ db, env: ENV, fetchImpl: net.fetchImpl, now: c.now, log: quiet }); c.advance(120_000); }
  const model = await loadModel(db, c.now);
  assert.equal(model.overall, 'partial_outage');
  assert.equal(model.incidents.length, 1);
  assert.match(renderPage(model), /Inference Gateway is unavailable/);
});

test('incident text is escaped — probe error strings are not trusted markup', () => {
  const html = renderPage({
    generatedAt: new Date().toISOString(), overall: 'partial_outage', components: [],
    incidents: [{ component: 'x', name: 'X', startedAt: Date.now(), resolvedAt: null, summary: '<script>alert(1)</script>' }],
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
});

test('🔴 if the data cannot be read the page answers 503 — it never shows a green page', async () => {
  const env = { DB: { prepare: () => ({ bind() { return this; }, all: async () => { throw new Error('down'); } }) } };
  const res = await handleFetch(new Request('https://status.xenosystem.ai/'), env);
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /operational/i);
});

test('the page and JSON are served noindex, other paths 404, writes 405', async () => {
  const env = { DB: d1() };
  const page = await handleFetch(new Request('https://status.xenosystem.ai/'), env);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('x-robots-tag'), /noindex/, 'the XENO web estate is deliberately de-indexed');
  const json = await handleFetch(new Request('https://status.xenosystem.ai/api/status.json'), env);
  assert.equal((await json.json()).components.length, COMPONENTS.length);
  assert.equal((await handleFetch(new Request('https://status.xenosystem.ai/admin'), env)).status, 404);
  assert.equal((await handleFetch(new Request('https://status.xenosystem.ai/', { method: 'POST' }), env)).status, 405);
});
