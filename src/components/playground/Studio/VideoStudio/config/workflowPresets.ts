/**
 * Workflow Presets Configuration
 * Each preset defines optimal settings for different video production workflows
 */

export type WorkflowType = 'film' | 'youtube' | 'instagram' | 'tiktok' | 'podcast' | 'broadcast' | 'custom';

export interface WorkflowPreset {
  name: string;
  description: string;
  icon: string;

  // Sequence Settings
  sequence: {
    timebase: number; // FPS
    frameWidth: number;
    frameHeight: number;
    pixelAspectRatio: string;
    fields: string;
    sampleRate: number;
    channelFormat: string;
    codec: string;
  };

  // Storage & Performance
  storage: {
    autoSaveInterval: number; // seconds
    maxUndoHistory: number;
    proxyMediaResolution: 'none' | '480p' | '720p' | '1080p';
    cacheStrategy: 'minimal' | 'balanced' | 'aggressive';
    backgroundRendering: boolean;
    copyToProjectFolder: boolean;
    organizeByType: boolean;
  };

  // AI & Automation
  ai: {
    thumbnailGeneration: 'auto' | 'manual';
    waveformGeneration: boolean;
    metadataExtraction: boolean;
    aiTagging: boolean;
    autoSceneDetection: boolean;
    speechToText: boolean;
    autoSubtitles: boolean;
    smartReframing: boolean;
    hardwareAcceleration: 'auto' | 'nvidia' | 'cpu-only';
    renderQueuePriority: 'high' | 'normal' | 'low';
  };

  // Export Settings
  export: {
    defaultRenderPreset: 'h264-high' | 'h264-medium' | 'h265-high' | 'prores-422' | 'prores-422hq' | 'dnxhd';
    outputDestination: string;
  };
}

