import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
  Clock,
  Zap
} from 'lucide-react';

interface Keyframe {
  time: number;
  value: number;
}

interface EffectParameter {
  id: string;
  name: string;
  type: 'slider' | 'color' | 'checkbox' | 'dropdown' | 'point';
  value: number | string | boolean | [number, number];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  keyframes?: Keyframe[];
  isAnimated?: boolean;
}

interface Effect {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  expanded: boolean;
  parameters: EffectParameter[];
}

interface EffectControlsTabProps {
  selectedClipId?: string;
  clipName?: string;
  effects?: Effect[];
  onEffectToggle?: (effectId: string) => void;
  onEffectRemove?: (effectId: string) => void;
  onParameterChange?: (effectId: string, parameterId: string, value: any) => void;
  onKeyframeAdd?: (effectId: string, parameterId: string) => void;
}

const EffectControlsTab: React.FC<EffectControlsTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  effects = [],
  onEffectToggle,
  onEffectRemove,
  onParameterChange,
  onKeyframeAdd
}) => {
  const [expandedEffects, setExpandedEffects] = useState<Set<string>>(new Set(effects.map(e => e.id)));

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragEffectId = useRef<string>('');
  const dragParamId = useRef<string>('');
  const dragParamConfig = useRef<{ min: number; max: number; step: number }>({ min: 0, max: 100, step: 1 });

  const toggleEffect = (effectId: string) => {
    const newExpanded = new Set(expandedEffects);
    if (newExpanded.has(effectId)) {
      newExpanded.delete(effectId);
    } else {
      newExpanded.add(effectId);
    }
    setExpandedEffects(newExpanded);
  };

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, effect: Effect, param: EffectParameter) => {
    if (e.button !== 0) return; // Only left mouse button
    if (param.type !== 'slider') return; // Only for sliders
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = param.value as number;
    dragEffectId.current = effect.id;
    dragParamId.current = param.id;
    dragParamConfig.current = {
      min: param.min || 0,
      max: param.max || 100,
      step: param.step || 1
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      const sensitivity = dragParamConfig.current.step * 0.5;
      let newValue = dragStartValue.current + (deltaX * sensitivity);

      // Apply constraints
      newValue = Math.max(dragParamConfig.current.min, Math.min(dragParamConfig.current.max, newValue));

      onParameterChange?.(dragEffectId.current, dragParamId.current, newValue);
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

  const renderParameter = (effect: Effect, param: EffectParameter) => {
    switch (param.type) {
      case 'slider':
        return (
          <div key={param.id} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-white/70">{param.name}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={param.value as number}
                  onChange={(e) => onParameterChange?.(effect.id, param.id, parseFloat(e.target.value))}
                  onMouseDown={(e) => handleInputMouseDown(e, effect, param)}
                  className="w-16 h-6 px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-white/20 cursor-ew-resize
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  step={param.step || 0.1}
                />
                {param.unit && <span className="text-[10px] text-white/40">{param.unit}</span>}
                <button
                  onClick={() => onKeyframeAdd?.(effect.id, param.id)}
                  className={`p-1 rounded hover:bg-white/10 transition-colors ${
                    param.isAnimated ? 'text-blue-400' : 'text-white/40'
                  }`}
                  title="Add Keyframe"
                >
                  <Clock className="w-3 h-3" />
                </button>
              </div>
            </div>
            <input
              type="range"
              min={param.min || 0}
              max={param.max || 100}
              step={param.step || 1}
              value={param.value as number}
              onChange={(e) => onParameterChange?.(effect.id, param.id, parseFloat(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none
                       [&::-webkit-slider-thumb]:w-3
                       [&::-webkit-slider-thumb]:h-3
                       [&::-webkit-slider-thumb]:rounded-sm
                       [&::-webkit-slider-thumb]:bg-white
                       [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-webkit-slider-thumb]:border
                       [&::-webkit-slider-thumb]:border-white/20
                       [&::-webkit-slider-thumb]:shadow-lg
                       [&::-moz-range-thumb]:w-3
                       [&::-moz-range-thumb]:h-3
                       [&::-moz-range-thumb]:rounded-sm
                       [&::-moz-range-thumb]:bg-white
                       [&::-moz-range-thumb]:cursor-pointer
                       [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:shadow-lg"
              style={{
                background: `linear-gradient(to right, rgba(255,255,255,0.3) ${((param.value as number - (param.min || 0)) / ((param.max || 100) - (param.min || 0))) * 100}%, rgba(255,255,255,0.05) ${((param.value as number - (param.min || 0)) / ((param.max || 100) - (param.min || 0))) * 100}%)`
              }}
            />
          </div>
        );

      case 'color':
        return (
          <div key={param.id} className="flex items-center justify-between">
            <label className="text-[11px] text-white/70">{param.name}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={param.value as string}
                onChange={(e) => onParameterChange?.(effect.id, param.id, e.target.value)}
                className="w-10 h-6 rounded border border-white/10 cursor-pointer"
              />
              <input
                type="text"
                value={param.value as string}
                onChange={(e) => onParameterChange?.(effect.id, param.id, e.target.value)}
                className="w-20 h-6 px-2 text-[10px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-white/20"
              />
            </div>
          </div>
        );

      case 'checkbox':
        return (
          <div key={param.id} className="flex items-center justify-between">
            <label className="text-[11px] text-white/70">{param.name}</label>
            <input
              type="checkbox"
              checked={param.value as boolean}
              onChange={(e) => onParameterChange?.(effect.id, param.id, e.target.checked)}
              className="w-4 h-4 rounded border border-white/20 bg-white/5 cursor-pointer"
            />
          </div>
        );

      case 'dropdown':
        return (
          <div key={param.id} className="flex items-center justify-between">
            <label className="text-[11px] text-white/70">{param.name}</label>
            <select
              value={param.value as string}
              onChange={(e) => onParameterChange?.(effect.id, param.id, e.target.value)}
              className="h-6 px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-white/20 cursor-pointer"
            >
              <option value="option1">Option 1</option>
              <option value="option2">Option 2</option>
              <option value="option3">Option 3</option>
            </select>
          </div>
        );

      case 'point':
        const [x, y] = param.value as [number, number];
        return (
          <div key={param.id} className="space-y-1">
            <label className="text-[11px] text-white/70">{param.name}</label>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[10px] text-white/40">X:</span>
                <input
                  type="number"
                  value={x}
                  onChange={(e) => onParameterChange?.(effect.id, param.id, [parseFloat(e.target.value), y])}
                  className="flex-1 h-6 px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-white/20 cursor-ew-resize
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[10px] text-white/40">Y:</span>
                <input
                  type="number"
                  value={y}
                  onChange={(e) => onParameterChange?.(effect.id, param.id, [x, parseFloat(e.target.value)])}
                  className="flex-1 h-6 px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-white/20 cursor-ew-resize
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (!selectedClipId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
          <Zap className="w-8 h-8 text-white/20" />
        </div>
        <h4 className="text-white text-sm font-medium mb-2">Effect Controls</h4>
        <p className="text-white/40 text-xs max-w-xs">
          Select a clip on the timeline to view and edit its effects
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Clip Info Header */}
      <div className="px-3 py-2 border-b border-white/10 bg-white/5">
        <div className="text-xs font-medium text-white truncate">{clipName}</div>
        <div className="text-[10px] text-white/40">Effect Controls</div>
      </div>

      {/* Effects List */}
      <div className="flex-1 overflow-y-auto">
        {effects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <p className="text-white/40 text-xs text-center">
              No effects applied to this clip
            </p>
            <p className="text-white/20 text-[10px] text-center mt-2">
              Drag effects from the Effects panel
            </p>
          </div>
        ) : (
          <div className="py-2">
            {effects.map((effect) => (
              <div
                key={effect.id}
                className="border-b border-white/5 last:border-b-0"
              >
                {/* Effect Header */}
                <div className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors">
                  <button
                    onClick={() => toggleEffect(effect.id)}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    {expandedEffects.has(effect.id) ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </button>

                  <button
                    onClick={() => onEffectToggle?.(effect.id)}
                    className="text-white/60 hover:text-white transition-colors"
                    title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                  >
                    {effect.enabled ? (
                      <Eye className="w-3 h-3" />
                    ) : (
                      <EyeOff className="w-3 h-3" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {effect.name}
                    </div>
                    <div className="text-[10px] text-white/40">{effect.category}</div>
                  </div>

                  <button
                    onClick={() => onEffectRemove?.(effect.id)}
                    className="text-white/40 hover:text-red-400 transition-colors"
                    title="Remove effect"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>

                  <button
                    className="text-white/40 hover:text-white transition-colors"
                    title="Reset effect"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>

                {/* Effect Parameters */}
                {expandedEffects.has(effect.id) && (
                  <div className="px-3 py-2 space-y-3 bg-black/20">
                    {effect.parameters.map((param) => renderParameter(effect, param))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {effects.length > 0 && (
        <div className="px-3 py-1.5 border-t border-white/10 text-white/30 text-[9px]">
          {effects.length} {effects.length === 1 ? 'effect' : 'effects'} applied
        </div>
      )}
    </div>
  );
};

export default EffectControlsTab;
