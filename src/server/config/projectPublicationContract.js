// Explicit disclosure only. Never pass a private project row through this contract.
export const PUBLIC_PROJECT_PATH = '/public-projects';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ProjectPublicationInputError extends Error {
  constructor(reason) { super(reason); this.code = 'bad_input'; this.status = 400; }
}
const fail = reason => { throw new ProjectPublicationInputError(reason); };
export function publicationRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_shape');
  const result = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) fail('unknown_field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_shape');
    result[key] = descriptor.value;
  }
  return result;
}
export function publicationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('invalid_id');
  return value.toLowerCase();
}
export function publicProjectPath(projectId) {
  return `${PUBLIC_PROJECT_PATH}/${publicationId(projectId)}`;
}
export function publicationRevision(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(value)) fail('invalid_revision');
  return value;
}
export function publicationVisibility(value) {
  if (!['private', 'unlisted', 'public'].includes(value)) fail('invalid_visibility');
  return value;
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || new TextEncoder().encode(value).length > max) fail('invalid_text');
  const result = value.trim();
  if (required && !result) fail('required_text');
  return result;
}
export function normalizeAcceptedSummaries(value, { sources = false } = {}) {
  if (!Array.isArray(value) || value.length > 8) fail('invalid_milestone_summaries');
  const seen = new Set();
  return value.map(item => {
    const v = publicationRecord(item, sources ? ['milestoneId', 'acceptanceHash', 'label', 'summary'] : ['label', 'summary', 'status']);
    const result = { label: text(v.label, 160, true), summary: text(v.summary, 512, true) };
    if (!sources) {
      if (v.status !== 'accepted') fail('invalid_acceptance_status');
      return { ...result, status: 'accepted' };
    }
    const milestoneId = publicationId(v.milestoneId);
    if (seen.has(milestoneId) || typeof v.acceptanceHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.acceptanceHash)) fail('invalid_milestone_summaries');
    seen.add(milestoneId);
    return { milestoneId, acceptanceHash: v.acceptanceHash, ...result };
  });
}
/** Plain text rendered as text, never HTML. Licence/terms are explicit, never defaulted. */
export function normalizePublicationContent(value) {
  const v = publicationRecord(value, ['schemaVersion', 'title', 'purpose', 'license', 'termsVersion', 'contributionGuide', 'roadmap', 'updates', 'acceptedMilestones', 'selectedTasks', 'includeFundingTotals', 'redistribution']);
  if (v.schemaVersion !== 1) fail('unsupported_schema');
  return {
    schemaVersion: 1,
    title: text(v.title, 255, true),
    purpose: text(v.purpose, 8000, true),
    license: text(v.license, 2000, true),
    termsVersion: text(v.termsVersion, 120, true),
    // PUB-04: public visibility is not a license. Redistribution rights
    // are explicit, and the default is closed: anything without a
    // redistribution statement publishes as all-rights-reserved, which
    // no consumer may read as reusable.
    redistribution: normalizeRedistribution(v.redistribution),
    contributionGuide: text(v.contributionGuide, 8000, true),
    roadmap: text(v.roadmap, 8000),
    updates: text(v.updates, 8000),
    ...(v.acceptedMilestones === undefined ? {} : { acceptedMilestones: normalizeAcceptedSummaries(v.acceptedMilestones, { sources: true }) }),
    ...(v.selectedTasks === undefined ? {} : { selectedTasks: normalizeSelectedTaskSources(v.selectedTasks) }),
    ...(v.includeFundingTotals === undefined ? {} : { includeFundingTotals: normalizeFundingTotalsFlag(v.includeFundingTotals) }),
  };
}
// PUB-02: the draft selects tasks by id with a display label. Status is
// NEVER declared here — the preview snapshots live status from the work
// tree, so a draft cannot publish a false task state.
export function normalizeSelectedTaskSources(value) {
  if (!Array.isArray(value) || value.length > 32) fail('invalid_task_selection');
  const seen = new Set();
  return value.map(item => {
    const v = publicationRecord(item, ['taskId', 'label']);
    const taskId = publicationId(v.taskId);
    if (seen.has(taskId)) fail('invalid_task_selection');
    seen.add(taskId);
    return { taskId, label: text(v.label, 160, true) };
  });
}
// PUB-02: read-side summaries carry the snapshotted label and status only.
// No task ids, assignees, evidence or internal notes ever reach the public.
export function normalizeSelectedTaskSummaries(value) {
  if (!Array.isArray(value) || value.length > 32) fail('invalid_task_summaries');
  return value.map(item => {
    const v = publicationRecord(item, ['label', 'status']);
    if (!['open', 'in-review', 'completed'].includes(v.status)) fail('invalid_task_status');
    return { label: text(v.label, 160, true), status: v.status };
  });
}
export function normalizeFundingTotalsFlag(value) {
  if (value !== true) fail('invalid_funding_totals_flag');
  return true;
}
export function normalizeRedistribution(value) {
  if (value === undefined) return 'all-rights-reserved';
  if (!['open-source', 'source-available', 'all-rights-reserved'].includes(value)) fail('invalid_redistribution');
  return value;
}
// PUB-02: derived totals only — raised micro-units as a string (BIGINT
// precision), plus counts. No contributor identities, ever.
export function normalizeFundingTotals(value) {
  const v = publicationRecord(value, ['raisedMicro', 'contributionCount', 'campaignCount']);
  if (typeof v.raisedMicro !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v.raisedMicro)) fail('invalid_funding_totals');
  for (const k of ['contributionCount', 'campaignCount']) {
    if (!Number.isInteger(v[k]) || v[k] < 0) fail('invalid_funding_totals');
  }
  return { raisedMicro: v.raisedMicro, contributionCount: v.contributionCount, campaignCount: v.campaignCount };
}
