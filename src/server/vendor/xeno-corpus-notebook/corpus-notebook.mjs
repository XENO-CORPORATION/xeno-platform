/**
 * corpus-notebook.mjs — the Corpus half of notebooks in XENO Chat (docs/specs/2026-11-27-notebooks-in-chat.md,
 * agreed with XENO - PLATFORM 2026-11-27).
 *
 * Three PURE calls. No database, no network, no files, no binaries: the platform extracts (poppler, tesseract,
 * mammoth), authorises every passage at read time, records what the model was given in
 * chat_message_context_manifests, and calls these over that data.
 *
 *   ingest({ sourceId, sections, extractor })    sections the platform extracted → passages with anchors and hashes
 *   retrieve({ question, passages, budget })     authorised passages → what the model is given, and in which mode
 *   cite(answerText, given)                      an answer's citation marks → citations, uncited sentences, refusals
 *
 * The two rules the contract rests on:
 *   - an answer may cite ONLY a passage it was given. A mark naming anything else is REFUSED and listed, never shown
 *     as a citation (`ok: false`), so an invented citation cannot reach the person.
 *   - "nothing could be read" is never "no results" (D22): a source with no text is a refusal with its reason.
 *
 * Source text is untrusted evidence, never instructions: every passage handed to a model carries that label.
 */
import { createHash } from "node:crypto";
import { rankerFor, corpusStats, paragraphsOf } from "./corpus-rank.mjs";

/** Bumped whenever passage boundaries or ids would change for the same input; the platform stores it and marks older ones stale. */
export const PASSAGE_VERSION = "notebook-passages/1";
/** A passage longer than this is split at sentence ends, so a citation points at a readable span. */
export const MAX_PASSAGE_CHARS = 1600;
/** Rough token count (4 characters a token), the same estimate the rest of Corpus budgets with. */
export const tokensOf = (s) => Math.ceil(String(s).length / 4);
export const TRUST = "untrusted-evidence";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const isStr = (s) => typeof s === "string";
const refusal = (code, why) => ({ refusal: { code, why } });

/** Split one over-long block at sentence ends (never mid-word), keeping offsets into the section. */
function splitLong(text, startOffset) {
  if (text.length <= MAX_PASSAGE_CHARS) return [{ text, offset: startOffset }];
  const out = [];
  let from = 0;
  while (from < text.length) {
    let end = Math.min(text.length, from + MAX_PASSAGE_CHARS);
    if (end < text.length) {
      const window = text.slice(from, end);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("\n"));
      if (cut > MAX_PASSAGE_CHARS / 3) end = from + cut + 1;
      else { const sp = window.lastIndexOf(" "); if (sp > MAX_PASSAGE_CHARS / 3) end = from + sp; }
    }
    const piece = text.slice(from, end);
    const lead = piece.length - piece.trimStart().length;
    if (piece.trim()) out.push({ text: piece.trim(), offset: startOffset + from + lead });
    from = end;
  }
  return out;
}

/**
 * ingest — sections the platform's extractor produced → passages.
 * sections: [{ text, locator: { format, page?, heading?, method? } }]; extractor: { id, version }.
 * A passage's anchor is where a citation opens: the page (PDF), the nearest heading (markdown, or docx once it is
 * extracted with headings), and the character offset inside its section. Its id is derived from the source, the
 * passage version, the anchor and the text, so re-ingesting unchanged content gives the same ids.
 */
export function ingest({ sourceId, sections, extractor } = {}) {
  if (!isStr(sourceId) || !sourceId.trim()) return refusal("NOTEBOOK_SOURCE_ID", "a source id is required");
  if (!Array.isArray(sections)) return refusal("NOTEBOOK_SECTIONS", "sections must be a list of {text, locator}");
  if (!extractor || !isStr(extractor.id) || !isStr(String(extractor.version ?? ""))) return refusal("NOTEBOOK_EXTRACTOR", "the extractor that produced the sections must be named");
  const passages = [];
  sections.forEach((sec, si) => {
    if (!sec || !isStr(sec.text)) return;
    const loc = sec.locator ?? {};
    const text = sec.text.replace(/\r\n?/g, "\n");
    // Offsets of each line, so a paragraph's anchor is a character offset in its section.
    const lineStart = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStart.push(i + 1);
    let heading = isStr(loc.heading) && loc.heading.trim() ? loc.heading.trim() : null;
    const pushPiece = (piece) => {
      const anchor = { section: si, offset: piece.offset };
      if (loc.page != null) anchor.page = loc.page;
      if (heading) anchor.heading = heading;
      const hash = sha256(piece.text);
      const id = "p_" + sha256([sourceId, PASSAGE_VERSION, si, piece.offset, hash].join("\u0000")).slice(0, 24);
      passages.push({ id, sourceId, text: piece.text, anchor, sha256: hash });
    };
    for (const [pi, p] of paragraphsOf(text).entries()) {
      const h = /^#{1,6}\s+(.*)$/.exec(p.text);
      // a docx section (mammoth, with headings) starts with its heading line as plain text: it is the anchor, not a passage
      if (pi === 0 && heading && p.startLine === p.endLine && p.text.trim() === heading) continue;
      // …and its body follows on the next lines with no blank line between, so the heading line comes off the front
      if (pi === 0 && heading && p.text.startsWith(heading + "\n")) {
        const body = p.text.slice(heading.length + 1);
        for (const piece of splitLong(body, (lineStart[p.startLine - 1] ?? 0) + heading.length + 1)) pushPiece(piece);
        continue;
      }
      if (h && p.startLine === p.endLine) { heading = h[1].trim(); continue; }   // a heading anchors what follows it
      for (const piece of splitLong(p.text, lineStart[p.startLine - 1] ?? 0)) pushPiece(piece);
    }
  });
  if (!passages.length) {
    const why = sections.length ? "the extractor returned no readable text for this source" : "the extractor returned no sections";
    return refusal("NOTEBOOK_SOURCE_EMPTY", why);
  }
  return { sourceId, passages, passageVersion: PASSAGE_VERSION, extractor: { id: extractor.id, version: String(extractor.version) } };
}

