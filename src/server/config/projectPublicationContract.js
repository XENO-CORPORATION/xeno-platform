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
/** Plain text rendered as text, never HTML. Licence/terms are explicit, never defaulted. */
export function normalizePublicationContent(value) {
  const v = publicationRecord(value, ['schemaVersion', 'title', 'purpose', 'license', 'termsVersion', 'contributionGuide', 'roadmap', 'updates']);
  if (v.schemaVersion !== 1) fail('unsupported_schema');
  return {
    schemaVersion: 1,
    title: text(v.title, 255, true),
    purpose: text(v.purpose, 8000, true),
    license: text(v.license, 2000, true),
    termsVersion: text(v.termsVersion, 120, true),
    contributionGuide: text(v.contributionGuide, 8000, true),
    roadmap: text(v.roadmap, 8000),
    updates: text(v.updates, 8000),
  };
}
