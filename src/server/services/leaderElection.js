/**
 * leaderElection.js — exactly one replica runs the background work.
 *
 * WHY THIS EXISTS
 *   The backend runs 9 pieces of recurring work that MUST happen once per tick,
 *   not once per replica: the credit-hold sweeper, the download-intent sweeper,
 *   the retention sweeper, download cleanup, the Forum notification mailer, the
 *   Forum webhook pusher, the chat scheduled worker (x2) and library ingestion.
 *
 *   Run two replicas without this and the visible failure is customers getting
 *   every Forum notification twice. The quiet ones are worse: two retention
 *   sweepers deleting concurrently, and two hold sweepers voiding the same
 *   credit holds.
 *
 * HOW
 *   A Postgres session-level advisory lock. Whoever holds it is leader.
 *
 *   🔴 The lock is held on a DEDICATED connection that is never returned to the
 *   pool. Session advisory locks belong to a CONNECTION, so a pooled client
 *   would release the lock the moment it went back to the pool — the lock would
 *   appear to work and would actually be held by nobody.
 *
 *   Failover is free and is the reason this design was chosen over a flag: when
 *   the leader dies, its connection drops, Postgres releases the lock itself,
 *   and the next standby poll picks it up. Nothing has to notice the death.
 *
 * DELIBERATELY NOT a config flag (XENO_IS_LEADER=true on one container). A flag
 * cannot fail over — if the flagged replica dies, the sweeps simply stop and
 * nothing says so. It also cannot survive `docker compose up --scale`, which
 * gives every replica identical environment.
 */

const DEFAULT_KEY = 'xeno-platform-background-work';
const DEFAULT_POLL_MS = 15000;

export function createLeaderElection(pool, options = {}) {
  const {
    key = DEFAULT_KEY,
    pollMs = DEFAULT_POLL_MS,
    logger = console,
  } = options;

  let client = null;
  let leader = false;
  let timer = null;
  let stopped = false;
  const onLeadFns = [];
  let teardown = null;

  const isLeader = () => leader;

  /** Register work that must run on exactly one replica. */
  function whenLeader(startFn) {
    onLeadFns.push(startFn);
    if (leader) runStarts();
    return () => {};
  }

  function runStarts() {
    const stops = [];
    for (const fn of onLeadFns) {
      try {
        const stop = fn();
        if (typeof stop === 'function') stops.push(stop);
      } catch (err) {
        logger.error('[Leader] background task failed to start:', err?.message || err);
      }
    }
    teardown = () => {
      for (const stop of stops) {
        try { stop(); } catch { /* a failed stop must not block demotion */ }
      }
    };
  }

  async function attempt() {
    if (stopped || leader) return;
    try {
      // A dedicated connection, held for as long as we are leader. Never released
      // while holding the lock — see the header.
      if (!client) client = await pool.connect();
      const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key]);
      if (rows[0]?.ok) {
        leader = true;
        logger.log(`[Leader] acquired '${key}' — this replica runs the background work`);
        runStarts();
      }
    } catch (err) {
      // A failed probe must not kill the process, and must not leave a broken
      // client cached: drop it so the next tick reconnects.
      logger.error('[Leader] election probe failed:', err?.message || err);
      try { client?.release(true); } catch { /* already gone */ }
      client = null;
      leader = false;
    }
  }

  function start() {
    if (timer) return;
    void attempt();
    timer = setInterval(() => { void attempt(); }, pollMs);
    // unref so leadership polling never keeps a draining process alive
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (teardown) { teardown(); teardown = null; }
    if (leader && client) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]); } catch { /* connection may be gone */ }
    }
    leader = false;
    // Release with destroy=true: this connection held a session lock, so it must
    // not go back into the pool for someone else to inherit.
    try { client?.release(true); } catch { /* already gone */ }
    client = null;
  }

  return { start, stop, isLeader, whenLeader, key };
}
