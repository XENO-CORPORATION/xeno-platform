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
import type { UIMessage, MessageVariant } from './types';
import { deriveArtifacts } from './artifacts/parse';
import { SYSTEM_ARTIFACT_INSTRUCTIONS } from './artifacts/systemPrompt';
import type { Artifact } from './artifacts/types';

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
  // Branching siblings are round-tripped through the local (signed-out) store only —
  // the server schema has no variant column, so authed reloads return the active path
  // alone (which is canonical). See the branching notes in the store header.
  const stored = m as ChatMessage & { variants?: MessageVariant[]; active_variant?: number };
  return {
    id: m.id || uid('msg'),
    serverId: m.id,
    role,
    content: m.content || m.text || '',
    reasoning: m.thinking,
    model: m.model_id || m.modelId,
    createdAt: m.created_at ? Date.parse(m.created_at) || Date.now() : m.timestamp || Date.now(),
    variants: Array.isArray(stored.variants) ? stored.variants : undefined,
    activeVariant: typeof stored.active_variant === 'number' ? stored.active_variant : undefined,
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
    // Branching siblings ride along on our own local schema so they survive reload.
    ...(m.variants && m.variants.length ? { variants: m.variants, active_variant: m.activeVariant } : {}),
  } as ChatMessage;
}

/**
 * Refresh the ACTIVE variant of every branched message so it mirrors the live flat
 * path before that path is serialized to durable storage. While a branch is active
 * the UI reads the live message/tail (not the stored snapshot), so the snapshot can
 * drift; this reconciles it so switching to a sibling and back restores correctly.
 */
