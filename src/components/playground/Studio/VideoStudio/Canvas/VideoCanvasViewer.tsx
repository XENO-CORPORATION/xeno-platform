import React, { useState, useRef, useEffect } from 'react';
import { 
  X, ZoomIn, ZoomOut, RotateCw, Download, 
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Settings
} from 'lucide-react';

interface VideoCanvasViewerProps {
  videoUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
  onVideoUpdate?: (newVideoUrl: string) => void;
  // Panel toggle functions
  onSidePanelToggle?: () => void;
  onRightPanelToggle?: () => void;
  onBottomPanelToggle?: () => void;
  // Panel state for UI indicators
  isSidePanelOpen?: boolean;
  isRightPanelOpen?: boolean;
  isBottomPanelOpen?: boolean;
  // External control from timeline/bottom panel
  controlRequest?: {
    type: 'togglePlay' | 'play' | 'pause' | 'skip' | 'seekTo' | 'goToStart' | 'goToEnd';
    value?: number; // seconds for skip/seek
    requestId: number; // change to trigger effect
  };
  // Inform parent of play/time changes
  onPlayStateChange?: (isPlaying: boolean) => void;
  onTimeChange?: (currentTime: number, duration: number) => void;
  previewPosition?: { x: number; y: number };
  setPreviewPosition?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  previewRef?: React.RefObject<HTMLDivElement>;
  previewWidth?: number;
  setPreviewWidth?: React.Dispatch<React.SetStateAction<number>>;
}

