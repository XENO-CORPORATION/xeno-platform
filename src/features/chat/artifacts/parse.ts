// parse.ts — detect artifact blocks in assistant message content.
//
// An artifact is a fenced code block whose info string names an artifact language:
//   ```html title="Landing page"
//   ```svg
//   ```mermaid
//   ```jsx  /  ```tsx      → React
//   ```document            → rendered as markdown
// `markdown`/`md` fences qualify as an artifact ONLY when they carry a title meta
// (so ordinary short markdown snippets stay inline code).
//
// The scanner is streaming-aware: an OPEN fence with no closing ``` yet (the model is
// still generating) is surfaced as an incomplete artifact so the UI can show a live
// "generating" card. Everything here is pure — it never touches the DOM or the store.

import type { ArtifactKind, ArtifactVersion, Artifact, MessageSegment } from './types';
import type { UIMessage } from '../types';

const KIND_BY_LANG: Record<string, ArtifactKind> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'react',
  tsx: 'react',
  document: 'document',
};

/** Languages that only become artifacts when an explicit title is supplied. */
const TITLE_GATED_LANGS = new Set(['markdown', 'md']);

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'artifact'
  );
}

/** Pull `title="…"`/`title='…'`/`title=word` out of a fence info string. */
function parseTitle(meta: string): string | undefined {
  const q = /title\s*=\s*"([^"]+)"|title\s*=\s*'([^']+)'|title\s*=\s*(\S+)/.exec(meta);
  if (!q) return undefined;
  const raw = (q[1] ?? q[2] ?? q[3] ?? '').trim();
  return raw || undefined;
}

interface RawBlock {
  lang: string;
  kind: ArtifactKind;
  title?: string;
  content: string;
  complete: boolean;
  /** Ordinal of this artifact block within the message (for stable untitled ids). */
  ordinal: number;
}

type Segment =
  | { type: 'prose'; text: string }
  | { type: 'artifact'; block: RawBlock };