function refreshActiveVariants(path: UIMessage[]): UIMessage[] {
  return path.map((m, i) => {
    if (!m.variants || m.variants.length === 0) return m;
    const active = m.activeVariant ?? 0;
    const variants = m.variants.map((v, vi) => {
      if (vi !== active) return v;
      if (m.role === 'assistant') {
        return {
          ...v,
          content: m.content,
          reasoning: m.reasoning,
          model: m.model,
          error: m.error,
          usage: m.usage,
          serverId: m.serverId,
          createdAt: m.createdAt,
        };
      }
      // user branch: continuation = everything after this message in the live path
      return { ...v, content: m.content, serverId: m.serverId, continuation: path.slice(i + 1) };
    });
    return { ...m, variants };
  });
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

  // ── artifacts (Claude-style side panel) ──────────────────────────────────────
  // Artifacts are DERIVED from message content (see activeArtifacts selector), so
  // nothing new is persisted; only the view state (which one is open) lives here.
  activeArtifactId: string | null;
  activeArtifactVersion: number | null; // null → newest version
  artifactPanelOpen: boolean;

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
  /** Navigate ChatGPT-style branch siblings on a user or assistant message. */
  setActiveVariant: (messageId: string, index: number) => void;
  stopStreaming: () => void;

  // artifact actions
  openArtifact: (artifactId: string, version?: number | null) => void;
  setArtifactVersion: (version: number | null) => void;
  closeArtifactPanel: () => void;

  // selectors
  activeMessages: () => UIMessage[];
  activeArtifacts: () => Artifact[];
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
    const refreshed = refreshActiveVariants(history);
    set((s) => {
      const convs = s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: refreshed.map(toStoredMessage), updated_at: new Date().toISOString() }
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

  // Re-persist the durable store so it reflects the ACTIVE path after a variant switch.
  // Signed-out → rewrite localStorage (siblings ride along, fully durable). Signed-in →
  // keep the switched message's row in place (updateMessage preserves ordering) and
  // reconcile the trailing continuation: drop the old tail's rows, re-add the new tail.
  // The server has no variant schema, so only the active path is canonical there.
  async function persistActivePath(
    convId: string,
    prevPath: UIMessage[],
    nextPath: UIMessage[],
    fromIndex: number,
    switchedIsUser: boolean,
  ) {
    if (!isAuthed()) {
      rewriteLocalConversation(convId, nextPath);
      return;
    }
    try {
      if (!switchedIsUser) {
        // Assistant switch: the turn owns ONE stable server row. Update its content in
        // place — order-preserving, no delete/re-add. (Assistant variants carry no
        // continuation, so the downstream turns are unchanged.)
        const rowId = prevPath[fromIndex]?.serverId;
        const next = nextPath[fromIndex];
        if (rowId && next) {
          await chatService.updateMessage(rowId, { content: next.content }).catch(() => {});
        }
        return;
      }
      // User branch switch: update the user row in place, then reconcile the continuation
      // (delete the old branch's trailing rows, re-add the new branch's).
      const u = nextPath[fromIndex];
      if (u?.serverId) {
        await chatService.updateMessage(u.serverId, { content: u.content }).catch(() => {});
      }
      const tailStart = fromIndex + 1;
      await deleteDroppedServerMessages(prevPath.slice(tailStart));
      const idMap: Record<string, string> = {};
      for (const msg of nextPath.slice(tailStart)) {
        try {
          const sid = await persistMessage(convId, { ...msg, serverId: undefined });
          if (sid) idMap[msg.id] = sid;
        } catch {
          /* best-effort */
        }
      }
      if (Object.keys(idMap).length) {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] || []).map((m) =>
              idMap[m.id] ? { ...m, serverId: idMap[m.id] } : m,
            ),
          },
        }));
      }
    } catch {
      /* durable reconcile is best-effort; the UI already reflects the switch */
    }
  }

  // Snapshot an assistant message's live reply into a frozen variant sibling.
  function snapshotAssistant(m: UIMessage): MessageVariant {
    return {
      id: uid('v'),
      content: m.content,
      reasoning: m.reasoning,
      model: m.model,
      createdAt: m.createdAt,
      error: m.error,
      usage: m.usage,
      serverId: m.serverId,
    };
  }

  // Core streaming routine shared by sendMessage / regenerate / edit.
  //
  // `target` — when set, the reply streams into an EXISTING assistant message as a new
  // sibling VARIANT (regenerate) rather than appending a brand-new message. The prior
  // reply is preserved as variant[0]; the fresh reply becomes the active variant.
  //
  // `onCommitted` — a DEFERRED, destructive server mutation (e.g. deleting the prior
  // answer's rows for regenerate/edit). It runs ONLY after the new assistant reply has
  // ACTUALLY persisted (a fresh server id was obtained). On stream error/abort/empty
  // reply it is skipped, so the prior server state is left intact and recoverable on
  // reload instead of being destroyed before the replacement exists.
  async function runStream(
    convId: string,
    history: UIMessage[],
    target?: { id: string },
    onCommitted?: () => Promise<void> | void,
  ) {
    const { selectedModel, reasoningEnabled } = get();
    const assistantId = target ? target.id : uid('a');

    if (target) {
      // Append a fresh, streaming variant to the container; keep siblings navigable.
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).map((m) => {
            if (m.id !== assistantId) return m;
            const existing = m.variants && m.variants.length ? m.variants : [snapshotAssistant(m)];
            const fresh: MessageVariant = {
              id: uid('v'),
              content: '',
              reasoning: '',
              model: selectedModel,
              createdAt: Date.now(),
            };
            const variants = [...existing, fresh];
            return {
              ...m,
              content: '',
              reasoning: '',
              model: selectedModel,
              error: false,
              usage: undefined,
              serverId: undefined,
              createdAt: fresh.createdAt,
              streaming: true,
              variants,
              activeVariant: variants.length - 1,
            };
          }),
        },
        isStreaming: true,
        streamingMessageId: assistantId,
        streamError: null,
      }));
    } else {
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
    }

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
        // Teach the model the artifact convention (rendered live in the side panel).
        // Sent as the request systemPrompt; the gateway prepends it as a system turn.
        systemPrompt: SYSTEM_ARTIFACT_INSTRUCTIONS,
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

    let newServerId: string | undefined;
    if (final && final.content.trim() && !final.error) {
      if (isAuthed()) {
        try {
          newServerId = await persistMessage(convId, final);
        } catch {
          /* persistence best-effort; the message stays in the UI */
        }
      }
    }

    // Only now that the replacement reply is durably saved do we run the caller's
    // deferred destructive mutation (dropping the prior answer's server rows). If the
    // stream errored/aborted/empty, or persistence failed (no newServerId), we DON'T —
    // the previous good answer survives on the server and reloads intact.
    if (newServerId && onCommitted) {
      try {
        await onCommitted();
      } catch {
        /* best-effort cleanup; a stale prior row is preferable to lost data */
      }
    }

    // Commit the server id AND sync the active variant snapshot to the final reply,
    // so a later switch away/back restores the streamed content faithfully.
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [convId]: (s.messagesByConv[convId] || []).map((m) => {
          if (m.id !== assistantId) return m;
          const serverId = newServerId ?? m.serverId;
          const variants = m.variants
            ? m.variants.map((v, i) =>
                i === (m.activeVariant ?? 0)
                  ? {
                      ...v,
                      content: m.content,
                      reasoning: m.reasoning,
                      model: m.model,
                      error: m.error,
                      usage: m.usage,
                      serverId,
                    }
                  : v,
              )
            : m.variants;
          return { ...m, serverId, variants };
        }),
      },
    }));

    // Signed-out: rewrite the whole active path so branch/variant blobs persist too
    // (the append-based path can't represent siblings). Skips empty/failed replies.
    if (!isAuthed() && final && final.content.trim() && !final.error) {
      rewriteLocalConversation(convId, get().messagesByConv[convId] || []);
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

    activeArtifactId: null,
    activeArtifactVersion: null,
    artifactPanelOpen: false,

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
        activeArtifactId: null,
        activeArtifactVersion: null,
        artifactPanelOpen: false,
      }));
      return conv.id;
    },

    selectConversation: async (id) => {
      set({
        activeId: id,
        streamError: null,
        activeArtifactId: null,
        activeArtifactVersion: null,
        artifactPanelOpen: false,
      });
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
      // Find the trailing assistant turn(s); the last one becomes the variant container.
      let end = msgs.length;
      while (end > 0 && msgs[end - 1].role === 'assistant') end -= 1;
      const history = msgs.slice(0, end);
      const tail = msgs.slice(end);
      if (history.length === 0 || tail.length === 0) return;
      const container = tail[tail.length - 1];
      // Collapse any extra trailing assistant messages into the single container.
      set((s) => ({ messagesByConv: { ...s.messagesByConv, [convId]: [...history, container] } }));
      // Server has no variant schema, so the previously-persisted trailing rows must be
      // dropped — but ONLY after the regenerated reply has actually saved. Deferring the
      // delete means an insufficient_credits / rate-limit / dropped stream leaves the
      // prior good answer on the server (recoverable) instead of destroying it up front.
      // The prior reply also lives on in-memory as variant[0] for immediate navigation.
      const onCommitted = isAuthed() ? () => deleteDroppedServerMessages(tail) : undefined;
      // Stream the new reply INTO the container as a fresh sibling variant.
      await runStream(convId, history, { id: container.id }, onCommitted);
    },

    editUserMessage: async (messageId, newText) => {
      const convId = get().activeId;
      if (!convId || get().isStreaming) return;
      const trimmed = newText.trim();
      if (!trimmed) return;
      const msgs = get().messagesByConv[convId] || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const original = msgs[idx];
      const oldContinuation = msgs.slice(idx + 1);

      // Build/extend the user message's variants: freeze the current branch (its content
      // + continuation) as a sibling, then add the edited branch as the active one.
      const frozen: MessageVariant[] =
        original.variants && original.variants.length
          ? original.variants.map((v, i) =>
              i === (original.activeVariant ?? 0)
                ? { ...v, content: original.content, serverId: original.serverId, continuation: oldContinuation }
                : v,
            )
          : [
              {
                id: uid('v'),
                content: original.content,
                createdAt: original.createdAt,
                serverId: original.serverId,
                continuation: oldContinuation,
              },
            ];
      const newVariant: MessageVariant = {
        id: uid('v'),
        content: trimmed,
        createdAt: Date.now(),
        serverId: original.serverId, // reuse the same server row (updated in place)
        continuation: [],
      };
      const variants = [...frozen, newVariant];
      const editedUser: UIMessage = {
        ...original,
        content: trimmed,
        variants,
        activeVariant: variants.length - 1,
      };
      const history = [...msgs.slice(0, idx), editedUser];
      set((s) => ({ messagesByConv: { ...s.messagesByConv, [convId]: history } }));

      // Durable server reconcile — DEFERRED until the new reply actually persists: update
      // the edited user row in place (order-preserving) and drop the old continuation's
      // rows. Deferring means a failed/aborted/insufficient-credits regeneration leaves
      // the ORIGINAL question and answer intact on the server (recoverable on reload)
      // instead of committing a half-applied edit whose prior answer is already deleted
      // and whose replacement never saved. Signed-out → finalize rewrites the full active
      // path (capturing the variant blobs), so there's nothing to reconcile here.
      const onCommitted = isAuthed()
        ? async () => {
            if (original.serverId) {
              await chatService
                .updateMessage(original.serverId, { content: trimmed })
                .catch(() => {});
            }
            await deleteDroppedServerMessages(oldContinuation);
          }
        : undefined;
      await runStream(convId, history, undefined, onCommitted);
    },

    setActiveVariant: (messageId, index) => {
      const convId = get().activeId;
      if (!convId || get().isStreaming) return;
      const msgs = get().messagesByConv[convId] || [];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx < 0) return;
      const m = msgs[idx];
      if (!m.variants || index < 0 || index >= m.variants.length || index === (m.activeVariant ?? 0)) {
        return;
      }
      const cur = m.activeVariant ?? 0;

      let nextPath: UIMessage[];
      if (m.role === 'assistant') {
        // Capture the live reply into the current variant, then load the target reply.
        const variants = m.variants.map((v, i) =>
          i === cur
            ? {
                ...v,
                content: m.content,
                reasoning: m.reasoning,
                model: m.model,
                error: m.error,
                usage: m.usage,
                serverId: m.serverId,
              }
            : v,
        );
        const tv = variants[index];
        const swapped: UIMessage = {
          ...m,
          content: tv.content,
          reasoning: tv.reasoning,
          model: tv.model,
          error: tv.error,
          usage: tv.usage,
          // Keep the container's stable server row — the reconcile updates it in place
          // (order-preserving) rather than deleting + re-adding (which would reorder).
          serverId: m.serverId,
          createdAt: tv.createdAt,
          variants,
          activeVariant: index,
        };
        nextPath = [...msgs.slice(0, idx), swapped, ...msgs.slice(idx + 1)];
      } else {
        // User branch: capture the live tail into the current variant, then swap in the
        // target branch's content + continuation.
        const liveTail = msgs.slice(idx + 1);
        const variants = m.variants.map((v, i) =>
          i === cur ? { ...v, content: m.content, serverId: m.serverId, continuation: liveTail } : v,
        );
        const tv = variants[index];
        const swapped: UIMessage = {
          ...m,
          content: tv.content,
          serverId: tv.serverId ?? m.serverId,
          variants,
          activeVariant: index,
        };
        nextPath = [...msgs.slice(0, idx), swapped, ...(tv.continuation || [])];
      }

      set((s) => ({ messagesByConv: { ...s.messagesByConv, [convId]: nextPath } }));
      void persistActivePath(convId, msgs, nextPath, idx, m.role === 'user');
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

    openArtifact: (artifactId, version = null) =>
      set({ activeArtifactId: artifactId, activeArtifactVersion: version, artifactPanelOpen: true }),

    setArtifactVersion: (version) => set({ activeArtifactVersion: version }),

    closeArtifactPanel: () => set({ artifactPanelOpen: false }),

    activeMessages: () => {
      const { activeId, messagesByConv } = get();
      return (activeId && messagesByConv[activeId]) || [];
    },

    activeArtifacts: () => {
      const { activeId, messagesByConv } = get();
      return deriveArtifacts((activeId && messagesByConv[activeId]) || []);
    },

    snippet: (conv) => snippetOf(conv, get().messagesByConv[conv.id]),
  };
});
