/**
 * How long each operational table is kept, in one place.
 *
 * ── WHY ONE PLACE ───────────────────────────────────────────────────────────
 *
 * Four tables added in the last day grow one row per user action and none of
 * them had an end. That is not a slow leak, it is a scheduled outage: the first
 * symptom is a full disk on the box that also runs the database, and by then the
 * site is down rather than slow.
 *
 * Retention scattered across four sweepers drifts, and — worse — nobody can
 * answer "how long do we keep X?" without reading four files. That question gets
 * asked by auditors and by GDPR subject-access requests, and "let me check the
 * code" is the wrong answer to both.
 *
 * ── 🔴 THE RULE THAT MAKES THIS SAFE ────────────────────────────────────────
 *
 * A table is pruned only if deleting a row LOSES NOTHING WE COULD BE ASKED FOR.
 *
 * That is why `checkout_consents` is NOT pruned by default and never should be
 * without a decision. It is the evidence that a customer waived a statutory
 * right; deleting it means that if they later say "I never agreed to lose my
 * withdrawal right", we cannot show otherwise, and the burden is ours. GDPR's
 * storage-limitation principle pulls the other way, so the retention period is a
 * question for a lawyer and a Steuerberater — the mechanism is here, switched
 * off, with the reason written down rather than a number invented.
 */

const DAY = 86_400_000;

/**
 * @typedef {{table: string, column: string, days: number|null, why: string}} Policy
 */

/** @type {Policy[]} */
export const POLICIES = [
  {
    table: 'client_version_refusals',
    column: 'at',
    days: 90,
    why: 'operational only. A refusal is useful while a version floor is live and '
      + 'while someone is asking "how many did we lock out?". Nobody asks that '
      + 'about a floor lifted three months ago.',
  },
  {
    table: 'download_grants',
    column: 'at',
    days: 400,
    /* 🔴 Deliberately longer than a year. A grant is the security audit of who
     * took which binary, and the questions it answers arrive late: a chargeback
     * months after the fact, a licence dispute, an investigation into a leaked
     * build. 400 days covers a full year plus the tail. */
    why: 'security audit of who obtained which binary. The questions it answers '
      + 'arrive late — chargebacks, licence disputes, leaked builds — so it '
      + 'outlives a year deliberately.',
  },
  {
    table: 'download_intent_events',
    column: 'at',
    days: null,
    /* Not pruned HERE on purpose. Events cascade when their intent is deleted by
     * the funnel sweeper, so a second policy on the same rows would be two
     * clocks disagreeing about the same data — and the one that fires first
     * would silently win. */
    why: 'cascades with download_intents, which the funnel sweeper prunes at 180 '
      + 'days. A second clock on the same rows would be two policies disagreeing.',
  },
  {
    table: 'checkout_consents',
    column: 'consented_at',
    days: null,
    /* 🔴 OFF, and this is the load-bearing default in the file. */
    why: 'EVIDENCE that a customer waived a statutory right. Deleting it means we '
      + 'cannot rebut "I never agreed", and the burden is ours. GDPR storage '
      + 'limitation pulls the other way, so the period is a lawyer + '
      + 'Steuerberater decision. Set CONSENT_RETENTION_DAYS deliberately or not '
      + 'at all.',
  },
];

/** Env overrides, so a period can be changed without a deploy. */
function daysFor(p) {
  const env = {
    client_version_refusals: 'VERSION_REFUSAL_RETENTION_DAYS',
    download_grants: 'GRANT_RETENTION_DAYS',
    checkout_consents: 'CONSENT_RETENTION_DAYS',
  }[p.table];
  if (!env) return p.days;
  const raw = process.env[env];
  if (raw == null || raw === '') return p.days;
  const n = Number(raw);
  /* 🔴 A malformed override keeps the DEFAULT rather than becoming 0. Reading
   * "abc" as zero would delete the entire table on the next sweep — the failure
   * mode of a retention system must never be "delete everything". */
  if (!Number.isFinite(n) || n < 1) {
    console.error(`[Retention] ${env}="${raw}" is not a positive number — keeping the default`);
    return p.days;
  }
  return Math.floor(n);
}

/**
 * Delete what is past its policy. Returns per-table counts.
 *
 * Never throws: retention is hygiene, and hygiene must not be able to take the
 * server down at boot or wedge a request.
 */
export async function sweepRetention(pool) {
  const out = {};
  for (const p of POLICIES) {
    const days = daysFor(p);
    if (!days) continue; // null = deliberately never pruned
    try {
      /* Bounded per run. An unbounded DELETE on a table that has grown for
       * months takes a long lock and can stall every other write; a capped
       * delete simply runs again on the next sweep. */
      const r = await pool.query(
        `DELETE FROM ${p.table} WHERE ctid IN (
           SELECT ctid FROM ${p.table}
            WHERE ${p.column} < NOW() - ($1 || ' days')::interval
            LIMIT 5000
         )`,
        [String(days)],
      );
      if (r.rowCount) out[p.table] = r.rowCount;
    } catch (e) {
      console.error(`[Retention] sweep failed for ${p.table}:`, e.message);
    }
  }
  return out;
}

/** What the policy currently is — for the ops summary and for answering auditors. */
export function describeRetention() {
  return POLICIES.map((p) => ({
    table: p.table,
    days: daysFor(p),
    pruned: Boolean(daysFor(p)),
    why: p.why,
  }));
}

export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export { DAY };
