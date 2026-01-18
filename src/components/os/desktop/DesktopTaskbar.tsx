import * as React from 'react';
import { Clock, Calendar, Battery, Wifi, Volume2, Search, Grid3X3, Settings, Users, Share2 } from 'lucide-react';
import { useWindowManager } from './WindowManager';
import { useCollaboration } from '../../../contexts/CollaborationContext';
import { ParticipantAvatars, CollaborationStatus } from './CollaboratorCursors';

interface DesktopTaskbarProps {
  onStartMenuClick?: () => void;
  onSearchClick?: () => void;
  onSettingsClick?: () => void;
  onCollaborateClick?: () => void;
}

const DesktopTaskbar: React.FC<DesktopTaskbarProps> = ({
  onStartMenuClick,
  onSearchClick,
  onSettingsClick,
  onCollaborateClick
}) => {
  const { windows, bringToFront, minimizeWindow } = useWindowManager();
  const { session, participants, isConnected } = useCollaboration();
  const [currentTime, setCurrentTime] = React.useState(new Date());

  // Update time every second
  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const handleTaskbarButtonClick = (windowId: string) => {
    const window = windows.find(w => w.id === windowId);
    if (!window) return;

    if (window.isMinimized) {
      // Restore and bring to front
      minimizeWindow(windowId); // Toggle minimize state
      bringToFront(windowId);
    } else {
      // Check if it's the active window (highest z-index)
      const maxZIndex = Math.max(...windows.map(w => w.zIndex));
      const isActive = window.zIndex === maxZIndex;

      if (isActive) {
        // Minimize if it's the active window
        minimizeWindow(windowId);
      } else {
        // Bring to front if it's not active
        bringToFront(windowId);
      }
    }
  };

  const getWindowIcon = (window: any) => {
    return window.icon || <div className="w-4 h-4 bg-white/60 rounded" />;
  };

  const visibleWindows = windows.filter(w => !w.isMinimized || w.isMinimized);
  const maxZIndex = windows.length > 0 ? Math.max(...windows.map(w => w.zIndex)) : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-10 bg-black/80 backdrop-blur-md border-t border-white/10 flex items-center px-2 z-[9999]">
      {/* Left Section - Start Button, Search, Task View */}
      <div className="flex items-center gap-1">
        {/* Start Button */}
        <button
          onClick={onStartMenuClick}
          className="h-8 px-3 flex items-center justify-center bg-transparent hover:bg-white/10 transition-colors rounded text-white/80 hover:text-white"
          title="Start"
        >
          <Grid3X3 size={18} />
        </button>

        {/* Search Button */}
        <button
          onClick={onSearchClick}
          className="h-8 px-3 flex items-center justify-center bg-transparent hover:bg-white/10 transition-colors rounded text-white/80 hover:text-white"
          title="Search"
        >
          <Search size={16} />
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-white/20 mx-1" />
      </div>

      {/* Center Section - Running Applications */}
      <div className="flex-1 flex items-center gap-1 px-2">
        {visibleWindows.map((window) => {
          const isActive = window.zIndex === maxZIndex && !window.isMinimized;
          const isMinimized = window.isMinimized;

          return (
            <button
              key={window.id}
              onClick={() => handleTaskbarButtonClick(window.id)}
              className={`
                h-8 px-3 flex items-center gap-2 rounded transition-all duration-200
                ${isActive
                  ? 'bg-white/20 text-white border-b-2 border-blue-400'
                  : isMinimized
                  ? 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80'
                  : 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                }
                max-w-48 min-w-[120px]
              `}
              title={`${window.title}${isMinimized ? ' (minimized)' : ''}`}
            >
              {/* Window Icon */}
              <div className="flex-shrink-0">
                {getWindowIcon(window)}
              </div>

              {/* Window Title */}
              <span className="text-xs font-medium truncate">
                {window.title}
              </span>

              {/* Active Indicator */}
              {isActive && (
                <div className="w-1 h-1 bg-blue-400 rounded-full flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right Section - System Tray */}
      <div className="flex items-center gap-2 text-white/80">
        {/* Collaboration Section */}
        {session ? (
          <>
            {/* Participant Avatars */}
            <ParticipantAvatars
              maxVisible={3}
              size="sm"
              onClick={onCollaborateClick}
            />

            {/* Live Indicator */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded cursor-pointer hover:bg-green-500/15 transition-colors"
              onClick={onCollaborateClick}
              title="Collaboration active"
            >
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              <span className="text-[11px] text-green-400/90 font-medium">Live</span>
            </div>
          </>
        ) : (
          /* Share/Collaborate Button */
          <button
            onClick={onCollaborateClick}
            className="h-6 px-2.5 flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
            title="Share & Collaborate"
          >
            <Share2 size={12} className="text-white/60" />
            <span className="text-[11px] text-white/60 font-medium">Share</span>
          </button>
        )}

        {/* Separator */}
        <div className="w-px h-6 bg-white/20 mx-1" />

        {/* System Icons */}
        <div className="flex items-center gap-1">
          <button
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Network"
          >
            <Wifi size={14} />
          </button>
          <button
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Volume"
          >
            <Volume2 size={14} />
          </button>
          <button
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Battery"
          >
            <Battery size={14} />
          </button>
        </div>

        {/* Settings Button */}
        <button
          className="p-1 hover:bg-white/10 rounded transition-colors"
          title="Settings"
          onClick={onSettingsClick}
        >
          <Settings size={14} />
        </button>

        {/* Separator */}
        <div className="w-px h-6 bg-white/20 mx-1" />

        {/* Date and Time */}
        <button
          className="px-2 py-1 hover:bg-white/10 rounded transition-colors text-right"
          title="Date and Time"
        >
          <div className="text-xs font-medium">
            {formatTime(currentTime)}
          </div>
          <div className="text-xs text-white/60 leading-tight">
            {formatDate(currentTime)}
          </div>
        </button>
      </div>
    </div>
  );
};

export default DesktopTaskbar;
