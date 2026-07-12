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

/** Compact gate metadata to return to the client for labelling + upgrade prompts. */
export function gateMeta(ent) {
  return {
    plan: ent?.plan || 'free',
    watermark: !!ent?.watermark,
    commercial: !!ent?.commercial,
    maxResolution: ent?.maxResolution || 'standard',
  };
}
