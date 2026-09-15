import { resolvePrincipal, assertPrincipalUsable, billingSubjectFor } from './agentIdentity.js';
import { getEffectivePlan } from './effectivePlan.js';
import { ensureQuota, readQuota } from './quotaService.js';

export async function prepareAccountQuota(pool, actorId) {
  const subject = await billingSubjectFor(pool, actorId);
  const { plan } = await getEffectivePlan(pool, subject.userId);
  await ensureQuota(pool, subject.userId, plan);
  return subject;
}

export async function accountQuotaView(pool, actorId) {
  const principal = await resolvePrincipal(pool, actorId);
  assertPrincipalUsable(principal);
  const ownerId = principal.kind === 'agent' ? principal.owner.id : principal.id;
  const { plan } = await getEffectivePlan(pool, ownerId);
  const q = await readQuota(pool, ownerId, plan);
  const { rows } = await pool.query(`SELECT COALESCE((SELECT enabled FROM usage_credit_preferences WHERE user_id=$1),false) AS enabled,
    COALESCE((SELECT SUM(remaining_micro) FROM credit_grants WHERE user_id=$1 AND kind <> 'allowance'
      AND remaining_micro>0 AND (expires_at IS NULL OR expires_at>now())),0)::text AS credits`, [ownerId]);
  return { metered:q.metered,plan:q.plan,usedPercent:q.usedPercent,resetsAt:q.resetsAt,exhausted:q.exhausted,
    topUpAvailable:q.exhausted,hasPurchasedCredits:Number(rows[0].credits)>0,
    usageCreditsEnabled:rows[0].enabled,usageCreditsBalance:Number(rows[0].credits)/1_000_000,
    canManageUsageCredits:principal.kind === 'human' };
}

export async function updateUsageCredits(pool, actorId, enabled) {
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('enabled must be a boolean'),{code:'BAD_REQUEST'});
  const principal = await resolvePrincipal(pool,actorId);
  assertPrincipalUsable(principal);
  if (principal.kind !== 'human') throw Object.assign(new Error('Only the human account owner can change usage-credit consent'),{code:'FORBIDDEN'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize setting changes with admissions. Settlement uses reserved lots,
    // never today's setting, so turning OFF cannot erase already-consented work.
    await client.query('SELECT id FROM credit_accounts WHERE user_id=$1 FOR UPDATE',[principal.id]);
    await client.query(`INSERT INTO usage_credit_preferences (user_id,enabled) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,[principal.id,enabled]);
    await client.query('INSERT INTO usage_credit_consent_events (user_id,enabled) VALUES ($1,$2)',[principal.id,enabled]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  return accountQuotaView(pool,actorId);
}
