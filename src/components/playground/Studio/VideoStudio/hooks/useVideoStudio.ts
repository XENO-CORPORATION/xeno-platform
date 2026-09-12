import { useState, useCallback, useRef } from 'react';
import { VideoProject, VideoFile, VideoStudioSettings } from '../core/types';
import { createNewProject, getDefaultSettings } from '../core/utils';
import { VideoEngine } from '../core/video.engine';

export interface UseVideoStudioReturn {
  // Project state
  currentProject: VideoProject | null;
  projects: VideoProject[];
  settings: VideoStudioSettings;
  
  // Video state
  selectedVideo: VideoFile | null;
  videos: VideoFile[];
  isProcessing: boolean;
  
  // Engine
  videoEngine: VideoEngine | null;
  
  // Actions
  createProject: (name: string) => void;
  loadProject: (project: VideoProject) => void;
  saveProject: () => void;
  deleteProject: (projectId: string) => void;
  
  // Video actions
  loadVideo: (file: File) => Promise<void>;
  selectVideo: (video: VideoFile) => void;
  removeVideo: (videoId: string) => void;
  
  // Processing actions
  processVideo: (operation: string, params?: any) => Promise<void>;
  exportVideo: (format: string, quality: string) => Promise<void>;
  
  // Settings
  updateSettings: (newSettings: Partial<VideoStudioSettings>) => void;
  resetSettings: () => void;
}

export const useVideoStudio = (): UseVideoStudioReturn => {
  // State
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [settings, setSettings] = useState<VideoStudioSettings>(getDefaultSettings());
  const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Engine ref
  const videoEngineRef = useRef<VideoEngine | null>(null);
  
  // Initialize engine if needed
  const getVideoEngine = useCallback(() => {
    if (!videoEngineRef.current) {
      videoEngineRef.current = new VideoEngine();
    }
    return videoEngineRef.current;
  }, []);
  
  // Project actions
  const createProject = useCallback((name: string) => {
    const newProject = createNewProject(name);
    setProjects(prev => [...prev, newProject]);
    setCurrentProject(newProject);
  }, []);
  
  const loadProject = useCallback((project: VideoProject) => {
    setCurrentProject(project);
    setVideos(project.videos || []);
    setSelectedVideo(null);
  }, []);
  
  const saveProject = useCallback(() => {
    if (!currentProject) return;
    
    const updatedProject: VideoProject = {
      ...currentProject,
      videos,
      lastModified: new Date()
    };
    
    setProjects(prev => 
      prev.map(p => p.id === currentProject.id ? updatedProject : p)
    );
    setCurrentProject(updatedProject);
  }, [currentProject, videos]);
  
  const deleteProject = useCallback((projectId: string) => {
    setProjects(prev => prev.filter(p => p.id !== projectId));
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
      setVideos([]);
      setSelectedVideo(null);
    }
  }, [currentProject]);
  
  // Video actions
  const loadVideo = useCallback(async (file: File) => {
    try {
      setIsProcessing(true);
      const engine = getVideoEngine();
      
      const videoFile: VideoFile = {
        id: Date.now().toString(),
        name: file.name,
        url: URL.createObjectURL(file),
        size: file.size,
        type: file.type,
        format: file.name.split('.').pop()?.toLowerCase() || 'mp4',
        resolution: { width: 0, height: 0 },
        duration: 0, // Will be updated after loading
        width: 0,
        height: 0,
        createdAt: new Date()
      };
      
      // Load video to get metadata
      await engine.loadVideo(videoFile);
      const metadata = engine.getVideoMetadata();
      
      if (metadata) {
        videoFile.duration = metadata.duration;
        videoFile.width = metadata.width;
        videoFile.height = metadata.height;
        videoFile.resolution = { width: metadata.width, height: metadata.height };
      }
      
      setVideos(prev => [...prev, videoFile]);
      setSelectedVideo(videoFile);
    } catch (error) {
      console.error('Error loading video:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [getVideoEngine]);
  
  const selectVideo = useCallback((video: VideoFile) => {
    setSelectedVideo(video);
  }, []);
  
  const removeVideo = useCallback((videoId: string) => {
    setVideos(prev => prev.filter(v => v.id !== videoId));
    if (selectedVideo?.id === videoId) {
      setSelectedVideo(null);
    }
  }, [selectedVideo]);
  
  // Processing actions
  const processVideo = useCallback(async (operation: string, params?: any) => {
    if (!selectedVideo) return;
    
    try {
      setIsProcessing(true);
      const engine = getVideoEngine();
      
      // Load video if not already loaded
      await engine.loadVideo(selectedVideo);
      
      // Apply operation based on type
      switch (operation) {
        case 'grayscale':
          await engine.applyFilter('grayscale');
          break;
        case 'sepia':
          await engine.applyFilter('sepia');
          break;
        case 'brightness':
          await engine.applyFilter('brightness', params?.value || 1.2);
          break;
        case 'crop':
          if (params?.cropArea) {
            const { x, y, width, height } = params.cropArea;
            engine.cropFrame(x, y, width, height);
          }
          break;
        default:
          console.warn('Unknown operation:', operation);
      }
    } catch (error) {
      console.error('Error processing video:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedVideo, getVideoEngine]);
  
  const exportVideo = useCallback(async (format: string, quality: string) => {
    if (!selectedVideo) return;
    
    try {
      setIsProcessing(true);
      // Implementation would depend on video processing library
      console.log('Exporting video:', { format, quality });
      
      // Placeholder for actual export logic
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error exporting video:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedVideo]);
  
  // Settings actions
  const updateSettings = useCallback((newSettings: Partial<VideoStudioSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);
  
  const resetSettings = useCallback(() => {
    setSettings(getDefaultSettings());
  }, []);
  
  return {
    // Project state
    currentProject,
    projects,
    settings,
    
    // Video state
    selectedVideo,
    videos,
    isProcessing,
    
    // Engine
    videoEngine: videoEngineRef.current,
    
    // Actions
    createProject,
    loadProject,
    saveProject,
    deleteProject,
    
    // Video actions
    loadVideo,
    selectVideo,
    removeVideo,
    
    // Processing actions
    processVideo,
    exportVideo,
    
    // Settings
    updateSettings,
    resetSettings
  };
};

export default useVideoStudio;
