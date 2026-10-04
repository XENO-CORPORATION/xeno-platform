import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { registerForgeProvider } from './forgeAdapter.js';

// FORGE-04: declared single-owner authority. GitHub owns commits,
// branch protections, pull request state and merge outcomes; XENO
// owns participation offers, admission, agent runs and project
// funding. Mirrored subjects keep each side's fields in separate
// columns with separate versions, so no write path can express a
// dual-master last-write-wins merge — a writer naming the other
// side's fields is refused, not resolved. The github provider
// therefore permits reads only: XENO never declares a GitHub merge,
// it ingests the outcome GitHub declared.
export const FIELD_OWNERS = Object.freeze({
  github_state: 'github',
  commit_sha: 'github',
  pr_state: 'github',
  merge_outcome: 'github',
  xeno_status: 'xeno',
  xeno_priority: 'xeno',
});

try {
  registerForgeProvider('github', ['discover', 'readRevision', 'listChecks', 'listReviews', 'reconcile']);
} catch (err) {
  if (!err || err.message !== 'provider_exists') throw err;
}

export function ownerOf(field) {
  const owner = FIELD_OWNERS[field];
  if (!owner) throw new Error('unknown_field');
  return owner;
}

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

export async function linkMirror(poolOrClient, { bindingId, actorUserId, subjectType, subjectId, githubRef }) {
  if (!['task', 'change_request'].includes(subjectType)) throw new Error('Unknown mirror subject');
  if (!subjectId) throw new Error('subjectId is required');
  if (typeof githubRef !== 'string' || !githubRef.trim() || githubRef.length > 128) {
    throw new Error('githubRef names the remote subject');
  }
  return withTx(poolOrClient, async (executor) => {
    const binding = (await executor.query(
      `SELECT * FROM forge_bindings WHERE id = $1`, [bindingId],
    )).rows[0];
    if (!binding) throw new Error('Binding not found');
    if (!(await isProjectAdmin(executor, binding.project_id, actorUserId))) {
      throw new Error('mirror_not_authorized');
    }
    try {
      const { rows } = await executor.query(
        `INSERT INTO forge_mirrors (id, binding_id, subject_type, subject_id, github_ref)
          VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [randomUUID(), bindingId, subjectType, subjectId, githubRef.trim()],
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new Error('mirror_exists');
      throw err;
    }
  });
}

// GitHub-side ingest: github-owned fields only, version strictly
// advancing. XENO-owned or unknown keys refuse — the ingest never
// resolves a conflict because it can never express one.
export async function ingestGithubEvent(poolOrClient, { bindingId, githubRef, version, fields }) {
  const incoming = Number(version);
  if (!Number.isInteger(incoming) || incoming < 1) throw new Error('invalid event version');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('fields must be an object');
  }
  for (const key of Object.keys(fields)) {
    if (FIELD_OWNERS[key] !== 'github') throw new Error(`ingest_rejects_${key}`);
  }
  if ('merge_outcome' in fields) throw new Error('merge_outcome_arrives_via_merge_record');
  return withTx(poolOrClient, async (executor) => {
    const mirror = (await executor.query(
      `SELECT * FROM forge_mirrors WHERE binding_id = $1 AND github_ref = $2 FOR UPDATE`,
      [bindingId, githubRef],
    )).rows[0];
    if (!mirror) throw new Error('Mirror not found');
    if (incoming <= Number(mirror.github_version)) throw new Error('stale_event');
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = $${i}`);
      values.push(value === null ? null : String(value));
      i += 1;
    }
    sets.push(`github_version = $${i}`);
    values.push(incoming);
    await executor.query(
      `UPDATE forge_mirrors SET ${sets.join(', ')} WHERE id = $${i + 1}`,
      [...values, mirror.id],
    );
    return { mirrorId: mirror.id, githubVersion: incoming };
  });
}

