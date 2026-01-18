/**
 * CollaborationModal
 * UI for creating, managing, and joining collaborative sessions
 * Monochromatic design matching XenoOS desktop interface
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  Users,
  Link2,
  Mail,
  UserPlus,
  Crown,
  MoreVertical,
  Send,
  MessageCircle,
  Settings,
  UserMinus,
  Share2
} from 'lucide-react';
import { useCollaboration, Participant, ChatMessage } from '../../../contexts/CollaborationContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useContainer } from '../../../contexts/ContainerContext';

interface CollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'share' | 'participants' | 'chat' | 'settings';

const CollaborationModal: React.FC<CollaborationModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { container } = useContainer();
  const {
    session,
    participants,
    isConnected,
    isHost,
    chatMessages,
    createSession,
    joinSession,
    leaveSession,
    endSession,
    inviteUser,
    sendChatMessage
  } = useCollaboration();

  const [activeTab, setActiveTab] = useState<TabType>('share');
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMessage, setInviteMessage] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showParticipantMenu, setShowParticipantMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  useEffect(() => {
    if (!isOpen) {
      setInviteEmail('');
      setInviteMessage('');
      setInviteSuccess(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    if (!session?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(session.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCreateSession = async () => {
    if (!container?.id) {
      setError('No container selected');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const newSession = await createSession(container.id, `${user?.display_name || 'User'}'s Workspace`);
      if (!newSession) {
        setError('Failed to create collaborative session');
      }
    } catch (err) {
      setError('Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinSession = async () => {
    if (!joinToken.trim()) {
      setError('Please enter a share token or link');
      return;
    }
    setIsJoining(true);
    setError(null);
    let token = joinToken.trim();
    if (token.includes('/')) {
      const parts = token.split('/');
      token = parts[parts.length - 1];
    }
    try {
      const success = await joinSession(token);
      if (!success) {
        setError('Failed to join session. Check if the link is valid.');
      } else {
        setJoinToken('');
      }
    } catch (err) {
      setError('Failed to join session');
    } finally {
      setIsJoining(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      setError('Please enter an email address');
      return;
    }
    setIsInviting(true);
    setError(null);
    try {
      const result = await inviteUser(inviteEmail.trim(), inviteMessage);
      if (result) {
        setInviteSuccess(true);
        setInviteEmail('');
        setInviteMessage('');
        setTimeout(() => setInviteSuccess(false), 3000);
      } else {
        setError('Failed to send invitation');
      }
    } catch (err) {
      setError('Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendChat = () => {
    if (!chatInput.trim()) return;
    sendChatMessage(chatInput.trim());
    setChatInput('');
  };

  const handleLeave = () => {
    leaveSession();
    onClose();
  };

  const handleEndSession = async () => {
    if (window.confirm('End this session? All participants will be disconnected.')) {
      await endSession();
      onClose();
    }
  };

  const getContrastColor = (hexColor: string): string => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-sm mx-4 bg-[#1c1c1c] rounded-lg shadow-2xl border border-white/[0.08] overflow-hidden"
        style={{ animation: 'fadeIn 0.12s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 bg-white/[0.06] rounded flex items-center justify-center">
              <Users size={12} className="text-white/50" />
            </div>
            <div>
              <h2 className="text-[13px] font-medium text-white/90">Collaborate</h2>
              {session && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-white/60' : 'bg-white/20'}`} />
                  <span className="text-[10px] text-white/40">
                    {isConnected ? `${participants.length} online` : 'Connecting...'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-white/[0.06] rounded transition-colors"
          >
            <X size={14} className="text-white/40" />
          </button>
        </div>

        {/* Tabs */}
        {session && (
          <div className="flex border-b border-white/[0.06]">
            {[
              { id: 'share', label: 'Share', icon: Share2 },
              { id: 'participants', label: 'People', icon: Users },
              { id: 'chat', label: 'Chat', icon: MessageCircle },
              { id: 'settings', label: 'Settings', icon: Settings }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] transition-colors relative
                  ${activeTab === tab.id ? 'text-white/80' : 'text-white/35 hover:text-white/50'}`}
              >
                <tab.icon size={11} />
                <span>{tab.label}</span>
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-3 right-3 h-[1px] bg-white/30" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="p-4 max-h-[340px] overflow-y-auto">
          {/* Error */}
          {error && (
            <div className="mb-3 px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded text-white/60 text-[11px]">
              {error}
            </div>
          )}

          {/* No Session */}
          {!session && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] text-white/40 leading-relaxed">
                  Share your workspace with others. They'll see your cursor in real-time.
                </p>
                <button
                  onClick={handleCreateSession}
                  disabled={isCreating || !container}
                  className="w-full px-3 py-2.5 bg-white/[0.08] hover:bg-white/[0.12] disabled:bg-white/[0.04] disabled:text-white/30 disabled:cursor-not-allowed rounded text-white/80 text-[11px] font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <Share2 size={12} />
                      <span>Start Sharing</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] text-white/25">or join</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                  placeholder="Paste link or token"
                  className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded text-white/80 text-[11px] placeholder-white/25 focus:outline-none focus:border-white/[0.12] transition-colors"
                />
                <button
                  onClick={handleJoinSession}
                  disabled={isJoining || !joinToken.trim()}
                  className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.10] disabled:bg-white/[0.03] disabled:text-white/25 rounded text-white/70 text-[11px] font-medium transition-colors"
                >
                  {isJoining ? '...' : 'Join'}
                </button>
              </div>
            </div>
          )}

          {/* Share Tab */}
          {session && activeTab === 'share' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[11px] text-white/40">Share Link</label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded">
                    <Link2 size={11} className="text-white/25 flex-shrink-0" />
                    <input
                      type="text"
                      value={session.shareUrl}
                      readOnly
                      className="flex-1 bg-transparent text-white/60 text-[11px] focus:outline-none truncate"
                    />
                  </div>
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2 bg-white/[0.08] hover:bg-white/[0.12] rounded text-white/70 text-[11px] font-medium transition-colors flex items-center gap-1.5"
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-white/40">Invite by Email</label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded">
                    <Mail size={11} className="text-white/25 flex-shrink-0" />
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="flex-1 bg-transparent text-white/80 text-[11px] placeholder-white/25 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleInvite}
                    disabled={isInviting || !inviteEmail.trim()}
                    className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.10] disabled:bg-white/[0.03] disabled:text-white/25 rounded text-white/70 text-[11px] font-medium transition-colors flex items-center gap-1.5"
                  >
                    {isInviting ? (
                      <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                    ) : (
                      <UserPlus size={11} />
                    )}
                    <span>Invite</span>
                  </button>
                </div>
                {inviteSuccess && (
                  <p className="text-[10px] text-white/50 flex items-center gap-1">
                    <Check size={10} />
                    Sent
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Participants Tab */}
          {session && activeTab === 'participants' && (
            <div className="space-y-1.5">
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between p-2.5 bg-white/[0.02] hover:bg-white/[0.04] rounded border border-white/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded flex items-center justify-center text-[10px] font-medium relative"
                      style={{
                        backgroundColor: participant.color,
                        color: getContrastColor(participant.color)
                      }}
                    >
                      {participant.avatarUrl ? (
                        <img src={participant.avatarUrl} alt="" className="w-full h-full rounded object-cover" />
                      ) : (
                        participant.displayName.charAt(0).toUpperCase()
                      )}
                      <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-[#1c1c1c] bg-white/60" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-white/80">
                          {participant.displayName}
                        </span>
                        {participant.odea === user?.id && (
                          <span className="text-[9px] text-white/30">(you)</span>
                        )}
                        {participant.isOwner && (
                          <Crown size={9} className="text-white/40" />
                        )}
                      </div>
                      <span className="text-[10px] text-white/30">Active</span>
                    </div>
                  </div>
                  {isHost && participant.odea !== user?.id && (
                    <div className="relative">
                      <button
                        onClick={() => setShowParticipantMenu(showParticipantMenu === participant.id ? null : participant.id)}
                        className="p-1 hover:bg-white/[0.06] rounded transition-colors"
                      >
                        <MoreVertical size={12} className="text-white/30" />
                      </button>
                      {showParticipantMenu === participant.id && (
                        <div className="absolute right-0 top-full mt-1 w-28 bg-[#222] border border-white/[0.08] rounded shadow-xl z-10">
                          <button
                            onClick={() => setShowParticipantMenu(null)}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-white/50 hover:bg-white/[0.06] transition-colors"
                          >
                            <UserMinus size={10} />
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {participants.length === 1 && (
                <div className="text-center py-6">
                  <Users size={24} className="mx-auto mb-2 text-white/15" />
                  <p className="text-[11px] text-white/30">Only you here</p>
                  <p className="text-[10px] text-white/20 mt-0.5">Share the link to invite</p>
                </div>
              )}
            </div>
          )}

          {/* Chat Tab */}
          {session && activeTab === 'chat' && (
            <div className="flex flex-col h-[260px]">
              <div ref={chatContainerRef} className="flex-1 overflow-y-auto space-y-2 mb-2">
                {chatMessages.length === 0 ? (
                  <div className="text-center py-6">
                    <MessageCircle size={24} className="mx-auto mb-2 text-white/15" />
                    <p className="text-[11px] text-white/30">No messages</p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-2 ${msg.userId === user?.id ? 'flex-row-reverse' : ''}`}
                    >
                      <div
                        className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-medium flex-shrink-0"
                        style={{ backgroundColor: msg.color, color: getContrastColor(msg.color) }}
                      >
                        {msg.avatarUrl ? (
                          <img src={msg.avatarUrl} alt="" className="w-full h-full rounded object-cover" />
                        ) : (
                          msg.displayName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className={`max-w-[80%] ${msg.userId === user?.id ? 'text-right' : ''}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] text-white/40">
                            {msg.userId === user?.id ? 'You' : msg.displayName}
                          </span>
                          <span className="text-[9px] text-white/20">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`px-2.5 py-1.5 rounded text-[11px] ${
                          msg.userId === user?.id ? 'bg-white/[0.12] text-white/80' : 'bg-white/[0.06] text-white/70'
                        }`}>
                          {msg.message}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="Message..."
                  className="flex-1 px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded text-white/80 text-[11px] placeholder-white/25 focus:outline-none focus:border-white/[0.12] transition-colors"
                />
                <button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim()}
                  className="px-3 py-2 bg-white/[0.08] hover:bg-white/[0.12] disabled:bg-white/[0.04] disabled:text-white/20 rounded text-white/70 transition-colors"
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {session && activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="text-[11px] text-white/40">Session</h3>
                <div className="space-y-1 text-[11px] bg-white/[0.02] rounded p-2.5 border border-white/[0.04]">
                  <div className="flex justify-between">
                    <span className="text-white/35">Name</span>
                    <span className="text-white/60">{session.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/35">Participants</span>
                    <span className="text-white/60">{participants.length} / {session.maxParticipants}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-[11px] text-white/40">Permissions</h3>
                <div className="space-y-1 bg-white/[0.02] rounded p-2.5 border border-white/[0.04]">
                  {[
                    { key: 'canEdit', label: 'Edit' },
                    { key: 'canCreateFiles', label: 'Create' },
                    { key: 'canDelete', label: 'Delete' }
                  ].map((perm) => (
                    <div key={perm.key} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/40">{perm.label}</span>
                      <span className={session.permissions[perm.key as keyof typeof session.permissions] ? 'text-white/60' : 'text-white/25'}>
                        {session.permissions[perm.key as keyof typeof session.permissions] ? 'Yes' : 'No'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-white/[0.04] space-y-2">
                <button
                  onClick={handleLeave}
                  className="w-full px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] rounded text-white/50 hover:text-white/70 text-[11px] font-medium transition-colors"
                >
                  Leave Session
                </button>
                {isHost && (
                  <button
                    onClick={handleEndSession}
                    className="w-full px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] rounded text-white/40 hover:text-white/60 text-[11px] font-medium transition-colors"
                  >
                    End Session
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default CollaborationModal;
