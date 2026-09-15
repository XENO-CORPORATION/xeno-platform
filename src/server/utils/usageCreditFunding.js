// Account lock must be held by the caller. Reserve specific lots rather than a
// Boolean promise: disabling overage cannot invalidate an already admitted request.
export async function allocateFunding(client, userId, amountMicro) {
  const { rows: prefs } = await client.query('SELECT enabled FROM usage_credit_preferences WHERE user_id=$1', [userId]);
  const enabled = prefs[0]?.enabled === true;
  const { rows: lots } = await client.query(`SELECT g.id,g.kind,g.expires_at,
      g.remaining_micro-COALESCE((SELECT SUM(f.reserved_micro) FROM credit_hold_funding f
        JOIN credit_holds h ON h.id=f.hold_row_id WHERE f.grant_id=g.id AND h.state='held'),0) AS available
    FROM credit_grants g WHERE g.user_id=$1 AND g.remaining_micro>0
      AND (g.expires_at IS NULL OR g.expires_at>now())
    ORDER BY g.priority,g.expires_at ASC NULLS LAST,g.created_at,g.id FOR UPDATE OF g`, [userId]);
  // Legacy reservations have no lot allocation. Conservatively withhold their
  // full amount from eligible lots until settled or expired, avoiding oversell.
  const { rows: legacy } = await client.query(`SELECT COALESCE(SUM(h.amount_micro-h.settled_micro),0) AS reserved
    FROM credit_holds h WHERE h.user_id=$1 AND h.state='held' AND h.expires_at>now()
    AND NOT EXISTS (SELECT 1 FROM credit_hold_funding f WHERE f.hold_row_id=h.id)`,[userId]);
  let unallocated = BigInt(legacy[0]?.reserved || 0);
  let need = BigInt(amountMicro);
  const funding = [];
  for (const lot of lots) {
    if (need <= 0n) break;
    if (!enabled && lot.kind !== 'allowance') continue;
    let available = BigInt(lot.available);
    if (available <= 0n) continue;
    const withheld = unallocated < available ? unallocated : available;
    available -= withheld; unallocated -= withheld;
    if (available <= 0n) continue;
    const take = available < need ? available : need;
    funding.push({ grantId: lot.id, amountMicro: String(take) });
    need -= take;
  }
  if (need > 0n) {
    const { windowFor } = await import('./quotaEngine.js');
    throw Object.assign(new Error(enabled ? 'Insufficient usage credits.' : 'Weekly limit reached. Turn on usage credits to keep working past your plan limit.'), {
      code: enabled ? 'INSUFFICIENT_CREDITS' : 'QUOTA_EXCEEDED', resetsAt: windowFor().endsAt.toISOString(), usageCreditsEnabled: enabled,
    });
  }
  return funding;
}

export async function saveHoldFunding(client, holdRowId, funding) {
  await client.query('DELETE FROM credit_hold_funding WHERE hold_row_id=$1', [holdRowId]);
  for (const [order, f] of funding.entries()) await client.query(
    'INSERT INTO credit_hold_funding (hold_row_id,grant_id,reserved_micro,draw_order) VALUES ($1,$2,$3,$4)',
    [holdRowId, f.grantId, f.amountMicro, order]);
}

export async function consumeFunding(client, funding, costMicro) {
  let remaining = BigInt(costMicro);
  for (const f of funding) {
    if (remaining <= 0n) break;
    const reserved = BigInt(f.amountMicro);
    const take = reserved < remaining ? reserved : remaining;
    const result = await client.query(`UPDATE credit_grants SET remaining_micro=remaining_micro-$1
      WHERE id=$2 AND remaining_micro >= $1 RETURNING id`, [String(take),f.grantId]);
    if (result.rows.length !== 1) throw Object.assign(new Error('Reserved grant funding is unavailable'), { code: 'FUNDING_CONFLICT' });
    remaining -= take;
  }
  if (remaining > 0n) throw Object.assign(new Error('Reservation does not cover settlement'), { code: 'FUNDING_CONFLICT' });
}

export async function readHoldFunding(client, holdRowId) {
  const { rows } = await client.query('SELECT grant_id,reserved_micro FROM credit_hold_funding WHERE hold_row_id=$1 ORDER BY draw_order', [holdRowId]);
  return rows.map(row => ({ grantId: row.grant_id, amountMicro: row.reserved_micro }));
}
