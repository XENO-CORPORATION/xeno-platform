// Core types for VideoStudio

export interface VideoFile {
  id: string;
  name: string;
  url: string;
  duration: number;
  size: number;
  format: string;
  resolution: {
    width: number;
    height: number;
  };
  createdAt: Date;
}

export interface VideoProject {
  id: string;
  name: string;
  description?: string;
  videos: VideoFile[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoStudioSettings {
  quality: 'low' | 'medium' | 'high' | 'ultra';
  format: 'mp4' | 'webm' | 'avi' | 'mov';
  resolution: string;
  frameRate: number;
}

export interface VideoEditOperation {
  id: string;
  type: 'trim' | 'crop' | 'filter' | 'transition' | 'effect';
  parameters: Record<string, any>;
  timestamp: number;
}

export interface VideoTimeline {
  tracks: VideoTrack[];
  duration: number;
  currentTime: number;
}

export interface VideoTrack {
  id: string;
  type: 'video' | 'audio' | 'text';
  clips: VideoClip[];
  muted?: boolean;
  volume?: number;
  solo?: boolean;
  locked?: boolean;
  hidden?: boolean;
  name?: string;
}

export interface VideoClip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  trackStartTime: number;
  effects: VideoEditOperation[];
}