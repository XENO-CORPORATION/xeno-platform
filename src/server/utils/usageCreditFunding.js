/** Quarantine is per origin, never a freeze of unrelated contributors' money.
 * Before the additive funding migration there are no contributed origins to quarantine. */
export async function quarantinedGrantIds(client, userId) {
  const present=(await client.query("SELECT to_regclass('workforce_funding_origin_quarantine') AS relation")).rows[0]?.relation;
  if(!present)return [];
  return (await client.query(`SELECT q.grant_id FROM workforce_funding_origin_quarantine q
    JOIN credit_grants g ON g.id=q.grant_id WHERE g.user_id=$1
    UNION SELECT l.pool_grant_id AS grant_id FROM workforce_contribution_lots l
    JOIN workforce_funding_origin_quarantine q ON q.grant_id=l.origin_grant_id
    JOIN credit_grants g ON g.id=l.pool_grant_id WHERE g.user_id=$1`,[userId])).rows.map(r=>r.grant_id);
}

// Account lock must be held by the caller. Reserve specific lots rather than a
// Boolean promise: disabling overage cannot invalidate an already admitted request.
export async function allocateFunding(client, userId, amountMicro) {
  const { rows: prefs } = await client.query('SELECT enabled FROM usage_credit_preferences WHERE user_id=$1', [userId]);
  const enabled = prefs[0]?.enabled === true;
  const quarantined = new Set(await quarantinedGrantIds(client, userId));
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
    if (quarantined.has(lot.id) || (!enabled && lot.kind !== 'allowance')) continue;
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

/** Select transferable paid value on the caller's transaction, never from kind alone.
 * Lock order matches Stripe reversals: charge rows first, then the canonical account,
 * then its consent and lots. Returned allocations grant no authority outside this transaction.
 * A partial refund conservatively quarantines that origin until reconciliation; another
 * unrelated paid origin remains eligible. Unknown/legacy holds remain committed here. */
export async function allocateContributionFunding(client, userId, amountMicro, { destinationOwnerId = null } = {}) {
  if (typeof amountMicro !== 'string' || !/^[1-9][0-9]{0,17}$/.test(amountMicro)) {
    throw Object.assign(new Error('Contribution amount must be exact positive micro-credits'), { code: 'INVALID_CONTRIBUTION_AMOUNT' });
  }
  // Billing creates these two evidence tables on first provider use. An installation
  // with no payment history has no eligible origin, not an SQL execution failure.
  const evidence=(await client.query("SELECT to_regclass('billing_charges') AS charges,to_regclass('billing_account_binding') AS binding")).rows[0];
  if(!evidence?.charges || !evidence.binding) {
    throw Object.assign(new Error('No verified payment history is available'),{code:'INSUFFICIENT_CONTRIBUTABLE_CREDITS'});
  }
  // Only origins issued under THIS database's provider account/mode are candidates.
  const charges = (await client.query(`SELECT c.payment_intent FROM billing_charges c
    JOIN credit_grant_payment_origins o ON o.payment_intent=c.payment_intent
    JOIN credit_grants g ON g.id=o.grant_id
    JOIN billing_account_binding b ON b.singleton=true AND b.account_id=o.provider_account AND b.mode=o.provider_mode
    WHERE g.user_id=$1 AND c.user_id=$1::text
    ORDER BY c.payment_intent FOR UPDATE OF c`, [userId])).rows.map(r => r.payment_intent);
  const hasQuarantine=(await client.query("SELECT to_regclass('workforce_funding_origin_quarantine') AS relation")).rows[0]?.relation;
  const quarantined=hasQuarantine ? (await client.query('SELECT DISTINCT grant_id FROM workforce_funding_origin_quarantine')).rows.map(r=>r.grant_id) : [];
  // Contributions lock both endpoints in one stable order; a counter-transfer cannot
  // take the same pair backwards. No account is manufactured during value movement.
  const owners = destinationOwnerId ? [userId, destinationOwnerId].sort() : [userId];
  const accounts = (await client.query('SELECT id,user_id,balance,is_frozen,owner_kind FROM credit_accounts WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [owners])).rows;
  const account = accounts.find(a => a.user_id === userId);
  const destination = destinationOwnerId ? accounts.find(a => a.user_id === destinationOwnerId) : null;
  if (destinationOwnerId && (!destination || destination.owner_kind !== 'project_pool' || destination.is_frozen)) {
    throw Object.assign(new Error('Contribution destination unavailable'), { code: 'CONTRIBUTION_DESTINATION_UNAVAILABLE' });
  }
  if (!account || account.owner_kind !== 'user' || account.is_frozen) {
    throw Object.assign(new Error('Contribution account unavailable'), { code: 'CONTRIBUTION_ACCOUNT_UNAVAILABLE' });
  }
  const consent = (await client.query('SELECT enabled FROM usage_credit_preferences WHERE user_id=$1 FOR SHARE', [userId])).rows[0];
  if (consent?.enabled !== true) throw Object.assign(new Error('Usage-credit consent required'), { code: 'CONTRIBUTION_CONSENT_REQUIRED' });
  const { rows: lots } = await client.query(`SELECT g.id,g.priority,g.expires_at,o.grant_id AS origin_grant_id,
      g.remaining_micro-COALESCE((SELECT SUM(f.reserved_micro) FROM credit_hold_funding f
        JOIN credit_holds h ON h.id=f.hold_row_id WHERE f.grant_id=g.id AND h.state='held'),0) AS available
    FROM credit_grants g JOIN credit_grant_payment_origins o ON o.grant_id=g.id
    JOIN billing_charges c ON c.payment_intent=o.payment_intent AND c.user_id=g.user_id::text
    WHERE g.user_id=$1 AND g.account_id=$2 AND g.kind='paid' AND g.amount_micro=o.amount_micro
      AND g.source_ref='stripe:checkout:' || o.checkout_session
      AND c.payment_intent=ANY($3::text[]) AND c.refunded_micro=0 AND c.credits_micro=o.amount_micro
      AND NOT (g.id=ANY($4::uuid[]))
      AND g.remaining_micro>0 AND (g.expires_at IS NULL OR g.expires_at>now())
    ORDER BY g.priority,g.expires_at ASC NULLS LAST,g.created_at,g.id FOR UPDATE OF g`, [userId, account.id, charges, quarantined]);
  const legacy = (await client.query(`SELECT COALESCE(SUM(h.amount_micro-h.settled_micro),0) AS reserved
    FROM credit_holds h WHERE h.user_id=$1 AND h.state='held'
      AND NOT EXISTS (SELECT 1 FROM credit_hold_funding f WHERE f.hold_row_id=h.id)`, [userId])).rows[0];
  let withheld = BigInt(legacy.reserved), need = BigInt(amountMicro);
  const allocations = [];
  for (const lot of lots) {
    if (need === 0n) break;
    let available = BigInt(lot.available);
    if (available <= 0n) continue;
    const reserved = withheld < available ? withheld : available;
    available -= reserved; withheld -= reserved;
    if (available <= 0n) continue;
    const take = available < need ? available : need;
    allocations.push({ grantId: lot.id, originGrantId: lot.origin_grant_id, amountMicro: String(take), priority: lot.priority });
    need -= take;
  }
  if (need > 0n || BigInt(account.balance) < BigInt(amountMicro)) {
    throw Object.assign(new Error('Insufficient verified uncommitted paid value'), { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' });
  }
  // Expiry is deliberately not round-tripped through JS Date. The eventual INSERT
  // copies expires_at from the locked origin row in SQL, preserving microseconds.
  return { accountId: account.id, amountMicro, allocations };
}

/** Select giftable verified value on the caller's transaction. Mirrors the contribution
 * allocator's lock order (charges, both endpoints sorted, lots) and its verified-origin rule,
 * with two deliberate differences: the destination is an ordinary user account, and gift lots
 * from earlier hops are eligible when their recorded stripe root is still verified, unrefunded
 * and unquarantined. A hand-forged 'gift:%' label with no gift row behind it selects nothing.
 * Per-gift explicit confirmation replaces the standing usage-credit preference. */
export async function allocateGiftFunding(client, senderId, amountMicro, { destinationOwnerId } = {}) {
  if (typeof amountMicro !== 'string' || !/^[1-9][0-9]{0,17}$/.test(amountMicro)) {
    throw Object.assign(new Error('Gift amount must be exact positive micro-credits'), { code: 'INVALID_GIFT_AMOUNT' });
  }
  if (typeof destinationOwnerId !== 'string' || !destinationOwnerId) {
    throw Object.assign(new Error('Gift destination unavailable'), { code: 'GIFT_DESTINATION_UNAVAILABLE' });
  }
  const evidence=(await client.query("SELECT to_regclass('billing_charges') AS charges,to_regclass('billing_account_binding') AS binding")).rows[0];
  if(!evidence?.charges || !evidence.binding) {
    throw Object.assign(new Error('No verified payment history is available'),{code:'INSUFFICIENT_GIFTABLE_CREDITS'});
  }
  const hasGiftLots=((await client.query("SELECT to_regclass('workforce_gift_lots') AS relation")).rows[0]?.relation) ?? null;
  // One ordered lock over the sender's own charges AND the stripe roots of their gift lots:
  // two gifts racing opposite directions take the same order, so no deadlock.
  const charges = (await client.query(`SELECT c.payment_intent FROM billing_charges c
    WHERE c.payment_intent IN (
      SELECT cc.payment_intent FROM billing_charges cc
      JOIN credit_grant_payment_origins o ON o.payment_intent=cc.payment_intent
      JOIN credit_grants g ON g.id=o.grant_id
      JOIN billing_account_binding b ON b.singleton=true AND b.account_id=o.provider_account AND b.mode=o.provider_mode
      WHERE g.user_id=$1 AND cc.user_id=$1::text
      ${hasGiftLots ? `UNION SELECT cc.payment_intent FROM credit_grants g
      JOIN workforce_gift_lots gl ON gl.recipient_grant_id=g.id
      JOIN credit_grant_payment_origins o ON o.grant_id=gl.root_origin_grant_id
      JOIN billing_charges cc ON cc.payment_intent=o.payment_intent
      JOIN billing_account_binding b ON b.singleton=true AND b.account_id=o.provider_account AND b.mode=o.provider_mode
      WHERE g.user_id=$1 AND g.kind='paid' AND g.source_ref LIKE 'gift:%'` : ``}
    ) ORDER BY c.payment_intent FOR UPDATE OF c`, [senderId])).rows.map(r => r.payment_intent);
  const hasQuarantine=(await client.query("SELECT to_regclass('workforce_funding_origin_quarantine') AS relation")).rows[0]?.relation;
  const quarantined=hasQuarantine ? (await client.query('SELECT DISTINCT grant_id FROM workforce_funding_origin_quarantine')).rows.map(r=>r.grant_id) : [];
  const owners = [senderId, destinationOwnerId].sort();
  const accounts = (await client.query('SELECT id,user_id,balance,is_frozen,owner_kind FROM credit_accounts WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [owners])).rows;
  const account = accounts.find(a => a.user_id === senderId);
  const destination = accounts.find(a => a.user_id === destinationOwnerId);
  if (!destination || destination.owner_kind !== 'user' || destination.is_frozen) {
    throw Object.assign(new Error('Gift destination unavailable'), { code: 'GIFT_DESTINATION_UNAVAILABLE' });
  }
  if (!account || account.owner_kind !== 'user' || account.is_frozen) {
    throw Object.assign(new Error('Gift account unavailable'), { code: 'GIFT_ACCOUNT_UNAVAILABLE' });
  }
  const { rows: lots } = await client.query(`SELECT g.id,g.priority,g.expires_at,g.source_ref,
      gl.root_origin_grant_id AS root_origin_grant_id,
      g.remaining_micro-COALESCE((SELECT SUM(f.reserved_micro) FROM credit_hold_funding f
        JOIN credit_holds h ON h.id=f.hold_row_id WHERE f.grant_id=g.id AND h.state='held'),0) AS available
    FROM credit_grants g
    LEFT JOIN workforce_gift_lots gl ON gl.recipient_grant_id=g.id
    LEFT JOIN credit_grant_payment_origins o ON o.grant_id=COALESCE(gl.root_origin_grant_id,g.id)
    LEFT JOIN billing_charges c ON c.payment_intent=o.payment_intent
    LEFT JOIN billing_account_binding b ON b.singleton=true AND b.account_id=o.provider_account AND b.mode=o.provider_mode
    WHERE g.user_id=$1 AND g.account_id=$2 AND g.kind='paid'
      AND g.remaining_micro>0 AND (g.expires_at IS NULL OR g.expires_at>now())
      AND c.payment_intent=ANY($3::text[]) AND c.refunded_micro=0 AND b.account_id IS NOT NULL
      AND NOT (COALESCE(gl.root_origin_grant_id,g.id)=ANY($4::uuid[]))
      AND ((g.source_ref LIKE 'stripe:checkout:%' AND o.grant_id=g.id AND g.amount_micro=o.amount_micro
          AND g.source_ref='stripe:checkout:' || o.checkout_session AND c.credits_micro=o.amount_micro)
        OR (g.source_ref LIKE 'gift:%' AND gl.recipient_grant_id IS NOT NULL))
    ORDER BY g.priority,g.expires_at ASC NULLS LAST,g.created_at,g.id FOR UPDATE OF g`,
    [senderId, account.id, charges, quarantined.length ? quarantined : ['00000000-0000-0000-0000-000000000000']]);
  const legacy = (await client.query(`SELECT COALESCE(SUM(h.amount_micro-h.settled_micro),0) AS reserved
    FROM credit_holds h WHERE h.user_id=$1 AND h.state='held'
      AND NOT EXISTS (SELECT 1 FROM credit_hold_funding f WHERE f.hold_row_id=h.id)`, [senderId])).rows[0];
  let withheld = BigInt(legacy.reserved), need = BigInt(amountMicro);
  const allocations = [];
  for (const lot of lots) {
    if (need === 0n) break;
    let available = BigInt(lot.available);
    if (available <= 0n) continue;
    const reserved = withheld < available ? withheld : available;
    available -= reserved; withheld -= reserved;
    if (available <= 0n) continue;
    const take = available < need ? available : need;
    allocations.push({ grantId: lot.id, rootOriginGrantId: lot.root_origin_grant_id ?? lot.id,
      amountMicro: String(take), expiresAt: lot.expires_at, priority: lot.priority });
    need -= take;
  }
  if (need > 0n || BigInt(account.balance) < BigInt(amountMicro)) {
    throw Object.assign(new Error('Insufficient verified uncommitted giftable value'), { code: 'INSUFFICIENT_GIFTABLE_CREDITS' });
  }
  return { accountId: account.id, destinationAccountId: destination.id, amountMicro, allocations };
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
