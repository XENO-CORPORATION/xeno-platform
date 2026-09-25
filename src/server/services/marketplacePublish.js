/**
 * Marketplace publishing pipeline (SPEC §6, §11).
 *
 * Pure, side-effect-free helpers that the route layer composes:
 *   - verifySha256 / verifyEd25519 — artifact integrity + authenticity
 *   - runAutomatedChecks          — the submit→checks gate (D1 enforced here)
 *
 * Ed25519 verification follows the ecosystem signing convention
 * (docs/CODE_SIGNING.md / .xuse / .xswarm): the signature is computed over the
 * artifact's SHA-256 (hex, utf8 bytes), keys + sig are base64. Node's built-in
 * crypto verifies raw Ed25519 with no extra dependency.
 */

import crypto from 'crypto';

// Kinds that may NEVER be published on the `community` trust tier (D1).
// A native installer runs arbitrary code; community is sandboxed-only.
export const COMMUNITY_FORBIDDEN_KINDS = new Set(['app-native']);

// All recognized kinds (SPEC §2). Mirrors the DB CHECK constraint.
export const VALID_KINDS = new Set([
  'app-native', 'app-sandboxed', 'panel', 'plugin', 'mcp', 'model', 'mind', 'swarm',
]);

// The agent kinds (SPEC §2): `mind` is one Anima, `swarm` a coordinated package. `swarm` is the LEGACY
// name for what the .xanima format calls a swarm-kind container; it stays a listing kind so every
// existing swarm listing keeps working (XENO-WORKFORCE-01 MKT-03).
export const AGENT_KINDS = new Set(['mind', 'swarm']);

/** The .xanima manifest `kind` each agent listing kind must carry. */
const XANIMA_KIND_FOR_LISTING = Object.freeze({ mind: 'anima', swarm: 'swarm' });

function agentManifestProblems(kind, m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.format !== 'xanima'
    || !Number.isInteger(m.schemaVersion) || m.schemaVersion < 1) return ['manifest_not_xanima'];
  const problems = [];
  if (m.kind !== XANIMA_KIND_FOR_LISTING[kind]) problems.push('manifest_kind_mismatch');
  const minds = Array.isArray(m.minds) ? m.minds : [];
  if (minds.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) return [...problems, 'manifest_not_xanima'];
  if (minds.length === 0) problems.push('package_lists_no_minds');
  else if (kind === 'mind' && minds.length !== 1) problems.push('mind_carries_one_mind');
  if (kind === 'swarm' && (!m.wiring || typeof m.wiring !== 'object' || Array.isArray(m.wiring))) problems.push('swarm_requires_wiring');
  // The Soul is the agent's EARNED, private self and never transfers with a sold or rented Mind
  // (SPEC D3; .xanima carries a reference by default and `embedded: true` only on explicit export).
  if (minds.some((entry) => entry.soul?.embedded === true)) problems.push('private_soul_embedded');
  return problems;
}

/**
 * XENO-WORKFORCE-01 MKT-03 -- what an AGENT version must be before it can be published: licensed, and,
 * when it ships an artifact, a signed canonical `.xanima` whose declared manifest matches the listing.
 * Returns the reasons it cannot be published ([] when it can, and always [] for a non-agent kind).
 *
 * The database holds the same rules as its own invariant (20260925100000); this is the early answer a
 * seller gets at upload instead of at approval. Signature VALIDITY is checked by the route with
 * verifyEd25519 -- here only its presence, because a pure function has no key to check it against.
 *
 * A version with no artifact is a hosted-only serving version (MKT-05): it still needs its licence.
 */
export function agentVersionProblems(kind, v) {
  if (!AGENT_KINDS.has(kind)) return [];
  const problems = [];
  if (typeof v.license !== 'string' || !v.license.trim()) problems.push('license_required');
  const locations = [v.artifactR2Key, v.artifactUrl ? String(v.artifactUrl).split('?')[0] : null].filter(Boolean);
  if (locations.length) {
    if (!locations.every((location) => String(location).toLowerCase().endsWith('.xanima'))) problems.push('artifact_not_canonical');
    if (!(typeof v.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(v.sha256) && v.sig && v.pubkey)) problems.push('artifact_unsigned');
    problems.push(...agentManifestProblems(kind, v.manifest));
  }
  return problems;
}

export const VALID_TRUST_TIERS = new Set(['community', 'verified', 'official']);
export const VALID_PRICING_MODELS = new Set(['free', 'one_time', 'subscription', 'pay_per_use', 'rental']);

/**
 * Verify a SHA-256 hex digest matches an expected value.
 * @param {string} expectedHex
 * @param {Buffer|string|null} dataOrHex - raw bytes, or a precomputed hex digest
 * @returns {boolean}
 */
