import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// FORGE-05: webhook deliveries authenticate by HMAC against a
// per-installation secret derived from the platform master key —
// stored nowhere — then deduplicate durably by delivery id and
// reconcile strictly in sequence: duplicates replay, gaps hold,
// out-of-order redeliveries report stale, and fills cascade in
// order. Outbound creates and merges carry stable external
// references so an ambiguous response resolves by status lookup
// instead of retry-duplicating. Uninstall, suspension and repository
// revocation stop privileged calls and mark affected bindings.
const MASTER = process.env.WEBHOOK_MASTER_SECRET || 'xeno-dev-webhook-master-change-in-production';

export function deriveWebhookSecret(installationId) {
  return crypto.createHmac('sha256', MASTER).update(`webhook:${installationId}`).digest('hex');
}

export function signWebhookBody(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

function verifySignature(secret, rawBody, signature) {
  if (typeof signature !== 'string' || !signature.startsWith('sha256=')) return false;
  const expected = Buffer.from(signWebhookBody(secret, rawBody), 'utf8');
  const presented = Buffer.from(signature, 'utf8');
  return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
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

function bodyHashOf(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

async function applyStanding(executor, installationId, event) {
  if (event === 'installation.suspended') {
    await executor.query(
      `UPDATE github_installations SET suspended = TRUE WHERE installation_id = $1`, [installationId],
    );
    await executor.query(
      `UPDATE forge_bindings SET status = 'unavailable', unavailable_reason = 'installation_suspended'
        WHERE installation_ref = $1`,
      [installationId],
    );
    return { standing: 'suspended' };
  }
  if (event === 'installation.deleted') {
    await executor.query(
      `UPDATE github_installations SET suspended = TRUE, uninstalled = TRUE, uninstalled_at = now()
        WHERE installation_id = $1`,
      [installationId],
    );
    await executor.query(
      `UPDATE forge_bindings SET status = 'unavailable', unavailable_reason = 'installation_uninstalled'
        WHERE installation_ref = $1`,
      [installationId],
    );
    return { standing: 'uninstalled' };
  }
  return null;
}

export async function receiveWebhook(poolOrClient, {
  installationId, deliveryId, seq, event, rawBody, signature,
}) {
  if (!installationId) throw new Error('installationId is required');
  if (!deliveryId) throw new Error('deliveryId is required');
  const sequence = Number(seq);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('invalid sequence');
  if (typeof event !== 'string' || !event) throw new Error('event is required');
  if (typeof rawBody !== 'string') throw new Error('rawBody is required');
  if (!verifySignature(deriveWebhookSecret(installationId), rawBody, signature)) {
    throw new Error('webhook_unauthorized');
  }
  const hash = bodyHashOf(rawBody);
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error('webhook_body_invalid');
  }
  return withTx(poolOrClient, async (executor) => {
    await executor.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`webhook:${installationId}`]);
    const installation = (await executor.query(
      `SELECT installation_id FROM github_installations WHERE installation_id = $1`, [installationId],
    )).rows[0];
    if (!installation) throw new Error('Installation not found');
    const prior = (await executor.query(
      `SELECT body_hash AS "bodyHash", outcome, state FROM forge_webhook_deliveries WHERE delivery_id = $1`,
      [deliveryId],
    )).rows[0];
    if (prior) {
      if (prior.bodyHash !== hash) throw new Error('webhook_delivery_conflict');
      return { duplicate: true, state: prior.state, outcome: prior.outcome };
    }
    const seqRow = (await executor.query(
      `SELECT 1 FROM forge_webhook_deliveries WHERE installation_id = $1 AND seq = $2`,
      [installationId, sequence],
    )).rows[0];
    if (seqRow) return { stale: true, seq: sequence };
    await executor.query(
      `INSERT INTO forge_webhook_sequences (installation_id, last_applied_seq) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
      [installationId],
    );
    const head = (await executor.query(
      `SELECT last_applied_seq AS "last" FROM forge_webhook_sequences WHERE installation_id = $1 FOR UPDATE`,
      [installationId],
    )).rows[0];
    const last = Number(head.last);
    if (sequence <= last) return { stale: true, seq: sequence };
    if (sequence > last + 1) {
      await executor.query(
        `INSERT INTO forge_webhook_deliveries (delivery_id, installation_id, seq, event, body_hash, body, outcome, state)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [deliveryId, installationId, sequence, event, hash, JSON.stringify(body),
          JSON.stringify({ held: true, gapFrom: last + 1, gapTo: sequence - 1 })],
      );
      return { held: true, seq: sequence, gapFrom: last + 1, gapTo: sequence - 1 };
    }
    const caughtUp = [];
    let next = sequence;
    let firstOutcome = null;
    for (;;) {
      const row = next === sequence
        ? { deliveryId, event, body }
        : (await executor.query(
          `SELECT delivery_id AS "deliveryId", event, body FROM forge_webhook_deliveries
            WHERE installation_id = $1 AND seq = $2 AND state = 'pending'`,
          [installationId, next],
        )).rows[0];
      if (!row) break;
      const standing = await applyStanding(executor, installationId, row.event);
      const outcome = { applied: true, seq: next, event: row.event, ...(standing ?? {}) };
      if (next === sequence) {
        await executor.query(
          `INSERT INTO forge_webhook_deliveries (delivery_id, installation_id, seq, event, body_hash, body, outcome, state)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied')`,
          [row.deliveryId, installationId, next, row.event, bodyHashOf(JSON.stringify(row.body)),
            JSON.stringify(row.body), JSON.stringify(outcome)],
        );
        firstOutcome = outcome;
      } else {
        await executor.query(
          `UPDATE forge_webhook_deliveries SET outcome = $2, state = 'applied' WHERE delivery_id = $1`,
          [row.deliveryId, JSON.stringify(outcome)],
        );
        caughtUp.push(next);
      }
      await executor.query(
        `UPDATE forge_webhook_sequences SET last_applied_seq = $2, updated_at = now() WHERE installation_id = $1`,
        [installationId, next],
      );
      next += 1;
    }
    return { applied: true, outcome: firstOutcome, caughtUp };
  });
}

