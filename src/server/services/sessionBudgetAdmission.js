// RUN-09: direct provider TUI sessions that cannot enforce pooled-budget
// admission must not charge a project pool -- only managed sessions through
// an enforceable adapter may, and only against a pool of a project the actor
// holds. Personal/BYOK operation stays available under its own explicit
// policy acceptance. Funded-native parity is advertised per adapter, and an
// adapter claims it only once enforceable: the schema pins that order, so no
// implementation can advertise parity first and enforce later.
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

export const BYOK_POLICY_VERSION = 'byok-v1';

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

/** Register a session adapter. Enforceability is declared here, one way: there is no un-enforce. */
export async function registerSessionAdapter(poolOrClient, { name, enforceable }) {
  if (typeof name !== 'string' || !name.trim()) bad('bad_input', 'invalid_adapter');
  return withTx(poolOrClient, async (client) => {
    const row = (await client.query(
      `INSERT INTO provider_session_adapters(name,enforceable) VALUES($1,$2)
       ON CONFLICT (name) DO UPDATE SET enforceable = provider_session_adapters.enforceable OR $2
       RETURNING name, enforceable`,
      [name.trim(), enforceable === true],
    )).rows[0];
    return { name: row.name, enforceable: row.enforceable };
  });
}

/** Claim funded-native parity. Refused unless the adapter is already enforceable. */
export async function claimAdapterParity(poolOrClient, { name }) {
  if (typeof name !== 'string' || !name.trim()) bad('bad_input', 'invalid_adapter');
  return withTx(poolOrClient, async (client) => {
    const adapter = (await client.query(
      'SELECT name, enforceable FROM provider_session_adapters WHERE name=$1', [name.trim()])).rows[0];
    if (!adapter) bad('not_found', 'adapter_not_found');
    if (!adapter.enforceable) bad('conflict', 'parity_requires_enforceable');
    await client.query("UPDATE provider_session_adapters SET parity_claim='funded-native' WHERE name=$1", [name.trim()]);
    return { name: adapter.name, parity: 'funded-native' };
  });
}

export async function listParityAdapters(poolOrClient) {
  return withTx(poolOrClient, async (client) => {
    return (await client.query(
      "SELECT name FROM provider_session_adapters WHERE parity_claim='funded-native' ORDER BY name")).rows.map((r) => r.name);
  });
}

/** Record explicit BYOK policy acceptance. Personal charging requires it. */
export async function acceptByokPolicy(poolOrClient, { actorUserId }) {
  const actor = uuid(actorUserId, 'actor');
  return withTx(poolOrClient, async (client) => {
    await client.query(
      `INSERT INTO byok_policy_acceptances(user_id,policy_version) VALUES($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET policy_version=$2, accepted_at=now()`,
      [actor, BYOK_POLICY_VERSION],
    );
    return { userId: actor, policyVersion: BYOK_POLICY_VERSION };
  });
}

/**
 * Admit a session charge. Project pools: managed sessions through an
 * enforceable adapter, against a pool of a held project -- direct TUI
 * sessions never. Personal: BYOK acceptance, either session kind.
 */
export async function admitSessionCharge(poolOrClient, { actorUserId, sessionKind, adapterName, target, poolId, amountMicro }) {
  const actor = uuid(actorUserId, 'actor');
  if (sessionKind !== 'tui-direct' && sessionKind !== 'managed') bad('bad_input', 'invalid_session_kind');
  if (target !== 'project-pool' && target !== 'personal') bad('bad_input', 'invalid_target');
  if (!Number.isInteger(amountMicro) || amountMicro <= 0) bad('bad_input', 'invalid_amount');
  const adapter = adapterName == null ? null : String(adapterName);
  const pool = target === 'project-pool' ? uuid(poolId, 'pool') : null;
  return withTx(poolOrClient, async (client) => {
    if (target === 'personal') {
      const accepted = (await client.query(
        'SELECT user_id FROM byok_policy_acceptances WHERE user_id=$1', [actor])).rows[0];
      if (!accepted) bad('denied', 'byok_policy_required');
    } else {
      if (sessionKind !== 'managed') bad('denied', 'pool_charge_requires_enforceable_adapter');
      if (adapter === null) bad('denied', 'pool_charge_requires_enforceable_adapter');
      const row = (await client.query(
        'SELECT enforceable FROM provider_session_adapters WHERE name=$1', [adapter])).rows[0];
      if (!row || !row.enforceable) bad('denied', 'pool_charge_requires_enforceable_adapter');
      const binding = (await client.query(
        `SELECT c.project_id FROM workforce_funding_pools p
         JOIN workforce_funding_milestones m ON m.id=p.milestone_id
         JOIN workforce_funding_campaigns c ON c.id=m.campaign_id
         WHERE p.id=$1`, [pool],
      )).rows[0];
      if (!binding) bad('not_found', 'pool_not_found');
      if (!(await holdsProject(client, actor, binding.project_id))) bad('denied', 'pool_project_not_held');
    }
    const row = (await client.query(
      `INSERT INTO session_budget_charges(session_kind,adapter_name,target,pool_id,user_id,amount_micro)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [sessionKind, adapter, target, pool, actor, amountMicro],
    )).rows[0];
    return { chargeId: row.id, sessionKind, target, poolId: pool, userId: actor, amountMicro };
  });
}
