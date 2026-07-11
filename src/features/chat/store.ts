// store.ts — the chat module's single source of truth (Zustand).
//
// Owns: the conversation list, the active conversation, messages-by-conversation,
// streaming state, and the selected model. All persistence goes through the EXISTING
// chatService REST client (the same client useChatHistory wraps) when the user is
// signed in, and falls back to localStorage using useChatHistory's exact schema
// (`chatHistory_<interfaceId>`) when they are not — so histories stay interchangeable
// with the rest of the app. We do NOT reinvent the persistence/REST layer.
//
// A Zustand store cannot call the useChatHistory React hook directly, so it consumes
// chatService (that hook's engine) + mirrors its storage contract instead.

import { create } from 'zustand';
import { chatService, type Conversation, type ChatMessage } from '@/services/chatService';
import { streamChat } from './streamClient';
import type { UIMessage } from './types';

export const INTERFACE_ID = 'xeno-chat';
const STORAGE_KEY = `chatHistory_${INTERFACE_ID}`;
const MODEL_KEY = 'xeno_chat_selected_model';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';

// ── local id + helpers ───────────────────────────────────────────────────────
let idCounter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

const isAuthed = () => chatService.isAuthenticated();

function loadLocal(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(convs: Conversation[]) {
  try {
    if (convs.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / disabled — non-fatal */
  }
}

function toUIMessage(m: ChatMessage): UIMessage {
  const role = (m.role || (m.sender === 'ai' ? 'assistant' : 'user')) as UIMessage['role'];
  return {
    id: m.id || uid('msg'),
    serverId: m.id,
    role,
    content: m.content || m.text || '',
    reasoning: m.thinking,
    model: m.model_id || m.modelId,
    createdAt: m.created_at ? Date.parse(m.created_at) || Date.now() : m.timestamp || Date.now(),
  };
}

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || 'New Chat';
}

function snippetOf(conv: Conversation, msgs?: UIMessage[]): string {
  const first = msgs?.find((m) => m.role === 'user') || conv.messages?.find((m) => m.role === 'user');
  const c = (first as { content?: string; text?: string } | undefined)?.content
    || (first as { text?: string } | undefined)?.text
    || '';
  return c.replace(/\s+/g, ' ').slice(0, 80);
}

/** Map a UIMessage into the ChatMessage shape used by the local (signed-out) store. */
function toStoredMessage(m: UIMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    model_id: m.model,
    thinking: m.reasoning,
    has_thinking: !!m.reasoning,
    created_at: new Date(m.createdAt).toISOString(),
  } as ChatMessage;
}

// Notify the app that a metered action settled so it re-fetches the credit balance.
// AuthContext owns the balance (user.credits, shown in the taskbar) and listens for
// this event to call authService.refreshUser() — the same /api/auth/me path the rest
// of the account UI uses. Decouples this non-React store from the auth context.
function refreshCreditBalance() {
  try {
    window.dispatchEvent(new Event('xeno:credits-updated'));
  } catch {
    /* no DOM (SSR/tests) — non-fatal */
  }
}

// ── store shape ───────────────────────────────────────────────────────────────
interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  messagesByConv: Record<string, UIMessage[]>;
  selectedModel: string;
  reasoningEnabled: boolean;

  isStreaming: boolean;
  streamingMessageId: string | null;
  streamError: string | null;
  loadingConversations: boolean;
  loadingMessages: boolean;

  _abort: AbortController | null;

  // lifecycle
  init: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  setReasoningEnabled: (on: boolean) => void;

  // conversation actions
  newConversation: () => Promise<string | null>;
  selectConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  // message actions
  sendMessage: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editUserMessage: (messageId: string, newText: string) => Promise<void>;
  stopStreaming: () => void;

  // selectors
  activeMessages: () => UIMessage[];
  snippet: (conv: Conversation) => string;
}

