/**
 * corpus-secret-rules.mjs — THE secret-gate rules: what a credential looks like in text or bytes, and
 * whether a finding BLOCKS or goes to REVIEW (D236). Pure: no imports at all, no filesystem, no
 * network — so xeno-platform vendors this file byte-identical and the hosted skills library refuses
 * exactly what the local store refuses. Findings carry a rule id, a severity and a line — NEVER the
 * matched value (a report that echoes a secret republishes it). Nothing here executes a file (D211).
 * The file-walking half (scanBundle, scanTree, the CLI) stays in corpus-secrets.mjs.
 */
/** How many findings of one rule a single file may report before the rest are only counted. A file
 *  of base64 image data would otherwise flood a sidecar with thousands of identical review lines. */
export const PER_FILE_RULE_CAP = 25;


/** Shannon entropy in bits per character. Random tokens are high; words and repeats are low. */
export function entropy(s) {
  if (!s) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) { const p = n / s.length; h -= p * Math.log2(p); }
  return h;
}

/** Values that are documentation, not credentials: `xxxx`, `...`, `<token>`, `your-key`, `example`. */
export const PLACEHOLDER = /x{4,}|\.\.\.|…|<[^>\n]*>|\*{3,}|\byour[_-]|example|placeholder|changeme|redacted|dummy|sample/i;

/** A value that REFERS to a credential rather than being one: `process.env.X`, `${VAR}`, `$env:X`. */
export function isCodeReference(v) {
  return /(?:\benv\b|environ|getenv|process\.|import\.meta|\$\{|^\$|%[A-Za-z_]+%|\bconfig\.)/i.test(v);
}

/** Random enough to be a credential when it sits after a credential-shaped key. */
export function looksRandom(v) {
  return v.length >= 20 && /[A-Za-z]/.test(v) && /[0-9]/.test(v) && entropy(v) >= 3.6;
}

const isMixedRandom = (t) =>
  t.length >= 32 && /[a-z]/.test(t) && /[A-Z]/.test(t) && /[0-9]/.test(t) && entropy(t) >= 4.0;

/** A provider key shape: the prefix is the evidence, so it blocks unless the value is a placeholder. */
const shape = (id, re, severity = "block") => ({
  id, re, classify: (m) => (PLACEHOLDER.test(m[0]) ? "review" : severity),
});

// The separator is ONE `:` or `=`, never `==`, `===` or `=>`: a comparison is not an assignment. (Measured
// 2026-10-08: `"password"===a.type` in a bundled library read as a password literal.) `pwd` is not a
// credential keyword — it is also the shell's print-working-directory, and a random one in binary data.
// The keyword may be part of a longer NAME (`OPENAI_API_KEY=`, npm's `_authToken=`), so the guard is
// "not preceded by a letter", not `\b`: an underscore is a word character to `\b` and would hide both.
const KEY_ASSIGN = /(?<![A-Za-z])((?:api[_-]?key|apikey|access[_-]?key|client[_-]?secret|secret[_-]?key|private[_-]?key|auth[_-]?token|secret|token|password|passwd))["']?\s*(?::|=(?![=>]))\s*["']?([^\s"'`<>{}()\[\];,$%]{8,})/gi;

function classifyAssignment(m) {
  const value = m[2];
  if (isCodeReference(value)) return null;               // reads a credential, does not contain one
  if (PLACEHOLDER.test(value)) return "review";
  if (/^(?:password|passwd|pwd)$/i.test(m[1])) return "block"; // a password literal is a credential
  return looksRandom(value) ? "block" : "review";
}

/** The rules, in the order they are applied. Each `re` MUST carry the `g` flag (matchAll needs it). */
export const RULES = Object.freeze([
  shape("private-key-block", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g),
  shape("anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g),
  shape("openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g),
  shape("xai-key", /\bxai-[A-Za-z0-9]{24,}/g),
  shape("github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g),
  shape("slack-token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g),
  shape("aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  shape("google-api-key", /\bAIza[0-9A-Za-z_-]{35}/g),
  shape("npm-token", /\bnpm_[A-Za-z0-9]{36}\b/g),
  shape("stripe-key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g),
  shape("xeno-key", /\bxeno-[A-Za-z0-9]{24,}\b/g),
  shape("bearer-literal", /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/g),
  { id: "key-assignment", re: KEY_ASSIGN, classify: classifyAssignment },
  // A long token with upper, lower and digits at real entropy. Paths and identifiers are excluded by
  // the character class (no `/`, no `.`), and lower-case hex digests cannot satisfy the mixed-case test.
  // Subresource-integrity hashes (`sha512-…` in every lockfile) are random by construction and are not
  // credentials; they are excluded by their prefix, not by loosening the test for everything else.
  { id: "high-entropy-token", re: /(?<![A-Za-z0-9_+-])[A-Za-z0-9_+-]{32,}(?![A-Za-z0-9_+-])/g,
    classify: (m) => (isMixedRandom(m[0]) && !/^sha(?:256|384|512)-/.test(m[0]) ? "review" : null) },
]);

/** Findings in one piece of text. Positions and rule ids only — the matched value is never returned. */
export function scanText(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 8) continue;
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        const severity = rule.classify(m);
        if (severity) findings.push({ rule: rule.id, severity, line: i + 1 });
      }
    }
  }
  return findings;
}

/**
 * Findings in one file's bytes. Text is scanned as text. A binary file — a NUL in its first 8 KB — is
 * NOT scanned as text: random binary contains `pWd:` and `token=` by chance, and that is noise that
 * would block a carry for no reason. Instead it is scanned as the printable runs inside it, which is
 * where a PNG keeps its text chunks, and a UTF-16 text file is decoded and scanned as that. A binary
 * file is never skipped: every byte is inspected by one of the two routes.
 */
export function scanBytes(buf) {
  if (!buf.subarray(0, 8192).includes(0)) return scanText(buf.toString("latin1"));
  const runs = buf.toString("latin1").match(/[\x20-\x7e]{16,}/g) ?? [];
  const out = scanText(runs.join("\n"));
  const sample = buf.subarray(0, Math.min(buf.length, 1024));
  let odd = 0, oddNul = 0;
  for (let i = 1; i < sample.length; i += 2) { odd++; if (sample[i] === 0) oddNul++; }
  if (odd > 8 && oddNul / odd > 0.9) out.push(...scanText(buf.toString("utf16le")));
  return out;
}
