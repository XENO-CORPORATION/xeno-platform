import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Save, FolderOpen, Play, StopCircle, Settings, Layers, Grid, Upload, X,
  SkipBack, SkipForward, ChevronLeft, ChevronRight, Pause
} from 'lucide-react';
import VideoStudioHeader from './VideoStudioHeader';
import EmbeddedCanvasViewer from '../Canvas/EmbeddedCanvasViewer';
import { LeftBottomPanelTabs, LeftTopPanelTabs, RightPanelTabs, RightPanel, BottomPanel } from '../Panels';
import VideoTimeline from './VideoTimeline';
import { videoStudioService, VideoProject } from '../../../../../services/videoStudioService';
import { authService } from '../../../../../services/authService';
import ProjectManager from './ProjectManager';
import { VideoFile } from '../core/types';

const StudioVideoCanvas: React.FC = () => {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();

  // Project state
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [userCredits, setUserCredits] = useState(0);
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false);

  // Panel state
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(true);
  const [sidePanelMinimized, setSidePanelMinimized] = useState(false);
  const [rightPanelMinimized, setRightPanelMinimized] = useState(false);
  const [bottomPanelMinimized, setBottomPanelMinimized] = useState(false);

  // Panel resize state
  const [leftPanelWidth, setLeftPanelWidth] = useState(420); // Effect Controls width
  const [projectBrowserWidth, setProjectBrowserWidth] = useState(600); // Project browser width (independent)
  const [rightPanelWidth, setRightPanelWidth] = useState(300); // Properties panel width
  const [bottomPanelHeight, setBottomPanelHeight] = useState(250); // Timeline height
  const [isResizing, setIsResizing] = useState<'left' | 'right' | 'bottom' | 'project' | null>(null);

  // Rendering state
  const [isGenerating, setIsGenerating] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);

  // Canvas state
  const [canvasVideoUrl, setCanvasVideoUrl] = useState<string | null>(null);
  const [canvasVideoFile, setCanvasVideoFile] = useState<File | null>(null);
  const [assetLibrary, setAssetLibrary] = useState<VideoFile[]>([]);
  const [timelineSnapshot, setTimelineSnapshot] = useState<{ tracks: any[]; currentTime: number; duration: number } | null>(null);
  const [canvasCurrentTime, setCanvasCurrentTime] = useState(0);
  const [canvasDuration, setCanvasDuration] = useState(0);
  const [canvasFps, setCanvasFps] = useState(30); // Default to 30fps

  // Playback controls state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackControlsHeight] = useState(48); // Fixed height for playback controls
  const [isEditingTimecode, setIsEditingTimecode] = useState(false);
  const [timecodeInput, setTimecodeInput] = useState('');

  // Close button state (similar to ImageStudio)
  const [showSaveButton, setShowSaveButton] = useState(false);
  const [showCheckmark, setShowCheckmark] = useState(false);
  const [isCloseDisabled, setIsCloseDisabled] = useState(false);
  const [saveCompleted, setSaveCompleted] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Compute active video source from timeline
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
      const startTime = clip.startTime ?? 0;
      const duration = clip.duration ?? 0;
      return currentTime >= startTime && currentTime < startTime + duration;
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

  // Load project on mount
  useEffect(() => {
    const loadProject = async () => {
      if (projectId) {
        console.log('🔄 Loading project:', projectId);
        const result = await videoStudioService.getProject(projectId);
        if (result.success && result.project) {
          console.log('✅ Project loaded from database:', {
            id: result.project.id,
            title: result.project.title,
            width: result.project.width,
            height: result.project.height,
            fps: result.project.fps,
            duration: result.project.duration,
            timeline_data: result.project.timeline_data
          });

          setCurrentProject(result.project);

          // Load FPS from project
          const projectFps = result.project.fps || 30;
          console.log('🎬 Setting canvas FPS to:', projectFps);
          setCanvasFps(projectFps);

          // Load timeline data and sync canvas time/duration
          if (result.project.timeline_data) {
            console.log('📋 Timeline data found:', result.project.timeline_data);
            setTimelineSnapshot(result.project.timeline_data);

            // Set canvas duration from project or timeline data (convert to number)
            const projectDuration = Number(result.project.duration) || result.project.timeline_data.duration || 30;
            console.log('⏱️ Setting canvas duration to:', projectDuration, '(type:', typeof projectDuration, ')');
            setCanvasDuration(projectDuration);

            // Set current time from timeline data
            const currentTime = result.project.timeline_data.currentTime || 0;
            console.log('⏱️ Setting canvas current time to:', currentTime);
            setCanvasCurrentTime(currentTime);
          } else {
            console.log('⚠️ No timeline data found, using defaults');
            // Default duration if no timeline data (convert to number)
            const defaultDuration = Number(result.project.duration) || 30;
            console.log('⏱️ Setting default canvas duration to:', defaultDuration, '(type:', typeof defaultDuration, ')');
            setCanvasDuration(defaultDuration);
            setCanvasCurrentTime(0);
          }

          // Load project assets
          const assetsResult = await videoStudioService.getAssets(projectId);
          if (assetsResult.success && assetsResult.assets) {
            const videoFiles = assetsResult.assets.map(asset => ({
              id: asset.id,
              name: asset.name,
              url: asset.file_url,
              duration: asset.duration || 0,
              size: asset.file_size,
              format: asset.format,
              resolution: { width: asset.width || 0, height: asset.height || 0 },
              createdAt: new Date(asset.uploaded_at)
            }));
            setAssetLibrary(videoFiles);
          }
        } else {
          // Project not found, create a new one
          console.log('⚠️ Project not found, creating new project');
          const createResult = await videoStudioService.createProject({
            title: 'Untitled Project',
            width: 1920,
            height: 1080,
            fps: 30,
            duration: 30,
            quality: 'high',
            aspect_ratio: '16:9'
          });

          if (createResult.success && createResult.project) {
            console.log('✅ New project created:', createResult.project.id);
            navigate(`/studio/video/canvas/${createResult.project.id}`, { replace: true });
          } else {
            console.error('❌ Failed to create project:', createResult.error);
            setIsProjectManagerOpen(true);
          }
        }
      } else {
        // No projectId provided - create a new default project
        console.log('⚠️ No projectId provided, creating new project');
        const createResult = await videoStudioService.createProject({
          title: 'Untitled Project',
          width: 1920,
          height: 1080,
          fps: 30,
          duration: 30,
          quality: 'high',
          aspect_ratio: '16:9'
        });

        if (createResult.success && createResult.project) {
          console.log('✅ New project created:', createResult.project.id);
          // Navigate to the new project
          navigate(`/studio/video/canvas/${createResult.project.id}`, { replace: true });
        } else {
          console.error('❌ Failed to create project:', createResult.error);
          // Fallback: show project manager
          setIsProjectManagerOpen(true);
        }
      }
    };

    loadProject();
  }, [projectId, navigate]);

  // Sync canvas time/duration whenever timeline snapshot changes
  useEffect(() => {
    if (timelineSnapshot) {
      // Update duration if it exists in timeline data
      if (timelineSnapshot.duration !== undefined && timelineSnapshot.duration > 0) {
        setCanvasDuration(timelineSnapshot.duration);
      }

      // Update current time if it exists in timeline data
      if (timelineSnapshot.currentTime !== undefined) {
        setCanvasCurrentTime(timelineSnapshot.currentTime);
      }
    }
  }, [timelineSnapshot]);

  // Load user credits
  useEffect(() => {
    const loadCredits = async () => {
      const user = authService.getCurrentUser();
      if (user) {
        setUserCredits(user.credits || 0);
      }
    };
    loadCredits();
  }, []);

  // Auto-save project on timeline changes (debounced)
  useEffect(() => {
    if (currentProject && timelineSnapshot) {
      const debounceTimer = setTimeout(async () => {
        setIsSavingProject(true);
        await videoStudioService.updateProject(currentProject.id, {
          timeline_data: timelineSnapshot,
          duration: canvasDuration
        });
        setIsSavingProject(false);
        setLastSavedTime(new Date());
      }, 2000); // Auto-save after 2 seconds of inactivity

      return () => clearTimeout(debounceTimer);
    }
  }, [timelineSnapshot, currentProject, canvasDuration]);

  // Handle panel resizing
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const isShiftPressed = e.shiftKey;

      if (isResizing === 'left') {
        const newWidth = Math.max(200, Math.min(600, e.clientX - 16)); // 16px padding
        setLeftPanelWidth(newWidth);
        // If Shift is pressed, also resize Project Browser to match
        if (isShiftPressed) {
          setProjectBrowserWidth(newWidth);
        }
      } else if (isResizing === 'project') {
        const newWidth = Math.max(200, Math.min(600, e.clientX - 16));
        setProjectBrowserWidth(newWidth);
        // If Shift is pressed, also resize Effect Controls to match
        if (isShiftPressed) {
          setLeftPanelWidth(newWidth);
        }
      } else if (isResizing === 'right') {
        const newWidth = Math.max(200, Math.min(600, window.innerWidth - e.clientX - 16));
        setRightPanelWidth(newWidth);
      } else if (isResizing === 'bottom') {
        const newHeight = Math.max(150, Math.min(600, window.innerHeight - e.clientY - 64)); // 64px for top bar
        setBottomPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Save project
  const handleSaveProject = async () => {
    if (!currentProject) return;

    setIsSavingProject(true);
    const result = await videoStudioService.updateProject(currentProject.id, {
      title: currentProject.title,
      timeline_data: timelineSnapshot,
      width: currentProject.width,
      height: currentProject.height,
      fps: currentProject.fps,
      duration: canvasDuration || currentProject.duration
    });
    setIsSavingProject(false);

    if (result.success) {
      setLastSavedTime(new Date());
      console.log('✅ Project saved');
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

    setIsGenerating(true);
    setRenderProgress(0);

    // TODO: Replace with actual render API call
    const interval = setInterval(() => {
      setRenderProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsGenerating(false);
          return 100;
        }
        return prev + 10;
      });
    }, 500);
  };

  // Cancel rendering
  const handleCancelRender = () => {
    setIsGenerating(false);
    setRenderProgress(0);
  };

  // Navigate back to overview
  const handleBackToInterface = () => {
    navigate('/overview');
  };

  // Handle close button click (shows save button first)
  const handleCloseClick = () => {
    if (saveCompleted) {
      // Save has been completed, actually close now
      console.log('❌ Closing canvas after save completed');
      navigate('/overview');
    } else if (!showSaveButton) {
      // First click: show save button and disable close
      console.log('🔒 Showing save button, disabling close');
      setShowSaveButton(true);
      setIsCloseDisabled(true);
    }
    // If save button is showing but save not completed, do nothing (close is disabled)
  };

  // Handle save button click
  const handleSaveClick = async () => {
    console.log('💾 Save button clicked');

    // Save the project
    await handleSaveProject();

    // Show checkmark animation
    setShowCheckmark(true);
    setHasUnsavedChanges(false);

    // After checkmark, hide save button and enable close button
    setTimeout(() => {
      setShowCheckmark(false);
      setShowSaveButton(false); // Hide the save button
      setIsCloseDisabled(false);
      setSaveCompleted(true); // Mark save as completed
      console.log('✅ Save complete, save button hidden, close button enabled');
    }, 1500); // 1.5 seconds for checkmark display
  };

  // Create new project
  const handleStartNewProject = () => {
    navigate('/studio/video/canvas');
  };

  // Handle asset upload
  const handleAssetUpload = async (files: File[]) => {
    if (files.length === 0 || !currentProject) return;

    const file = files[0];

    try {
      // Upload asset
      const assetType: 'video' | 'image' | 'audio' = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'video';
      const result = await videoStudioService.uploadAsset({
        project_id: currentProject.id,
        name: file.name,
        type: assetType,
        format: file.name.split('.').pop()?.toLowerCase() || assetType,
        file_url: URL.createObjectURL(file),
        file_size: file.size,
        source: 'upload',
      });

      if (result.success && result.asset) {
        // Add to asset library
        const newAsset: VideoFile = {
          id: result.asset.id,
          name: result.asset.name,
          url: result.asset.file_url,
          duration: result.asset.duration || 0,
          size: result.asset.file_size,
          format: result.asset.format,
          resolution: { width: result.asset.width || 0, height: result.asset.height || 0 },
          createdAt: new Date(result.asset.uploaded_at)
        };
        setAssetLibrary(prev => [...prev, newAsset]);
      } else {
        alert(`Failed to upload asset: ${result.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload asset');
    }
  };

  // Timeline handlers
  const handleTimelineChange = (snapshot: { tracks: any[]; currentTime: number; duration: number }) => {
    setTimelineSnapshot(snapshot);
    setCanvasDuration(snapshot.duration);
  };

  const handleTimeChange = (time: number) => {
    setCanvasCurrentTime(time);
    if (timelineSnapshot) {
      setTimelineSnapshot({
        ...timelineSnapshot,
        currentTime: time
      });
    }
  };

  const handleDurationChange = (duration: number) => {
    setCanvasDuration(duration);
    if (timelineSnapshot) {
      setTimelineSnapshot({
        ...timelineSnapshot,
        duration
      });
    }
  };

  // Format time as HH:MM:SS:FF (hours:minutes:seconds:frames)
  const formatTimecode = (seconds: number): string => {
    const totalFrames = Math.floor(seconds * canvasFps);
    const frames = totalFrames % canvasFps;
    const totalSeconds = Math.floor(totalFrames / canvasFps);
    const secs = totalSeconds % 60;
    const mins = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  };

  // Parse timecode string (HH:MM:SS:FF or MM:SS:FF or SS:FF) to seconds
  const parseTimecode = (timecode: string): number | null => {
    const parts = timecode.trim().split(':').map(p => parseInt(p, 10));

    if (parts.some(isNaN)) return null;

    let hours = 0, mins = 0, secs = 0, frames = 0;

    if (parts.length === 4) {
      // HH:MM:SS:FF
      [hours, mins, secs, frames] = parts;
    } else if (parts.length === 3) {
      // MM:SS:FF
      [mins, secs, frames] = parts;
    } else if (parts.length === 2) {
      // SS:FF
      [secs, frames] = parts;
    } else {
      return null;
    }

    // Validate ranges
    if (frames >= canvasFps || secs >= 60 || mins >= 60 || hours < 0) {
      return null;
    }

    const totalSeconds = hours * 3600 + mins * 60 + secs + (frames / canvasFps);
    return totalSeconds;
  };

  // Timecode editing handlers
  const handleTimecodeClick = () => {
    setTimecodeInput(formatTimecode(canvasCurrentTime));
    setIsEditingTimecode(true);
  };

  const handleTimecodeSubmit = () => {
    const newTime = parseTimecode(timecodeInput);
    if (newTime !== null && newTime >= 0 && newTime <= canvasDuration) {
      handleTimeChange(newTime);
    }
    setIsEditingTimecode(false);
  };

  const handleTimecodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTimecodeSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingTimecode(false);
    }
  };

  // Playback control handlers
  const handleGoToIn = () => {
    handleTimeChange(0);
  };

  const handleStepBackward = () => {
    const frameDuration = 1 / canvasFps;
    const newTime = Math.max(0, canvasCurrentTime - frameDuration);
    handleTimeChange(newTime);
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleStepForward = () => {
    const frameDuration = 1 / canvasFps;
    const newTime = Math.min(canvasDuration, canvasCurrentTime + frameDuration);
    handleTimeChange(newTime);
  };

  const handleGoToOut = () => {
    handleTimeChange(canvasDuration);
  };

  // Playback loop - update time when playing
  useEffect(() => {
    if (!isPlaying) return;

    let lastTime = performance.now();
    let animationFrameId: number;

    const tick = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
      lastTime = currentTime;

      setCanvasCurrentTime(prevTime => {
        const newTime = prevTime + deltaTime;

        // Stop at the end
        if (newTime >= canvasDuration) {
          setIsPlaying(false);
          return canvasDuration;
        }

        return newTime;
      });

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, canvasDuration]);

  if (!currentProject) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-[#09090b] overflow-hidden flex flex-col">
      {/* Top Left Menu Button */}
      <VideoStudioHeader
        projectTitle={currentProject?.title || 'Untitled Project'}
        onSave={handleSaveProject}
        onOpenProject={() => setIsProjectManagerOpen(true)}
        onNewProject={handleStartNewProject}
        onExport={handleStartRender}
        isSaving={isSavingProject}
        lastSaved={lastSavedTime}
        userCredits={userCredits}
        onBack={handleBackToInterface}
        onRender={handleStartRender}
        onCancelRender={handleCancelRender}
        isRendering={isGenerating}
        renderProgress={renderProgress}
      />

      {/* Main Canvas Area - Flexible viewport-based layout */}
      <div className="flex-1 flex flex-col relative bg-[#09090b] min-h-0" style={{ height: 'calc(100vh - 4rem)' }}>
        {/* Main Content Area - Below workspace tabs */}
        <div className="flex-1 flex flex-col p-2 gap-2 min-h-0 overflow-hidden" style={{ paddingTop: '3rem' }}>
          {/* Main Row - Left Section + Right Panel */}
          <div className="flex-1 flex gap-2 min-w-0 min-h-0 overflow-hidden">
            {/* Left Section - Effect Controls (top) and Project Browser + Timeline (bottom) */}
            <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
              {/* Top Section - Effect Controls + Video Preview + Playback Controls */}
              <div className="flex-1 flex gap-2 min-h-0 overflow-hidden" style={{ minHeight: '40vh' }}>
                {/* Effect Controls - Full height on left side */}
                {isSidePanelOpen && !sidePanelMinimized && (
                  <>
                    <div
                      className="rounded-lg overflow-hidden shadow-2xl border border-white/10 bg-[#09090b] relative flex flex-col"
                      style={{
                        width: `clamp(200px, ${leftPanelWidth}px, min(600px, 30vw))`,
                        minWidth: '200px',
                        maxWidth: 'min(600px, 30vw)'
                      }}
                    >
                      <LeftTopPanelTabs
                        selectedClipId={undefined}
                        clipName={undefined}
                      />
                      {/* Size Indicator */}
                      {isResizing === 'left' && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                          <div className="bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20">
                            <p className="text-white font-mono text-sm">{leftPanelWidth}px</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Effect Controls Resize Handle */}
                    <div
                      className="w-1 cursor-col-resize hover:bg-white/20 transition-colors relative group flex-shrink-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizing('left');
                      }}
                    >
                      <div className="absolute inset-0 -mx-1" />
                    </div>
                  </>
                )}

                {/* Right Content - Video Preview + Timeline Ruler + Playback Controls */}
                <div className="flex-1 flex flex-col gap-2 min-w-0 min-h-0 overflow-hidden">
                  {/* Video Preview */}
                  <div className="flex-1 rounded-lg overflow-hidden shadow-2xl border border-white/10 bg-[#09090b] min-w-0 min-h-0">
                    <EmbeddedCanvasViewer
                      videoUrl={previewVideoSrc}
                      currentTime={canvasCurrentTime}
                      duration={canvasDuration}
                      onTimeChange={handleTimeChange}
                    />
                  </div>

                  {/* Timeline Ruler with Playhead */}
                  <div className="rounded-lg shadow-2xl border border-white/10 bg-[#09090b] px-4 py-3 flex-shrink-0" style={{ height: 'clamp(60px, 8vh, 80px)' }}>
                    <div className="relative h-12">
                      {/* Time labels (top row) */}
                      <div className="absolute top-0 left-0 right-0 h-4 flex">
                        {Array.from({ length: 11 }).map((_, i) => {
                          if (i % 5 !== 0) return null;
                          const timeAtMarker = (i / 10) * canvasDuration;
                          return (
                            <div
                              key={i}
                              className="flex-1 flex justify-center"
                              style={{ position: 'relative', left: i === 0 ? '0%' : i === 5 ? '-2%' : '-4%' }}
                            >
                              <div className="text-[10px] text-white/40 font-mono">
                                {formatTimecode(timeAtMarker).substring(3, 11)}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Ruler background */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-8 bg-[#1a1a1a] rounded cursor-pointer"
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const percentage = x / rect.width;
                          const newTime = Math.max(0, Math.min(canvasDuration, percentage * canvasDuration));
                          handleTimeChange(newTime);
                        }}
                        onMouseDown={(e) => {
                          const handleMouseMove = (moveEvent: MouseEvent) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = moveEvent.clientX - rect.left;
                            const percentage = Math.max(0, Math.min(1, x / rect.width));
                            const newTime = percentage * canvasDuration;
                            handleTimeChange(newTime);
                          };

                          const handleMouseUp = () => {
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', handleMouseUp);
                          };

                          document.addEventListener('mousemove', handleMouseMove);
                          document.addEventListener('mouseup', handleMouseUp);
                        }}
                      >
                        {/* Time markers */}
                        <div className="absolute inset-0 flex items-start pt-1">
                          {Array.from({ length: 11 }).map((_, i) => {
                            return (
                              <div
                                key={i}
                                className="flex-1 flex flex-col items-center"
                              >
                                {/* Marker line */}
                                <div className="w-px bg-white/20" style={{ height: i % 5 === 0 ? '12px' : '8px' }} />
                              </div>
                            );
                          })}
                        </div>

                        {/* Playhead */}
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
                          style={{
                            left: `${Math.min(100, (canvasCurrentTime / canvasDuration) * 100)}%`,
                            transform: 'translateX(-50%)'
                          }}
                        >
                          {/* Playhead handle */}
                          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full border-2 border-black" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Playback Controls - Same width as Video Preview */}
                  <div
                    className="rounded-lg shadow-2xl border border-white/10 bg-[#09090b] flex items-center justify-between gap-2 px-4 flex-shrink-0"
                    style={{ height: 'clamp(48px, 6vh, 60px)' }}
                  >
                    {/* Current Time (Left aligned, editable) */}
                    <div className="flex-shrink-0">
                      {isEditingTimecode ? (
                        <input
                          type="text"
                          value={timecodeInput}
                          onChange={(e) => setTimecodeInput(e.target.value)}
                          onBlur={handleTimecodeSubmit}
                          onKeyDown={handleTimecodeKeyDown}
                          autoFocus
                          style={{ width: '110px' }}
                          className="bg-white/10 text-white/80 font-mono text-sm px-2 py-1 rounded border border-white/20 focus:border-blue-500 focus:outline-none"
                          placeholder="HH:MM:SS:FF"
                        />
                      ) : (
                        <div
                          onClick={handleTimecodeClick}
                          style={{ width: '110px' }}
                          className="text-white/80 font-mono text-sm cursor-pointer hover:bg-white/10 px-2 py-1 rounded transition-colors"
                          title="Click to enter timecode"
                        >
                          {formatTimecode(canvasCurrentTime)}
                        </div>
                      )}
                    </div>

                    {/* Playback Buttons (Center) */}
                    <div className="flex items-center gap-2">
                      {/* Go to In */}
                      <button
                        onClick={handleGoToIn}
                        className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all"
                        title="Go to In"
                      >
                        <SkipBack className="w-5 h-5" />
                      </button>

                      {/* Step Backward (1 frame) */}
                      <button
                        onClick={handleStepBackward}
                        className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all"
                        title="Step Backward (1 frame)"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>

                      {/* Play/Pause Toggle */}
                      <button
                        onClick={handlePlayPause}
                        className="p-2 rounded hover:bg-white/10 text-white hover:text-white transition-all bg-white/5"
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        {isPlaying ? (
                          <Pause className="w-6 h-6" />
                        ) : (
                          <Play className="w-6 h-6" />
                        )}
                      </button>

                      {/* Step Forward (1 frame) */}
                      <button
                        onClick={handleStepForward}
                        className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all"
                        title="Step Forward (1 frame)"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>

                      {/* Go to Out */}
                      <button
                        onClick={handleGoToOut}
                        className="p-2 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all"
                        title="Go to Out"
                      >
                        <SkipForward className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Total Duration (Right aligned) */}
                    <div className="text-white/80 font-mono text-sm min-w-[110px] text-right">
                      {formatTimecode(canvasDuration)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Row - Project Browser (left) + Timeline (right) */}
              {isBottomPanelOpen && !bottomPanelMinimized && (
                <>
                  {/* Bottom Resize Handle */}
                  <div
                    className="h-1 cursor-row-resize hover:bg-white/20 transition-colors relative group flex-shrink-0"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsResizing('bottom');
                    }}
                  >
                    <div className="absolute inset-0 -my-1" />
                  </div>

                  <div className="flex gap-2 min-h-0 overflow-hidden" style={{
                    height: `clamp(150px, ${bottomPanelHeight}px, min(600px, 40vh))`,
                    minHeight: '150px',
                    maxHeight: 'min(600px, 40vh)'
                  }}>
                    {/* Project Browser (Left of Timeline) */}
                    {isSidePanelOpen && !sidePanelMinimized && (
                      <>
                        <div
                          className="rounded-lg overflow-hidden shadow-2xl border border-white/10 bg-[#09090b] relative flex flex-col"
                          style={{
                            width: `clamp(200px, ${projectBrowserWidth}px, min(600px, 30vw))`,
                            minWidth: '200px',
                            maxWidth: 'min(600px, 30vw)'
                          }}
                        >
                          <LeftBottomPanelTabs
                            assets={assetLibrary}
                            onAssetSelect={(asset) => console.log('Asset selected:', asset)}
                            onAssetUpload={handleAssetUpload}
                          />
                          {/* Size Indicator */}
                          {isResizing === 'project' && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                              <div className="bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20">
                                <p className="text-white font-mono text-sm">{projectBrowserWidth}px</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Project Browser Resize Handle */}
                        <div
                          className="w-1 cursor-col-resize hover:bg-white/20 transition-colors relative group flex-shrink-0"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setIsResizing('project');
                          }}
                        >
                          <div className="absolute inset-0 -mx-1" />
                        </div>
                      </>
                    )}

                    {/* Timeline */}
                    <div className="flex-1 rounded-lg overflow-hidden shadow-2xl border border-white/10 bg-[#09090b] min-w-0 min-h-0 relative flex flex-col">
                      <VideoTimeline
                        videos={assetLibrary}
                        currentTime={canvasCurrentTime}
                        onTimeChange={handleTimeChange}
                        projectDuration={canvasDuration}
                        onStateChange={handleTimelineChange}
                      />
                      {/* Size Indicator */}
                      {isResizing === 'bottom' && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                          <div className="bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20">
                            <p className="text-white font-mono text-sm">H: {bottomPanelHeight}px</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right Column - Properties Panel (Full Height) */}
            {isRightPanelOpen && !rightPanelMinimized && (
            <>
              {/* Right Resize Handle */}
              <div
                className="w-1 cursor-col-resize hover:bg-white/20 transition-colors relative group flex-shrink-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setIsResizing('right');
                }}
              >
                <div className="absolute inset-0 -mx-1" />
              </div>

              <div
                className="rounded-lg overflow-hidden shadow-2xl border border-white/10 bg-[#09090b] relative flex flex-col"
                style={{
                  width: `clamp(200px, ${rightPanelWidth}px, min(600px, 30vw))`,
                  minWidth: '200px',
                  maxWidth: 'min(600px, 30vw)'
                }}
              >
                <RightPanelTabs
                  selectedClipId={undefined}
                  clipName={undefined}
                  clipEffects={[]}
                  onEffectToggle={(effectId) => console.log('Toggle effect:', effectId)}
                  onEffectRemove={(effectId) => console.log('Remove effect:', effectId)}
                  onParameterChange={(effectId, parameterId, value) => console.log('Parameter change:', effectId, parameterId, value)}
                  onKeyframeAdd={(effectId, parameterId) => console.log('Add keyframe:', effectId, parameterId)}
                />
                {/* Size Indicator */}
                {isResizing === 'right' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
                    <div className="bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/20">
                      <p className="text-white font-mono text-sm">{rightPanelWidth}px</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          </div>
        </div>

        {/* Top Middle List - Workspace Tabs */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] flex items-center gap-2 flex-wrap justify-center" style={{ maxWidth: '90vw' }}>
          {/* Editing Button */}
          <button
            onClick={() => console.log('🎬 Editing workspace')}
            className="px-4 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Editing Workspace"
          >
            <span className="text-xs font-medium">Editing</span>
          </button>

          {/* Color Button */}
          <button
            onClick={() => console.log('🎨 Color workspace')}
            className="px-4 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Color Workspace"
          >
            <span className="text-xs font-medium">Color</span>
          </button>

          {/* Assistant Button */}
          <button
            onClick={() => console.log('🤖 Assistant workspace')}
            className="px-6 h-10 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Assistant Workspace"
          >
            <span className="text-sm font-medium">Assistant</span>
          </button>

          {/* Graphics Button */}
          <button
            onClick={() => console.log('🖼️ Graphics workspace')}
            className="px-4 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Graphics Workspace"
          >
            <span className="text-xs font-medium">Graphics</span>
          </button>

          {/* Audio Button */}
          <button
            onClick={() => console.log('🔊 Audio workspace')}
            className="px-4 h-8 bg-black/90 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl flex items-center gap-2 text-white/70 hover:text-white hover:bg-black/80 transition-all duration-200"
            title="Audio Workspace"
          >
            <span className="text-xs font-medium">Audio</span>
          </button>
        </div>

        {/* Top Right Close Button */}
        <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
          {/* Expandable Save Button */}
          {showSaveButton && (
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
                ? "Save first before closing"
                : showSaveButton
                  ? "Click to close after saving"
                  : "Close canvas"
            }
            disabled={isCloseDisabled}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Project Manager Modal */}
        {isProjectManagerOpen && (
          <ProjectManager
            isOpen
            onClose={() => setIsProjectManagerOpen(false)}
            onLoadProject={(project) => {
              navigate(`/studio/video/canvas/${project.id}`);
              setIsProjectManagerOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default StudioVideoCanvas;
