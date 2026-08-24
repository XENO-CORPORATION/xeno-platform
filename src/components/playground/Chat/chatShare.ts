/**
 * Share-conversation contract.
 *
 * UI calls these functions only. Today they are in-memory mocks; a real backend
 * replaces the bodies without changing ChatShareModal.
 */

export type ShareVisibility = 'private' | 'team' | 'public';

export type SharePreviewMessage = {
  id: string;
  sender: 'user' | 'ai';
  text: string;
};

export type CreateShareLinkInput = {
  conversationId: string;
  visibility: ShareVisibility;
  /** Snapshot size at create time — "messages up to this point". */
  messageCount: number;
};

export type ShareLink = {
  id: string;
  url: string;
  visibility: ShareVisibility;
  conversationId: string;
  messageCount: number;
  createdAt: number;
};

export type SocialPlatform = 'linkedin' | 'x' | 'facebook' | 'reddit';

import { chatService } from '@/services/chatService';

/** Session-only store so Delete link works without a backend. */
const mockLinksByConversation = new Map<string, ShareLink>();

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Creates (or replaces) a share link for a conversation snapshot.
 * Tries server-side database share first, falling back to local link if offline/unauthenticated.
 */
export const createShareLink = async (
  input: CreateShareLinkInput,
): Promise<ShareLink> => {
  try {
    if (chatService.isAuthenticated()) {
      const serverShare = await chatService.createShareLink(input.conversationId);
      if (serverShare && serverShare.share_token) {
        const link: ShareLink = {
          id: serverShare.share_token,
          url: serverShare.share_url || `https://share.xenostudio.ai/c/${serverShare.share_token}`,
          visibility: input.visibility,
          conversationId: input.conversationId,
          messageCount: input.messageCount,
          createdAt: Date.now(),
        };
        mockLinksByConversation.set(input.conversationId, link);
        return link;
      }
    }
  } catch (err) {
    console.warn('[chatShare] Backend share link creation failed, using local link', err);
  }

  const id = randomId();
  const link: ShareLink = {
    id,
    url: `https://share.xenostudio.ai/c/${id}`,
    visibility: input.visibility,
    conversationId: input.conversationId,
    messageCount: input.messageCount,
    createdAt: Date.now(),
  };
  mockLinksByConversation.set(input.conversationId, link);
  return link;
};

export const getActiveShareLink = (conversationId: string): ShareLink | null =>
  mockLinksByConversation.get(conversationId) ?? null;

export const deleteShareLink = async (conversationId: string): Promise<void> => {
  try {
    if (chatService.isAuthenticated()) {
      await chatService.revokeShareLinks(conversationId);
    }
  } catch (err) {
    console.warn('[chatShare] Backend share revocation failed', err);
  }
  mockLinksByConversation.delete(conversationId);
};

export const buildSocialShareUrl = (
  platform: SocialPlatform,
  shareUrl: string,
  title = 'Shared conversation on XENO',
): string => {
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(title);

  switch (platform) {
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
    case 'x':
      return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    case 'reddit':
      return `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`;
    default:
      return shareUrl;
  }
};

export const VISIBILITY_OPTIONS: {
  id: ShareVisibility;
  label: string;
  description: string;
}[] = [
  {
    id: 'private',
    label: 'Keep private',
    description: 'Only you have access',
  },
  {
    id: 'team',
    label: 'Share with your team',
    description: 'Only teammates with the link can view',
  },
  {
    id: 'public',
    label: 'Create public link',
    description: 'Anyone with the link can view',
  },
];