export const WORKFLOW_PRESETS: Record<WorkflowType, WorkflowPreset | null> = {
  film: {
    name: 'Film Production',
    description: '4K, 24fps, ProRes - Cinematic quality',
    icon: '🎬',
    sequence: {
      timebase: 24,
      frameWidth: 4096,
      frameHeight: 2160,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'No Fields (Progressive Scan)',
      sampleRate: 48000,
      channelFormat: '5.1',
      codec: 'ProRes',
    },
    storage: {
      autoSaveInterval: 120,
      maxUndoHistory: 50,
      proxyMediaResolution: '1080p',
      cacheStrategy: 'minimal',
      backgroundRendering: false,
      copyToProjectFolder: true,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'manual',
      waveformGeneration: true,
      metadataExtraction: true,
      aiTagging: false,
      autoSceneDetection: true,
      speechToText: false,
      autoSubtitles: false,
      smartReframing: false,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'high',
    },
    export: {
      defaultRenderPreset: 'prores-422hq',
      outputDestination: '/renders/film',
    },
  },

  youtube: {
    name: 'YouTube',
    description: '1080p, 60fps, H.264 - Optimized for web',
    icon: '▶️',
    sequence: {
      timebase: 60,
      frameWidth: 1920,
      frameHeight: 1080,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'No Fields (Progressive Scan)',
      sampleRate: 48000,
      channelFormat: 'Stereo',
      codec: 'H.264',
    },
    storage: {
      autoSaveInterval: 60,
      maxUndoHistory: 100,
      proxyMediaResolution: '720p',
      cacheStrategy: 'aggressive',
      backgroundRendering: true,
      copyToProjectFolder: false,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'auto',
      waveformGeneration: true,
      metadataExtraction: true,
      aiTagging: true,
      autoSceneDetection: true,
      speechToText: true,
      autoSubtitles: true,
      smartReframing: false,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'normal',
    },
    export: {
      defaultRenderPreset: 'h264-high',
      outputDestination: '/renders/youtube',
    },
  },

  instagram: {
    name: 'Instagram',
    description: '1080x1080, 30fps - Square & Stories',
    icon: '📸',
    sequence: {
      timebase: 30,
      frameWidth: 1080,
      frameHeight: 1080,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'No Fields (Progressive Scan)',
      sampleRate: 48000,
      channelFormat: 'Stereo',
      codec: 'H.264',
    },
    storage: {
      autoSaveInterval: 30,
      maxUndoHistory: 50,
      proxyMediaResolution: 'none',
      cacheStrategy: 'balanced',
      backgroundRendering: true,
      copyToProjectFolder: false,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'auto',
      waveformGeneration: false,
      metadataExtraction: true,
      aiTagging: true,
      autoSceneDetection: true,
      speechToText: true,
      autoSubtitles: true,
      smartReframing: true,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'normal',
    },
    export: {
      defaultRenderPreset: 'h264-medium',
      outputDestination: '/renders/instagram',
    },
  },

  tiktok: {
    name: 'TikTok',
    description: '1080x1920, 30fps - Vertical video',
    icon: '🎵',
    sequence: {
      timebase: 30,
      frameWidth: 1080,
      frameHeight: 1920,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'No Fields (Progressive Scan)',
      sampleRate: 48000,
      channelFormat: 'Stereo',
      codec: 'H.264',
    },
    storage: {
      autoSaveInterval: 30,
      maxUndoHistory: 50,
      proxyMediaResolution: 'none',
      cacheStrategy: 'balanced',
      backgroundRendering: true,
      copyToProjectFolder: false,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'auto',
      waveformGeneration: true,
      metadataExtraction: true,
      aiTagging: true,
      autoSceneDetection: true,
      speechToText: true,
      autoSubtitles: true,
      smartReframing: true,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'normal',
    },
    export: {
      defaultRenderPreset: 'h264-medium',
      outputDestination: '/renders/tiktok',
    },
  },

  podcast: {
    name: 'Podcast',
    description: '1080p, 30fps - Audio-focused with visuals',
    icon: '🎙️',
    sequence: {
      timebase: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'No Fields (Progressive Scan)',
      sampleRate: 48000,
      channelFormat: 'Stereo',
      codec: 'H.264',
    },
    storage: {
      autoSaveInterval: 60,
      maxUndoHistory: 100,
      proxyMediaResolution: '720p',
      cacheStrategy: 'balanced',
      backgroundRendering: true,
      copyToProjectFolder: false,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'auto',
      waveformGeneration: true,
      metadataExtraction: true,
      aiTagging: false,
      autoSceneDetection: false,
      speechToText: true,
      autoSubtitles: true,
      smartReframing: false,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'normal',
    },
    export: {
      defaultRenderPreset: 'h264-high',
      outputDestination: '/renders/podcast',
    },
  },

  broadcast: {
    name: 'Broadcast',
    description: '1080i, 29.97fps - TV/Broadcast standard',
    icon: '📺',
    sequence: {
      timebase: 29.97,
      frameWidth: 1920,
      frameHeight: 1080,
      pixelAspectRatio: 'Square Pixels (1.0)',
      fields: 'Upper Field First',
      sampleRate: 48000,
      channelFormat: 'Stereo',
      codec: 'DNxHD',
    },
    storage: {
      autoSaveInterval: 60,
      maxUndoHistory: 100,
      proxyMediaResolution: '720p',
      cacheStrategy: 'balanced',
      backgroundRendering: true,
      copyToProjectFolder: true,
      organizeByType: true,
    },
    ai: {
      thumbnailGeneration: 'manual',
      waveformGeneration: true,
      metadataExtraction: true,
      aiTagging: false,
      autoSceneDetection: true,
      speechToText: false,
      autoSubtitles: false,
      smartReframing: false,
      hardwareAcceleration: 'auto',
      renderQueuePriority: 'high',
    },
    export: {
      defaultRenderPreset: 'dnxhd',
      outputDestination: '/renders/broadcast',
    },
  },

  custom: null, // Custom workflow has no preset - user configures everything
};

/**
 * Get aspect ratio label from dimensions
 */
export function getAspectRatio(width: number, height: number): string {
  const ratio = width / height;

  if (Math.abs(ratio - 16/9) < 0.01) return '16:9';
  if (Math.abs(ratio - 4/3) < 0.01) return '4:3';
  if (Math.abs(ratio - 1) < 0.01) return '1:1 (Square)';
  if (Math.abs(ratio - 9/16) < 0.01) return '9:16 (Vertical)';
  if (Math.abs(ratio - 21/9) < 0.01) return '21:9 (Cinema)';
  if (Math.abs(ratio - 2.39) < 0.01) return '2.39:1 (Anamorphic)';

  return `${width}x${height}`;
}
