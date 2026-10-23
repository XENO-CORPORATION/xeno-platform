/**
 * The release record's agent tools — XENO Index governance core, vendored from xeno-index (decision 0001). Change
 * them in xeno-index/packages/index/src/governance/, never here. Kept at this path so existing imports work.
 */
import './releaseRecord.js'; // the host's entitlements are injected before anything in the core runs
export * from '../vendor/xeno-index/governance/releasesMcp.js';
