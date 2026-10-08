/**
 * SemVer 2.0.0 precedence (section 11): the ONE version comparator for XENO version gates.
 *
 * Two gates use it and must agree. The client version floor (services/clientVersion.js)
 * refuses a build below `min_supported`. The tool publisher's downgrade guard
 * (scripts/publish-tool-packages.mjs) refuses to replace a newer live tool. Each once had
 * its own copy, and the copies drifted: both compared prereleases as strings, so
 * 0.1.0-rc.10 sorted BELOW 0.1.0-rc.9. A floor set at rc.10 admitted rc.9 builds, and the
 * publisher accepted rc.9 over a live rc.10.
 *
 * Precedence, per SemVer 2.0.0:
 *  - Build metadata (everything after the first `+`) is ignored, so 1.2.3+4.5 equals 1.2.3.
 *  - The core compares numerically, part by part, as digit strings: a part past 2^53 keeps its
 *    order. A missing part reads as zero.
 *  - A prerelease (everything after the FIRST hyphen of the version, later hyphens
 *    included) sorts BELOW its release. Its dot-separated identifiers compare one by one:
 *    numeric identifiers as integers (rc.9 < rc.10), alphanumeric identifiers in ASCII
 *    order, a numeric identifier below an alphanumeric one, and a longer set above a
 *    shorter set it begins with (1.0.0-alpha < 1.0.0-alpha.1).
 *
 * Loose by design, as it always was: a missing or empty version reads as "0". Nothing is
 * rejected as malformed. Malformed input compares by the same rules, and the tests say
 * what each shape means.
 *
 * Dependency-free on purpose. It is imported by the server and by the root publish script,
 * and it must not add a package to either.
 */

const NUMERIC_IDENTIFIER = /^\d+$/;
const LEADING_DIGITS = /^\d+/;

/**
 * One numeric core part, as a digit string with no leading zeros. It keeps the digits before any
 * trailing text, as parseInt did, and a part with no leading digits reads as zero. It is a string,
 * not a Number: Number() rounds past 2^53, and 309 digits or more become Infinity.
 */
function corePart(part) {
  const digits = LEADING_DIGITS.exec(part.trimStart());
  return digits ? digits[0].replace(/^0+(?=\d)/, '') : '0';
}

/** `{ nums, pre }`: the core parts as digit strings, and the prerelease text (or null). */
function parseVersion(raw) {
  let text = String(raw || '0');
  const build = text.indexOf('+');
  if (build !== -1) text = text.slice(0, build);
  const hyphen = text.indexOf('-');
  const core = hyphen === -1 ? text : text.slice(0, hyphen);
  const pre = hyphen === -1 ? '' : text.slice(hyphen + 1);
  return {
    nums: core.split('.').map(corePart),
    pre: pre === '' ? null : pre,
  };
}

/** Two digit strings with no leading zeros, compared as integers: -1, 0 or 1. */
function compareNumeric(x, y) {
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

/** SemVer 11.4.1 to 11.4.3, for one pair of prerelease identifiers. */
function compareIdentifiers(a, b) {
  const aNumeric = NUMERIC_IDENTIFIER.test(a);
  const bNumeric = NUMERIC_IDENTIFIER.test(b);
  if (aNumeric && bNumeric) {
    // Numeric identifiers compare as integers, by digit string, so a value past 2^53 keeps its
    // order. Leading zeros are not significant.
    return compareNumeric(a.replace(/^0+(?=\d)/, ''), b.replace(/^0+(?=\d)/, ''));
  }
  if (aNumeric) return -1; // a numeric identifier sorts below an alphanumeric one
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1; // alphanumeric identifiers: ASCII order
}

/** SemVer 11.4: two prerelease texts, compared field by field. */
function comparePrerelease(a, b) {
  const x = a.split('.');
  const y = b.split('.');
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = compareIdentifiers(x[i], y[i]);
    if (diff !== 0) return diff;
  }
  // 11.4.4: when every shared field is equal, the longer set has the higher precedence.
  if (x.length === y.length) return 0;
  return x.length < y.length ? -1 : 1;
}

/** -1, 0 or 1, by SemVer 2.0.0 section 11 precedence. */
export function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  const length = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < length; i += 1) {
    const diff = compareNumeric(A.nums[i] || '0', B.nums[i] || '0');
    if (diff !== 0) return diff;
  }
  if (A.pre === B.pre) return 0; // both null, or the same prerelease text
  if (A.pre === null) return 1; // 11.3: a release outranks each of its prereleases
  if (B.pre === null) return -1;
  return comparePrerelease(A.pre, B.pre);
}