const VideoCanvasViewer: React.FC<VideoCanvasViewerProps> = ({
  videoUrl,
  isOpen,
  onClose,
  onVideoUpdate,
  onSidePanelToggle,
  onRightPanelToggle,
  onBottomPanelToggle,
  isSidePanelOpen,
  isRightPanelOpen,
  isBottomPanelOpen,
  controlRequest,
  onPlayStateChange,
  onTimeChange,
  previewPosition,
  setPreviewPosition,
  previewRef,
  previewWidth,
  setPreviewWidth
}) => {
  // Canvas and video refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Canvas viewport state
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  
  // Smart save/close state (match ImageStudio behavior)
  const [showSaveButton, setShowSaveButton] = useState(false);
  const [isCloseDisabled, setIsCloseDisabled] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  
  // UI state (matching ImageStudio)
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const [showControlsDropdown, setShowControlsDropdown] = useState(false);
  const [isHoveringUI, setIsHoveringUI] = useState(false);
  const [uiVisibility, setUiVisibility] = useState({
    topControls: true,
    videoControls: true,
    tools: true
  });
  
  // Video object for canvas rendering
  const [videoObj, setVideoObj] = useState<HTMLVideoElement | null>(null);
  
  // UI handlers (matching ImageStudio)
  const handleTabMenuToggle = () => {
    setIsTabMenuOpen(!isTabMenuOpen);
    if (isViewDropdownOpen) setIsViewDropdownOpen(false);
  };
  
  const handleMenuItemClick = (item: string) => {
    if (item === 'view') {
      setIsViewDropdownOpen(!isViewDropdownOpen);
    }
    // Add other menu handlers as needed
  };
  
  const handleUiToggle = (element: keyof typeof uiVisibility) => {
    setUiVisibility(prev => ({
      ...prev,
      [element]: !prev[element]
    }));
  };

  // Reset smart close state when canvas opens or video changes
  useEffect(() => {
    if (isOpen) {
      setShowSaveButton(false);
      setIsCloseDisabled(false);
      setShowCheckmark(false);
      setSaveCompleted(false);
    }
  }, [isOpen, videoUrl]);

  // Handle smart close click (first click shows save, then enable close after save)
  const handleCloseClick = () => {
    // If no video loaded, no save required; close immediately
    if (!videoUrl) {
      onClose();
      return;
    }
    if (saveCompleted) {
      onClose();
    } else if (!showSaveButton) {
      setShowSaveButton(true);
      setIsCloseDisabled(true);
    }
  };

  // Handle save click (persist current state, then enable close)
  const handleSaveClick = () => {
    if (onVideoUpdate && (videoUrl || '')) {
      onVideoUpdate(videoUrl || '');
    }
    setShowCheckmark(true);
    // After brief checkmark animation, hide save and enable close
    setTimeout(() => {
      setShowCheckmark(false);
      setShowSaveButton(false);
      setIsCloseDisabled(false);
      setSaveCompleted(true);
    }, 1500);
  };
  
  // Initialize canvas size when component opens or window resizes
  useEffect(() => {
    if (!isOpen) return;
    const resize = () => {
      if (!canvasRef.current || !containerRef.current) return;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      setCanvasSize({ width: canvas.width, height: canvas.height });
      if (videoSize.width && videoSize.height) {
        centerVideo(videoSize.width, videoSize.height, canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      stopRenderLoop();
      setVideoObj(null);
    };
  }, [isOpen, videoSize.width, videoSize.height]);
  
  // Start render loop when video is ready and transformations change
  useEffect(() => {
    if (videoObj && canvasRef.current) {
      stopRenderLoop();
      startRenderLoop();
    }
    
    return () => {
      stopRenderLoop();
    };
  }, [videoObj, translateX, translateY, scale]);
  
  // Center video on canvas
  const centerVideo = (videoWidth: number, videoHeight: number, canvasWidth: number, canvasHeight: number) => {
    // Calculate scale to fit video in canvas while maintaining aspect ratio
    const scaleX = canvasWidth / videoWidth;
    const scaleY = canvasHeight / videoHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.8; // 80% of available space
    
    setScale(fitScale);
    
    // Center the video
    const scaledWidth = videoWidth * fitScale;
    const scaledHeight = videoHeight * fitScale;
    setTranslateX((canvasWidth - scaledWidth) / 2);
    setTranslateY((canvasHeight - scaledHeight) / 2);
  };
  
  // Render video frame to canvas
  const renderVideoFrame = useRef<number | null>(null);
  
  const startRenderLoop = () => {
    if (!videoObj || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const render = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw video frame
      if (videoObj.readyState >= 2) { // HAVE_CURRENT_DATA
        ctx.save();
        
        // Apply transformations
        ctx.translate(translateX, translateY);
        ctx.scale(scale, scale);
        
        // Draw video
        ctx.drawImage(videoObj, 0, 0, videoObj.videoWidth, videoObj.videoHeight);
        
        ctx.restore();
      }
      
      // Continue rendering loop
      renderVideoFrame.current = requestAnimationFrame(render);
    };
    
    render();
  };
  
  const stopRenderLoop = () => {
    if (renderVideoFrame.current) {
      cancelAnimationFrame(renderVideoFrame.current);
      renderVideoFrame.current = null;
    }
  };
  
  // Mouse event handlers for panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && (isSpacePressed || e.shiftKey)) { // Left click + space or shift
      setIsDragging(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
      e.preventDefault();
    }
  };
  
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - lastMousePos.x;
      const deltaY = e.clientY - lastMousePos.y;
      
      setTranslateX(prev => prev + deltaX);
      setTranslateY(prev => prev + deltaY);
      
      setLastMousePos({ x: e.clientX, y: e.clientY });
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const handleMouseLeave = () => {
    setIsDragging(false);
  };
  
  // Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, scale * zoomFactor));
    
    // Zoom towards mouse position
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      const deltaScale = newScale - scale;
      setTranslateX(prev => prev - (mouseX - translateX) * deltaScale / scale);
      setTranslateY(prev => prev - (mouseY - translateY) * deltaScale / scale);
    }
    
    setScale(newScale);
  };
  
  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!isSpacePressed) {
          setIsSpacePressed(true);
        }
        // Toggle play/pause when space is pressed
        if (videoObj && !isDragging) {
          togglePlayPause();
        }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsDragging(false);
      }
    };
    
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isOpen, isSpacePressed, videoObj, isDragging]);
  
  // Video control functions
  const togglePlayPause = () => {
    if (videoObj) {
      if (isPlaying) {
        videoObj.pause();
      } else {
        videoObj.play();
      }
      setIsPlaying(!isPlaying);
      onPlayStateChange?.(!isPlaying);
    }
  };
  
  const handleSeek = (time: number) => {
    if (videoObj) {
      videoObj.currentTime = time;
      setCurrentTime(time);
      onTimeChange?.(time, duration || videoObj.duration || 0);
    }
  };
  
  const toggleMute = () => {
    if (videoObj) {
      videoObj.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };
  
  const handleVolumeChange = (newVolume: number) => {
    if (videoObj) {
      videoObj.volume = newVolume;
      setVolume(newVolume);
    }
  };
  
  // Reset view
  const handleResetView = () => {
    if (videoSize.width && videoSize.height && canvasSize.width && canvasSize.height) {
      centerVideo(videoSize.width, videoSize.height, canvasSize.width, canvasSize.height);
    }
  };
  
  // Zoom functions
  const handleZoomIn = () => {
    setScale(prev => Math.min(5, prev * 1.2));
  };
  
  const handleZoomOut = () => {
    setScale(prev => Math.max(0.1, prev / 1.2));
  };
  
  // Format time for display
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // React to external control requests
  useEffect(() => {
    if (!controlRequest) return;
    switch (controlRequest.type) {
      case 'togglePlay':
        togglePlayPause();
        break;
      case 'play':
        if (videoObj && !isPlaying) {
          videoObj.play();
          setIsPlaying(true);
          onPlayStateChange?.(true);
        }
        break;
      case 'pause':
        if (videoObj && isPlaying) {
          videoObj.pause();
          setIsPlaying(false);
          onPlayStateChange?.(false);
        }
        break;
      case 'skip': {
        const delta = controlRequest.value || 0;
        const newTime = Math.max(0, Math.min((duration || videoObj?.duration || 0), currentTime + delta));
        handleSeek(newTime);
        break;
      }
      case 'seekTo':
        if (typeof controlRequest.value === 'number') {
          handleSeek(Math.max(0, controlRequest.value));
        }
        break;
      case 'goToStart':
        handleSeek(0);
        break;
      case 'goToEnd':
        handleSeek(duration || videoObj?.duration || 0);
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlRequest?.requestId]);
  
  if (!isOpen) return null;

  return (
    <>
      {/* Hidden video element for canvas rendering */}
      <video
        ref={videoRef}
        src={videoUrl || ''}
        className="hidden"
        playsInline
        autoPlay
        onLoadedMetadata={() => {
          const video = videoRef.current;
          if (!video) return;
          
          setVideoObj(video);
          setDuration(video.duration);
          
          // Center video in canvas
          const canvas = canvasRef.current;
          if (canvas) {
            centerVideo(video.videoWidth, video.videoHeight, canvas.width, canvas.height);
          }
          // Attempt autoplay (allowed when muted)
          video.muted = true;
          video.play().then(() => {
            setIsPlaying(true);
            onPlayStateChange?.(true);
          }).catch(() => {});
        }}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (video) {
            setCurrentTime(video.currentTime);
            onTimeChange?.(video.currentTime, duration || video.duration || 0);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        muted={isMuted}
      />
      
      {/* Main Canvas Container with backdrop - Fixed to cover full viewport but behind Taskbar (z-9999) */}
      <div className="fixed inset-0 w-full h-full bg-[#09090b] z-[8000] overflow-hidden">
        <div 
          ref={containerRef}
          className="relative w-full h-full overflow-hidden bg-transparent"
          onClick={(e) => {
            e.stopPropagation();
            // Close controls dropdown when clicking outside
            if (showControlsDropdown) {
              setShowControlsDropdown(false);
            }
          }}
        >
          {/* Tab Menu Button - Top Left Corner */}
          {(videoUrl || videoObj) && (
            <div 
              className="absolute top-4 left-4 z-[8003] flex items-center gap-2"
              onMouseEnter={() => setIsHoveringUI(true)}
              onMouseLeave={() => setIsHoveringUI(false)}
            >
              {/* Main Tab Button */}
              <button
                onClick={handleTabMenuToggle}
                className="w-12 h-12 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
                title="Menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="14" y="3" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="14" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <rect x="3" y="14" width="7" height="7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              {/* Expandable Menu Options */}
              {isTabMenuOpen && (
                <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
                  {/* File Menu Item */}
                  <button
                    onClick={() => handleMenuItemClick('file')}
                    className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                    title="File menu"
                  >
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">File</span>
                  </button>

                  {/* Video Menu Item */}
                  <button
                    onClick={() => handleMenuItemClick('video')}
                    className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                    title="Video menu"
                  >
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Video</span>
                  </button>

                  {/* View Menu Item */}
                  <div className="relative">
                    <button
                      onClick={() => handleMenuItemClick('view')}
                      className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                      title="View menu"
                    >
                      <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">View</span>
                    </button>

                    {/* View Dropdown Menu */}
                    {isViewDropdownOpen && (
                      <div className="absolute top-full -left-14 mt-1 w-40 bg-black/95 backdrop-blur-md border border-white/20 rounded-lg shadow-xl z-[8004] animate-in slide-in-from-top-2 duration-200">
                        <div className="p-2 space-y-1">
                          {/* Top Controls Toggle */}
                          <button
                            onClick={() => handleUiToggle('topControls')}
                            className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                              uiVisibility.topControls 
                                ? 'text-white bg-white/10 hover:bg-white/20' 
                                : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                            }`}
                          >
                            Top Controls
                          </button>

                          {/* Video Controls Toggle */}
                          <button
                            onClick={() => handleUiToggle('videoControls')}
                            className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                              uiVisibility.videoControls 
                                ? 'text-white bg-white/10 hover:bg-white/20' 
                                : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                            }`}
                          >
                            Video Controls
                          </button>

                          {/* Tools Toggle */}
                          <button
                            onClick={() => handleUiToggle('tools')}
                            className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                              uiVisibility.tools 
                                ? 'text-white bg-white/10 hover:bg-white/20' 
                                : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                            }`}
                          >
                            Tools
                          </button>

                          {/* Separator */}
                          <div className="border-t border-white/10 my-1"></div>

                          {/* Container Toggles */}
                          {onSidePanelToggle && (
                            <button
                              onClick={onSidePanelToggle}
                              className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                                isSidePanelOpen 
                                  ? 'text-white bg-white/10 hover:bg-white/20' 
                                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                              }`}
                            >
                              Side Panel
                            </button>
                          )}

                          {onRightPanelToggle && (
                            <button
                              onClick={onRightPanelToggle}
                              className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                                isRightPanelOpen 
                                  ? 'text-white bg-white/10 hover:bg-white/20' 
                                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                              }`}
                            >
                              Right Panel
                            </button>
                          )}

                          {onBottomPanelToggle && (
                            <button
                              onClick={onBottomPanelToggle}
                              className={`w-full px-3 py-2 text-center text-xs rounded transition-all duration-200 ${
                                isBottomPanelOpen 
                                  ? 'text-white bg-white/10 hover:bg-white/20' 
                                  : 'text-white/50 hover:text-white/70 hover:bg-white/10'
                              }`}
                            >
                              Bottom Panel
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Help Menu Item */}
                  <button
                    onClick={() => handleMenuItemClick('help')}
                    className="w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center hover:bg-black/80 transition-all duration-200 group"
                    title="Help menu"
                  >
                    <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Help</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Smart Save/Close Button - Top Right (match ImageStudio) */}
          {isOpen && (
            <div 
              className="absolute top-4 right-4 z-[8002] flex items-center gap-2"
              onMouseEnter={() => setIsHoveringUI(true)}
              onMouseLeave={() => setIsHoveringUI(false)}
            >
              {/* Expandable Save Button */}
              {(videoUrl || videoObj) && showSaveButton && (
                <div className="animate-in slide-in-from-right-2 duration-200">
                  <button
                    onClick={handleSaveClick}
                    className={`w-12 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center justify-center transition-all duration-200 group ${
                      showCheckmark
                        ? 'bg-green-500/30 border-green-400/60 text-green-300'
                        : 'hover:bg-black/80'
                    }`}
                    title="Save before closing"
                  >
                    {showCheckmark ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-pulse">
                        <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <span className="text-white/80 text-xs font-medium group-hover:text-white transition-colors">Save</span>
                    )}
                  </button>
                </div>
              )}

              {/* Close Button */}
              <button
                onClick={handleCloseClick}
                className={`w-10 h-10 backdrop-blur-md border rounded-lg flex items-center justify-center transition-all duration-300 ${
                  isCloseDisabled
                    ? 'bg-black/30 border-white/10 text-white/30 cursor-not-allowed'
                    : 'bg-black/70 border-white/20 text-white/70 hover:text-white hover:bg-black/80'
                }`}
                title={
                  isCloseDisabled 
                    ? 'Save first before closing' 
                    : showSaveButton
                      ? 'Click to close after saving'
                      : 'Close canvas'
                }
                disabled={isCloseDisabled}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}

          {/* Canvas Container */}
          <div className="relative w-full h-full bg-transparent">
            <canvas
              ref={canvasRef}
              className={`block w-full h-full transition-all duration-300 border-none shadow-none ${
                isSpacePressed 
                  ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') 
                  : 'cursor-default'
              }`}
              style={{ 
                imageRendering: 'auto',
                backgroundColor: 'transparent'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              onWheel={handleWheel}
              onContextMenu={(e) => e.preventDefault()} // Prevent right-click menu
              onAuxClick={(e) => e.preventDefault()} // Prevent middle-click default behavior
            />
          </div>

          {/* Canvas Info Bar with Zoom Controls */}
          {(videoUrl || videoObj) && (
            <div 
              className={`absolute top-4 left-1/2 z-[8001] transition-all duration-300 ease-out ${
                !uiVisibility.topControls 
                  ? 'transform -translate-x-1/2 -translate-y-full opacity-0' 
                  : 'transform -translate-x-1/2 translate-y-0 opacity-100'
              }`}
              onMouseEnter={() => setIsHoveringUI(true)}
              onMouseLeave={() => setIsHoveringUI(false)}
            >
              <div className="bg-black/70 backdrop-blur-md px-4 py-2 flex items-center gap-4">
                {/* Fit to Screen Text */}
                <button
                  onClick={handleResetView}
                  className="text-white/80 text-sm hover:text-white transition-colors"
                  title="Fit to screen"
                >
                  Fit to Screen
                </button>
                
                {/* Zoom Out Button */}
                 <button
                   onClick={handleZoomOut}
                   className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-all"
                   title="Zoom out"
                 >
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                     <path d="M21 21L16.514 16.506M19 10.5C19 15.194 15.194 19 10.5 19S2 15.194 2 10.5 5.806 2 10.5 2 19 5.806 19 10.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                     <path d="M8 10.5H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                   </svg>
                 </button>
                 
                 {/* Zoom Percentage */}
                 <span className="text-white/80 text-sm font-mono min-w-[3rem] text-center">
                   {Math.round(scale * 100)}%
                 </span>
                 
                 {/* Zoom In Button */}
                 <button
                   onClick={handleZoomIn}
                   className="w-6 h-6 flex items-center justify-center text-white/70 hover:text-white transition-all"
                   title="Zoom in"
                 >
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                     <path d="M21 21L16.514 16.506M19 10.5C19 15.194 15.194 19 10.5 19S2 15.194 2 10.5 5.806 2 10.5 2 19 5.806 19 10.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                     <path d="M10.5 8V13M8 10.5H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                   </svg>
                 </button>
                
                {/* Controls Text */}
                <button
                  onClick={() => setShowControlsDropdown(!showControlsDropdown)}
                  className="text-white/80 text-sm hover:text-white transition-colors relative"
                  title="Show controls help"
                >
                  Controls
                  <svg 
                    width="12" 
                    height="12" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    className={`inline ml-1 transition-transform ${showControlsDropdown ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              
              {/* Controls Dropdown */}
              {showControlsDropdown && (
                <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg p-4 w-80 shadow-2xl">
                  <h3 className="text-white text-sm font-medium mb-3">Canvas Controls</h3>
                  
                  <div className="space-y-3">
                    {/* Pan Control */}
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Pan canvas</span>
                      <div className="flex items-center gap-1">
                        <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white/80">Space</kbd>
                        <span className="text-white/60 text-xs">+ Drag</span>
                      </div>
                    </div>
                    
                    {/* Zoom Control */}
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Zoom</span>
                      <div className="flex items-center gap-1">
                        <span className="text-white/60 text-xs">Mouse wheel</span>
                      </div>
                    </div>
                    
                    {/* Video Controls */}
                    <div className="flex items-center justify-between">
                      <span className="text-white/70 text-sm">Play/Pause</span>
                      <div className="flex items-center gap-1">
                        <kbd className="px-2 py-1 bg-white/10 rounded text-xs font-mono text-white/80">Space</kbd>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Video Controls Bar */}
          {videoObj && (
            <div 
              className={`absolute bottom-4 left-1/2 z-[8001] transition-all duration-300 ease-out ${
                !uiVisibility.videoControls 
                  ? 'transform -translate-x-1/2 translate-y-full opacity-0' 
                  : 'transform -translate-x-1/2 translate-y-0 opacity-100'
              }`}
              onMouseEnter={() => setIsHoveringUI(true)}
              onMouseLeave={() => setIsHoveringUI(false)}
            >
              <div className="bg-black/70 backdrop-blur-md border border-white/20 rounded-lg px-4 py-2 flex items-center gap-4">
                {/* Play/Pause */}
                <button
                  onClick={togglePlayPause}
                  className="text-white/70 hover:text-white transition-colors"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
                
                {/* Time display */}
                <span className="text-white/80 text-sm font-mono">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                
                {/* Volume */}
                <button
                  onClick={toggleMute}
                  className="text-white/70 hover:text-white transition-colors"
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VideoCanvasViewer;
