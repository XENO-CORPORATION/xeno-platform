// Artifact types — the derived, in-memory model for Claude-style artifacts.
//
// Artifacts are NOT persisted separately: they are DERIVED from message content
// (fenced code blocks with an artifact language + optional `title="…"` meta). The
// store exposes a selector that re-derives them from the active conversation's
// messages, so persistence stays exactly as P0 left it.

/** The renderer category an artifact maps to. */
export type ArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'document' | 'code';

/**
 * A single detected fenced block, resolved to an artifact version. Each occurrence
 * of the same logical artifact (same title) across the thread is one version.
 */
export interface ArtifactVersion {
  /** Stable id for this specific version instance. */
  versionId: string;
  /** The stable id of the artifact this version belongs to (title slug or block id). */
  artifactId: string;
  /** Human title (from `title="…"` meta, or a derived fallback). */
  title: string;
  /** Renderer category. */
  kind: ArtifactKind;
  /** Original fence language (html/svg/mermaid/jsx/tsx/document/…) — drives the file ext. */
  lang: string;
  /** Raw artifact source. */
  content: string;
  /** Owning message id (for ordering + provenance). */
  messageId: string;
  createdAt: number;
  /** False while the closing fence has not yet streamed in (block still generating). */
  complete: boolean;
}

/** An artifact = an ordered set of versions sharing one id, newest last. */
export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  lang: string;
  versions: ArtifactVersion[];
}

/** A parsed segment of an assistant message: prose (markdown) or an artifact card. */
export type MessageSegment =
  | { kind: 'markdown'; text: string }
  | {
      kind: 'artifact';
      artifactId: string;
      title: string;
      artifactKind: ArtifactKind;
      lang: string;
      complete: boolean;
    };
