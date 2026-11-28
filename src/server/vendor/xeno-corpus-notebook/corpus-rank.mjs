/**
 * corpus-rank.mjs — the PURE ranking core Corpus search and the Chat notebook share.
 *
 * BM25 scoring with a half-weight stem channel and a whole-word phrase bonus, the tokenizer, the
 * query stopwords, Porter stemming, paragraph splitting and corpus statistics. No files, no network,
 * no state beyond a per-process stem memo: imports only node: builtins and the vendored Porter
 * stemmer (MIT original, itself import-free). test/rank.test.mjs fails if that ever changes, because
 * XENO Platform vendors this module byte-identical into the server (notebooks in XENO Chat,
 * docs/specs/2026-11-27-notebooks-in-chat.md) and must not pull the filesystem corpus in with it.
 *
 * Moved VERBATIM out of corpus-search.mjs on 2026-11-27: the saved search index fingerprints
 * tokenize, stem, porter and paragraphsOf by their source text, so an edited copy would discard
 * every saved index and a re-typed one could drift from what search actually runs.
 */
import { stemmer as porter } from "./vendor/porter-stemmer/index.mjs";
export { porter };   // the search index fingerprint includes it

// ------------------------------------------------------------------ Ranker interface
/**
 * A ranker scores (query, passage) pairs. It is PURE and SYNCHRONOUS in v0: no network, no
 * model download, no side effects — so retrieval stays runnable offline and in CI.
 * @typedef {{ name: string, prepare(query: string): any, score(prepared: any, text: string, stats: object): number }} Ranker
 */
/**
 * THE lexical score, from counts: a passage's length, a term → frequency lookup, a stem → frequency
 * lookup and its lower-cased text (asked for only when the phrase must be checked). The raw-text
 * ranker and the inverted index (Lexicon) BOTH call this, so they cannot disagree — not even in the
 * order floating-point terms are added.
 */
export function bm25FromCounts(q, len, tfOf, stfOf, lowerOf, stats) {
  if (!q.terms.length || !len) return 0;
  const k1 = 1.2, b = 0.75, avg = stats.avgLen || 1;
  const bm25 = (f, df) => Math.log(1 + (stats.n - df + 0.5) / (df + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avg));
  let s = 0;
  for (const term of q.terms) {
    const f = tfOf(term);
    if (f) s += bm25(f, stats.df.get(term) ?? 0);
  }
  // Morphological channel at HALF weight, and only for query terms the surface channel did
  // not already match — so "stores" still finds "storage", but an exact match can never be
  // outranked by a stemmed one, and a term is never counted twice.
  if (q.stems && stats.sdf) {
    for (const term of q.terms) {
      if (tfOf(term)) continue;
      const st = stem(term), f = stfOf(st);
      if (f) s += 0.5 * bm25(f, stats.sdf.get(st) ?? 0);
    }
  }
  // A whole-word phrase can occur only where every one of its (indexed) words does: the tokenizer splits
  // on the very boundaries the phrase pattern requires. So the counts already in hand rule most items
  // out, and the text is derived only for the rest (exact: it skips only items the pattern cannot match).
  if (q.phraseRe && (q.phraseTerms ?? []).every((t) => tfOf(t) > 0) && q.phraseRe.test(lowerOf())) s += 2;
  return s;
}

/** Every RegExp metacharacter escaped, so user text can sit inside a pattern literally. */
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const RANKERS = {
  lexical: {
    name: "lexical",
    // The phrase bonus matches WHOLE words: "data base" no longer earns it inside "metadata baseline",
    // a passage that shares no query word — which was a substring accident, and one an inverted index
    // (a passage is a candidate only through a query word) could never reproduce. Changed 2026-10-24.
    prepare: (query) => {
      const phrase = query.trim().toLowerCase();
      // Word boundaries are the TOKENIZER's (it keeps . # - inside words): "base" is not a whole word
      // of "data-base", so a phrase can only match where the index can see its words.
      const phraseRe = phrase.length > 3 ? new RegExp("(?<![a-z0-9_.#-])" + escapeRegExp(phrase) + "(?![a-z0-9_.#-])") : null;
      const terms = queryTerms(query);
      return { terms, stems: uniq(terms.map(stem)), phrase, phraseRe, phraseTerms: uniq(tokenize(phrase)).filter((t) => terms.includes(t)) };
    },
    // BM25-shaped without the corpus statistics a real BM25 needs across restarts: term
    // frequency saturates, rare terms weigh more (idf over the passages scanned in THIS
    // call), an exact phrase match adds a fixed bonus. Deterministic for a given input.
    // `pre` = the text already analysed ({ toks, stems, lower }, from the search cache): the SAME
    // computation on the same tokens, so a cached and an uncached score cannot differ.
    score: (q, text, stats, pre = null) => {
      if (!q.terms.length) return 0;
      const toks = pre?.toks ?? tokenize(text);
      if (!toks.length) return 0;
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      let stf = null;
      const stfOf = (st) => {
        if (!stf) { stf = new Map(); for (const x of pre?.stems ?? toks.map(stem)) stf.set(x, (stf.get(x) ?? 0) + 1); }
        return stf.get(st) ?? 0;
      };
      return bm25FromCounts(q, toks.length, (t) => tf.get(t) ?? 0, stfOf, () => pre?.lower ?? text.toLowerCase(), stats);
    },
    // The most any passage could score for this query: every term matched at saturation (BM25's
    // per-term ceiling is idf × (k1+1) at any length) plus the phrase bonus. Hybrid fusion divides
    // by it, so a lexical score becomes "how much of the question this passage matched" — a
    // passage sharing one common word with a five-word query is worth a fifth, not a first place.
    maxScore: (q, stats) => {
      const k1 = 1.2;
      let m = 0;
      for (const term of q.terms) { const df = stats.df.get(term) ?? 0; m += Math.log(1 + (stats.n - df + 0.5) / (df + 0.5)) * (k1 + 1); }
      return m + (q.phrase.length > 3 ? 2 : 0);
    },
  },
};
/** Declared, not implemented: an embedding ranker plugs in HERE and nowhere else. Until one
 *  is registered, asking for it is a clear refusal, not a silent fallback to lexical — a
 *  caller comparing rankers must never be handed the other one unannounced. */
