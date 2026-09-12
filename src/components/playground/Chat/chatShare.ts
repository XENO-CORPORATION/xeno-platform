/**
 * Share-conversation contract.
 *
 * UI calls these functions only. The server is authoritative; the in-memory
 * map is merely a projection of links successfully issued by the server.
 */

export type ShareVisibility = 'team' | 'public';

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

/** Session projection of server-issued links; never an authority. */
const linksByConversation = new Map<string, ShareLink>();

/**
 * Creates (or replaces) a share link for a conversation snapshot.
 * A link is returned only after the server persisted its hashed-token record.
 */
export const createShareLink = async (
  input: CreateShareLinkInput,
): Promise<ShareLink> => {
  if (!chatService.isAuthenticated()) throw new Error('Sign in to create a share link.');
  try {
      const serverShare = await chatService.createShareLink(
        input.conversationId,
        7,
        input.visibility === 'team' ? 'workspace' : 'public',
      );
      if (serverShare && serverShare.share_token) {
        const link: ShareLink = {
          id: serverShare.share_token,
          url: serverShare.share_url || `https://share.xenostudio.ai/c/${serverShare.share_token}`,
          visibility: input.visibility,
          conversationId: input.conversationId,
          messageCount: input.messageCount,
          createdAt: Date.now(),
        };
        linksByConversation.set(input.conversationId, link);
        return link;
      }
  } catch (err) {
    console.error('[chatShare] Backend share link creation failed', err);
    throw err;
  }
  throw new Error('The share link was not created.');
};

export const getActiveShareLink = (conversationId: string): ShareLink | null =>
  linksByConversation.get(conversationId) ?? null;

export const deleteShareLink = async (conversationId: string): Promise<void> => {
  if (!chatService.isAuthenticated()) throw new Error('Sign in to revoke a share link.');
  try {
    const revoked = await chatService.revokeShareLinks(conversationId);
    if (!revoked) throw new Error('Share revocation was not saved.');
  } catch (err) {
    console.error('[chatShare] Backend share revocation failed', err);
    throw err;
  }
  linksByConversation.delete(conversationId);
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
