/**
 * The release record is the XENO Index governance core (xeno-index/docs/decisions/0001-release-governance-record.md).
 * Its code is OWNED by xeno-index and vendored byte-identical in ../vendor/xeno-index/governance/ — change it there,
 * never here (`node scripts/index-governance-vendor.mjs` fails on drift). This platform HOSTS it: the tables, the
 * routes (/api/releases), the screens (/workspace/releases) and the entitlements injected below.
 *
 * This path stays so every existing import (routes, MCP, scripts, tests) keeps working unchanged.
 */
import { getEffectivePlan, workspacePlansFor } from './effectivePlan.js';
import { configureEntitlements } from '../vendor/xeno-index/governance/releaseRecord.js';

configureEntitlements({ getEffectivePlan, workspacePlansFor });

export * from '../vendor/xeno-index/governance/releaseRecord.js';
