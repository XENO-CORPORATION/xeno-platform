import React, { useState } from 'react';
import { X, Clock, Download, Trash2, Search, ExternalLink, FilePenLine, Check, CheckSquare, Square, FileClock, RefreshCw } from 'lucide-react';
import { VideoProject } from '../../../../../services/videoStudioService';

interface VideoHistoryItem {
  id: string;
  title: string;
  thumbnail: string;
  createdAt: Date;
  duration: number;
  size: number;
}

interface VideoGenerationSession {
  id: string;
  title: string;
  createdAt: Date;
  messages: Array<{
    id: string;
    text: string;
    isUser: boolean;
    timestamp: Date;
    videoData?: {
      src: string;
      thumbnail?: string;
      duration?: number;
    };
  }>;
}

interface HistoryPanelProps {
  isHistoryOpen: boolean;
  sessions: VideoGenerationSession[];
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
  projects?: VideoProject[];
  isProjectLoading?: boolean;
  projectError?: string | null;
  onRefreshProjects?: () => void;
  onSelectProject?: (project: VideoProject) => void;
}

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  sessionId: string | null;
  sessionTitle: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: VideoHistoryItem[];
  onSelectVideo: (item: VideoHistoryItem) => void;
  onDeleteVideo: (id: string) => void;
  onDownloadVideo: (item: VideoHistoryItem) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onSelectVideo,
  onDeleteVideo,
  onDownloadVideo
}) => {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number): string => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Video History</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          {history.length === 0 ? (
            <div className="text-center py-12">
              <Clock size={48} className="text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">No video history yet</p>
              <p className="text-gray-400 text-sm mt-2">Your processed videos will appear here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors cursor-pointer group"
                  onClick={() => onSelectVideo(item)}
                >
                  {/* Video thumbnail */}
                  <div className="relative mb-3">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-full h-32 object-cover rounded-md"
                    />
                    <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                      {formatDuration(item.duration)}
                    </div>
                  </div>

                  {/* Video info */}
                  <div className="space-y-2">
                    <h3 className="font-medium text-gray-900 truncate" title={item.title}>
                      {item.title}
                    </h3>
                    
                    <div className="text-xs text-gray-500 space-y-1">
                      <div className="flex items-center space-x-1">
                        <Clock size={12} />
                        <span>{formatDate(item.createdAt)}</span>
                      </div>
                      <div>{formatFileSize(item.size)}</div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDownloadVideo(item);
                        }}
                        className="p-1.5 hover:bg-blue-100 text-blue-600 rounded transition-colors"
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteVideo(item.id);
                        }}
                        className="p-1.5 hover:bg-red-100 text-red-600 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-500">
            {history.length} video{history.length !== 1 ? 's' : ''} in history
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

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
  position = 'below',
  projects,
  isProjectLoading,
  projectError,
  onRefreshProjects,
  onSelectProject
}) => {
  const isPositionedAbove = position === 'above';
  
  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const projectList = projects ?? [];
  const hasProjectSection = Boolean(onSelectProject);
  const getProjectStatusStyles = (status: VideoProject['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 text-green-300 border border-green-500/30';
      case 'rendering':
        return 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
      case 'failed':
        return 'bg-red-500/20 text-red-300 border border-red-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border border-gray-500/30';
    }
  };

  const formatProjectTimestamp = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  };

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

  if (!isHistoryOpen) return null;

  // Filter sessions based on search term
  const filteredSessions = sessions.filter(session => {
    const searchTermLower = searchTerm.toLowerCase();
    if (!searchTermLower) return true;
    if (session.title.toLowerCase().includes(searchTermLower)) return true;
    return session.messages.some(message => 
      message.text.toLowerCase().includes(searchTermLower)
    );
  });

  const dropdownClasses = isPositionedAbove
    ? 'absolute bottom-full left-0 right-0 mb-2'
    : 'absolute top-full left-0 right-0 mt-2';

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
          
          {/* Close button */}
          <button 
            onClick={onToggleHistory}
            className="p-1 text-gray-400 hover:text-white hover:bg-zinc-700 rounded-md transition-colors ml-1"
            aria-label="Close History"
            title="Close history panel"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Session List */}
      <div className="min-h-0 flex-1">
        {hasProjectSection && (
          <div className="border-b border-zinc-700/40">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-white/80">Projects</span>
              <div className="flex items-center gap-2">
                {isProjectLoading && (
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {onRefreshProjects && (
                  <button
                    onClick={onRefreshProjects}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw size={14} className={isProjectLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                )}
              </div>
            </div>
            <div className="px-4 pb-3 space-y-2">
              {projectError ? (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded">
                  {projectError}
                </div>
              ) : projectList.length === 0 && !isProjectLoading ? (
                <div className="text-xs text-white/50 px-3 py-2">
                  No projects yet
                </div>
              ) : (
                projectList.map(project => (
                  <button
                    key={project.id}
                    onClick={() => onSelectProject && onSelectProject(project)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-zinc-800/40 border border-transparent hover:border-blue-500/40 hover:bg-blue-500/10 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{project.title || 'Untitled Project'}</div>
                        <div className="text-xs text-white/50 truncate">
                          {project.width}×{project.height} • {project.fps}fps • {Math.round(project.duration || 0)}s
                        </div>
                      </div>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${getProjectStatusStyles(project.status)}`}>
                        {project.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-white/40 mt-1 flex items-center gap-2">
                      <Clock size={12} className="opacity-60" />
                      <span>Updated {formatProjectTimestamp(project.updated_at)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {filteredSessions.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-gray-400 mb-2">
              <FileClock size={48} className="mx-auto" />
            </div>
            <p className="text-gray-400 text-sm">
              {searchTerm ? 'No matching sessions found' : 'No generation history yet'}
            </p>
            <p className="text-gray-500 text-xs mt-1">
              {searchTerm ? 'Try a different search term' : 'Your video generations will appear here'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-700/50">
            {filteredSessions.map((session) => {
              const isActiveSession = session.id === activeSessionId;
              const isSelectedSession = selectedSessions.has(session.id);
              const isEditing = editingSessionId === session.id;

              return (
                <div
                  key={session.id}
                  className={`group relative p-3 cursor-pointer transition-all duration-200 ${
                    isActiveSession 
                      ? 'bg-blue-500/20 border-l-2 border-blue-400' 
                      : 'hover:bg-zinc-700/30 border-l-2 border-transparent'
                  } ${
                    isSelectedSession && isMultiSelectMode 
                      ? 'bg-blue-500/10 ring-1 ring-blue-400/50' 
                      : ''
                  }`}
                  onClick={() => {
                    if (isMultiSelectMode) {
                      handleToggleSessionSelection(session.id);
                    } else if (!isEditing) {
                      onLoadSession(session.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    {/* Multi-select checkbox */}
                    {isMultiSelectMode && (
                      <div className="flex-shrink-0 mt-0.5">
                        {isSelectedSession ? (
                          <CheckSquare size={16} className="text-blue-400" />
                        ) : (
                          <Square size={16} className="text-gray-500" />
                        )}
                      </div>
                    )}

                    {/* Session content */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="text"
                            value={editTitleText}
                            onChange={(e) => onEditTitleChange(e.target.value)}
                            className="flex-1 bg-zinc-600 border border-zinc-500 rounded-md px-2 py-1 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="Session title..."
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                onSaveEdit();
                              } else if (e.key === 'Escape') {
                                onCancelEdit();
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSaveEdit();
                            }}
                            className="flex-shrink-0 p-1 text-green-400 hover:text-green-300 hover:bg-green-500/20 rounded transition-colors"
                            title="Save changes"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCancelEdit();
                            }}
                            className="flex-shrink-0 p-1 text-gray-400 hover:text-white hover:bg-zinc-600 rounded transition-colors"
                            title="Cancel editing"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <h4 className="font-medium text-white text-sm mb-1 truncate pr-8">
                          {session.title}
                        </h4>
                      )}

                      <div className="text-xs text-gray-400 space-y-0.5">
                        <p>{session.createdAt.toLocaleDateString()} • {session.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        <p>{session.messages.length} message{session.messages.length !== 1 ? 's' : ''}</p>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {!isMultiSelectMode && !isEditing && (
                      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartEdit(session.id, session.title);
                          }}
                          className="p-1 text-gray-400 hover:text-white hover:bg-zinc-600 rounded transition-colors"
                          title="Edit session title"
                        >
                          <FilePenLine size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(session.id, session.title);
                          }}
                          className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/20 rounded transition-colors"
                          title="Delete session"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Delete Session
          </h3>
          <p className="text-gray-600 mb-4">
            Are you sure you want to delete "{sessionTitle}"? This action cannot be undone.
          </p>
          <div className="flex items-center justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;