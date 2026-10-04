import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// PUB-12: issue/task discussion with contributor attribution,
// report/appeal, spam/abuse moderation, rate/concurrency limits and
// maintainer blocking. Posting is rate-limited per author and closed
// to blocked users; reports and appeals go to project maintainers,
// who hide, remove, restore or block. Recognition is granted by
// maintainers for reviewed outcomes only — accepted or integrated
// contributions, one attribution each — and the record carries no
// token, claim-count or self-reported-success input at all.
export const POSTS_PER_MINUTE = 5;
export const MAX_OPEN_REPORTS = 10;
const REPORT_REASONS = ['spam', 'abuse', 'offtopic', 'other'];

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

async function taskProject(executor, taskId) {
  const { rows } = await executor.query(
    `SELECT g.project_id AS "projectId" FROM project_tasks t
       JOIN project_milestones m ON m.id = t.milestone_id
       JOIN project_goals g ON g.id = m.goal_id
      WHERE t.id = $1`,
    [taskId],
  );
  if (rows.length === 0) throw new Error('Task not found');
  return rows[0].projectId;
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

async function blockedOn(executor, projectId, userId) {
  const { rows } = await executor.query(
    `SELECT 1 FROM project_discussion_blocks WHERE project_id = $1 AND blocked_user_id = $2`,
    [projectId, userId],
  );
  return rows.length > 0;
}

export async function postTaskComment(poolOrClient, { taskId, authorUserId, body }) {
  if (!taskId) throw new Error('taskId is required');
  if (!authorUserId) throw new Error('authorUserId is required');
  if (typeof body !== 'string' || !body.trim() || body.length > 8000) {
    throw new Error('comment body must be one to 8000 characters');
  }
  return withTx(poolOrClient, async (executor) => {
    const projectId = await taskProject(executor, taskId);
    await executor.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`task-discussion:${taskId}:${authorUserId}`]);
    if (await blockedOn(executor, projectId, authorUserId)) throw new Error('discussion_blocked');
    const recent = Number((await executor.query(
      `SELECT count(*) AS n FROM task_discussion_posts
        WHERE task_id = $1 AND author_user_id = $2 AND created_at > now() - interval '1 minute'`,
      [taskId, authorUserId],
    )).rows[0].n);
    if (recent >= POSTS_PER_MINUTE) throw new Error('discussion_rate_limited');
    const { rows } = await executor.query(
      `INSERT INTO task_discussion_posts (id, task_id, author_user_id, body)
        VALUES ($1, $2, $3, $4) RETURNING *`,
      [randomUUID(), taskId, authorUserId, body.trim()],
    );
    return rows[0];
  });
}

export async function readTaskDiscussion(poolOrClient, { taskId, readerUserId = null }) {
  const projectId = await taskProject(poolOrClient, taskId);
  const admin = readerUserId !== null && await isProjectAdmin(poolOrClient, projectId, readerUserId);
  const { rows } = await poolOrClient.query(
    admin
      ? `SELECT id, author_user_id AS "authorId", body, state, created_at AS "createdAt"
           FROM task_discussion_posts WHERE task_id = $1 ORDER BY created_at, id`
      : `SELECT id, author_user_id AS "authorId", body, created_at AS "createdAt"
           FROM task_discussion_posts WHERE task_id = $1 AND state = 'visible' ORDER BY created_at, id`,
    [taskId],
  );
  return rows;
}

