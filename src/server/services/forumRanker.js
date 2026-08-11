/**
 * The Feed ranker.
 *
 * ⚠️ THIS IS THE ONLY FILE IN THE FORUM ALLOWED TO COMPUTE A RANKING SCORE.
 * That is deliberate: it makes "did someone smuggle an engagement signal in?" a
 * one-file question, and `scripts/forum-ranker-signals.test.mjs` reads this
 * source and fails if a forbidden signal appears in it.
 *
 * ── THE OBJECTIVE FUNCTION (D3) ─────────────────────────────────────────────
 *
 *   minimize TIME-TO-RESOLUTION.   never   maximize TIME-ON-SITE.
 *
 * Ranking was never what broke social media — the objective was. An
 * engagement-maximising ranker produces outrage and addiction because that is
 * literally what it was asked to produce. Every signal below has to be
 * justifiable as "this helps a question get answered sooner".
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 *
 *   score(T,V) = need(T) × fit(T,V) × quality(T) × dampen(T,V)
 *
 * MULTIPLICATIVE on purpose. A thread with no need, or no relevance to you,
 * should be ABSENT — not merely lower. Additive scoring lets a loud, irrelevant
 * thread accumulate its way onto your screen, which is precisely how feeds go
 * wrong.
 *
 * Scored in JS rather than SQL so every component is unit-testable in isolation
 * and every placement can be explained (D11).
 */

/**
 * 🔴 FORBIDDEN SIGNALS (§5.4). These may never appear in this file.
 *
 *   view count        — measures attention, not usefulness
 *   dwell / time-on-page — literally the metric we refuse to optimise
 *   reply count as a POSITIVE in qa — 200 replies with no accepted answer is a
 *                       FAILURE. (Neutral in `discussion`, where argument is
 *                       the point; used in `feedback` only as DISTINCT
 *                       reporters, which measures breadth of impact, not noise.)
 *   follower count    — does not exist (D4) and must not be invented
 *   recency alone     — may break ties only; it is not evidence of value
 *
 * The test asserts the absence of these identifiers. If you need one, change the
 * spec first and argue with §5.4 — do not add it here quietly.
 */

const HOUR = 3600 * 1000;

// --------------------------------------------------------------------------
// need — how much does this thread need a person?
// --------------------------------------------------------------------------

/**
 * The inversion that makes this a forum and not a timeline: an unanswered
 * question GAINS urgency as it ages. On a feed, an old unanswered post dies
 * quietly. Here it climbs until somebody closes it.
 */
export function need(thread, now = Date.now()) {
  const reasons = [];
  const kind = thread.spaceKind;
  const ageHours = Math.max(0, (now - new Date(thread.createdAt).getTime()) / HOUR);

  if (kind === 'qa') {
    if (thread.isResolved) {
      reasons.push('resolved');
      return { value: 0.05, reasons };  // effectively leaves the Feed; lives on in search
    }
    if (thread.answerCount > 0) {
      reasons.push('answered_not_accepted');
      return { value: 0.6, reasons };
    }
    // Unanswered: 1.0 → ~3.0 over roughly a week, then flat. Capped so a very
    // old unanswered thread cannot dominate forever — at that point it is a
    // triage problem, not a ranking one.
    const urgency = Math.min(3, 1 + Math.log1p(ageHours) / 2.2);
    reasons.push(urgency > 1.5 ? 'unanswered_and_waiting' : 'unanswered');
    return { value: urgency, reasons };
  }

  if (kind === 'feedback') {
    // DISTINCT reporters — breadth of impact. Never reply count, which measures
    // how loud a thread got.
    const distinct = Math.max(1, thread.distinctParticipants || 1);
    reasons.push(distinct > 2 ? 'many_people_hit_this' : 'feedback');
    return { value: Math.min(2.5, 0.5 + distinct * 0.35), reasons };
  }

  if (kind === 'discussion') { reasons.push('discussion'); return { value: 0.35, reasons }; }
  if (kind === 'showcase') { reasons.push('showcase'); return { value: 0.25, reasons }; }
  reasons.push('announcement');
  return { value: 0.3, reasons };
}

// --------------------------------------------------------------------------
// fit — can THIS viewer close it?
// --------------------------------------------------------------------------

/**
 * The heart of the thing. The Feed's job is matchmaking between a question and
 * the person or agent most able to answer it — not broadcasting the day's
 * loudest item to everybody.
 *
 * A floor of 0.35 exists so a brand-new viewer with no history still sees
 * something. Without it, `fit = 0` would multiply their entire feed to nothing
 * and the product would appear broken on day one.
 */
