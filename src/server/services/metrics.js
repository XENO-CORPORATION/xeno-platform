/**
 * metrics.js — RED metrics in Prometheus exposition format, with no dependency.
 *
 * WHY NO prom-client
 *   Adding a dependency means regenerating package-lock.json, and this repo is
 *   developed on Windows where npm writes @esbuild platform entries that `npm ci`
 *   on Linux rejects (documented in the workspace CLAUDE.md as a recurring CI
 *   killer). The exposition format is a few lines of text; the risk of a bad
 *   lockfile is not worth importing it.
 *
 * WHAT IS MEASURED
 *   RED, from data requestLogger already computes for every request:
 *     Rate     xeno_http_requests_total{method,route,status}
 *     Errors   the same counter, filtered on status>=500
 *     Duration xeno_http_request_duration_seconds (histogram, so p95/p99 are
 *              derivable in Prometheus rather than precomputed and unaggregatable)
 *   Plus process/runtime gauges and the leader flag, which is the one piece of
 *   state that MUST differ across replicas — if two report leader=1, background
 *   work is running twice and that is invisible everywhere else.
 *
 * 🔴 ROUTE CARDINALITY IS THE TRAP. A label per distinct URL turns /c/<uuid>
 *   into unbounded series and kills Prometheus. Paths are normalised to their
 *   route shape (ids -> :id) BEFORE they are used as a label.
 */

const counters = new Map();   // name|labels -> number
const histograms = new Map(); // name|labels -> { buckets:Map, sum, count }

// Seconds. Tuned for a web API: sub-100ms matters, and anything past 10s is "slow".
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const BS = String.fromCharCode(92);  // built from a char code: a literal backslash in a heredoc gets eaten
const NL = String.fromCharCode(10);
const esc = (v) => String(v).split(BS).join(BS + BS).split('"').join(BS + '"').split(NL).join(BS + 'n');
const key = (name, labels) => `${name}|${Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
const fmtLabels = (labels) => {
  const parts = Object.entries(labels).sort().map(([k, v]) => `${k}="${esc(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

/**
 * Collapse a concrete path to its ROUTE SHAPE so label cardinality stays bounded.
 * Prefer the Express route pattern when available (req.route.path is already
 * `/c/:id`); fall back to a conservative rewrite for anything that escaped it.
 */
export function routeShape(pathname) {
  if (!pathname) return 'unknown';
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/\d+/g, '/:n')
    .replace(/\/[0-9a-f]{24,}/gi, '/:hash')
    .slice(0, 120) || '/';
}

export function incCounter(name, labels = {}, by = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + by);
}

export function observe(name, labels = {}, seconds = 0) {
  const k = key(name, labels);
  let h = histograms.get(k);
  if (!h) { h = { buckets: new Map(BUCKETS.map((b) => [b, 0])), sum: 0, count: 0 }; histograms.set(k, h); }
  h.count += 1;
  h.sum += seconds;
  for (const b of BUCKETS) if (seconds <= b) h.buckets.set(b, h.buckets.get(b) + 1);
}

/** Record one finished HTTP request. Called from requestLogger. */
export function recordRequest({ method, route, statusCode, durationMs }) {
  const labels = { method: method || 'UNKNOWN', route: routeShape(route), status: String(statusCode || 0) };
  incCounter('xeno_http_requests_total', labels);
  observe('xeno_http_request_duration_seconds',
    { method: labels.method, route: labels.route }, (durationMs || 0) / 1000);
}

const parseKey = (k) => {
  const [name, labelStr] = k.split('|');
  const labels = {};
  if (labelStr) for (const pair of labelStr.split(',')) { const i = pair.indexOf('='); labels[pair.slice(0, i)] = pair.slice(i + 1); }
  return { name, labels };
};

/** @param {{isLeader?: () => boolean}} [opts] */
export function render(opts = {}) {
  const out = [];
  const seen = new Set();

  const byName = new Map();
  for (const k of counters.keys()) { const { name } = parseKey(k); if (!byName.has(name)) byName.set(name, []); byName.get(name).push(k); }
  for (const [name, keys] of byName) {
    if (!seen.has(name)) { out.push(`# TYPE ${name} counter`); seen.add(name); }
    for (const k of keys) { const { labels } = parseKey(k); out.push(`${name}${fmtLabels(labels)} ${counters.get(k)}`); }
  }

  const hByName = new Map();
  for (const k of histograms.keys()) { const { name } = parseKey(k); if (!hByName.has(name)) hByName.set(name, []); hByName.get(name).push(k); }
  for (const [name, keys] of hByName) {
    out.push(`# TYPE ${name} histogram`);
    for (const k of keys) {
      const { labels } = parseKey(k); const h = histograms.get(k);
      let cumulative = 0;
      for (const b of BUCKETS) { cumulative = h.buckets.get(b); out.push(`${name}_bucket${fmtLabels({ ...labels, le: String(b) })} ${cumulative}`); }
      out.push(`${name}_bucket${fmtLabels({ ...labels, le: '+Inf' })} ${h.count}`);
      out.push(`${name}_sum${fmtLabels(labels)} ${h.sum}`);
      out.push(`${name}_count${fmtLabels(labels)} ${h.count}`);
    }
  }

  // 🔴 The one metric that MUST differ between replicas. Two replicas reporting
  // 1 means the background work is running twice, which no request metric shows.
  if (typeof opts.isLeader === 'function') {
    out.push('# TYPE xeno_background_leader gauge');
    out.push(`xeno_background_leader ${opts.isLeader() ? 1 : 0}`);
  }

  // Circuit-breaker state per upstream. 0=closed 1=half-open 2=open. A breaker
  // that opened and nobody noticed is the same as no breaker: the calls fail
  // fast, the symptom disappears from latency, and the cause is invisible.
  if (typeof opts.breakers === 'function') {
    const snap = opts.breakers() || [];
    if (snap.length) {
      out.push('# TYPE xeno_upstream_breaker_state gauge');
      out.push('# TYPE xeno_upstream_inflight gauge');
      const code = { closed: 0, 'half-open': 1, open: 2 };
      for (const b of snap) {
        out.push(`xeno_upstream_breaker_state${fmtLabels({ target: b.target })} ${code[b.state] ?? 0}`);
        out.push(`xeno_upstream_inflight${fmtLabels({ target: b.target })} ${b.inFlight}`);
      }
    }
  }

  const mem = process.memoryUsage();
  out.push('# TYPE xeno_process_resident_memory_bytes gauge');
  out.push(`xeno_process_resident_memory_bytes ${mem.rss}`);
  out.push('# TYPE xeno_process_heap_used_bytes gauge');
  out.push(`xeno_process_heap_used_bytes ${mem.heapUsed}`);
  out.push('# TYPE xeno_process_uptime_seconds gauge');
  out.push(`xeno_process_uptime_seconds ${Math.round(process.uptime())}`);
  out.push('# TYPE xeno_build_info gauge');
  out.push(`xeno_build_info${fmtLabels({ sha: process.env.XENO_BUILD_SHA || 'unknown', node: process.version })} 1`);

  return `${out.join('\n')}\n`;
}

export function _resetForTests() { counters.clear(); histograms.clear(); }
