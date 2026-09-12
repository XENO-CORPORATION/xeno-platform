/**
 * upstream.js — timeouts, bounded retry, circuit breakers and bulkheads for
 * every call that leaves this process.
 *
 * WHY
 *   There were 39 raw `await fetch(...)` sites and not one timeout among them.
 *   Node's fetch has NO default timeout, so a provider that accepts a connection
 *   and then stops talking holds the request forever — and because each held
 *   request occupies a worker, one slow provider quietly consumes the capacity
 *   every OTHER provider needs. That is the failure this module exists to stop,
 *   and it is why the bulkhead matters more than the breaker.
 *
 * THE FOUR CONTROLS, and what each is actually for
 *   timeout   an upstream that never answers must not become our outage
 *   retry     transient faults only, with backoff AND jitter
 *   breaker   stop calling a target that is already down; fail fast instead of
 *             queueing behind it
 *   bulkhead  cap concurrency PER TARGET so one sick provider cannot starve the
 *             others — the isolation half, and the one usually skipped
 *
 * 🔴 RETRY IS NOT FREE AND IS NOT ALWAYS SAFE. Only idempotent calls and only
 * retryable conditions: a network error, a timeout, 429, or 5xx. A 4xx is the
 * upstream telling you the request is wrong — retrying it is just load. And a
 * retry on a NON-idempotent call can double-charge or double-send, so callers
 * must opt in with `idempotent: true`.
 */

import { incCounter } from './metrics.js';

const CLOSED = 'closed', OPEN = 'open', HALF = 'half-open';

const targets = new Map(); // name -> state

function targetState(name, opts) {
  let t = targets.get(name);
  if (!t) {
    t = {
      name,
      state: CLOSED,
      failures: 0,
      openedAt: 0,
      inFlight: 0,
      queue: [],
      failureThreshold: opts.failureThreshold ?? 5,
      resetAfterMs: opts.resetAfterMs ?? 30000,
      maxConcurrent: opts.maxConcurrent ?? 12,
    };
    targets.set(name, t);
  }
  return t;
}

export class UpstreamError extends Error {
  constructor(message, { code, target, status, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code || 'upstream_error';
    this.target = target;
    this.status = status;
    this.cause = cause;
    // 503: this is us refusing or an upstream being unavailable, never the
    // caller's fault. A 500 would blame our own code for someone else's outage.
    this.statusCode = 503;
  }
}

/** Bulkhead: never let one target hold more than maxConcurrent slots. */
function acquire(t) {
  if (t.inFlight < t.maxConcurrent) { t.inFlight += 1; return Promise.resolve(); }
  incCounter('xeno_upstream_bulkhead_queued_total', { target: t.name });
  return new Promise((resolve, reject) => {
    // A bounded queue. An unbounded one just moves the exhaustion from workers
    // to memory and hides it for longer.
    if (t.queue.length >= t.maxConcurrent * 4) {
      incCounter('xeno_upstream_bulkhead_rejected_total', { target: t.name });
      reject(new UpstreamError(`upstream ${t.name} is saturated`, { code: 'bulkhead_full', target: t.name }));
      return;
    }
    t.queue.push({ resolve, reject });
  });
}

function release(t) {
  t.inFlight -= 1;
  const next = t.queue.shift();
  if (next) { t.inFlight += 1; next.resolve(); }
}

function onSuccess(t) {
  if (t.state === HALF) incCounter('xeno_upstream_breaker_closed_total', { target: t.name });
  t.state = CLOSED; t.failures = 0;
}

function onFailure(t) {
  t.failures += 1;
  if (t.failures >= t.failureThreshold && t.state !== OPEN) {
    t.state = OPEN; t.openedAt = Date.now();
    incCounter('xeno_upstream_breaker_opened_total', { target: t.name });
  }
}

function checkBreaker(t) {
  if (t.state === OPEN) {
    if (Date.now() - t.openedAt >= t.resetAfterMs) {
      // One probe is allowed through. If it succeeds the breaker closes; if it
      // fails the window restarts. Letting the whole backlog through instead is
      // how a recovering upstream gets knocked over again.
      t.state = HALF;
      return;
    }
    incCounter('xeno_upstream_breaker_rejected_total', { target: t.name });
    throw new UpstreamError(`upstream ${t.name} is unavailable (circuit open)`, { code: 'circuit_open', target: t.name });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryableStatus = (s) => s === 408 || s === 429 || (s >= 500 && s <= 599);

/**
 * fetch with the four controls applied.
 * @param {string} url
 * @param {RequestInit & {target?:string, timeoutMs?:number, retries?:number, idempotent?:boolean,
 *                        maxConcurrent?:number, failureThreshold?:number, resetAfterMs?:number}} [init]
 */
export async function upstreamFetch(url, init = {}) {
  const {
    target = new URL(url).host,
    timeoutMs = 15000,
    retries = 2,
    idempotent = false,
    ...fetchInit
  } = init;

  const t = targetState(target, init);
  // Retrying a non-idempotent call can double-charge or double-send. Opt-in only.
  const attempts = idempotent ? Math.max(1, retries + 1) : 1;

  checkBreaker(t);
  await acquire(t);
  try {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...fetchInit, signal: ac.signal });
        clearTimeout(timer);
        if (retryableStatus(res.status) && attempt < attempts) {
          incCounter('xeno_upstream_retry_total', { target, reason: String(res.status) });
          await sleep(backoff(attempt));
          continue;
        }
        if (res.status >= 500) { onFailure(t); } else { onSuccess(t); }
        incCounter('xeno_upstream_requests_total', { target, status: String(res.status) });
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        const timedOut = err?.name === 'AbortError';
        incCounter('xeno_upstream_requests_total', { target, status: timedOut ? 'timeout' : 'error' });
        if (attempt < attempts) {
          incCounter('xeno_upstream_retry_total', { target, reason: timedOut ? 'timeout' : 'network' });
          await sleep(backoff(attempt));
          continue;
        }
        onFailure(t);
        throw new UpstreamError(
          timedOut ? `upstream ${target} timed out after ${timeoutMs}ms` : `upstream ${target} failed: ${err?.message || err}`,
          { code: timedOut ? 'upstream_timeout' : 'upstream_unreachable', target, cause: err },
        );
      }
    }
    onFailure(t);
    throw new UpstreamError(`upstream ${target} failed after ${attempts} attempt(s)`, { code: 'upstream_error', target, cause: lastErr });
  } finally {
    release(t);
  }
}

/** Exponential backoff with FULL JITTER — lockstep retries are a thundering herd. */
function backoff(attempt) {
  const base = Math.min(2000, 150 * 2 ** (attempt - 1));
  return Math.random() * base;
}

/** For /metrics and for tests. */
export function breakerSnapshot() {
  return [...targets.values()].map((t) => ({
    target: t.name, state: t.state, failures: t.failures, inFlight: t.inFlight, queued: t.queue.length,
  }));
}

export function _resetForTests() { targets.clear(); }
