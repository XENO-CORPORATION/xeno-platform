/**
 * XENO Places City — leases, facades and sponsorship (Xenopolis handoff `Places City`; geometry = src/city/layout.js,
 * ported 1:1 below so the server's lease rules and the renderer draw the same lots).
 *
 * Anti-Metaverse Law, as adopted: land is LEASED MONTHLY, never sold or resold. Sponsor slots are few per district
 * (Commons 0, Civic plaza never), reviewed by a city steward, always labelled "Sponsored", never shown to minors.
 *
 * Money: every charge is the existing credits ledger (deductCredits → recordUsageV2, idempotent on a transaction id
 * derived from the Places requestId; refunds via refundCredits → reverseUsage). The payer is the person who acts.
 * SALES_OPEN gates Stripe checkout only; spending credits already held is not a sale (middleware/salesGate.js).
 * Minors: the platform holds no age signal yet, so sponsored copy is shown only to an account whose own settings
 * say `account.adult === true` — fail-closed: nobody else sees it.
 */
import { deductCredits, refundCredits } from '../utils/creditTransactions.js';
import { getBalanceV2 } from '../utils/creditLedgerV2.js';

// ── layout.js, 1:1 (metres) ─────────────────────────────────────────────────────────────────────────────────────
export const LOT_W = 30, LOT_D = 24, ALLEY = 4, MID = 6, AVENUE = 26, COLS = 4, ROWS = 2, FLOOR_H = 4.2;
export const BLOCK_W = COLS * LOT_W + (COLS - 1) * ALLEY, BLOCK_D = ROWS * LOT_D + MID;
export const DISTRICTS = Object.freeze([
  { id: 'studio', name: 'Studio quarter', apps: 'Pixel · Motion', gx: 0, gz: 0, priceCr: 10, maxFloors: 8, slots: 2 },
  { id: 'conservatory', name: 'Conservatory', apps: 'Sound', gx: 1, gz: 0, priceCr: 8, maxFloors: 6, slots: 1 },
  { id: 'press', name: 'Press', apps: 'Docs · Post', gx: 2, gz: 0, priceCr: 8, maxFloors: 8, slots: 2 },
  { id: 'workshop', name: 'Workshop', apps: 'Engine · Form · Dev', gx: 0, gz: 1, priceCr: 9, maxFloors: 10, slots: 2 },
  { id: 'market', name: 'Market', apps: 'Marketplace', gx: 1, gz: 1, priceCr: 12, maxFloors: 10, slots: 3 },
  { id: 'commons', name: 'Commons', apps: 'Personal places', gx: 2, gz: 1, priceCr: 3, maxFloors: 4, slots: 0 },
]);
export const CIVIC = Object.freeze({ name: 'Civic plaza', text: 'The Forum hall. Owned by the city, never leased.' });
const SPAN_X = 3 * BLOCK_W + 2 * AVENUE, SPAN_Z = 2 * BLOCK_D + 2 * AVENUE + 30;
export const CITY = Object.freeze({ w: SPAN_X, d: SPAN_Z });
export function districtOrigin(d) { return { x0: -SPAN_X / 2 + d.gx * (BLOCK_W + AVENUE), z0: -SPAN_Z / 2 + d.gz * (BLOCK_D + AVENUE + 30) }; }
export const plaza = () => ({ x: 0, z: -SPAN_Z / 2 + BLOCK_D + AVENUE / 2 + 15, w: SPAN_X - 40, d: AVENUE + 30 - 8 });
export const LOTS = Object.freeze(DISTRICTS.flatMap((d) => {
  const { x0, z0 } = districtOrigin(d), out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    out.push({ id: `${d.id}-${r}${c}`, district: d.id, row: r, col: c, x: x0 + c * (LOT_W + ALLEY) + LOT_W / 2, z: z0 + r * (LOT_D + MID) + LOT_D / 2, w: LOT_W, d: LOT_D, facing: r === 0 ? Math.PI : 0, corner: c === 0 || c === COLS - 1 });
  }
  return out;
}));
export const lotById = Object.fromEntries(LOTS.map((l) => [l.id, l]));
export const districtById = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));
export const lotPriceMicro = (l) => Math.round(districtById[l.district].priceCr * (l.corner ? 1.25 : 1) * 1e6);
export function adjacent(a, b) { const A = lotById[a], B = lotById[b]; return !!A && !!B && A.district === B.district && A.row === B.row && Math.abs(A.col - B.col) === 1; }
export function contiguous(ids) {
  const ls = ids.map((i) => lotById[i]); if (!ls.length || ls.some((x) => !x)) return false;
  if (new Set(ls.map((l) => `${l.district}:${l.row}`)).size !== 1) return false;
  const cs = ls.map((l) => l.col).sort((a, b) => a - b); return cs.every((c, i) => i === 0 || c === cs[i - 1] + 1);
}
export function footprint(ids, bays = 4) {
  const ls = ids.map((i) => lotById[i]).sort((a, b) => a.col - b.col);
  const first = ls[0], last = ls[ls.length - 1], span = (last.x + last.w / 2) - (first.x - first.w / 2);
  return { x: (first.x - first.w / 2 + last.x + last.w / 2) / 2, z: first.z, w: Math.min(span - 4, bays * 6 + 2), d: 16, facing: first.facing, span, maxBays: Math.floor((span - 4 - 2) / 6) };
}
export const SLOTS = Object.freeze(DISTRICTS.flatMap((d) => {
  const { x0, z0 } = districtOrigin(d), out = [];
  for (let i = 0; i < d.slots; i++) {
    const kind = d.id === 'market' && i === 2 ? 'blimp' : 'billboard';
    out.push({ id: `slot-${d.id}-${i}`, district: d.id, kind, x: x0 + (i === 0 ? -8 : BLOCK_W + 8), z: z0 + BLOCK_D / 2, y: kind === 'blimp' ? 70 : 0, priceCr: d.priceCr * (kind === 'blimp' ? 8 : 4) });
  }
  return out;
}));
export const CITY_IDS = Object.freeze(['meridian', 'halcyon', 'lindgren', 'harbor', 'nordhavn', 'sakura', 'lumen', 'vega', 'solace', 'atlas', 'aurum', 'southgate', 'aurora']);
const DAY_MS = 864e5, MONTH_MS = 30 * DAY_MS;
const LOGO = (s) => String(s).replace(/[^\p{L}\p{N} &.'-]/gu, '').trim().slice(0, 18);

/** The ops, given the Places service's own helpers (so there is one access rule and one envelope). */
export function cityOps(h) {
  const { fail, loadPlace, accessFor, uuid, opUuid, STYLES } = h;
  const charge = async (pool, me, micro, txn, operation) => {
    let r;
    try { r = await deductCredits(pool, me.id, micro / 1e6, { transactionId: txn, surface: 'places', operation }); }
    catch (e) { if (e.code === 'QUOTA_EXCEEDED') fail('denied', 'usage_credits_off', 'Your plan’s allowance is used up. Turn on usage credits to pay with credits you bought.'); throw e; }
    if (!r.success) fail('denied', r.frozen ? 'account_frozen' : 'insufficient_credits', r.frozen ? 'Your credits are frozen.' : 'Not enough credits for this.');
  };
  const steward = async (db, me, cityId) => (await db.query('SELECT 1 FROM place_city_stewards WHERE city_id=$1 AND user_id=$2', [cityId, me.id])).rows.length > 0;
  const adult = async (db, me) => (await db.query(`SELECT (settings #>> '{account,adult}') = 'true' AS a FROM user_settings WHERE user_id=$1`, [me.id])).rows[0]?.a === true;
  const cityOf = (v) => { const c = String(v || ''); if (!CITY_IDS.includes(c)) fail('bad_input', 'city_unknown', 'That is not a XENO city.'); return c; };
  const rootFloors = async (db, workspaceId) => 1 + (await db.query(`SELECT count(*)::int n FROM workforce_divisions WHERE workspace_id=$1 AND lifecycle='active' AND parent_division_id IS NULL`, [workspaceId])).rows[0].n;
  const editable = async (db, me, p) => { const a = await accessFor(db, me, p); return !!a && a.permissions.includes('edit'); };
  const leaseOf = async (db, id, lock = false) => {
    const l = (await db.query(`SELECT * FROM place_city_leases WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [uuid(id, 'leaseId')])).rows[0];
    if (!l || l.state === 'ended') fail('not_found', 'lease_not_found', 'No such lease.');
    l.lotIds = (await db.query('SELECT lot_id FROM place_city_lease_lots WHERE lease_id=$1 AND released_at IS NULL ORDER BY lot_id', [l.id])).rows.map((r) => r.lot_id);
    return l;
  };
  const tenant = async (db, me, l) => { const p = await loadPlace(db, l.place_id); if (!(await editable(db, me, p))) fail('denied', 'not_tenant', 'Only the building’s owners and admins change its lease.'); return p; };
  const takeLots = async (c, cityId, leaseId, ids) => {
    try { for (const id of ids) await c.query('INSERT INTO place_city_lease_lots (lease_id, city_id, lot_id) VALUES ($1,$2,$3)', [leaseId, cityId, id]); }
    catch (e) { if (e.code === '23505') fail('conflict', 'lot_taken', 'Someone already leases that lot.'); throw e; }
  };

  const READS = {
    'city.get': async (db, me, i) => {
      const cityId = i.cityId ? cityOf(i.cityId)
        : (await db.query(`SELECT p.city_id FROM places p WHERE p.lifecycle='active' AND p.workspace_id::text IN (SELECT object_id FROM relationship_tuples WHERE object_type='workspace' AND subject_type='user' AND subject_id=$1) ORDER BY p.opened_at DESC NULLS LAST LIMIT 1`, [String(me.id)])).rows[0]?.city_id || 'meridian';
      const leases = (await db.query(`SELECT l.*, array_agg(x.lot_id ORDER BY x.lot_id) AS lot_ids FROM place_city_leases l JOIN place_city_lease_lots x ON x.lease_id=l.id AND x.released_at IS NULL
        WHERE l.city_id=$1 AND l.state <> 'ended' GROUP BY l.id`, [cityId])).rows;
      const byLot = {}, buildings = [];
      for (const l of leases) {
        let p; try { p = await loadPlace(db, l.place_id); } catch { continue; }
        const a = await accessFor(db, me, p), canEdit = !!a && a.permissions.includes('edit');
        const f = (await db.query('SELECT material, logo_text, lobby_open, revision FROM place_facades WHERE place_id=$1', [p.id])).rows[0];
        buildings.push({ leaseId: l.id, placeId: p.id, name: p.name, floors: await rootFloors(db, p.workspace_id), bays: p.bays,
          facade: f ? { material: f.material, logoText: f.logo_text, lobbyOpen: f.lobby_open, revision: Number(f.revision) } : { material: p.style, logoText: LOGO(p.name), lobbyOpen: false, revision: 0 },
          canOpen: !!a, canEdit, role: a ? a.role : 'none', mine: canEdit, lotIds: l.lot_ids, district: l.district, state: l.state,
          monthlyMicro: canEdit ? Number(l.monthly_micro) : null, paidThrough: canEdit ? l.paid_through : null, revision: Number(l.revision), fp: footprint(l.lot_ids, p.bays) });
        l.lot_ids.forEach((id) => { byLot[id] = l.id; });
      }
      const isSteward = await steward(db, me, cityId), grown = await adult(db, me);
      const bookings = (await db.query(`SELECT * FROM place_sponsor_bookings WHERE city_id=$1 AND state <> 'rejected' OR (city_id=$1 AND booked_by_user_id=$2) ORDER BY submitted_at DESC LIMIT 200`, [cityId, me.id])).rows;
      const liveOf = (s) => bookings.find((b) => b.slot_id === s && b.state === 'live' && new Date(b.ends_at) > new Date());
      const unplaced = [];
      for (const r of (await db.query(`SELECT p.id FROM places p WHERE p.city_id=$1 AND p.lifecycle='active' AND NOT EXISTS (SELECT 1 FROM place_city_leases l WHERE l.place_id=p.id AND l.state <> 'ended')
          AND p.workspace_id::text IN (SELECT object_id FROM relationship_tuples WHERE object_type='workspace' AND subject_type='user' AND subject_id=$2 AND relation IN ('owner','admin'))`, [cityId, String(me.id)])).rows) {
        const p = await loadPlace(db, r.id); if (await editable(db, me, p)) unplaced.push({ id: p.id, name: p.name, bays: p.bays, floors: await rootFloors(db, p.workspace_id) });
      }
      return {
        cityId, city: CITY, civic: CIVIC, plaza: plaza(), districts: DISTRICTS, steward: isSteward, buildings,
        lots: LOTS.map((l) => ({ ...l, leaseId: byLot[l.id] || null, priceMicro: lotPriceMicro(l) })),
        // sponsored copy: always labelled, and only for an account that has said it is an adult (no age signal = hidden)
        slots: SLOTS.map((s) => { const b = liveOf(s.id); return { ...s, priceMicro: s.priceCr * 1e6, label: 'Sponsored', live: b && grown ? { sponsor: b.sponsor, text: b.text, endsAt: b.ends_at } : null, occupied: !!b, pending: bookings.some((x) => x.slot_id === s.id && x.state === 'in_review') }; }),
        bookings: bookings.filter((b) => String(b.booked_by_user_id) === String(me.id) || (isSteward && b.state === 'in_review'))
          .map((b) => ({ id: b.id, slotId: b.slot_id, sponsor: b.sponsor, text: b.text, weeks: b.weeks, state: b.state, holdMicro: Number(b.hold_micro), submittedAt: b.submitted_at, startsAt: b.starts_at, endsAt: b.ends_at, reason: b.reason, mine: String(b.booked_by_user_id) === String(me.id) })),
        unplaced, balanceMicro: (await getBalanceV2(db, me.id)).availableMicro,
      };
    },
  };

  const WRITES = {
    'city.lease': async (c, me, i, pool) => {
      const ids = [...new Set(Array.isArray(i.lotIds) ? i.lotIds.map(String) : [])];
      if (!contiguous(ids)) fail('bad_input', 'lots_not_contiguous', 'Pick one lot, or neighbouring lots in the same row.');
      const p = await loadPlace(c, i.placeId, { lock: true });
      if (!(await editable(c, me, p)) || me.kind === 'agent') fail('denied', 'not_admin', 'Only owners and admins put a building in the city.');
      if ((await c.query(`SELECT 1 FROM place_city_leases WHERE place_id=$1 AND state <> 'ended'`, [p.id])).rows.length) fail('conflict', 'already_placed', `${p.name} already stands in the city. Expand or release its lease instead.`);
      const d = districtById[lotById[ids[0]].district], floors = await rootFloors(c, p.workspace_id);
      if (floors > d.maxFloors) fail('needs_approval', 'too_tall', `${d.name} allows ${d.maxFloors} floors. ${p.name} has ${floors}.`);
      if (p.bays > footprint(ids, p.bays).maxBays) fail('needs_approval', 'too_narrow', `${p.name} is ${p.bays} bays wide. Lease a neighbouring lot too.`);
      const monthly = ids.reduce((s, x) => s + lotPriceMicro(lotById[x]), 0);
      const l = (await c.query(`INSERT INTO place_city_leases (city_id, place_id, district, monthly_micro, payer_user_id, paid_through) VALUES ($1,$2,$3,$4,$5, now() + interval '30 days') RETURNING id`,
        [p.city_id, p.id, d.id, monthly, me.id])).rows[0];
      await takeLots(c, p.city_id, l.id, ids);
      await c.query(`INSERT INTO place_facades (place_id, material, logo_text, updated_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (place_id) DO NOTHING`, [p.id, p.style, LOGO(p.name), me.id]);
      await charge(pool, me, monthly, `places-lease:${opUuid(me, 'city.lease', i.requestId)}`, 'city.lease');   // last: a refusal rolls the lease back
      return { result: { leaseId: l.id, monthlyMicro: monthly, lotIds: ids }, revision: 1, summary: `${p.name} now stands in ${d.name}` };
    },
    'city.expand': async (c, me, i, pool) => {
      const l = await leaseOf(c, i.leaseId, true); const p = await tenant(c, me, l);
      if (i.expectedRevision == null || String(i.expectedRevision) !== String(l.revision)) fail('conflict', 'stale_revision', 'The lease changed. Look again.');
      const lot = String(i.lotId || '');
      if (!l.lotIds.some((x) => adjacent(x, lot))) fail('bad_input', 'not_adjacent', 'Expand into a lot right next to your building, in the same row.');
      await takeLots(c, l.city_id, l.id, [lot]);
      const add = lotPriceMicro(lotById[lot]);
      const r = (await c.query('UPDATE place_city_leases SET monthly_micro=monthly_micro+$2, revision=revision+1 WHERE id=$1 RETURNING monthly_micro, revision', [l.id, add])).rows[0];
      await charge(pool, me, add, `places-expand:${opUuid(me, 'city.expand', i.requestId)}`, 'city.expand');
      return { result: { leaseId: l.id, lotIds: [...l.lotIds, lot].sort(), monthlyMicro: Number(r.monthly_micro) }, revision: r.revision, summary: `${p.name}’s lease grows to ${l.lotIds.length + 1} lots` };
    },
    'city.release': async (c, me, i) => {
      const l = await leaseOf(c, i.leaseId, true); const p = await tenant(c, me, l);
      await c.query(`UPDATE place_city_leases SET state='ended', ended_at=now(), revision=revision+1 WHERE id=$1`, [l.id]);
      await c.query('UPDATE place_city_lease_lots SET released_at=now() WHERE lease_id=$1 AND released_at IS NULL', [l.id]);
      return { result: { leaseId: l.id }, revision: Number(l.revision) + 1, summary: `Released ${p.name}’s lease. The lots are back on the market.` };
    },
    // Close the month for every DUE lease (paid_through passed): charge its payer and extend 30 days; a failed charge
    // lapses an active lease and ends an already-lapsing one. Operator only. Each charge id is (lease, period), so a
    // rerun never charges a period twice.
    'city.bill': async (c, me, i, pool) => {
      if (me.role !== 'admin' || me.kind !== 'human') fail('denied', 'operator_only', 'Only a platform operator closes the month.');
      let charged = 0, lapsing = 0, ended = 0;
      for (const l of (await c.query(`SELECT * FROM place_city_leases WHERE state <> 'ended' AND paid_through <= now() ORDER BY paid_through FOR UPDATE SKIP LOCKED`)).rows) {
        const r = await deductCredits(pool, l.payer_user_id, Number(l.monthly_micro) / 1e6, { transactionId: `places-rent:${l.id}:${new Date(l.paid_through).getTime()}`, surface: 'places', operation: 'city.bill' });
        if (r.success) { await c.query(`UPDATE place_city_leases SET paid_through=paid_through + interval '30 days', state='active', revision=revision+1 WHERE id=$1`, [l.id]); charged += Number(l.monthly_micro); }
        else if (l.state === 'active') { await c.query(`UPDATE place_city_leases SET state='lapsing', revision=revision+1 WHERE id=$1`, [l.id]); lapsing++; }
        else { await c.query(`UPDATE place_city_leases SET state='ended', ended_at=now(), revision=revision+1 WHERE id=$1`, [l.id]); await c.query('UPDATE place_city_lease_lots SET released_at=now() WHERE lease_id=$1 AND released_at IS NULL', [l.id]); ended++; }
      }
      return { result: { chargedMicro: charged, lapsing, ended }, revision: null, summary: ended ? `${ended} lease(s) ended for non-payment` : lapsing ? `${lapsing} lease(s) lapsing` : `Month closed · ${(charged / 1e6).toFixed(2)} cr` };
    },
    'city.facade.set': async (c, me, i) => {
      const p = await loadPlace(c, i.placeId, { lock: true });
      if (!(await editable(c, me, p))) fail('denied', 'not_admin', 'Only owners and admins change the facade.');
      if (i.material != null && !STYLES.includes(i.material)) fail('bad_input', 'material_unknown', 'Unknown material.');
      const f = (await c.query('SELECT * FROM place_facades WHERE place_id=$1 FOR UPDATE', [p.id])).rows[0] || { material: p.style, logo_text: LOGO(p.name), lobby_open: false, revision: 0 };
      if (i.expectedRevision == null || String(i.expectedRevision) !== String(f.revision)) fail('conflict', 'stale_revision', 'Someone else changed this facade. Reload to see it.');
      const next = { material: i.material || f.material, logo: i.logoText != null ? LOGO(i.logoText) : f.logo_text, lobby: i.lobbyOpen != null ? !!i.lobbyOpen : f.lobby_open };
      const r = (await c.query(`INSERT INTO place_facades (place_id, material, logo_text, lobby_open, updated_by_user_id) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (place_id) DO UPDATE SET material=$2, logo_text=$3, lobby_open=$4, updated_by_user_id=$5, updated_at=now(), revision=place_facades.revision+1 RETURNING revision`, [p.id, next.material, next.logo, next.lobby, me.id])).rows[0];
      if (next.material !== p.style) await c.query('UPDATE places SET style=$2, revision=revision+1 WHERE id=$1', [p.id, next.material]);
      return { result: { placeId: p.id, facadeRevision: Number(r.revision) }, revision: r.revision, summary: `Facade saved · ${p.name}` };
    },
    'city.sponsor.book': async (c, me, i, pool) => {
      if (me.kind !== 'human') fail('denied', 'person_only', 'Only a person books sponsorship.');
      const cityId = cityOf(i.cityId), s = SLOTS.find((x) => x.id === i.slotId);
      if (!s) fail('not_found', 'slot_not_found', 'No such slot. Commons and the Civic plaza carry none.');
      const text = String(i.text || '').trim().slice(0, 40), sponsor = String(i.sponsor || '').trim().slice(0, 24);
      if (!text || !sponsor) fail('bad_input', 'text_required', 'Add the sponsor name and a line of copy.');
      const weeks = [1, 2, 4].includes(i.weeks) ? i.weeks : 1, cost = s.priceCr * 1e6 * weeks;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`places-slot:${cityId}:${s.id}`]);
      if ((await c.query(`SELECT 1 FROM place_sponsor_bookings WHERE city_id=$1 AND slot_id=$2 AND (state='in_review' OR (state='live' AND ends_at > now()))`, [cityId, s.id])).rows.length) fail('conflict', 'slot_busy', 'That slot is booked or waiting for review. Pick another.');
      const ref = `places-sponsor:${opUuid(me, 'city.sponsor.book', i.requestId)}`;
      const b = (await c.query(`INSERT INTO place_sponsor_bookings (city_id, slot_id, sponsor, text, weeks, hold_micro, charge_ref, booked_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [cityId, s.id, sponsor, text, weeks, cost, ref, me.id])).rows[0];
      await charge(pool, me, cost, ref, 'city.sponsor.book');
      return { result: { bookingId: b.id, state: 'in_review', holdMicro: cost }, revision: 1, summary: 'Sponsorship sent for review' };
    },
    'city.sponsor.review': async (c, me, i, pool) => {
      const b = (await c.query('SELECT * FROM place_sponsor_bookings WHERE id=$1 FOR UPDATE', [uuid(i.bookingId, 'bookingId')])).rows[0];
      if (!b || !(await steward(c, me, b.city_id))) fail('denied', 'not_steward', 'Only city stewards review sponsorships.');
      if (String(b.booked_by_user_id) === String(me.id)) fail('denied', 'own_booking', 'A steward never reviews their own booking.');
      if (b.state !== 'in_review') fail('conflict', 'not_pending', 'That booking is not waiting for review.');
      if (i.approve === true) {
        await c.query(`UPDATE place_sponsor_bookings SET state='live', reviewed_by_user_id=$2, starts_at=now(), ends_at=now() + ($3 || ' days')::interval WHERE id=$1`, [b.id, me.id, String(b.weeks * 7)]);
      } else {
        await c.query(`UPDATE place_sponsor_bookings SET state='rejected', reviewed_by_user_id=$2, reason=$3 WHERE id=$1`, [b.id, me.id, String(i.reason || 'Does not meet the sponsorship rules.').slice(0, 120)]);
        const r = await refundCredits(pool, b.booked_by_user_id, Number(b.hold_micro) / 1e6, { transactionId: b.charge_ref, operation: 'city.sponsor.review' });
        if (!r.success) fail('unavailable', 'refund_failed', 'The hold could not be released. Try again.');
      }
      return { result: { bookingId: b.id, state: i.approve === true ? 'live' : 'rejected' }, revision: 2, summary: i.approve === true ? `${b.sponsor} is live` : `Rejected ${b.sponsor}` };
    },
    'city.steward.set': async (c, me, i) => {
      if (me.role !== 'admin' || me.kind !== 'human') fail('denied', 'operator_only', 'Only a platform operator appoints stewards.');
      const cityId = cityOf(i.cityId), who = uuid(i.userId, 'userId');
      if (i.steward === false) await c.query('DELETE FROM place_city_stewards WHERE city_id=$1 AND user_id=$2', [cityId, who]);
      else await c.query('INSERT INTO place_city_stewards (city_id, user_id, granted_by_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [cityId, who, me.id]);
      return { result: { cityId, userId: who, steward: i.steward !== false }, revision: 1, summary: 'Steward updated' };
    },
  };
  return { READS, WRITES };
}
