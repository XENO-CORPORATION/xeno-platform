/**
 * Unit tests for entitlementGate — the SERVER-SIDE Free/Pro caps that make a
 * subscription REAL (watermark / resolution / duration / commercial), enforced so the
 * client cannot bypass them (XENO-MONETIZATION-AND-ACCOUNT.md §4). Pure functions plus
 * the fail-closed `resolveEntitlements` fallback. No database required.
 *
 * Run: node tests/entitlement-gate.test.mjs
 */
import {
  resolveEntitlements, capDimensions, capVideoSpec, gateMeta,
} from '../utils/entitlementGate.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)})`);

const FREE = { plan: 'free', watermark: true, commercial: false, maxResolution: 'standard' };
const PRO  = { plan: 'pro',  watermark: false, commercial: true,  maxResolution: '4k' };

async function main() {
  // ---- capDimensions: image resolution ceiling ----
  {
    const c = capDimensions(FREE, 4096, 4096);
    eq(c.width, 1024, 'free clamps width 4096→1024');
    eq(c.height, 1024, 'free clamps height 4096→1024');
    ok(c.capped === true, 'free over-cap sets capped=true');
    eq(c.maxPx, 1024, 'free maxPx=1024 (standard)');
  }
  {
    const c = capDimensions(PRO, 4096, 2160);
    eq(c.width, 4096, 'pro allows 4096 width');
    eq(c.height, 2160, 'pro allows 2160 height');
    ok(c.capped === false, 'pro within-cap capped=false');
  }
  ok(!capDimensions(FREE, 512, 512).capped, 'under-cap image request passes through uncapped');
  {
    const c = capDimensions({}, undefined, undefined);
    eq(c.width, 1024, 'missing dims default to 1024');
    eq(c.maxPx, 1024, 'unknown plan falls back to standard cap');
  }

  // ---- capVideoSpec: video height + duration ceiling ----
  {
    const v = capVideoSpec(FREE, { resolution: '4k', duration: 60 });
    eq(v.resolution, '1080p', 'free downgrades 4k→1080p');
    eq(v.duration, 8, 'free clamps 60→8 (number)');
    ok(v.capped === true, 'free video over-ceiling capped=true');
  }
  {
    const v = capVideoSpec(FREE, { resolution: '3840x2160', duration: '60s' });
    eq(v.resolution, '1080p', 'free downgrades WxH 3840x2160→1080p');
    eq(v.duration, '8s', 'free clamps "60s"→"8s" (string form preserved)');
  }
  {
    const v = capVideoSpec(PRO, { resolution: '4k', duration: 60 });
    eq(v.resolution, '4k', 'pro allows 4k');
    eq(v.duration, 60, 'pro allows 60s');
    ok(v.capped === false, 'pro within-ceiling capped=false');
  }
  ok(!capVideoSpec(FREE, { resolution: '720p', duration: 5 }).capped, 'free within-ceiling video passes through');
  eq(capVideoSpec(FREE, { resolution: 'cinematic', duration: 3 }).resolution, 'cinematic', 'unknown resolution token passes through untouched (fail-open on shape, never escalates)');
  {
    const v = capVideoSpec(PRO, { resolution: '8k', duration: 120 });
    eq(v.resolution, '4k', 'pro downgrades 8k→4k (above 4k ceiling)');
    eq(v.duration, 60, 'pro clamps 120→60');
  }

  // ---- gateMeta: client-facing label ----
  {
    const m = gateMeta(PRO);
    ok(m.plan === 'pro' && m.watermark === false && m.commercial === true && m.maxResolution === '4k', 'gateMeta reflects pro');
    const d = gateMeta(undefined);
    ok(d.plan === 'free' && d.watermark === false && d.maxResolution === 'standard', 'gateMeta defaults when ent missing');
  }

  // ---- resolveEntitlements: FAIL CLOSED to Free on any error ----
  {
    const throwingDb = { query: () => { throw new Error('db down'); } };
    const e = await resolveEntitlements(throwingDb, 'u1');
    ok(e.plan === 'free' && e.watermark === true && e.commercial === false, 'resolveEntitlements falls back to FREE on error (fail closed)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} entitlement-gate: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