export function fit(thread, viewer) {
  const reasons = [];
  let value = 0.35;

  const tags = thread.tags || [];
  const expertise = viewer.expertiseTags || {};   // tag → accepted answers
  const subscribed = new Set(viewer.subscribedTags || []);
  const recent = new Set(viewer.recentTags || []);
  const products = new Set(viewer.products || []);

  let matchedExpertise = 0;
  for (const tag of tags) if (expertise[tag]) matchedExpertise += expertise[tag];
  if (matchedExpertise > 0) {
    value += Math.min(1.2, matchedExpertise * 0.4);
    reasons.push('matches_your_expertise');
  }

  if (tags.some((t) => subscribed.has(t))) { value += 0.5; reasons.push('you_follow_this_topic'); }
  if (tags.some((t) => recent.has(t))) { value += 0.25; reasons.push('you_were_recently_active_here'); }

  // You can answer about the thing you actually run.
  if (tags.some((t) => t.startsWith('product:') && products.has(t.slice(8)))) {
    value += 0.4;
    reasons.push('a_product_you_use');
  }

  if (viewer.id && thread.authorId === viewer.id) { value += 0.3; reasons.push('your_thread'); }

  return { value, reasons };
}

// --------------------------------------------------------------------------
// quality — is this worth anyone's time?
// --------------------------------------------------------------------------

export function quality(thread) {
  const reasons = [];
  let value = 1;

  if (thread.authorTrust > 0) {
    value += Math.min(0.4, thread.authorTrust * 0.1);
    reasons.push('asked_by_a_trusted_contributor');
  }

  // Cheap heuristics that genuinely predict answerability. Someone who pasted the
  // error and named the version is far likelier to get an answer than someone who
  // wrote a title and pressed post.
  let completeness = 0;
  if ((thread.tags || []).length > 0) completeness += 1;
  if ((thread.tags || []).some((t) => t.startsWith('version:'))) completeness += 1;
  if (thread.hasCodeBlock) completeness += 1;
  if ((thread.bodyLength || 0) > 120) completeness += 1;
  if (completeness >= 3) { value += 0.25; reasons.push('well_specified'); }

  if ((thread.tags || []).length === 0) { value -= 0.25; reasons.push('untagged'); }
  if (thread.status === 'duplicate') { value -= 0.6; reasons.push('duplicate'); }
  if (thread.score < 0) { value -= 0.2; reasons.push('downvoted'); }

  return { value: Math.max(0.15, value), reasons };
}

// --------------------------------------------------------------------------
// dampen — anti-nag
// --------------------------------------------------------------------------

/**
 * The exact inverse of an engagement feed. Shown it repeatedly and never opened
 * it? It fades. Already opened it? It nearly disappears. An attention-maximising
 * system re-serves what you ignored; this one takes the hint.
 */
export function dampen(thread, viewer) {
  const reasons = [];
  const seen = viewer.impressions?.[thread.id];
  if (!seen) return { value: 1, reasons };

  if (seen.opened) { reasons.push('already_read'); return { value: 0.12, reasons }; }

  const ignored = Math.max(0, (seen.shownCount || 1) - 1);
  if (ignored === 0) return { value: 1, reasons };
  reasons.push('shown_before');
  return { value: 1 / (1 + 0.45 * ignored), reasons };
}

// --------------------------------------------------------------------------
// The rankers
// --------------------------------------------------------------------------

export const RANKERS = {
  'unsolved-for-me': 'Unsolved, matched to you',
  newest: 'Newest first',
  'deep-dives': 'Longer discussions',
  'my-topics': 'Topics you follow',
};

export const DEFAULT_RANKER = 'unsolved-for-me';

/** Score one thread and explain it. Exposed for direct unit testing. */
export function scoreThread(thread, viewer, now = Date.now()) {
  const n = need(thread, now);
  const f = fit(thread, viewer);
  const q = quality(thread);
  const d = dampen(thread, viewer);

  return {
    score: n.value * f.value * q.value * d.value,
    components: { need: n.value, fit: f.value, quality: q.value, dampen: d.value },
    reasons: [...n.reasons, ...f.reasons, ...q.reasons, ...d.reasons],
  };
}

