/**
 * Runs INSIDE the platform backend container, invoked by status/provision-probe.mjs.
 * Not a standalone tool: it trusts its arguments and speaks a narrow stdout protocol.
 *
 *   node provision-probe.container.mjs <plan|create|rotate> <ownerHandle|-> <credits>
 *
 * PROTOCOL: human-readable progress goes to STDERR. STDOUT carries exactly one JSON line,
 * and only `create` / `rotate` put the raw key in it — for the caller to capture and write
 * to the operator's secret store without ever displaying it.
 *
 * 🔴 NEVER `process.exit()` after writing the key. stdout is a PIPE here, and pipe writes are
 * asynchronous: exiting immediately can truncate the line, leaving an agent that exists and a
 * key nobody received. Every path returns normally and lets the process end once stdout has
 * drained; only argument errors, which write nothing to stdout, set an exit code early.
 *
 * It follows scripts/provision-forum-agents.mjs, which learned two things the hard way:
 * `createAgent` already mints the key, and an agent plus its key are one fact that commits
 * in one transaction, or a half-created principal is left that can never be completed.
 */
import pg from 'pg';
import { agentHandleFor, createAgent, mintAgentApiKey } from './services/agentIdentity.js';
import { addGrant } from './utils/creditLedgerV2.js';

const AGENT_NAME = 'status-probe';
const say = (line) => process.stderr.write(`${line}\n`);
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<number>} the exit code */
async function run(pool, mode, ownerArg, credits) {
  // Owner: the handle given, or the single active admin. More than one admin -> refuse to guess.
  const { rows: owners } = ownerArg && ownerArg !== '-'
    ? await pool.query('SELECT id, username AS handle, display_name, role FROM users WHERE LOWER(username) = LOWER($1) AND is_active', [ownerArg])
    : await pool.query("SELECT id, username AS handle, display_name, role FROM users WHERE role = 'admin' AND is_active ORDER BY created_at");
  if (owners.length !== 1) {
    say(owners.length === 0 ? 'No such active owner.' : `${owners.length} active admins — pass --owner <handle> to choose one.`);
    return 3;
  }
  const owner = { id: owners[0].id, handle: owners[0].handle, displayName: owners[0].display_name, kind: 'human' };
  const handle = agentHandleFor(AGENT_NAME, owner.handle);
  const { rows: existing } = await pool.query(
    `SELECT u.id, (SELECT count(*)::int FROM api_keys k WHERE k.user_id = u.id AND k.is_active) AS active_keys
       FROM users u JOIN agent_identities a ON a.user_id = u.id
      WHERE LOWER(u.username) = LOWER($1) AND a.owner_user_id = $2`,
    [handle, owner.id],
  );
  const agent = existing[0] || null;

  say(`owner:  @${owner.handle} (${owners[0].role})`);
  say(`agent:  @${handle} — ${agent ? `exists, ${agent.active_keys} active key(s)` : 'does not exist yet'}`);

  if (mode === 'plan') {
    say(agent
      ? 'plan:   already provisioned. Use --rotate to revoke its keys and mint a new one.'
      : `plan:   create @${handle}, mint its key, grant ${credits} credits.`);
    emit({ handle, exists: Boolean(agent) });
    return 0;
  }

  if (mode === 'create') {
    if (agent) {
      // REFUSE, never replace: the existing key may be live in the status Worker right now.
      say('refused: the probe agent already exists. Use --rotate to replace its key.');
      return 4;
    }
    const { key, agentId } = await inTransaction(pool, async (client) => {
      const created = await createAgent(client, owner, {
        name: AGENT_NAME, displayName: 'XENO Status probe', agentRole: 'other', agentOrigin: 'status-probe',
      });
      const { rows } = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [handle]);
      if (!rows[0]) throw new Error(`created @${handle} but could not read its id back`);
      return { key: created.apiKey, agentId: rows[0].id };
    });
    // The key is emitted BEFORE the grant: if the grant then fails, the operator still holds
    // a working key and can top the account up, rather than holding an account with no key.
    emit({ handle, key });
    if (credits > 0) {
      // A referenced grant is idempotent: a replay of this sourceRef is rejected, never doubled.
      await addGrant(pool, agentId, {
        amountMicro: Math.round(credits * 1_000_000), kind: 'promo', sourceRef: `status-probe:initial-grant:${agentId}`,
      });
    }
    say(`created @${handle}, key prefix ${key.slice(0, 16)}…, granted ${credits} credits`);
    return 0;
  }

  // rotate
  if (!agent) {
    say('refused: no probe agent to rotate. Run without --rotate to create it.');
    return 4;
  }
  const key = await inTransaction(pool, async (client) => {
    const revoked = await client.query('UPDATE api_keys SET is_active = false WHERE user_id = $1 AND is_active', [agent.id]);
    say(`rotating @${handle}: revoking ${revoked.rowCount} key(s)`);
    return mintAgentApiKey(client, agent.id, `@${handle} key (rotated)`);
  });
  emit({ handle, key });
  say(`rotated @${handle}, new key prefix ${key.slice(0, 16)}…`);
  return 0;
}

const [mode, ownerArg, creditsArg] = process.argv.slice(2);
const credits = Number(creditsArg);
if (!['plan', 'create', 'rotate'].includes(mode) || !Number.isFinite(credits) || credits < 0) {
  say('usage: <plan|create|rotate> <ownerHandle|-> <credits>');
  process.exitCode = 2;
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    process.exitCode = await run(pool, mode, ownerArg, credits);
  } catch (error) {
    say(`failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
