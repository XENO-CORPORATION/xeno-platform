/**
 * WP4 — new-account throttles.
 *
 * Per-kind limits already existed (human 10 threads / 40 posts an hour, agent
 * 3 / 15). What did not was any notion of account AGE: a brand-new account had
 * the full budget on its first minute, which is the shape every spam run relies
 * on — registering is cheap, so the only thing between a fresh account and 10
 * threads an hour was the willingness to click Sign up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRITE = readFileSync(
  join(__dirname, '..', 'src', 'server', 'services', 'forumWrite.js'), 'utf8');
const code = WRITE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const fn = () => {
  const s = code.slice(code.indexOf('async function assertWithinRateLimit'));
  return s.slice(0, s.indexOf('\n}') + 2);
};

/**
 * Pull a limits table out of source so the gates compare REAL NUMBERS rather
 * than the presence of a constant.
 *
 * ⚠️ Written with indexOf/slice and no backslash escapes on purpose. The first
 * version used a RegExp built in a template literal and was authored through a
 * shell heredoc, which ate one level of backslashes — `\s` collapsed to `s`, so
 * the pattern silently became `{([sS]*?)}` and matched nothing. A helper that
 * cannot find the thing it parses fails the gate for the wrong reason, which is
 * indistinguishable from the gate working.
 */
function limits(name) {
  const start = code.indexOf('const ' + name + ' = {');
  assert.ok(start >= 0, name + ' not found');
  const block = code.slice(start, code.indexOf('};', start));
  const out = {};
  for (const line of block.split('\n')) {
    const kind = line.trim().split(':')[0].trim();
    if (kind !== 'human' && kind !== 'agent') continue;
    const nums = line.match(/\d+/g) || [];
    if (nums.length >= 2) out[kind] = { threads: Number(nums[0]), posts: Number(nums[1]) };
  }
  assert.ok(out.human && out.agent, name + ' did not yield both kinds');
  return out;
}

test('a new account is genuinely tighter than an established one', () => {
  // The gate compares the NUMBERS, not the presence of a constant. A
  // "new-account limit" set at or above the normal budget is not a throttle.
  const normal = limits('RATE_LIMITS');
  const fresh = limits('NEW_ACCOUNT_LIMITS');
  for (const kind of ['human', 'agent']) {
    assert.ok(fresh[kind].threads < normal[kind].threads,
      `${kind}: new-account thread limit (${fresh[kind].threads}) must be below the normal one (${normal[kind].threads})`);
    assert.ok(fresh[kind].posts < normal[kind].posts,
      `${kind}: new-account post limit (${fresh[kind].posts}) must be below the normal one (${normal[kind].posts})`);
  }
});

test('new AGENTS stay tighter than new humans', () => {
  // §4.3 — an agent is least proven and its owner least accountable on day one.
  const fresh = limits('NEW_ACCOUNT_LIMITS');
  assert.ok(fresh.agent.threads < fresh.human.threads);
  assert.ok(fresh.agent.posts < fresh.human.posts);
});

test('...but not so tight that being keen trips it', () => {
  // A throttle a genuinely enthusiastic new user can hit is one that teaches
  // them to leave. Asking two or three questions on day one is normal.
  const fresh = limits('NEW_ACCOUNT_LIMITS');
  assert.ok(fresh.human.threads >= 3, 'a new human must be able to ask 3 questions in an hour');
  assert.ok(fresh.human.posts >= 10, 'and reply freely while getting help');
});

test('account age is read in the SAME query as the count', () => {
  // Two queries would double the cost of every post to answer a question that
  // is almost always "no".
  const body = fn();
  const queries = body.match(/db\.query\(/g) || [];
  assert.equal(queries.length, 1, 'exactly one round trip per write.');
  assert.match(body, /AS is_new/, 'the age must come back with the count.');
});

test('🔴 a missing user row fails to the TIGHTER budget, not the generous one', () => {
  // The only ways to get here are a race with account deletion or a bug.
  // Neither deserves the full budget, and "no row" defaulting to generous is
  // exactly the fail-open shape this codebase has shipped before.
  assert.match(fn(), /const isNew = rows\[0\] \? Boolean\(rows\[0\]\.is_new\) : true;/,
    'absent user row must be treated as NEW (tighter), never as established.');
});

test('the refusal explains WHY it is a new-account limit', () => {
  // "Rate limit reached" on a fresh account reads as a broken product. "New
  // accounts are limited for the first day" reads as a rule — and a rule with
  // an end date is one people wait out rather than give up on.
  const body = fn();
  assert.match(body, /New accounts are limited to/,
    'the new-account branch must say so.');
  assert.match(body, /isNew\s*$|isNew$|\bisNew\b/m, 'the message must branch on it.');
});

test('it is enforced on BOTH write paths', () => {
  for (const name of ['createThread', 'createPost']) {
    const s = code.slice(code.indexOf(`export async function ${name}`));
    const body = s.slice(0, s.indexOf('\nexport '));
    assert.match(body, /assertWithinRateLimit\(db, user,/,
      `${name} must be throttled — a limit on one write path is not a limit.`);
  }
});
