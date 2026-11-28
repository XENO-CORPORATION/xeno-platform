// A chat notebook keeps its passages as a SECOND ingestion of the same file (extractor_id 'corpus-notebook';
// xeno-corpus docs/specs/2026-11-27-notebooks-in-chat.md §3.1). Every other reader of library_asset_ingestions means
// the PLATFORM's extraction, and must not see those rows:
//   - "is this file safe to serve" (ready/unsupported) would count a notebook row as a scan result;
//   - "the latest ingestion" would pick a notebook row, and Retry would re-queue it as an extraction job;
//   - the ingestion worker would claim a notebook row (failed rows are reclaimed) and extract it again;
//   - chunk readers would return each file's text twice.
// So every statement that names library_asset_ingestions carries the predicate, or is shown here to be safe without it.
//   node --test scripts/notebook-ingestion-kind.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server');
const PREDICATE = "extractor_id IS DISTINCT FROM 'corpus-notebook'";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'tests' || name === 'vendor') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/** Every SQL statement (a quoted string) that names the table, with where it is. */
export function statementsIn(src) {
  const out = [];
  let at = src.indexOf('library_asset_ingestions');
  while (at >= 0) {
    const lineStart = src.lastIndexOf('\n', at) + 1, lineEnd = src.indexOf('\n', at);
    const line = src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd);
    const before = src.slice(0, at);
    let stmt;
    if ((before.match(/`/g) || []).length % 2 === 1) {
      const open = before.lastIndexOf('`'), close = src.indexOf('`', at);
      stmt = src.slice(open + 1, close);
      at = src.indexOf('library_asset_ingestions', close);
    } else {
      stmt = line;
      at = src.indexOf('library_asset_ingestions', lineEnd < 0 ? src.length : lineEnd);
    }
    out.push({ line: before.split('\n').length, stmt });
  }
  return out;
}

/** Why a statement is safe, or null. */
export function verdict(stmt) {
  const s = stmt.replace(/\s+/g, ' ');
  if (s.includes(PREDICATE)) return 'skips notebook rows';
  if (/= 'corpus-notebook'|\$\{NOTEBOOK_EXTRACTOR_ID\}|NOTEBOOK_EXTRACTOR_ID/.test(s)) return 'is the notebook\'s own query';
  if (/^\s*INSERT INTO library_asset_ingestions/i.test(s)) return 'writes a new platform ingestion';
  if (/LIMIT 0/.test(s)) return 'a schema probe';
  // addressed by its own id, never "a file's ingestions": the caller already holds a platform row
  if (/WHERE (\w+\.)?id ?= ?\$1\b/i.test(s) && !/asset_id/i.test(s.replace(/WHERE (\w+\.)?id ?= ?\$1[\s\S]*$/i, ''))) return 'by its own id';
  if (/WHERE i\.id = \$1 GROUP BY i\.id/.test(s)) return 'by its own id';
  // "has never been ingested at all": a notebook row only exists once the platform's has, so it cannot change the answer
  if (/NOT EXISTS \(SELECT 1 FROM library_asset_ingestions i WHERE i\.asset_id=f\.id\)/.test(s)) return 'never-ingested check';
  // the Retry route's outer UPDATE is by the id its inner SELECT chose, and that SELECT carries the predicate
  if (/^\s*UPDATE library_asset_ingestions[\s\S]*WHERE id = \( SELECT id FROM library_asset_ingestions WHERE asset_id = \$1 AND extractor_id IS DISTINCT FROM 'corpus-notebook'/.test(s)) return 'retry of the platform row';
  return null;
}

test('every statement on library_asset_ingestions skips the notebook\'s rows or is shown safe without it', () => {
  const unsafe = [];
  let count = 0;
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    for (const { line, stmt } of statementsIn(src)) {
      count++;
      if (!verdict(stmt)) unsafe.push(`${path.relative(ROOT, file)}:${line}  ${stmt.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
    }
  }
  assert.ok(count >= 25, `found only ${count} statements: the scan is not reading the code`);
  assert.deepEqual(unsafe, [], `these read the platform's ingestion without skipping notebook rows (add AND ${PREDICATE}):\n${unsafe.join('\n')}`);
});

test('the check fails when the predicate is removed (mutation)', () => {
  const claim = readFileSync(path.join(ROOT, 'workers', 'libraryIngestionWorker.js'), 'utf8').replace(/\r\n/g, '\n');
  const [first] = statementsIn(claim);
  assert.ok(verdict(first.stmt), 'the worker\'s claim is safe as written');
  assert.equal(verdict(first.stmt.replace(`${PREDICATE} AND `, '')), null, 'the claim without the predicate is caught');
  const latest = "SELECT state FROM library_asset_ingestions WHERE asset_id = f.id ORDER BY created_at DESC LIMIT 1";
  assert.equal(verdict(latest), null, 'a "latest ingestion" read without it is caught');
  assert.equal(verdict("EXISTS (SELECT 1 FROM library_asset_ingestions i WHERE i.asset_id = f.id AND i.state IN ('ready','unsupported'))"), null, 'a "safe to serve" check without it is caught');
});
