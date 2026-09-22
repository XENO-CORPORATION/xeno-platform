/**
 * One predicate deciding which database a workforce migration suite may touch.
 *
 * Every workforce suite CREATEs and DROPs schemas, so pointing one at a real database would
 * destroy data. The original guard was `assert.equal(pathname, '/workforceproof')` — correct, and
 * copied into four files, where it pinned a single literal NAME rather than the property that
 * makes a database safe. That made the suites impossible for `qualify-platform-local.mjs` to run:
 * the qualifier mints `xeno_qual_<32 hex>` databases per suite and drops them after, which is
 * strictly safer than a shared fixture, and the guard refused it.
 *
 * So the rule is the PROPERTY, in one place: a database is acceptable only if its name says it is
 * disposable. Anything else — including a database that merely looks like a scratch one — is
 * refused, and the refusal names what it saw.
 */

/** The disposable-database shapes a workforce suite may operate on. */
const DISPOSABLE = [
  /^workforceproof$/,               // the hand-run fixture; created and dropped by the operator
  /^xeno_qual_[a-f0-9]{32}$/,       // minted per-suite by qualify-platform-local.mjs, dropped after
];

/**
 * Resolve the connection string a workforce suite may use, or throw.
 * @param {string|undefined} connectionString
 * @returns {string}
 */
export function requireProofDatabase(connectionString) {
  if (!connectionString) {
    throw new Error(
      'WORKFORCE_TEST_DATABASE_URL required; no skipped SQL proof. ' +
      'These suites prove migrations against real PostgreSQL or they prove nothing.');
  }
  const target = new URL(connectionString);

  // Kept from the membership suite, which was the only one that checked it: a disposable NAME on
  // a remote host is not disposable. Loopback is not a convenience here, it is half the guarantee.
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(target.hostname)) {
    throw new Error(
      `refusing a non-loopback database host "${target.hostname}": these suites create and drop ` +
      `schemas, so they run only against a local disposable instance.`);
  }

  const name = target.pathname.replace(/^\//, '');
  if (!DISPOSABLE.some(shape => shape.test(name))) {
    throw new Error(
      `refusing to run against database "${name}": a workforce suite creates and drops schemas, ` +
      `so it may only touch a disposable database (workforceproof, or a qualifier-minted ` +
      `xeno_qual_<hex>). Point WORKFORCE_TEST_DATABASE_URL at one of those.`);
  }
  if (target.search) {
    throw new Error(`refusing a connection string carrying query parameters: ${target.search}`);
  }
  return connectionString;
}

/**
 * Whether a workforce suite can run here at all.
 *
 * The suites used to ASSERT the variable was present, which made them impossible to put in the
 * npm chain: every developer machine and every CI job without PostgreSQL went red on a suite that
 * simply had nothing to run against. The repo's own reachability gate prescribes the alternative —
 * "an env guard INSIDE itself, where its skip is visible in the run output, not absent from it" —
 * and `workspace-teams.test.mjs` already does exactly this with `{ skip: !TEST_DATABASE_URL }`.
 *
 * A skip is honest; a PASS would not be. Nothing here ever reports success without a database.
 */
export const workforceProofUnavailable = () =>
  process.env.WORKFORCE_TEST_DATABASE_URL
    ? false
    : 'WORKFORCE_TEST_DATABASE_URL is not set: these suites prove migrations against real ' +
      'PostgreSQL. Run scripts/qualify-platform-local.mjs, or point it at a disposable database.';
