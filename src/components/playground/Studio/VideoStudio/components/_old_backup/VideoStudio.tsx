import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Send, Paperclip, Settings, Palette, History, 
  Plus, X, Trash2, Edit3, Copy, ThumbsUp, ThumbsDown,
  Download, Upload, FolderOpen, Cloud, HardDrive,
  Shuffle, Sliders, Image as ImageIcon, Type, Film,
  Play, Scissors, Paintbrush, RotateCw, Maximize2, TrendingUp,
  ChevronDown, StopCircle, Link, FileClock, Clock,
  FileText, Mic, Users, Calendar, Grid, List, Save,
  RefreshCw, ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
  ZoomIn, ZoomOut, RotateCcw, FlipHorizontal, FlipVertical,
  Eye, EyeOff, Layers, Square, Circle, Triangle, Star,
  Brush, Eraser, Lasso, Wand, Pipette, Ruler,
  Crop, Move, Hand, Crosshair, Filter, Contrast, Search,
  PaintBucket
} from 'lucide-react';

// Import types and utilities from our modular structure
import { VideoFile } from '../../core/types';
import { FullScreenVideoViewer } from '../FullScreenVideoViewer';
import { OptimizedVideo } from '../OptimizedVideo';
import { HistoryModal, HistoryPanel, DeleteConfirmationModal } from '../HistoryModal';
import { ChatMessages } from '../ChatMessages';
import { useConversationHistory } from '../../hooks/useConversationHistory';
import { useVideoStudio } from '../../hooks/useVideoStudio';
import VideoCanvasViewer from '../../Canvas/VideoCanvasViewer';
import { SidePanel, RightPanel, BottomPanel } from '../../Panels';
import RightPanelTabs from '../../Panels/RightPanel/RightPanelTabs';
import VideoTimeline from '../VideoTimeline';
import { videoStudioService, VideoProject } from '../../../../../../services/videoStudioService';
import { authService } from '../../../../../../services/authService';
import ProjectManager from '../ProjectManager';
import ProjectCreationModal, { ProjectSettings, SequenceSettings, WorkflowSettings } from '../ProjectCreationModal';

