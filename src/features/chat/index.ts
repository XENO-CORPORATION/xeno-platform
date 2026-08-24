// Public surface of the fresh chat module (src/features/chat).
// Mount <ChatApp /> full-viewport at /chat, or drop it into the xeno-chat.com shell.

export { default as ChatApp } from './components/ChatApp';
export { useChatStore, INTERFACE_ID } from './store';
export { streamChat } from './streamClient';
export { SYSTEM_ARTIFACT_INSTRUCTIONS } from './artifacts/systemPrompt';
export { deriveArtifacts, splitSegments, hasArtifacts, extensionFor } from './artifacts/parse';
export type {
  UIMessage,
  MessageVariant,
  ChatRole,
  StreamEvent,
  StreamHandlers,
  StreamRequest,
  StreamUsage,
  StreamErrorCode,
} from './types';
export type { Artifact, ArtifactVersion, ArtifactKind, MessageSegment } from './artifacts/types';
