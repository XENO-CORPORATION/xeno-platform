/**
 * AREA: the part of the workspace an item lives in (Studio, Office, Social, Corpo, Dev, Tools, or an
 * area the person made). See database/migrations/20261009200000-resource-area.sql for the rule.
 *
 * The set of areas is the front end's (people make their own), so the server checks the SHAPE of an
 * id, not membership in a list: lower-case letters, digits, '-' and '_', starting with a letter, at
 * most 40 characters. 'overview' is not an area: Overview is the view across all of them.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * The area a request was made IN, from its `X-Xeno-Area` header (the workspace and the chat shown inside it
 * send it). Something stored while handling that request (an upload, an image a chat made, a file a sandbox
 * produced) lands in that area. A missing or malformed header means no area: it is a label on the person's
 * own items, never an authority, so it is ignored rather than refused.
 */
const areaContext = new AsyncLocalStorage();
export function areaFromRequest(req, _res, next) {
  const raw = req.headers['x-xeno-area'];
  const value = typeof raw === 'string' ? raw.trim() : '';
  req.xenoArea = SHAPE.test(value) && value !== 'overview' ? value : null;
  areaContext.run({ area: req.xenoArea }, next);
}
/** The area of the request being handled, or null. Prefer passing `req.xenoArea` where the request is at hand. */
export function currentArea() { return areaContext.getStore()?.area ?? null; }

export class AreaError extends Error {
  constructor(message) { super(message); this.code = 'invalid_area'; this.status = 400; }
}

/**
 * What a request said about an area.
 *   undefined            -> { given: false }            the request did not mention it
 *   null, '', 'none'     -> { given: true, area: null } no area (Overview only)
 *   'dev'                -> { given: true, area: 'dev' }
 * Anything else throws AreaError (the route answers 400 invalid_area).
 */
export function readArea(value) {
  if (value === undefined) return { given: false, area: null };
  if (value === null || value === '' || value === 'none') return { given: true, area: null };
  if (typeof value !== 'string' || !SHAPE.test(value) || value === 'overview') {
    throw new AreaError('An area is a short lower-case id such as "dev" or "studio". Overview is not an area.');
  }
  return { given: true, area: value };
}

/** A list filter: `?area=dev` one area, `?area=none` items with no area, absent = everything. */
export function readAreaFilter(value) {
  if (value === undefined) return { filter: false, area: null };
  const read = readArea(Array.isArray(value) ? value[0] : value);
  return { filter: true, area: read.area };
}

/** SQL for "the area this conversation lives in": its project's when it is in one, else its own. */
export const EFFECTIVE_CONVERSATION_AREA = `CASE WHEN c.project_id IS NOT NULL THEN (SELECT ap.area FROM chat_projects ap WHERE ap.id = c.project_id) ELSE c.area END`;
