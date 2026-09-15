/**
 * billing-subject.test.mjs — WHO PAYS, resolved against the REAL resolver.
 *
 * 🔒 `XENO ACCOUNT - ARCHITECTURE.md` §3 + `XENO PRICING - STANDARD & LEDGER.md` §8b.
 * An agent is a scoped relation off a real user, never an account: no wallet, no plan, no
 * quota of its own. There is ONE quota per human and everything they run draws on it.
 *
 * This suite exists because the service-ledger tests INJECT a fake `billingSubjectFor`, so
 * they prove the routes use whatever they are handed — not that the real resolver resolves
 * an owner. A mutation that made the real one return the agent's own id was caught by
 * nothing. That is the gap a fake always leaves, and it is why this file drives the
 * genuine function over a fake DB instead.
 *
 * Mutation checks (each verified to fail the named test):
 *   - return the agent's own id instead of its owner -> "an agent resolves to its owner"
 *   - drop actorUserId                               -> "the actor is still reported, for attribution"
 *   - treat a service principal as an agent          -> "a service principal pays for itself"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { billingSubjectFor } from '../src/server/services/agentIdentity.js';

/** A DB that answers resolvePrincipal's single query from a row fixture. */
const dbWith = (row) => ({ async query() { return { rows: row ? [row] : [] }; } });

const HUMAN = { id: 'u-1', username: 'ana', display_name: 'Ana', role: 'user', is_active: true, status: 'active', owner_user_id: null };
const AGENT = {
  id: 'a-1', username: 'ana-bot', display_name: 'Bot', role: 'user', is_active: true, status: 'active',
  owner_user_id: 'u-1', agent_role: 'assistant', agent_origin: 'cli', agent_status: 'active',
  owner_handle: 'ana', owner_display_name: 'Ana', owner_is_active: true, owner_status: 'active', owner_role: 'user',
};
const SERVICE = { id: 's-1', username: 'svc', display_name: 'Svc', role: 'service', is_active: true, status: 'active', owner_user_id: null };

test('an agent resolves to its owner — the money is the human\'s', async () => {
  // 🔴 The bug this closes: billing the agent's own id charged a `credit_accounts` row
  // nothing funds, AND read its plan from a row carrying no subscription, so every agent
  // silently became `free` no matter who owned it. Both are the same mistake — treating
  // the agent's user id as a billing subject.
  const s = await billingSubjectFor(dbWith(AGENT), 'a-1');
  assert.equal(s.userId, 'u-1', 'the wallet, the plan and the quota are the owner\'s');
  assert.equal(s.isAgent, true);
});

test('the actor is still reported, for attribution', async () => {
  // An owner must be able to see WHICH of their agents spent the money. Attribution is a
  // label on the row; it is never a second wallet.
  const s = await billingSubjectFor(dbWith(AGENT), 'a-1');
  assert.equal(s.actorUserId, 'a-1');
  assert.notEqual(s.actorUserId, s.userId, 'an agent and its owner are different subjects, billed as one');
});

test('a human is their own billing subject', async () => {
  const s = await billingSubjectFor(dbWith(HUMAN), 'u-1');
  assert.deepEqual(s, { userId: 'u-1', actorUserId: 'u-1', isAgent: false });
});

test('a service principal pays for itself and is not an agent', async () => {
  // A machine with no owner has nobody to charge. It must not silently resolve to some
  // other account, and it must not read as an agent (human-only actions test kind).
  const s = await billingSubjectFor(dbWith(SERVICE), 's-1');
  assert.equal(s.userId, 's-1');
  assert.equal(s.isAgent, false);
});

test('an unknown user resolves to itself rather than throwing', async () => {
  // The ledger is the authority on whether an account exists; this resolver must not
  // become a second place that decides. It answers the question it was asked.
  const s = await billingSubjectFor(dbWith(null), 'ghost');
  assert.deepEqual(s, { userId: 'ghost', actorUserId: 'ghost', isAgent: false });
});

test('ids are returned as strings, so a uuid and its text form cannot disagree', async () => {
  const s = await billingSubjectFor(dbWith({ ...AGENT, id: 1, owner_user_id: 2 }), 1);
  assert.equal(typeof s.userId, 'string');
  assert.equal(typeof s.actorUserId, 'string');
});
