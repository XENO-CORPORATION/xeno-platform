/**
 * Chat Artifacts contract.
 *
 * UI calls these functions only. Today they are in-memory mocks; a real backend
 * replaces the bodies without changing ChatArtifactsPage / ChatWithLLM.
 */

export type ArtifactKind = 'document' | 'code' | 'image' | 'html';

export type ChatArtifact = {
  id: string;
  title: string;
  kind: ArtifactKind;
  /** Owning conversation — for “open in chat” later. */
  conversationId: string;
  conversationTitle: string;
  /** Short plain preview for list cards (not full body). */
  previewText: string;
  createdAt: number;
  updatedAt: number;
};

export type ListArtifactsInput = {
  query?: string;
  kind?: ArtifactKind | 'all';
  sort?: 'updated' | 'created' | 'name';
};

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

/** Seed store — session-level until backend persists. */
let artifactsStore: ChatArtifact[] = [];

const matchesQuery = (artifact: ChatArtifact, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    artifact.title.toLowerCase().includes(q) ||
    artifact.conversationTitle.toLowerCase().includes(q) ||
    artifact.previewText.toLowerCase().includes(q) ||
    artifact.kind.toLowerCase().includes(q)
  );
};

/**
 * Lists artifacts for the library page.
 * Mock: filter + sort in memory. Backend: GET /api/chat/artifacts?...
 */
export const listArtifacts = async (
  input: ListArtifactsInput = {},
): Promise<ChatArtifact[]> => {
  const kind = input.kind ?? 'all';
  const sort = input.sort ?? 'updated';
  const query = input.query ?? '';

  let rows = artifactsStore.filter((artifact) => {
    if (kind !== 'all' && artifact.kind !== kind) return false;
    return matchesQuery(artifact, query);
  });

  rows = [...rows].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title);
    if (sort === 'created') return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });

  return rows;
};

export const getArtifact = async (id: string): Promise<ChatArtifact | null> =>
  artifactsStore.find((artifact) => artifact.id === id) ?? null;

/**
 * Share URL for an artifact.
 * Mock path mirrors chat share (`/c/…`); backend will mint real tokens later.
 */
export const getArtifactShareUrl = (id: string): string =>
  `https://share.xenostudio.ai/a/${id}`;

/** Mock delete — UI can call this; wire to DELETE later. */
export const deleteArtifact = async (id: string): Promise<void> => {
  artifactsStore = artifactsStore.filter((artifact) => artifact.id !== id);
};

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  document: 'Document',
  code: 'Code',
  image: 'Images',
  html: 'Interactive',
};
