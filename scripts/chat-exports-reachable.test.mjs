/**
 * An export nobody imports is not an API — it is a file.
 *
 * ## Why this gate exists
 *
 * On 2026-09-14 I built a complete SSE reader and state reducer for the chat stream
 * (`readChatStream`, `applyChatStreamEvent`, `initialChatStreamState`), tested them 17 ways,
 * reported the work finished — and they were imported by NOTHING. Only `readGenerateResponse`
 * from that same file was wired.
 *
 * 🔴 That is the ecosystem's most-repeated defect (xeno-workflow's 76 node types, xeno-tools'
 * never-called `install`, xeno-post's `connector.delete()`, the Forum's write-only
 * `forum_flags`) — created while writing gates against it, and INVISIBLE to the gate I had
 * just written: `chat-stream-reachable.test.mjs` asserts the ROUTE declares itself unwired,
 * and says nothing about an export nobody imports. A gate that checks one direction reads,
 * falsely, as covering the concept.
 *
 * ## Why this is SCOPED and not repo-wide
 *
 * Measured before writing: the repository has **1,452 unconsumed exports across 339 files**.
 * A gate demanding zero would fail on day one and be disabled by the end of the week — and
 * most of those are legitimate (icon libraries re-exported for consumers, route handlers
 * wired by string, API surfaces built for callers that exist outside `src/`).
 *
 * So this covers the modules where the defect actually happened: the chat streaming and tool
 * pipeline, all of it written in the last two days. It is a floor that can be raised, not a
 * boil-the-ocean rule nobody can satisfy.
 *
 * ## What counts as "imported"
 *
 * A real `import { name } from …` somewhere else — not any mention. Matching mentions is how
 * `chat-stream-reachable` came to report a DOCBLOCK as a consumer and demand a true @unwired
 * declaration be deleted. A comment is not a caller.
 *
 * An export that is deliberately not imported declares `@internal` (used only inside its own
 * module, exported for tests or symmetry) or `@unwired` (finished, waiting on a named
 * consumer). Both require a REASON, because "trust me" is what this gate exists to stop.
 *
 * Mutation-checked 2026-09-14, each failing alone with a green control:
 *   add an exported function nothing imports        -> the orphan test fails
 *   strip a required @internal/@unwired reason      -> the declaration test fails
 *   let a docblock mention count as an import       -> the "mention is not an import" test fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The modules this gate covers.
 *
 * ⚠️ Deliberately a list, not a glob over `src/`. See the docblock: repo-wide is 1,452
 * findings and an instantly-disabled gate. Add a module here when you write one; do not
 * widen this to a directory sweep without first measuring what it would report.
 */
