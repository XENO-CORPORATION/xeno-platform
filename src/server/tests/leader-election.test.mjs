import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createLeaderElection } from '../services/leaderElection.js';

const KEY = `xeno-leader-test-${process.pid}`;
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
});
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test('exactly ONE of two replicas becomes leader', async () => {
  const a = createLeaderElection(pool, { key: KEY, pollMs: 200, logger: { log() {}, error() {} } });
  const b = createLeaderElection(pool, { key: KEY, pollMs: 200, logger: { log() {}, error() {} } });
  let ranA = 0, ranB = 0;
  a.whenLeader(() => { ranA += 1; return () => {}; });
  b.whenLeader(() => { ranB += 1; return () => {}; });

  a.start(); b.start();
  await settle(700);

  const leaders = [a.isLeader(), b.isLeader()].filter(Boolean).length;
  assert.equal(leaders, 1, `expected exactly 1 leader, got ${leaders}`);
  // The real assertion: the WORK started once, not twice. Two replicas each
  // running the Forum mailer is how customers get every notification twice.
  assert.equal(ranA + ranB, 1, `background work started ${ranA + ranB} times, must be 1`);

  await a.stop(); await b.stop();
});

test('a standby TAKES OVER when the leader stops — the reason this is a lock, not a flag', async () => {
  const a = createLeaderElection(pool, { key: KEY, pollMs: 200, logger: { log() {}, error() {} } });
  const b = createLeaderElection(pool, { key: KEY, pollMs: 200, logger: { log() {}, error() {} } });
  a.start();
  await settle(500);
  assert.equal(a.isLeader(), true, 'first starter should lead');

  b.start();
  await settle(500);
  assert.equal(b.isLeader(), false, 'second must NOT lead while the first holds the lock');

  await a.stop();            // leader goes away
  await settle(900);         // standby polls
  assert.equal(b.isLeader(), true, 'standby must take over — a config flag could not do this');

  await b.stop();
});

test('the lock is really released afterwards (no leak into the pool)', async () => {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM pg_locks WHERE locktype = $1 AND objid = hashtext($2)::oid',
    ['advisory', KEY],
  );
  assert.equal(rows[0].n, 0, 'advisory lock still held after stop() — a pooled client inherited it');
  await pool.end();
});
