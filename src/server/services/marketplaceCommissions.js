// FUND-19: exact, partition-independent commission arithmetic.
//
// A stable billing item accrues cumulative eligible service micro-credits
// under one price version. Posted commission is ALWAYS
// floor(cumulative_gross_micro * 15 / 100); each event posts only the
// difference from what was posted before, so splitting events cannot change
// the total. Creator net is the remainder. Refunds reverse under the ORIGINAL
// price version (the posting row is keyed by item + version; a refund naming
// a version with no posting is refused, never repriced at today's rate).
// The floor residue -- hundredths of a micro carried forward -- is recorded
// on every event: the only rounding in the monetary contract, stored
// separately from fee and net.
//
// Concurrency: one pg_advisory_xact_lock per (item, version) serializes
// posters, so concurrent charges neither lose updates nor double-post.
// All arithmetic is BigInt in JS; the schema CHECK pins posted == floor.
//
// NOTE: this engine is proven standalone here. Wiring it into
// meterInvocation awaits the marketplace micro-credit migration (the legacy
// per-event path prices integer credits and its credit_usage sink is missing
// -- pre-existing tech debt, tracked, not fixed in this change).
const FEE_NUMERATOR = 15n;
const FEE_DENOMINATOR = 100n;

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const key = (v, max, what) => {
  if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.includes('\0') || Buffer.byteLength(v) > max) bad('bad_input', `invalid_${what}`);
  return v;
};
const micro = (v, what) => {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,17}$/.test(v)) bad('bad_input', `invalid_${what}`);
  return BigInt(v);
};

const floorFee = (cumulative) => (cumulative * FEE_NUMERATOR) / FEE_DENOMINATOR;
const residueOf = (cumulative) => Number((cumulative * FEE_NUMERATOR) % FEE_DENOMINATOR);

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function') {
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

/** Post one charge event: cumulative floor minus previously posted. */
export async function postCommissionTx(client, { billingItemKey, priceVersion, grossMicro }) {
  const item = key(billingItemKey, 200, 'billing_item');
  const version = key(priceVersion, 128, 'price_version');
  const gross = micro(grossMicro, 'gross');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`commission:${item}:${version}`]);
  let posting = (await client.query(
    'SELECT cumulative_gross_micro, posted_fee_micro FROM marketplace_commission_postings WHERE billing_item_key=$1 AND price_version=$2 FOR UPDATE',
    [item, version],
  )).rows[0];
  if (!posting) {
    await client.query(
      'INSERT INTO marketplace_commission_postings(billing_item_key,price_version,cumulative_gross_micro,posted_fee_micro) VALUES($1,$2,0,0)',
      [item, version],
    );
    posting = { cumulative_gross_micro: '0', posted_fee_micro: '0' };
  }
  const cumulative = BigInt(posting.cumulative_gross_micro) + gross;
  const feeTotal = floorFee(cumulative);
  const feeDelta = feeTotal - BigInt(posting.posted_fee_micro);
  const creatorDelta = gross - feeDelta;
  const residue = residueOf(cumulative);
  await client.query(
    'UPDATE marketplace_commission_postings SET cumulative_gross_micro=$3, posted_fee_micro=$4, updated_at=now() WHERE billing_item_key=$1 AND price_version=$2',
    [item, version, String(cumulative), String(feeTotal)],
  );
  await client.query(
    `INSERT INTO marketplace_commission_events(billing_item_key,price_version,event_kind,gross_micro,fee_delta_micro,creator_delta_micro,cumulative_after_micro,residue_after)
     VALUES($1,$2,'charge',$3,$4,$5,$6,$7)`,
    [item, version, String(gross), String(feeDelta), String(creatorDelta), String(cumulative), residue],
  );
  return { feeDeltaMicro: String(feeDelta), creatorDeltaMicro: String(creatorDelta), cumulativeGrossMicro: String(cumulative), postedFeeMicro: String(feeTotal), residueAfter: residue };
}

export async function postCommission(poolOrClient, input) {
  return withTx(poolOrClient, (client) => postCommissionTx(client, input));
}

/** Reverse one refund event under the ORIGINAL price version. */
export async function reverseCommissionTx(client, { billingItemKey, priceVersion, refundMicro }) {
  const item = key(billingItemKey, 200, 'billing_item');
  const version = key(priceVersion, 128, 'price_version');
  const refund = micro(refundMicro, 'refund');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`commission:${item}:${version}`]);
  const posting = (await client.query(
    'SELECT cumulative_gross_micro, posted_fee_micro FROM marketplace_commission_postings WHERE billing_item_key=$1 AND price_version=$2 FOR UPDATE',
    [item, version],
  )).rows[0];
  if (!posting) bad('not_found', 'commission_original_version_required');
  const cumulative = BigInt(posting.cumulative_gross_micro) - refund;
  if (cumulative < 0n) bad('conflict', 'commission_over_refund');
  const feeTotal = floorFee(cumulative);
  const feeReversal = BigInt(posting.posted_fee_micro) - feeTotal;
  const creatorRestore = refund - feeReversal;
  const residue = residueOf(cumulative);
  await client.query(
    'UPDATE marketplace_commission_postings SET cumulative_gross_micro=$3, posted_fee_micro=$4, updated_at=now() WHERE billing_item_key=$1 AND price_version=$2',
    [item, version, String(cumulative), String(feeTotal)],
  );
  await client.query(
    `INSERT INTO marketplace_commission_events(billing_item_key,price_version,event_kind,gross_micro,fee_delta_micro,creator_delta_micro,cumulative_after_micro,residue_after)
     VALUES($1,$2,'refund',$3,$4,$5,$6,$7)`,
    [item, version, String(refund), String(feeReversal), String(creatorRestore), String(cumulative), residue],
  );
  return { feeReversalMicro: String(feeReversal), creatorRestoreMicro: String(creatorRestore), cumulativeGrossMicro: String(cumulative), postedFeeMicro: String(feeTotal), residueAfter: residue };
}

export async function reverseCommission(poolOrClient, input) {
  return withTx(poolOrClient, (client) => reverseCommissionTx(client, input));
}
