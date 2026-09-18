/**
 * The message tree on the client — the same three rules as `server/utils/chatBranches.js`.
 *
 * An edit or a regenerate is a SIBLING branch, never an overwrite (ChatGPT's and Claude's model,
 * 2026-09-18 /isg): each user message can have several versions, each version its own reply
 * chain, and the bubble shows ‹ i/n › to move between them. The server owns the tree
 * (`parent_id`, `active_leaf_id`); this module derives what the client shows from the rows it
 * was handed, so the two sides cannot disagree about what "the thread" is.
 */

export interface BranchRow {
  id: string;
  parent_id?: string | null;
  role: string;
  message_index?: number;
  created_at?: string;
}

const order = (a: BranchRow, b: BranchRow): number =>
  ((a.message_index ?? 0) - (b.message_index ?? 0)) || (Date.parse(a.created_at || '') - Date.parse(b.created_at || ''));

/** The newest row by creation order — the fallback leaf. */
export function newestOf<T extends BranchRow>(rows: T[]): T | null {
  return [...rows].sort((a, b) => order(b, a))[0] ?? null;
}

/** The path root → leaf in reading order; an unknown leaf falls back to the newest row. */
export function activePath<T extends BranchRow>(rows: T[], leafId: string | null | undefined): T[] {
  if (!rows.length) return [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  let node: T | null = (leafId && byId.get(leafId)) || newestOf(rows);
  const path: T[] = [];
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.push(node);
    node = node.parent_id ? byId.get(node.parent_id) ?? null : null;
  }
  return path.reverse();
}

/** Siblings of a message — the versions ‹ i/n › moves between — in creation order. */
export function siblingsOf<T extends BranchRow>(rows: T[], messageId: string): T[] {
  const me = rows.find((row) => row.id === messageId);
  if (!me) return [];
  return rows
    .filter((row) => (row.parent_id ?? null) === (me.parent_id ?? null) && row.role === me.role)
    .sort(order);
}

/** `{ current, total, siblings }` for a bubble's control; `total` 1 means no control. */
export function branchInfo<T extends BranchRow>(rows: T[], messageId: string | undefined): { current: number; total: number; siblings: T[] } {
  if (!messageId) return { current: 1, total: 1, siblings: [] };
  const siblings = siblingsOf(rows, messageId);
  const at = siblings.findIndex((row) => row.id === messageId);
  return { current: at < 0 ? 1 : at + 1, total: Math.max(1, siblings.length), siblings };
}
