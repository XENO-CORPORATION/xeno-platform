/* Shared heading utilities for the docs system. DocMarkdown assigns heading
 * `id`s with slugify(); TableOfContents extracts the same headings from the raw
 * markdown with extractHeadings() — both must agree, so keep authored headings
 * plain text (no inline markdown in headings). */

export function slugify(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

/** Pull h2/h3 headings out of a markdown string, skipping fenced code blocks. */
export function extractHeadings(markdown: string, minDepth = 2, maxDepth = 3): Heading[] {
  const lines = markdown.split('\n');
  const out: Heading[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const depth = m[1].length;
    if (depth < minDepth || depth > maxDepth) continue;
    const text = m[2]
      .replace(/[`*_]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    if (text) out.push({ depth, text, id: slugify(text) });
  }
  return out;
}

/** Flatten a React children tree to plain text (for heading ids). */
export function nodeToText(node: unknown): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  const anyNode = node as { props?: { children?: unknown } };
  if (anyNode.props && anyNode.props.children != null) return nodeToText(anyNode.props.children);
  return '';
}
