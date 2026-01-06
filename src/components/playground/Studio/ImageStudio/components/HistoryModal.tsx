import React, { useState } from 'react';
import { Search, X, ExternalLink, FilePenLine, Trash2, Check, CheckSquare, Square } from 'lucide-react';
import { ImageGenerationSession } from '../core/types';

interface HistoryPanelProps {
  isHistoryOpen: boolean;
  sessions: ImageGenerationSession[];
  activeSessionId: string | null;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onToggleHistory: () => void;
  onLoadSession: (sessionId: string) => void;
  editingSessionId: string | null;
  editTitleText: string;
  onStartEdit: (sessionId: string, currentTitle: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditTitleChange: (text: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  onDeleteMultipleSessions?: (sessionIds: string[]) => void;
  position?: 'above' | 'below';
}

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  isHistoryOpen,
  sessions,
  activeSessionId,
  searchTerm,
  onSearchChange,
  onToggleHistory,
  onLoadSession,
  editingSessionId,
  editTitleText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditTitleChange,
  onDeleteSession,
  onDeleteMultipleSessions,
  position = 'below'
}) => {
  const isPositionedAbove = position === 'above';
  
  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());

  // Toggle multi-select mode
  const handleToggleMultiSelect = () => {
    setIsMultiSelectMode(!isMultiSelectMode);
    setSelectedSessions(new Set()); // Clear selections when toggling
  };

  // Toggle session selection
  const handleToggleSessionSelection = (sessionId: string) => {
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(sessionId)) {
      newSelected.delete(sessionId);
    } else {
      newSelected.add(sessionId);
    }
    setSelectedSessions(newSelected);
  };

  // Handle bulk delete
  const handleBulkDelete = () => {
    if (selectedSessions.size > 0 && onDeleteMultipleSessions) {
      onDeleteMultipleSessions(Array.from(selectedSessions));
      setSelectedSessions(new Set());
      setIsMultiSelectMode(false);
    }
  };

  // Select all visible sessions
  const handleSelectAll = () => {
    const filteredSessions = sessions.filter(session => {
      const searchTermLower = searchTerm.toLowerCase();
      if (!searchTermLower) return true;
      if (session.title.toLowerCase().includes(searchTermLower)) return true;
      return session.messages.some(message => 
        message.text.toLowerCase().includes(searchTermLower)
      );
    });
    
    const allSelected = filteredSessions.every(session => selectedSessions.has(session.id));
    
    if (allSelected) {
      // Deselect all
      setSelectedSessions(new Set());
    } else {
      // Select all visible sessions
      setSelectedSessions(new Set(filteredSessions.map(session => session.id)));
    }
  };

  const filteredSessions = sessions.filter(session => {
    const searchTermLower = searchTerm.toLowerCase();
    if (!searchTermLower) return true;
    if (session.title.toLowerCase().includes(searchTermLower)) return true;
    return session.messages.some(message => 
      message.text.toLowerCase().includes(searchTermLower)
    );
  });

  return (
    <div className={`
      absolute ${isPositionedAbove ? 'bottom-full mb-3' : 'top-full mt-3'} left-0 right-0 z-30
      bg-[#19191a]/95 backdrop-blur-sm border border-[#3a3a3d] rounded-xl shadow-2xl 
      max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-zinc-800 
      hide-scrollbar
      transition-all duration-300 ease-in-out
      ${isHistoryOpen 
        ? 'opacity-100 translate-y-0 visible'
        : `opacity-0 ${isPositionedAbove ? 'translate-y-2' : 'translate-y-4'} invisible`
      }
    `}>
      {/* History Header */}
      <div className="sticky top-0 bg-zinc-800/90 backdrop-blur-sm py-2 px-4 flex justify-between items-center gap-4 border-b border-zinc-700 z-10">
        <h3 className="text-lg font-semibold text-white flex-shrink-0">Generation History</h3>
        <div className="relative flex-grow mx-2">
           <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
           <input 
              type="search"
              placeholder="Search history..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className={`w-full bg-zinc-700/50 border border-zinc-600 rounded-md py-1.5 pl-9 text-sm text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors h-8 ${
                isMultiSelectMode ? 'pr-20' : 'pr-3'
              }`}
           />
           {/* Selection count - show inside search container when in multi-select mode */}
           {isMultiSelectMode && (
             <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
               {selectedSessions.size} of {filteredSessions.length}
             </span>
           )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Select All/None button - only show when in multi-select mode */}
          {isMultiSelectMode && (
            <button
              onClick={handleSelectAll}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded-md hover:bg-blue-500/20"
              title={filteredSessions.every(session => selectedSessions.has(session.id)) && filteredSessions.length > 0 ? 'Deselect all sessions' : 'Select all sessions'}
            >
              {filteredSessions.every(session => selectedSessions.has(session.id)) && filteredSessions.length > 0
                ? 'None' 
                : 'All'
              }
            </button>
          )}
          
          {/* Multi-select toggle button */}
          <button 
            onClick={handleToggleMultiSelect}
            className={`p-1 rounded-md transition-colors ${
              isMultiSelectMode 
                ? 'text-blue-400 bg-blue-500/20 hover:bg-blue-500/30' 
                : 'text-gray-400 hover:text-white hover:bg-zinc-700'
            }`}
            aria-label="Toggle Multi-Select Mode"
            title="Select multiple sessions for bulk actions"
          >
            {isMultiSelectMode ? <CheckSquare size={18} /> : <Square size={18} />}
          </button>
          
          {/* Bulk delete button - only show when in multi-select mode with selections */}
          {isMultiSelectMode && selectedSessions.size > 0 && (
            <button 
              onClick={handleBulkDelete}
              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-md transition-colors"
              aria-label={`Delete ${selectedSessions.size} selected sessions`}
              title={`Delete ${selectedSessions.size} selected session${selectedSessions.size > 1 ? 's' : ''}`}
            >
              <Trash2 size={18} />
            </button>
          )}
          
          <button 
            onClick={onToggleHistory}
            className="p-1 text-gray-400 hover:text-white hover:bg-zinc-700 rounded-md transition-colors"
            aria-label="Close History"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      

      {/* History List */}
      <div className="p-4 space-y-2">
        {sessions.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-8">No generation history yet.</p>
         ) : (
             filteredSessions
                 .sort((a, b) => b.timestamp - a.timestamp)
                 .map(session => {
                     let messageSnippet: string | null = null;
                     const searchTermLower = searchTerm.toLowerCase();
                     if (searchTermLower && !session.title.toLowerCase().includes(searchTermLower)) {
                         const matchingMessage = session.messages.find(message => 
                             message.text.toLowerCase().includes(searchTermLower)
                         );
                         if (matchingMessage) {
                             const contextLength = 25;
                             const index = matchingMessage.text.toLowerCase().indexOf(searchTermLower);
                             if (index !== -1) {
                                 const start = Math.max(0, index - contextLength);
                                 const end = Math.min(matchingMessage.text.length, index + searchTermLower.length + contextLength);
                                 const prefix = start > 0 ? "... " : "";
                                 const suffix = end < matchingMessage.text.length ? " ..." : "";
                                 const rawSnippet = matchingMessage.text.substring(start, end);
                                 const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                                 messageSnippet = rawSnippet.replace(regex, match => `<strong class="text-blue-300 font-semibold">${match}</strong>`);
                                 messageSnippet = prefix + messageSnippet + suffix;
                             }
                         }
                     }

                     const isSelected = selectedSessions.has(session.id);
                 
                     return (
                         <div 
                             key={session.id}
                             className={`group block w-full rounded-lg transition-colors relative ${ 
                                 activeSessionId === session.id 
                                     ? 'bg-zinc-700/60'
                                     : isSelected && isMultiSelectMode
                                     ? 'bg-blue-500/20 border border-blue-500/40'
                                     : 'hover:bg-zinc-700/40'
                             }`}
                         >
                             {/* Multi-select checkbox - always show when in multi-select mode */}
                             {isMultiSelectMode && (
                               <div className="absolute right-3 top-1/2 transform -translate-y-1/2 z-10">
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     handleToggleSessionSelection(session.id);
                                   }}
                                   className={`p-1 rounded transition-colors ${
                                     isSelected 
                                       ? 'text-blue-400 hover:text-blue-300' 
                                       : 'text-gray-400 hover:text-white'
                                   }`}
                                 >
                                   {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                 </button>
                               </div>
                             )}



                             <button 
                                 onClick={() => {
                                   if (isMultiSelectMode) {
                                     handleToggleSessionSelection(session.id);
                                   } else if (editingSessionId !== session.id) {
                                     onLoadSession(session.id);
                                   }
                                 }}
                                 className={`block w-full text-left p-3 ${activeSessionId === session.id && !isMultiSelectMode ? 'cursor-default' : ''}`}
                                 disabled={editingSessionId === session.id && !isMultiSelectMode}
                              >
                                 <div className={isMultiSelectMode ? 'pr-12' : 'pr-16'}>
                                     {editingSessionId === session.id ? (
                                         <input 
                                             id={`edit-title-${session.id}`}
                                             type="text"
                                             value={editTitleText}
                                             onChange={(e) => onEditTitleChange(e.target.value)}
                                             onBlur={onSaveEdit}
                                             onKeyDown={(e) => {
                                                 if (e.key === 'Enter') {
                                                     e.preventDefault(); 
                                                     onSaveEdit();
                                                 } else if (e.key === 'Escape') {
                                                     onCancelEdit();
                                                 } 
                                             }}
                                             onClick={(e) => e.stopPropagation()}
                                             className="w-full bg-zinc-600 border border-zinc-500 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                         />
                                     ) : (
                                         <p className="text-sm font-medium text-gray-200 truncate">
                                             {session.title}
                                             <span className="text-gray-500 text-xs ml-2">
                                                 / {session.messages.length} prompts
                                             </span>
                                         </p>
                                     )}
                                     <p className="text-xs text-gray-400 mt-1 flex items-center flex-wrap"> 
                                         <span className="mr-2 flex-shrink-0">{new Date(session.timestamp).toLocaleString()}</span> 
                                         {activeSessionId === session.id && (
                                             <span className="mr-2 flex-shrink-0 px-1.5 py-0.5 rounded bg-green-800/50 text-green-300 text-[10px] font-medium">
                                                 Current
                                             </span>
                                         )}
                                         {messageSnippet && (
                                              <span 
                                                  className="text-gray-500 italic truncate" 
                                                  dangerouslySetInnerHTML={{ __html: messageSnippet }}
                                              />
                                         )}
                                     </p>
                                 </div>
                             </button>
                             
                             {/* Action buttons - hide in multi-select mode */}
                             {!isMultiSelectMode && (
                               <div className={`absolute top-1/2 right-3 transform -translate-y-1/2 flex items-center gap-1 transition-opacity duration-150 ${ 
                                   editingSessionId === session.id 
                                       ? 'opacity-100 visible'
                                       : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'
                                   }`}
                                >
                                   {editingSessionId === session.id ? (
                                       <button 
                                           onClick={(e) => { 
                                               e.stopPropagation(); 
                                               onSaveEdit(); 
                                           }} 
                                           className="p-1.5 text-green-400 hover:text-white hover:bg-green-600/50 rounded-md" 
                                           aria-label="Confirm rename"
                                       >
                                           <Check size={14} />
                                       </button>
                                   ) : (
                                       <>
                                           <button onClick={(e) => { e.stopPropagation(); console.log('Share:', session.id); }} className="p-1.5 text-gray-400 hover:text-white hover:bg-zinc-600/50 rounded-md" aria-label="Share session">
                                               <ExternalLink size={14} />
                                           </button>
                                           <button 
                                               onClick={(e) => { 
                                                   e.stopPropagation(); 
                                                   onStartEdit(session.id, session.title);
                                                   setTimeout(() => {
                                                       const inputElement = document.getElementById(`edit-title-${session.id}`);
                                                       inputElement?.focus();
                                                   }, 50); 
                                               }} 
                                               className={`p-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-zinc-600/50`} 
                                               aria-label="Edit session title"
                                           >
                                               <FilePenLine size={14} />
                                           </button>
                                           <button 
                                               onClick={(e) => { 
                                                   e.stopPropagation(); 
                                                   onDeleteSession(session.id, session.title);
                                               }} 
                                               className="p-1.5 text-red-500/70 hover:text-red-400 hover:bg-red-900/30 rounded-md" 
                                               aria-label="Delete session"
                                           >
                                               <Trash2 size={14} />
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

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  sessionId,
  sessionTitle,
  onConfirm,
  onCancel
}) => {
  if (!isOpen || !sessionId || sessionTitle === null) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1f1f20] border border-[#3a3a3d] rounded-lg shadow-xl max-w-sm w-full overflow-hidden">
        {/* Header */}
        <div className="p-4">
          <h2 className="text-lg font-semibold text-white">Delete generation session?</h2>
        </div>

        {/* Divider */}
        <hr className="border-t border-[#3a3a3d]" />

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-gray-300">
            This will delete <strong className="text-white">{sessionTitle}</strong>.
          </p>
        </div>

        {/* Footer with Buttons */}
        <div className="flex justify-end gap-3 bg-zinc-800/30 px-4 py-3 border-t border-[#3a3a3d]">
          <button 
            onClick={onCancel}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-300 bg-zinc-600/50 hover:bg-zinc-600/80 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}; 