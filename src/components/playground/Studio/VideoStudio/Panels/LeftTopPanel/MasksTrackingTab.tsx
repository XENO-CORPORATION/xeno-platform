import React, { useState, useRef, useEffect } from 'react';
import { Box, Plus, Eye, EyeOff, Trash2, Square, Circle, Pen, ChevronDown, ChevronRight, RotateCcw, Activity } from 'lucide-react';

interface Mask {
  id: string;
  name: string;
  type: 'rectangle' | 'ellipse' | 'pen';
  enabled: boolean;
  inverted: boolean;
  feather: number;
  opacity: number;
  expansion: number;
  isTracked?: boolean;
}

interface MasksTrackingTabProps {
  selectedClipId?: string;
  clipName?: string;
  onMaskAdd?: (type: 'rectangle' | 'ellipse' | 'pen') => void;
  onMaskToggle?: (maskId: string) => void;
  onMaskRemove?: (maskId: string) => void;
  onMaskParameterChange?: (maskId: string, parameter: string, value: number | boolean) => void;
}

const MasksTrackingTab: React.FC<MasksTrackingTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onMaskAdd,
  onMaskToggle,
  onMaskRemove,
  onMaskParameterChange
}) => {
  const [masks, setMasks] = useState<Mask[]>([]);
  const [expandedMasks, setExpandedMasks] = useState<Set<string>>(new Set());
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragMaskId = useRef<string>('');
  const dragParameter = useRef<string>('');
  const dragMin = useRef(0);
  const dragMax = useRef(100);
  const dragSensitivity = useRef(0.5);

  const toggleMask = (maskId: string) => {
    const newExpanded = new Set(expandedMasks);
    if (newExpanded.has(maskId)) {
      newExpanded.delete(maskId);
    } else {
      newExpanded.add(maskId);
    }
    setExpandedMasks(newExpanded);
  };

  const handleAddMask = (type: 'rectangle' | 'ellipse' | 'pen') => {
    const newMask: Mask = {
      id: `mask-${Date.now()}`,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} Mask ${masks.length + 1}`,
      type,
      enabled: true,
      inverted: false,
      feather: 0,
      opacity: 100,
      expansion: 0,
      isTracked: false
    };
    setMasks([...masks, newMask]);
    setExpandedMasks(new Set([...expandedMasks, newMask.id]));
    onMaskAdd?.(type);
  };

  const handleMaskToggle = (maskId: string) => {
    setMasks(prev => prev.map(m =>
      m.id === maskId ? { ...m, enabled: !m.enabled } : m
    ));
    onMaskToggle?.(maskId);
  };

  const handleMaskRemove = (maskId: string) => {
    setMasks(prev => prev.filter(m => m.id !== maskId));
    setExpandedMasks(prev => {
      const newExpanded = new Set(prev);
      newExpanded.delete(maskId);
      return newExpanded;
    });
    onMaskRemove?.(maskId);
  };

  const handleParameterChange = (maskId: string, parameter: string, value: number | boolean) => {
    setMasks(prev => prev.map(m =>
      m.id === maskId ? { ...m, [parameter]: value } : m
    ));
    onMaskParameterChange?.(maskId, parameter, value);
  };

  const handleReset = (maskId: string, parameter: string) => {
    const defaultValues: Record<string, number> = {
      feather: 0,
      opacity: 100,
      expansion: 0
    };
    handleParameterChange(maskId, parameter, defaultValues[parameter] ?? 0);
  };

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, maskId: string, parameter: string, value: number) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = value;
    dragMaskId.current = maskId;
    dragParameter.current = parameter;

    // Store min/max/sensitivity based on parameter type
    if (parameter === 'opacity') {
      dragMin.current = 0;
      dragMax.current = 100;
      dragSensitivity.current = 0.5;
    } else if (parameter === 'expansion') {
      dragMin.current = -50;
      dragMax.current = 50;
      dragSensitivity.current = 0.05;
    } else { // feather
      dragMin.current = 0;
      dragMax.current = 100;
      dragSensitivity.current = 0.05;
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      let newValue = dragStartValue.current + (deltaX * dragSensitivity.current);

      // Apply constraints
      newValue = Math.max(dragMin.current, Math.min(dragMax.current, newValue));

      handleParameterChange(dragMaskId.current, dragParameter.current, newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const renderPropertyRow = (mask: Mask, parameter: string, label: string, min: number, max: number, step: number, unit: string) => {
    const value = mask[parameter as keyof Mask] as number;

    return (
      <div className="group space-y-1.5">
        <div className="flex items-center gap-2 px-3 py-1 hover:bg-black/60 transition-colors">
          <label className="text-[11px] font-normal text-white/70 w-20 flex-shrink-0 cursor-ew-resize select-none">
            {label}
          </label>
          <div className="flex items-center gap-1 flex-1">
            <input
              type="number"
              value={value.toFixed(step < 1 ? 1 : 0)}
              onChange={(e) => handleParameterChange(mask.id, parameter, parseFloat(e.target.value) || 0)}
              onMouseDown={(e) => handleInputMouseDown(e, mask.id, parameter, value)}
              className="w-full h-[20px] px-1.5 text-[11px] font-mono bg-white/5 border border-white/10 rounded text-white text-right
                       focus:outline-none focus:border-blue-400 focus:bg-white/10 hover:border-white/20 transition-colors cursor-ew-resize
                       [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              step={step}
            />
            <span className="text-[10px] text-white/40 w-[22px] text-left flex-shrink-0">
              {unit}
            </span>
          </div>
          <button
            onClick={() => handleReset(mask.id, parameter)}
            className="p-1 rounded text-white/60 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
            title="Reset Value"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
        <div className="px-3">
          <div className="relative h-2 bg-white/5 rounded border border-white/10">
            <div
              className="absolute inset-y-0 left-0 bg-blue-400 rounded transition-all"
              style={{
                width: `${((value - min) / (max - min)) * 100}%`,
                left: min < 0 ? `${(Math.abs(min) / (max - min)) * 100}%` : '0'
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white truncate">{clipName}</div>
        <div className="text-[10px] text-white/60 mt-0.5">Masks & Tracking</div>
      </div>

      {/* Mask Creation Tools */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-white/5">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-white/90 mb-2">
          Create Mask
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleAddMask('rectangle')}
            className="flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all group"
            title="Rectangle Mask"
          >
            <Square className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
            <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Rectangle</span>
          </button>
          <button
            onClick={() => handleAddMask('ellipse')}
            className="flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all group"
            title="Ellipse Mask"
          >
            <Circle className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
            <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Ellipse</span>
          </button>
          <button
            onClick={() => handleAddMask('pen')}
            className="flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all group"
            title="Pen Tool Mask"
          >
            <Pen className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
            <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Pen</span>
          </button>
        </div>
      </div>

      {/* Masks List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {masks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <Box className="w-12 h-12 text-white/20 mb-3" />
            <p className="text-white/40 text-[11px] text-center">
              No masks created
            </p>
            <p className="text-white/40 text-[10px] text-center mt-1.5">
              Use the tools above to create a mask
            </p>
          </div>
        ) : (
          <div>
            {masks.map((mask, index) => {
              const isExpanded = expandedMasks.has(mask.id);

              return (
                <div key={mask.id} className={index > 0 ? 'border-t border-white/10' : ''}>
                  {/* Mask Header */}
                  <div className="group flex items-center gap-2 px-3 py-2 bg-black/50 hover:bg-white/10 transition-all">
                    <button
                      onClick={() => toggleMask(mask.id)}
                      className="transition-transform duration-200"
                      style={{ transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                    >
                      <ChevronDown className="w-3 h-3 text-white/60" />
                    </button>

                    <button
                      onClick={() => handleMaskToggle(mask.id)}
                      className={`transition-colors ${
                        mask.enabled ? 'text-blue-400' : 'text-white/40'
                      }`}
                      title={mask.enabled ? 'Disable mask' : 'Enable mask'}
                    >
                      {mask.enabled ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3" />
                      )}
                    </button>

                    {mask.type === 'rectangle' && <Square className="w-3 h-3 text-white/60" />}
                    {mask.type === 'ellipse' && <Circle className="w-3 h-3 text-white/60" />}
                    {mask.type === 'pen' && <Pen className="w-3 h-3 text-white/60" />}

                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium text-white truncate">{mask.name}</div>
                    </div>

                    {mask.isTracked && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/20 rounded">
                        <Activity className="w-2.5 h-2.5 text-blue-400" />
                        <span className="text-[9px] text-blue-400">TRACKED</span>
                      </div>
                    )}

                    <button
                      onClick={() => handleMaskRemove(mask.id)}
                      className="text-white/40 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove mask"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Mask Parameters */}
                  {isExpanded && (
                    <div className="bg-black/40 py-2 space-y-2">
                      {/* Feather */}
                      {renderPropertyRow(mask, 'feather', 'Feather', 0, 100, 0.1, 'px')}

                      {/* Opacity */}
                      {renderPropertyRow(mask, 'opacity', 'Opacity', 0, 100, 1, '%')}

                      {/* Expansion */}
                      {renderPropertyRow(mask, 'expansion', 'Expansion', -50, 50, 0.1, 'px')}

                      {/* Inverted Toggle */}
                      <div className="flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors">
                        <label className="text-[11px] font-normal text-white/70">Inverted</label>
                        <button
                          onClick={() => handleParameterChange(mask.id, 'inverted', !mask.inverted)}
                          className={`w-9 h-5 rounded-full transition-all ${
                            mask.inverted
                              ? 'bg-blue-400'
                              : 'bg-white/10'
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                              mask.inverted ? 'translate-x-[18px]' : 'translate-x-[2px]'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Motion Tracking Section */}
      <div className="border-t border-white/10 bg-white/5">
        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-white/60" />
              <label className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
                Motion Tracking
              </label>
            </div>
            <button
              onClick={() => setTrackingEnabled(!trackingEnabled)}
              className={`w-9 h-5 rounded-full transition-all ${
                trackingEnabled
                  ? 'bg-blue-400'
                  : 'bg-white/10'
              }`}
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                  trackingEnabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                }`}
              />
            </button>
          </div>
          {trackingEnabled && (
            <div className="space-y-2">
              <button className="w-full px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 rounded text-blue-400 text-[11px] font-medium transition-all">
                Track Forward
              </button>
              <button className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded text-white/70 text-[11px] font-medium transition-all">
                Track Backward
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer Stats */}
      {masks.length > 0 && (
        <div className="px-3 py-1.5 border-t border-white/10 bg-black/50">
          <div className="text-[10px] text-white/40">
            {masks.length} {masks.length === 1 ? 'mask' : 'masks'} • {masks.filter(m => m.enabled).length} active
          </div>
        </div>
      )}

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

export default MasksTrackingTab;
