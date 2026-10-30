/**
 * Are these tables already there? A helper with a create-if-missing fallback asks this first, so the running app
 * (xeno_app, which cannot run DDL) never issues any: in production a migration has always created them. The fallback
 * exists only for a bare test database. A reply it cannot read counts as "not there", which keeps old behaviour.
 */
export async function tablesPresent(db, names) {
  const r = await db.query('SELECT bool_and(to_regclass(n) IS NOT NULL) AS ok FROM unnest($1::text[]) AS n', [names]);
  return r?.rows?.[0]?.ok === true;
}
