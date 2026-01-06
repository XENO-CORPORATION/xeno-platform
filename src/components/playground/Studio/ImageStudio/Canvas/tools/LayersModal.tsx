import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye, EyeOff, Plus, Folder, Square, Trash2, GripVertical, Edit3, Copy, Layers, Download, Group, Merge, ToggleLeft, ChevronDown, ChevronRight, Ungroup, Image as ImageIcon } from 'lucide-react';
import { Layer } from '../../core/types';

interface EditHistoryItem {
  id: string;
  prompt: string;
  editType?: string;
  url: string;
  timestamp?: string | number;
}

interface LayersContentProps {
  layers: Layer[];
  imageEditHistory: EditHistoryItem[];
  currentHistoryIndex: number;
  selectedLayerId: string | null;
  selectedLayerIds?: string[];
  layerOpacity: number;
  imageObj: HTMLImageElement | null;
  onLayersChange: (layers: Layer[]) => void;
  onLayerCanvasesChange: (canvases: { [key: string]: HTMLCanvasElement }) => void;
  onActiveLayerChange: (layerId: string | null) => void;
  onSelectedLayerChange: (layerId: string | null) => void;
  onSelectedLayerIdsChange?: (layerIds: string[]) => void;
  onHistoryIndexChange: (index: number) => void;
  onLayerOpacityChange: (opacity: number) => void;
  onRenderComposite: () => void;
  onClose?: () => void;
  onDetach?: (position: { x: number; y: number }, dragOffset?: { x: number; y: number }) => void;
}

interface LayersModalProps extends LayersContentProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover: (isHovering: boolean) => void;
  onOverlapChange?: (isOverlapping: boolean) => void;
  onReattach?: () => void;
}

const createLayerCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const LayersContent: React.FC<LayersContentProps> = ({
  layers,
  imageEditHistory,
  currentHistoryIndex,
  selectedLayerId,
  selectedLayerIds = [],
  layerOpacity,
  imageObj,
  onLayersChange,
  onLayerCanvasesChange,
  onActiveLayerChange,
  onSelectedLayerChange,
  onSelectedLayerIdsChange,
  onHistoryIndexChange,
  onLayerOpacityChange,
  onRenderComposite,
  onClose,
  onDetach
}) => {
  const [contextMenu, setContextMenu] = useState<{visible: boolean, x: number, y: number, layerId: string, type: string}>({ 
    visible: false, x: 0, y: 0, layerId: '', type: '' 
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleSelection = (id: string, shift: boolean) => {
    if (shift && onSelectedLayerIdsChange) {
      const next = selectedLayerIds.includes(id) ? selectedLayerIds.filter(i => i !== id) : [...selectedLayerIds, id];
      onSelectedLayerIdsChange(next);
    } else {
      onSelectedLayerIdsChange?.([id]);
      onSelectedLayerChange(id);
      onActiveLayerChange(id);
    }
  };

  const toggleVisibility = (id: string) => {
    const update = (arr: Layer[]): Layer[] => arr.map(l => {
      if (l.id === id) return { ...l, visible: !l.visible };
      if (l.groupLayers) return { ...l, groupLayers: update(l.groupLayers) };
      return l;
    });
    onLayersChange(update(layers));
    onRenderComposite();
  };

  const deleteLayer = (id: string) => {
    const update = (arr: Layer[]): Layer[] => arr.filter(l => l.id !== id).map(l => ({
      ...l, groupLayers: l.groupLayers ? update(l.groupLayers) : undefined
    }));
    const nextLayers = update(layers);
    onLayersChange(nextLayers);
    if (selectedLayerId === id) {
      onSelectedLayerChange(nextLayers.length > 0 ? nextLayers[nextLayers.length - 1].id : null);
    }
    onRenderComposite();
  };

  const handleDuplicateLayer = (id: string) => {
    const findLayer = (arr: Layer[]): Layer | null => {
      for (const l of arr) {
        if (l.id === id) return l;
        if (l.groupLayers) {
          const found = findLayer(l.groupLayers);
          if (found) return found;
        }
      }
      return null;
    };

    const original = findLayer(layers);
    if (!original || !imageObj) return;

    const newId = `layer-${Date.now()}`;
    const canvas = createLayerCanvas(imageObj.width, imageObj.height);
    if (original.canvas) {
      canvas.getContext('2d')?.drawImage(original.canvas, 0, 0);
    }

    const copy: Layer = {
      ...original,
      id: newId,
      name: `${original.name} Copy`,
      canvas,
      isSelected: true
    };

    onLayersChange([...layers.map(l => ({ ...l, isSelected: false })), copy]);
    onLayerCanvasesChange({ [newId]: canvas });
    onActiveLayerChange(newId);
    onSelectedLayerChange(newId);
    onRenderComposite();
  };

  const handleCreateNewLayer = () => {
    if (!imageObj) return;
    const id = `layer-${Date.now()}`;
    const canvas = createLayerCanvas(imageObj.width, imageObj.height);
    const newLayer: Layer = {
      id,
      name: `Layer ${layers.filter(l => !l.isGroup).length + 1}`,
      type: 'empty',
      visible: true,
      opacity: 100,
      canvas,
      isSelected: true,
      blendMode: 'normal'
    };
    onLayersChange([...layers.map(l => ({ ...l, isSelected: false })), newLayer]);
    onLayerCanvasesChange({ [id]: canvas });
    onActiveLayerChange(id);
    onSelectedLayerChange(id);
  };

  const handleCreateGroup = () => {
    if (selectedLayerIds.length < 2) return;
    
    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));
    const remainingLayers = layers.filter(l => !selectedLayerIds.includes(l.id));
    
    const groupId = `group-${Date.now()}`;
    const newGroup: Layer = {
      id: groupId,
      name: 'New Group',
      type: 'group',
      isGroup: true,
      visible: true,
      opacity: 100,
      groupLayers: selectedLayers.map(l => ({ ...l, parentGroupId: groupId, isSelected: false })),
      isExpanded: true,
      isSelected: true,
      blendMode: 'normal'
    };

    onLayersChange([...remainingLayers, newGroup]);
    onSelectedLayerChange(groupId);
    onSelectedLayerIdsChange?.([groupId]);
    onRenderComposite();
  };

  const mergeSelected = () => {
    if (!imageObj || selectedLayerIds.length < 2) return;
    
    const canvas = createLayerCanvas(imageObj.width, imageObj.height);
    const ctx = canvas.getContext('2d')!;
    
    // Sort selected layers by their index in the original layers array to preserve order
    const toMerge = [...layers]
      .filter(l => selectedLayerIds.includes(l.id));
      
    toMerge.forEach(l => {
      if (!l.visible) return;
      
      ctx.save();
      ctx.globalAlpha = l.opacity / 100;
      if (l.blendMode && l.blendMode !== 'normal') {
        ctx.globalCompositeOperation = l.blendMode as GlobalCompositeOperation;
      }
      
      if (l.canvas) {
        ctx.drawImage(l.canvas, 0, 0);
      } else if (l.type === 'background' && imageObj) {
        ctx.drawImage(imageObj, 0, 0);
      }
      ctx.restore();
    });

    const id = `merged-${Date.now()}`;
    const newLayer: Layer = { 
      id, 
      name: 'Merged Layer', 
      type: 'empty', 
      visible: true, 
      opacity: 100, 
      canvas, 
      isSelected: true,
      blendMode: 'normal'
    };

    // Find the highest index among selected layers to insert the merged layer there
    const highestIndex = Math.max(...selectedLayerIds.map(sid => layers.findIndex(l => l.id === sid)));
    const nextLayers = layers.filter(l => !selectedLayerIds.includes(l.id));
    nextLayers.splice(Math.max(0, highestIndex - selectedLayerIds.length + 1), 0, newLayer);

    onLayersChange(nextLayers);
    onLayerCanvasesChange({ [id]: canvas });
    onActiveLayerChange(id);
    onSelectedLayerChange(id);
    onSelectedLayerIdsChange?.([id]);
    onRenderComposite();
  };

  const renderLayer = (l: Layer, depth = 0) => {
    const isSelected = selectedLayerId === l.id || selectedLayerIds.includes(l.id);
    const isRenaming = renamingId === l.id;

    return (
      <div key={l.id}>
        <div 
          className={`flex items-center gap-2 p-2 rounded-md mb-1 cursor-pointer group transition-all duration-200 ${
            isSelected 
              ? 'bg-blue-600/30 border border-blue-400/40 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
              : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'
          }`}
          style={{ marginLeft: depth * 12 }}
          onClick={(e) => handleSelection(l.id, e.shiftKey)}
          onContextMenu={(e) => { 
            e.preventDefault(); 
            setContextMenu({ visible: true, x: e.clientX, y: e.clientY, layerId: l.id, type: l.isGroup ? 'group' : 'layer' }); 
          }}
        >
          <GripVertical size={12} className="text-white/20 group-hover:text-white/40" />
          
          <button 
            className="p-1 rounded hover:bg-white/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); toggleVisibility(l.id); }}
          >
            {l.visible ? <Eye size={14} className="text-white/70" /> : <EyeOff size={14} className="text-white/20" />}
          </button>
          
          <div className="w-8 h-8 bg-black/60 rounded border border-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
             {l.isGroup ? <Folder size={14} className="text-orange-400/80" /> : l.type === 'background' ? <ImageIcon size={14} className="text-blue-400/80" /> : <Square size={14} className="text-white/40" />}
          </div>

          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input 
                autoFocus 
                value={renameValue} 
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => {
                  onLayersChange(layers.map(layer => layer.id === l.id ? { ...layer, name: renameValue } : layer));
                  setRenamingId(null);
                }}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                className="w-full bg-black/50 text-[11px] px-1 py-0.5 outline-none border border-blue-500 rounded"
              />
            ) : (
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-white/90 truncate">{l.name}</span>
                <span className="text-[9px] text-white/30 uppercase tracking-tighter">
                  {l.isGroup ? `${l.groupLayers?.length || 0} Layers` : l.type === 'background' ? 'Base Image' : l.blendMode || 'Normal'}
                </span>
              </div>
            )}
          </div>
          
          {l.locked && <X size={10} className="text-white/20" />}
        </div>
        {l.isGroup && l.isExpanded && l.groupLayers?.map(sub => renderLayer(sub, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-transparent text-white select-none overflow-hidden">
      {/* Opacity Control */}
      <div className="p-3 border-b border-white/10 flex items-center gap-3 bg-white/5">
        <span className="text-[9px] uppercase text-white/40 font-bold tracking-wider">Opacity</span>
        <input 
          type="range" min="0" max="100" value={layerOpacity} 
          onChange={(e) => onLayerOpacityChange(parseInt(e.target.value))}
          className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
        />
        <span className="text-[10px] font-mono w-8 text-right text-white/60">{layerOpacity}%</span>
      </div>

      {/* Layers List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
        {/* Main Layers (Reverse order for Top-Down view) */}
        {[...layers].reverse().map(l => renderLayer(l))}

        {/* Edit History as Layers */}
        {imageEditHistory.length > 0 && (
          <div className="mt-6 pt-3 border-t border-white/10">
            <div className="px-1 mb-3 text-[9px] uppercase text-white/30 font-bold tracking-[0.1em]">AI Edit Stack</div>
            {[...imageEditHistory].reverse().map((edit, idx) => {
              const originalIdx = imageEditHistory.length - 1 - idx;
              const isSelected = currentHistoryIndex === originalIdx;
              return (
                <div 
                  key={edit.id}
                  onClick={() => onHistoryIndexChange(originalIdx)}
                  className={`flex items-center gap-3 p-2 rounded-md mb-1 cursor-pointer transition-all duration-200 ${
                    isSelected 
                      ? 'bg-purple-600/30 border border-purple-400/40 shadow-[0_0_15px_rgba(168,85,247,0.1)]' 
                      : 'bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/10'
                  }`}
                >
                  <div className="w-8 h-8 bg-black/60 rounded border border-white/10 overflow-hidden shrink-0 shadow-md">
                    <img src={edit.url} className="w-full h-full object-cover" alt="History preview" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-white/90 truncate">{edit.prompt}</div>
                    <div className="text-[9px] text-white/30 uppercase tracking-tighter">AI Generation</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-2 border-t border-white/10 flex items-center justify-between bg-black/40 px-4">
        <button 
          onClick={handleCreateNewLayer} 
          title="New Layer" 
          className="p-2 hover:bg-white/10 rounded-lg text-white/60 hover:text-blue-400 transition-all"
        >
          <Plus size={16} />
        </button>
        <button 
          onClick={handleCreateGroup} 
          title="New Group" 
          className={`p-2 rounded-lg transition-all ${selectedLayerIds.length >= 2 ? 'text-white/60 hover:bg-white/10 hover:text-orange-400' : 'text-white/20 cursor-not-allowed'}`}
          disabled={selectedLayerIds.length < 2}
        >
          <Folder size={16} />
        </button>
        <button 
          onClick={mergeSelected} 
          title="Merge Selected" 
          className={`p-2 rounded-lg transition-all ${selectedLayerIds.length >= 2 ? 'text-white/60 hover:bg-white/10 hover:text-green-400' : 'text-white/20 cursor-not-allowed'}`}
          disabled={selectedLayerIds.length < 2}
        >
          <Merge size={16} />
        </button>
        <button 
          onClick={() => selectedLayerId && deleteLayer(selectedLayerId)} 
          title="Delete Layer" 
          className={`p-2 rounded-lg transition-all ${selectedLayerId ? 'text-white/60 hover:bg-white/10 hover:text-red-400' : 'text-white/20 cursor-not-allowed'}`}
          disabled={!selectedLayerId}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Context Menu Portal */}
      {contextMenu.visible && createPortal(
        <div 
          className="fixed z-[10000] bg-black/95 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl py-1 min-w-[180px] text-white overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(prev => ({ ...prev, visible: false }))}
        >
          <button className="w-full text-left px-4 py-2 text-[11px] hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { setRenamingId(contextMenu.layerId); setRenameValue(layers.find(l => l.id === contextMenu.layerId)?.name || ''); setContextMenu(prev => ({ ...prev, visible: false })); }}>
            <Edit3 size={12} /> Rename Layer
          </button>
          <button className="w-full text-left px-4 py-2 text-[11px] hover:bg-blue-600 transition-colors flex items-center gap-2" onClick={() => { handleDuplicateLayer(contextMenu.layerId); setContextMenu(prev => ({ ...prev, visible: false })); }}>
            <Copy size={12} /> Duplicate Layer
          </button>
          <div className="h-px bg-white/10 my-1" />
          <button className="w-full text-left px-4 py-2 text-[11px] hover:bg-red-600 transition-colors flex items-center gap-2 text-red-400 hover:text-white" onClick={() => { deleteLayer(contextMenu.layerId); setContextMenu(prev => ({ ...prev, visible: false })); }}>
            <Trash2 size={12} /> Delete Layer
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

const LayersModal: React.FC<LayersModalProps> = (props) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    props.onBringToFront();
    props.onDragStart();
    
    const panelElement = e.currentTarget.closest('.layers-modal-container') as HTMLElement;
    if (!panelElement) return;
    
    const rect = panelElement.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!props.isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 256;
      const panelHeight = 384;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      props.onPositionChange({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      props.onDragEnd();
    };

    if (props.isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [props.isDragging, props.onPositionChange, props.onDragEnd]);

  if (!props.isVisible) return null;

  return (
    <div 
      className="fixed layers-modal-container"
      style={{ 
        left: props.position.x, 
        top: props.position.y, 
        zIndex: props.zIndex 
      }}
    >
      <div 
        className={`bg-black/90 backdrop-blur-md border rounded-lg w-64 h-96 overflow-hidden shadow-2xl transition-all duration-200 flex flex-col ${
          props.isDragging ? 'cursor-grabbing' : ''
        } ${
          props.isOnTop ? 'border-white/40' : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          props.onBringToFront();
        }}
        onMouseEnter={() => props.onHover?.(true)}
        onMouseLeave={() => props.onHover?.(false)}
      >
        {/* Header - Matches AdjustmentModal */}
        <div 
          className={`px-4 py-3 border-b border-white/10 flex items-center justify-between ${
            props.isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-colors duration-200 ${
            props.isDragging ? 'bg-white/5' : 'hover:bg-white/5'
          }`}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <div className={`w-1 h-1 rounded-full transition-colors ${props.isDragging ? 'bg-blue-400' : 'bg-white/40'}`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${props.isDragging ? 'bg-blue-400' : 'bg-white/40'}`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${props.isDragging ? 'bg-blue-400' : 'bg-white/40'}`}></div>
            </div>
            <h3 className="text-white text-sm font-medium">Layers</h3>
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); props.onClose(); }} 
            className="text-white/60 hover:text-white transition-colors p-1 rounded-md hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <LayersContent {...props} />
        </div>
      </div>
    </div>
  );
};

export default LayersModal;