const COVERED = [
  join('src', 'server', 'utils', 'chatToolLoop.js'),
  join('src', 'server', 'utils', 'streamingToolCalls.js'),
  join('src', 'server', 'utils', 'streamingCompletion.js'),
  join('src', 'server', 'utils', 'turnProgress.js'),
  join('src', 'server', 'utils', 'chatMessageParts.js'),
  join('src', 'components', 'playground', 'Chat', 'chatStream.ts'),
];

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every source file that could import something. */
function allSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allSources(full, out);
    else if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const FILES = [
  ...allSources(join(ROOT, 'src')),
  ...readdirSync(join(ROOT, 'scripts'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(ROOT, 'scripts', f)),
];

/**
 * Names actually IMPORTED anywhere — read from import statements only.
 *
 * 🔴 Not "mentioned". `chat-stream-reachable` matched a path inside any quotes and therefore
 * counted a docblock as a consumer, which would have deleted a true declaration. The whole
 * point of this gate is reachability, and a comment reaches nothing.
 */
function importedNames() {
  const names = new Set();
  for (const file of FILES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Exported symbols of one module, with the docblock that precedes each. */
function exportsOf(relative) {
  const raw = readFileSync(join(ROOT, relative), 'utf8');
  const code = stripComments(raw);
  const found = [];
  for (const match of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|class|let)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    // The declaration's own docblock, taken from the UNSTRIPPED source.
    const at = raw.search(new RegExp(`export\\s+(?:async\\s+)?(?:function\\*?|const|class|let)\\s+${name}\\b`));
    const preceding = at > 0 ? raw.slice(Math.max(0, at - 1200), at) : '';
    const lastBlock = preceding.lastIndexOf('/**');
    found.push({
      name,
      doc: lastBlock >= 0 ? preceding.slice(lastBlock) : '',
      usesInFile: (code.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length,
    });
  }
  return found;
}

const IMPORTED = importedNames();

test('🔴 every covered export is imported, or declares why it is not', () => {
  const problems = [];

  for (const relative of COVERED) {
    for (const { name, doc, usesInFile } of exportsOf(relative)) {
      if (IMPORTED.has(name)) continue;

      const declared = /@internal\b/.test(doc) || /@unwired\b/.test(doc);
      if (declared) continue;

      /*
       * Used elsewhere in its own file (more than the declaration itself) is a helper that
       * happens to carry `export` — real code, not an orphan. It still must SAY so, which
       * the next assertion enforces; this one only reports the genuinely dead.
       */
      problems.push(
        `${relative} → ${name}` +
        (usesInFile > 1 ? ` (used ${usesInFile}× in-file; mark @internal)` : ' (DEAD — nothing uses it)'),
      );
    }
  }

  assert.deepEqual(
    problems, [],
    'These exports are imported by nothing:\n  ' + problems.join('\n  ') +
    '\n\nThis is the "built, tested, unreachable" shape — it has appeared seven times in ' +
    'this ecosystem, and on 2026-09-14 it was created BY a session writing gates against ' +
    'it. Either wire it, delete it, or mark it @internal / @unwired WITH a reason.',
  );
});

test('an @internal or @unwired declaration must carry a reason', () => {
  const bare = [];
  for (const relative of COVERED) {
    for (const { name, doc } of exportsOf(relative)) {
      if (IMPORTED.has(name)) continue;
      if (!/@internal\b|@unwired\b/.test(doc)) continue;
      // The marker plus something substantive after it — not just the word.
      const after = doc.slice(doc.search(/@internal\b|@unwired\b/));
      if (after.replace(/[\s*]/g, '').length < 40) bare.push(`${relative} → ${name}`);
    }
  }
  assert.deepEqual(
    bare, [],
    'A bare marker silences this gate without recording anything the next reader can act ' +
    'on — which is exactly the "trust me" it exists to refuse:\n  ' + bare.join('\n  '),
  );
});

test('🔴 a MENTION is not an import', () => {
  /*
   * The failure this pins is one I actually shipped. `chat-stream-reachable` matched a path
   * inside any quotes, so a DOCBLOCK naming `/api/ai/chat/stream` made it report the route as
   * consumed and demand a true @unwired declaration be deleted.
   *
   * Proven with a name that appears in prose in this very file and is imported nowhere.
   */
  const invented = 'aNameThatOnlyAppearsInProseNeverImported';
  assert.equal(
    IMPORTED.has(invented), false,
    'a name appearing only in text must never count as imported — otherwise the gate ' +
    'certifies comments as consumers',
  );
  // And the scanner must genuinely find real imports, or "nothing is imported" passes vacuously.
  assert.ok(IMPORTED.size > 50, `expected many real imports, found ${IMPORTED.size} — the scanner is broken`);
  assert.ok(IMPORTED.has('readGenerateResponse'), 'a known-imported symbol must be detected');
});

test('the covered list points at files that exist', () => {
  // A rename would otherwise silently empty this gate — the orphan-by-rename failure the
  // sibling gates-are-reachable suite was written for.
  for (const relative of COVERED) {
    assert.doesNotThrow(
      () => readFileSync(join(ROOT, relative), 'utf8'),
      `${relative} is listed as covered but is not on disk — a rename severed this gate`,
    );
  }
});
