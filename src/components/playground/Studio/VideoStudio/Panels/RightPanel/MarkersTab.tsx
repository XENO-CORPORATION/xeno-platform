import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Flag, AlertCircle, Star, ListChecks } from 'lucide-react';

interface Marker {
  id: string;
  time: number;
  name: string;
  comment: string;
  color: string;
  type: 'marker' | 'comment' | 'chapter' | 'cue';
}

interface MarkersTabProps {
  selectedClipId?: string;
  clipName?: string;
  onMarkerAdd?: (time: number) => void;
  onMarkerEdit?: (markerId: string, data: Partial<Marker>) => void;
  onMarkerDelete?: (markerId: string) => void;
  onMarkerSeek?: (time: number) => void;
}

const MarkersTab: React.FC<MarkersTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onMarkerAdd,
  onMarkerEdit,
  onMarkerDelete,
  onMarkerSeek
}) => {
  const [markers, setMarkers] = useState<Marker[]>([
    { id: 'm1', time: 5.2, name: 'Intro Start', comment: '', color: '#3b82f6', type: 'marker' },
    { id: 'm2', time: 12.8, name: 'Main Content', comment: 'Key scene begins', color: '#10b981', type: 'chapter' },
    { id: 'm3', time: 28.4, name: 'Graphics In', comment: '', color: '#f59e0b', type: 'cue' },
    { id: 'm4', time: 45.1, name: 'Review Section', comment: 'Check color grade', color: '#ef4444', type: 'comment' },
  ]);

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAddMarker = () => {
    const newMarker: Marker = {
      id: `m${Date.now()}`,
      time: 0,
      name: 'New Marker',
      comment: '',
      color: '#3b82f6',
      type: 'marker'
    };
    setMarkers(prev => [...prev, newMarker].sort((a, b) => a.time - b.time));
    setEditingId(newMarker.id);
    onMarkerAdd?.(0);
  };

  const handleDeleteMarker = (markerId: string) => {
    setMarkers(prev => prev.filter(m => m.id !== markerId));
    onMarkerDelete?.(markerId);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const getTypeIcon = (type: Marker['type']) => {
    switch (type) {
      case 'marker': return Flag;
      case 'comment': return AlertCircle;
      case 'chapter': return Star;
      case 'cue': return ListChecks;
      default: return Flag;
    }
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2 bg-black/50 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          Markers
        </h3>
        <div className="text-[9px] text-white/60 mt-0.5 truncate">{clipName}</div>
      </div>

      {/* Add Marker Button */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/5">
        <button
          onClick={handleAddMarker}
          className="w-full flex items-center justify-center gap-1.5 h-[26px] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-400 rounded text-blue-400 text-[10px] font-semibold uppercase tracking-wider transition-all"
        >
          <Plus size={12} />
          <span>Add Marker at Playhead</span>
        </button>
      </div>

      {/* Markers List */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.1) rgba(0,0,0,0.3)',
        }}
      >
        <style>
          {`
            div::-webkit-scrollbar {
              width: 8px;
            }
            div::-webkit-scrollbar-track {
              background: rgba(0,0,0,0.3);
            }
            div::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.1);
              border-radius: 4px;
            }
            div::-webkit-scrollbar-thumb:hover {
              background: rgba(255,255,255,0.2);
            }
          `}
        </style>

        {markers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <ListChecks size={48} className="text-white/20 mb-3" />
            <p className="text-white/60 text-[11px]">No markers yet</p>
            <p className="text-white/40 text-[9px] mt-1">Click the button above to add a marker</p>
          </div>
        ) : (
          <div className="py-1">
            {markers.map(marker => {
              const TypeIcon = getTypeIcon(marker.type);
              const isEditing = editingId === marker.id;

              return (
                <div
                  key={marker.id}
                  className="group px-3 py-2 hover:bg-white/5 transition-colors border-b border-white/10 last:border-b-0"
                >
                  <div className="flex items-start gap-2">
                    {/* Color Badge & Icon */}
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 border"
                      style={{
                        backgroundColor: marker.color + '20',
                        borderColor: marker.color + '40'
                      }}
                    >
                      <TypeIcon
                        size={12}
                        style={{ color: marker.color }}
                      />
                    </div>

                    {/* Marker Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => onMarkerSeek?.(marker.time)}
                          className="text-[10px] font-mono text-blue-400 hover:text-blue-400 transition-colors"
                        >
                          {formatTime(marker.time)}
                        </button>
                        <span
                          className="text-[8px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: marker.color + '20',
                            color: marker.color
                          }}
                        >
                          {marker.type}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={marker.name}
                            onChange={(e) => {
                              setMarkers(prev => prev.map(m =>
                                m.id === marker.id ? { ...m, name: e.target.value } : m
                              ));
                            }}
                            className="w-full h-[22px] px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white focus:outline-none focus:border-blue-400 transition-colors"
                            placeholder="Marker name"
                          />
                          <textarea
                            value={marker.comment}
                            onChange={(e) => {
                              setMarkers(prev => prev.map(m =>
                                m.id === marker.id ? { ...m, comment: e.target.value } : m
                              ));
                            }}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white resize-none focus:outline-none focus:border-blue-400 transition-colors"
                            rows={2}
                            placeholder="Comment..."
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setEditingId(null);
                                onMarkerEdit?.(marker.id, marker);
                              }}
                              className="flex-1 h-[22px] bg-blue-400 hover:bg-blue-500 border border-blue-400 rounded text-white text-[10px] font-semibold uppercase tracking-wider transition-all"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex-1 h-[22px] bg-white/5 hover:bg-white/10 border border-white/10 rounded text-white/60 text-[10px] font-semibold uppercase tracking-wider transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-[11px] font-medium text-white truncate">
                            {marker.name}
                          </div>
                          {marker.comment && (
                            <div className="text-[9px] text-white/60 truncate mt-1">
                              {marker.comment}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditingId(marker.id)}
                          className="p-1 hover:bg-white/10 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={12} className="text-white/60 hover:text-blue-400 transition-colors" />
                        </button>
                        <button
                          onClick={() => handleDeleteMarker(marker.id)}
                          className="p-1 hover:bg-white/10 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={12} className="text-white/60 hover:text-red-400 transition-colors" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {markers.length > 0 && (
        <div className="px-3 py-1.5 border-t border-white/10 bg-white/5">
          <div className="text-[9px] text-white/60 uppercase tracking-wider">
            {markers.length} {markers.length === 1 ? 'marker' : 'markers'}
          </div>
        </div>
      )}
    </div>
  );
};

export default MarkersTab;
