/**
 * corpus-skill-risk.mjs — what a skill's files would DO if an agent (or a person following SKILL.md) acted on them.
 *
 * Adopted 2026-10-24 from a draft by the xeno-platform session, which vendors this file (as it vendors
 * corpus-secret-rules.mjs) and applies it at upload; corpus applies it at carry. The secret gate asks "does this
 * bundle CONTAIN a credential"; this asks "does it try to TAKE one, or run something nobody can read". Pure and
 * browser-safe: no imports, Uint8Array + TextDecoder only, nothing executed or decoded "to see what it is" (D211:
 * bytes are data).
 *
 * Why instructions are scanned, not only scripts: the 2026 ClawHub/OpenClaw skill-registry attack shipped no malicious
 * script at all — SKILL.md told the reader to run a "prerequisite" `curl … | bash` from a paste site or a bare IP, and
 * the download was an info-stealer. So every text file is read, prose included.
 *
 *   block   — malicious beyond reasonable doubt. Refused; nobody overrides it. A false block is therefore the costly
 *             error, which is why every block rule is anchored (an IP only in HOST position and only a public one).
 *   confirm — legitimate in some skills, dangerous in most. Refused at upload until a person reads it and says yes.
 *   review  — worth a human look, never refused.
 * A finding is { rule, severity, category, line } — never the matched text.
 */
export const RISK_RULES_VERSION = 1;
export const PER_FILE_RULE_CAP = 25;

const PASTE = String.raw`(?:pastebin\.com|paste\.ee|hastebin\.com|ghostbin|glot\.io|termbin\.com|transfer\.sh|0x0\.st|bit\.ly|tinyurl\.com|is\.gd|rentry\.co|controlc\.com|dpaste)`;
// a PUBLIC IPv4 in HOST position (after a scheme, or standing alone before a path/port) — never a version number
// inside a path (`/v1.2.3.4/install.sh`), never loopback or a private network (the person's own machine and LAN)
const PRIVATE = String.raw`(?:127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)`;
const PUBLIC_IP_HOST = String.raw`(?:https?:\/\/|(?<![\w./-]))(?!${PRIVATE})(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?=[\/\s'"):]|$)`;
const FETCH = String.raw`(?:\bcurl\b|\bwget\b|\biwr\b|\birm\b|Invoke-WebRequest|Invoke-RestMethod|\bfetch\b|urllib\.request|requests\.get|Net\.WebClient|DownloadString|DownloadFile)`;
const SHELL = String.raw`(?:\b(?:ba|z|da|k)?sh\b|\bpython[0-9.]*\b|\bnode\b|\bperl\b|\bruby\b|\biex\b|Invoke-Expression|\bpowershell\b|\bpwsh\b|\bcmd(?:\.exe)?\b)`;
// credential stores by their PATHS, never by a word: "cookies" or "local state" in prose is not a theft (measured on
// 323 real skills: those two words alone were 22 of the draft's hits)
const CRED = String.raw`(?:\.ssh[\\/]id_[a-z0-9]+|\.aws[\\/]credentials|\.config[\\/]gcloud[\\/](?:credentials|application_default)|\.azure[\\/](?:accessTokens|msal_token_cache)|\.kube[\\/]config|\.docker[\\/]config\.json|\.git-credentials|(?:Chrome|Chromium|Edge|Brave[- ]Browser|Opera)[^\n]{0,80}[\\/](?:Cookies|Login Data|Web Data|Local State)\b|Default[\\/](?:Cookies|Login Data|Web Data)\b|cookies\.sqlite|logins\.json|key[34]\.db|wallet\.dat|exodus\.wallet|nkbihfbeogaeaoehlefnkodbefgpgknn|Library[\\/]Keychains|login\.keychain|security\s+(?:find|dump)-(?:generic|internet)-password|Telegram Desktop[\\/]tdata)`;
const SCRIPT = /\.(?:sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|applescript|scpt)$/i;
const SEND = new RegExp(String.raw`(?:\bcurl\b[^\n]*\s(?:-F|--form|-d|--data(?:-binary)?|-T|--upload-file)\b|Invoke-(?:WebRequest|RestMethod)[^\n]*-(?:Body|InFile|Method\s+Post)|requests\.(?:post|put)\(|\bnc\b\s+\S+\s+\d+\s*<|\bscp\b|discord(?:app)?\.com\/api\/webhooks|api\.telegram\.org\/bot)`, "i");

