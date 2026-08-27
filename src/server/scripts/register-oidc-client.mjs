#!/usr/bin/env node
/**
 * Audited first-party OIDC client registration. Dry-run is the default; --apply
 * is explicit and transactional. The checked-in authority matrix is the ceiling.
 */
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';

const { Pool } = pg;

export function parseArgs(argv) {
  const values = new Map();
  const flags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (['apply', 'loopback'].includes(name)) { flags.add(name); continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    const list = values.get(name) || [];
    list.push(value);
    values.set(name, list);
  }
  const one = (name) => values.get(name)?.at(-1) || null;
  return {
    apply: flags.has('apply'),
    loopback: flags.has('loopback'),
    clientId: one('client-id'),
    name: one('name'),
    surface: one('surface'),
    reason: one('reason'),
    redirectUris: values.get('redirect-uri') || [],
    requestedScopes: values.get('scope') || null,
  };
}

export function buildPlan(args) {
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/.test(args.clientId || '')) throw new Error('invalid --client-id');
  if (!args.name || args.name.length > 128) throw new Error('invalid --name');
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(args.surface || '')) throw new Error('invalid --surface');
  if (args.redirectUris.length === 0) throw new Error('at least one --redirect-uri is required');
  const ceiling = scopesForClient(args.clientId);
  if (!ceiling) throw new Error(`add ${args.clientId} to the checked-in authority matrix first`);
  const scopes = args.requestedScopes || ceiling;
  const allowed = new Set(ceiling);
  if (scopes.length === 0 || scopes.some((scope) => !allowed.has(scope))) throw new Error('requested scope exceeds checked-in authority');
  for (const raw of args.redirectUris) {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (args.loopback) {
      if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== '::1') || url.search || url.hash) {
        throw new Error(`invalid loopback redirect: ${raw}`);
      }
    } else if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error(`invalid web redirect: ${raw}`);
    }
  }
  if (args.apply && (!args.reason || args.reason.trim().length < 8)) {
    throw new Error('--reason (at least 8 characters) is required with --apply');
  }
  return {
    clientId: args.clientId,
    name: args.name,
    surface: args.surface,
    loopback: args.loopback,
    redirectUris: [...new Set(args.redirectUris)],
    scopes: [...new Set(scopes)],
    reason: args.reason || null,
  };
}

export async function applyPlan(db, plan) {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(
      `INSERT INTO oauth_clients
         (client_id, client_secret, name, redirect_uris, allowed_scopes, surface, is_first_party, loopback)
       VALUES ($1,NULL,$2,$3,$4,$5,true,$6)
       ON CONFLICT (client_id) DO UPDATE SET
         client_secret = NULL, name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris,
         allowed_scopes = EXCLUDED.allowed_scopes, surface = EXCLUDED.surface,
         is_first_party = true, loopback = EXCLUDED.loopback`,
      [plan.clientId, plan.name, plan.redirectUris, plan.scopes, plan.surface, plan.loopback],
    );
    await tx.query(
      `INSERT INTO security_events (user_id, event_type, metadata, created_at)
       VALUES (NULL, 'oidc_client_registered', $1::jsonb, now())`,
      [JSON.stringify({
        clientId: plan.clientId, surface: plan.surface, loopback: plan.loopback,
        redirectCount: plan.redirectUris.length, scopes: plan.scopes, reason: plan.reason,
      })],
    );
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildPlan(args);
  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', ...plan }, null, 2));
  if (!args.apply) return;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required with --apply');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await applyPlan(pool, plan); } finally { await pool.end(); }
  console.log(`registered ${plan.clientId} with an audit record`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`register-oidc-client: ${error.message}`);
    process.exit(1);
  });
}
