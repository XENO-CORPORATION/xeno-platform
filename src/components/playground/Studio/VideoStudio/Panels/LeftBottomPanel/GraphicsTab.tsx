import React, { useState } from 'react';
import { Type, Film, Sparkles, Layout, Grid, Search, Star } from 'lucide-react';

interface GraphicTemplate {
  id: string;
  name: string;
  category: 'title' | 'lower-third' | 'transition' | 'shape' | 'effect';
  thumbnail?: string;
  isFavorite?: boolean;
}

interface GraphicsTabProps {
  onTemplateSelect?: (templateId: string) => void;
  onTemplateAdd?: (templateId: string) => void;
}

const GraphicsTab: React.FC<GraphicsTabProps> = ({
  onTemplateSelect,
  onTemplateAdd
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'title' | 'lower-third' | 'transition' | 'shape' | 'effect'>('all');
  const [templates, setTemplates] = useState<GraphicTemplate[]>([
    // Titles
    { id: 'title-basic', name: 'Basic Title', category: 'title', isFavorite: true },
    { id: 'title-centered', name: 'Centered Title', category: 'title', isFavorite: false },
    { id: 'title-animated', name: 'Animated Title', category: 'title', isFavorite: true },
    { id: 'title-glitch', name: 'Glitch Title', category: 'title', isFavorite: false },
    { id: 'title-modern', name: 'Modern Title', category: 'title', isFavorite: false },
    { id: 'title-retro', name: 'Retro Title', category: 'title', isFavorite: false },

    // Lower Thirds
    { id: 'lt-simple', name: 'Simple Lower Third', category: 'lower-third', isFavorite: false },
    { id: 'lt-modern', name: 'Modern Lower Third', category: 'lower-third', isFavorite: true },
    { id: 'lt-broadcast', name: 'Broadcast Bar', category: 'lower-third', isFavorite: false },
    { id: 'lt-minimal', name: 'Minimal Banner', category: 'lower-third', isFavorite: false },

    // Transitions
    { id: 'trans-wipe', name: 'Wipe Transition', category: 'transition', isFavorite: false },
    { id: 'trans-zoom', name: 'Zoom Transition', category: 'transition', isFavorite: false },
    { id: 'trans-slide', name: 'Slide Transition', category: 'transition', isFavorite: false },

    // Shapes
    { id: 'shape-rect', name: 'Rectangle', category: 'shape', isFavorite: false },
    { id: 'shape-circle', name: 'Circle', category: 'shape', isFavorite: false },
    { id: 'shape-line', name: 'Line', category: 'shape', isFavorite: false },

    // Effects
    { id: 'effect-particles', name: 'Particles', category: 'effect', isFavorite: true },
    { id: 'effect-light', name: 'Light Leaks', category: 'effect', isFavorite: false },
    { id: 'effect-bokeh', name: 'Bokeh Overlay', category: 'effect', isFavorite: false },
  ]);

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'all' || template.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [
    { id: 'all', name: 'All', icon: Grid },
    { id: 'title', name: 'Titles', icon: Type },
    { id: 'lower-third', name: 'Lower Thirds', icon: Layout },
    { id: 'transition', name: 'Transitions', icon: Film },
    { id: 'shape', name: 'Shapes', icon: Sparkles },
    { id: 'effect', name: 'Effects', icon: Sparkles },
  ];

  const toggleFavorite = (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplates(prev => prev.map(t =>
      t.id === templateId ? { ...t, isFavorite: !t.isFavorite } : t
    ));
  };

  const getCategoryColor = (category: string) => {
    const colors = {
      title: 'from-blue-500/30 to-cyan-500/30',
      'lower-third': 'from-purple-500/30 to-pink-500/30',
      transition: 'from-green-500/30 to-emerald-500/30',
      shape: 'from-yellow-500/30 to-amber-500/30',
      effect: 'from-red-500/30 to-orange-500/30',
    };
    return colors[category as keyof typeof colors] || 'from-gray-500/30 to-gray-600/30';
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header with Search */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white mb-2">Graphics</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search graphics..."
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

      {/* Templates Grid */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Type className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/40 text-[11px] text-center">
              No graphics found
            </p>
            <p className="text-white/40 text-[10px] text-center mt-1.5">
              Try a different search or category
            </p>
          </div>
        ) : (
          <div className="p-3 grid grid-cols-2 gap-2">
            {filteredTemplates.map(template => (
              <button
                key={template.id}
                onClick={() => onTemplateSelect?.(template.id)}
                onDoubleClick={() => onTemplateAdd?.(template.id)}
                className="group relative aspect-video bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded overflow-hidden transition-all"
              >
                {/* Thumbnail Placeholder */}
                <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${getCategoryColor(template.category)}`}>
                  <Type className="w-8 h-8 text-white/60 group-hover:text-white transition-colors" />
                </div>

                {/* Favorite Star */}
                <button
                  onClick={(e) => toggleFavorite(template.id, e)}
                  className="absolute top-2 right-2 p-1 rounded bg-black/50 hover:bg-black/70 transition-all z-10"
                >
                  <Star
                    className={`w-3 h-3 transition-colors ${
                      template.isFavorite
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-white/60 hover:text-white'
                    }`}
                  />
                </button>

                {/* Template Info */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pt-6">
                  <div className="text-[10px] font-medium text-white truncate">
                    {template.name}
                  </div>
                  <div className="text-[9px] text-white/70 capitalize">
                    {template.category.replace('-', ' ')}
                  </div>
                </div>

                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="text-[10px] text-white font-medium px-2 py-1 bg-black/50 rounded">
                    Double-click to add
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
          <span className="text-white/40">{filteredTemplates.length} templates</span>
          <button className="text-blue-400 hover:text-blue-400/80 font-medium transition-colors">
            Browse More
          </button>
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

export default GraphicsTab;