export function rankerFor(name = "lexical") {
  const r = RANKERS[name];
  if (!r) throw new Error(`RANKER_UNAVAILABLE: "${name}" — available: ${Object.keys(RANKERS).join(", ")}. An embedding ranker registers in RANKERS; there is no fallback.`);
  return r;
}

export const tokenize = (s) => String(s).toLowerCase().split(/[^a-z0-9_.#-]+/).map((t) => t.replace(/^[.#-]+|[.#-]+$/g, "")).filter((t) => t.length >= 2);
/**
 * Stopwords are dropped from the QUERY only, never from passages (so phrase matching and spans
 * are untouched). This is the `english_stop` step of Elasticsearch's `english` analyzer, so a
 * question word ("what", "how", "does") never earns a passage a match. A query of ONLY stopwords
 * keeps them, so "is it" still searches.
 *
 * ⚠️ It did NOT fix the case that prompted it, and a first draft of this comment said it did.
 * "what database stores orders" still ranks a retry-limit line above the storage decision,
 * measured after the change: every README paragraph inherits the heading `# orders` and so
 * matches "orders" EXACTLY, while the storage decision matches only through stems at half
 * weight — and Porter does not unify `store`/`storage`. That is the semantic gap, not a
 * tokenizer defect, and the scoreboard reports it as such.
 */
export const STOP = new Set(("a an and are as at be but by for from has have how i if in into is it its of on or " +
  "that the their then there these this to was were what when where which who why will with does do can " +
  "should would could we you our your my me").split(" "));
export const queryTerms = (q) => { const all = uniq(tokenize(q)); const kept = all.filter((t) => !STOP.has(t)); return kept.length ? kept : all; };
export const uniq = (a) => [...new Set(a)];

// ------------------------------------------------------------------ morphology
/**
 * Porter stemming, so "stores orders" meets "order storage". Measured (bench/scoreboard.mjs):
 * without it, a query for the CURRENT decision matched only the RETIRED one, because the retired
 * entry happened to say "store orders" verbatim. Lucene and Elasticsearch ship Porter in their
 * default English analyzer for exactly this reason.
 *
 * ⚠️ A hand-written suffix stripper was tried first and split `stores`/`store` and
 * `orders`/`order` — the very pair the probe needs. Porter (1980) is the vendored MIT original
 * (vendor/porter-stemmer), not a re-derivation.
 *
 * Identifiers stay exact: anything with a digit, dot, underscore, `#` or `-` is never stemmed
 * (`refund.js`, `STAGING_PORT`, `v1.2.3`). And a stem is scored ALONGSIDE the surface form,
 * never instead of it, so an exact match always outranks a morphological one.
 */
const stems = new Map();
export function stem(t) {
  if (t.length <= 3 || /[0-9_.#-]/.test(t)) return t;
  // Porter is pure: memoised per process (it was the largest single cost of a warm documents query)
  let s = stems.get(t);
  if (s === undefined) { s = porter(t); if (stems.size < 500_000) stems.set(t, s); }
  return s;
}

/** Paragraphs with line spans. A blank line separates paragraphs; a heading is its own. */
export function paragraphsOf(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let buf = [], start = 0;
  const flush = (end) => { if (buf.length) out.push({ startLine: start + 1, endLine: end, text: buf.join("\n") }); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) { flush(i); start = i + 1; continue; }
    if (/^#{1,6}\s/.test(l)) { flush(i); start = i; buf.push(l); flush(i + 1); start = i + 1; continue; }
    if (!buf.length) start = i;
    buf.push(l);
  }
  flush(lines.length);
  return out;
}

/** The statistics a lexical ranker scores against: how many texts, document frequency of each
 *  surface term and of each stem, and the average length. One definition for passages, claims and
 *  whole notes, so a score means the same thing at every granularity. */
export function corpusStats(texts) {
  const df = new Map(), sdf = new Map();
  let total = 0;
  for (const item of texts) {
    // a string, or an item already analysed by the search cache ({ toks, stems })
    const toks = typeof item === "string" ? tokenize(item) : item.toks; total += toks.length;
    for (const term of uniq(toks)) df.set(term, (df.get(term) ?? 0) + 1);
    for (const st of uniq(typeof item === "string" ? toks.map(stem) : item.stems)) sdf.set(st, (sdf.get(st) ?? 0) + 1);
  }
  return { n: texts.length, df, sdf, total, avgLen: texts.length ? total / texts.length : 1 };
}
