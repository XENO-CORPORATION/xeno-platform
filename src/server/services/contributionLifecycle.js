import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// PUB-06: the contribution lifecycle. Eleven explicit states; every move
// records author, source, destination, timestamp, current revision and a
// decision rationale. Maintainers admit, review-decide and integrate;
// authors and responsible humans drive the work and may always withdraw
// from a live state. Accepted contributions are read-only: the only exit
// is integration, and no new revisions land past acceptance.
const TRANSITIONS = {
  proposed: ['admitted', 'rejected', 'withdrawn'],
  admitted: ['in_progress', 'withdrawn'],
  in_progress: ['submitted', 'withdrawn'],
  submitted: ['checks_pending', 'withdrawn'],
  checks_pending: ['review', 'submitted', 'withdrawn'],
  review: ['accepted', 'changes_requested', 'rejected', 'withdrawn', 'submitted'],
  changes_requested: ['submitted', 'withdrawn'],
  accepted: ['integrated'],
  rejected: [],
  withdrawn: [],
  integrated: [],
};
// Who may move: maintainers decide admission, review outcomes and
// integration; the author's side drives work states and withdrawal.
const MAINTAINER_ONLY = new Set([
  'proposed>admitted', 'proposed>rejected', 'review>accepted',
  'review>changes_requested', 'review>rejected', 'accepted>integrated',
]);

function isPool(poolOrClient) {
  return poolOrClient && typeof poolOrClient.totalCount === 'number';
}

async function withTx(poolOrClient, fn) {
  if (!isPool(poolOrClient)) return fn(poolOrClient);
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function isProjectAdmin(executor, projectId, actorUserId) {
  const { rows } = await executor.query(
    `SELECT owner_user_id FROM chat_projects WHERE id = $1`,
    [projectId],
  );
  if (rows.length === 0) throw new Error('Project not found');
  if (rows[0].owner_user_id && String(rows[0].owner_user_id) === String(actorUserId)) return true;
  const verdict = await check(executor, {
    object: `project:${projectId}`,
    relation: 'admin',
    subject: `user:${actorUserId}`,
  });
  return verdict.allowed === true;
}

export async function transitionContribution(poolOrClient, { contributionId, actorUserId, toState, rationale }) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!TRANSITIONS[toState]) throw new Error('Unknown lifecycle state');
  if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 4000) {
    throw new Error('a decision rationale is required');
  }
  return withTx(poolOrClient, (executor) => transitionInner(executor, { contributionId, actorUserId, toState, rationale }));
}

export async function transitionInner(executor, { contributionId, actorUserId, toState, rationale }) {
  const current = (await executor.query(
    `SELECT * FROM contributions WHERE id = $1 FOR UPDATE`, [contributionId],
  )).rows[0];
  if (!current) throw new Error('Contribution not found');
  const from = current.review_state;
  if (!TRANSITIONS[from].includes(toState)) {
    throw new Error(`Illegal transition ${from} -> ${toState}`);
  }
  const selfSide = String(actorUserId) === String(current.author_user_id)
    || String(actorUserId) === String(current.responsible_user_id);
  if (MAINTAINER_ONLY.has(`${from}>${toState}`)) {
    if (!(await isProjectAdmin(executor, current.project_id, actorUserId))) {
      throw new Error('lifecycle_decision_not_authorized');
    }
  } else if (!selfSide && !(await isProjectAdmin(executor, current.project_id, actorUserId))) {
    throw new Error('lifecycle_move_not_authorized');
  }
  await executor.query(
    `INSERT INTO contribution_transitions (id, contribution_id, from_state, to_state, revision_no, actor_user_id, rationale)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), contributionId, from, toState, Number(current.current_revision_no), actorUserId, rationale.trim()],
  );
  await executor.query(`UPDATE contributions SET review_state = $2 WHERE id = $1`, [contributionId, toState]);
  return { from, to: toState, revisionNo: Number(current.current_revision_no) };
}

export async function readTransitions(poolOrClient, contributionId) {
  const { rows } = await poolOrClient.query(
    `SELECT from_state AS "from", to_state AS "to", revision_no AS "revisionNo",
            actor_user_id AS "actor", rationale, created_at AS "at"
       FROM contribution_transitions WHERE contribution_id = $1 ORDER BY created_at, id`,
    [contributionId],
  );
  return rows.map((r) => ({ ...r, revisionNo: Number(r.revisionNo) }));
}
