#!/usr/bin/env node
/**
 * Provision the per-product dev agents that Loop D exists for.
 *
 * ── WHY THIS SCRIPT EXISTS ──────────────────────────────────────────────────
 *
 * WP6 shipped predicate subscriptions and the digest, and there was NOBODY who
 * could call either: an agent needs an identity, and no per-product identity
 * existed. Endpoints with zero possible consumers is the defect this codebase
 * has now shipped eight times, and Loop D would have been the ninth.
 *
 * ── SAFETY, WHICH IS NOT OPTIONAL HERE ──────────────────────────────────────
 *
 * ABSOLUTE RULE §2b, written after `seed-releases.mjs` destroyed the release
 * history of four shipping products: any script touching a shared/production
 * store must DRY-RUN BY DEFAULT, take an explicit --confirm to act, and REFUSE
 * when data already exists rather than replacing it.
 *
 *   node scripts/provision-forum-agents.mjs --owner <handle>
 *       -> prints the plan, writes nothing
 *
 *   node scripts/provision-forum-agents.mjs --owner <handle> --confirm --out <file>
 *       -> creates the agents, writes their keys to <file>
 *
 * 🔴 API KEYS ARE NEVER PRINTED. `mintAgentApiKey` returns the raw key once and
 * only the hash is stored, so it has to go somewhere — but stdout is a terminal
 * scrollback, a CI log and a screen-share all at once. The keys go to a file the
 * operator names, with 0600 where the platform supports it; stdout gets the
 * PREFIX only, which is enough to identify a key and useless for using one.
 * (Root CLAUDE.md §🔑: only ever surface a name, a length, or a result.)
 *
 * ── WHY AN OWNER IS REQUIRED ────────────────────────────────────────────────
 *
 * §4.4: an agent's accountability chain has to terminate in a human, and its
 * effective role is capped by its owner's. An agent with no owner is a principal
 * nobody is answerable for — which is exactly why `assertNotService` refuses
 * service accounts from posting.
 */

import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import pg from 'pg';

/**
 * The products that get a dev agent. Deliberately a short, explicit list rather
 * than "every product in the catalog": an agent per docs-scaffold repo would be
 * eight identities nobody reads the digest for, and each one is a real principal
 * with a real key.
 */
const PRODUCTS = [
  { name: 'pixel-dev', product: 'pixel', display: 'Pixel dev agent' },
  { name: 'motion-dev', product: 'motion', display: 'Motion dev agent' },
  { name: 'canvas-dev', product: 'canvas', display: 'Canvas dev agent' },
  { name: 'browser-dev', product: 'browser', display: 'Browser dev agent' },
];

/** The standing query each one registers. Narrow on purpose — §6.2. */
const predicateFor = (product) => ({
  space: 'feedback',
  tags: [`product:${product}`],
  status: 'unanswered',
  max_per_hour: 4,
});

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
}
const CONFIRM = process.argv.includes('--confirm');
const OWNER = arg('--owner');
const OUT = arg('--out');

async function main() {
  if (!OWNER) {
    console.error('Usage: provision-forum-agents.mjs --owner <handle> [--confirm --out <file>]');
    console.error('An owner is REQUIRED: an agent whose chain does not terminate in a human');
    console.error('is a principal nobody is answerable for (SPEC §4.4).');
    process.exit(2);
  }
  if (CONFIRM && !OUT) {
    console.error('--confirm requires --out <file>: the API keys have to go somewhere,');
    console.error('and that somewhere is never stdout.');
    process.exit(2);
  }
  if (OUT && existsSync(OUT)) {
    console.error(`Refusing to overwrite ${OUT}. Existing credentials are not ours to replace.`);
    process.exit(2);
  }

  const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'xenostudio',
  });

  const { createAgent, mintAgentApiKey, agentHandleFor } = await import('../src/server/services/agentIdentity.js');
  const { setPredicate } = await import('../src/server/services/forumService.js');

  const { rows: owners } = await pool.query(
    'SELECT id, username AS handle, display_name, role FROM users WHERE LOWER(username) = LOWER($1)',
    [OWNER],
  );
  const owner = owners[0];
  if (!owner) {
    console.error(`No such user: ${OWNER}`);
    process.exit(1);
  }

  console.log(`owner: ${owner.handle} (role: ${owner.role})`);
  if (!['admin', 'moderator'].includes(owner.role)) {
    // Not fatal — an agent CAN be owned by a plain user. But its effective role
    // is capped by the owner's, so it could never mark a thread fixed, which is
    // half of what a dev agent is for. Say so rather than let it be discovered
    // later as a mystery 403.
    console.log('  ⚠️  owner is not staff — these agents will be able to READ the digest');
    console.log('      but NOT mark threads fixed (effective role is capped by the owner).');
  }
  console.log(CONFIRM ? '\nMODE: CONFIRM — will create\n' : '\nMODE: DRY RUN — nothing will be written\n');

  const results = [];
  for (const p of PRODUCTS) {
    const handle = agentHandleFor(p.name, owner.handle);
    const { rows: taken } = await pool.query(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [handle],
    );
    if (taken.length) {
      // REFUSE, never replace. A handle that already exists may be a live agent
      // with a live key; re-provisioning it would orphan that key silently.
      console.log(`  SKIP   @${handle} — already exists`);
      continue;
    }
    if (!CONFIRM) {
      console.log(`  WOULD  @${handle}  predicate=${JSON.stringify(predicateFor(p.product))}`);
      continue;
    }

    const agent = await createAgent(pool, owner, {
      name: p.name, displayName: p.display, agentOrigin: 'forum-loop-d',
    });
    const key = await mintAgentApiKey(pool, agent.id, `${p.name} digest key`);
    await setPredicate(pool, agent.id, predicateFor(p.product));
    results.push({ handle, product: p.product, key });
    console.log(`  CREATE @${handle}  key prefix ${key.slice(0, 16)}…  predicate registered`);
  }

  if (CONFIRM && results.length) {
    const body = results
      .map((r) => `# ${r.handle} (product:${r.product})\nXENO_FORUM_AGENT_KEY_${r.product.toUpperCase()}=${r.key}`)
      .join('\n\n');
    writeFileSync(OUT, `${body}\n`, { mode: 0o600 });
    try { chmodSync(OUT, 0o600); } catch { /* best effort on Windows */ }
    console.log(`\n${results.length} key(s) written to ${OUT} (mode 0600).`);
    console.log('Move them into ~/.xeno-secrets and delete that file — it is the only copy.');
  } else if (!CONFIRM) {
    console.log('\nDry run. Re-run with --confirm --out <file> to create.');
  }

  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
