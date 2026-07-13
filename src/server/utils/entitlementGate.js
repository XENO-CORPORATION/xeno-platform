/**
 * entitlementGate — applies the Free/Pro entitlements (XENO-MONETIZATION-AND-ACCOUNT.md
 * §4) to generation requests. This is where a subscription becomes REAL: Free outputs
 * are watermarked, standard-resolution, and non-commercial; Pro removes every gate.
 * Enforced SERVER-SIDE (the client cannot bypass it).
 */
import { getEntitlements } from '../services/billingService.js';

const RES_CAP_PX = { standard: 1024, '4k': 4096 };

const FREE_ENT = {
  plan: 'free', watermark: true, commercial: false, maxResolution: 'standard',
  priority: false, inHouseDailyLimit: 50, privateProjects: false, teamSeats: 0,
};

/** Resolve a user's entitlements (falls back to Free on any error — fail closed). */
export async function resolveEntitlements(db, userId) {
  try {
    const e = await getEntitlements(db, userId);
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
const RES_HEIGHT = { '480p': 480, '540p': 540, '720p': 720, '1080p': 1080, fhd: 1080, '1440p': 1440, '2k': 1440, qhd: 1440, '2160p': 2160, '4k': 2160, uhd: 2160 };
const HEIGHT_TOKEN = [[2160, '4k'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [540, '540p'], [480, '480p']];

/** Clamp a requested video resolution + duration to the plan ceiling. */
export function capVideoSpec(ent, { resolution, duration } = {}) {
  const cap = VIDEO_PLAN[ent?.maxResolution] || VIDEO_PLAN.standard;
  let outRes = resolution, resCapped = false;
  if (typeof resolution === 'string' && resolution) {
    const h = RES_HEIGHT[resolution.toLowerCase()];
    if (h && h > cap.maxHeight) {
      const tok = HEIGHT_TOKEN.find(([hh]) => hh <= cap.maxHeight);
      if (tok) { outRes = tok[1]; resCapped = true; }
    }
  }
  let outDuration = duration, durCapped = false;
  const d = Number(duration);
  if (Number.isFinite(d) && d > cap.maxDurationSec) { outDuration = cap.maxDurationSec; durCapped = true; }
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
