// Shared types for the fresh chat module (src/features/chat).
// Kept intentionally small and self-contained so this module can be dropped into
// the standalone xeno-chat.com shell without pulling in the legacy 9k-line monolith.

export type ChatRole = 'user' | 'assistant' | 'system';

/** A message as rendered in the thread. Streaming assistant messages carry `streaming: true`. */
export interface UIMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Model reasoning / "thinking" stream, if the model emits one. */
  reasoning?: string;
  /** Model id that produced an assistant message. */
  model?: string;
  createdAt: number;
  /** True while the assistant message is being streamed. */
  streaming?: boolean;
  /** True if generation failed for this message. */
  error?: boolean;
  /** Server-side message id once persisted (for authed accounts). */
  serverId?: string;
  /** Token usage + credits settled for this assistant turn (from the SSE `usage` event). */
  usage?: StreamUsage;
  /**
   * ChatGPT-style branching. When an assistant reply is REGENERATED or a user message
   * is EDITED, the prior turn is kept as a sibling here instead of being discarded.
   * The flat message array (`messagesByConv[convId]`) always represents the ACTIVE
   * path; `variants[activeVariant]` mirrors this message's live state, and switching
   * a variant rebuilds the active path from the selected sibling.
   */
  variants?: MessageVariant[];
  /** Index into `variants` for the currently-active sibling. */
  activeVariant?: number;
}

/**
 * One sibling of a branched turn. Assistant variants are alternate replies (the
 * assistant is the tail, so no continuation). User variants are whole branches: the
 * edited user content PLUS the messages that followed it in that branch.
 */
export interface MessageVariant {
  /** Stable id for this variant instance. */
  id: string;
  content: string;
  reasoning?: string;
  model?: string;
  createdAt: number;
  error?: boolean;
  /** Server-side row id for this variant's message, when persisted. */
  serverId?: string;
  usage?: StreamUsage;
  /**
   * USER-branch variants only: the turns that follow this user message in the branch.
   * Undefined/empty for assistant-reply variants.
   */
  continuation?: UIMessage[];
}

/** The typed events the SSE stream produces — the ONLY shapes the client accepts. */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; input: number; output: number; total: number; creditsSettled: number }
  | { type: 'done' }
  | { type: 'error'; error: StreamErrorCode; message: string };

export type StreamErrorCode =
  | 'unauthorized'
  | 'insufficient_credits'
  | 'inference_error'
  | 'invalid_request';

export interface StreamUsage {
  input: number;
  output: number;
  total: number;
  creditsSettled: number;
}

/** Request body for POST /api/ai/chat/stream. */
export interface StreamRequest {
  model: string;
  messages: Array<{ role: ChatRole; content: string }>;
  reasoning?: boolean;
  conversationId?: string;
  systemPrompt?: string;
}

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onUsage?: (usage: StreamUsage) => void;
  onDone?: () => void;
  onError?: (err: { error: StreamErrorCode; message: string }) => void;
}