export async function reportPost(poolOrClient, { postId, reporterUserId, reason, detail = null }) {
  if (!postId) throw new Error('postId is required');
  if (!reporterUserId) throw new Error('reporterUserId is required');
  if (!REPORT_REASONS.includes(reason)) throw new Error('Unknown report reason');
  if (detail !== null && (typeof detail !== 'string' || !detail.trim() || detail.length > 2000)) {
    throw new Error('invalid report detail');
  }
  return withTx(poolOrClient, async (executor) => {
    const post = (await executor.query(
      `SELECT * FROM task_discussion_posts WHERE id = $1`, [postId],
    )).rows[0];
    if (!post) throw new Error('Post not found');
    if (String(post.author_user_id) === String(reporterUserId)) throw new Error('report_self_refused');
    const projectId = await taskProject(executor, post.task_id);
    if (await blockedOn(executor, projectId, reporterUserId)) throw new Error('discussion_blocked');
    const open = Number((await executor.query(
      `SELECT count(*) AS n FROM task_discussion_reports WHERE reporter_user_id = $1 AND state = 'open'`,
      [reporterUserId],
    )).rows[0].n);
    if (open >= MAX_OPEN_REPORTS) throw new Error('too_many_open_reports');
    const dupe = (await executor.query(
      `SELECT 1 FROM task_discussion_reports WHERE post_id = $1 AND reporter_user_id = $2 AND state = 'open'`,
      [postId, reporterUserId],
    )).rows[0];
    if (dupe) throw new Error('report_already_open');
    const { rows } = await executor.query(
      `INSERT INTO task_discussion_reports (id, post_id, reporter_user_id, reason, detail)
        VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [randomUUID(), postId, reporterUserId, reason, detail === null ? null : detail.trim()],
    );
    return rows[0];
  });
}

export async function decideReport(poolOrClient, { reportId, actorUserId, decision, action = 'none' }) {
  if (!['upheld', 'dismissed'].includes(decision)) throw new Error('Unknown report decision');
  if (!['none', 'hide', 'remove'].includes(action)) throw new Error('Unknown moderation action');
  if (decision === 'dismissed' && action !== 'none') throw new Error('a dismissed report takes no action');
  return withTx(poolOrClient, async (executor) => {
    const report = (await executor.query(
      `SELECT r.*, p.task_id AS "taskId" FROM task_discussion_reports r
         JOIN task_discussion_posts p ON p.id = r.post_id
        WHERE r.id = $1 FOR UPDATE OF r`,
      [reportId],
    )).rows[0];
    if (!report) throw new Error('Report not found');
    if (report.state !== 'open') throw new Error('report_already_decided');
    const projectId = await taskProject(executor, report.taskId);
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) throw new Error('moderation_not_authorized');
    await executor.query(
      `UPDATE task_discussion_reports SET state = $2, decided_by_user_id = $3 WHERE id = $1`,
      [reportId, decision, actorUserId],
    );
    if (action !== 'none') {
      await executor.query(
        `UPDATE task_discussion_posts SET state = $2, hidden_by_user_id = $3, hidden_reason = $4 WHERE id = $1`,
        [report.post_id, action === 'hide' ? 'hidden' : 'removed', actorUserId, `${report.reason} report upheld`],
      );
    }
    return { reportId, decision, action };
  });
}

export async function appealModeration(poolOrClient, { postId, appellantUserId, grounds }) {
  if (!postId) throw new Error('postId is required');
  if (!appellantUserId) throw new Error('appellantUserId is required');
  if (typeof grounds !== 'string' || !grounds.trim() || grounds.length > 2000) {
    throw new Error('appeal grounds must be one to 2000 characters');
  }
  return withTx(poolOrClient, async (executor) => {
    const post = (await executor.query(
      `SELECT * FROM task_discussion_posts WHERE id = $1 FOR UPDATE`, [postId],
    )).rows[0];
    if (!post) throw new Error('Post not found');
    if (String(post.author_user_id) !== String(appellantUserId)) throw new Error('appeal_not_author');
    if (post.state === 'visible') throw new Error('nothing_to_appeal');
    const open = (await executor.query(
      `SELECT 1 FROM task_discussion_appeals WHERE post_id = $1 AND state = 'open'`, [postId],
    )).rows[0];
    if (open) throw new Error('appeal_already_open');
    const { rows } = await executor.query(
      `INSERT INTO task_discussion_appeals (id, post_id, appellant_user_id, grounds)
        VALUES ($1, $2, $3, $4) RETURNING *`,
      [randomUUID(), postId, appellantUserId, grounds.trim()],
    );
    return rows[0];
  });
}

export async function decideAppeal(poolOrClient, { appealId, actorUserId, decision }) {
  if (!['upheld', 'dismissed'].includes(decision)) throw new Error('Unknown appeal decision');
  return withTx(poolOrClient, async (executor) => {
    const appeal = (await executor.query(
      `SELECT a.*, p.task_id AS "taskId", p.state AS "postState" FROM task_discussion_appeals a
         JOIN task_discussion_posts p ON p.id = a.post_id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [appealId],
    )).rows[0];
    if (!appeal) throw new Error('Appeal not found');
    if (appeal.state !== 'open') throw new Error('appeal_already_decided');
    const projectId = await taskProject(executor, appeal.taskId);
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) throw new Error('moderation_not_authorized');
    await executor.query(
      `UPDATE task_discussion_appeals SET state = $2, decided_by_user_id = $3 WHERE id = $1`,
      [appealId, decision, actorUserId],
    );
    if (decision === 'upheld') {
      await executor.query(
        `UPDATE task_discussion_posts SET state = 'visible', hidden_by_user_id = NULL, hidden_reason = NULL
          WHERE id = $1`,
        [appeal.post_id],
      );
    }
    return { appealId, decision };
  });
}