export const useChatStore = create<ChatState>((set, get) => {
  // Persist a single message (user or assistant). Authed → server; else localStorage.
  async function persistMessage(convId: string, msg: UIMessage): Promise<string | undefined> {
    if (isAuthed()) {
      const saved = await chatService.addMessage(convId, {
        role: msg.role,
        content: msg.content,
        model_id: msg.model,
        thinking: msg.reasoning,
        has_thinking: !!msg.reasoning,
      });
      return saved?.id;
    }
    // local: append into the conversation object and persist the whole list
    set((s) => {
      const convs = s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: [
                ...(c.messages || []),
                {
                  id: msg.id,
                  role: msg.role,
                  content: msg.content,
                  model_id: msg.model,
                  thinking: msg.reasoning,
                  has_thinking: !!msg.reasoning,
                  created_at: new Date(msg.createdAt).toISOString(),
                } as ChatMessage,
              ],
              updated_at: new Date().toISOString(),
            }
          : c,
      );
      saveLocal(convs);
      return { conversations: convs };
    });
    return undefined;
  }

  // Durably rewrite a signed-OUT conversation's messages to `history` (the truncated
  // turn list) and persist. Without this, edit/regenerate only truncate the in-memory
  // messagesByConv, so the dropped assistant turns resurrect from localStorage on reload.
  function rewriteLocalConversation(convId: string, history: UIMessage[]) {
    set((s) => {
      const convs = s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: history.map(toStoredMessage), updated_at: new Date().toISOString() }
          : c,
      );
      saveLocal(convs);
      return { conversations: convs };
    });
  }

  // Durably drop the pre-edit/regenerate trailing turns on the SERVER (signed-in), so
  // they don't resurrect on reload. Only messages that were persisted (have a serverId)
  // need deleting; unpersisted ones never reached the server. Best-effort per message.
  async function deleteDroppedServerMessages(dropped: UIMessage[]) {
    await Promise.all(
      dropped
        .filter((m) => m.serverId)
        .map((m) => chatService.deleteMessage(m.serverId as string).catch(() => {})),
    );
  }

  // Core streaming routine shared by sendMessage / regenerate / edit.
  async function runStream(convId: string, history: UIMessage[]) {
    const { selectedModel, reasoningEnabled } = get();
    const assistantId = uid('a');
    const assistant: UIMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      reasoning: '',
      model: selectedModel,
      createdAt: Date.now(),
      streaming: true,
    };

    set((s) => ({
      messagesByConv: { ...s.messagesByConv, [convId]: [...(s.messagesByConv[convId] || []), assistant] },
      isStreaming: true,
      streamingMessageId: assistantId,
      streamError: null,
    }));

    const patchAssistant = (patch: Partial<UIMessage>) =>
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).map((m) =>
            m.id === assistantId ? { ...m, ...patch } : m,
          ),
        },
      }));

    const controller = new AbortController();
    set({ _abort: controller });

    const apiMessages = history.map((m) => ({ role: m.role, content: m.content }));

    await streamChat(
      {
        model: selectedModel,
        messages: apiMessages,
        reasoning: reasoningEnabled,
        conversationId: convId,
      },
      {
        onDelta: (text) =>
          set((s) => ({
            messagesByConv: {
              ...s.messagesByConv,
              [convId]: (s.messagesByConv[convId] || []).map((m) =>
                m.id === assistantId ? { ...m, content: m.content + text } : m,
              ),
            },
          })),
        onReasoning: (text) =>
          set((s) => ({
            messagesByConv: {
              ...s.messagesByConv,
              [convId]: (s.messagesByConv[convId] || []).map((m) =>
                m.id === assistantId ? { ...m, reasoning: (m.reasoning || '') + text } : m,
              ),
            },
          })),
        onUsage: (usage) => {
          // Record token usage/credits on the assistant turn and refresh the app's
          // credit balance (the hold was settled server-side on this event).
          patchAssistant({ usage });
          refreshCreditBalance();
        },
        onError: (err) => {
          patchAssistant({ error: true });
          set({ streamError: err.message });
        },
        onDone: () => {},
      },
      controller.signal,
    );

    // Finalize: mark not-streaming and persist whatever we have (partial on stop/error).
    patchAssistant({ streaming: false });
    const final = get().messagesByConv[convId]?.find((m) => m.id === assistantId);
    set({ isStreaming: false, streamingMessageId: null, _abort: null });

    if (final && final.content.trim() && !final.error) {
      try {
        const serverId = await persistMessage(convId, final);
        if (serverId) patchAssistant({ serverId });
      } catch {
        /* persistence best-effort; the message stays in the UI */
      }
    }

    // Bump the active conversation to the top with a fresh updated_at (local ordering).
    set((s) => {
      const idx = s.conversations.findIndex((c) => c.id === convId);
      if (idx < 0) return {};
      const conv = { ...s.conversations[idx], updated_at: new Date().toISOString() };
      const convs = [conv, ...s.conversations.slice(0, idx), ...s.conversations.slice(idx + 1)];
      return { conversations: convs };
    });
  }

  return {
    conversations: [],
    activeId: null,
    messagesByConv: {},
    selectedModel:
      (typeof localStorage !== 'undefined' && localStorage.getItem(MODEL_KEY)) || DEFAULT_MODEL,
    reasoningEnabled: false,

    isStreaming: false,
    streamingMessageId: null,
    streamError: null,
    loadingConversations: false,
    loadingMessages: false,
    _abort: null,

    init: async () => {
      set({ loadingConversations: true });
      try {
        if (isAuthed()) {
          const { conversations } = await chatService.getConversations({ interface_id: INTERFACE_ID });
          set({ conversations });
        } else {
          set({ conversations: loadLocal() });
        }
      } catch {
        set({ conversations: loadLocal() });
      } finally {
        set({ loadingConversations: false });
      }
    },

    setSelectedModel: (model) => {
      try {
        localStorage.setItem(MODEL_KEY, model);
      } catch {
        /* noop */
      }
      set({ selectedModel: model });
    },

    setReasoningEnabled: (on) => set({ reasoningEnabled: on }),

    newConversation: async () => {
      const { selectedModel } = get();
      let conv: Conversation | null = null;
      if (isAuthed()) {
        conv = await chatService.createConversation({
          title: 'New Chat',
          model_id: selectedModel,
          interface_id: INTERFACE_ID,
        });
      }
      if (!conv) {
        // No server conversation (offline or signed out) → local conversation.
        conv = {
          id: uid('convo'),
          title: 'New Chat',
          model_id: selectedModel,
          timestamp: Date.now(),
          messages: [],
        };
        set((s) => {
          const convs = [conv as Conversation, ...s.conversations];
          if (!isAuthed()) saveLocal(convs);
          return { conversations: convs };
        });
      } else {
        set((s) => ({ conversations: [conv as Conversation, ...s.conversations] }));
      }
      set((s) => ({
        activeId: conv!.id,
        messagesByConv: { ...s.messagesByConv, [conv!.id]: [] },
        streamError: null,
      }));
      return conv.id;
    },

    selectConversation: async (id) => {
      set({ activeId: id, streamError: null });
      if (get().messagesByConv[id]) return; // already loaded
      set({ loadingMessages: true });
      try {
        if (isAuthed()) {
          const full = await chatService.getConversation(id);
          const msgs = (full?.messages || []).map(toUIMessage);
          set((s) => ({ messagesByConv: { ...s.messagesByConv, [id]: msgs } }));
        } else {
          const conv = get().conversations.find((c) => c.id === id);
          const msgs = (conv?.messages || []).map(toUIMessage);
          set((s) => ({ messagesByConv: { ...s.messagesByConv, [id]: msgs } }));
        }
      } catch {
        set((s) => ({ messagesByConv: { ...s.messagesByConv, [id]: [] } }));
      } finally {
        set({ loadingMessages: false });
      }
    },

    renameConversation: async (id, title) => {
      set((s) => {
        const convs = s.conversations.map((c) => (c.id === id ? { ...c, title } : c));
        if (!isAuthed()) saveLocal(convs);
        return { conversations: convs };
      });
      if (isAuthed()) {
        try {
          await chatService.updateConversation(id, { title });
        } catch {
          /* optimistic; ignore */
        }
      }
    },

    deleteConversation: async (id) => {
      if (get().isStreaming && get().activeId === id) get().stopStreaming();
      set((s) => {
        const convs = s.conversations.filter((c) => c.id !== id);
        if (!isAuthed()) saveLocal(convs);
        const rest = { ...s.messagesByConv };
        delete rest[id];
        const activeId = s.activeId === id ? convs[0]?.id ?? null : s.activeId;
        return { conversations: convs, messagesByConv: rest, activeId };
      });
      if (isAuthed()) {
        try {
          await chatService.deleteConversation(id);
        } catch {
          /* ignore */
        }
      }
    },

    sendMessage: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().isStreaming) return;

      let convId = get().activeId;
      if (!convId) convId = await get().newConversation();
      if (!convId) return;

      const userMsg: UIMessage = {
        id: uid('u'),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId!]: [...(s.messagesByConv[convId!] || []), userMsg],
        },
      }));

      // Title the conversation from the first user message.
      const conv = get().conversations.find((c) => c.id === convId);
      if (conv && (!conv.title || conv.title === 'New Chat')) {
        get().renameConversation(convId, titleFrom(trimmed));
      }

      try {
        await persistMessage(convId, userMsg);
      } catch {
        /* keep going; the assistant reply still streams */
      }

      const history = get().messagesByConv[convId] || [];
      await runStream(convId, history);
    },

    regenerate: async () => {
      const convId = get().activeId;
      if (!convId || get().isStreaming) return;
      const msgs = get().messagesByConv[convId] || [];
      // Drop the trailing assistant message(s); re-run from the last user turn.
      let end = msgs.length;
      while (end > 0 && msgs[end - 1].role === 'assistant') end -= 1;
      const history = msgs.slice(0, end);
      const dropped = msgs.slice(end);
      if (history.length === 0) return;
      set((s) => ({ messagesByConv: { ...s.messagesByConv, [convId]: history } }));
      // Mirror the truncation into the DURABLE store BEFORE re-running, so the dropped
      // assistant turns don't resurrect/duplicate on reload (F1/F3).
      if (isAuthed()) {
        await deleteDroppedServerMessages(dropped);
      } else {
        rewriteLocalConversation(convId, history);
      }
      await runStream(convId, history);
    },

    editUserMessage: async (messageId, newText) => {
      const convId = get().activeId;
      if (!convId || get().isStreaming) return;
      const trimmed = newText.trim();
      if (!trimmed) return;
      const msgs = get().messagesByConv[convId] || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const edited: UIMessage = { ...msgs[idx], content: trimmed };
      const history = [...msgs.slice(0, idx), edited];
      const dropped = msgs.slice(idx + 1); // everything after the edited turn is regenerated
      set((s) => ({ messagesByConv: { ...s.messagesByConv, [convId]: history } }));
      // Mirror the truncation into the DURABLE store BEFORE re-running (F1/F3): signed-in
      // → edit the user message + delete the dropped trailing turns server-side; signed-out
      // → rewrite the conversation's messages to the truncated history and save.
      if (isAuthed()) {
        if (edited.serverId) {
          chatService.updateMessage(edited.serverId, { content: trimmed }).catch(() => {});
        }
        await deleteDroppedServerMessages(dropped);
      } else {
        rewriteLocalConversation(convId, history);
      }
      await runStream(convId, history);
    },

    stopStreaming: () => {
      const a = get()._abort;
      if (a) {
        try {
          a.abort();
        } catch {
          /* noop */
        }
      }
      set({ _abort: null });
      // runStream's finalize block handles persistence of the partial message.
    },

    activeMessages: () => {
      const { activeId, messagesByConv } = get();
      return (activeId && messagesByConv[activeId]) || [];
    },

    snippet: (conv) => snippetOf(conv, get().messagesByConv[conv.id]),
  };
});
