import React, { useEffect, useState } from 'react';
import { Button } from '@xenosystem/elements-react';
import ChatModal from './ChatModal';
import { chatService, type ConversationMovePreview } from '@/services/chatService';

/**
 * XENO-WORKFORCE-01 SES-05: a move "shows the target audience and included historical content; no
 * silent transfer of private history."
 *
 * Moving a chat into a project makes its whole history readable by everyone who can read the
 * project. This dialog asks the server who that is and how much history goes with it BEFORE anything
 * moves, then moves only against that exact answer (its consent revision). If the project's readers
 * or the chat change in between, the server refuses and this dialog shows the new answer instead of
 * moving under the old one.
 */
type Props = {
  conversationId: string;
  conversationTitle: string;
  projectId: string;
  projectName: string;
  onMoved: () => void;
  onClose: () => void;
};

export default function ChatMoveModal({ conversationId, conversationTitle, projectId, projectName, onMoved, onClose }: Props) {
  const [preview, setPreview] = useState<ConversationMovePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = async () => {
    setError(null);
    try {
      setPreview(await chatService.previewConversationMove(conversationId, projectId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load who will see this chat.');
    }
  };
  useEffect(() => { void load(); }, [conversationId, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitMove = async () => {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      await chatService.moveConversation(conversationId, projectId, preview.consentRevision);
      onMoved();
    } catch (failure) {
      const code = (failure as { code?: string })?.code;
      if (code === 'consent_stale') {
        setError('Who can see this project, or the chat itself, changed. Review the updated list.');
        await load();
      } else {
        setError(failure instanceof Error ? failure.message : 'The chat could not be moved.');
      }
    } finally {
      setPending(false);
    }
  };

  const others = preview ? preview.audience.filter((person) => !person.isYou) : [];
  return (
    <ChatModal
      onClose={onClose}
      size="md"
      title={`Move to ${projectName}?`}
      dialogProps={{ 'data-chat-move-dialog': '' }}
      footer={(
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={() => void commitMove()} disabled={!preview || pending}>
            {pending ? 'Moving…' : 'Move chat'}
          </Button>
        </>
      )}
    >
      <div className="space-y-3 text-sm" data-chat-move-disclosure="">
        <p className="text-[var(--chat-muted)]">
          <strong className="text-[var(--chat-text)]">{conversationTitle}</strong> and its entire history become part of this project.
        </p>
        {!preview && !error ? <p className="text-[var(--chat-muted)]">Checking who can see this project…</p> : null}
        {preview ? (
          <>
            <p data-chat-move-history="">
              Included: <strong>{preview.includedHistory.messages} {preview.includedHistory.messages === 1 ? 'message' : 'messages'}</strong>
              {preview.includedHistory.firstAt ? ` from ${new Date(preview.includedHistory.firstAt).toLocaleDateString()}` : ''}.
            </p>
            <div data-chat-move-audience="">
              <p className="mb-1">
                {others.length === 0
                  ? 'Only you will be able to read it.'
                  : `${others.length} other ${others.length === 1 ? 'person' : 'people'} will be able to read it:`}
              </p>
              {others.length ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--chat-border)] p-2">
                  {others.map((person) => (
                    <li key={person.userId} className="text-[var(--chat-text)]">{person.displayName || 'A project member'}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        ) : null}
        {error ? <p role="alert" className="text-[var(--chat-text)]">{error}</p> : null}
      </div>
    </ChatModal>
  );
}