export async function readWebhookDeliveries(poolOrClient, installationId) {
  const { rows } = await poolOrClient.query(
    `SELECT delivery_id AS "deliveryId", seq, event, state, outcome
       FROM forge_webhook_deliveries WHERE installation_id = $1 ORDER BY seq, delivery_id`,
    [installationId],
  );
  return rows.map((r) => ({ ...r, seq: Number(r.seq) }));
}

// Outbound operations carry a stable external reference from birth.
// An ambiguous response — timeout, reset, 5xx — resolves by looking
// the reference up, never by firing the operation twice.
export async function beginOutboundOp(poolOrClient, { externalRef, installationId, op }) {
  if (!externalRef) throw new Error('externalRef is required');
  if (!op) throw new Error('op is required');
  return withTx(poolOrClient, async (executor) => {
    const { rows } = await executor.query(
      `INSERT INTO forge_outbound_ops (external_ref, installation_id, op, status)
        VALUES ($1, $2, $3, 'unknown')
        ON CONFLICT (external_ref) DO NOTHING RETURNING *`,
      [externalRef, installationId, op],
    );
    if (rows.length > 0) return rows[0];
    return (await executor.query(
      `SELECT * FROM forge_outbound_ops WHERE external_ref = $1`, [externalRef],
    )).rows[0];
  });
}

export async function resolveOutboundOp(poolOrClient, { externalRef, status, result = {} }) {
  if (!['confirmed', 'failed'].includes(status)) throw new Error('Unknown resolution');
  const { rows } = await poolOrClient.query(
    `UPDATE forge_outbound_ops SET status = $2, result = $3, updated_at = now()
      WHERE external_ref = $1 RETURNING *`,
    [externalRef, status, JSON.stringify(result)],
  );
  if (rows.length === 0) throw new Error('Operation not found');
  return rows[0];
}

export async function lookupOutboundOp(poolOrClient, externalRef) {
  const { rows } = await poolOrClient.query(
    `SELECT * FROM forge_outbound_ops WHERE external_ref = $1`, [externalRef],
  );
  if (rows.length === 0) throw new Error('Operation not found');
  return rows[0];
}

// Direct operator standing control. Suspension lifts; uninstall is
// terminal. Both cascade to bindings carrying the installation ref.
export async function setInstallationStanding(poolOrClient, { installationId, standing, actorUserId, projectId }) {
  if (!['active', 'suspended', 'uninstalled'].includes(standing)) throw new Error('Unknown standing');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('standing_not_authorized');
    }
    const installation = (await executor.query(
      `SELECT * FROM github_installations WHERE installation_id = $1 FOR UPDATE`, [installationId],
    )).rows[0];
    if (!installation) throw new Error('Installation not found');
    if (installation.uninstalled) throw new Error('uninstalled_terminal');
    if (standing === 'active') {
      await executor.query(
        `UPDATE github_installations SET suspended = FALSE WHERE installation_id = $1`, [installationId],
      );
      await executor.query(
        `UPDATE forge_bindings SET status = 'available', unavailable_reason = NULL
          WHERE installation_ref = $1 AND unavailable_reason = 'installation_suspended'`,
        [installationId],
      );
    } else if (standing === 'suspended') {
      await executor.query(
        `UPDATE github_installations SET suspended = TRUE WHERE installation_id = $1`, [installationId],
      );
      await executor.query(
        `UPDATE forge_bindings SET status = 'unavailable', unavailable_reason = 'installation_suspended'
          WHERE installation_ref = $1`,
        [installationId],
      );
    } else {
      await executor.query(
        `UPDATE github_installations SET suspended = TRUE, uninstalled = TRUE, uninstalled_at = now()
          WHERE installation_id = $1`,
        [installationId],
      );
      await executor.query(
        `UPDATE forge_bindings SET status = 'unavailable', unavailable_reason = 'installation_uninstalled'
          WHERE installation_ref = $1`,
        [installationId],
      );
    }
    return { installationId, standing };
  });
}

export async function revokeRepositoryAccess(poolOrClient, { installationId, repository, actorUserId, projectId }) {
  if (typeof repository !== 'string' || !repository.trim()) throw new Error('repository is required');
  return withTx(poolOrClient, async (executor) => {
    if (!(await isProjectAdmin(executor, projectId, actorUserId))) {
      throw new Error('revocation_not_authorized');
    }
    const installation = (await executor.query(
      `SELECT installation_id FROM github_installations WHERE installation_id = $1`, [installationId],
    )).rows[0];
    if (!installation) throw new Error('Installation not found');
    await executor.query(
      `INSERT INTO installation_repo_revocations (installation_id, repository) VALUES ($1, $2)
        ON CONFLICT DO NOTHING`,
      [installationId, repository.trim()],
    );
    return { installationId, repository: repository.trim(), revoked: true };
  });
}
