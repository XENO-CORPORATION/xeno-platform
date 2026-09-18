/**
 * The message tree — pure functions the chat routes and the exports share.
 *
 * A conversation's messages form a tree (`parent_id`); the branch a person sees is the path from
 * `active_leaf_id` up to the root. Everything that used to read "the messages, in order" now reads
 * the ACTIVE PATH: the LLM context, the share view, the export, the title. Branches that are not
 * active still exist and are still the person's — they are simply not what is shown.
 *
 * The leaf never dangles: a new message becomes the leaf; deleting the leaf's subtree moves the
 * leaf to the deleted node's parent; a conversation whose leaf is unknown falls back to its
 * newest message, so a row written before the migration is never unreachable.
 */

/** id → row, for one conversation. */
export function indexById(rows) {
  const byId = new Map();
  for (const row of rows) byId.set(row.id, row);
  return byId;
}

/** The newest message by creation order — the fallback leaf. */
export function newestOf(rows) {
  return [...rows].sort((a, b) => (b.message_index - a.message_index) || (new Date(b.created_at) - new Date(a.created_at)))[0] ?? null;
}

/**
 * The path from the root to `leafId`, in reading order. An unknown or missing leaf falls back
 * to the newest message; a cycle (impossible by construction, guarded anyway) ends the walk.
 */
export function activePath(rows, leafId) {
  if (!rows.length) return [];
  const byId = indexById(rows);
  let node = (leafId && byId.get(leafId)) || newestOf(rows);
  const path = [];
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.push(node);
    node = node.parent_id ? byId.get(node.parent_id) : null;
  }
  return path.reverse();
}

/**
 * The deepest descendant of `startId`, following the newest child at every level — where a
 * branch switch lands: the latest reply chain under the chosen version.
 */
export function deepestLeafUnder(rows, startId) {
  const byId = indexById(rows);
  const children = new Map();
  for (const row of rows) {
    if (!row.parent_id) continue;
    if (!children.has(row.parent_id)) children.set(row.parent_id, []);
    children.get(row.parent_id).push(row);
  }
  let node = byId.get(startId) ?? null;
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const kids = children.get(node.id);
    if (!kids?.length) break;
    node = newestOf(kids);
  }
  return node?.id ?? startId;
}

/**
 * Siblings of a message — the versions a ‹ i/n › control moves between — in creation order.
 * The root's siblings are every other parentless message of the conversation.
 */
export function siblingsOf(rows, messageId) {
  const byId = indexById(rows);
  const me = byId.get(messageId);
  if (!me) return [];
  return rows
    .filter((row) => (row.parent_id ?? null) === (me.parent_id ?? null) && row.role === me.role)
    .sort((a, b) => (a.message_index - b.message_index) || (new Date(a.created_at) - new Date(b.created_at)));
}