// XENO-side writes: xeno-owned fields only. GitHub-owned keys refuse
// here exactly as XENO-owned keys refuse at ingest.
export async function updateXenoMirror(poolOrClient, { mirrorId, actorUserId, fields }) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('fields must be an object');
  }
  for (const key of Object.keys(fields)) {
    if (FIELD_OWNERS[key] !== 'xeno') throw new Error(`xeno_rejects_${key}`);
  }
  return withTx(poolOrClient, async (executor) => {
    const mirror = (await executor.query(
      `SELECT m.*, b.project_id AS "projectId", b.provider FROM forge_mirrors m
         JOIN forge_bindings b ON b.id = m.binding_id WHERE m.id = $1 FOR UPDATE OF m`,
      [mirrorId],
    )).rows[0];
    if (!mirror) throw new Error('Mirror not found');
    if (!(await isProjectAdmin(executor, mirror.projectId, actorUserId))) {
      throw new Error('mirror_not_authorized');
    }
    const sets = [];
    const values = [];
    let i = 1;
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = $${i}`);
      values.push(value === null ? null : String(value));
      i += 1;
    }
    sets.push(`xeno_version = xeno_version + 1`);
    await executor.query(`UPDATE forge_mirrors SET ${sets.join(', ')} WHERE id = $${i}`, [...values, mirrorId]);
    return { mirrorId, xenoVersion: Number(mirror.xeno_version) + 1 };
  });
}

// The actual merge outcome arrives from GitHub and only for
// github-backed mirrors. XENO records what GitHub declared.
export async function recordGithubMerge(poolOrClient, { mirrorId, mergeSha, version }) {
  if (typeof mergeSha !== 'string' || !mergeSha.trim() || mergeSha.length > 512) {
    throw new Error('invalid merge sha');
  }
  const incoming = Number(version);
  if (!Number.isInteger(incoming) || incoming < 1) throw new Error('invalid event version');
  return withTx(poolOrClient, async (executor) => {
    const mirror = (await executor.query(
      `SELECT m.*, b.provider FROM forge_mirrors m
         JOIN forge_bindings b ON b.id = m.binding_id WHERE m.id = $1 FOR UPDATE OF m`,
      [mirrorId],
    )).rows[0];
    if (!mirror) throw new Error('Mirror not found');
    if (mirror.provider !== 'github') throw new Error('not_github_backed');
    if (mirror.subject_type !== 'change_request') throw new Error('merge_needs_change_request');
    if (incoming <= Number(mirror.github_version)) throw new Error('stale_event');
    await executor.query(
      `UPDATE forge_mirrors SET commit_sha = $2, pr_state = 'merged', github_version = $3 WHERE id = $1`,
      [mirrorId, mergeSha.trim(), incoming],
    );
    return { mirrorId, mergeSha: mergeSha.trim(), githubVersion: incoming };
  });
}

export async function readMirror(poolOrClient, mirrorId) {
  const { rows } = await poolOrClient.query(
    `SELECT id, binding_id AS "bindingId", subject_type AS "subjectType", subject_id AS "subjectId",
            github_ref AS "githubRef", github_state AS "githubState", commit_sha AS "commitSha",
            pr_state AS "prState", xeno_status AS "xenoStatus", xeno_priority AS "xenoPriority",
            github_version AS "githubVersion", xeno_version AS "xenoVersion"
       FROM forge_mirrors WHERE id = $1`,
    [mirrorId],
  );
  if (rows.length === 0) throw new Error('Mirror not found');
  return { ...rows[0], githubVersion: Number(rows[0].githubVersion), xenoVersion: Number(rows[0].xenoVersion) };
}

// What XENO may send GitHub: its own owned fields and nothing else.
export function buildGithubExportPayload(mirror) {
  return {
    githubRef: mirror.githubRef ?? mirror.github_ref,
    xeno_status: mirror.xenoStatus ?? mirror.xeno_status ?? null,
    xeno_priority: mirror.xenoPriority ?? mirror.xeno_priority ?? null,
  };
}