export async function blockDiscusser(poolOrClient, { projectId, actorUserId, blockedUserId, reason }) {
  if (!projectId) throw new Error('projectId is required');
  if (!blockedUserId) throw new Error('blockedUserId is required');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    throw new Error('a block reason is required');
  }
  if (String(actorUserId) === String(blockedUserId)) throw new Error('block_self_refused');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) throw new Error('block_not_authorized');
    const owner = (await executor.query(
      `SELECT owner_user_id FROM chat_projects WHERE id = $1`, [projectId],
    )).rows[0]?.owner_user_id;
    if (owner && String(owner) === String(blockedUserId)) throw new Error('block_owner_refused');
    await executor.query(
      `INSERT INTO project_discussion_blocks (project_id, blocked_user_id, blocked_by_user_id, reason)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [projectId, blockedUserId, actorUserId, reason.trim()],
    );
    return { projectId, blockedUserId };
  });
}

export async function unblockDiscusser(poolOrClient, { projectId, actorUserId, blockedUserId }) {
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) throw new Error('block_not_authorized');
    await executor.query(
      `DELETE FROM project_discussion_blocks WHERE project_id = $1 AND blocked_user_id = $2`,
      [projectId, blockedUserId],
    );
    return { projectId, blockedUserId };
  });
}

// Recognition is granted — never claimed — for reviewed outcomes:
// the contribution is accepted or integrated, the credit names its
// author, and the primary key makes a second credit impossible. The
// record takes no metric input: tokens spent, claims filed and
// self-reported success cannot reach it by construction.
export async function recordAttribution(poolOrClient, { contributionId, actorUserId }) {
  if (!contributionId) throw new Error('contributionId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  return withTx(poolOrClient, async (executor) => {
    const contribution = (await executor.query(
      `SELECT * FROM contributions WHERE id = $1`, [contributionId],
    )).rows[0];
    if (!contribution) throw new Error('Contribution not found');
    if (!(await isProjectAdmin(executor, contribution.project_id, actorUserId))) {
      throw new Error('attribution_not_authorized');
    }
    if (!['accepted', 'integrated'].includes(contribution.review_state)) {
      throw new Error('not_a_reviewed_outcome');
    }
    try {
      const { rows } = await executor.query(
        `INSERT INTO contribution_attributions (contribution_id, attributed_user_id, recorded_by_user_id)
          VALUES ($1, $2, $3) RETURNING *`,
        [contributionId, contribution.author_user_id, actorUserId],
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new Error('already_attributed');
      throw err;
    }
  });
}

export async function readAttributions(poolOrClient, userId) {
  const { rows } = await poolOrClient.query(
    `SELECT contribution_id AS "contributionId", basis, recorded_at AS "recordedAt"
       FROM contribution_attributions WHERE attributed_user_id = $1 ORDER BY recorded_at, contribution_id`,
    [userId],
  );
  return rows;
}