const OPEN_FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^(\s*)(`{3,}|~{3,})\s*$/;

/**
 * Scan one message's content for artifact blocks + ordered segments (prose + artifacts).
 * Non-artifact fenced code blocks are passed through untouched inside prose segments.
 */
function scan(content: string): { blocks: RawBlock[]; segments: Segment[] } {
  const blocks: RawBlock[] = [];
  const segments: Segment[] = [];
  const lines = content.split('\n');

  let proseBuf: string[] = [];
  let ordinal = 0;

  const flushProse = () => {
    if (proseBuf.length) {
      segments.push({ type: 'prose', text: proseBuf.join('\n') });
      proseBuf = [];
    }
  };

  for (let i = 0; i < lines.length; ) {
    const m = OPEN_FENCE.exec(lines[i]);
    if (!m) {
      proseBuf.push(lines[i]);
      i += 1;
      continue;
    }

    const fenceChar = m[2][0];
    const fenceLen = m[2].length;
    const info = m[3].trim();
    const langToken = info.split(/\s+/)[0]?.toLowerCase() || '';
    const meta = info.slice(langToken.length);
    const title = parseTitle(meta);
    const isArtifactLang =
      langToken in KIND_BY_LANG || (TITLE_GATED_LANGS.has(langToken) && !!title);

    // Locate the matching closing fence.
    let j = i + 1;
    let closeIdx = -1;
    while (j < lines.length) {
      const cm = CLOSE_FENCE.exec(lines[j]);
      if (cm && cm[2][0] === fenceChar && cm[2].length >= fenceLen) {
        closeIdx = j;
        break;
      }
      j += 1;
    }
    const complete = closeIdx !== -1;
    const bodyEnd = complete ? closeIdx : lines.length;
    const body = lines.slice(i + 1, bodyEnd).join('\n');

    if (isArtifactLang) {
      flushProse();
      const block: RawBlock = {
        lang: langToken,
        kind: KIND_BY_LANG[langToken] ?? 'document',
        title,
        content: body,
        complete,
        ordinal: ordinal++,
      };
      blocks.push(block);
      segments.push({ type: 'artifact', block });
    } else {
      // Preserve the non-artifact fenced block verbatim in the prose stream.
      proseBuf.push(lines[i]);
      for (let k = i + 1; k < bodyEnd; k += 1) proseBuf.push(lines[k]);
      if (complete) proseBuf.push(lines[closeIdx]);
    }

    i = complete ? closeIdx + 1 : lines.length;
  }

  flushProse();
  return { blocks, segments };
}

/** The stable artifact id for a block: title slug if titled, else per-message ordinal. */
function artifactIdFor(block: RawBlock, messageId: string): string {
  return block.title ? `t:${slugify(block.title)}` : `m:${messageId}:${block.ordinal}`;
}

function fallbackTitle(block: RawBlock): string {
  if (block.title) return block.title;
  const map: Record<ArtifactKind, string> = {
    html: 'HTML page',
    svg: 'SVG image',
    mermaid: 'Diagram',
    react: 'React component',
    document: 'Document',
    code: 'Snippet',
  };
  return map[block.kind] || 'Artifact';
}

/**
 * Split a message's content into ordered render segments (prose + artifact cards),
 * so MessageBubble can show a compact card where each artifact block sits instead of
 * dumping the raw source inline.
 */
export function splitSegments(content: string, messageId: string): MessageSegment[] {
  const { segments } = scan(content);
  const out: MessageSegment[] = [];
  for (const s of segments) {
    if (s.type === 'prose') {
      if (s.text.trim()) out.push({ kind: 'markdown', text: s.text });
    } else {
      out.push({
        kind: 'artifact',
        artifactId: artifactIdFor(s.block, messageId),
        title: fallbackTitle(s.block),
        artifactKind: s.block.kind,
        lang: s.block.lang,
        complete: s.block.complete,
      });
    }
  }
  if (out.length === 0 && content.length) out.push({ kind: 'markdown', text: content });
  return out;
}

/** True if the content contains at least one artifact block. */
export function hasArtifacts(content: string): boolean {
  return scan(content).blocks.length > 0;
}

/**
 * Derive the artifact list for a whole conversation. Blocks that share an id (same
 * title) across messages collapse into ordered VERSIONS (first-seen order, newest
 * last). Untitled blocks are per-message singletons.
 */
export function deriveArtifacts(messages: UIMessage[]): Artifact[] {
  const byId = new Map<string, Artifact>();
  const order: string[] = [];

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.content) continue;
    const { blocks } = scan(msg.content);
    for (const block of blocks) {
      const id = artifactIdFor(block, msg.id);
      const version: ArtifactVersion = {
        versionId: `${msg.id}:${block.ordinal}`,
        artifactId: id,
        title: fallbackTitle(block),
        kind: block.kind,
        lang: block.lang,
        content: block.content,
        messageId: msg.id,
        createdAt: msg.createdAt,
        complete: block.complete,
      };
      const existing = byId.get(id);
      if (existing) {
        const at = existing.versions.findIndex((v) => v.versionId === version.versionId);
        if (at >= 0) existing.versions[at] = version;
        else existing.versions.push(version);
        existing.title = version.title;
        existing.kind = version.kind;
        existing.lang = version.lang;
      } else {
        byId.set(id, {
          id,
          title: version.title,
          kind: version.kind,
          lang: version.lang,
          versions: [version],
        });
        order.push(id);
      }
    }
  }

  return order.map((id) => byId.get(id)!);
}

/** File extension for downloading a version, keyed off its language/kind. */
export function extensionFor(kind: ArtifactKind, lang: string): string {
  switch (lang) {
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    case 'svg':
      return 'svg';
    case 'html':
      return 'html';
    case 'mermaid':
      return 'mmd';
    case 'document':
    case 'markdown':
    case 'md':
      return 'md';
    default:
      break;
  }
  switch (kind) {
    case 'react':
      return 'jsx';
    case 'mermaid':
      return 'mmd';
    case 'document':
      return 'md';
    default:
      return kind === 'code' ? 'txt' : kind;
  }
}
