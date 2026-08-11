/**
 * Pins the Feed ranker (src/server/services/forumRanker.js).
 *
 * Two kinds of test here, and the first kind is the unusual one:
 *
 *  1. A SOURCE test that asserts the forbidden engagement signals (§5.4) do not
 *     appear in the ranker's code. Objectives drift by accretion — someone adds
 *     "just view count" to break a tie and the objective function has quietly
 *     changed. This makes that a build failure instead of a code-review opinion.
 *
 *  2. Behaviour tests for the ORDERING RULES. These do not claim the weights are
 *     right — weights need real traffic to tune. They claim the *shape* is right:
 *     an unanswered question climbs with age, a resolved one leaves, an ignored
 *     one fades, and no single author can own the page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  need, fit, quality, dampen, scoreThread, rank, explain, RANKERS, DEFAULT_RANKER,
} from '../src/server/services/forumRanker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RANKER_SRC = join(__dirname, '..', 'src', 'server', 'services', 'forumRanker.js');

/** Strip comments — the forbidden terms are DOCUMENTED in this file on purpose. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments (incl. the forbidden-signal list)
    .replace(/^\s*\/\/.*$/gm, '');      // line comments
}

// ── 1. the ship gate ──────────────────────────────────────────────────────

test('§5.4 — no forbidden engagement signal appears in the ranker code', () => {
  const code = codeOnly(readFileSync(RANKER_SRC, 'utf8'));
  const forbidden = [
    'viewCount', 'view_count', 'views',
    'dwell', 'timeOnPage', 'time_on_page', 'sessionLength',
    'followerCount', 'follower_count', 'followers',
    'clickThrough', 'ctr', 'engagement',
    'trending', 'popularity', 'virality',
  ];
  for (const term of forbidden) {
    assert.ok(
      !new RegExp(`\\b${term}\\b`, 'i').test(code),
      `forbidden signal "${term}" found in forumRanker.js — §5.4 forbids it. ` +
      'Change the spec and argue with §5.4 before adding it.',
    );
  }
});

test('the forbidden list is actually documented in the file (not silently dropped)', () => {
  // If someone deletes the comment block, the gate above still passes but the
  // REASON is gone. Pin the documentation too.
  const source = readFileSync(RANKER_SRC, 'utf8');
  assert.match(source, /FORBIDDEN SIGNALS/);
  assert.match(source, /minimize TIME-TO-RESOLUTION/);
});

// ── 2. need — the inversion that makes this a forum ───────────────────────

const qa = (over = {}) => ({
  id: 't1', spaceKind: 'qa', createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(), tags: [], answerCount: 0,
  isResolved: false, status: 'open', score: 0, bodyLength: 200, ...over,
});

test('an unanswered question GAINS urgency as it ages', () => {
  const now = Date.now();
  const fresh = need(qa({ createdAt: new Date(now - 1 * 3600e3).toISOString() }), now);
  const old = need(qa({ createdAt: new Date(now - 72 * 3600e3).toISOString() }), now);
  assert.ok(old.value > fresh.value, `old(${old.value}) must exceed fresh(${fresh.value})`);
  assert.ok(old.reasons.includes('unanswered_and_waiting'));
});

test('...but is capped, so an ancient thread cannot dominate forever', () => {
  const now = Date.now();
  const ancient = need(qa({ createdAt: new Date(now - 24 * 365 * 3600e3).toISOString() }), now);
  assert.ok(ancient.value <= 3, `capped, got ${ancient.value}`);
});

test('a RESOLVED question effectively leaves the Feed', () => {
  const r = need(qa({ isResolved: true }));
  assert.ok(r.value < 0.1, `resolved need should be ~0, got ${r.value}`);
});

test('answered-but-not-accepted sits between the two', () => {
  const answered = need(qa({ answerCount: 2 })).value;
  assert.ok(answered < need(qa()).value);
  assert.ok(answered > need(qa({ isResolved: true })).value);
});

test('feedback scales with DISTINCT reporters, not reply count', () => {
  const one = need({ ...qa(), spaceKind: 'feedback', distinctParticipants: 1 }).value;
  const many = need({ ...qa(), spaceKind: 'feedback', distinctParticipants: 6 }).value;
  assert.ok(many > one);
  // reply count must not move it
  const loud = need({ ...qa(), spaceKind: 'feedback', distinctParticipants: 1, postCount: 200 }).value;
  assert.equal(loud, one, 'reply count must not affect need');
});

// ── fit — matchmaking, with a floor so a new user sees something ──────────

test('a brand-new viewer still gets a non-zero fit (or the feed is empty on day one)', () => {
  const f = fit(qa({ tags: ['product:canvas'] }), {});
  assert.ok(f.value > 0, 'fit must have a floor');
});

test('expertise in the thread tags raises fit', () => {
  const t = qa({ tags: ['product:canvas'] });
  const novice = fit(t, {}).value;
  const expert = fit(t, { expertiseTags: { 'product:canvas': 3 } });
  assert.ok(expert.value > novice);
  assert.ok(expert.reasons.includes('matches_your_expertise'));
});

test('an explicit subscription counts, and is reported', () => {
  const f = fit(qa({ tags: ['topic:webgl'] }), { subscribedTags: ['topic:webgl'] });
  assert.ok(f.reasons.includes('you_follow_this_topic'));
});

// ── quality ──────────────────────────────────────────────────────────────

test('a well-specified thread outranks a bare one', () => {
  const bare = quality(qa({ tags: [], bodyLength: 20 })).value;
  const good = quality(qa({ tags: ['product:canvas', 'version:0.36.0'], hasCodeBlock: true, bodyLength: 400 })).value;
  assert.ok(good > bare, `${good} should exceed ${bare}`);
});

test('untagged is penalised and duplicates are pushed down', () => {
  assert.ok(quality(qa({ tags: [] })).reasons.includes('untagged'));
  assert.ok(quality(qa({ status: 'duplicate', tags: ['kind:bug'] })).value
    < quality(qa({ tags: ['kind:bug'] })).value);
});

// ── dampen — the anti-nag inversion ──────────────────────────────────────

test('an item shown repeatedly and never opened FADES', () => {
  const t = qa();
  const once = dampen(t, { impressions: { t1: { shownCount: 1, opened: false } } }).value;
  const many = dampen(t, { impressions: { t1: { shownCount: 6, opened: false } } }).value;
  assert.ok(many < once, 'repeated-but-ignored must decay');
});

test('an item already opened nearly disappears', () => {
  const d = dampen(qa(), { impressions: { t1: { shownCount: 2, opened: true } } });
  assert.ok(d.value < 0.2, `opened should be heavily damped, got ${d.value}`);
});

// ── the multiplicative property ──────────────────────────────────────────

test('MULTIPLICATIVE: a resolved thread cannot accumulate its way back in', () => {
  const viewer = { expertiseTags: { 'product:canvas': 10 }, subscribedTags: ['product:canvas'] };
  const resolved = scoreThread(qa({ isResolved: true, tags: ['product:canvas'] }), viewer);
  const unanswered = scoreThread(qa({ tags: [] }), {});
  assert.ok(resolved.score < unanswered.score,
    'perfect fit must not rescue a resolved thread — that is the point of multiplying');
});

// ── explainability is a SHIP GATE (D11) ──────────────────────────────────

test('every ranked item carries a human-readable reason', () => {
  const threads = [qa({ id: 'a', tags: ['product:canvas'] }), qa({ id: 'b', tags: ['kind:bug'] })];
  const out = rank(threads, { expertiseTags: { 'product:canvas': 2 } });
  assert.ok(out.length > 0);
  for (const item of out) {
    assert.ok(typeof item.why === 'string' && item.why.length > 0,
      `every item must explain itself — "${item.id}" did not`);
    assert.ok(Array.isArray(item.reasons) && item.reasons.length > 0);
  }
});

test('explain() produces prose, not codes', () => {
  const text = explain(['unanswered_and_waiting', 'matches_your_expertise'], {});
  assert.match(text, /Unanswered/);
  assert.ok(!text.includes('_'), `should not leak reason codes: "${text}"`);
});

// ── diversity guard ──────────────────────────────────────────────────────

test('no single author can own the page', () => {
  const threads = Array.from({ length: 12 }, (_, i) =>
    qa({ id: `t${i}`, authorId: 'loud', tags: ['kind:bug'] }));
  const out = rank(threads, {}, { limit: 10 });
  const byLoud = out.filter((t) => t.authorId === 'loud').length;
  assert.ok(byLoud <= 3, `one author took ${byLoud} slots`);
});

// ── rankers ──────────────────────────────────────────────────────────────

test('newest is a pure chronological escape hatch (no scoring at all)', () => {
  const now = Date.now();
  const threads = [
    qa({ id: 'old', createdAt: new Date(now - 90000e3).toISOString() }),
    qa({ id: 'new', createdAt: new Date(now).toISOString() }),
  ];
  const out = rank(threads, {}, { ranker: 'newest' });
  assert.equal(out[0].id, 'new');
});

test('my-topics only shows subscribed tags', () => {
  const threads = [qa({ id: 'in', tags: ['topic:webgl'] }), qa({ id: 'out', tags: ['topic:other'] })];
  const out = rank(threads, { subscribedTags: ['topic:webgl'] }, { ranker: 'my-topics' });
  assert.deepEqual(out.map((t) => t.id), ['in']);
});

test('the default ranker is the resolution-seeking one', () => {
  assert.equal(DEFAULT_RANKER, 'unsolved-for-me');
  assert.ok(Object.keys(RANKERS).includes('unsolved-for-me'));
  // No ranker may be named for engagement.
  for (const key of Object.keys(RANKERS)) {
    assert.ok(!/trend|popular|hot|viral/i.test(key), `ranker "${key}" is named for engagement`);
  }
});

// ── D11: explain() must NEVER return empty ────────────────────────────────
// Found in integration: a resolved thread produced no reason text, so the Feed
// would have rendered an item with a blank "why". The gate is only a gate if it
// holds for every state need() can emit — including the boring ones.

test('explain() covers EVERY state reason need() can emit', () => {
  const states = [
    ['qa unanswered', { spaceKind: 'qa' }],
    ['qa resolved', { spaceKind: 'qa', isResolved: true }],
    ['qa answered', { spaceKind: 'qa', answerCount: 2 }],
    ['feedback', { spaceKind: 'feedback', distinctParticipants: 1 }],
    ['discussion', { spaceKind: 'discussion' }],
    ['showcase', { spaceKind: 'showcase' }],
    ['announcement', { spaceKind: 'announcement' }],
  ];
  for (const [label, over] of states) {
    const t = { id: 'x', createdAt: new Date().toISOString(), tags: [], answerCount: 0, ...over };
    const s = scoreThread(t, {});
    const text = explain(s.reasons, t);
    assert.ok(text && text.length > 0, `"${label}" produced no explanation`);
    assert.ok(!text.includes('_'), `"${label}" leaked a reason code: ${text}`);
  }
});

test('explain() falls back rather than returning empty for an unknown reason', () => {
  assert.ok(explain(['something_unmapped'], {}).length > 0);
  assert.ok(explain([], {}).length > 0);
});
