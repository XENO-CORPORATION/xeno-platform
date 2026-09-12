/**
 * Chat Artifacts contract.
 *
 * UI calls these functions only. Authenticated state is server-authoritative;
 * the in-memory collection only caches successful server responses.
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

export type CreateArtifactInput = {
  title: string;
  kind: ArtifactKind;
  content: string;
  conversationId?: string;
  conversationTitle?: string;
};

import { chatService } from '@/services/chatService';

/** Session projection of successfully persisted artifacts; never an authority. */
let artifactsStore: ChatArtifact[] = [];

/**
 * Lists artifacts for the library page.
 * Fetches from the authoritative backend.
 */
export const listArtifacts = async (
  input: ListArtifactsInput = {},
): Promise<ChatArtifact[]> => {
  if (!chatService.isAuthenticated()) return [];
  try {
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
      artifactsStore = mapped;
      return mapped;
    }
  } catch (err) {
    console.error('[chatArtifacts] Failed to list artifacts from backend:', err);
    throw err;
  }
  return [];
};

export const getArtifact = async (id: string): Promise<ChatArtifact | null> => {
  if (!chatService.isAuthenticated()) return null;
  try {
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
  } catch (err) {
    console.error('[chatArtifacts] Failed to get artifact from backend:', err);
    throw err;
  }
  return null;
};

/**
 * Share URL for an artifact.
 */
export const getArtifactShareUrl = (id: string): string =>
  `https://share.xenostudio.ai/a/${id}`;

/** Backend: POST /api/chat/artifacts — server id when authenticated. */
export const createArtifact = async (
  input: CreateArtifactInput,
): Promise<ChatArtifact> => {
  const stamp = Date.now();
  const title = input.title.trim() || 'Untitled artifact';
  const content = input.content;
  const previewText = content.trim().slice(0, 160);
  const conversationId = input.conversationId ?? '';
  const conversationTitle = input.conversationTitle ?? 'Untitled Chat';
  if (!chatService.isAuthenticated()) throw new Error('Sign in to create an artifact.');

  try {
    const serverRow = await chatService.createArtifact({
        title,
        kind: input.kind,
        content,
        preview_text: previewText,
        conversation_id: conversationId || undefined,
      });
      if (serverRow) {
        const artifact: ChatArtifact = {
          id: serverRow.id,
          title: serverRow.title,
          kind: (serverRow.kind as ArtifactKind) || input.kind,
          conversationId: serverRow.conversation_id || conversationId,
          conversationTitle:
            serverRow.conversation_title || conversationTitle,
          previewText: serverRow.preview_text || previewText,
          createdAt: serverRow.created_at
            ? new Date(serverRow.created_at).getTime()
            : stamp,
          updatedAt: serverRow.updated_at
            ? new Date(serverRow.updated_at).getTime()
            : stamp,
        };
        artifactsStore = [artifact, ...artifactsStore];
        return artifact;
    }
  } catch (err) {
    console.error('[chatArtifacts] Failed to create artifact on backend:', err);
    throw err;
  }
  throw new Error('The artifact was not created.');
};

/** Delete artifact from database and local store. */
export const deleteArtifact = async (id: string): Promise<void> => {
  if (!chatService.isAuthenticated()) throw new Error('Sign in to delete an artifact.');
  try {
    const deleted = await chatService.deleteArtifact(id);
    if (!deleted) throw new Error('Artifact deletion was not saved.');
  } catch (err) {
    console.error('[chatArtifacts] Failed to delete artifact on backend:', err);
    throw err;
  }
  artifactsStore = artifactsStore.filter((artifact) => artifact.id !== id);
};

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  document: 'Document',
  code: 'Code',
  image: 'Images',
  html: 'Interactive',
};
