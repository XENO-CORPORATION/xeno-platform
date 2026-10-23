/**
 * @xenosystem/index/governance — the XENO Index release-governance record.
 *
 * One record of what shipped: deploys, features (status, where enabled, their PRs / releases / proof), the customer
 * "What's new" notes a human on staff approved, and one staff-only internal note per deploy that a human signs off.
 * Decision record: xeno-index/docs/decisions/0001-release-governance-record.md.
 *
 * Every function takes a `db` (anything with `query(text, params)`) and an `actor` principal. The HOST owns the
 * connection, identity resolution, entitlements (`releaseRecord.configureEntitlements`) and transport (HTTP, MCP).
 * Schema: ../../schema/*.sql — applied by the host's migration runner.
 */
export * as releaseRecord from './releaseRecord.js';
export * as internalNotes from './releaseInternalNotes.js';
export * as internalNoteTemplate from './releaseInternalNoteTemplate.js';
export * as releasesMcp from './releasesMcp.js';
