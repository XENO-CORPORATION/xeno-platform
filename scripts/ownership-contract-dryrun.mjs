#!/usr/bin/env node
/**
 * Dry run of migration 20261020140000-ownership-contract (D-1/D-6 contract step). READ ONLY: one
 * `BEGIN READ ONLY` transaction, always rolled back. Reports what the migration would rewrite, what it would create,
 * and what it would REFUSE (rows with no person behind them), so the numbers are known before deploy.
 *
 *   DATABASE_URL=postgresql://… node scripts/ownership-contract-dryrun.mjs [--json]
 *
 * Exit 0 = the migration would apply; exit 2 = it would refuse (the "refused" counts are non-zero).
 */
import { pathToFileURL } from 'node:url';
import pg from '../src/server/node_modules/pg/lib/index.js';

const url = process.env.DATABASE_URL;

// the person behind an owner id, as the migration's ownership_person_of resolves it
const PERSON = (col) => `(SELECT p.id FROM users p
  WHERE p.id = COALESCE((SELECT ai.owner_user_id FROM agent_identities ai WHERE ai.user_id = ${col}), ${col})
    AND p.role IS DISTINCT FROM 'service' AND NOT EXISTS (SELECT 1 FROM agent_identities a2 WHERE a2.user_id = p.id))`;
const HAS_WS = (person) => `EXISTS (SELECT 1 FROM workspaces w WHERE w.workspace_type = 'personal' AND w.owner_user_id = ${person})`;

export async function dryRun(db) {
  const one = async (sql) => Number((await db.query(sql)).rows[0].n);
  const fileOwner = 'COALESCE(f.owner_user_id, f.user_id)';
  return {
    userFiles: {
      total: await one('SELECT count(*) n FROM user_files'),
      toMove: await one(`SELECT count(*) n FROM user_files f WHERE f.workspace_id IS NULL AND ${PERSON(fileOwner)} IS NOT NULL`),
      refused: await one(`SELECT count(*) n FROM user_files f WHERE f.workspace_id IS NULL AND ${PERSON(fileOwner)} IS NULL`),
    },
    personalWorkspacesToCreate: await one(`SELECT count(DISTINCT x.person) n FROM (
        SELECT ${PERSON(fileOwner)} AS person FROM user_files f WHERE f.workspace_id IS NULL
        UNION ALL SELECT ${PERSON('d.user_id')} FROM marketplace_developers d WHERE d.seller_workspace_id IS NULL) x
      WHERE x.person IS NOT NULL AND NOT ${HAS_WS('x.person')}`),
    developers: {
      total: await one('SELECT count(*) n FROM marketplace_developers'),
      toFill: await one(`SELECT count(*) n FROM marketplace_developers d WHERE d.seller_workspace_id IS NULL AND ${PERSON('d.user_id')} IS NOT NULL`),
      refused: await one(`SELECT count(*) n FROM marketplace_developers d WHERE d.seller_workspace_id IS NULL AND ${PERSON('d.user_id')} IS NULL`),
    },
    listings: {
      total: await one('SELECT count(*) n FROM marketplace_listings'),
      firstPartyKeptNull: await one('SELECT count(*) n FROM marketplace_listings WHERE developer_id IS NULL'),
      toFill: await one(`SELECT count(*) n FROM marketplace_listings l JOIN marketplace_developers d ON d.id = l.developer_id
        WHERE l.seller_workspace_id IS NULL AND (d.seller_workspace_id IS NOT NULL OR ${PERSON('d.user_id')} IS NOT NULL)`),
      refused: await one(`SELECT count(*) n FROM marketplace_listings l JOIN marketplace_developers d ON d.id = l.developer_id
        WHERE l.seller_workspace_id IS NULL AND d.seller_workspace_id IS NULL AND ${PERSON('d.user_id')} IS NULL`),
    },
    payouts: {
      total: await one('SELECT count(*) n FROM marketplace_payouts'),
      toFill: await one(`SELECT count(*) n FROM marketplace_payouts p JOIN marketplace_developers d ON d.id = p.developer_id
        WHERE p.seller_workspace_id IS NULL AND (d.seller_workspace_id IS NOT NULL OR ${PERSON('d.user_id')} IS NOT NULL)`),
      refused: await one(`SELECT count(*) n FROM marketplace_payouts p JOIN marketplace_developers d ON d.id = p.developer_id
        WHERE p.seller_workspace_id IS NULL AND d.seller_workspace_id IS NULL AND ${PERSON('d.user_id')} IS NULL`),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const r = await dryRun(c);
    await c.query('ROLLBACK');
    const refused = r.userFiles.refused + r.developers.refused + r.listings.refused + r.payouts.refused;
    console.log(process.argv.includes('--json') ? JSON.stringify(r) : JSON.stringify(r, null, 2));
    console.log(refused ? `WOULD REFUSE: ${refused} row(s) have no person to own them` : 'would apply');
    process.exitCode = refused ? 2 : 0;
  } finally { await c.end(); }
}
