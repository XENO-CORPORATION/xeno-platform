// Unified account history (ACCT-08): one read across gifts, contributions, reservations,
// usage and returns, each row carrying its source's actual durable status -- never a
// client-computed mirror. Callers see only their own account.
import { resolvePrincipal } from './agentIdentity.js';
import { authorityTransaction } from './workspaceOperationReceipts.js';

export class HistoryError extends Error {
  constructor(code, reason) {
    super(reason); this.name = 'HistoryError'; this.code = code;
    this.status = { bad_input:400, denied:403, not_found:404, conflict:409, unavailable:503 }[code] ?? 500;
    this.details = { schemaVersion:1, reason };
  }
}
const fail = (code, reason) => { throw new HistoryError(code, reason); };

export async function readAccountHistory(pool, ctx, value) {
  const actor = ctx?.actorUserId, client = ctx?.clientId;
  if (typeof actor !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor)) fail('bad_input','invalid_actor');
  if (typeof client !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(client)) fail('bad_input','invalid_client');
  const limit = Number(value?.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail('bad_input','invalid_limit');
  return authorityTransaction(pool, async db => {
    const p = await resolvePrincipal(db, actor);
    if (!p?.usable || p.kind !== 'human') fail('denied','usable_human_required');
    // Optional proof: the caller names a lots floor and the read verifies it against
    // the actor's CONFIRMED contribution lots' live remainder -- never against a
    // client-supplied balance. A client ceiling can only cap below this number.
    if (value?.prove !== undefined) {
      const floor = value.prove?.lots;
      if (typeof floor !== 'string' || !/^[1-9][0-9]{0,17}$/.test(floor)) fail('bad_input','invalid_lots_floor');
      const lots = (await db.query(`
        SELECT coalesce(sum(g.remaining_micro),0)::text AS lots
        FROM workforce_contribution_lots l
        JOIN workforce_funding_contributions c ON c.id=l.contribution_id
          AND c.contributor_user_id=$1 AND c.state='confirmed'
        JOIN credit_grants g ON g.id=l.pool_grant_id`, [actor])).rows[0].lots;
      if (BigInt(lots) < BigInt(floor)) fail('denied','lots_below_floor');
    }
    const { rows } = await db.query(`
      SELECT * FROM (
        SELECT g.created_at AS at, 'gift' AS kind,
          CASE WHEN g.sender_user_id=$1 THEN 'out' ELSE 'in' END AS direction,
          g.amount_micro::text AS amount_micro, g.state AS status,
          CASE WHEN g.sender_user_id=$1 THEN ru.display_name ELSE su.display_name END AS counterparty,
          NULL AS model, NULL AS provider, r.kind AS detail
        FROM workforce_gifts g
        JOIN users su ON su.id=g.sender_user_id JOIN users ru ON ru.id=g.recipient_user_id
        LEFT JOIN workforce_gift_returns r ON r.return_gift_id=g.id
        WHERE g.sender_user_id=$1 OR g.recipient_user_id=$1
        UNION ALL
        SELECT c.created_at, 'contribution', 'out', c.amount_micro::text, c.state,
          m.title, NULL, NULL, NULL
        FROM workforce_funding_contributions c
        JOIN workforce_funding_milestones m ON m.id=c.milestone_id
        WHERE c.contributor_user_id=$1
        UNION ALL
        SELECT h.created_at, 'reservation', 'held', h.amount_micro::text, h.state,
          h.surface || ':' || h.operation, NULL, NULL, NULL
        FROM credit_holds h WHERE h.user_id=$1
        UNION ALL
        SELECT u.created_at, 'usage', 'out', u.actual_cost_micro::text, u.status,
          u.surface || ':' || u.operation, u.model, u.provider, NULL
        FROM api_usage_logs u WHERE u.user_id=$1
        UNION ALL
        SELECT r.created_at, 'return',
          CASE WHEN g.sender_user_id=$1 THEN 'in' ELSE 'out' END,
          r.amount_micro::text, r.kind,
          CASE WHEN g.sender_user_id=$1 THEN ru.display_name ELSE su.display_name END,
          NULL, NULL, r.reason
        FROM workforce_gift_returns r JOIN workforce_gifts g ON g.id=r.gift_id
        JOIN users su ON su.id=g.sender_user_id JOIN users ru ON ru.id=g.recipient_user_id
        WHERE g.sender_user_id=$1 OR g.recipient_user_id=$1
      ) h ORDER BY at DESC LIMIT $2`, [actor, limit]);
    return rows.map(r => ({ at:r.at.toISOString(), kind:r.kind, direction:r.direction,
      amountMicro:String(r.amount_micro), status:r.status, counterparty:r.counterparty,
      model:r.model, provider:r.provider, detail:r.detail }));
  });
}