export function verifySha256(expectedHex, dataOrHex) {
  if (!expectedHex || typeof expectedHex !== 'string') return false;
  let actual;
  if (Buffer.isBuffer(dataOrHex)) {
    actual = crypto.createHash('sha256').update(dataOrHex).digest('hex');
  } else if (typeof dataOrHex === 'string') {
    actual = dataOrHex.trim().toLowerCase();
  } else {
    return false;
  }
  // Constant-time compare on equal-length hex strings.
  const a = Buffer.from(actual.toLowerCase(), 'utf8');
  const b = Buffer.from(expectedHex.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verify an Ed25519 signature over the artifact's sha256 hex string.
 * @param {string} sha256Hex   - the signed message (artifact digest)
 * @param {string} sigB64      - base64 signature
 * @param {string} pubKeyB64   - base64 raw 32-byte Ed25519 public key
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyEd25519(sha256Hex, sigB64, pubKeyB64) {
  if (!sha256Hex || !sigB64 || !pubKeyB64) {
    return { valid: false, error: 'missing signature material' };
  }
  try {
    const rawKey = Buffer.from(pubKeyB64, 'base64');
    if (rawKey.length !== 32) {
      return { valid: false, error: 'public key is not a 32-byte Ed25519 key' };
    }
    // Wrap raw key bytes in the SPKI DER prefix for Ed25519 so KeyObject accepts it.
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      rawKey,
    ]);
    const keyObject = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const valid = crypto.verify(
      null,
      Buffer.from(sha256Hex, 'utf8'),
      keyObject,
      Buffer.from(sigB64, 'base64'),
    );
    return { valid };
  } catch (error) {
    return { valid: false, error: 'signature verification failed' };
  }
}

/**
 * Run the automated submission checks (SPEC §6). Returns a structured report
 * the caller persists into marketplace_submissions.checks and uses to decide
 * whether the submission proceeds to review or is rejected up front.
 *
 * D1 is enforced here, server-side: a community listing carrying a native
 * binary (or declaring the `app-native` kind) fails `noNativeForCommunity`.
 *
 * @param {object} input
 * @param {string} input.kind
 * @param {string} input.trustTier
 * @param {string|null} input.license
 * @param {object} versionRow - row from marketplace_listing_versions
 * @returns {{ passed: boolean, checks: Record<string, {pass: boolean, detail: string}> }}
 */
export function runAutomatedChecks({ kind, trustTier, license }, versionRow) {
  const checks = {};

  // 1. Manifest present & well-formed
  const manifest = versionRow?.manifest;
  checks.manifestValid = manifest && typeof manifest === 'object' && Object.keys(manifest).length > 0
    ? { pass: true, detail: 'manifest present' }
    : { pass: false, detail: 'manifest is missing or empty' };

  // 2. Signature present (Ed25519 sig + pubkey + sha256). Cryptographic
  //    verification happens at submit-time in the route; here we assert presence.
  const hasSig = Boolean(versionRow?.ed25519_sig && versionRow?.ed25519_pubkey && versionRow?.artifact_sha256);
  // MCP descriptors and free config-only listings may legitimately have no artifact;
  // require a signature only when an artifact key exists.
  const requiresSig = Boolean(versionRow?.artifact_r2_key);
  checks.signaturePresent = (!requiresSig || hasSig)
    ? { pass: true, detail: requiresSig ? 'ed25519 signature present' : 'no artifact requiring signature' }
    : { pass: false, detail: 'artifact present but ed25519 signature/pubkey/sha256 missing' };

  // 3. License present
  checks.licensePresent = (license && String(license).trim().length > 0)
    ? { pass: true, detail: `license: ${license}` }
    : { pass: false, detail: 'license terms are required' };

  // 4. Declared capabilities are an array (consent surface for preflightTrust)
  const caps = versionRow?.declared_capabilities;
  checks.capabilitiesDeclared = Array.isArray(caps)
    ? { pass: true, detail: `${caps.length} capability(ies) declared` }
    : { pass: false, detail: 'declared_capabilities must be an array' };

  // 5. D1 — no native binary on community tier
  const isCommunity = trustTier === 'community';
  const kindIsNative = COMMUNITY_FORBIDDEN_KINDS.has(kind);
  const carriesNative = Boolean(versionRow?.has_native_binary);
  if (isCommunity && (kindIsNative || carriesNative)) {
    checks.noNativeForCommunity = {
      pass: false,
      detail: kindIsNative
        ? `kind "${kind}" is gated to official/verified publishers (D1)`
        : 'artifact contains a native binary; community publishing is sandbox-only (D1)',
    };
  } else {
    checks.noNativeForCommunity = { pass: true, detail: 'no native code on community tier' };
  }

  // 6. MKT-03 -- an agent version is a licensed, signed, canonical .xanima (see agentVersionProblems).
  if (AGENT_KINDS.has(kind)) {
    const problems = agentVersionProblems(kind, {
      license: versionRow?.license, artifactR2Key: versionRow?.artifact_r2_key, artifactUrl: versionRow?.artifact_url,
      sha256: versionRow?.artifact_sha256, sig: versionRow?.ed25519_sig, pubkey: versionRow?.ed25519_pubkey, manifest,
    });
    checks.agentPackage = problems.length
      ? { pass: false, detail: problems.join(', ') }
      : { pass: true, detail: 'licensed agent version; any artifact is a signed canonical .xanima' };
  }

  const passed = Object.values(checks).every((c) => c.pass);
  return { passed, checks };
}

/**
 * Decide the trust tier a listing/version is permitted to publish at, given the
 * developer's tier. A developer can never publish above their own tier.
 */
export function resolvePublishTrustTier(developerTier) {
  if (developerTier === 'official') return 'official';
  if (developerTier === 'verified') return 'verified';
  return 'community';
}

export default {
  COMMUNITY_FORBIDDEN_KINDS,
  AGENT_KINDS,
  agentVersionProblems,
  VALID_KINDS,
  VALID_TRUST_TIERS,
  VALID_PRICING_MODELS,
  verifySha256,
  verifyEd25519,
  runAutomatedChecks,
  resolvePublishTrustTier,
};
