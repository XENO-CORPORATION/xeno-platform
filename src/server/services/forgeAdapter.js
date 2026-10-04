import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// FORGE-01: a repository-host-neutral binding and contribution
// adapter. Domain operations — discover, bind, read revision, create
// branch, fork, submit/update change request, list checks/reviews,
// reconcile status, integrate under policy — run against a neutral
// store through per-provider capability gates. Each provider
// declares exactly what it permits; anything else refuses with an
// explicit unavailable-operation error, and describeCapabilities
// returns the full permit/refuse map. 'local' is the reference
// provider with every operation; 'mirror' is read-only by
// declaration, which is what pins the unavailable path.
export const OPERATIONS = ['discover', 'readRevision', 'createBranch', 'fork', 'submitCR',
  'updateCR', 'listChecks', 'listReviews', 'reconcile', 'integrate'];

const PROVIDERS = new Map();

function defineProvider(name, capabilities, fns) {
  const caps = {};
  for (const op of OPERATIONS) caps[op] = capabilities.includes(op);
  PROVIDERS.set(name, { capabilities: Object.freeze({ ...caps }), fns });
}

export function describeCapabilities(provider) {
  const entry = PROVIDERS.get(provider);
  if (!entry) throw new Error('unknown_provider');
  return {
    provider,
    capabilities: { ...entry.capabilities },
    unavailable: OPERATIONS.filter((op) => !entry.capabilities[op]),
  };
}

