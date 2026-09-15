import test from 'node:test';
import assert from 'node:assert/strict';
import { recordUsageV2, settleHoldV2 } from '../src/server/utils/creditLedgerV2.js';

// Exercise the actual debit paths, not just the allowance's priority constant.
// The DB returns ordered rows; no later application sort may override that order.
function ledgerFixture(kinds, cost) {
  const lots = kinds.map((kind, i) => ({ id: `lot-${i}`, kind, remaining_micro: '100' }));
  let balance = BigInt(lots.length * 100);
  const writes = [];
  const hold = { id: 'h-row', hold_id: 'h-1', state: 'held', amount_micro: String(cost), settled_micro: '0', surface: 'test', operation: 'drawdown' };
  const query = async (raw, params = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.startsWith('SELECT enabled')) return { rows: [{enabled:true}] };
    if (sql.startsWith('SELECT grant_id')) return { rows: [] };
    if (sql.includes('AS reserved')) return { rows: [{reserved:'0'}] };
    if (sql.startsWith('SELECT g.id')) return { rows: lots.map(row=>({...row,available:row.remaining_micro})) };
    if (sql.startsWith('UPDATE credit_grants SET remaining_micro=')) {
      const lot=lots.find(row=>row.id===params[1]);
      lot.remaining_micro=String(BigInt(lot.remaining_micro)-BigInt(params[0])); writes.push(lot.id);return {rows:[{id:lot.id}]};
    }
    if (sql.startsWith('SELECT id, remaining_micro, kind FROM credit_grants')) {
      assert.match(sql, /ORDER BY priority ASC, expires_at ASC NULLS LAST, created_at ASC, id ASC FOR UPDATE$/);
      return { rows: lots.map(row => ({ ...row })) };
    }
    if (sql.startsWith('UPDATE credit_grants SET remaining_micro')) {
      const lot = lots.find(row => row.id === params[1]);
      lot.remaining_micro = String(BigInt(lot.remaining_micro) - BigInt(params[0]));
      writes.push(lot.id);
      return { rows: [] };
    }
    if (sql.startsWith('SELECT COALESCE(SUM(remaining_micro)')) return { rows: [{ s: String(lots.reduce((n, row) => n + BigInt(row.remaining_micro), 0n)) }] };
    if (sql.startsWith('SELECT id, balance, is_frozen') || sql.startsWith('SELECT balance, is_frozen')) return { rows: [{ id: 'acct', balance: String(balance), is_frozen: false }] };
    if (sql.startsWith('SELECT COALESCE(SUM(amount_micro - settled_micro)')) return { rows: [{ held: hold.state === 'held' ? String(cost) : '0' }] };
    if (sql.startsWith('SELECT * FROM credit_holds')) return { rows: [{ ...hold }] };
    if (sql.startsWith("UPDATE credit_holds SET state='settled'")) { hold.state = 'settled'; hold.settled_micro = params[0]; return { rows: [] }; }
    if (sql.startsWith('UPDATE credit_accounts SET balance')) { balance = BigInt(params[0]); return { rows: [] }; }
    if (sql.startsWith('SELECT 1 FROM credit_transactions') || sql.startsWith('SELECT entry_hash') || sql.startsWith('SELECT window_sec')) return { rows: [] };
    if (sql.startsWith('INSERT INTO credit_transactions') || sql.startsWith('INSERT INTO api_usage_logs') || sql.startsWith('UPDATE users SET credits')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { pool: { connect: async () => ({ query, release() {} }) }, lots, writes, balance: () => balance };
}

for (const path of ['settle', 'usage']) {
  const debit = async (f, cost) => path === 'settle'
    ? settleHoldV2(f.pool, 'user', 'h-1', cost)
    : recordUsageV2(f.pool, 'user', { transactionId: 't-1', surface: 'test', operation: 'drawdown', costMicro: cost });
  for (const { name, kinds, cost, expected } of [
    { name: 'allowance is consumed before promotional and purchased credits', kinds: ['allowance', 'promo', 'paid'], cost: 60, expected: ['40', '100', '100'] },
    { name: 'overflow consumes the allowance then only the required paid amount', kinds: ['allowance', 'paid'], cost: 150, expected: ['0', '50'] },
    { name: 'explicit priority wins over grant kind', kinds: ['paid', 'free'], cost: 60, expected: ['40', '100'] },
    { name: 'an unfamiliar kind retains its assigned priority', kinds: ['future-kind', 'paid'], cost: 60, expected: ['40', '100'] },
  ]) {
    test(`${path}: ${name}`, async () => {
      const f = ledgerFixture(kinds, cost);
      // Direct usage has no reservation. Keep its fixture's held total zero.
      if (path === 'usage') {
        const connect = f.pool.connect;
        f.pool.connect = async () => {
          const c = await connect();
          const query = c.query;
          c.query = (sql, params) => sql.includes('SUM(amount_micro - settled_micro)') ? Promise.resolve({ rows: [{ held: '0' }] }) : query(sql, params);
          return c;
        };
      }
      await debit(f, cost);
      assert.deepEqual(f.lots.map(row => row.remaining_micro), expected);
      assert.equal(f.balance(), BigInt(kinds.length * 100 - cost));
      assert.equal(f.lots.reduce((n, row) => n + BigInt(row.remaining_micro), 0n), f.balance());
      assert.equal(f.writes[0], 'lot-0');
    });
  }
}