/**
 * retrieve — what the model is given for one question, from passages the platform has ALREADY authorised for the
 * caller. Mode "full" when every passage fits the budget (the model sees all of them, in source order), "retrieval"
 * otherwise (ranked, best first, filled to the budget). The mode is returned so the person can be shown it.
 */
export function retrieve({ question, passages, budget } = {}) {
  if (!isStr(question) || !question.trim()) throw new Error("NOTEBOOK_QUESTION: a question is required");
  if (!Array.isArray(passages)) throw new Error("NOTEBOOK_PASSAGES: passages must be a list");
  if (!Number.isFinite(budget) || budget < 1) throw new Error("NOTEBOOK_BUDGET: a positive token budget is required");
  const clean = passages.filter((p) => p && isStr(p.passageId ?? p.id) && isStr(p.text) && p.text.trim())
    .map((p) => ({ passageId: p.passageId ?? p.id, sourceId: p.sourceId, text: p.text, anchor: p.anchor ?? null, context: isStr(p.anchor?.heading) ? p.anchor.heading : "" }));
  const total = clean.reduce((n, p) => n + tokensOf(p.text), 0);
  const label = (p, score) => ({ passageId: p.passageId, sourceId: p.sourceId, text: p.text, anchor: p.anchor, score, trust: TRUST });
  if (total <= budget) return { mode: "full", passages: clean.map((p) => label(p, null)), considered: clean.length, tokens: total };
  const R = rankerFor("lexical");
  const q = R.prepare(question);
  const scored = clean.map((p) => (p.context ? p.context + " " : "") + p.text);
  const stats = corpusStats(scored);
  const ranked = clean.map((p, i) => ({ p, s: R.score(q, scored[i], stats) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.passageId.localeCompare(b.p.passageId));
  const out = [];
  let used = 0;
  for (const { p, s } of ranked) {
    const t = tokensOf(p.text);
    if (used + t > budget) continue;
    out.push(label(p, Math.round(s * 1000) / 1000));
    used += t;
  }
  return { mode: "retrieval", passages: out, considered: clean.length, matched: ranked.length, tokens: used };
}

/** Sentence spans of an answer, with each one's offsets, so a citation mark is attached to the sentence it ends. */
function sentencesOf(text) {
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+|\n|$)(?:\s*\[(?:\d+|passage:[^\]]+)\])*/g;
  let m;
  while ((m = re.exec(text))) { if (!m[0].trim()) { if (re.lastIndex === m.index) re.lastIndex++; continue; } out.push({ text: m[0].trim(), start: m.index, end: m.index + m[0].length }); }
  return out;
}

/**
 * cite — an answer's citation marks, checked against what the model was GIVEN (in order, as recorded in the
 * message's context manifest). A mark is `[n]` (the n-th given passage, from 1) or `[passage:<id>]`.
 * given: [{ passageId, sourceId, anchor }] or [passageId].
 * Returns every valid citation, the sentences with none, and every refused mark with why. `ok` is false when any
 * mark was refused: the platform must not show those as citations.
 */
export function cite(answerText, given) {
  if (!isStr(answerText)) throw new Error("NOTEBOOK_ANSWER: the answer text is required");
  if (!Array.isArray(given)) throw new Error("NOTEBOOK_GIVEN: the passages the model was given are required");
  const list = given.map((g) => (isStr(g) ? { passageId: g } : g)).filter((g) => g && isStr(g.passageId));
  const byId = new Map(list.map((g, i) => [g.passageId, { g, n: i + 1 }]));
  const citations = [], refused = [], uncited = [];
  for (const s of sentencesOf(answerText)) {
    const marks = [...s.text.matchAll(/\[(\d+|passage:([^\]]+))\]/g)];
    if (!marks.length) { uncited.push(s.text); continue; }
    for (const m of marks) {
      let hit = null;
      if (m[2] != null) hit = byId.get(m[2].trim()) ?? null;
      else { const n = Number(m[1]); if (Number.isInteger(n) && n >= 1 && n <= list.length) hit = { g: list[n - 1], n }; }
      if (!hit) { refused.push({ mark: m[0], sentence: s.text, why: m[2] != null ? "names a passage the model was not given" : `there is no given passage ${m[1]} (the model was given ${list.length})` }); continue; }
      citations.push({ n: hit.n, mark: m[0], passageId: hit.g.passageId, sourceId: hit.g.sourceId ?? null, anchor: hit.g.anchor ?? null, sentence: s.text });
    }
  }
  return { ok: refused.length === 0, citations, uncited, refused };
}
