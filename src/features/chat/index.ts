// Public surface of the fresh chat module (src/features/chat).
// Mount <ChatApp /> full-viewport at /chat, or drop it into the xeno-chat.com shell.

export { default as ChatApp } from './components/ChatApp';
export { useChatStore, INTERFACE_ID } from './store';
export { streamChat } from './streamClient';
export type {
  UIMessage,
  ChatRole,
  StreamEvent,
  StreamHandlers,
  StreamRequest,
  StreamUsage,
  StreamErrorCode,
} from './types';
