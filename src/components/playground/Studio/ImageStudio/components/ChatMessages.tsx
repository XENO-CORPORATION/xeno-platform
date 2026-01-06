import React, { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { 
  Lightbulb, 
  X, 
  SquarePen, 
  Copy, 
  Check, 
  ThumbsUp, 
  ThumbsDown, 
  Info,
  MessageSquareX
} from 'lucide-react';
import { ChatMessage } from '../core/types';
import { OptimizedImage } from './OptimizedImage';

interface ChatMessagesProps {
  messages: ChatMessage[];
  messagesContainerRef: React.RefObject<HTMLDivElement>;
  editingMessageId: string | null;
  editText: string;
  setEditText: (text: string) => void;
  editInputRef: React.RefObject<HTMLTextAreaElement>;
  handleCancelEdit: () => void;
  handleSaveEdit: () => void;
  handleEditUserMessage: (messageId: string, currentText: string) => void;
  handleCopyUserMessage: (textToCopy: string, messageId: string) => void;
  copiedMessageId: string | null;
  showThinkingId: string | null;
  setShowThinkingId: (id: string | null) => void;
  handleCopy: (textToCopy: string | undefined, messageId: string) => void;
  handleLike: (messageId: string) => void;
  handleDislike: (messageId: string) => void;
  feedbackStatusMap: Record<string, 'liked' | 'disliked'>;
  setCanvasViewerImageUrl: (url: string | null) => void;
  setIsCanvasViewerOpen: (open: boolean) => void;
  urlCache: any;
  renderImageContainer: (message: ChatMessage) => React.ReactNode;
}

const VirtualizedMessageList: React.FC<{
  messages: ChatMessage[];
  renderMessage: (message: ChatMessage, index: number) => React.ReactNode;
}> = ({ messages, renderMessage }) => {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      <div className="max-w-[45rem] mx-auto w-full space-y-2">
        {messages.map((message, index) => renderMessage(message, index))}
      </div>
    </div>
  );
};

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  messagesContainerRef,
  editingMessageId,
  editText,
  setEditText,
  editInputRef,
  handleCancelEdit,
  handleSaveEdit,
  handleEditUserMessage,
  handleCopyUserMessage,
  copiedMessageId,
  showThinkingId,
  setShowThinkingId,
  handleCopy,
  handleLike,
  handleDislike,
  feedbackStatusMap,
  setCanvasViewerImageUrl,
  setIsCanvasViewerOpen,
  urlCache,
  renderImageContainer
}) => {
  // Memoized message renderer for better performance - exact copy from original
  const renderMessage = useCallback((message: ChatMessage, index: number) => {
    // Handle special message types
    if (message.isThinkingPlaceholder) {
      return (
        <div key={message.id} className="flex justify-start w-full pl-[1.125rem] py-2">
          <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-gray-400">
            <Lightbulb size={16} className="animate-pulse text-yellow-400" />
            <span>Thinking...</span>
          </div>
        </div>
      );
    } else if (message.isDotPlaceholder) {
      return (
        <div key={message.id} className="flex justify-start w-full pl-[1.125rem] py-2">
          <span className="flex h-2 w-2 relative">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-500 animate-pulse"></span> 
          </span>
        </div>
      );
    } else if (message.isCancelled) {
      return (
        <div key={message.id} className="group relative flex justify-start w-full">
          <div className="flex items-center">
            <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-gray-400 italic">
              <MessageSquareX size={16} className="mr-1 flex-shrink-0" />
              <span>{message.isXenoSearchCancelled ? message.text : 'Request Aborted'}</span>
            </div>
          </div>
        </div>
      );
    }

    const isUser = message.sender === 'user';
    const isThinkingVisible = !isUser && showThinkingId === message.id;
    const firstMessageTopMargin = index === 0 ? 'mt-4' : '';
    
    // Check if this is a canvas session message
    const isCanvasSession = isUser && message.text.startsWith('Canvas session started with image:') && message.userImageAttachment;

    return (
      <div 
        key={message.id} 
        className={`flex w-full ${isCanvasSession ? 'justify-center' : isUser ? 'justify-end pr-4' : 'justify-start'} ${firstMessageTopMargin}`}
      >
        {isUser ? (
          isCanvasSession ? (
            // Canvas session message - centered layout
            <div data-message-id={message.id} className="group flex flex-col items-center max-w-[500px]">
              <div className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl p-3 text-white text-center mb-3 w-full max-w-[450px]">
                <p className="text-sm leading-snug whitespace-pre-wrap">{message.text}</p>
              </div>
              {message.userImageAttachment && (message.userImageAttachment.file || message.userImageAttachment.base64Data) && (
                <div className="mb-1">
                  <OptimizedImage
                    src={message.userImageAttachment.file
                      ? urlCache.createURL(message.userImageAttachment.file, `user-${message.id}`)
                      : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`}
                    alt={message.userImageAttachment.name}
                    className="max-w-full h-auto rounded-lg border border-zinc-600 cursor-pointer max-w-[300px]"
                    onClick={() => {
                      if (message.userImageAttachment) {
                        const imageUrl = message.userImageAttachment.file
                          ? urlCache.createURL(message.userImageAttachment.file, `user-${message.id}`)
                          : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`;
                        console.log('🖼️ CONVERSATION IMAGE CLICKED - Opening NEW CanvasViewer');
                        setCanvasViewerImageUrl(imageUrl);
                        setIsCanvasViewerOpen(true);
                      }
                    }}
                    placeholderWidth={300}
                    placeholderHeight={200}
                    placeholderAspectRatio="3/2"
                  />
                </div>
              )}
              <div className="flex items-center justify-center gap-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                <button onClick={() => handleEditUserMessage(message.id, message.text)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Edit message">
                  <SquarePen size={14} />
                </button>
                <button onClick={() => handleCopyUserMessage(message.text, message.id)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Copy message">
                  {copiedMessageId === message.id ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          ) : editingMessageId === message.id ? (
            <div className="flex flex-col bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 max-w-[75%] w-full text-white">
              <textarea
                ref={editInputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full bg-transparent text-sm leading-snug text-white outline-none resize-none focus:ring-0 border-none focus:outline-none focus:shadow-none whitespace-pre-wrap scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                rows={1}
                style={{ overflowY: 'hidden' }}
              />
              <div className="flex items-center justify-end gap-2 mt-1.5 self-end">
                <button onClick={handleCancelEdit} className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1" aria-label="Cancel edit">
                  Cancel
                </button>
                <button onClick={handleSaveEdit} className="text-sm bg-gray-400 text-zinc-900 px-3 py-1 rounded-md font-semibold hover:bg-gray-300 transition-colors" aria-label="Save changes">
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div data-message-id={message.id} className="group flex flex-col items-end max-w-[75%]">
              <div className="bg-[#19191a] border border-[#3a3a3d] rounded-2xl rounded-br-none p-3 text-white">
                <p className="text-sm leading-snug whitespace-pre-wrap">{message.text}</p>
              </div>
              {message.userImageAttachment && (message.userImageAttachment.file || message.userImageAttachment.base64Data) && (
                <div className="mt-2 ml-auto mr-0 max-w-[150px]">
                  <OptimizedImage
                    src={message.userImageAttachment.file
                      ? urlCache.createURL(message.userImageAttachment.file, `user-${message.id}`)
                      : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`}
                    alt={message.userImageAttachment.name}
                    className="max-w-full h-auto rounded-lg border border-zinc-600 cursor-pointer"
                    onClick={() => {
                      if (message.userImageAttachment) {
                        const imageUrl = message.userImageAttachment.file
                          ? urlCache.createURL(message.userImageAttachment.file, `user-${message.id}`)
                          : `data:${message.userImageAttachment.type};base64,${message.userImageAttachment.base64Data}`;
                        console.log('🖼️ CONVERSATION IMAGE CLICKED - Opening NEW CanvasViewer');
                        setCanvasViewerImageUrl(imageUrl);
                        setIsCanvasViewerOpen(true);
                      }
                    }}
                    placeholderWidth={150}
                    placeholderHeight={150}
                    placeholderAspectRatio="1/1"
                  />
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                <button onClick={() => handleEditUserMessage(message.id, message.text)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Edit message">
                  <SquarePen size={14} />
                </button>
                <button onClick={() => handleCopyUserMessage(message.text, message.id)} className="p-1 text-gray-400 hover:text-gray-200 rounded-md" aria-label="Copy message">
                  {copiedMessageId === message.id ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
          )
        ) : (
          // AI Message
          <div data-message-id={message.id} className="group flex flex-col items-start w-full space-y-2 pr-4">
            
            {/* Thoughts (Expanded) */}
            {message.hasThinking && showThinkingId === message.id && ( 
              <div 
                onClick={() => setShowThinkingId(null)} 
                className="flex flex-col w-full bg-[#19191a] border border-[#3a3a3d] rounded-2xl px-4 py-3 transition-all duration-200 cursor-pointer hover:border-gray-500 overflow-hidden mb-4 max-h-none"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3"> 
                    <Lightbulb size={18} className="text-yellow-400" /> 
                    <div className="flex flex-col">
                      <span className="text-base font-medium text-gray-100">
                        Thoughts 
                        {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && <span className="font-semibold"> for {message.thinkingDuration}s</span>} 
                      </span> 
                      <div className="flex flex-col mt-0.5">
                        <span className="text-xs text-gray-400">
                          Review the step-by-step process 
                        </span>
                      </div>
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setShowThinkingId(null); }} className="p-1 text-gray-400 hover:text-white hover:bg-zinc-700 rounded-full" aria-label="Close Thoughts">
                    <X size={18} />
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-700/50 w-full text-sm prose prose-sm prose-invert max-w-none text-gray-300 prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5"> 
                  {message.thinkingContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {message.thinkingContent}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-gray-400 italic text-sm">
                      [Thinking process not provided or markers not found in API response]
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Thoughts (Collapsed Header) */}
            {message.hasThinking && showThinkingId !== message.id && (
              <div 
                onClick={() => setShowThinkingId(message.id)} 
                className="flex flex-col w-full bg-[#19191a] border border-[#3a3a3d] rounded-2xl px-4 py-3 transition-all duration-200 cursor-pointer hover:border-gray-500 overflow-hidden max-h-[80px]"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3"> 
                    <Lightbulb size={18} className="text-gray-500" /> 
                    <span className="text-base font-medium text-gray-100">
                      Thoughts 
                      {message.thinkingDuration !== undefined && message.thinkingDuration >= 0 && <span className="font-semibold"> for {message.thinkingDuration}s</span>} 
                    </span> 
                    <div className="flex flex-col mt-0.5">
                      <span className="text-xs text-gray-400">
                        Click to expand
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Answer Text */}
            <div className="w-full pl-[1.125rem]"> 
              {/* Show pulsating dot when AI is generating response */}
              {!message.isError && !message.parsedAnswer && !message.isLoading && !message.isGeneratingImage && !message.imageData && message.sender === 'ai' && !message.isThinkingPlaceholder && !message.isDotPlaceholder && (
                <div className="flex items-center gap-2 py-2">
                  <div className="flex items-center space-x-1">
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-gray-400 text-sm">Generating response...</span>
                </div>
              )}

              {message.isError && message.text && (
                <div className="prose prose-sm prose-invert max-w-none text-red-400 prose-strong:text-red-300 prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{message.text}</ReactMarkdown> 
                </div>
              )}

              {/* Main AI answer content */}
              {!message.isError && (message.parsedAnswer || message.text) && (
                <div className="prose prose-sm prose-invert max-w-none text-gray-100 prose-strong:text-gray-50 prose-p:my-1.5 prose-li:my-0.5 prose-ol:pl-5 prose-ul:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {message.parsedAnswer || message.text}
                  </ReactMarkdown>
                </div>
              )}

              {/* Image Container */}
              {renderImageContainer(message)}

              {/* Action buttons for AI messages */}
              {!message.isError && (message.parsedAnswer || message.text) && (
                <div className="flex items-center gap-2 mt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150">
                  <button 
                    onClick={() => handleCopy(message.parsedAnswer || message.text, message.id)} 
                    className="p-1 text-gray-400 hover:text-gray-200 rounded-md" 
                    aria-label="Copy response"
                  >
                    {copiedMessageId === message.id ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                  <button 
                    onClick={() => handleLike(message.id)} 
                    className={`p-1 rounded-md ${ 
                      feedbackStatusMap[message.id] === 'liked' 
                        ? 'text-green-500 hover:text-green-400' 
                        : 'text-gray-400 hover:text-gray-200' 
                    }`} 
                    aria-label="Like response"
                  >
                    <ThumbsUp size={14} />
                  </button>
                  <button 
                    onClick={() => handleDislike(message.id)} 
                    className={`p-1 rounded-md ${ 
                      feedbackStatusMap[message.id] === 'disliked' 
                        ? 'text-red-500 hover:text-red-400' 
                        : 'text-gray-400 hover:text-gray-200' 
                    }`} 
                    aria-label="Dislike response"
                  >
                    <ThumbsDown size={14} />
                  </button>
                  {message.modelIdUsed && ( 
                    <button 
                      className="p-1 text-gray-400 hover:text-gray-200 rounded-md" 
                      aria-label="Show model info"
                      title={`Model: ${message.modelIdUsed}`}
                    > 
                      <Info size={14} /> 
                    </button>
                  )} 
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }, [editingMessageId, handleCancelEdit, handleSaveEdit, handleEditUserMessage, handleCopyUserMessage, editText, copiedMessageId, showThinkingId, renderImageContainer, handleCopy, handleLike, handleDislike, feedbackStatusMap, setCanvasViewerImageUrl, setIsCanvasViewerOpen, editInputRef, setEditText, setShowThinkingId, urlCache]);

  // Use virtualization for large conversations (>50 messages)
  const shouldUseVirtualization = messages.length > 50;

  if (messages.length === 0) {
    return <p className="text-center text-gray-500 pt-24">No messages yet. Start creating!</p>;
  }

  if (shouldUseVirtualization) {
    return (
      <VirtualizedMessageList 
        messages={messages} 
        renderMessage={renderMessage}
      />
    );
  }

  return (
    <div 
      ref={messagesContainerRef}
      className="flex-1 overflow-y-auto px-4 py-6 space-y-6"
    >
      <div className="max-w-[45rem] mx-auto w-full space-y-2">
        {messages.map((message, index) => renderMessage(message, index))}
      </div>
    </div>
  );
}; 