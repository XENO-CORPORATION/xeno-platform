/**
 * XENO tools on the platform: the SAME signed packages Hub runs (xeno-tools → updates.xenostudio.ai/apps/tools/),
 * verified here before a browser may execute a byte of them.
 *
 * The rule is Hub's (xeno-hub src/main/services/tools/toolPackageVerifier.ts): an Ed25519 signature over the
 * canonical tool.json, and a sha256 in tool.json for every other file. Fail closed on anything else. The browser
 * never fetches a package from R2 itself; it fetches /api/tools/<id>/<version>/<file>, which this module serves
 * only after the package verified, so the only code the tool page can run is code covered by a valid signature.
 *
 * ⚠️ A port of Hub's verifier, not a shared package: none exists yet. The two must agree, so the trusted keys and
 * the canonical form below are copied byte for byte, and scripts/tool-packages.test.mjs verifies a live package.
 * When the verifier moves into a shared XENO package, both import it and this copy goes.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const REGISTRY_BASE = (process.env.XENO_TOOLS_REGISTRY_BASE || 'https://updates.xenostudio.ai').replace(/\/+$/, '');
const REGISTRY_URL = `${REGISTRY_BASE}/apps/tools/registry.json`;
const REGISTRY_TTL_MS = 5 * 60 * 1000;

/** Trusted signing keys, base64 SPKI DER — the same list Hub trusts. */
export const TRUSTED_PUBLIC_KEYS = ['MCowBQYDK2VwAyEA79hsL6UIIV2hsss89aeQ3f8vIwFPUbP8fUWIiCCIdMY='];

/**
 * What the web tool host can do (src/toolHost/webHost.ts must agree; a test pins it). A tool needing anything else
 * is shown, with what it needs Hub for, rather than hidden or run half-broken.
 */
export const WEB_CAPABILITIES = ['fs.read', 'fs.write', 'fs.dialog', 'llm', 'imagegen', 'capture', 'clipboard', 'storage', 'credits', 'notify', 'telemetry'];
const NEEDS_HUB = { inference: 'local AI models', convert: 'native file conversion', font: 'font compiling', 'agent.host': 'the XENO Agent host' };
/** The contracts the web host implements. image@1 and agent@1 are products with their own hosts. */
export const WEB_CONTRACTS = ['tool@1'];

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Hub's verifier, same checks in the same order. Returns { ok, manifest } or { ok: false, reason }. */
export function verifyToolPackage({ manifestBytes, signatureBytes, files, trustedKeys = TRUSTED_PUBLIC_KEYS }) {
  if (!signatureBytes) return { ok: false, reason: 'unsigned: the package carries no signature.json' };
  let manifest, signature;
  try { manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8')); } catch { return { ok: false, reason: 'malformed: tool.json is not valid JSON' }; }
  try { signature = JSON.parse(Buffer.from(signatureBytes).toString('utf8')); } catch { return { ok: false, reason: 'malformed: signature.json is not valid JSON' }; }
  if (signature.algorithm !== 'ed25519') return { ok: false, reason: `unsupported signature algorithm: ${String(signature.algorithm)}` };
  if (typeof signature.signature !== 'string' || !signature.signature) return { ok: false, reason: 'malformed: signature.json has no signature' };
  const msg = Buffer.from(canonical(manifest), 'utf8');
  let verified = false;
  for (const k of trustedKeys) {
    try { if (cryptoVerify(null, msg, createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature.signature, 'base64'))) { verified = true; break; } } catch { /* next key */ }
  }
  if (!verified) return { ok: false, reason: 'signature does not verify against any trusted XENO signing key' };
  if (!Array.isArray(manifest.files) || !manifest.files.length) return { ok: false, reason: 'malformed: tool.json lists no files' };
  for (const e of manifest.files) {
    const actual = files[e.name];
    if (!actual) return { ok: false, reason: `missing file declared in tool.json: ${e.name}` };
    if (sha256(actual) !== e.sha256) return { ok: false, reason: `content mismatch: ${e.name} does not match its signed sha256` };
  }
  for (const n of Object.keys(files)) if (!manifest.files.some((f) => f.name === n)) return { ok: false, reason: `undeclared file present in package: ${n}` };
  if (!manifest.id || !manifest.version) return { ok: false, reason: 'malformed: tool.json is missing id or version' };
  return { ok: true, manifest };
}

/** Where a tool runs, from its manifest alone: here, or which of its needs only Hub has. */
export function webSupport(t) {
  const contract = t.contract || 'tool@1';
  if (!WEB_CONTRACTS.includes(contract)) return { runs: false, needsHub: [contract === 'agent@1' ? 'the XENO Agent app' : 'its own product host'] };
  const missing = (t.capabilities || []).filter((c) => !WEB_CAPABILITIES.includes(c));
  return { runs: true, needsHub: [...new Set(missing.map((c) => NEEDS_HUB[c] || c))] };
}

