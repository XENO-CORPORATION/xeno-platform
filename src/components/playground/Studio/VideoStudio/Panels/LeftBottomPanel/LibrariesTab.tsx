import React, { useState } from 'react';
import { Database, FolderOpen, Plus, Download, Upload, Trash2, Search, Star } from 'lucide-react';

interface Library {
  id: string;
  name: string;
  type: 'local' | 'cloud' | 'stock';
  itemCount: number;
  isFavorite: boolean;
}

interface LibrariesTabProps {
  onLibrarySelect?: (libraryId: string) => void;
  onLibraryCreate?: () => void;
  onLibraryImport?: () => void;
  onLibraryExport?: (libraryId: string) => void;
  onLibraryDelete?: (libraryId: string) => void;
}

const LibrariesTab: React.FC<LibrariesTabProps> = ({
  onLibrarySelect,
  onLibraryCreate,
  onLibraryImport,
  onLibraryExport,
  onLibraryDelete
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [libraries, setLibraries] = useState<Library[]>([
    { id: 'lib-1', name: 'My Assets', type: 'local', itemCount: 145, isFavorite: true },
    { id: 'lib-2', name: 'Stock Footage', type: 'stock', itemCount: 2500, isFavorite: true },
    { id: 'lib-3', name: 'Project Templates', type: 'local', itemCount: 32, isFavorite: false },
    { id: 'lib-4', name: 'Cloud Library', type: 'cloud', itemCount: 89, isFavorite: false },
    { id: 'lib-5', name: 'Music Library', type: 'local', itemCount: 256, isFavorite: true },
    { id: 'lib-6', name: 'Sound Effects', type: 'local', itemCount: 512, isFavorite: false },
  ]);

  const filteredLibraries = libraries.filter(library =>
    library.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleFavorite = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setLibraries(prev => prev.map(lib =>
      lib.id === libraryId ? { ...lib, isFavorite: !lib.isFavorite } : lib
    ));
  };

  const getTypeIcon = (type: Library['type']) => {
    switch (type) {
      case 'local': return FolderOpen;
      case 'cloud': return Database;
      case 'stock': return Download;
      default: return Database;
    }
  };

  const getTypeColor = (type: Library['type']) => {
    switch (type) {
      case 'local': return 'from-blue-500/30 to-cyan-500/30';
      case 'cloud': return 'from-purple-500/30 to-pink-500/30';
      case 'stock': return 'from-green-500/30 to-emerald-500/30';
      default: return 'from-gray-500/30 to-gray-600/30';
    }
  };

  const getTypeBadgeColor = (type: Library['type']) => {
    switch (type) {
      case 'local': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'cloud': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'stock': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header with Search */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white mb-2">Libraries</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search libraries..."
            className="w-full h-[22px] bg-white/5 border border-white/10 rounded pl-7 pr-2 text-[11px] text-white placeholder-white/40
                     focus:outline-none focus:border-blue-400 focus:bg-white/10 hover:border-white/20 transition-colors"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/5">
        <div className="flex gap-2">
          <button
            onClick={onLibraryCreate}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 rounded text-blue-400 text-[10px] font-medium transition-all"
            title="Create New Library"
          >
            <Plus className="w-3 h-3" />
            <span>Create</span>
          </button>
          <button
            onClick={onLibraryImport}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded text-white/70 text-[10px] font-medium transition-all"
            title="Import Library"
          >
            <Upload className="w-3 h-3" />
            <span>Import</span>
          </button>
        </div>
      </div>

      {/* Libraries List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {filteredLibraries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Database className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/40 text-[11px] text-center">
              No libraries found
            </p>
            <p className="text-white/40 text-[10px] text-center mt-1.5">
              Create or import a library to get started
            </p>
          </div>
        ) : (
          <div>
            {filteredLibraries.map(library => {
              const TypeIcon = getTypeIcon(library.type);
              return (
                <button
                  key={library.id}
                  onClick={() => onLibrarySelect?.(library.id)}
                  className="group w-full px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-white/10 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    {/* Library Icon */}
                    <div className={`w-10 h-10 rounded flex items-center justify-center bg-gradient-to-br ${getTypeColor(library.type)} flex-shrink-0`}>
                      <TypeIcon className="w-4 h-4 text-white/80" />
                    </div>

                    {/* Library Info */}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] font-medium text-white truncate group-hover:text-blue-400 transition-colors">
                          {library.name}
                        </div>
                        <button
                          onClick={(e) => toggleFavorite(library.id, e)}
                          className="flex-shrink-0"
                        >
                          <Star
                            className={`w-3 h-3 transition-colors ${
                              library.isFavorite
                                ? 'text-yellow-400 fill-yellow-400'
                                : 'text-white/40 hover:text-yellow-400'
                            }`}
                          />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/70">
                          {library.itemCount.toLocaleString()} items
                        </span>
                        <span className="text-[10px] text-white/40">•</span>
                        <div className={`px-1.5 py-0.5 rounded border text-[9px] font-medium uppercase ${getTypeBadgeColor(library.type)}`}>
                          {library.type}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onLibraryExport?.(library.id);
                        }}
                        className="p-1.5 rounded hover:bg-white/5 transition-colors"
                        title="Export Library"
                      >
                        <Download className="w-3 h-3 text-white/60 hover:text-white transition-colors" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onLibraryDelete?.(library.id);
                        }}
                        className="p-1.5 rounded hover:bg-white/5 transition-colors"
                        title="Delete Library"
                      >
                        <Trash2 className="w-3 h-3 text-white/60 hover:text-red-400 transition-colors" />
                      </button>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/10 bg-black/50">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/40">{filteredLibraries.length} libraries</span>
          <button className="text-blue-400 hover:text-blue-400/80 font-medium transition-colors">
            Manage Libraries
          </button>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
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

export default LibrariesTab;