const VideoStudio: React.FC = () => {
  const navigate = useNavigate();

  console.log('🎬 VideoStudio component rendering');

  // Extract ALL state variables to match ImageStudio structure
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<any[]>([]);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isRecentFilesOpen, setIsRecentFilesOpen] = useState(false);
  const [recentFiles, setRecentFiles] = useState<any[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStyleModalOpen, setIsStyleModalOpen] = useState(false);
  const [messages, setMessages] = useState<{ id: string; type: 'user' | 'assistant'; content: string; timestamp: Date; videoData?: { src: string; thumbnail?: string; duration?: number } }[]>([]);
  const [styleReferenceVideo, setStyleReferenceVideo] = useState<File | null>(null);
  const [styleVideoPreview, setStyleVideoPreview] = useState<string | null>(null);
  
  // New state for advanced chat functionality
  const [showThinkingId, setShowThinkingId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [feedbackStatusMap, setFeedbackStatusMap] = useState<Record<string, 'liked' | 'disliked' | null>>({});

  // Full-screen video viewer state
  const [isFullScreenVideoOpen, setIsFullScreenVideoOpen] = useState(false);
  const [fullScreenVideoUrl, setFullScreenVideoUrl] = useState<string | null>(null);
  const [viewerShowsDownloadButton, setViewerShowsDownloadButton] = useState(false);
  
  // Video editing state
  const [videoEditText, setVideoEditText] = useState('');
  const [showEditTools, setShowEditTools] = useState(false);
  const [isAnimatingTools, setIsAnimatingTools] = useState(false);
  const [isClosingTools, setIsClosingTools] = useState(false);
  const [selectedEditMode, setSelectedEditMode] = useState<'trim' | 'resize' | 'enhance' | 'background' | 'adjust' | null>(null);

  // Tool preview state
  const [hoveredTool, setHoveredTool] = useState<string | null>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Panel state
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [sidePanelMinimized, setSidePanelMinimized] = useState(false);
  const [rightPanelMinimized, setRightPanelMinimized] = useState(false);
  const [bottomPanelMinimized, setBottomPanelMinimized] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(300);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  const previewDragState = useRef<{ isDragging: boolean; offsetX: number; offsetY: number }>({
    isDragging: false,
    offsetX: 0,
    offsetY: 0
  });
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number }>({ x: 32, y: 64 });
  const [previewWidth, setPreviewWidth] = useState<number>(640);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  useEffect(() => {
    const handleResize = () => {
      const maxWidth = Math.min(960, Math.max(360, window.innerWidth - 64));
      setPreviewWidth(maxWidth);
      setPreviewPosition((prev) => {
        const panelWidth = previewPanelRef.current?.offsetWidth ?? maxWidth;
        const panelHeight = previewPanelRef.current?.offsetHeight ?? 260;
        const maxX = Math.max(16, window.innerWidth - panelWidth - 16);
        const maxY = Math.max(72, window.innerHeight - panelHeight - 16);
        const nextX = Math.min(Math.max(prev.x, 16), maxX);
        const nextY = Math.min(Math.max(prev.y, 72), maxY);
        if (nextX === prev.x && nextY === prev.y) {
          return prev;
        }
        return { x: nextX, y: nextY };
      });
    };

    if (typeof window !== 'undefined') {
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  useEffect(() => {
    if (!isCanvasOpen) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!previewDragState.current.isDragging) return;
      if (event.cancelable) {
        event.preventDefault();
      }

      const panelWidth = previewPanelRef.current?.offsetWidth ?? previewWidth;
      const panelHeight = previewPanelRef.current?.offsetHeight ?? 260;
      const maxX = Math.max(16, window.innerWidth - panelWidth - 16);
      const maxY = Math.max(72, window.innerHeight - panelHeight - 16);
      const nextX = Math.min(Math.max(event.clientX - previewDragState.current.offsetX, 16), maxX);
      const nextY = Math.min(Math.max(event.clientY - previewDragState.current.offsetY, 72), maxY);
      setPreviewPosition((prev) => {
        if (nextX === prev.x && nextY === prev.y) {
          return prev;
        }
        return { x: nextX, y: nextY };
      });
    };

    const handleMouseUp = () => {
      handlePreviewDragEnd();
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isCanvasOpen, previewWidth]);
  
  // Panel z-index management
  const [panelZIndices, setPanelZIndices] = useState({
    side: 1000,
    right: 1001,
    bottom: 1002
  });
  const [topPanel, setTopPanel] = useState<'side' | 'right' | 'bottom'>('bottom');

  // Refs for UI elements
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const recentFilesPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const styleModalRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const canvasButtonRef = useRef<HTMLButtonElement>(null);
  const canvasModalRef = useRef<HTMLDivElement>(null);
  const canvasFileInputRef = useRef<HTMLInputElement>(null);
  const canvasActionMenuRef = useRef<HTMLDivElement>(null);

  // Video Studio specific state
  const [selectedModel, setSelectedModel] = useState('seedance-1.0');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  // Canvas modal state
  const [isCanvasModalOpen, setIsCanvasModalOpen] = useState(false);
  const [canvasModalPosition, setCanvasModalPosition] = useState({ x: 0, y: 0 });
  const [seed, setSeed] = useState('');
  const [guidanceScale, setGuidanceScale] = useState(7.5);
  const [isCanvasActionMenuOpen, setIsCanvasActionMenuOpen] = useState(false);

  // Project Compose Settings modal state
  const [isProjectSettingsOpen, setIsProjectSettingsOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('Untitled Project');
  const [projectWidth, setProjectWidth] = useState(1920);
  const [projectHeight, setProjectHeight] = useState(1080);
  const [projectFps, setProjectFps] = useState(24);
  const [projectDurationSec, setProjectDurationSec] = useState(10);
  const [hasCanvasProject, setHasCanvasProject] = useState(false);
  
  // Backend integration state
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);

  // Selected clip state for Effect Controls
  const [selectedClipId, setSelectedClipId] = useState<string | undefined>(undefined);
  const [selectedClipName, setSelectedClipName] = useState<string | undefined>(undefined);
  const [selectedClipEffects, setSelectedClipEffects] = useState<any[]>([]);

  // Corner radius coordination: Outer (input container) ≈ Inner (modals) + padding
  const [outerCornerRadiusPx, setOuterCornerRadiusPx] = useState<number>(16);
  const [innerCornerRadiusPx, setInnerCornerRadiusPx] = useState<number>(12);

  // Load user credits on mount
  useEffect(() => {
    const user = authService.getCurrentUser();
    if (user) {
      setUserCredits(user.credits);
    }
  }, []);

  // Persist a new video chat session in localStorage similar to ImageStudio
  const createNewVideoSession = (sessionMessages: typeof messages, settings?: any) => {
    try {
      const historyKey = 'videoStudioHistory';
      const now = Date.now();
      const firstUser = sessionMessages.find(m => m.type === 'user');
      const defaultTitle = firstUser?.content?.slice(0, 50) || projectTitle || 'New Video Project';
      const projectSettings = {
        title: projectTitle,
        width: projectWidth,
        height: projectHeight,
        fps: projectFps,
        duration: projectDurationSec
      };
      const newSession = {
        id: `video-session-${now}-${Math.random().toString(36).substr(2, 9)}`,
        title: settings?.title || defaultTitle,
        timestamp: now,
        messages: [...sessionMessages],
        settings: { ...settings, project: projectSettings }
      } as any;
      let historyArr: any[] = [];
      const existing = localStorage.getItem(historyKey);
      if (existing) {
        try { historyArr = JSON.parse(existing); } catch { historyArr = []; }
      }
      historyArr = [newSession, ...historyArr];
      localStorage.setItem(historyKey, JSON.stringify(historyArr));
    } catch (err) {
      console.error('Failed to create video session:', err);
    }
  };
  
  // Video Canvas state
  const [canvasVideoUrl, setCanvasVideoUrl] = useState<string | null>(null);
  const [canvasVideoFile, setCanvasVideoFile] = useState<File | null>(null);
  const [steps, setSteps] = useState(50);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [fps, setFps] = useState(24);
  const [quality, setQuality] = useState('high');
  // Control requests to overlay canvas video
  const [controlRequest, setControlRequest] = useState<{ type: 'togglePlay' | 'play' | 'pause' | 'skip' | 'seekTo' | 'goToStart' | 'goToEnd'; value?: number; requestId: number } | null>(null);
  const controlCounterRef = useRef(0);
  // Timeline state (videos on the timeline and current time)
  const [assetLibrary, setAssetLibrary] = useState<VideoFile[]>([]);
  const [timelineSnapshot, setTimelineSnapshot] = useState<{ tracks: any[]; currentTime: number; duration: number } | null>(null);
  const [canvasCurrentTime, setCanvasCurrentTime] = useState(0);
  const [canvasDuration, setCanvasDuration] = useState(0);

  const aspectShape = useMemo(() => {
    if (projectWidth > 0 && projectHeight > 0) {
      return { width: projectWidth, height: projectHeight };
    }
    const parts = aspectRatio.split(':').map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (parts.length === 2) {
      return { width: parts[0], height: parts[1] };
    }
    return { width: 16, height: 9 };
  }, [projectWidth, projectHeight, aspectRatio]);

  const displayAspectLabel = useMemo(() => {
    if (projectWidth > 0 && projectHeight > 0) {
      return `${projectWidth}:${projectHeight}`;
    }
    return aspectRatio;
  }, [projectWidth, projectHeight, aspectRatio]);

  const previewResolutionLabel = useMemo(() => {
    if (projectWidth > 0 && projectHeight > 0) {
      return `${projectWidth}×${projectHeight}px`;
    }
    return `${aspectShape.width}:${aspectShape.height}`;
  }, [projectWidth, projectHeight, aspectShape]);

  const computeActiveVideoSource = useCallback(() => {
    if (!timelineSnapshot) return '';
    const videoTracks = (timelineSnapshot.tracks || []).filter((track: any) => track.type === 'video');
    const activeTrack = videoTracks[0];
    if (!activeTrack || !Array.isArray(activeTrack.clips) || activeTrack.clips.length === 0) {
      return '';
    }
    const currentTime = timelineSnapshot.currentTime ?? 0;
    const coveringClip = activeTrack.clips.find((clip: any) => {
      if (!clip) return false;
      const clipStart = clip.trackStartTime ?? 0;
      const clipDuration = (clip.endTime ?? 0) - (clip.startTime ?? 0);
      return currentTime >= clipStart && currentTime <= clipStart + clipDuration;
    });
    const clip = coveringClip || activeTrack.clips[0];
    if (!clip) return '';
    const asset = assetLibrary.find((item) => item.id === clip.videoId);
    return asset?.url || '';
  }, [timelineSnapshot, assetLibrary]);

  const previewVideoSrc = useMemo(() => {
    if (canvasVideoUrl) {
      return canvasVideoUrl;
    }
    return computeActiveVideoSource();
  }, [canvasVideoUrl, computeActiveVideoSource]);
  
  const resetToDefaultInterface = () => {
    setIsCanvasOpen(false);
    setIsCanvasActionMenuOpen(false);
    setIsCanvasModalOpen(false);
    setIsProjectSettingsOpen(false);
    if (canvasVideoUrl && canvasVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(canvasVideoUrl);
    }
    setCanvasVideoUrl(null);
    setCanvasVideoFile(null);
    setTimelineSnapshot(null);
    setCanvasCurrentTime(0);
    setCanvasDuration(0);
    setAssetLibrary([]);
    setControlRequest(null);
    setHasCanvasProject(false);
    setCurrentProject(null);
    setProjectTitle('Untitled Project');
    setProjectWidth(1920);
    setProjectHeight(1080);
    setProjectFps(24);
    setProjectDurationSec(10);
    setSteps(50);
    setAspectRatio('16:9');
    setDuration(5);
    setFps(24);
    setQuality('high');
    setRenderJobId(null);
    setRenderProgress(0);
    setIsSavingProject(false);
    setMessages([]);
    setIsHistoryOpen(false);
    setIsSidePanelOpen(true);
    setIsRightPanelOpen(true);
    setIsBottomPanelOpen(true);
    setSidePanelMinimized(false);
    setRightPanelMinimized(false);
    setBottomPanelMinimized(false);
    setIsProjectManagerOpen(false);
  };

  // Auto-save project on timeline changes (debounced)
  useEffect(() => {
    if (currentProject && timelineSnapshot) {
      const debounceTimer = setTimeout(async () => {
        setIsSavingProject(true);
        const result = await videoStudioService.updateProject(currentProject.id, {
          timeline_data: timelineSnapshot,
          duration: canvasDuration
        });
        setIsSavingProject(false);

        if (result.success) {
          console.log('✅ Project auto-saved');
        } else {
          console.error('❌ Auto-save failed:', result.error);
        }
      }, 2000);

      return () => clearTimeout(debounceTimer);
    }
  }, [timelineSnapshot, currentProject, canvasDuration]);

  // Video playback state
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const mainVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoEl = mainVideoRef.current;
    if (!videoEl) return;
    if (isVideoPlaying) {
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } else {
      videoEl.pause();
    }
  }, [isVideoPlaying]);

  useEffect(() => {
    const videoEl = mainVideoRef.current;
    if (!videoEl) return;
    if (!Number.isFinite(canvasCurrentTime)) return;
    if (Math.abs(videoEl.currentTime - canvasCurrentTime) > 0.05) {
      videoEl.currentTime = canvasCurrentTime;
    }
  }, [canvasCurrentTime]);
  
  // Style state
  const [savedStyle, setSavedStyle] = useState<{
    type: 'video' | 'prompt' | 'preset';
    content: string;
    name: string;
  } | null>(null);
  const [activeStyleTab, setActiveStyleTab] = useState<'video' | 'prompt' | 'preset'>('video');
  const [stylePromptText, setStylePromptText] = useState('');
  const [selectedStylePreset, setSelectedStylePreset] = useState<string | null>(null);

  // History state variables
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [generationHistory, setGenerationHistory] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleText, setEditTitleText] = useState('');
  const [deleteConfirmationModal, setDeleteConfirmationModal] = useState({
    isOpen: false,
    sessionId: null as string | null,
    sessionTitle: null as string | null
  });
  const [projectHistory, setProjectHistory] = useState<VideoProject[]>([]);
  const [isProjectHistoryLoading, setIsProjectHistoryLoading] = useState(false);
  const [projectHistoryError, setProjectHistoryError] = useState<string | null>(null);

  const loadProjectHistory = useCallback(async () => {
    setIsProjectHistoryLoading(true);
    setProjectHistoryError(null);
    try {
      const result = await videoStudioService.getProjects({ limit: 50, offset: 0 });
      if (result.success && result.projects) {
        setProjectHistory(result.projects);
      } else if (result.error) {
        setProjectHistoryError(result.error);
      }
    } catch (error) {
      console.error('Failed to load project history:', error);
      setProjectHistoryError('Failed to load project history');
    } finally {
      setIsProjectHistoryLoading(false);
    }
  }, []);

  // History hook - now properly implemented
  const historyHook = {
    isHistoryOpen,
    generationHistory,
    activeSessionId,
    historySearchTerm,
    editingSessionId,
    editTitleText,
    deleteConfirmationModal,
    setHistorySearchTerm,
    toggleHistory: () => setIsHistoryOpen(!isHistoryOpen),
    handleLoadSession: (sessionId: string) => {
      setActiveSessionId(sessionId);
      // Add logic to load session data
    },
    setEditingSessionId,
    setEditTitleText,
    handleSaveSessionTitle: () => {
      // Add logic to save session title
      setEditingSessionId(null);
      setEditTitleText('');
    },
    handleCancelDelete: () => {
      setDeleteConfirmationModal({
        isOpen: false,
        sessionId: null,
        sessionTitle: null
      });
    },
    handleDeleteSession: (sessionId: string) => {
      // Add logic to delete session
      setGenerationHistory(prev => prev.filter(session => session.id !== sessionId));
      setDeleteConfirmationModal({
        isOpen: false,
        sessionId: null,
        sessionTitle: null
      });
    },
    handleDeleteMultipleSessions: (sessionIds: string[]) => {
      // Add logic to delete multiple sessions
      setGenerationHistory(prev => prev.filter(session => !sessionIds.includes(session.id)));
    },
    setDeleteConfirmationModal
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight + 5, 155)}px`;
    }
  }, [inputValue]);

  // Calculate corner radii based on actual computed style of the main input container
  useEffect(() => {
    const updateRadii = () => {
      const el = inputContainerRef.current;
      if (!el) return;
      const styles = window.getComputedStyle(el);
      const tl = parseFloat(styles.borderTopLeftRadius || '16');
      // Treat padding as a small design offset of 4px to avoid equality
      const paddingPx = 4;
      const outerPx = isNaN(tl) ? 16 : tl;
      const innerPx = Math.max(0, outerPx - paddingPx);
      setOuterCornerRadiusPx(outerPx);
      setInnerCornerRadiusPx(innerPx);
    };
    updateRadii();
    window.addEventListener('resize', updateRadii);
    return () => window.removeEventListener('resize', updateRadii);
  }, []);

  // Handle generate function
  const handleGenerate = async () => {
    if (!inputValue.trim() || isGenerating) return;
    
    setIsGenerating(true);
    
    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: inputValue,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setAttachedFiles([]);
    
    try {
      // Simulate video generation
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const assistantMessage = {
        id: (Date.now() + 1).toString(),
        type: 'assistant' as const,
        content: 'Here\'s your generated video:',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle file upload
  const handleUploadFile = () => {
    fileInputRef.current?.click();
    setIsAttachMenuOpen(false);
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      // Only allow image files
      if (!file.type.startsWith('image/')) {
        console.warn(`File ${file.name} is not an image and will be skipped.`);
        return;
      }

      const attachedFile = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: file.type,
        fileObject: file
      };
      setAttachedFiles(prev => [...prev, attachedFile]);
    });
  };

  // Toggle functions
  const toggleAttachMenu = () => {
    setIsAttachMenuOpen(!isAttachMenuOpen);
    setIsRecentFilesOpen(false);
  };

  const toggleSettingsMenu = () => {
    setIsSettingsOpen(!isSettingsOpen);
  };

  const toggleStyleModal = () => {
    setIsStyleModalOpen(!isStyleModalOpen);
  };

  const toggleHistory = () => {
    const nextOpen = !isHistoryOpen;
    setIsHistoryOpen(nextOpen);
    if (nextOpen) {
      loadProjectHistory();
    }
  };

  // Generate random seed
  const generateRandomSeed = () => {
    setSeed(Math.floor(Math.random() * 1000000).toString());
  };

  // Handle model selection
  const handleModelSelect = (model: string) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  // Toggle model dropdown
  const toggleModelDropdown = () => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  };

  // Create canvas session function
  const createCanvasSession = (file: File) => {
    console.log('Creating canvas session with file:', file.name);
    
    // Create a temporary URL for the video file
    const tempVideoUrl = URL.createObjectURL(file);
    setCanvasVideoUrl(tempVideoUrl);
    setCanvasVideoFile(file);
    setIsCanvasOpen(true);
    // Close the upload modal when session starts
    setIsCanvasModalOpen(false);
    // Initialize timeline with this video placeholder (duration set after metadata loads)
    const initialVideo: VideoFile = {
      id: 'canvas-video',
      name: file.name,
      url: tempVideoUrl,
      duration: 0,
      size: file.size,
      format: file.type || 'video/mp4',
      resolution: { width: 0, height: 0 },
      createdAt: new Date()
    };
    // Add to media library, do not add to timeline yet
    setAssetLibrary(prev => [initialVideo, ...prev.filter(v => v.id !== initialVideo.id)]);

    // Create a new chat session for this upload
    const uploadMsg = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: `Uploaded video: ${file.name}`,
      timestamp: new Date(),
      videoData: { src: tempVideoUrl }
    };
    setMessages([uploadMsg]);
    createNewVideoSession([uploadMsg], { title: file.name });
  };

  // Panel z-index management
  const bringPanelToFront = (panelType: 'side' | 'right' | 'bottom') => {
    const maxZ = Math.max(...Object.values(panelZIndices));
    setPanelZIndices(prev => ({
      ...prev,
      [panelType]: maxZ + 1
    }));
    setTopPanel(panelType);
  };

  const issueControlRequest = (
    type: 'togglePlay' | 'play' | 'pause' | 'skip' | 'seekTo' | 'goToStart' | 'goToEnd',
    value?: number
  ) => {
    controlCounterRef.current += 1;
    setControlRequest({ type, value, requestId: controlCounterRef.current });
  };

  // Video playback controls
  const handlePlayPause = () => {
    issueControlRequest('togglePlay');
  };

  const handleSkipBackward = () => {
    issueControlRequest('skip', -10);
  };

  const handleSkipForward = () => {
    issueControlRequest('skip', 10);
  };

  // Panel handlers
  const handleSidePanelToggle = () => {
    if (isSidePanelOpen && !sidePanelMinimized) {
      setSidePanelMinimized(true);
    } else {
      setIsSidePanelOpen(true);
      setSidePanelMinimized(false);
      bringPanelToFront('side');
    }
  };

  const handleSidePanelClose = () => {
    setIsSidePanelOpen(false);
    setSidePanelMinimized(false);
  };

  const handleRightPanelToggle = () => {
    if (isRightPanelOpen && !rightPanelMinimized) {
      setRightPanelMinimized(true);
    } else {
      setIsRightPanelOpen(true);
      setRightPanelMinimized(false);
      bringPanelToFront('right');
    }
  };

  const handleRightPanelClose = () => {
    setIsRightPanelOpen(false);
    setRightPanelMinimized(false);
  };

  const handleBottomPanelToggle = () => {
    if (isBottomPanelOpen && !bottomPanelMinimized) {
      setBottomPanelMinimized(true);
    } else {
      setIsBottomPanelOpen(true);
      setBottomPanelMinimized(false);
      bringPanelToFront('bottom');
    }
  };

  const handleBottomPanelClose = () => {
    setIsBottomPanelOpen(false);
    setBottomPanelMinimized(false);
  };
  const handlePreviewDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isCanvasOpen || !previewPanelRef.current || event.button !== 0) return;
    const rect = previewPanelRef.current.getBoundingClientRect();
    previewDragState.current = {
      isDragging: true,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    document.body.style.userSelect = 'none';
  };
  const handlePreviewDragEnd = () => {
    previewDragState.current.isDragging = false;
    document.body.style.userSelect = '';
  };

  // Click outside handlers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close attach menu
      if (
        isAttachMenuOpen &&
        attachMenuRef.current &&
        !attachMenuRef.current.contains(event.target as Node) &&
        attachButtonRef.current &&
        !attachButtonRef.current.contains(event.target as Node)
      ) {
        setIsAttachMenuOpen(false);
        setIsRecentFilesOpen(false);
      }

      // Close settings menu
      if (
        isSettingsOpen &&
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setIsSettingsOpen(false);
      }

      // Close style modal
      if (
        isStyleModalOpen &&
        styleModalRef.current &&
        !styleModalRef.current.contains(event.target as Node) &&
        styleButtonRef.current &&
        !styleButtonRef.current.contains(event.target as Node)
      ) {
        setIsStyleModalOpen(false);
      }

      // Close model dropdown
      if (
        isModelDropdownOpen &&
        modelDropdownRef.current &&
        !modelDropdownRef.current.contains(event.target as Node) &&
        modelButtonRef.current &&
        !modelButtonRef.current.contains(event.target as Node)
      ) {
        setIsModelDropdownOpen(false);
      }

      // Close canvas modal
      if (
        isCanvasModalOpen &&
        event.target &&
        (event.target as Element).closest('.canvas-modal-content') === null
      ) {
        setIsCanvasModalOpen(false);
      }

      // Close canvas action popover menu
      if (
        isCanvasActionMenuOpen &&
        canvasActionMenuRef.current &&
        !canvasActionMenuRef.current.contains(event.target as Node) &&
        (!canvasButtonRef.current || !canvasButtonRef.current.contains(event.target as Node))
      ) {
        setIsCanvasActionMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAttachMenuOpen, isSettingsOpen, isStyleModalOpen, isModelDropdownOpen, isCanvasModalOpen, isCanvasActionMenuOpen]);

  const handleStartNewProject = () => {
    // Open centered Project Compose Settings modal
    setIsCanvasActionMenuOpen(false);
    setIsProjectSettingsOpen(true);
  };

  const handleUploadVideoToCanvas = () => {
    setIsCanvasActionMenuOpen(false);
    // Trigger hidden file input
    canvasFileInputRef.current?.click();
  };

  // Create project in backend with Canvas Settings
  const handleCreateCanvasProject = async (projectSettings: ProjectSettings, sequenceSettings: SequenceSettings, workflowSettings: WorkflowSettings) => {
    console.log('🚨 handleCreateCanvasProject called!');
    console.trace('Stack trace:');
    try {
      setIsCreatingProject(true);

      // Map professional settings to backend format
      const backendSettings = {
        title: projectSettings.name || 'Untitled Project',
        description: '',
        width: sequenceSettings.frameWidth,
        height: sequenceSettings.frameHeight,
        fps: sequenceSettings.timebase, // Use timebase as FPS
        duration: duration, // Keep the existing duration state for now
        quality: quality, // Keep existing quality state
        aspect_ratio: sequenceSettings.pixelAspectRatio,
        generation_steps: steps, // Keep existing steps state
        output_format: 'mp4' as const,
        // Store all professional settings in metadata
        project_metadata: {
          // Project Settings (Real Logic)
          colorSpace: projectSettings.colorSpace,
          workingColorDepth: projectSettings.workingColorDepth,
          targetResolutionTier: projectSettings.targetResolutionTier,
          playbackQuality: projectSettings.playbackQuality,
          importBehavior: projectSettings.importBehavior,
          fileOrganization: projectSettings.fileOrganization,
          workspaceLayout: projectSettings.workspaceLayout,
          masterSampleRate: projectSettings.masterSampleRate,
          masterBitDepth: projectSettings.masterBitDepth,
          // Sequence Settings
          editingMode: sequenceSettings.editingMode,
          pixelAspectRatio: sequenceSettings.pixelAspectRatio,
          fields: sequenceSettings.fields,
          channelFormat: sequenceSettings.channelFormat,
          numberOfChannels: sequenceSettings.numberOfChannels,
          sampleRate: sequenceSettings.sampleRate,
          previewFileFormat: sequenceSettings.previewFileFormat,
          codec: sequenceSettings.codec,
          previewWidth: sequenceSettings.previewWidth,
          previewHeight: sequenceSettings.previewHeight,
          maximumBitDepth: sequenceSettings.maximumBitDepth,
          maximumRenderQuality: sequenceSettings.maximumRenderQuality,
          compositeInLinearColor: sequenceSettings.compositeInLinearColor,
          // Workflow Settings
          workflowType: workflowSettings.workflowType,
          storage: workflowSettings.storage,
          ai: workflowSettings.ai,
          export: workflowSettings.export
        }
      };

      console.log('📝 Creating project with professional settings:', backendSettings);

      // Create project in backend
      const result = await videoStudioService.createProject(backendSettings);

      if (result.success && result.project) {
        const project = result.project;
        console.log('✅ Project created successfully!');
        console.log('📊 Project ID:', result.project.id);
        console.log('📊 Project from DB:', {
          title: result.project.title,
          width: result.project.width,
          height: result.project.height,
          fps: result.project.fps,
          duration: result.project.duration,
          quality: result.project.quality,
          aspect_ratio: result.project.aspect_ratio,
          generation_steps: result.project.generation_steps,
          output_format: result.project.output_format,
          timeline_data: result.project.timeline_data,
          metadata: result.project.project_metadata
        });

        setCurrentProject(result.project);
        setIsProjectSettingsOpen(false);
        setProjectHistory(prev => [project, ...prev.filter(existing => existing.id !== project.id)]);

        // Open canvas inline instead of navigating
        setHasCanvasProject(true);
        setIsCanvasOpen(true);

        // Create a new chat entry representing this project creation
        const newProjectMsg = {
          id: Date.now().toString(),
          type: 'user' as const,
          content: `Created project: ${result.project.title} (${result.project.width}x${result.project.height} @ ${result.project.fps}fps, ${result.project.duration}s)`,
          timestamp: new Date()
        };
        setMessages([newProjectMsg]);

        // Persist session to history
        createNewVideoSession([newProjectMsg], {
          title: result.project.title,
          width: result.project.width,
          height: result.project.height,
          fps: result.project.fps,
          duration: result.project.duration
        });

        console.log('🚀 Redirecting to canvas...');
      } else {
        console.error('❌ Failed to create project:', result.error);
        alert(`Failed to create project: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Project creation error:', error);
      alert('An error occurred while creating the project');
    } finally {
      setIsCreatingProject(false);
    }
  };

  // Save current project manually
  const handleSaveProject = async () => {
    if (!currentProject) return;

    setIsSavingProject(true);
    const result = await videoStudioService.updateProject(currentProject.id, {
      title: projectTitle,
      timeline_data: timelineSnapshot,
      width: projectWidth,
      height: projectHeight,
      fps: projectFps,
      duration: canvasDuration || projectDurationSec
    });
    setIsSavingProject(false);

    if (result.success) {
      setLastSavedTime(new Date());
      console.log('✅ Project saved manually');
    } else {
      console.error('❌ Save failed:', result.error);
      alert(`Failed to save project: ${result.error}`);
    }
  };

  // Start rendering
  const handleStartRender = async () => {
    if (!currentProject) {
      alert('No active project to render');
      return;
    }

    // Check if user is authenticated
    const user = authService.getCurrentUser();
    if (!user) {
      alert('Please login to render videos');
      return;
    }

    // Calculate estimated credits
    const estimatedCredits = videoStudioService.estimateCredits(currentProject);
    
    // Check if user has enough credits
    if (user.credits < estimatedCredits) {
      alert(`Insufficient credits. Need ${estimatedCredits} credits, you have ${user.credits} credits.`);
      return;
    }

    // Confirm with user
    const confirmed = window.confirm(
      `💰 RENDER VIDEO - This will use credits\n\n` +
      `Project: ${currentProject.title}\n` +
      `Duration: ${currentProject.duration}s @ ${currentProject.fps}fps\n` +
      `Resolution: ${currentProject.width}x${currentProject.height}\n` +
      `Quality: ${currentProject.quality}\n\n` +
      `💵 Credits needed: ${estimatedCredits}\n` +
      `💰 Your credits: ${user.credits}\n` +
      `💵 After render: ${user.credits - estimatedCredits} credits\n\n` +
      `✨ Note: Creating and editing is FREE. Only rendering costs credits.`
    );

    if (!confirmed) return;

    try {
      setIsGenerating(true);
      setRenderProgress(0);

      // Start render
      const result = await videoStudioService.startRender({
        project_id: currentProject.id,
        render_settings: {
          quality: currentProject.quality,
          format: currentProject.output_format
        }
      });

      if (result.success && result.job) {
        setRenderJobId(result.job.id);
        console.log('✅ Render started:', result.job.id);

        // Poll for progress
        videoStudioService.pollRenderStatus(
          result.job.id,
          (job) => {
            console.log(`📊 Render progress: ${job.progress}%`);
            setRenderProgress(job.progress);
            
            // Update UI with current frame info
            if (job.current_frame && job.total_frames) {
              console.log(`Frame ${job.current_frame}/${job.total_frames}`);
            }
          }
        ).then((completedJob) => {
          console.log('✅ Render completed:', completedJob.output_url);
          setRenderProgress(100);
          setIsGenerating(false);
          
          // Update user credits
          const updatedCredits = user.credits - (result.estimated_credits || 0);
          setUserCredits(updatedCredits);
          
          // Show success message
          alert(`Render complete! Video saved to: ${completedJob.output_url}`);
          
          // Optionally open the video
          if (completedJob.output_url) {
            setCanvasVideoUrl(completedJob.output_url);
          }
        }).catch((error) => {
          console.error('❌ Render failed:', error);
          setIsGenerating(false);
          alert(`Render failed: ${error.message}`);
        });
      } else {
        setIsGenerating(false);
        alert(`Failed to start render: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Render error:', error);
      setIsGenerating(false);
      alert('An error occurred while starting the render');
    }
  };

  // Cancel rendering
  const handleCancelRender = async () => {
    if (!renderJobId) return;

    const confirmed = window.confirm('Cancel rendering?');
    if (!confirmed) return;

    try {
      const result = await videoStudioService.cancelRender(renderJobId);
      if (result.success) {
        console.log('✅ Render cancelled');
        setIsGenerating(false);
        setRenderJobId(null);
        setRenderProgress(0);
      }
    } catch (error) {
      console.error('❌ Cancel failed:', error);
    }
  };

  // Load existing project
  const handleLoadProject = async (project: VideoProject) => {
    try {
      console.log('📂 Loading project:', project.title);

      // Set the current project and open canvas inline
      setCurrentProject(project);
      setHasCanvasProject(true);
      setIsCanvasOpen(true);

    } catch (error) {
      console.error('❌ Failed to load project:', error);
      alert('Failed to load project');
    }
  };

  // Extract the exact UI structure from ImageStudio
  return (
    <>
      {/* Dynamic Glowing Border Styles */}
      <style>{`
        .bento-card-container {
          position: relative;
        }
        
        .bento-card-container::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 1rem;
          padding: 2px;
          background: radial-gradient(
            circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
            rgba(255, 107, 53, 1) 0%,
            rgba(255, 107, 53, 0.3) 20%,
            transparent 50%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: exclude;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s ease;
          pointer-events: none;
          z-index: -1;
        }
        
        .bento-card-container:hover::before {
          opacity: 1;
        }

        /* Slider Styles */
        input[type="range"].slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          border: 2px solid #ffffff;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }

        input[type="range"].slider::-webkit-slider-track {
          height: 4px;
          border-radius: 2px;
          background: #4b5563;
          border: none;
        }
      `}</style>


  <div className={`w-full h-full flex flex-col relative ${isCanvasOpen ? 'pt-14' : ''}`}>
        {/* Floating Panel Controls - Only show when canvas is open */}
        {isCanvasOpen && (
          <>
            {/* Panel Toggle Controls */}
            <div className="fixed top-[4.5rem] right-4 z-[998] flex gap-2">
              <button
                onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}
                className={`p-2 rounded-lg border transition-all duration-200 ${
                  isSidePanelOpen 
                    ? 'bg-blue-600 border-blue-500 text-white' 
                    : 'bg-black/80 border-white/20 text-white/70 hover:text-white hover:bg-black/90'
                }`}
                title="Toggle Side Panel"
              >
                <Layers size={16} />
              </button>
              <button
                onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
                className={`p-2 rounded-lg border transition-all duration-200 ${
                  isRightPanelOpen 
                    ? 'bg-blue-600 border-blue-500 text-white' 
                    : 'bg-black/80 border-white/20 text-white/70 hover:text-white hover:bg-black/90'
                }`}
                title="Toggle Properties Panel"
              >
                <Settings size={16} />
              </button>
              <button
                onClick={() => setIsBottomPanelOpen(!isBottomPanelOpen)}
                className={`p-2 rounded-lg border transition-all duration-200 ${
                  isBottomPanelOpen 
                    ? 'bg-blue-600 border-blue-500 text-white' 
                    : 'bg-black/80 border-white/20 text-white/70 hover:text-white hover:bg-black/90'
                }`}
                title="Toggle Timeline Panel"
              >
                <Grid size={16} />
              </button>
            </div>

            {/* Render Controls - Top Left */}
            <div className="fixed top-[4.5rem] left-4 z-[998] flex gap-2">
              {/* Projects Button */}
              <button
                onClick={() => setIsProjectManagerOpen(true)}
                className="px-3 py-2 rounded-lg border bg-black/80 border-white/20 text-white/70 hover:text-white hover:bg-black/90 flex items-center gap-2"
                title="My Projects"
              >
                <FolderOpen size={16} />
                Projects
              </button>

              {/* Save Button */}
              <button
                onClick={handleSaveProject}
                disabled={!currentProject || isSavingProject}
                className="px-3 py-2 rounded-lg border bg-black/80 border-white/20 text-white/70 hover:text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                title="Save Project"
              >
                <Save size={16} />
                {isSavingProject ? 'Saving...' : 'Save'}
              </button>

              {/* Render Button */}
              {!isGenerating ? (
                <button
                  onClick={handleStartRender}
                  disabled={!currentProject}
                  className="px-4 py-2 rounded-lg border bg-gradient-to-r from-green-600 to-emerald-600 border-green-500 text-white hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold shadow-lg"
                  title="Render Video (Uses Credits)"
                >
                  <Play size={16} />
                  <span>Render</span>
                  <span className="text-xs opacity-75">(costs credits)</span>
                </button>
              ) : (
                <button
                  onClick={handleCancelRender}
                  className="px-4 py-2 rounded-lg border bg-red-600 border-red-500 text-white hover:bg-red-700 flex items-center gap-2 font-semibold"
                  title="Cancel Rendering"
                >
                  <StopCircle size={16} />
                  Cancel ({Math.floor(renderProgress)}%)
                </button>
              )}

              {/* Project Info */}
              {currentProject && (
                <div className="px-3 py-2 rounded-lg border bg-black/80 border-white/20 text-white/70 text-sm flex items-center gap-2">
                  <span className="text-white font-medium">{currentProject.title}</span>
                  <span className="text-white/40">•</span>
                  <span className="text-green-400 text-xs">✨ Editing FREE</span>
                  <span className="text-white/40">•</span>
                  <span>💰 {userCredits} credits</span>
                </div>
              )}
            </div>

            {/* Render Progress Bar */}
            {isGenerating && (
              <div className="fixed top-20 left-4 right-4 z-[998] max-w-md">
                <div className="bg-black/90 border border-white/20 rounded-lg p-4">
                  <div className="flex justify-between text-sm text-white mb-2">
                    <span>Rendering...</span>
                    <span>{Math.floor(renderProgress)}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-blue-500 h-full transition-all duration-300"
                      style={{ width: `${renderProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {isCanvasOpen ? null : messages.length === 0 ? (
          /* Centered Input Container - Initial State */
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-4xl px-4 relative">
              {/* Header Text */}
              <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-white mb-2">Xeno Studio</h1>
                <p className="text-lg text-white/70">Create and edit with AI</p>
              </div>

              {/* Main Input Container - Enhanced with CSS Variables and Accessibility */}
              <section 
                ref={inputContainerRef}
                className="
                  bg-[#19191a] border border-[#3a3a3d] rounded-2xl 
                  p-6 shadow-2xl relative
                  focus-within:border-[#4a4a4d] transition-colors duration-200
                "
                style={{
                  '--base-radius': '16px',
                  '--inner-radius': '8px', 
                  '--button-radius': '4px',
                  '--small-radius': '2px',
                  '--spacing-xs': '0.5rem',
                  '--spacing-sm': '0.75rem', 
                  '--spacing-md': '1rem',
                  '--spacing-lg': '1.5rem'
                } as React.CSSProperties}
                role="region"
                aria-label="Video generation interface"
              >
                {/* Style Reference and Attached Files Row */}
                {(savedStyle || attachedFiles.length > 0) && (
                  <div className="flex items-center gap-3 mb-6 flex-wrap">
                    {/* Style Reference Display */}
                    {savedStyle && (
                      <div className="flex items-center gap-1.5 relative group">
                        {savedStyle.type === 'video' ? (
                          <video 
                            src={savedStyle.content} 
                            className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                            onClick={() => {
                              setFullScreenVideoUrl(savedStyle.content);
                              setIsFullScreenVideoOpen(true);
                              setViewerShowsDownloadButton(false);
                            }}
                            aria-label="Style reference video"
                          />
                        ) : savedStyle.type === 'prompt' ? (
                          <div className="w-auto h-10 rounded flex items-center gap-1.5 px-3 bg-purple-600/20 border-2 border-purple-500/30 group-hover:border-purple-500/50 transition-colors duration-150 ease-in-out text-sm text-purple-200 cursor-pointer">
                            <Type size={16} className="text-purple-400" />
                            <span className="truncate max-w-32" title={savedStyle.content}>{savedStyle.name}</span>
                          </div>
                        ) : savedStyle.type === 'preset' ? (
                          <div className="w-auto h-10 rounded flex items-center gap-1.5 px-3 bg-blue-600/20 border-2 border-blue-500/30 group-hover:border-blue-500/50 transition-colors duration-150 ease-in-out text-sm text-blue-200 cursor-pointer">
                            <Palette size={16} className="text-blue-400" />
                            <span className="truncate" title={savedStyle.content}>{savedStyle.name}</span>
                          </div>
                        ) : null}
                        <button 
                          onClick={() => setSavedStyle(null)}
                          className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 transition-opacity duration-150 ease-in-out flex-shrink-0"
                          aria-label="Remove style reference"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  
                    {/* Attached Files */}
                    {attachedFiles.map((file) => (
                      <div 
                        key={file.id}
                        className="flex items-center gap-1.5 relative group"
                      >
                        {file.fileObject && file.type.startsWith('video/') ? (
                          <video 
                            src={URL.createObjectURL(file.fileObject)} 
                            className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                            aria-label={`Attached video: ${file.name}`}
                          />
                        ) : (
                          <div className="w-auto h-10 rounded flex items-center gap-1.5 px-3 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-sm text-gray-200 cursor-pointer">
                            <FileText size={16} className="text-blue-400" />
                            <span className="truncate" title={file.name}>{file.name}</span>
                          </div>
                        )}
                        <button 
                          onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                          className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 transition-opacity duration-150 ease-in-out flex-shrink-0"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Input Form */}
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (inputValue.trim() && !isGenerating) {
                    handleGenerate();
                  }
                }} className="space-y-4">
                  
                  {/* Textarea Container with Enhanced Accessibility */}
                  <div className="relative">
                    <label htmlFor="content-input" className="sr-only">
                      Describe what you want to create
                    </label>
                    <textarea
                      id="content-input"
                      ref={textareaRef}
                      placeholder="Describe what you want to create..."
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (inputValue.trim() && !isGenerating) {
                            handleGenerate();
                          }
                        }
                      }}
                      className="
                        w-full bg-transparent text-white placeholder-gray-400 
                        px-4 py-4 pr-14 
                        outline-none resize-none 
                        border border-transparent
                        focus:border-[#4a4a4d] focus:bg-[#1e1e1f]
                        transition-all duration-200
                        text-base leading-relaxed
                        scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent
                      "
                      style={{ 
                        minHeight: '3.5rem', 
                        maxHeight: '9.75rem',
                        borderRadius: 'var(--inner-radius, 8px)'
                      }}
                      disabled={isGenerating}
                      rows={1}
                      aria-describedby="content-input-help"
                    />
                    <div id="content-input-help" className="sr-only">
                      Press Enter to generate, Shift+Enter for new line
                    </div>
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleHistory();
                      }}
                      className={`
                        absolute top-3 right-3 p-2 
                        transition-all duration-200
                        ${historyHook.isHistoryOpen 
                          ? 'text-white bg-zinc-700/70 shadow-sm' 
                          : 'text-gray-400 hover:text-white hover:bg-zinc-700/30'
                        }
                      `}
                      style={{ borderRadius: 'var(--small-radius, 2px)' }}
                      aria-label="Toggle history panel"
                      aria-expanded={historyHook.isHistoryOpen}
                    >
                      <Clock size={18} />
                    </button>
                  </div>
                 
                  {/* Controls Row */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {/* Attach Button */}
                      <div className="relative">
                        <button 
                          type="button"
                          ref={attachButtonRef}
                          onClick={toggleAttachMenu}
                          className="
                            flex items-center justify-center 
                            bg-[#19191a] border border-[#3a3a3d] 
                            p-2.5 text-gray-300 
                            hover:border-gray-500 hover:text-white hover:bg-[#1e1e1f]
                            focus:border-gray-500 focus:text-white focus:outline-none
                            transition-all duration-200 shadow-sm
                          "
                          style={{ borderRadius: 'var(--button-radius, 4px)' }}
                          aria-label="Attach reference files"
                          aria-expanded={isAttachMenuOpen}
                          aria-haspopup="menu"
                        >
                          <ImageIcon size={16} />
                        </button>

                        {/* Attach Menu Modal */}
                        <div 
                          ref={attachMenuRef}
                          className={`
                            absolute bottom-full left-0 mb-2 z-30 
                            w-64 bg-[#19191a] border border-[#3a3a3d] shadow-xl 
                            transition-all duration-200 ease-out origin-bottom-left 
                            ${
                              isAttachMenuOpen 
                                ? 'opacity-100 scale-100 visible' 
                                : 'opacity-0 scale-95 invisible' 
                            }
                          `}
                          style={{ borderRadius: 'var(--base-radius, 16px)' }}
                        >
                          <div className="p-2 space-y-1">
                            <button 
                              type="button"
                              onClick={handleUploadFile} 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Upload size={18} />
                              <span>Upload an image</span>
                            </button>
                            <button 
                              type="button"
                              disabled 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Google Drive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                            <button 
                              type="button"
                              disabled 
                              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed text-left"
                              style={{ borderRadius: 'var(--button-radius, 4px)' }}
                            >
                              <Link size={18} className="text-gray-600" />
                              <span>Connect Microsoft OneDrive</span>
                              <span className="ml-auto text-xs text-gray-600">Soon</span>
                            </button>
                          </div>
                        </div>
                      </div>

                       {/* Canvas Button + Popover */}
                       <div className="relative">
                         <button
                          type="button"
                           ref={canvasButtonRef}
                          onClick={() => {
                            if (isCanvasOpen) {
                              resetToDefaultInterface();
                            } else if (hasCanvasProject) {
                              setIsCanvasOpen(true);
                              setIsCanvasActionMenuOpen(false);
                            } else {
                              setIsCanvasActionMenuOpen(prev => !prev);
                            }
                          }}
                          className="flex items-center gap-2 px-3 py-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg text-gray-300 hover:border-gray-500 hover:text-white transition-colors text-sm group"
                          title={isCanvasOpen ? 'Close Canvas' : (hasCanvasProject ? 'Open Canvas' : 'Canvas actions')}
                        >
                          <ImageIcon size={16} className="group-hover:scale-110 transition-transform" />
                          <span>Canvas</span>
                        </button>
                        {isCanvasActionMenuOpen && (
                          <div
                            ref={canvasActionMenuRef}
                            className="absolute bottom-full z-30 w-56 bg-[#19191a] border border-[#3a3a3d] shadow-xl"
                            style={{ 
                              borderRadius: `${innerCornerRadiusPx}px`, 
                              left: `${inputContainerRef.current && canvasButtonRef.current 
                                ? -(canvasButtonRef.current.getBoundingClientRect().left - inputContainerRef.current.getBoundingClientRect().left) + 5
                                : '-50px'
                              }px`,
                              height: `${inputContainerRef.current && canvasButtonRef.current 
                                ? (canvasButtonRef.current.getBoundingClientRect().top - inputContainerRef.current.getBoundingClientRect().top) - 10
                                : 'auto'
                              }px`,
                              marginBottom: '5px',
                              marginTop: '0px',
                              paddingTop: '0px'
                            }}
                          >
                            <div className="p-2 space-y-1">
                              <button type="button" onClick={handleStartNewProject} className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
                                <Plus size={18} />
                                <span>New Project</span>
                              </button>
                              <button type="button" onClick={handleUploadVideoToCanvas} className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
                                <Upload size={18} />
                                <span>Upload Video</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                   </div>

                   <div className="flex items-center gap-2">
                     {/* Model Selection Dropdown */}
                     <div className="relative">
                       <button 
                         ref={modelButtonRef}
                         onClick={toggleModelDropdown}
                         className="flex items-center gap-2 px-3 py-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg text-gray-300 hover:border-gray-500 hover:text-white transition-colors text-sm"
                       >
                         <span>{selectedModel === 'seedance-1.0' ? 'Seedance 1.0' : selectedModel === 'veo-3' ? 'Veo 3' : 'Kling 2.1'}</span>
                         <ChevronDown size={14} className={`transition-transform duration-200 ${isModelDropdownOpen ? 'rotate-180' : ''}`} />
                       </button>

                       {/* Model Dropdown */}
                       <div 
                         ref={modelDropdownRef}
                         className={`
                           absolute bottom-full left-0 mb-2 z-30 
                           w-40 bg-[#19191a] border border-[#3a3a3d] rounded-lg shadow-xl 
                           transition-all duration-200 ease-out origin-bottom-left 
                           ${isModelDropdownOpen 
                             ? 'opacity-100 scale-100 visible' 
                             : 'opacity-0 scale-95 invisible' 
                           }
                         `}
                       >
                         <div className="p-1">
                           <button 
                             onClick={() => handleModelSelect('seedance-1.0')}
                             className={`w-full flex items-center px-3 py-2 text-sm rounded-md text-left transition-colors ${
                               selectedModel === 'seedance-1.0' 
                                 ? 'bg-white text-black' 
                                 : 'text-gray-300 hover:bg-zinc-700/50'
                             }`}
                           >
                             Seedance 1.0
                           </button>
                           <button 
                             onClick={() => handleModelSelect('veo-3')}
                             className={`w-full flex items-center px-3 py-2 text-sm rounded-md text-left transition-colors ${
                               selectedModel === 'veo-3' 
                                 ? 'bg-white text-black' 
                                 : 'text-gray-300 hover:bg-zinc-700/50'
                             }`}
                           >
                             Veo 3
                           </button>
                           <button 
                             onClick={() => handleModelSelect('kling-2.1')}
                             className={`w-full flex items-center px-3 py-2 text-sm rounded-md text-left transition-colors ${
                               selectedModel === 'kling-2.1' 
                                 ? 'bg-white text-black' 
                                 : 'text-gray-300 hover:bg-zinc-700/50'
                             }`}
                           >
                             Kling 2.1
                           </button>
                         </div>
                       </div>
                     </div>

                     {/* Generate Button */}
                     <button 
                       onClick={handleGenerate}
                       disabled={!inputValue.trim() || isGenerating}
                       className="bg-white text-black px-4 py-2 font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center shadow-md"
                       style={{ borderRadius: 'var(--button-radius, 4px)' }}
                       aria-label="Generate video"
                     >
                       {isGenerating ? (
                         <>
                           <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
                           <span>Generating...</span>
                         </>
                       ) : (
                         <>
                           <Send size={16} className="mr-1.5" />
                           <span>Generate</span>
                         </>
                       )}
                     </button>
                   </div>
                 </div>
                </form>

                {/* History Panel - Dropdown below input container */}
                <HistoryPanel
                  isHistoryOpen={historyHook.isHistoryOpen}
                  sessions={historyHook.generationHistory}
                  activeSessionId={historyHook.activeSessionId}
                  searchTerm={historyHook.historySearchTerm}
                  onSearchChange={historyHook.setHistorySearchTerm}
                  onToggleHistory={historyHook.toggleHistory}
                  onLoadSession={historyHook.handleLoadSession}
                  editingSessionId={historyHook.editingSessionId}
                  editTitleText={historyHook.editTitleText}
                  onStartEdit={(sessionId, currentTitle) => {
                    historyHook.setEditingSessionId(sessionId);
                    historyHook.setEditTitleText(currentTitle);
                  }}
                  onSaveEdit={historyHook.handleSaveSessionTitle}
                  onCancelEdit={() => {
                    historyHook.setEditingSessionId(null);
                    historyHook.setEditTitleText('');
                  }}
                  onEditTitleChange={historyHook.setEditTitleText}
                  onDeleteSession={(sessionId, sessionTitle) => {
                    historyHook.setDeleteConfirmationModal({
                      isOpen: true,
                      sessionId,
                      sessionTitle
                    });
                  }}
                  onDeleteMultipleSessions={(sessionIds) => {
                    historyHook.handleDeleteMultipleSessions(sessionIds);
                  }}
                  projects={projectHistory}
                  isProjectLoading={isProjectHistoryLoading}
                  projectError={projectHistoryError}
                  onRefreshProjects={loadProjectHistory}
                  onSelectProject={(project) => {
                    handleLoadProject(project);
                    setIsHistoryOpen(false);
                  }}
                  position="below"
                />
               </section>
             </div>
            </div>
          ) : (
           /* Chat Interface - When messages exist */
           <div className="flex-1 flex flex-col">
             {/* Chat Messages */}
             <div className="flex-1 overflow-y-auto px-4 py-4">
                <ChatMessages messages={messages} isLoading={isGenerating} />
             </div>

              {/* Main Player + Input Area */}
              <div className="max-w-6xl mx-auto w-full px-4">
                {/* Center Main Video Player Container */}
                <div className="relative w-full aspect-video bg-black/70 border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                  <video
                    ref={mainVideoRef}
                    src={computeActiveVideoSource()}
                    className="w-full h-full object-contain bg-black"
                    onPlay={() => setIsVideoPlaying(true)}
                    onPause={() => setIsVideoPlaying(false)}
                    onLoadedMetadata={(e) => {
                      const el = e.currentTarget;
                      if (!Number.isNaN(el.duration) && Number.isFinite(el.duration)) {
                        // Inform timeline of true video duration via asset update
                        setAssetLibrary(prev => prev.map(a => a.id === 'canvas-video' ? { ...a, duration: el.duration } : a));
                        setCanvasDuration(el.duration);
                      }
                    }}
                    controls={false}
                  />
                  {/* Overlay controls hint (optional minimal) */}
                  <div className="absolute bottom-3 right-3 text-white/60 text-xs bg-black/40 px-2 py-1 rounded">
                    Space to Play/Pause (when focused)
                  </div>
                </div>
              </div>

              {/* Input Area - Bottom */}
             <div className="border-t border-[#3a3a3d] bg-[#0f0f10] p-4">
               <div className="max-w-4xl mx-auto">
                 {/* Style Reference and Attached Files Row */}
                 {(savedStyle || attachedFiles.length > 0) && (
                   <div className="flex items-center gap-2 mb-4 flex-wrap">
                     {/* Style Reference Display */}
                     {savedStyle && (
                       <div className="flex items-center gap-1.5 relative group p-0.5">
                         {savedStyle.type === 'video' ? (
                           <video 
                             src={savedStyle.content} 
                             className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                             onClick={() => {
                               setFullScreenVideoUrl(savedStyle.content);
                               setIsFullScreenVideoOpen(true);
                               setViewerShowsDownloadButton(false);
                             }}
                           />
                         ) : savedStyle.type === 'prompt' ? (
                           <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-purple-600/20 border-2 border-purple-500/30 group-hover:border-purple-500/50 transition-colors duration-150 ease-in-out text-sm text-purple-200 cursor-pointer">
                             <Type size={16} className="text-purple-400" />
                             <span className="truncate max-w-32" title={savedStyle.content}>{savedStyle.name}</span>
                           </div>
                         ) : savedStyle.type === 'preset' ? (
                           <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-blue-600/20 border-2 border-blue-500/30 group-hover:border-blue-500/50 transition-colors duration-150 ease-in-out text-sm text-blue-200 cursor-pointer">
                             <Palette size={16} className="text-blue-400" />
                             <span className="truncate" title={savedStyle.content}>{savedStyle.name}</span>
                           </div>
                         ) : null}
                         <button 
                           onClick={() => setSavedStyle(null)}
                           className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                           aria-label="Remove style"
                         >
                           <X size={12} />
                         </button>
                       </div>
                     )}
                   
                     {/* Attached Files */}
                     {attachedFiles.map((file) => (
                       <div 
                         key={file.id}
                         className="flex items-center gap-1.5 relative group p-0.5"
                       >
                         {file.fileObject && file.type.startsWith('video/') ? (
                           <video 
                             src={URL.createObjectURL(file.fileObject)} 
                             className="w-10 h-10 rounded object-cover flex-shrink-0 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out cursor-pointer"
                           />
                         ) : (
                           <div className="w-auto h-10 rounded flex items-center gap-1.5 px-2 bg-zinc-700/50 border-2 border-transparent group-hover:border-zinc-700 transition-colors duration-150 ease-in-out text-sm text-gray-200 cursor-pointer">
                             <FileText size={16} className="text-blue-400" />
                             <span className="truncate" title={file.name}>{file.name}</span>
                           </div>
                         )}
                         <button 
                           onClick={() => setAttachedFiles(prev => prev.filter(f => f.id !== file.id))}
                           className="w-5 h-5 flex items-center justify-center rounded-sm bg-zinc-700 hover:bg-zinc-600 text-white opacity-0 group-hover:opacity-100 absolute top-[-2px] right-[-2px] transition-opacity duration-150 ease-in-out flex-shrink-0"
                           aria-label="Remove file"
                         >
                           <X size={12} />
                         </button>
                       </div>
                     ))}
                   </div>
                 )}

                 {/* Input Container */}
                 <div 
                   ref={inputContainerRef}
                   className="bg-green-500 border border-[#3a3a3d] rounded-2xl p-4 relative"
                 >
                   {/* Textarea Row */}
                   <div className="flex items-end relative">
                     <textarea
                       ref={textareaRef}
                       placeholder="Continue the conversation..."
                       value={inputValue}
                       onChange={(e) => setInputValue(e.target.value)}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.shiftKey) {
                           e.preventDefault();
                           if (inputValue.trim() && !isGenerating) {
                             handleGenerate();
                           }
                         }
                       }}
                       className="w-full bg-transparent text-white placeholder-gray-400 pl-2 pr-10 py-2 outline-none resize-none flex-grow focus:ring-0 border-none focus:outline-none focus:shadow-none text-base scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent"
                       style={{ maxHeight: '155px' }}
                       disabled={isGenerating}
                     />
                     <button 
                       onClick={(e) => {
                         e.preventDefault();
                         e.stopPropagation();
                         toggleHistory();
                       }}
                       className={`absolute top-1 right-1 p-2 transition-colors ${
                         historyHook.isHistoryOpen 
                           ? 'text-white bg-zinc-700/50 rounded-md' 
                           : 'text-gray-400 hover:text-white'
                       }`}
                       aria-label="Toggle History"
                     >
                       <Clock size={18} />
                     </button>
                   </div>
                   
                   {/* Controls Row */}
                   <div className="flex items-center justify-between mt-3">
                     <div className="flex items-center gap-2 relative">
                       {/* Attach Button */}
                       <div className="relative">
                         <button 
                           ref={attachButtonRef}
                           onClick={toggleAttachMenu}
                           className="flex items-center justify-center bg-[#19191a] border border-[#3a3a3d] rounded-lg p-2 text-gray-300 hover:border-gray-500 hover:text-white transition-colors shadow-inner"
                           aria-label="Attach file"
                           title="Attach reference images"
                         >
                           <ImageIcon size={16} />
                         </button>

                         {/* Attach Menu Modal */}
                         <div 
                           ref={attachMenuRef}
                           className={`
                             absolute bottom-full left-0 mb-2 z-30 
                             w-64 bg-[#19191a] border border-[#3a3a3d] rounded-2xl shadow-xl 
                             transition-all duration-200 ease-out origin-bottom-left 
                             ${
                               isAttachMenuOpen 
                                 ? 'opacity-100 scale-100 visible' 
                                 : 'opacity-0 scale-95 invisible' 
                             }
                           `}
                         >
                           <div className="p-2 space-y-1">
                             <button onClick={handleUploadFile} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-300 hover:bg-zinc-700/50 rounded text-left">
                               <Upload size={18} />
                               <span>Upload an image</span>
                             </button>
                             <button disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed rounded text-left">
                               <Link size={18} className="text-gray-600" />
                               <span>Connect Google Drive</span>
                               <span className="ml-auto text-xs text-gray-600">Soon</span>
                             </button>
                             <button disabled className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-500 cursor-not-allowed rounded text-left">
                               <Link size={18} className="text-gray-600" />
                               <span>Connect Microsoft OneDrive</span>
                               <span className="ml-auto text-xs text-gray-600">Soon</span>
                             </button>
                           </div>
                         </div>
                       </div>

                      {/* Canvas Button + Popover */}
                      <div className="relative">
                        <button
                          ref={canvasButtonRef}
                          onClick={() => {
                            if (isCanvasOpen) {
                              resetToDefaultInterface();
                            } else if (hasCanvasProject) {
                              setIsCanvasOpen(true);
                              setIsCanvasActionMenuOpen(false);
                            } else {
                              setIsCanvasActionMenuOpen(prev => !prev);
                            }
                          }}
                          className="flex items-center gap-2 px-3 py-2 bg-[#19191a] border border-[#3a3a3d] rounded-lg text-gray-300 hover:border-gray-500 hover:text-white transition-colors text-sm"
                          title={isCanvasOpen ? 'Close Canvas' : (hasCanvasProject ? 'Open Canvas' : 'Canvas actions')}
                        >
                          <ImageIcon size={16} />
                          <span>Canvas</span>
                        </button>
                        {isCanvasActionMenuOpen && (
                          <div
                            ref={canvasActionMenuRef}
                            className="absolute bottom-full z-30 w-56 bg-[#19191a] border border-[#3a3a3d] shadow-xl"
                            style={{ 
                              borderRadius: `${innerCornerRadiusPx}px`, 
                              left: `${inputContainerRef.current && canvasButtonRef.current 
                                ? -(canvasButtonRef.current.getBoundingClientRect().left - inputContainerRef.current.getBoundingClientRect().left) + 5
                                : '-50px'
                              }px`,
                              height: `${inputContainerRef.current && canvasButtonRef.current 
                                ? (canvasButtonRef.current.getBoundingClientRect().top - inputContainerRef.current.getBoundingClientRect().top) - 10
                                : 'auto'
                              }px`,
                              marginBottom: '5px',
                              marginTop: '0px',
                              paddingTop: '0px'
                            }}
                          >
                            <div className="p-2 space-y-1">
                              <button onClick={handleStartNewProject} className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
                                <Plus size={18} />
                                <span>New Project</span>
                              </button>
                              <button onClick={handleUploadVideoToCanvas} className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-gray-300 hover:bg-zinc-700/50 rounded-md text-left">
                                <Upload size={18} />
                                <span>Upload Video</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                     </div>

                     {/* Generate Button */}
                     <button 
                       onClick={handleGenerate}
                       disabled={!inputValue.trim() || isGenerating}
                       className="bg-white text-black px-4 py-2 rounded-lg font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-10 flex items-center justify-center shadow-md"
                       aria-label="Generate video"
                     >
                       {isGenerating ? (
                         <>
                           <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-1.5" />
                           <span>Generating...</span>
                         </>
                       ) : (
                         <>
                           <Send size={16} className="mr-1.5" />
                           <span>Generate</span>
                         </>
                       )}
                     </button>
                   </div>
                 </div>
               </div>
             </div>
           </div>
         )}
       </div>

       {/* Hidden File Inputs */}
       <input 
         type="file" 
         ref={fileInputRef} 
         style={{ display: 'none' }} 
         accept="image/*"
         multiple
         onChange={handleFileSelected}
       />
       
       <input 
         type="file" 
         ref={styleFileInputRef} 
         style={{ display: 'none' }} 
         accept="image/*"
         onChange={(e) => {
           const file = e.target.files?.[0];
           if (file && file.type.startsWith('image/')) {
             setStyleReferenceVideo(file);
             setStyleVideoPreview(URL.createObjectURL(file));
           }
         }}
       />

       <input 
          type="file" 
          ref={canvasFileInputRef} 
          style={{ display: 'none' }} 
          accept="video/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && file.type.startsWith('video/')) {
              createCanvasSession(file);
            }
          }}
        />

       {/* Full Screen Video Viewer */}
        {/* FullScreen viewer temporarily disabled until types are aligned */}

       {/* Canvas Modal - Exact from ImageStudio */}
       {isCanvasModalOpen && (
         <div 
           className="fixed inset-0 z-[1000] bg-black/20"
           onClick={() => setIsCanvasModalOpen(false)}
         >
            <div 
              ref={canvasModalRef}
              className="canvas-modal-content bg-[#19191a] border border-[#3a3a3d] shadow-xl w-80 h-80 p-4"
             style={{
               position: 'fixed',
               left: `${canvasModalPosition.x}px`,
               top: `${canvasModalPosition.y - 320}px`, // Position above the button
                transform: 'none',
                borderRadius: `${innerCornerRadiusPx}px`
             }}
             onClick={(e) => e.stopPropagation()}
           >
             {/* Upload Area - Full Container */}
             <div 
               className="w-full h-full border-2 border-dashed border-[#3a3a3d] rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 transition-colors relative group"
                onClick={(e) => {
                 e.stopPropagation();
                 canvasFileInputRef.current?.click();
               }}
                role="button"
                tabIndex={0}
                aria-label="Upload video to canvas"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    canvasFileInputRef.current?.click();
                  }
                }}
               onDragOver={(e) => {
                 e.preventDefault();
                 e.stopPropagation();
               }}
               onDrop={(e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 const files = e.dataTransfer.files;
                 if (files.length > 0) {
                   const file = files[0];
                   if (file.type.startsWith('video/')) {
                     createCanvasSession(file);
                   }
                 }
               }}
             >
               {/* Close button in top-right corner */}
               <button
                 onClick={(e) => {
                   e.stopPropagation();
                   setIsCanvasModalOpen(false);
                 }}
                 className="absolute top-3 right-3 p-1.5 bg-black/70 rounded-full text-white/60 hover:text-white hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity z-10"
               >
                 <X size={16} />
               </button>
               
                <ImageIcon size={48} className="text-gray-400 mb-4" />
                 <h4 className="text-white font-medium text-lg mb-2">Upload Video</h4>
                 <p className="text-gray-400 text-sm text-center px-6 leading-relaxed">
                  Choose a video to open in the canvas editor where you can make adjustments and edits
                </p>
                 <p className="text-xs text-gray-500 mt-4">Click to browse or drag & drop a video</p>
             </div>
           </div>
         </div>
       )}

        {/* History modal temporarily disabled */}
       
       {/* Video Canvas Viewer */}
        <VideoCanvasViewer
          videoUrl={canvasVideoUrl}
          isOpen={isCanvasOpen}
          onClose={resetToDefaultInterface}
          onVideoUpdate={(newVideoUrl) => {
            setCanvasVideoUrl(newVideoUrl);
          }}
          onSidePanelToggle={handleSidePanelToggle}
          onRightPanelToggle={handleRightPanelToggle}
          onBottomPanelToggle={handleBottomPanelToggle}
          isSidePanelOpen={isSidePanelOpen}
          isRightPanelOpen={isRightPanelOpen}
          isBottomPanelOpen={isBottomPanelOpen}
          previewPosition={previewPosition}
          setPreviewPosition={setPreviewPosition}
          previewRef={previewPanelRef}
          previewWidth={previewWidth}
          setPreviewWidth={setPreviewWidth}
          controlRequest={controlRequest || undefined}
          onPlayStateChange={(playing) => setIsVideoPlaying(playing)}
          onTimeChange={(current, duration) => {
            setCanvasCurrentTime(current);
            if (duration && duration !== canvasDuration) {
              setCanvasDuration(duration);
              // Update asset in the library with true duration so timeline length matches video
              setAssetLibrary(prev => prev.map(a => a.id === 'canvas-video' ? { ...a, duration } : a));
            }
          }}
        />

       {/* Floating Panels - Only show when canvas is open */}
       {isCanvasOpen && (
         <>
           <div
            ref={previewPanelRef}
            className="fixed z-[1002] transition-transform duration-150 pointer-events-auto"
            style={{
              left: `${previewPosition.x}px`,
              top: `${previewPosition.y}px`,
              width: `${previewWidth}px`
            }}
           >
             <div className="bg-[#190707] border border-white/40 rounded-xl shadow-2xl w-full pointer-events-auto">
               <div
                className="px-4 py-3 border-b border-white/10 flex items-center justify-between select-none"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!isCanvasOpen) return;
                  bringPanelToFront('bottom');
                  handlePreviewDragStart(e);
                }}
                onMouseUp={() => handlePreviewDragEnd()}
                onMouseMove={(e) => {
                  if (!previewDragState.current.isDragging) return;
                  if (e.buttons === 0) {
                    handlePreviewDragEnd();
                    return;
                  }
                  const panelWidth = previewPanelRef.current?.offsetWidth ?? previewWidth;
                  const panelHeight = previewPanelRef.current?.offsetHeight ?? 260;
                  const maxX = Math.max(16, window.innerWidth - panelWidth - 16);
                  const maxY = Math.max(72, window.innerHeight - panelHeight - 16);
                  const nextX = Math.min(Math.max(e.clientX - previewDragState.current.offsetX, 16), maxX);
                  const nextY = Math.min(Math.max(e.clientY - previewDragState.current.offsetY, 72), maxY);
                  setPreviewPosition((prev) => {
                    if (prev.x === nextX && prev.y === nextY) {
                      return prev;
                    }
                    return { x: nextX, y: nextY };
                  });
                }}
               >
                 <h3 className="text-white text-sm font-medium">Canvas Preview</h3>
                 <div className="flex items-center gap-3 text-xs text-white/60">
                   <span className="uppercase tracking-wide bg-white/10 text-white/80 px-2 py-0.5 rounded">
                     {displayAspectLabel}
                   </span>
                   <span>{previewResolutionLabel}</span>
                   <span className="hidden sm:inline">•</span>
                   <span className="hidden sm:inline">{projectFps} fps</span>
                   <span className="hidden sm:inline">•</span>
                   <span className="hidden sm:inline">{Math.round(projectDurationSec)} s</span>
                 </div>
               </div>
               <div className="px-4 pb-4">
                 <div
                   className="relative w-full bg-[#050506] border border-white/30 rounded-lg overflow-hidden flex items-center justify-center"
                   style={{ aspectRatio: `${aspectShape.width} / ${aspectShape.height}` }}
                 >
                   {previewVideoSrc ? (
                     <video
                       key={previewVideoSrc}
                       ref={mainVideoRef}
                       src={previewVideoSrc}
                       className="h-full w-full object-contain bg-black"
                       playsInline
                       muted
                       preload="metadata"
                     />
                   ) : (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-2">
                       <Film size={36} className="opacity-60" />
                       <span className="text-sm">Canvas preview will appear here</span>
                       <span className="text-xs text-white/30 text-center">
                         Add at least one clip to your timeline or set a canvas reference video in settings
                       </span>
                     </div>
                   )}
                 </div>
               </div>
             </div>
           </div>
           {/* Side Panel */}
            <SidePanel
             isOpen={isSidePanelOpen && !sidePanelMinimized}
             onClose={handleSidePanelClose}
             onToggle={handleSidePanelToggle}
             position="left"
             title="Project Assets"
             zIndex={panelZIndices.side}
             onBringToFront={() => bringPanelToFront('side')}
             isOnTop={topPanel === 'side'}
             bottomPanelHeight={bottomPanelHeight}
             isBottomPanelOpen={isBottomPanelOpen && !bottomPanelMinimized}
              hideCloseButton={true}
              headerActions={(
                <>
                  <button
                    className="text-white/80 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                    title="Add media"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Open a file picker that accepts images/videos/audio
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'video/*,image/*,audio/*';
                      input.multiple = true;
                      input.onchange = () => {
                        const files = Array.from(input.files || []);
                        if (files.length === 0) return;
                        const assets: VideoFile[] = [] as any;
                        files.forEach((f) => {
                          const url = URL.createObjectURL(f);
                          const asset: VideoFile = {
                            id: `${f.type}-${f.name}-${Date.now()}`,
                            name: f.name,
                            url,
                            duration: 0,
                            size: f.size,
                            format: f.type,
                            resolution: { width: 0, height: 0 },
                            createdAt: new Date()
                          };
                          assets.push(asset);
                        });
                        setAssetLibrary(prev => [...assets, ...prev]);
                      };
                      input.click();
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </>
              )}
            >
              <div className="space-y-4" onDragOver={(e) => { e.preventDefault(); }}>
                <div className="text-white/70 text-sm">
                  <h4 className="font-medium mb-2">Media Library</h4>
                  {/* Auto-list uploaded canvas video */}
                  <div className="mt-2 space-y-2">
                    {assetLibrary.length > 0 ? (
                      assetLibrary.map((asset) => (
                        <div
                          key={asset.id}
                          className="flex items-center gap-2 p-2 bg-white/5 rounded border border-white/10 cursor-grab"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('application/x-xeno-asset', JSON.stringify({ id: asset.id }));
                          }}
                        >
                          <div className="w-10 h-6 bg-black/60 rounded-sm flex items-center justify-center text-[10px] text-white/60">{(asset.format || '').startsWith('audio') ? 'AUD' : (asset.format || '').startsWith('image') ? 'IMG' : 'VID'}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-white/90 text-xs truncate">{asset.name}</div>
                            <div className="text-white/50 text-[10px] truncate">{Math.round((asset.duration || 0))}s • {(asset.format || '').toUpperCase()}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-white/50 text-xs">No assets yet</div>
                    )}
                  </div>
                </div>
              </div>
            </SidePanel>

            {/* Right Panel */}
           <RightPanel
             isOpen={isRightPanelOpen && !rightPanelMinimized}
             onClose={handleRightPanelClose}
             onToggle={handleRightPanelToggle}
             title="Properties"
             zIndex={panelZIndices.right}
             onBringToFront={() => bringPanelToFront('right')}
             isOnTop={topPanel === 'right'}
             bottomPanelHeight={bottomPanelHeight}
             isBottomPanelOpen={isBottomPanelOpen && !bottomPanelMinimized}
            >
              <RightPanelTabs
                selectedClipId={selectedClipId}
                clipName={selectedClipName}
                clipEffects={selectedClipEffects}
                onEffectToggle={(effectId) => {
                  console.log('Toggle effect:', effectId);
                  // TODO: Implement effect toggle logic
                }}
                onEffectRemove={(effectId) => {
                  console.log('Remove effect:', effectId);
                  // TODO: Implement effect remove logic
                }}
                onParameterChange={(effectId, parameterId, value) => {
                  console.log('Parameter change:', effectId, parameterId, value);
                  // TODO: Implement parameter change logic
                }}
                onKeyframeAdd={(effectId, parameterId) => {
                  console.log('Add keyframe:', effectId, parameterId);
                  // TODO: Implement keyframe logic
                }}
              />
           </RightPanel>

           {/* Bottom Panel */}
           <BottomPanel
             isOpen={isBottomPanelOpen && !bottomPanelMinimized}
             onClose={handleBottomPanelClose}
             onToggle={handleBottomPanelToggle}
             title="Timeline"
             zIndex={panelZIndices.bottom}
             onBringToFront={() => bringPanelToFront('bottom')}
             isOnTop={topPanel === 'bottom'}
             onHeightChange={setBottomPanelHeight}
             isPlaying={isVideoPlaying}
             onPlayPause={handlePlayPause}
             onSkipBackward={handleSkipBackward}
             onSkipForward={handleSkipForward}
            >
              <div className="h-full w-full overflow-hidden">
                <VideoTimeline
                  videos={assetLibrary}
                  currentTime={canvasCurrentTime}
                  onTimeChange={(t) => {
                    issueControlRequest('seekTo', t);
                    setCanvasCurrentTime(t);
                  }}
                  onStateChange={(snapshot) => {
                    setTimelineSnapshot(snapshot);
                    // Update clip effects when timeline changes
                    if (selectedClipId) {
                      const selectedClip = snapshot.tracks
                        .flatMap(track => track.clips)
                        .find(clip => clip.id === selectedClipId);
                      if (selectedClip) {
                        setSelectedClipEffects(selectedClip.effects || []);
                      }
                    }
                  }}
                  projectDuration={projectDurationSec}
                  onClipSelect={(clipId, clipName) => {
                    if (clipId) {
                      setSelectedClipId(clipId);
                      setSelectedClipName(clipName);
                      // Find the clip in the timeline and get its effects
                      const clip = timelineSnapshot?.tracks
                        .flatMap(track => track.clips)
                        .find(c => c.id === clipId);
                      setSelectedClipEffects(clip?.effects || []);
                    } else {
                      setSelectedClipId(undefined);
                      setSelectedClipName(undefined);
                      setSelectedClipEffects([]);
                    }
                  }}
                  className="h-full"
                />
              </div>
           </BottomPanel>
         </>
       )}

        {/* Professional Project Creation Modal */}
        <ProjectCreationModal
          isOpen={isProjectSettingsOpen}
          onClose={() => setIsProjectSettingsOpen(false)}
          onCreateProject={handleCreateCanvasProject}
          isCreating={isCreatingProject}
        />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={historyHook.deleteConfirmationModal.isOpen}
        sessionId={historyHook.deleteConfirmationModal.sessionId}
        sessionTitle={historyHook.deleteConfirmationModal.sessionTitle}
        onConfirm={() => {
          if (historyHook.deleteConfirmationModal.sessionId) {
            historyHook.handleDeleteSession(historyHook.deleteConfirmationModal.sessionId);
          }
          historyHook.handleCancelDelete();
        }}
        onCancel={historyHook.handleCancelDelete}
      />

      {/* Project Manager Modal */}
      <ProjectManager
        isOpen={isProjectManagerOpen}
        onClose={() => setIsProjectManagerOpen(false)}
        onLoadProject={handleLoadProject}
      />
     </>
   );
 };

export default VideoStudio;
