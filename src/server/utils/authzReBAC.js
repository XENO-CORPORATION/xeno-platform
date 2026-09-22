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

/**
 * PARENT INHERITANCE IS DECLARED PER OBJECT TYPE — it is not a property of the graph.
 *
 * The rewrite below used to follow a `parent` tuple for ANY object type. That is right for a
 * CONTAINMENT parent (a conversation inside a workspace: holding `editor` on the workspace should
 * mean `editor` on its conversations) and wrong for a STRUCTURAL parent — a division inside a
 * division, where a grant on `dev` must NOT silently become the same grant on every child.
 * XENO-WORKFORCE-01 §21 names this exactly: "current any-parent behavior cannot represent all
 * intersections. Add action-specific predicates and tests, not more parent edges."
 *
 * So the object type declares what its `parent` edge MEANS, and an UNDECLARED TYPE DOES NOT
 * INHERIT. That default matters more than the list: a new object type added later gets the safe
 * behaviour without anyone remembering to opt out, and opting IN is a visible line in this file.
 *
 * 🔴 EVERY TYPE THAT WRITES A `parent` TUPLE TODAY IS LISTED, so this is behaviour-preserving for
 * every live grant. Derived by grepping every `relation: 'parent'` write site before changing it:
 *   chatRoutes.js            conversation → project | workspace
 *   chatProjectAuthority.js  project → workspace, library_asset → project
 *   libraryAssets.js         library_asset | artifact → project | workspace
 *   workspaceContext.js      <caller-supplied type> → workspace   ← see WORKSPACE_SCOPED below
 *   chatScheduledWorker.js   conversation → project
 * Adding a type here grants inheritance deliberately; omitting one refuses it deliberately.
 */
const PARENT_INHERITS = new Set(['conversation', 'project', 'library_asset', 'artifact']);

/**
 * `workspaceContext.js` writes `<objectType>:<id>#parent@workspace:<id>` with a caller-supplied
 * type, so the set above cannot be complete by inspection alone. A parent that IS a workspace is
 * containment by construction — the workspace is the tenant — so it keeps inheriting whatever the
 * child type is. A parent of any OTHER type must be declared. This is what keeps the change
 * behaviour-preserving without pretending the write sites are enumerable.
 */
const CONTAINMENT_PARENT_TYPES = new Set(['workspace']);

/** Does `childType` inherit a relation through a `parent` tuple pointing at `parentType`? */
export function inheritsFromParent(childType, parentType) {
  if (CONTAINMENT_PARENT_TYPES.has(parentType)) return true;
  return PARENT_INHERITS.has(childType);
}

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

/**
 * check(object, relation, subject) → { allowed, via }.
 *
 * Resolution order: direct tuple → `member` (holds any relation) → role hierarchy
 * (humans only) → USERSET REWRITE via parent inheritance. The last is the Zanzibar
 * "tupleset → computed userset": a resource linked to a parent object with a
 * `parent` tuple (`conversation:C#parent@workspace:W`) inherits the subject's SAME
 * relation on that parent — so a workspace member/editor/owner automatically has the
 * matching relation on the workspace's conversations, projects, runs, etc. `_depth`
 * bounds the recursion (cycle/anti-DoS guard).
 *
 * ⚠️ That last step is DECLARED, not automatic — see `inheritsFromParent`. Inheriting through
 * ANY `parent` tuple cannot express a structural hierarchy (a division inside a division), and
 * an undeclared object type deliberately does not inherit.
 */
export async function check(db, { object, relation, subject }, _depth = 0) {
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
  // Userset rewrite: inherit the relation from any parent object (bounded recursion).
  if (_depth < 8) {
    const o = parseRef(object);
    const parents = await db.query(
      `SELECT subject_type, subject_id FROM relationship_tuples
       WHERE object_type=$1 AND object_id=$2 AND relation='parent'`,
      [o.type, o.id],
    );
    for (const p of parents.rows) {
      // ACTION-SPECIFIC, not any-parent: the child type must declare that its `parent` edge
      // carries authority (or the parent must be a containment tenant). A structural parent — a
      // division above a division — is skipped here, so a grant on the parent is NOT silently a
      // grant on the child. XENO-WORKFORCE-01 §21.
      if (!inheritsFromParent(o.type, p.subject_type)) continue;
      const parentRef = `${p.subject_type}:${p.subject_id}`;
      const r = await check(db, { object: parentRef, relation, subject }, _depth + 1);
      if (r.allowed) return { allowed: true, via: `parent(${parentRef})→${r.via}` };
    }
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
