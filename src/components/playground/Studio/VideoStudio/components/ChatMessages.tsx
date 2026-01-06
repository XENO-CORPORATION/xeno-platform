import React, { useEffect, useRef } from 'react';
import { User, Bot, Clock } from 'lucide-react';

export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  videoData?: {
    src: string;
    thumbnail?: string;
    duration?: number;
  };
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  isLoading = false
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <Bot size={48} className="text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">Start a conversation</p>
            <p className="text-gray-400 text-sm mt-2">Ask questions about video editing or processing</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-3 ${
                message.type === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              {/* Avatar */}
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.type === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {message.type === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>

              {/* Message content */}
              <div
                className={`flex-1 max-w-xs sm:max-w-md ${
                  message.type === 'user' ? 'text-right' : 'text-left'
                }`}
              >
                <div
                  className={`inline-block p-3 rounded-lg ${
                    message.type === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  
                  {/* Video attachment */}
                  {message.videoData && (
                    <div className="mt-2 p-2 bg-black bg-opacity-10 rounded">
                      <div className="flex items-center space-x-2">
                        {message.videoData.thumbnail && (
                          <img
                            src={message.videoData.thumbnail}
                            alt="Video thumbnail"
                            className="w-12 h-8 object-cover rounded"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs opacity-75 truncate">Video attachment</p>
                          {message.videoData.duration && (
                            <p className="text-xs opacity-60">
                              {formatDuration(message.videoData.duration)}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Timestamp */}
                <div
                  className={`flex items-center mt-1 text-xs text-gray-500 ${
                    message.type === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <Clock size={12} className="mr-1" />
                  <span>{formatTime(message.timestamp)}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center">
              <Bot size={16} />
            </div>
            <div className="flex-1">
              <div className="inline-block p-3 bg-gray-100 rounded-lg">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default ChatMessages;