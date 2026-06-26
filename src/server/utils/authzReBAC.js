/**
 * Authorization — Zanzibar-style ReBAC (Arch §3). Relationship tuples
 * object#relation@subject; the 7 RBAC roles are modeled as relations (not silos).
 *
 * Role hierarchy (a higher role satisfies a check for any lower one):
 *   owner > admin > editor > reviewer > viewer ; client ≈ viewer (external).
 * AGENT is NOT in the hierarchy — an agent subject is granted EXACTLY its
 * relation (a scoped relation off its owner), never an implicit escalation
 * (Arch §3 "agents map cleanly … never special-cased in business logic").
 *
 * Postgres MVP: a tuple lookup + an in-code userset rewrite. Same /authz/check
 * contract as OpenFGA, so the engine can be swapped without touching callers.
 */
const ROLE_RANK = { viewer: 1, client: 1, reviewer: 2, editor: 3, admin: 4, owner: 5 };

function parseRef(s) {
  const i = String(s).indexOf(':');
  return i === -1 ? { type: s, id: '' } : { type: s.slice(0, i), id: s.slice(i + 1) };
}

/** Add/remove tuples. writes/deletes = [{ object, relation, subject }]. */
export async function writeTuples(db, { writes = [], deletes = [] }) {
  let added = 0;
  let removed = 0;
  for (const t of writes) {
    const o = parseRef(t.object);
    const s = parseRef(t.subject);
    const r = await db.query(
      `INSERT INTO relationship_tuples (object_type, object_id, relation, subject_type, subject_id)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [o.type, o.id, t.relation, s.type, s.id],
    );
    added += r.rowCount;
  }
  for (const t of deletes) {
    const o = parseRef(t.object);
    const s = parseRef(t.subject);
    const r = await db.query(
      `DELETE FROM relationship_tuples
       WHERE object_type=$1 AND object_id=$2 AND relation=$3 AND subject_type=$4 AND subject_id=$5`,
      [o.type, o.id, t.relation, s.type, s.id],
    );
    removed += r.rowCount;
  }
  return { ok: true, added, removed };
}

/** All relations `subject` holds directly on `object`. */
async function heldRelations(db, object, subject) {
  const o = parseRef(object);
  const s = parseRef(subject);
  const r = await db.query(
    `SELECT relation FROM relationship_tuples
     WHERE object_type=$1 AND object_id=$2 AND subject_type=$3 AND subject_id=$4`,
    [o.type, o.id, s.type, s.id],
  );
  return { held: r.rows.map((x) => x.relation), subjectType: s.type };
}

/** check(object, relation, subject) → { allowed, via }. */
export async function check(db, { object, relation, subject }) {
  if (!object || !relation || !subject) return { allowed: false };
  const { held, subjectType } = await heldRelations(db, object, subject);
  if (held.includes(relation)) return { allowed: true, via: 'direct' };
  // "member" = holds ANY relation on the object.
  if (relation === 'member' && held.length > 0) return { allowed: true, via: 'membership' };
  // Role hierarchy — humans only; agents get exactly their granted relation.
  const want = ROLE_RANK[relation];
  if (want && subjectType !== 'agent') {
    const best = Math.max(0, ...held.map((r) => ROLE_RANK[r] || 0));
    if (best >= want) return { allowed: true, via: 'role-hierarchy' };
  }
  return { allowed: false };
}

/** List every (relation, subject) on an object — for admin UIs. */
export async function listObjectTuples(db, object) {
  const o = parseRef(object);
  const r = await db.query(
    `SELECT relation, subject_type, subject_id FROM relationship_tuples
     WHERE object_type=$1 AND object_id=$2 ORDER BY relation`,
    [o.type, o.id],
  );
  return r.rows.map((x) => ({ relation: x.relation, subject: `${x.subject_type}:${x.subject_id}` }));
}

export { ROLE_RANK };
