import { useState, useCallback } from 'react';
import { ChatMessage } from '../components/ChatMessages';

export interface UseConversationHistoryReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  addMessage: (content: string, type: 'user' | 'assistant', videoData?: ChatMessage['videoData']) => void;
  clearHistory: () => void;
  removeMessage: (messageId: string) => void;
  updateMessage: (messageId: string, content: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useConversationHistory = (): UseConversationHistoryReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addMessage = useCallback((content: string, type: 'user' | 'assistant', videoData?: ChatMessage['videoData']) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      type,
      content,
      timestamp: new Date(),
      videoData
    };

    setMessages(prev => [...prev, newMessage]);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
  }, []);

  const updateMessage = useCallback((messageId: string, content: string) => {
    setMessages(prev => 
      prev.map(msg => 
        msg.id === messageId 
          ? { ...msg, content, timestamp: new Date() }
          : msg
      )
    );
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  return {
    messages,
    isLoading,
    addMessage,
    clearHistory,
    removeMessage,
    updateMessage,
    setLoading
  };
};

export default useConversationHistory;