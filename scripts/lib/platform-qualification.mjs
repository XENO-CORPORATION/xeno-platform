import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { LEGACY_SCHEMA_FILES } from '../../src/server/services/migrationService.js';

export async function requireLegacySchemas(root) {
  for (const name of LEGACY_SCHEMA_FILES) {
    const content = await readFile(path.join(root, 'src/server/database', name), 'utf8');
    if (!content.trim()) throw new Error(`Required startup schema is empty: ${name}`);
  }
}

export function childEnvironment(source, scratch, databaseUrl) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|LANG|LC_ALL)$/i;
  return {
    ...Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key))),
    TEMP: scratch, TMP: scratch, TMPDIR: scratch, NODE_ENV: 'test',
    DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
    LIBRARY_CONTENT_SECRET: 'local-qualification-fixture-only',
    XENO_EMBEDDING_BASE_URL: 'http://127.0.0.1:1',
  };
}

export function assertLocalDocker(host) {
  if (!/^(unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/.test(host)) {
    throw new Error('Qualification requires a local Unix socket or Windows named-pipe Docker context');
  }
}

export function assertOwnedDatabase(name, owned) {
  if (!/^xeno_(qual|payment)_[a-f0-9]{32}(?:_restore)?$/.test(name) || !owned.has(name)) {
    throw new Error('Refusing an unowned database operation');
  }
  return `"${name}"`;
}

export function assertScratchPath(parent, scratch) {
  const relative = path.relative(path.resolve(parent), path.resolve(scratch));
  if (relative !== 'scratch') throw new Error('Refusing cleanup outside the owned scratch directory');
}

export function parseTapSummary(output, exitCode) {
  if (exitCode !== 0) throw new Error('Test subprocess failed');
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP ${key} summary`);
    result[key] = Number(matches[0][1]);
  }
  if (result.tests < 1 || result.tests !== result.pass || result.fail || result.cancelled || result.skipped || result.todo) {
    throw new Error('Qualification requires positive tests and zero failed, cancelled, skipped or TODO tests');
  }
  return result;
}

export function parseMoneySummary(output, exitCode) {
  const matches = [...output.matchAll(/billing-money-in: (\d+) passed, (\d+) failed/g)];
  if (exitCode !== 0 || matches.length !== 1 || Number(matches[0][1]) < 1 || Number(matches[0][2]) !== 0) {
    throw new Error('Money-in suite did not prove positive checks and zero failures');
  }
  return { passed: Number(matches[0][1]), failed: 0 };
}

export function parseBackendSummary(output, exitCode, suite) {
  if (!/^[a-z][a-z0-9-]+$/.test(suite)) throw new Error('Invalid backend suite identifier');
  const matches = [...output.matchAll(new RegExp(`${suite}: (\\d+) passed, (\\d+) failed`, 'g'))];
  if (exitCode !== 0 || matches.length !== 1 || Number(matches[0][1]) < 1 || Number(matches[0][2]) !== 0) {
    throw new Error(`${suite}: missing or failing backend summary`);
  }
  return { passed: Number(matches[0][1]), failed: 0 };
}

export function assertRestored(before, after) {
  assert.deepEqual(after, before, 'Restore schema, sequence state or table contents differ');
}

export async function schemaAndRows(pool) {
  const { rows: tables } = await pool.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
  const data = [];
  for (const { relname } of tables) {
    const identifier = `"${relname.replaceAll('"', '""')}"`;
    const { rows } = await pool.query(`SELECT count(*)::text AS count,
      md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS digest
      FROM (SELECT md5(to_jsonb(t)::text) AS h FROM ONLY public.${identifier} t) hashes`);
    data.push({ table: relname, ...rows[0] });
  }
  const schema = (await pool.query(`SELECT 'column' AS kind,c.table_name AS name,c.column_name AS part,
      jsonb_build_array(c.data_type,c.udt_name,c.is_nullable,c.column_default,c.character_maximum_length,c.ordinal_position)::text AS definition
      FROM information_schema.columns c WHERE c.table_schema='public'
    UNION ALL SELECT 'constraint',r.relname,c.conname,pg_get_constraintdef(c.oid)
      FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'index',tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL SELECT 'trigger',r.relname,t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid),t.tgenabled)::text
      FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL SELECT 'function',p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p','w')
    UNION ALL SELECT 'policy',tablename,policyname,jsonb_build_array(permissive,roles,cmd,qual,with_check)::text
      FROM pg_policies WHERE schemaname='public'
    UNION ALL SELECT 'relation',r.relname,'properties',jsonb_build_array(r.relkind,r.relrowsecurity,r.relforcerowsecurity,
      r.reloptions,pg_get_expr(r.relpartbound,r.oid))::text FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relkind IN ('r','p','v','m')
    UNION ALL SELECT 'view',r.relname,'definition',pg_get_viewdef(r.oid)
      FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relkind IN ('v','m')
    UNION ALL SELECT 'enum',t.typname,e.enumsortorder::text,e.enumlabel
      FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
    ORDER BY kind,name,part`)).rows;
  const sequences = (await pool.query(`SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value
    FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`)).rows;
  return { data, schema: schema.map(row => ({ ...row, definition: normalizeSchemaDefinition(row.definition) })), sequences };
}

// PostgreSQL reparses its dump and distributes varchar[] -> text[] casts onto
// literal elements. Normalize only that exact lossless form; preserve values,
// order, operators, other types and every other part of the definition.
export function normalizeSchemaDefinition(definition) {
  const literal = "'(?:[^']|'')*'::character varying";
  const array = new RegExp(`\\(\\(ARRAY\\[(${literal}(?:, ${literal})*)\\]\\)::text\\[\\]\\)`, 'g');
  return definition.replace(array, (_, elements) => {
    const values = elements.match(new RegExp(literal, 'g'));
    return `(ARRAY[${values.map(value => `(${value})::text`).join(', ')}])`;
  });
}

export function pinnedQualificationImage(source) {
  const match = source.match(/^PGVECTOR_IMAGE="(pgvector\/pgvector:[\w.-]+@sha256:[a-f0-9]{64})"$/m);
  if (!match) throw new Error('Canonical database cutover script has no pinned pgvector image');
  return match[1];
}