/**
 * Turn reason codes into the sentence shown on the card.
 *
 * D11 makes this a SHIP GATE: if a placement cannot be explained, it does not
 * ship. "Why am I seeing this?" must always have an answer — that is the whole
 * difference between this and the thing we are replacing.
 */
const REASON_TEXT = {
  resolved: 'Resolved',
  showcase: 'Showcase',
  announcement: 'Announcement',
  newest: 'Newest',
  unanswered: 'Unanswered',
  unanswered_and_waiting: 'Unanswered and waiting',
  answered_not_accepted: 'Answered, not yet accepted',
  many_people_hit_this: 'Several people hit this',
  feedback: 'Feedback',
  discussion: 'Discussion',
  matches_your_expertise: 'matches your expertise',
  you_follow_this_topic: 'a topic you follow',
  you_were_recently_active_here: 'you were recently active here',
  a_product_you_use: 'a product you use',
  your_thread: 'your thread',
  asked_by_a_trusted_contributor: 'from a trusted contributor',
  well_specified: 'well specified',
  untagged: 'untagged',
  duplicate: 'marked duplicate',
  shown_before: 'shown before',
  already_read: 'already read',
};

// The state reasons, in the order they should be preferred as the headline.
// EXHAUSTIVE by construction: every branch of need() emits one of these, so a
// thread can never arrive here with no state to report.
const PRIMARY_REASONS = [
  'unanswered_and_waiting', 'unanswered', 'answered_not_accepted',
  'many_people_hit_this', 'feedback', 'discussion', 'showcase',
  'announcement', 'resolved', 'newest',
];

export function explain(reasons, thread) {
  const parts = [];

  const primary = PRIMARY_REASONS.find((r) => reasons.includes(r));
  if (primary) parts.push(REASON_TEXT[primary]);

  for (const r of ['matches_your_expertise', 'you_follow_this_topic', 'a_product_you_use', 'your_thread']) {
    if (reasons.includes(r)) { parts.push(REASON_TEXT[r]); break; }
  }
  if (thread?.waitingLabel) parts.push(thread.waitingLabel);

  // D11 is a SHIP GATE: an item with no explanation must never render. If the
  // reason codes produced nothing sayable that is a bug in need()/fit(), but the
  // user still gets an honest answer rather than a blank.
  if (parts.length === 0) {
    return reasons.length ? (REASON_TEXT[reasons[0]] || 'In the record') : 'In the record';
  }
  return parts.slice(0, 3).join(' · ');
}

/**
 * Rank a candidate set.
 *
 * The diversity guard runs AFTER scoring, as a selection pass: one hot thread
 * and one prolific author must not be able to own the page, however well they
 * score. Enforcing it inside the score would distort the score itself.
 */
export function rank(threads, viewer, { ranker = DEFAULT_RANKER, limit = 25, now = Date.now() } = {}) {
  if (ranker === 'newest') {
    return threads
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((t) => ({ ...t, why: 'Newest', reasons: ['newest'] }));
  }

  let pool = threads;
  if (ranker === 'my-topics') {
    const subs = new Set(viewer.subscribedTags || []);
    pool = threads.filter((t) => (t.tags || []).some((x) => subs.has(x)));
  } else if (ranker === 'deep-dives') {
    pool = threads.filter((t) => (t.postCount || 0) >= 3);
  }

  const scored = pool
    .map((t) => {
      const s = scoreThread(t, viewer, now);
      return { ...t, ...s, why: explain(s.reasons, t) };
    })
    // Recency is the TIE-BREAK only — never a ranking input of its own (§5.4).
    .sort((a, b) => (b.score - a.score) || (new Date(b.lastActivityAt) - new Date(a.lastActivityAt)));

  const perSpace = {}; const perAuthor = {}; const perTag = {};
  const out = [];
  for (const t of scored) {
    if (out.length >= limit) break;
    const space = t.spaceSlug || '_';
    const author = t.authorId || '_';
    const tag = (t.tags || [])[0] || '_';
    if ((perSpace[space] || 0) >= Math.max(3, Math.ceil(limit / 3))) continue;
    if ((perAuthor[author] || 0) >= 3) continue;
    if ((perTag[tag] || 0) >= Math.max(3, Math.ceil(limit / 3))) continue;
    perSpace[space] = (perSpace[space] || 0) + 1;
    perAuthor[author] = (perAuthor[author] || 0) + 1;
    perTag[tag] = (perTag[tag] || 0) + 1;
    out.push(t);
  }
  return out;
}
