/**
 * corpus-skill-format.mjs — THE definition of a skill bundle's format: names, the file manifest,
 * the bundle digest, the sidecar and revision shapes, and how a secret-gate verdict is described.
 *
 * 🔴 ONE DEFINITION, TWO HOSTS. `corpus-skills.mjs` (local store) and xeno-platform (the hosted
 * skills library, which VENDORS this file byte-identical behind a gate) both compute digests and
 * validate records with this code. A second implementation of "what a skill's digest is" would agree
 * until the first file whose name sorts differently, and a pin resolved by digest would then point
 * at nothing. So this module is PURE: no filesystem, no network, no clock — `node:crypto` only — and
 * it never executes, imports or evaluates any bundle content (D211: a bundle's bytes are data).
 *
 * Decisions this encodes: D235 (never change the person's bytes — refuse, never redact), D236 (the
 * secret gate refuses a WHOLE bundle at block level and names rule + location, never a value), D239
 * (every file stored once by digest; a revision names its files by digest).
 */
import { createHash } from "node:crypto";

export const FORMAT_VERSION = 1;

/** A skill name: what a directory and a sidecar file are called. */
export const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
export const isSkillName = (name) => typeof name === "string" && NAME_RE.test(name);
/** A STORED name: an authored skill name, or a VARIANT `<name>@<tool>` — the same skill carried from a
 *  second tool with different content (measured on the real store 2026-10-24: 36 of 143 records, tools
 *  agy, codex, claude). A variant always names its original in `variantOf`; nothing is merged or dropped. */
export const variantName = (name, tool) => `${name}@${tool}`;
export const isStoredName = (name) => isSkillName(name) || (typeof name === "string" && /^[^@]+@[^@]+$/.test(name) && name.split("@").every(isSkillName));

/** Revision events a skill's log may carry. */
export const REVISION_EVENTS = Object.freeze(["carried", "revised", "snapshotted", "origin-diverged", "missing"]);

/** File types recorded as executable. An OBSERVATION from the name and the shebang — never a permission. */
export const EXEC_EXT = Object.freeze([".ps1", ".sh", ".bash", ".zsh", ".cmd", ".bat", ".exe", ".py", ".mjs", ".js"]);
export const looksExecutable = (rel, bytes) =>
  EXEC_EXT.includes((String(rel).match(/\.[^./]+$/) ?? [""])[0].toLowerCase()) ||
  Buffer.from(bytes ?? []).subarray(0, 2).toString("latin1") === "#!";

/** A bundle-relative path a manifest may name: never absolute, never climbing, POSIX separators only. */
const BACKSLASH = String.fromCharCode(92);
export function safeRel(rel) {
  return typeof rel === "string" && rel.length > 0 && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel)
    && !rel.includes(BACKSLASH) && !rel.split("/").some((p) => p === "" || p === "." || p === "..");
}

export const sha256Of = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

/** One manifest entry from a file's bundle-relative path and its bytes. `mode` is the POSIX permission
 *  bits as observed (0o644 when the host has none to report). */
export function fileEntry(rel, bytes, mode = 0o644) {
  if (!safeRel(rel)) throw new Error(`SKILL_PATH_INVALID: ${JSON.stringify(rel)}`);
  const buf = Buffer.from(bytes);
  return { rel, bytes: buf.length, sha256: sha256Of(buf), mode: mode & 0o777, executable: looksExecutable(rel, buf) };
}

/** Manifest order: by `rel`, compared as JavaScript strings (UTF-16 code units, the `<` operator).
 *  Stated exactly because it is part of the digest — a host sorting by UTF-8 bytes would disagree
 *  on names outside the Basic Multilingual Plane. */
export const byRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

/**
 * THE bundle digest: "sha256:" + SHA-256 over the lines `<rel> <file sha256>` (the file digest in its
 * "sha256:<hex>" form), in manifest order, joined with "\n", no trailing newline. Per-file digests make
 * the bundle digest verifiable file by file and let identical files be stored once (D239).
 */
export function bundleDigestOf(files) {
  const sorted = [...files].sort(byRel);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].rel === sorted[i - 1].rel) throw new Error(`SKILL_PATH_DUPLICATE: ${sorted[i].rel}`);
  return sha256Of(Buffer.from(sorted.map((f) => f.rel + " " + f.sha256).join("\n")));
}

/** The manifest a revision records: exactly these fields, in manifest order. */
export const manifestOf = (files) => [...files].sort(byRel).map((f) => ({ rel: f.rel, sha256: f.sha256, bytes: f.bytes, mode: f.mode, executable: f.executable }));

