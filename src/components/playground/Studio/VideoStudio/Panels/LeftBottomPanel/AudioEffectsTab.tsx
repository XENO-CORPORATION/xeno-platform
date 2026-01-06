import React, { useState } from 'react';
import { Volume2, Mic, Music, Radio, Wand2, Search } from 'lucide-react';

interface AudioEffect {
  id: string;
  name: string;
  category: 'eq' | 'dynamics' | 'modulation' | 'delay' | 'reverb' | 'filter' | 'restoration';
  description: string;
}

interface AudioEffectsTabProps {
  onEffectSelect?: (effectId: string) => void;
  onEffectAdd?: (effectId: string) => void;
}

const AudioEffectsTab: React.FC<AudioEffectsTabProps> = ({
  onEffectSelect,
  onEffectAdd
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'eq' | 'dynamics' | 'modulation' | 'delay' | 'reverb' | 'filter' | 'restoration'>('all');

  const effects: AudioEffect[] = [
    // EQ
    { id: 'eq-parametric', name: 'Parametric EQ', category: 'eq', description: '10-band parametric equalizer' },
    { id: 'eq-graphic', name: 'Graphic EQ', category: 'eq', description: '31-band graphic equalizer' },
    { id: 'eq-filter', name: 'High/Low Pass Filter', category: 'eq', description: 'Cut frequencies above/below threshold' },

    // Dynamics
    { id: 'comp-standard', name: 'Compressor', category: 'dynamics', description: 'Reduce dynamic range' },
    { id: 'comp-multiband', name: 'Multiband Compressor', category: 'dynamics', description: 'Frequency-specific compression' },
    { id: 'limiter', name: 'Limiter', category: 'dynamics', description: 'Prevent audio from clipping' },
    { id: 'gate', name: 'Noise Gate', category: 'dynamics', description: 'Remove quiet background noise' },
    { id: 'expander', name: 'Expander', category: 'dynamics', description: 'Increase dynamic range' },

    // Modulation
    { id: 'chorus', name: 'Chorus', category: 'modulation', description: 'Thicken and widen sound' },
    { id: 'flanger', name: 'Flanger', category: 'modulation', description: 'Sweeping comb filter effect' },
    { id: 'phaser', name: 'Phaser', category: 'modulation', description: 'Swirling phase effect' },
    { id: 'tremolo', name: 'Tremolo', category: 'modulation', description: 'Volume modulation' },
    { id: 'vibrato', name: 'Vibrato', category: 'modulation', description: 'Pitch modulation' },

    // Delay
    { id: 'delay-simple', name: 'Delay', category: 'delay', description: 'Echo effect' },
    { id: 'delay-ping-pong', name: 'Ping Pong Delay', category: 'delay', description: 'Stereo bouncing delay' },
    { id: 'delay-tape', name: 'Tape Delay', category: 'delay', description: 'Vintage tape delay simulation' },

    // Reverb
    { id: 'reverb-room', name: 'Room Reverb', category: 'reverb', description: 'Small room ambience' },
    { id: 'reverb-hall', name: 'Hall Reverb', category: 'reverb', description: 'Large hall ambience' },
    { id: 'reverb-plate', name: 'Plate Reverb', category: 'reverb', description: 'Classic plate reverb' },
    { id: 'reverb-spring', name: 'Spring Reverb', category: 'reverb', description: 'Vintage spring reverb' },

    // Filter
    { id: 'filter-lp', name: 'Low Pass Filter', category: 'filter', description: 'Remove high frequencies' },
    { id: 'filter-hp', name: 'High Pass Filter', category: 'filter', description: 'Remove low frequencies' },
    { id: 'filter-bp', name: 'Band Pass Filter', category: 'filter', description: 'Keep only mid frequencies' },
    { id: 'filter-notch', name: 'Notch Filter', category: 'filter', description: 'Remove specific frequency' },

    // Restoration
    { id: 'denoise', name: 'Denoise', category: 'restoration', description: 'Remove background noise' },
    { id: 'declick', name: 'Declick', category: 'restoration', description: 'Remove clicks and pops' },
    { id: 'dehum', name: 'DeHum', category: 'restoration', description: 'Remove 50/60Hz hum' },
    { id: 'decrackle', name: 'Decrackle', category: 'restoration', description: 'Remove crackle from vinyl' },
  ];

  const filteredEffects = effects.filter(effect => {
    const matchesSearch = effect.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         effect.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'all' || effect.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [
    { id: 'all', name: 'All', icon: Volume2 },
    { id: 'eq', name: 'EQ', icon: Wand2 },
    { id: 'dynamics', name: 'Dynamics', icon: Radio },
    { id: 'modulation', name: 'Modulation', icon: Music },
    { id: 'delay', name: 'Delay', icon: Mic },
    { id: 'reverb', name: 'Reverb', icon: Music },
    { id: 'filter', name: 'Filter', icon: Wand2 },
    { id: 'restoration', name: 'Restoration', icon: Mic },
  ];

  const getCategoryColor = (category: string) => {
    const colors = {
      eq: 'from-blue-500/30 to-cyan-500/30',
      dynamics: 'from-red-500/30 to-orange-500/30',
      modulation: 'from-purple-500/30 to-pink-500/30',
      delay: 'from-green-500/30 to-emerald-500/30',
      reverb: 'from-indigo-500/30 to-violet-500/30',
      filter: 'from-yellow-500/30 to-amber-500/30',
      restoration: 'from-teal-500/30 to-cyan-500/30',
    };
    return colors[category as keyof typeof colors] || 'from-gray-500/30 to-gray-600/30';
  };

  const getCategoryBadgeColor = (category: string) => {
    const colors = {
      eq: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      dynamics: 'bg-red-500/20 text-red-400 border-red-500/30',
      modulation: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      delay: 'bg-green-500/20 text-green-400 border-green-500/30',
      reverb: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      filter: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      restoration: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    };
    return colors[category as keyof typeof colors] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header with Search */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white mb-2">Audio Effects</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audio effects..."
            className="w-full h-[22px] bg-white/5 border border-white/10 rounded pl-7 pr-2 text-[11px] text-white placeholder-white/40
                     focus:outline-none focus:border-blue-400 focus:bg-white/10 hover:border-white/20 transition-colors"
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="px-2 py-2 border-b border-white/10 bg-white/5 overflow-x-auto custom-scrollbar">
        <div className="flex gap-1">
          {categories.map(category => {
            const Icon = category.icon;
            const isActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id as any)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-400/40'
                    : 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent'
                }`}
              >
                <Icon className="w-3 h-3 flex-shrink-0" />
                <span>{category.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Effects List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredEffects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Volume2 className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/40 text-[11px] text-center">
              No effects found
            </p>
            <p className="text-white/40 text-[10px] text-center mt-1.5">
              Try a different search or category
            </p>
          </div>
        ) : (
          <div>
            {filteredEffects.map(effect => (
              <button
                key={effect.id}
                onClick={() => onEffectSelect?.(effect.id)}
                onDoubleClick={() => onEffectAdd?.(effect.id)}
                className="group w-full px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/10 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  {/* Effect Icon */}
                  <div className={`w-10 h-10 rounded flex items-center justify-center bg-gradient-to-br ${getCategoryColor(effect.category)} flex-shrink-0`}>
                    <Volume2 className="w-4 h-4 text-white/80" />
                  </div>

                  {/* Effect Info */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[11px] font-medium text-white truncate group-hover:text-blue-400 transition-colors">
                      {effect.name}
                    </div>
                    <div className="text-[10px] text-white/70 truncate">
                      {effect.description}
                    </div>
                  </div>

                  {/* Category Badge */}
                  <div className={`px-2 py-0.5 rounded border ${getCategoryBadgeColor(effect.category)} flex-shrink-0`}>
                    <span className="text-[9px] font-medium uppercase">
                      {effect.category}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/10 bg-black/50">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/40">{filteredEffects.length} effects</span>
          <span className="text-white/60">Double-click to add</span>
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

export default AudioEffectsTab;
