/**
 * Is the streaming chat endpoint reachable from the product?
 *
 * ## Why this gate exists
 *
 * `POST /api/ai/chat/stream` is a complete, carefully metered SSE endpoint — and on
 * 2026-09-14, while adding the tool loop to it, a repo-wide search found **no client
 * anywhere calls it**. The chat UI posts to `/api/chat/generate`, the buffering route.
 *
 * That is this ecosystem's most repeated defect shape — built, tested, unreachable —
 * recorded against xeno-workflow's 76 node types, xeno-tools' never-called `install`,
 * xeno-post's `connector.delete()`, the Forum's write-only `forum_flags`, and twice in
 * xeno-agent-interface. Every one had correct unit tests. None was connected.
 *
 * 🔴 The specific risk here is worse than a dead endpoint, because it is a MONEY path.
 * `/api/ai/chat/stream` places credit holds. An endpoint that is never called cannot
 * demonstrate that its holds settle correctly against real traffic, so the metering is
 * unexercised in production while looking finished in review.
 *
 * ## What this asserts, and what it deliberately does not
 *
 * It does NOT demand a consumer. Requiring one would fail the build for a state the repo
 * knowingly chose, and a gate that fails for a decision gets disabled.
 *
 * It asserts the status is DECLARED and TRUE. Either:
 *   (a) a client calls the route — then the declaration must say so, or
 *   (b) nothing calls it — then the route must carry an `@unwired` docblock naming the
 *       consumer that would adopt it and the reason it has not.
 *
 * The gate fails when the declaration and reality disagree — INCLUDING when a consumer is
 * added and the stale `@unwired` note is left behind. That direction matters: a route
 * documented as unreachable, while live traffic bills through it, is a worse lie than the
 * orphan it was describing.
 *
 * Mutation-checked 2026-09-14, with a green control:
 *   delete the @unwired block while no consumer exists  -> test 1 fails
 *   add a fake client call while @unwired remains       -> test 2 fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE = readFileSync(join(ROOT, 'src', 'server', 'routes', 'aiRoutes.js'), 'utf8');

/** Every client-side source file (anything under src/ that is not the server). */
function clientFiles(dir = join(ROOT, 'src'), out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes(join('src', 'server'))) continue; // the route defines it; that is not a consumer
    if (statSync(full).isDirectory()) clientFiles(full, out);
    else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

/**
 * Does any client file actually FETCH the streaming route?
 *
 * ⚠️ A MENTION IS NOT A CALL, and the first version of this could not tell the difference.
 * It matched the path inside any quotes, so when `chatStream.ts` gained a docblock naming
 * `/api/ai/chat/stream` as context, the gate reported the route as consumed and demanded
 * the @unwired marker be removed — which would have deleted a TRUE declaration on the
 * strength of a comment. Exactly the failure recorded against the capability gate, where a
 * docblock satisfied a check meant to measure shipped behaviour.
 *
 * So comments are stripped first, and the path must appear inside a call.
 */
function findConsumers() {
  const hits = [];
  for (const file of clientFiles()) {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // fetch('/api/ai/chat/stream'…), new EventSource("…"), axios.post(`…`)
    if (/(fetch|EventSource|post|get|request)\s*\(\s*['"`][^'"`]*\/api\/ai\/chat\/stream/.test(source)) {
      hits.push(file.slice(ROOT.length + 1));
    }
  }
  return hits;
}

const UNWIRED = /@unwired\b/.test(ROUTE);

test('an unconsumed streaming route DECLARES that it is unwired, and why', () => {
  const consumers = findConsumers();
  if (consumers.length > 0) return; // covered by the opposite test below

  assert.ok(
    UNWIRED,
    'No client calls POST /api/ai/chat/stream, and the route does not say so. This is the ' +
    '"built, tested, unreachable" shape that has now appeared seven times in this ecosystem ' +
    '— and here it is a METERED path, so its credit holds are unexercised by real traffic ' +
    'while the code reads as finished. Either wire a consumer or declare @unwired with the ' +
    'consumer that will adopt it and what is blocking that.',
  );

  // A declaration with no reason is "trust me", which is what the sweep exists to stop.
  const block = ROUTE.match(/@unwired[^\n]*\n(?:\s*\*[^\n]*\n){1,20}/);
  assert.ok(
    block && block[0].length > 120,
    '@unwired must name the intended consumer and the blocker, not just the word. A bare ' +
    'marker silences the gate without recording anything the next reader can act on.',
  );
});

test('a route that HAS a consumer must not still claim to be unwired', () => {
  const consumers = findConsumers();
  if (consumers.length === 0) return;

  assert.equal(
    UNWIRED, false,
    `POST /api/ai/chat/stream is called by ${consumers.join(', ')}, but the route still ` +
    'carries an @unwired declaration. A money path documented as unreachable while real ' +
    'traffic bills through it is a worse claim than the orphan it described — delete the ' +
    'marker when the consumer lands.',
  );
});

test('the streaming route still exists and is still metered', () => {
  // Guards against "fixing" the reachability warning by deleting the endpoint.
  assert.match(ROUTE, /router\.post\('\/chat\/stream'/, 'the streaming route must exist');
  assert.match(
    ROUTE, /meterPremiumChatStream/,
    'the streaming route must place credit holds — an unmetered inference path is free money',
  );
});
