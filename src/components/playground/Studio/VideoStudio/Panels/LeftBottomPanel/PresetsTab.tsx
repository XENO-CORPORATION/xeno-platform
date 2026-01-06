import React, { useState } from 'react';
import { Sparkles, Save, Trash2, Search, Star } from 'lucide-react';

interface Preset {
  id: string;
  name: string;
  category: 'color' | 'motion' | 'audio' | 'transition' | 'effect';
  isFavorite: boolean;
  isCustom: boolean;
}

interface PresetsTabProps {
  onPresetSelect?: (presetId: string) => void;
  onPresetApply?: (presetId: string) => void;
  onPresetSave?: () => void;
  onPresetDelete?: (presetId: string) => void;
}

const PresetsTab: React.FC<PresetsTabProps> = ({
  onPresetSelect,
  onPresetApply,
  onPresetSave,
  onPresetDelete
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'color' | 'motion' | 'audio' | 'transition' | 'effect' | 'custom'>('all');

  const [presets, setPresets] = useState<Preset[]>([
    // Color Presets
    { id: 'color-1', name: 'Cinematic Blue', category: 'color', isFavorite: true, isCustom: false },
    { id: 'color-2', name: 'Warm Vintage', category: 'color', isFavorite: false, isCustom: false },
    { id: 'color-3', name: 'Cool Teal & Orange', category: 'color', isFavorite: true, isCustom: false },
    { id: 'color-4', name: 'Black & White', category: 'color', isFavorite: false, isCustom: false },
    { id: 'color-5', name: 'Film Noir', category: 'color', isFavorite: false, isCustom: false },
    { id: 'color-6', name: 'My Custom Grade', category: 'color', isFavorite: true, isCustom: true },

    // Motion Presets
    { id: 'motion-1', name: 'Smooth Zoom In', category: 'motion', isFavorite: false, isCustom: false },
    { id: 'motion-2', name: 'Ken Burns', category: 'motion', isFavorite: true, isCustom: false },
    { id: 'motion-3', name: 'Fade & Scale', category: 'motion', isFavorite: false, isCustom: false },
    { id: 'motion-4', name: 'Camera Shake', category: 'motion', isFavorite: false, isCustom: false },

    // Audio Presets
    { id: 'audio-1', name: 'Podcast Voice', category: 'audio', isFavorite: true, isCustom: false },
    { id: 'audio-2', name: 'Music Master', category: 'audio', isFavorite: false, isCustom: false },
    { id: 'audio-3', name: 'Dialogue Enhance', category: 'audio', isFavorite: false, isCustom: false },
    { id: 'audio-4', name: 'Noise Reduction', category: 'audio', isFavorite: false, isCustom: false },

    // Transition Presets
    { id: 'trans-1', name: 'Cross Dissolve', category: 'transition', isFavorite: true, isCustom: false },
    { id: 'trans-2', name: 'Fast Wipe', category: 'transition', isFavorite: false, isCustom: false },
    { id: 'trans-3', name: 'Zoom Blur', category: 'transition', isFavorite: false, isCustom: false },

    // Effect Presets
    { id: 'effect-1', name: 'Glitch Effect', category: 'effect', isFavorite: false, isCustom: false },
    { id: 'effect-2', name: 'VHS Look', category: 'effect', isFavorite: true, isCustom: false },
    { id: 'effect-3', name: 'Cinematic Bars', category: 'effect', isFavorite: false, isCustom: false },
  ]);

  const filteredPresets = presets.filter(preset => {
    const matchesSearch = preset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'all' ||
                          (activeCategory === 'custom' ? preset.isCustom : preset.category === activeCategory);
    return matchesSearch && matchesCategory;
  });

  const toggleFavorite = (presetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPresets(prev => prev.map(p =>
      p.id === presetId ? { ...p, isFavorite: !p.isFavorite } : p
    ));
  };

  const categories = [
    { id: 'all', name: 'All' },
    { id: 'color', name: 'Color' },
    { id: 'motion', name: 'Motion' },
    { id: 'audio', name: 'Audio' },
    { id: 'transition', name: 'Transition' },
    { id: 'effect', name: 'Effect' },
    { id: 'custom', name: 'Custom' },
  ];

  const getCategoryColor = (category: string) => {
    const colors = {
      color: 'from-purple-500/30 to-pink-500/30',
      motion: 'from-blue-500/30 to-cyan-500/30',
      audio: 'from-green-500/30 to-emerald-500/30',
      transition: 'from-yellow-500/30 to-amber-500/30',
      effect: 'from-red-500/30 to-orange-500/30',
    };
    return colors[category as keyof typeof colors] || 'from-gray-500/30 to-gray-600/30';
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header with Search */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white mb-2">Presets</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search presets..."
            className="w-full h-[22px] bg-white/5 border border-white/10 rounded pl-7 pr-2 text-[11px] text-white placeholder-white/40
                     focus:outline-none focus:border-blue-400 focus:bg-white/10 hover:border-white/20 transition-colors"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="px-2 py-2 border-b border-white/10 bg-white/5 overflow-x-auto custom-scrollbar">
        <div className="flex gap-1">
          {categories.map(category => {
            const isActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id as any)}
                className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-400/40'
                    : 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent'
                }`}
              >
                {category.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save Preset Button */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/5">
        <button
          onClick={onPresetSave}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 rounded text-blue-400 text-[10px] font-medium transition-all"
        >
          <Save className="w-3 h-3" />
          <span>Save Current as Preset</span>
        </button>
      </div>

      {/* Presets Grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredPresets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Sparkles className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/40 text-[11px] text-center">
              No presets found
            </p>
            <p className="text-white/40 text-[10px] text-center mt-1.5">
              Try a different search or category
            </p>
          </div>
        ) : (
          <div className="p-3 grid grid-cols-2 gap-2">
            {filteredPresets.map(preset => (
              <button
                key={preset.id}
                onClick={() => onPresetSelect?.(preset.id)}
                onDoubleClick={() => onPresetApply?.(preset.id)}
                className="group relative aspect-video bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded overflow-hidden transition-all"
              >
                {/* Preset Preview */}
                <div className={`absolute inset-0 bg-gradient-to-br ${getCategoryColor(preset.category)}`}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white/60 group-hover:text-white transition-colors" />
                  </div>
                </div>

                {/* Favorite Star */}
                <button
                  onClick={(e) => toggleFavorite(preset.id, e)}
                  className="absolute top-2 right-2 z-10 p-1 rounded bg-black/50 hover:bg-black/70 transition-colors"
                >
                  <Star
                    className={`w-3 h-3 transition-colors ${
                      preset.isFavorite
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-white/60 hover:text-white'
                    }`}
                  />
                </button>

                {/* Custom Badge */}
                {preset.isCustom && (
                  <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-blue-500/90 backdrop-blur-sm border border-blue-400">
                    <span className="text-[9px] text-white font-medium">CUSTOM</span>
                  </div>
                )}

                {/* Preset Info */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-6">
                  <div className="text-[10px] font-medium text-white truncate">
                    {preset.name}
                  </div>
                  <div className="text-[9px] text-white/70 capitalize">
                    {preset.category}
                  </div>
                </div>

                {/* Hover Actions */}
                {preset.isCustom && (
                  <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onPresetDelete?.(preset.id);
                      }}
                      className="p-2 rounded-full bg-red-500/90 hover:bg-red-500 transition-colors"
                      title="Delete Preset"
                    >
                      <Trash2 className="w-3 h-3 text-white" />
                    </button>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/10 bg-black/50">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/40">{filteredPresets.length} presets</span>
          <span className="text-white/60">Double-click to apply</span>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.3);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
};

export default PresetsTab;
