/**
 * entitlementGate — applies the plan entitlements (XENO-MONETIZATION-AND-ACCOUNT.md)
 * to SERVER-SIDE managed generation requests. v2 model: the free/paid boundary is
 * ENFORCEABILITY, not cosmetics. `maxResolution` caps managed generation dimensions
 * (Free = standard, Pro/Team = 4K) — this is the enforceable server-side gate and it
 * stays. The watermark lever is RETIRED (bypassable): `watermark` is always false, so
 * the callers' `if (ent.watermark) …` blocks are now no-ops (plumbing kept for
 * back-compat, never gate on it). Enforced SERVER-SIDE (the client cannot bypass it).
 */
import { getEntitlements } from '../services/billingService.js';
/* The GATE resolves effectively — personal plan OR any workspace that licenses
 * this person. Per-seat Team is a workspace subscription, so resolving gates
 * from the personal plan alone refused every Team member the software their
 * employer had just paid for. See services/effectivePlan.js. */
import { getEffectiveEntitlements } from '../services/effectivePlan.js';

const RES_CAP_PX = { standard: 1024, '4k': 4096 };

/* Fail-closed fallback — the shape of PLAN_ENTITLEMENTS.free (v2), MINUS the
 * booleans that grant something. watermark always false.
 *
 * `canDownload: false` is written out rather than left absent. Absence already
 * refuses (grants() coerces undefined to false), but an explicit false is the
 * difference between "we decided" and "nobody added it" — and this row is what
 * every paying customer resolves to during a database fault.
 *
 * ⚠️ `canUse` is deliberately still absent, so a fault refuses API access even
 * to free. That predates the download gate and is NOT tidied here: adding it
 * would hand out inference during an outage, which is a separate decision from
 * this one. Flagged so the next reader knows it is a choice, not an oversight. */
const FREE_ENT = {
  plan: 'free', canDownload: false, commercial: false, maxResolution: 'standard', priority: false,
  inHouseDailyLimit: 50, privateProjects: false, teamSeats: 0,
  cloudSync: false, crossApp: false, agents: false, collaboration: false, watermark: false,
};

/** Resolve a user's entitlements (falls back to Free on any error — fail closed). */
export async function resolveEntitlements(db, userId) {
  try {
    const e = await getEffectiveEntitlements(db, userId);
    return e?.entitlements || FREE_ENT;
  } catch {
    return FREE_ENT;
  }
}

/** Clamp requested image dimensions to the plan's max resolution. */
export function capDimensions(ent, width, height) {
  const max = RES_CAP_PX[ent?.maxResolution] || RES_CAP_PX.standard;
  const reqW = Number(width) || 1024;
  const reqH = Number(height) || 1024;
  return {
    width: Math.min(reqW, max),
    height: Math.min(reqH, max),
    capped: reqW > max || reqH > max,
    maxPx: max,
  };
}

// Per-plan video ceiling (GAP-5A): Free = up to 1080p + short clips; Pro/Team = up to
// 4K + long clips — makes the "higher resolution & longer outputs" Pro claim REAL, not
// just advertised. Enforced server-side. Non-breaking: an unrecognized resolution token
// passes through untouched (we only ever DOWNGRADE a clearly-over-ceiling request).
const VIDEO_PLAN = {
  standard: { maxHeight: 1080, maxDurationSec: 8 },
  '4k':     { maxHeight: 2160, maxDurationSec: 60 },
};
const RES_HEIGHT = { '480p': 480, '540p': 540, '720p': 720, hd: 720, '1080p': 1080, fhd: 1080, '1440p': 1440, '2k': 1440, qhd: 1440, '2160p': 2160, '4k': 2160, uhd: 2160, '2880p': 2880, '5k': 2880, '4320p': 4320, '8k': 4320 };
const HEIGHT_TOKEN = [[2160, '4k'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [540, '540p'], [480, '480p']];

/** Height (px) implied by a resolution value: a known token, `WxH`, or a bare number. */
function resolutionHeight(resolution) {
  if (typeof resolution === 'number' && Number.isFinite(resolution)) return resolution;
  if (typeof resolution !== 'string' || !resolution) return null;
  const s = resolution.trim().toLowerCase();
  if (RES_HEIGHT[s] != null) return RES_HEIGHT[s];
  const wxh = s.match(/^(\d+)\s*[x×]\s*(\d+)p?$/); // e.g. 3840x2160 → height 2160
  if (wxh) return Number(wxh[2]);
  const bare = s.match(/^(\d+)p?$/);               // e.g. "2160" / "2160p"
  if (bare) return Number(bare[1]);
  return null;
}

/** Clamp a requested video resolution + duration to the plan ceiling. */
export function capVideoSpec(ent, { resolution, duration } = {}) {
  const cap = VIDEO_PLAN[ent?.maxResolution] || VIDEO_PLAN.standard;
  let outRes = resolution, resCapped = false;
  const h = resolutionHeight(resolution);
  if (h != null && h > cap.maxHeight) {
    const tok = HEIGHT_TOKEN.find(([hh]) => hh <= cap.maxHeight);
    if (tok) { outRes = tok[1]; resCapped = true; }
  }
  // Duration: parseFloat so a unit-suffixed string ('60s') still clamps (Number('60s')=NaN
  // would fail OPEN). Preserve a trailing-'s' string form so the provider gets the same shape.
  let outDuration = duration, durCapped = false;
  const dNum = parseFloat(String(duration));
  if (Number.isFinite(dNum) && dNum > cap.maxDurationSec) {
    durCapped = true;
    outDuration = (typeof duration === 'string' && /s\s*$/i.test(duration)) ? `${cap.maxDurationSec}s` : cap.maxDurationSec;
  }
  return { resolution: outRes, duration: outDuration, capped: resCapped || durCapped, maxHeight: cap.maxHeight, maxDurationSec: cap.maxDurationSec };
}

/** Compact gate metadata to return to the client for labelling + upgrade prompts. */
export function gateMeta(ent) {
  return {
    plan: ent?.plan || 'free',
    watermark: !!ent?.watermark,
    commercial: !!ent?.commercial,
    maxResolution: ent?.maxResolution || 'standard',
  };
}
