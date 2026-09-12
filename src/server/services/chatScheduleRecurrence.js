import rrulePackage from 'rrule';

import { CHAT_PROJECT_CONTRACTS } from '../config/chatProjectContracts.js';

const { RRule } = rrulePackage;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const formatterCache = new Map();

function formatterFor(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatterCache.get(timeZone);
}

export function validateIanaTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 100) return false;
  try {
    formatterFor(timeZone).format(new Date(0));
    return timeZone.includes('/') || timeZone === 'UTC';
  } catch {
    return false;
  }
}

export function parseLocalDateTime(value) {
  const match = LOCAL_RE.exec(String(value || ''));
  if (!match) throw Object.assign(new Error('Invalid local date-time'), { code: 'invalid_recurrence' });
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
  const check = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));
  if (check.getUTCFullYear() !== parts.year
      || check.getUTCMonth() + 1 !== parts.month
      || check.getUTCDate() !== parts.day
      || check.getUTCHours() !== parts.hour
      || check.getUTCMinutes() !== parts.minute
      || check.getUTCSeconds() !== parts.second) {
    throw Object.assign(new Error('Invalid local date-time'), { code: 'invalid_recurrence' });
  }
  return parts;
}

function toNaiveUtc(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function localPartsAt(instant, timeZone) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function sameLocal(a, b) {
  return a.year === b.year
    && a.month === b.month
    && a.day === b.day
    && a.hour === b.hour
    && a.minute === b.minute
    && a.second === b.second;
}

function offsetMinutesAt(instantMs, timeZone) {
  const instant = new Date(instantMs);
  const local = localPartsAt(instant, timeZone);
  return Math.round((toNaiveUtc(local) - instantMs) / 60_000);
}

function candidateInstants(parts, timeZone) {
  const naiveMs = toNaiveUtc(parts);
  const offsets = new Set();
  for (let delta = -36 * 60; delta <= 36 * 60; delta += 30) {
    offsets.add(offsetMinutesAt(naiveMs + delta * 60_000, timeZone));
  }
  return [...offsets]
    .map((offset) => naiveMs - offset * 60_000)
    .filter((candidate) => sameLocal(localPartsAt(new Date(candidate), timeZone), parts))
    .sort((a, b) => a - b);
}

/**
 * Convert a wall-clock time to an instant using the product's RFC 5545 policy:
 * choose the first instant for an overlap; for a spring gap, apply the offset
 * immediately before the gap (02:30 Europe/Berlin therefore becomes 03:30).
 */
export function localDateTimeToInstant(localDateTime, timeZone) {
  if (!validateIanaTimeZone(timeZone)) {
    throw Object.assign(new Error('Invalid IANA timezone'), { code: 'invalid_timezone' });
  }
  const parts = typeof localDateTime === 'string'
    ? parseLocalDateTime(localDateTime)
    : localDateTime;
  const candidates = candidateInstants(parts, timeZone);
  if (candidates.length > 0) return new Date(candidates[0]);

  const naiveMs = toNaiveUtc(parts);
  for (let minutesBack = 1; minutesBack <= 180; minutesBack += 1) {
    const priorNaive = naiveMs - minutesBack * 60_000;
    const prior = new Date(priorNaive);
    const priorParts = {
      year: prior.getUTCFullYear(),
      month: prior.getUTCMonth() + 1,
      day: prior.getUTCDate(),
      hour: prior.getUTCHours(),
      minute: prior.getUTCMinutes(),
      second: prior.getUTCSeconds(),
    };
    const priorCandidates = candidateInstants(priorParts, timeZone);
    if (priorCandidates.length > 0) {
      const preGapOffset = Math.round((priorNaive - priorCandidates[0]) / 60_000);
      return new Date(naiveMs - preGapOffset * 60_000);
    }
  }
  throw Object.assign(new Error('Could not resolve timezone transition'), { code: 'invalid_timezone' });
}

function floatingDate(parts) {
  return new Date(toNaiveUtc(parts));
}

function partsFromFloating(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function parseRule(rrule, dtstartParts) {
  const normalized = String(rrule || '').trim().replace(/^RRULE:/i, '');
  if (!normalized) throw Object.assign(new Error('Recurring schedules require RRULE'), { code: 'invalid_recurrence' });
  let options;
  try {
    options = RRule.parseString(normalized);
  } catch {
    throw Object.assign(new Error('Invalid RRULE'), { code: 'invalid_recurrence' });
  }
  if (options.dtstart || options.tzid) {
    throw Object.assign(new Error('DTSTART and TZID must use schedule fields'), { code: 'invalid_recurrence' });
  }
  if (options.count != null && options.until != null) {
    throw Object.assign(new Error('RRULE cannot contain both COUNT and UNTIL'), { code: 'invalid_recurrence' });
  }
  const count = options.count == null ? null : Number(options.count);
  const expansionOptions = { ...options };
  // rrule counts every floating candidate, including a wall-clock time that is
  // nonexistent in the selected IANA zone. RFC 5545 requires such generated
  // instances to be ignored and not counted, so enforce COUNT over accepted
  // zoned occurrences below instead of inside the dependency.
  delete expansionOptions.count;
  try {
    return {
      rule: new RRule({ ...expansionOptions, dtstart: floatingDate(dtstartParts) }),
      count,
    };
  } catch {
    throw Object.assign(new Error('Invalid RRULE'), { code: 'invalid_recurrence' });
  }
}

export function calculateScheduleOccurrences({
  scheduleKind,
  dtstartLocal,
  timeZone,
  rrule = null,
  after = null,
  limit = 5,
}) {
  if (!['once', 'recurring'].includes(scheduleKind)) {
    throw Object.assign(new Error('Invalid schedule kind'), { code: 'invalid_recurrence' });
  }
  if (!validateIanaTimeZone(timeZone)) {
    throw Object.assign(new Error('Invalid IANA timezone'), { code: 'invalid_timezone' });
  }
  const cappedLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 1, 1),
    CHAT_PROJECT_CONTRACTS.recurrence.maxPreviewOccurrences,
  );
  const dtstartParts = parseLocalDateTime(dtstartLocal);
  const afterMs = after == null ? Number.NEGATIVE_INFINITY : new Date(after).getTime();
  if (after != null && !Number.isFinite(afterMs)) {
    throw Object.assign(new Error('Invalid occurrence cursor'), { code: 'invalid_recurrence' });
  }

  if (scheduleKind === 'once') {
    if (rrule) throw Object.assign(new Error('One-shot schedules cannot include RRULE'), { code: 'invalid_recurrence' });
    const instant = localDateTimeToInstant(dtstartParts, timeZone);
    return instant.getTime() > afterMs ? [instant] : [];
  }

  const { rule, count } = parseRule(rrule, dtstartParts);
  const results = [];
  let cursor = new Date(floatingDate(dtstartParts).getTime() - 1000);
  let iterations = 0;
  let acceptedCount = 0;
  let firstCandidate = true;
  while (results.length < cappedLimit && iterations < 10_000) {
    iterations += 1;
    const localOccurrence = rule.after(cursor, false);
    if (!localOccurrence) break;
    cursor = localOccurrence;
    const localParts = partsFromFloating(localOccurrence);
    let instant;
    if (firstCandidate && sameLocal(localParts, dtstartParts)) {
      // DTSTART is a DATE-TIME value in its own right. RFC 5545 resolves an
      // initial nonexistent local value with the pre-gap offset.
      instant = localDateTimeToInstant(localParts, timeZone);
    } else {
      // A nonexistent local time generated by RRULE is ignored and MUST NOT
      // consume COUNT. An overlap uses the first matching instant.
      const candidates = candidateInstants(localParts, timeZone);
      if (candidates.length === 0) {
        firstCandidate = false;
        continue;
      }
      instant = new Date(candidates[0]);
    }
    firstCandidate = false;
    acceptedCount += 1;
    if (instant.getTime() > afterMs) results.push(instant);
    if (count != null && acceptedCount >= count) break;
  }
  if (iterations >= 10_000 && results.length < cappedLimit) {
    throw Object.assign(new Error('Recurrence expansion exceeded safety bound'), { code: 'invalid_recurrence' });
  }
  return results;
}

export function calculateNextScheduleOccurrence(input) {
  return calculateScheduleOccurrences({ ...input, limit: 1 })[0] || null;
}
