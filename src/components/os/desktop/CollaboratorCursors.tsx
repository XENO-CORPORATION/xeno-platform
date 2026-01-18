/**
 * CollaboratorCursors
 * Renders other users' cursors on the desktop - Figma-style multiplayer collaboration
 */

import React, { useMemo } from 'react';
import { useCollaboration, Participant } from '../../../contexts/CollaborationContext';
import { useAuth } from '../../../contexts/AuthContext';

interface CursorProps {
  participant: Participant;
  isInWindow?: boolean;
}

// Individual cursor component
const RemoteCursor: React.FC<CursorProps> = ({ participant, isInWindow }) => {
  const { displayName, color, cursorX, cursorY, avatarUrl } = participant;

  // Don't render if cursor is at origin (not moved yet)
  if (cursorX === 0 && cursorY === 0) return null;

  return (
    <div
      className="fixed pointer-events-none z-[9999] transition-transform duration-75 ease-out"
      style={{
        left: cursorX,
        top: cursorY,
        transform: 'translate(-2px, -2px)'
      }}
    >
      {/* Cursor arrow SVG */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
      >
        {/* Cursor outline */}
        <path
          d="M5.5 3L20 12L13 13L10 20L5.5 3Z"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Cursor fill */}
        <path
          d="M5.5 3L20 12L13 13L10 20L5.5 3Z"
          fill={color}
          strokeLinejoin="round"
        />
      </svg>

      {/* Name tag */}
      <div
        className="absolute left-5 top-4 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap shadow-lg"
        style={{
          backgroundColor: color,
          color: getContrastColor(color)
        }}
      >
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt=""
            className="w-4 h-4 rounded-full"
          />
        )}
        <span>{displayName}</span>
      </div>
    </div>
  );
};

// Cursor with selection highlight
const CursorWithSelection: React.FC<{ participant: Participant }> = ({ participant }) => {
  const { selection, color } = participant;

  return (
    <>
      <RemoteCursor participant={participant} />

      {/* Selection highlights */}
      {selection && selection.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-[9998]">
          {selection.map((itemId) => (
            <SelectionHighlight
              key={itemId}
              itemId={itemId}
              color={color}
              userName={participant.displayName}
            />
          ))}
        </div>
      )}
    </>
  );
};

// Selection highlight for selected items
const SelectionHighlight: React.FC<{
  itemId: string;
  color: string;
  userName: string;
}> = ({ itemId, color, userName }) => {
  // Find the element by ID and render a highlight around it
  const element = document.getElementById(itemId);

  if (!element) return null;

  const rect = element.getBoundingClientRect();

  return (
    <div
      className="fixed pointer-events-none rounded-lg transition-all duration-150"
      style={{
        left: rect.left - 4,
        top: rect.top - 4,
        width: rect.width + 8,
        height: rect.height + 8,
        border: `2px solid ${color}`,
        backgroundColor: `${color}15`,
        boxShadow: `0 0 0 1px ${color}40`
      }}
    >
      {/* Small badge showing who selected it */}
      <div
        className="absolute -top-5 left-0 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
        style={{
          backgroundColor: color,
          color: getContrastColor(color)
        }}
      >
        {userName}
      </div>
    </div>
  );
};

// Helper function to get contrasting text color
function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

