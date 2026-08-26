import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { 
  Bot, 
  User, 
  Share2, 
  Copy, 
  Check, 
  Sparkles, 
  ExternalLink, 
  ChevronDown, 
  ChevronRight,
  Brain,
  MessageSquare,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { chatService, type ChatMessage } from '../services/chatService';

interface SharedConversation {
  id: string;
  title: string;
  model_id?: string;
  created_at: string;
  messages: ChatMessage[];
}

export const SharedChatView: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<SharedConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) {
      setError('No share token provided');
      setLoading(false);
      return;
    }

    const fetchSharedChat = async () => {
      try {
        setLoading(true);
        const data = await chatService.getSharedConversation(token);
        if (!data) {
          setError('This shared conversation link has expired or does not exist.');
        } else {
          setConversation(data);
        }
      } catch (err: any) {
        console.error('Failed to load shared conversation:', err);
        setError('Failed to load shared conversation. Please check the link and try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchSharedChat();
  }, [token]);

  const handleCopyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const toggleThinking = (id: string) => {
    setExpandedThinking(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleForkChat = () => {
    if (chatService.isAuthenticated()) {
      navigate('/overview/chat/llm');
    } else {
      navigate(`/login?returnUrl=${encodeURIComponent(window.location.pathname)}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center animate-pulse mb-4">
          <Sparkles className="w-6 h-6 text-white/60 animate-spin" />
        </div>
        <p className="text-sm text-white/60 font-mono tracking-tight">Loading shared conversation...</p>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-white/[0.02] border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Conversation Unavailable</h2>
          <p className="text-sm text-white/50 mb-6">{error || 'This link may have been revoked or expired.'}</p>
          <Link
            to="/"
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-white text-black font-medium text-sm hover:bg-white/90 transition-colors"
          >
            Go to XENO Studio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col selection:bg-white/20">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/[0.08] px-4 md:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-black font-bold text-base shadow-sm group-hover:scale-105 transition-transform">
              X
            </div>
            <span className="font-semibold text-sm tracking-tight text-white/90">XENO</span>
          </Link>
          <span className="text-white/20 text-xs">/</span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs text-white/70">
            <Share2 className="w-3 h-3 text-white/40" />
            <span className="font-mono text-[11px] truncate max-w-[200px] md:max-w-[320px]">
              {conversation.title || 'Shared Conversation'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyShareLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-white/80 transition-colors"
            title="Copy share link"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
            <span>{copiedLink ? 'Copied' : 'Share'}</span>
          </button>

          <button
            onClick={handleForkChat}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white text-black font-medium text-xs hover:bg-white/90 shadow-sm transition-transform active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 text-black/70" />
            <span>Open in XENO</span>
          </button>
        </div>
      </header>

      {/* Main Conversation Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Title Header */}
        <div className="mb-10 text-center md:text-left">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-white/95 mb-2">
            {conversation.title || 'Untitled Chat'}
          </h1>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-xs text-white/40 font-mono">
            {conversation.model_id && (
              <span className="px-2.5 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                {conversation.model_id}
              </span>
            )}
            <span>{new Date(conversation.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
            <span>•</span>
            <span className="flex items-center gap-1 text-emerald-400/80">
              <ShieldCheck className="w-3.5 h-3.5" /> Verified Public Share
            </span>
          </div>
        </div>

        {/* Message Thread */}
        <div className="space-y-8">
          {conversation.messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const messageKey = msg.id || `${index}`;
            const isExpanded = expandedThinking[messageKey] ?? false;

            return (
              <div
                key={messageKey}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group`}
              >
                <div className="flex items-center gap-2 mb-1.5 px-1">
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] ${
                    isUser ? 'bg-white/10 text-white/80' : 'bg-white text-black font-bold'
                  }`}>
                    {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                  </div>
                  <span className="text-xs text-white/40 font-medium">
                    {isUser ? 'You' : 'Assistant'}
                  </span>
                </div>

                <div
                  className={`relative max-w-3xl w-full rounded-2xl p-5 md:p-6 transition-all ${
                    isUser
                      ? 'bg-white/[0.06] border border-white/[0.1] text-white/90'
                      : 'bg-white/[0.02] border border-white/[0.06] text-white/90'
                  }`}
                >
                  {/* Thinking Accordion (if assistant has reasoning) */}
                  {!isUser && (msg.thinking || msg.has_thinking) && (
                    <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                      <button
                        onClick={() => toggleThinking(messageKey)}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-white/60 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <Brain className="w-3.5 h-3.5 text-white/40" />
                          <span>Reasoning Process</span>
                        </div>
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-white/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
                      </button>
                      {isExpanded && msg.thinking && (
                        <div className="p-3.5 text-xs text-white/50 border-t border-white/[0.06] font-mono whitespace-pre-wrap bg-black/20">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Main Message Content */}
                  <div className="text-sm md:text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>

                  {/* Copy Button */}
                  <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-end">
                    <button
                      onClick={() => handleCopyText(msg.content, messageKey)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-all"
                      title="Copy message"
                    >
                      {copiedId === messageKey ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedId === messageKey ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div className="mt-16 text-center border-t border-white/[0.08] pt-12 pb-8">
          <div className="max-w-md mx-auto">
            <div className="w-10 h-10 rounded-2xl bg-white text-black font-bold flex items-center justify-center mx-auto mb-4">
              X
            </div>
            <h3 className="text-lg font-semibold text-white/90 mb-2">Build faster with XENO</h3>
            <p className="text-xs text-white/50 mb-6">
              Create apps, generate assets, and converse with high-reasoning models in an all-in-one workspace.
            </p>
            <button
              onClick={handleForkChat}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-black font-medium text-sm hover:bg-white/90 shadow-lg transition-transform active:scale-95"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Start your own conversation</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default SharedChatView;
