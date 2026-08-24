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

import { chatService } from '@/services/chatService';

/** Seed store — session-level fallback until backend responds. */
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
 * Fetches from backend GET /api/chat/artifacts when authenticated, with local cache fallback.
 */
export const listArtifacts = async (
  input: ListArtifactsInput = {},
): Promise<ChatArtifact[]> => {
  try {
    if (chatService.isAuthenticated()) {
      const serverArtifacts = await chatService.getArtifacts({
        kind: input.kind,
        sort: input.sort,
        query: input.query,
      });

      if (Array.isArray(serverArtifacts)) {
        const mapped: ChatArtifact[] = serverArtifacts.map((row) => ({
          id: row.id,
          title: row.title,
          kind: row.kind as ArtifactKind,
          conversationId: row.conversation_id || '',
          conversationTitle: row.conversation_title || 'Untitled Chat',
          previewText: row.preview_text || '',
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        }));
        // Merge into store
        const existingIds = new Set(mapped.map((a) => a.id));
        artifactsStore = [...mapped, ...artifactsStore.filter((a) => !existingIds.has(a.id))];
        return mapped;
      }
    }
  } catch (err) {
    console.warn('[chatArtifacts] Failed to list artifacts from backend, using local store:', err);
  }

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

export const getArtifact = async (id: string): Promise<ChatArtifact | null> => {
  try {
    if (chatService.isAuthenticated()) {
      const row = await chatService.getArtifact(id);
      if (row) {
        return {
          id: row.id,
          title: row.title,
          kind: row.kind as ArtifactKind,
          conversationId: row.conversation_id || '',
          conversationTitle: row.conversation_title || 'Untitled Chat',
          previewText: row.preview_text || '',
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        };
      }
    }
  } catch (err) {
    console.warn('[chatArtifacts] Failed to get artifact from backend:', err);
  }
  return artifactsStore.find((artifact) => artifact.id === id) ?? null;
};

/**
 * Share URL for an artifact.
 */
export const getArtifactShareUrl = (id: string): string =>
  `https://share.xenostudio.ai/a/${id}`;

/** Delete artifact from database and local store. */
export const deleteArtifact = async (id: string): Promise<void> => {
  try {
    if (chatService.isAuthenticated()) {
      await chatService.deleteArtifact(id);
    }
  } catch (err) {
    console.warn('[chatArtifacts] Failed to delete artifact on backend:', err);
  }
  artifactsStore = artifactsStore.filter((artifact) => artifact.id !== id);
};

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  document: 'Document',
  code: 'Code',
  image: 'Images',
  html: 'Interactive',
};