const rule = (id, severity, category, re) => ({ id, severity, category, re });
/** Applied line by line. Each `re` carries the `g` flag. Invisible characters are written as \u escapes, never literally. */
export const RULES = Object.freeze([
  // ── block: malicious beyond reasonable doubt
  rule("fetch-from-ip-or-paste-into-shell", "block", "remote-code", new RegExp(`${FETCH}[^\\n]*(?:${PUBLIC_IP_HOST}|${PASTE})[^\\n]*\\|\\s*(?:sudo\\s+)?${SHELL}`, "gi")),
  rule("decoded-into-shell", "block", "obfuscated-code", /\bbase64\s+(?:-d|--decode|-D)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|FromBase64String\([^\n]*(?:\biex\b|Invoke-Expression)|(?:\biex\b|Invoke-Expression)[^\n]*FromBase64String|\b(?:exec|eval)\s*\(\s*(?:base64\.b64decode|codecs\.decode|bytes\.fromhex|zlib\.decompress|atob|Buffer\.from)\s*\(|-(?:e|en|enc|EncodedCommand)\s+[A-Za-z0-9+/]{40,}={0,2}/g),
  rule("reverse-shell", "block", "remote-access", /\/dev\/tcp\/[^\s/]+\/\d+|\b(?:nc|ncat|netcat)\b[^\n]*\s-(?:e|c)\s+\S*(?:sh|cmd)|pty\.spawn\(\s*["']\/bin\/(?:ba)?sh|socket\.socket\([^\n]*\)[^\n]*(?:connect|subprocess)[^\n]*\/bin\/(?:ba)?sh|New-Object\s+System\.Net\.Sockets\.TCPClient/gi),
  rule("crypto-miner", "block", "abuse", /\bxmrig\b|stratum\+(?:tcp|ssl):\/\/|--donate-level\b|\bminerd\b|\bcpuminer\b/gi),
  rule("fake-password-prompt", "block", "credential-theft", /osascript[^\n]*display dialog[^\n]*(?:password|passcode)|osascript[^\n]*with hidden answer|\$Host\.UI\.PromptForCredential|Get-Credential[^\n]*-Message[^\n]*(?:update|verify|required)/gi),
  rule("invisible-tag-characters", "block", "hidden-text", /[\u{E0000}-\u{E007F}]/gu),
  // ── confirm: legitimate in some skills, dangerous in most — a person reads it and says yes
  rule("fetch-into-shell", "confirm", "remote-code", new RegExp(`${FETCH}[^\\n|]*\\|\\s*(?:sudo\\s+)?${SHELL}`, "gi")),
  rule("reads-credential-store", "confirm", "credential-theft", new RegExp(CRED, "gi")),
  rule("starts-at-login", "confirm", "persistence", /\bcrontab\s+-e\b|\(crontab\s+-l|\/etc\/cron|\bschtasks\b[^\n]*\/create|CurrentVersion\\Run\b|Library\/LaunchAgents\/|LaunchDaemons\/|systemctl\s+(?:--user\s+)?enable|>>\s*~?\/?\.?(?:bashrc|zshrc|profile)\b/gi),
  rule("disables-protection", "confirm", "defense-evasion", /Set-MpPreference[^\n]*-Disable|Add-MpPreference[^\n]*-ExclusionPath|spctl\s+--master-disable|xattr\s+-[a-z]*d[a-z]*\s+com\.apple\.quarantine|xattr\s+-[a-z]*c[a-z]*\s|csrutil\s+disable|setenforce\s+0|ufw\s+disable/gi),
  rule("trojan-source-bidi", "confirm", "hidden-text", /[\u202A-\u202E\u2066-\u2069]/g),
  // ── review: worth a look, never refused
  rule("bare-ip-url", "review", "network", new RegExp(`https?:\\/\\/(?!${PRIVATE})(?:\\d{1,3}\\.){3}\\d{1,3}\\b`, "g")),
  rule("zero-width-characters", "review", "hidden-text", /[\u200B-\u200D\u2060\uFEFF](?!$)/g),
  rule("large-encoded-blob", "review", "obfuscated-code", /[A-Za-z0-9+/]{2000,}={0,2}/g),
  rule("makes-executable", "review", "execution", /\bchmod\s+(?:\+x|[0-7]*[1357]\b)|Unblock-File\b/gi),
]);

const asBytes = (b) => (typeof b === "string" ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b ?? 0));

/** Programs and archives by their first bytes — what an agent could run or unpack, and nobody can read. */
export function magicOf(bytes) {
  const b = asBytes(bytes).subarray(0, 8);
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (hex.startsWith("4d5a")) return { kind: "program", what: "a Windows program (PE)" };
  if (hex.startsWith("7f454c46")) return { kind: "program", what: "a Linux program (ELF)" };
  if (/^(?:feedface|feedfacf|cefaedfe|cffaedfe|cafebabe)/.test(hex)) return { kind: "program", what: "a macOS program (Mach-O)" };
  if (hex.startsWith("504b0304")) return { kind: "archive", what: "a .zip archive" };
  if (hex.startsWith("1f8b")) return { kind: "archive", what: "a .gz archive" };
  if (hex.startsWith("377abcaf271c")) return { kind: "archive", what: "a .7z archive" };
  if (hex.startsWith("526172211a07")) return { kind: "archive", what: "a .rar archive" };
  return null;
}

/** Findings in one piece of text. Rule ids and lines only — never the matched text. `script`: the text is code that runs. */
export function scanText(text, { script = false } = {}) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const r of RULES) { r.re.lastIndex = 0; if (r.re.test(lines[i])) out.push({ rule: r.id, severity: r.severity, category: r.category, line: i + 1 }); r.re.lastIndex = 0; }
  }
  // the same line matching a broad rule and its stricter twin reports the stricter one only
  const strict = new Set(out.filter((f) => f.rule === "fetch-from-ip-or-paste-into-shell").map((f) => f.line));
  const kept = out.filter((f) => !(f.rule === "fetch-into-shell" && strict.has(f.line)));
  // a credential store read and an upload in the same file: in code that runs, theft; in prose, a person reads it
  const read = kept.find((f) => f.rule === "reads-credential-store");
  if (read && lines.some((l) => SEND.test(l))) kept.push({ rule: "reads-credentials-and-sends", severity: script ? "block" : "confirm", category: "credential-theft", line: read.line });
  return kept;
}

/** Findings in one file's bytes: a program or archive by its magic; text (UTF-8, or the printable runs of a binary) by rules. */
export function scanFileBytes(rel, bytes) {
  const buf = asBytes(bytes), findings = [];
  const m = magicOf(buf);
  if (m) findings.push({ rule: m.kind === "program" ? "ships-a-program" : "ships-an-archive", severity: "confirm", category: m.kind, line: 0, what: m.what });
  const binary = buf.subarray(0, 8192).includes(0);
  const text = binary ? (new TextDecoder("latin1").decode(buf).match(/[\x20-\x7e]{16,}/g) || []).join("\n") : new TextDecoder("utf-8").decode(buf);
  const script = SCRIPT.test(rel) || (!binary && buf[0] === 0x23 && buf[1] === 0x21);   // "#!"
  const perRule = new Map();
  for (const f of scanText(text, { script })) {
    if (binary && f.category === "hidden-text") continue;   // random bytes are not hidden text
    const n = (perRule.get(f.rule) || 0) + 1; perRule.set(f.rule, n);
    if (n <= PER_FILE_RULE_CAP) findings.push(f);
  }
  return findings.map((f) => ({ file: rel, ...f }));
}

/** A whole bundle: [{ rel, bytes }] → { block, confirm, review } (each [{ file, line, rule, category }]). */
export function scanBundleRisk(files) {
  const all = files.flatMap((f) => scanFileBytes(f.rel, f.bytes));
  return { block: all.filter((f) => f.severity === "block"), confirm: all.filter((f) => f.severity === "confirm"), review: all.filter((f) => f.severity === "review") };
}

/** How a refusal or a confirmation names what was found: rule, category and place — never the content. */
export function describeRisk(list) {
  const rules = [...new Set(list.map((x) => x.rule))].join(", ");
  const where = list.slice(0, 3).map((x) => x.file + (x.line ? ":" + x.line : "")).join(", ");
  return `${rules} at ${where}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
}
