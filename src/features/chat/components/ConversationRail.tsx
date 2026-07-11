import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Pencil, Check, X, MessageSquare, PanelLeftClose } from 'lucide-react';
import { useChatStore } from '../store';
import type { Conversation } from '@/services/chatService';

interface RailProps {
  onCollapse?: () => void;
  onNavigate?: () => void;
}

const ConversationRail: React.FC<RailProps> = ({ onCollapse, onNavigate }) => {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const snippet = useChatStore((s) => s.snippet);
  const newConversation = useChatStore((s) => s.newConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) => (c.title || '').toLowerCase().includes(q) || snippet(c).toLowerCase().includes(q),
    );
  }, [conversations, query, snippet]);

  const startRename = (c: Conversation) => {
    setEditingId(c.id);
    setEditValue(c.title || '');
    setConfirmId(null);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) renameConversation(editingId, editValue.trim());
    setEditingId(null);
  };

  const handleNew = async () => {
    await newConversation();
    onNavigate?.();
  };

  const handleSelect = (id: string) => {
    void selectConversation(id);
    onNavigate?.();
  };

  return (
    <div className="flex h-full flex-col bg-[#0b0b0b]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button
          onClick={handleNew}
          className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[14px] font-medium text-white/85 transition-colors hover:bg-white/[0.07]"
        >
          <Plus size={16} className="text-[#a760ff]" />
          New chat
        </button>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse sidebar"
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white/80 lg:flex"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
          <Search size={14} className="text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full bg-transparent text-[13px] text-white/80 placeholder:text-white/30 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-[13px] text-white/30">
            {conversations.length === 0 ? 'No conversations yet' : 'No matches'}
          </div>
        ) : (
          filtered.map((c) => {
            const active = c.id === activeId;
            const isEditing = editingId === c.id;
            const isConfirming = confirmId === c.id;
            return (
              <div
                key={c.id}
                className={`group relative mb-0.5 rounded-lg transition-colors ${
                  active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="w-full rounded bg-black/40 px-2 py-1 text-[13px] text-white outline-none ring-1 ring-[#a760ff]/40"
                    />
                    <button onClick={commitRename} className="text-white/60 hover:text-white" title="Save">
                      <Check size={15} />
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-white/40 hover:text-white/70" title="Cancel">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleSelect(c.id)}
                    className="flex w-full items-start gap-2.5 px-2.5 py-2 text-left"
                  >
                    <MessageSquare
                      size={15}
                      className={`mt-0.5 shrink-0 ${active ? 'text-[#a760ff]' : 'text-white/30'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-white/85">
                        {c.title || 'New Chat'}
                      </span>
                      <span className="block truncate text-[12px] text-white/35">
                        {snippet(c) || 'No messages yet'}
                      </span>
                    </span>
                  </button>
                )}

                {!isEditing && (
                  <div
                    className={`absolute right-1.5 top-1.5 flex items-center gap-0.5 ${
                      active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    } transition-opacity`}
                  >
                    {isConfirming ? (
                      <>
                        <button
                          onClick={() => {
                            deleteConversation(c.id);
                            setConfirmId(null);
                          }}
                          title="Confirm delete"
                          className="flex h-6 w-6 items-center justify-center rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          title="Cancel"
                          className="flex h-6 w-6 items-center justify-center rounded text-white/50 hover:bg-white/10"
                        >
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startRename(c)}
                          title="Rename"
                          className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white/80"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => setConfirmId(c.id)}
                          title="Delete"
                          className="flex h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-red-300"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ConversationRail;