/**
 * Re-verify a bundle a client SENT: recompute every file's digest and the bundle digest from the bytes,
 * and compare with what was claimed. A host must never trust a client's digest (the platform's import
 * path runs this on every upload). → { ok, files, bundleDigest, problems[] }
 *   input  [{ rel, bytes, mode? }]   claimed  { bundleDigest?, files?: [{ rel, sha256 }] }
 */
export function verifyBundle(input, claimed = {}) {
  const problems = [];
  let files = [];
  try { files = input.map((f) => fileEntry(f.rel, f.bytes, f.mode)).sort(byRel); } catch (e) { return { ok: false, files: [], bundleDigest: null, problems: [e.message] }; }
  let bundleDigest = null;
  try { bundleDigest = bundleDigestOf(files); } catch (e) { problems.push(e.message); }
  if (claimed.bundleDigest !== undefined && claimed.bundleDigest !== bundleDigest) problems.push(`SKILL_DIGEST_MISMATCH: claimed ${claimed.bundleDigest}, computed ${bundleDigest}`);
  if (Array.isArray(claimed.files)) {
    const got = new Map(files.map((f) => [f.rel, f.sha256]));
    for (const c of claimed.files) if (got.get(c.rel) !== c.sha256) problems.push(`SKILL_FILE_MISMATCH: ${c.rel}`);
    if (claimed.files.length !== files.length) problems.push(`SKILL_FILE_COUNT_MISMATCH: claimed ${claimed.files.length}, got ${files.length}`);
  }
  return { ok: problems.length === 0, files, bundleDigest, problems };
}

/** A SKILL.md's front matter: `key: value` lines between `---` fences, quotes stripped. CR is stripped
 *  FIRST — a CRLF SKILL.md (every one on Windows) otherwise reads as unparseable. null when absent. */
export function readFrontmatter(raw) {
  const text = String(raw).replace(/\r\n?/g, "\n");
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const out = {};
  for (const line of text.slice(3, end).split("\n")) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Problems with a sidecar record (`<name>.skill.json`); empty when it is well-formed. */
export function sidecarProblems(r, { fileName } = {}) {
  const p = [];
  if (!r || typeof r !== "object") return ["sidecar is not an object"];
  if (!isStoredName(r.name)) p.push(`name ${JSON.stringify(r.name)} is not a skill name`);
  else if (r.name.includes("@") && r.variantOf !== r.name.split("@")[0]) p.push(`variant ${r.name} must name its original in variantOf`);
  if (fileName !== undefined && fileName !== r.name + ".skill.json") p.push("name must match the filename");
  if (typeof r.bundleDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r.bundleDigest)) p.push("bundleDigest must be sha256:<64 hex>");
  if (!Array.isArray(r.files)) p.push("files must be a list");
  else {
    if (r.files.some((f) => !safeRel(f?.rel) || typeof f.sha256 !== "string")) p.push("every file needs a safe rel and a sha256");
    else { try { if (bundleDigestOf(r.files) !== r.bundleDigest) p.push("bundleDigest does not match the file list"); } catch (e) { p.push(e.message); } }
  }
  return p;
}

/** Problems with one revision-log event; empty when it is well-formed. */
export function revisionProblems(e) {
  const p = [];
  if (!e || !REVISION_EVENTS.includes(e.event)) p.push(`event ${JSON.stringify(e?.event)} is not one of ${REVISION_EVENTS.join(", ")}`);
  if (!Number.isFinite(Date.parse(e?.at))) p.push("at must be a date");
  if (e?.manifest !== undefined && (!Array.isArray(e.manifest) || e.manifest.some((f) => !safeRel(f?.rel)))) p.push("manifest must list safe paths");
  return p;
}

/** How a REFUSAL may describe secret-shaped material: rule names and locations, never the value. */
export function describeBlock(block) {
  const rules = [...new Set(block.map((x) => x.rule))].join(", ");
  const where = block.slice(0, 3).map((x) => x.file + (x.line ? ":" + x.line : "")).join(", ");
  const more = block.length > 3 ? ` and ${block.length - 3} more` : "";
  return `secret-shaped material (${rules}) at ${where}${more} — value not shown; remove it at source`;
}

/** Review-level findings that travel WITH the sidecar, capped, for a person to read. */
export function reviewField(scan) {
  if (!scan?.review?.length) return {};
  return { review: scan.review.slice(0, 50).map((x) => ({ file: x.file, line: x.line, rule: x.rule })), reviewCount: scan.review.length };
}
