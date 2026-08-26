/**
 * inHouseDailyLimit — REAL enforcement of the plan entitlement `inHouseDailyLimit`
 * on the in-house (xeno-rt) inference path.
 *
 * The entitlement has been ADVERTISED on every plan (free = 50/day, pro/team =
 * unlimited via null — see PLAN_ENTITLEMENTS in services/billingService.js) but was
 * never enforced anywhere. This module is the one enforcement point:
 *
 *   - a per-(user, UTC day) counter in `inhouse_daily_usage` (migration
 *     20260719000000-ledger-audit-tables.sql; also lazily ensured here so
 *     enforcement never waits on migration wiring), bumped with an atomic
 *     `INSERT ... ON CONFLICT ... SET count = count + 1 RETURNING count` upsert;
 *   - when the user's plan has a NON-NULL inHouseDailyLimit and the bumped count
 *     exceeds it → 429 naming the cap and the reset time (UTC midnight);
 *   - FAIL-OPEN: if the counter infrastructure itself errors, the request is
 *     allowed through with a LOUD console.error — a broken counter must never
 *     block inference. (Entitlement resolution reuses resolveEntitlements, which
 *     fails CLOSED to the free tier — the established gate behavior.)
 *
 * Exports:
 *   - enforceInHouseDailyLimit(db, userId)  → { allowed, limit, count, resetAt } —
 *     call inside a route right before actually running the in-house call (the
 *     precise site: after availability checks, so failed-precondition requests
 *     don't consume quota). Wired in routes/aiRoutes.js POST /api/ai/chat.
 *   - inHouseDailyLimit()                   → Express middleware for mount-level
 *     wiring (applies only when the request body selects path='inhouse').
 */
import { resolveEntitlements } from '../utils/entitlementGate.js';
import { normalizePath } from '../utils/modelPaths.js';

// Lazy idempotent schema guarantee (billingService ensureSchema pattern) — the
// canonical DDL lives in the migration; this only protects enforcement on an
// environment where the migration has not run yet.
let schemaPromise = null;
function ensureSchema(db) {
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS inhouse_daily_usage (
        user_id uuid NOT NULL,
        day     date NOT NULL,
        count   int  NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, day)
      );
    `).catch((e) => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

/** Next UTC midnight (when the daily counter naturally resets). */
export function nextUtcMidnight(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Atomically bump today's (UTC) in-house usage counter; returns the new count. */
export async function bumpInhouseDailyUsage(db, userId) {
  await ensureSchema(db);
  const r = await db.query(
    `INSERT INTO inhouse_daily_usage (user_id, day, count)
     VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = inhouse_daily_usage.count + 1
     RETURNING count`,
    [userId],
  );
  return Number(r.rows[0].count);
}

/**
 * Enforce the plan's in-house daily cap for one request.
 * Returns { allowed: true } (unlimited plan / under cap / counter failure), or
 * { allowed: false, limit, count, resetAt } when the cap is exceeded.
 * NOTE: the counter is only bumped for capped plans, so unlimited plans cost
 * zero counter writes.
 */
export async function enforceInHouseDailyLimit(db, userId) {
  let limit;
  try {
    const ent = await resolveEntitlements(db, userId); // fails CLOSED to free (limit 50)
    limit = ent?.inHouseDailyLimit;
  } catch (e) {
    // resolveEntitlements never throws, but stay safe: treat as free-tier cap.
    limit = 50;
  }
  if (limit == null) return { allowed: true, limit: null }; // unlimited (pro/team/internal)

  try {
    const count = await bumpInhouseDailyUsage(db, userId);
    if (count > limit) {
      return { allowed: false, limit, count, resetAt: nextUtcMidnight().toISOString() };
    }
    return { allowed: true, limit, count };
  } catch (e) {
    // FAIL OPEN, loudly: never let counter infrastructure block inference.
    console.error(`[inhouse-limit] counter failure (failing OPEN): user=${userId} error=${String(e?.message || e)}`);
    return { allowed: true, limit, counterError: true };
  }
}

/** The 429 payload for an exceeded cap (shared by middleware + in-route wiring). */
export function limitExceededBody(verdict) {
  return {
    error: 'inhouse_daily_limit_exceeded',
    message: `You've reached your plan's in-house inference cap of ${verdict.limit} requests per day. The counter resets at midnight UTC (${verdict.resetAt}). Everything and higher plans remove this daily cap where in-house inference is available.`,
    limit: verdict.limit,
    used: verdict.count,
    resetAt: verdict.resetAt,
  };
}

/**
 * Express middleware form. Applies ONLY to requests that select the in-house
 * path (req.body.path === 'inhouse' after normalization); everything else passes
 * through untouched. Requires req.user + req.db (mount behind auth + db).
 */
export function inHouseDailyLimit() {
  return async (req, res, next) => {
    try {
      if (normalizePath(req.body?.path) !== 'inhouse') return next();
      const userId = req.user?.id;
      if (!userId || !req.db) return next(); // auth/db middleware own those failures
      const verdict = await enforceInHouseDailyLimit(req.db, userId);
      if (!verdict.allowed) return res.status(429).json(limitExceededBody(verdict));
      return next();
    } catch (e) {
      // Belt-and-suspenders fail-open (enforceInHouseDailyLimit already catches).
      console.error(`[inhouse-limit] middleware failure (failing OPEN): ${String(e?.message || e)}`);
      return next();
    }
  };
}

export default inHouseDailyLimit;