// Main component that renders all remote cursors
const CollaboratorCursors: React.FC = () => {
  const { participants, session } = useCollaboration();
  const { user } = useAuth();

  // Filter out current user's cursor
  const remoteCursors = useMemo(() => {
    const filtered = participants.filter(p => p.odea !== user?.id);
    console.log('🎯 CollaboratorCursors - Total participants:', participants.length,
      'My ID:', user?.id,
      'Remote cursors:', filtered.length,
      'Participant IDs:', participants.map(p => ({ id: p.id, odea: p.odea, displayName: p.displayName })));
    return filtered;
  }, [participants, user?.id]);

  // Don't render if no session or no remote users
  if (!session || remoteCursors.length === 0) {
    console.log('🎯 CollaboratorCursors - Not rendering. Session:', !!session, 'Remote cursors:', remoteCursors.length);
    return null;
  }

  console.log('🎯 CollaboratorCursors - Rendering', remoteCursors.length, 'cursors:',
    remoteCursors.map(p => ({ name: p.displayName, x: p.cursorX, y: p.cursorY })));

  return (
    <div className="collaboration-cursors fixed inset-0 pointer-events-none z-[9999]">
      {remoteCursors.map((participant) => (
        <CursorWithSelection
          key={participant.id}
          participant={participant}
        />
      ))}
    </div>
  );
};

// Participant presence indicator (shows in taskbar/header)
export const ParticipantAvatars: React.FC<{
  maxVisible?: number;
  size?: 'sm' | 'md' | 'lg';
  showNames?: boolean;
  onClick?: () => void;
}> = ({ maxVisible = 4, size = 'md', showNames = false, onClick }) => {
  const { participants, session } = useCollaboration();
  const { user } = useAuth();

  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base'
  };

  const borderSize = {
    sm: 'border-2',
    md: 'border-2',
    lg: 'border-3'
  };

  if (!session || participants.length === 0) {
    return null;
  }

  const visibleParticipants = participants.slice(0, maxVisible);
  const hiddenCount = participants.length - maxVisible;

  return (
    <div
      className={`flex items-center ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      onClick={onClick}
    >
      {/* Stacked avatars */}
      <div className="flex -space-x-2">
        {visibleParticipants.map((participant, index) => (
          <div
            key={participant.id}
            className={`${sizeClasses[size]} ${borderSize[size]} rounded-full border-[#1a1a1a] flex items-center justify-center font-medium relative group`}
            style={{
              backgroundColor: participant.color,
              color: getContrastColor(participant.color),
              zIndex: visibleParticipants.length - index
            }}
            title={participant.displayName}
          >
            {participant.avatarUrl ? (
              <img
                src={participant.avatarUrl}
                alt={participant.displayName || 'User'}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              (participant.displayName || 'U').charAt(0).toUpperCase()
            )}

            {/* Online indicator */}
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#1a1a1a] bg-green-500"
              style={{ zIndex: 10 }}
            />

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              {participant.displayName}
              {participant.odea === user?.id && ' (You)'}
            </div>
          </div>
        ))}

        {/* +N more indicator */}
        {hiddenCount > 0 && (
          <div
            className={`${sizeClasses[size]} ${borderSize[size]} rounded-full border-[#1a1a1a] bg-white/10 text-white flex items-center justify-center font-medium`}
          >
            +{hiddenCount}
          </div>
        )}
      </div>

      {/* Names list (optional) */}
      {showNames && (
        <div className="ml-3 text-sm text-white/70">
          {participants.length} collaborator{participants.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

// Collaboration status indicator
export const CollaborationStatus: React.FC = () => {
  const { session, isConnected, participants } = useCollaboration();

  if (!session) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/10">
      {/* Connection status dot */}
      <div
        className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
        }`}
      />

      {/* Session info */}
      <span className="text-xs text-white/70">
        {isConnected ? (
          <>
            <span className="text-green-400">Live</span>
            {' · '}
            {participants.length} online
          </>
        ) : (
          <span className="text-red-400">Disconnected</span>
        )}
      </span>
    </div>
  );
};

// Typing indicator component
export const TypingIndicator: React.FC<{
  participantId: string;
  isTyping: boolean;
}> = ({ participantId, isTyping }) => {
  const { participants } = useCollaboration();
  const participant = participants.find(p => p.id === participantId);

  if (!isTyping || !participant) return null;

  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      style={{ color: participant.color }}
    >
      <span>{participant.displayName} is typing</span>
      <div className="flex gap-0.5">
        <div className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
};

export default CollaboratorCursors;
