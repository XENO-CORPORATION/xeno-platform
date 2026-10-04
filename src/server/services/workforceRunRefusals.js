// What a run's refusal means for CONTINUING the run -- one place, so a runtime never has to hard-code
// the platform's code list to decide between "wait / try again" and "this run is over".
//
// RUN-07: a goal, loop or schedule continues while authorized, funded and progressing, and rests in a
// durable, resumable state otherwise. A refusal arrives as a typed code; this adds two ADDITIVE fields
// beside it, derived here and never taken from a caller:
//   resumable  true  -- the SAME admission can continue once `resume` is satisfied
//              false -- the admission cannot continue; a new admission is the only way forward
//   resume     what satisfies it: fresh_lease | budget_top_up | different_model | settle_open_draws |
//              different_capability | new_admission
// A code absent from the maps below carries neither field: the platform has not said, so a runtime
// must treat it as an ordinary failure rather than guess.

/** Authority losses that revoke a run durably (a terminal loss is recorded against the level that lost it). */
export const TERMINAL_LOSSES = new Map([
  ['actor_unavailable', 'authority_lost'], ['agent_not_found', 'authority_lost'], ['agent_version_withdrawn', 'authority_lost'],
  ['assignment_not_live', 'authority_lost'], ['participation_not_live', 'authority_lost'], ['project_not_live', 'authority_lost'],
  ['actor_cannot_act_for_target', 'authority_lost'], ['actor_not_an_admitted_member', 'authority_lost'],
  ['observer_cannot_dispatch', 'authority_lost'], ['agent_not_an_admitted_member', 'authority_lost'],
  ['entitlement_not_live', 'authority_lost'], ['root_binding_not_live', 'authority_lost'],
  // DIV-08: leaving the division, or the division being archived, stops the run.
  ['actor_outside_division', 'authority_lost'], ['division_not_live', 'authority_lost'],
]);

const resumes = (resume) => Object.freeze({ resumable: true, resume });
const over = Object.freeze({ resumable: false, resume: 'new_admission' });

/** Run-draw refusals (the ledger's coded errors, as the gateway receives them). */
export const DRAW_REFUSAL_RESUME = new Map([
  ['RUN_BUDGET_EXHAUSTED', resumes('budget_top_up')],
  ['LEASE_REQUIRED', resumes('fresh_lease')], ['LEASE_INVALID', resumes('fresh_lease')],
  ['LEASE_WRONG_OPERATION', resumes('fresh_lease')], ['LEASE_EXPIRED', resumes('fresh_lease')],
  ['LEASE_CONSUMED', resumes('fresh_lease')],
  ['MODEL_NOT_APPROVED', resumes('different_model')], ['MODEL_NOT_PRICED', resumes('different_model')],
  ['DRAWS_UNRESOLVED', resumes('settle_open_draws')],
  ['RUN_REVOKED', over], ['RUN_RESERVATION_MISSING', over],
  // A lapsed reservation cannot be revived (run-backed-hold); only a new admission re-reserves.
  ['RUN_RESERVATION_LAPSED', over],
]);

/** authorize-step refusals, by their `reason`. */
export const STEP_REFUSAL_RESUME = new Map([
  ['admission_revoked', over], ['no_live_capabilities', over],
  // A single capability no longer live refuses THIS step only; the run itself is not revoked.
  ['capability_not_live', resumes('different_capability')],
  ...[...TERMINAL_LOSSES.keys()].map((reason) => [reason, over]),
]);

/** The additive fields for a code, or {} when the platform has not said. */
export const resumeFields = (map, key) => {
  const r = map.get(key);
  return r ? { resumable: r.resumable, resume: r.resume } : {};
};
