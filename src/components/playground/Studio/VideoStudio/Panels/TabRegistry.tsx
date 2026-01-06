import React from 'react';
import {
  Zap, Info, Film, Folder, Cloud, Wand2,
  Layers, AudioWaveform, Palette, Volume2,
  Type, Image, Clock, Sliders, Box,
  Sparkles, Grid, ListChecks, Database
} from 'lucide-react';

export type TabId =
  // Left Top Panel Tabs
  | 'effect-controls'
  | 'motion'
  | 'audio'
  | 'masks-tracking'
  | 'align-transform'
  // Left Bottom Panel Tabs
  | 'project'
  | 'media-browser'
  | 'cloud-library'
  | 'effects'
  | 'graphics'
  | 'audio-effects'
  | 'libraries'
  | 'presets'
  // Right Panel Tabs
  | 'info'
  | 'lumetri-color'
  | 'essential-sound'
  | 'essential-graphics'
  | 'markers'
  | 'metadata'
  // Bottom Panel Tabs
  | 'timeline'
  | 'audio-mixer'
  | 'history';

export interface TabDefinition {
  id: TabId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'left-top' | 'left-bottom' | 'right' | 'bottom' | 'all';
  description: string;
  priority: number; // Lower number = higher priority
}

export const TAB_REGISTRY: Record<TabId, TabDefinition> = {
  // Left Top Panel Tabs (Clip/Effect Controls)
  'effect-controls': {
    id: 'effect-controls',
    name: 'Effect Controls',
    icon: Zap,
    category: 'left-top',
    description: 'Edit effects applied to clips',
    priority: 1
  },
  'motion': {
    id: 'motion',
    name: 'Motion',
    icon: Layers,
    category: 'left-top',
    description: 'Position, scale, rotation controls',
    priority: 2
  },
  'audio': {
    id: 'audio',
    name: 'Audio',
    icon: AudioWaveform,
    category: 'left-top',
    description: 'Volume, pan, audio effects',
    priority: 3
  },
  'masks-tracking': {
    id: 'masks-tracking',
    name: 'Masks & Tracking',
    icon: Box,
    category: 'left-top',
    description: 'Mask and motion tracking tools',
    priority: 4
  },
  'align-transform': {
    id: 'align-transform',
    name: 'Align & Transform',
    icon: Grid,
    category: 'left-top',
    description: 'Alignment and transformation tools',
    priority: 5
  },

  // Left Bottom Panel Tabs (Project/Media Browser)
  'project': {
    id: 'project',
    name: 'Project',
    icon: Film,
    category: 'left-bottom',
    description: 'Project assets and files',
    priority: 1
  },
  'media-browser': {
    id: 'media-browser',
    name: 'Media Browser',
    icon: Folder,
    category: 'left-bottom',
    description: 'Browse local media files',
    priority: 2
  },
  'cloud-library': {
    id: 'cloud-library',
    name: 'Cloud Library',
    icon: Cloud,
    category: 'left-bottom',
    description: 'Access cloud storage',
    priority: 3
  },
  'effects': {
    id: 'effects',
    name: 'Effects',
    icon: Wand2,
    category: 'left-bottom',
    description: 'Browse and apply effects',
    priority: 4
  },
  'graphics': {
    id: 'graphics',
    name: 'Graphics',
    icon: Type,
    category: 'left-bottom',
    description: 'Titles and motion graphics',
    priority: 5
  },
  'audio-effects': {
    id: 'audio-effects',
    name: 'Audio Effects',
    icon: Volume2,
    category: 'left-bottom',
    description: 'Browse audio effects',
    priority: 6
  },
  'libraries': {
    id: 'libraries',
    name: 'Libraries',
    icon: Database,
    category: 'left-bottom',
    description: 'Asset libraries',
    priority: 7
  },
  'presets': {
    id: 'presets',
    name: 'Presets',
    icon: Sparkles,
    category: 'left-bottom',
    description: 'Effect and animation presets',
    priority: 8
  },

  // Right Panel Tabs
  'info': {
    id: 'info',
    name: 'Info',
    icon: Info,
    category: 'right',
    description: 'Clip information and metadata',
    priority: 2
  },
  'lumetri-color': {
    id: 'lumetri-color',
    name: 'Lumetri Color',
    icon: Palette,
    category: 'right',
    description: 'Color grading tools',
    priority: 3
  },
  'essential-sound': {
    id: 'essential-sound',
    name: 'Essential Sound',
    icon: Volume2,
    category: 'right',
    description: 'Audio editing panel',
    priority: 4
  },
  'essential-graphics': {
    id: 'essential-graphics',
    name: 'Essential Graphics',
    icon: Type,
    category: 'right',
    description: 'Motion graphics templates',
    priority: 5
  },
  'markers': {
    id: 'markers',
    name: 'Markers',
    icon: ListChecks,
    category: 'right',
    description: 'Timeline markers',
    priority: 6
  },
  'metadata': {
    id: 'metadata',
    name: 'Metadata',
    icon: Database,
    category: 'right',
    description: 'File metadata editor',
    priority: 7
  },

  // Bottom Panel Tabs
  'timeline': {
    id: 'timeline',
    name: 'Timeline',
    icon: Clock,
    category: 'bottom',
    description: 'Main timeline editor',
    priority: 1
  },
  'audio-mixer': {
    id: 'audio-mixer',
    name: 'Audio Mixer',
    icon: Sliders,
    category: 'bottom',
    description: 'Multi-track audio mixer',
    priority: 2
  },
  'history': {
    id: 'history',
    name: 'History',
    icon: Clock,
    category: 'bottom',
    description: 'Edit history',
    priority: 3
  }
};

// Helper functions
export const getTabsByCategory = (category: TabDefinition['category']): TabDefinition[] => {
  return Object.values(TAB_REGISTRY)
    .filter(tab => tab.category === category || tab.category === 'all')
    .sort((a, b) => a.priority - b.priority);
};

export const getAvailableTabsForPanel = (
  category: TabDefinition['category'],
  currentTabs: TabId[]
): TabDefinition[] => {
  return getTabsByCategory(category).filter(tab => !currentTabs.includes(tab.id));
};

export const getTabDefinition = (tabId: TabId): TabDefinition | undefined => {
  return TAB_REGISTRY[tabId];
};