function dispatch(provider, op, executor, args) {
  const entry = PROVIDERS.get(provider);
  if (!entry) throw new Error('unknown_provider');
  if (!entry.capabilities[op]) {
    throw new Error(`operation_unavailable: provider '${provider}' does not support '${op}'`);
  }
  return entry.fns[op](executor, args);
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

async function bindingOf(executor, bindingId) {
  const { rows } = await executor.query(`SELECT * FROM forge_bindings WHERE id = $1`, [bindingId]);
  if (rows.length === 0) throw new Error('Binding not found');
  return rows[0];
}

// The neutral store operations. Both reference providers share these
// implementations; their capability maps decide who may call what.
const store = {
  async discover(executor, { provider }) {
    const { rows } = await executor.query(
      `SELECT remote_id AS "remoteId" FROM forge_bindings WHERE provider = $1 ORDER BY remote_id`,
      [provider],
    );
    return rows.map((r) => r.remoteId);
  },
  async readRevision(executor, { bindingId, rev }) {
    const branches = (await executor.query(
      `SELECT name FROM forge_branches WHERE binding_id = $1 AND head_rev = $2`,
      [bindingId, rev],
    )).rows.map((r) => r.name);
    const crs = (await executor.query(
      `SELECT id FROM forge_change_requests WHERE binding_id = $1 AND head_rev = $2`,
      [bindingId, rev],
    )).rows.map((r) => r.id);
    if (branches.length === 0 && crs.length === 0) throw new Error('revision_not_found');
    return { rev, branches, changeRequests: crs };
  },
  async createBranch(executor, { bindingId, name, fromRev, actorUserId }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('invalid branch name');
    if (typeof fromRev !== 'string' || !fromRev.trim() || fromRev.length > 512) throw new Error('invalid base revision');
    try {
      const { rows } = await executor.query(
        `INSERT INTO forge_branches (binding_id, name, head_rev) VALUES ($1, $2, $3) RETURNING *`,
        [bindingId, name.trim(), fromRev.trim()],
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new Error('branch_exists');
      throw err;
    }
  },
  async fork(executor, { bindingId, name, actorUserId }) {
    const upstream = await bindingOf(executor, bindingId);
    if (typeof name !== 'string' || !name.trim() || name.length > 200) throw new Error('invalid fork name');
    const remoteId = `fork:${upstream.remote_id}:${name.trim()}:${randomUUID().slice(0, 8)}`;
    const { rows } = await executor.query(
      `INSERT INTO forge_bindings (project_id, provider, remote_id, installation_ref, refs, access_policy,
          forked_from_binding_id, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [upstream.project_id, upstream.provider, remoteId, upstream.installation_ref,
        JSON.stringify(upstream.refs ?? {}), JSON.stringify(upstream.access_policy ?? {}),
        bindingId, actorUserId],
    );
    const forkBinding = rows[0];
    await executor.query(
      `INSERT INTO forge_branches (binding_id, name, head_rev)
        SELECT $1::uuid, name, head_rev FROM forge_branches WHERE binding_id = $2`,
      [forkBinding.id, bindingId],
    );
    return forkBinding;
  },
  async submitCR(executor, { bindingId, sourceBranch, targetRef, title, body = '', actorUserId }) {
    if (typeof title !== 'string' || !title.trim() || title.length > 300) throw new Error('invalid change title');
    const branch = (await executor.query(
      `SELECT head_rev FROM forge_branches WHERE binding_id = $1 AND name = $2`,
      [bindingId, sourceBranch],
    )).rows[0];
    if (!branch) throw new Error('source_branch_not_found');
    const { rows } = await executor.query(
      `INSERT INTO forge_change_requests (binding_id, source_branch, target_ref, title, body, head_rev, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [bindingId, sourceBranch, targetRef, title.trim(), String(body ?? ''), branch.head_rev, actorUserId],
    );
    return rows[0];
  },
  async updateCR(executor, { crId, title, body, headRev }) {
    const cr = (await executor.query(
      `SELECT * FROM forge_change_requests WHERE id = $1 FOR UPDATE`, [crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (cr.status !== 'open') throw new Error('change_request_closed');
    const next = {
      title: title === undefined ? cr.title : title,
      body: body === undefined ? cr.body : String(body),
      head_rev: headRev === undefined ? cr.head_rev : headRev,
    };
    if (typeof next.title !== 'string' || !next.title.trim() || next.title.length > 300) {
      throw new Error('invalid change title');
    }
    const { rows } = await executor.query(
      `UPDATE forge_change_requests SET title = $2, body = $3, head_rev = $4 WHERE id = $1 RETURNING *`,
      [crId, next.title.trim(), next.body, next.head_rev],
    );
    return rows[0];
  },
  async listChecks(executor, { crId }) {
    const { rows } = await executor.query(
      `SELECT name, status, detail FROM forge_checks WHERE cr_id = $1 ORDER BY created_at, id`, [crId],
    );
    return rows;
  },
  async listReviews(executor, { crId }) {
    const { rows } = await executor.query(
      `SELECT reviewer_user_id AS "reviewer", decision, body FROM forge_reviews
        WHERE cr_id = $1 ORDER BY created_at, id`,
      [crId],
    );
    return rows;
  },
  async reconcile(executor, { crId }) {
    const cr = (await executor.query(
      `SELECT * FROM forge_change_requests WHERE id = $1`, [crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    const checks = await store.listChecks(executor, { crId });
    const reviews = await store.listReviews(executor, { crId });
    return {
      crId, status: cr.status, headRev: cr.head_rev,
      checks: {
        pass: checks.filter((c) => c.status === 'pass').length,
        fail: checks.filter((c) => c.status === 'fail').length,
        pending: checks.filter((c) => c.status === 'pending').length,
      },
      reviews: {
        approve: reviews.filter((r) => r.decision === 'approve').length,
        requestChanges: reviews.filter((r) => r.decision === 'request_changes').length,
        reject: reviews.filter((r) => r.decision === 'reject').length,
      },
    };
  },
  async integrate(executor, { crId, actorUserId, policy = {} }) {
    const requireApproval = policy.requireApproval !== false;
    const requireGreenChecks = policy.requireGreenChecks !== false;
    const cr = (await executor.query(
      `SELECT * FROM forge_change_requests WHERE id = $1 FOR UPDATE`, [crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (cr.status !== 'open') throw new Error('change_request_closed');
    if (requireApproval) {
      const approvals = Number((await executor.query(
        `SELECT count(*) AS n FROM forge_reviews WHERE cr_id = $1 AND decision = 'approve'`, [crId],
      )).rows[0].n);
      if (approvals === 0) throw new Error('integration_approval_required');
    }
    if (requireGreenChecks) {
      const checks = (await executor.query(
        `SELECT status FROM forge_checks WHERE cr_id = $1`, [crId],
      )).rows;
      if (checks.length === 0 || checks.some((c) => c.status !== 'pass')) {
        throw new Error('integration_checks_required');
      }
    }
    await executor.query(
      `UPDATE forge_branches SET head_rev = $1 WHERE binding_id = $2 AND name = $3`,
      [cr.head_rev, cr.binding_id, cr.target_ref],
    );
    const { rows } = await executor.query(
      `UPDATE forge_change_requests SET status = 'merged' WHERE id = $1 RETURNING *`, [crId],
    );
    return rows[0];
  },
};

defineProvider('local', [...OPERATIONS], { ...store });
defineProvider('mirror',
  ['discover', 'readRevision', 'listChecks', 'listReviews', 'reconcile'],
  {
    discover: store.discover,
    readRevision: store.readRevision,
    listChecks: store.listChecks,
    listReviews: store.listReviews,
    reconcile: store.reconcile,
  });

export async function discoverRepositories(poolOrClient, provider) {
  return withTx(poolOrClient, (executor) => dispatch(provider, 'discover', executor, { provider }));
}

export async function bindRepository(poolOrClient, {
  projectId, actorUserId, provider, remoteId, installationRef = null, refs = {}, accessPolicy = {},
}) {
  if (!projectId) throw new Error('projectId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!PROVIDERS.has(provider)) throw new Error('unknown_provider');
  if (typeof remoteId !== 'string' || !remoteId.trim() || remoteId.length > 512) {
    throw new Error('remoteId names the repository');
  }
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) throw new Error('bind_not_authorized');
    try {
      const { rows } = await executor.query(
        `INSERT INTO forge_bindings (project_id, provider, remote_id, installation_ref, refs, access_policy, created_by_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [projectId, provider, remoteId.trim(), installationRef, JSON.stringify(refs), JSON.stringify(accessPolicy), actorUserId],
      );
      return rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new Error('repository_already_bound');
      throw err;
    }
  });
}

async function onBinding(poolOrClient, op, bindingId, args, actorUserId) {
  return withTx(poolOrClient, async (executor) => {
    const binding = await bindingOf(executor, bindingId);
    if (actorUserId !== undefined
      && !(await isProjectAdmin(executor, binding.project_id, actorUserId))) {
      throw new Error(`${op}_not_authorized`);
    }
    return dispatch(binding.provider, op, executor, { bindingId, ...args });
  });
}

export function readRevision(poolOrClient, args) {
  return onBinding(poolOrClient, 'readRevision', args.bindingId, args);
}

export function createBranch(poolOrClient, args) {
  return onBinding(poolOrClient, 'createBranch', args.bindingId, args, args.actorUserId);
}

export function forkRepository(poolOrClient, args) {
  return onBinding(poolOrClient, 'fork', args.bindingId, args, args.actorUserId);
}

export function submitChangeRequest(poolOrClient, args) {
  return onBinding(poolOrClient, 'submitCR', args.bindingId, args, args.actorUserId);
}

export function updateChangeRequest(poolOrClient, args) {
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT c.*, b.provider, b.project_id AS "projectId" FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [args.crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (!(await isProjectAdmin(executor, cr.projectId, args.actorUserId))) {
      throw new Error('updateCR_not_authorized');
    }
    return dispatch(cr.provider, 'updateCR', executor, args);
  });
}

export function listChecks(poolOrClient, args) {
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT b.provider FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [args.crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    return dispatch(cr.provider, 'listChecks', executor, args);
  });
}

export function listReviews(poolOrClient, args) {
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT b.provider FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [args.crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    return dispatch(cr.provider, 'listReviews', executor, args);
  });
}

export function reconcileStatus(poolOrClient, args) {
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT b.provider FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [args.crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    return dispatch(cr.provider, 'reconcile', executor, args);
  });
}

export function integrateChangeRequest(poolOrClient, args) {
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT c.*, b.provider, b.project_id AS "projectId" FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [args.crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (!(await isProjectAdmin(executor, cr.projectId, args.actorUserId))) {
      throw new Error('integrate_not_authorized');
    }
    return dispatch(cr.provider, 'integrate', executor, args);
  });
}

// Provider-local signal writes. The reference local provider accepts
// them; capability-poor providers refuse through the same gate.
export async function recordForgeCheck(poolOrClient, { crId, actorUserId, name, status, detail = '' }) {
  if (!['pass', 'fail', 'pending'].includes(status)) throw new Error('Unknown check status');
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT b.provider, b.project_id AS "projectId" FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (!(await isProjectAdmin(executor, cr.projectId, actorUserId))) throw new Error('check_not_authorized');
    if (!PROVIDERS.get(cr.provider).capabilities.updateCR) {
      throw new Error(`operation_unavailable: provider '${cr.provider}' does not support 'updateCR'`);
    }
    const { rows } = await executor.query(
      `INSERT INTO forge_checks (cr_id, name, status, detail) VALUES ($1, $2, $3, $4) RETURNING *`,
      [crId, name, status, String(detail ?? '')],
    );
    return rows[0];
  });
}

export async function recordForgeReview(poolOrClient, { crId, reviewerUserId, decision, body = '' }) {
  if (!['approve', 'request_changes', 'reject'].includes(decision)) throw new Error('Unknown review decision');
  return withTx(poolOrClient, async (executor) => {
    const cr = (await executor.query(
      `SELECT b.provider, b.project_id AS "projectId" FROM forge_change_requests c
         JOIN forge_bindings b ON b.id = c.binding_id WHERE c.id = $1`,
      [crId],
    )).rows[0];
    if (!cr) throw new Error('Change request not found');
    if (!(await isProjectAdmin(executor, cr.projectId, reviewerUserId))) {
      throw new Error('review_not_authorized');
    }
    if (!PROVIDERS.get(cr.provider).capabilities.updateCR) {
      throw new Error(`operation_unavailable: provider '${cr.provider}' does not support 'updateCR'`);
    }
    const { rows } = await executor.query(
      `INSERT INTO forge_reviews (cr_id, reviewer_user_id, decision, body) VALUES ($1, $2, $3, $4) RETURNING *`,
      [crId, reviewerUserId, decision, String(body ?? '')],
    );
    return rows[0];
  });
}