let fetchImpl = (...a) => fetch(...a);
export const setFetch = (f) => { fetchImpl = f; registry = null; verified.clear(); };
let registry = null; // { at, tools }
const verified = new Map(); // `${id}@${version}` → { manifest, files }

async function getBytes(url) {
  const r = await fetchImpl(url);
  if (!r.ok) throw Object.assign(new Error(`${url} answered ${r.status}`), { status: 502 });
  return Buffer.from(await r.arrayBuffer());
}

/** The registry as Hub reads it, with where each tool runs. */
export async function listTools() {
  if (!registry || Date.now() - registry.at > REGISTRY_TTL_MS) {
    const j = JSON.parse((await getBytes(REGISTRY_URL)).toString('utf8'));
    registry = { at: Date.now(), tools: Array.isArray(j.tools) ? j.tools : [] };
  }
  return registry.tools.map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, icon: t.icon, version: t.version, contract: t.contract || 'tool@1', capabilities: t.capabilities || [], web: webSupport(t) }));
}

const SAFE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** One verified package, fetched and verified once per version (a version's bytes never change). */
export async function loadPackage(id, version) {
  if (!SAFE.test(id) || !SAFE.test(version)) throw Object.assign(new Error('No such tool'), { status: 404 });
  const key = `${id}@${version}`;
  if (verified.has(key)) return verified.get(key);
  const tools = await listTools();
  const t = tools.find((x) => x.id === id && x.version === version);
  if (!t) throw Object.assign(new Error('No such tool version in the registry'), { status: 404 });
  const base = `${REGISTRY_BASE}/apps/tools/${id}/${version}`;
  const manifestBytes = await getBytes(`${base}/tool.json`);
  const signatureBytes = await getBytes(`${base}/signature.json`).catch(() => null);
  let declared; try { declared = JSON.parse(manifestBytes.toString('utf8')).files || []; } catch { declared = []; }
  const files = {};
  for (const f of declared) if (typeof f.name === 'string' && /^[A-Za-z0-9._-]+$/.test(f.name)) files[f.name] = await getBytes(`${base}/${f.name}`);
  const v = verifyToolPackage({ manifestBytes, signatureBytes, files });
  if (!v.ok) throw Object.assign(new Error(`Refused ${key}: ${v.reason}`), { status: 502, code: 'package_unverified' });
  const pkg = { manifest: v.manifest, files };
  verified.set(key, pkg);
  return pkg;
}

/**
 * Which tools fit what a person typed ("make this logo transparent", "turn my voice memo into text"): each tool's
 * name, description and the words people use for its job, scored by overlap. No model call, so it is free, instant and
 * the same for everyone, signed in or not. The words per tool are hand-kept here; a tool missing from it still
 * matches on its own name and description.
 */
const WORDS = {
  'background-removal': 'background remove cutout cut out transparent png erase subject isolate',
  'image-resize': 'resize size dimensions scale crop reframe banner thumbnail social linkedin instagram aspect fit',
  upscaler: 'upscale enlarge sharpen bigger resolution 4k enhance blurry low res',
  compressor: 'compress smaller file size optimize reduce weight jpg webp',
  converter: 'convert format jpg png webp heic avif change file type',
  'asset-extractor': 'sprite sheet tileset icons extract split grid crop assets game',
  'capture-manager': 'screenshot capture screen annotate arrow markup',
  'font-finder': 'font identify which font typeface what font',
  'font-generator': 'font create typeface generate letters glyphs',
  'hud-restyle': 'hud game ui restyle reskin theme',
  'material-generator': 'material texture pbr seamless tile surface',
  'ui-extractor': 'ui screenshot extract components design mockup',
  'ui-asset-extractor': 'ui assets icons buttons extract export',
  'motion-2d': 'animation animate motion video 2d explainer',
  whisper: 'transcribe transcript speech text voice audio subtitles captions dictation meeting',
  'pdf-merge': 'pdf merge combine join documents',
  'latex-compiler': 'latex tex paper equation math compile',
};
const tokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'it', 'this', 'that', 'into', 'with', 'want', 'need', 'make', 'how', 'can', 'do', 'me', 'from', 'is', 'some']);
export async function suggestTools(text, { limit = 6 } = {}) {
  const list = (await listTools()).filter((t) => t.contract === 'tool@1');
  const q = tokens(text).filter((w) => !STOP.has(w));
  if (!q.length) return list.map((t) => ({ ...t, score: 0 }));
  const scored = list.map((t) => {
    const name = new Set(tokens(t.name)), words = new Set([...tokens(WORDS[t.id]), ...tokens(t.description), ...tokens(t.category)]);
    let score = 0;
    for (const w of q) {
      if (name.has(w)) score += 3;
      else if (words.has(w)) score += 2;
      else if ([...words, ...name].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))) score += 1;
    }
    return { ...t, score };
  });
  return scored.filter((t) => t.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
