import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Clock, Link2, Unlink } from 'lucide-react';

interface MotionParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  isAnimated?: boolean;
  isLocked?: boolean;
}

interface MotionTabProps {
  selectedClipId?: string;
  clipName?: string;
  onParameterChange?: (parameterId: string, value: number) => void;
  onKeyframeAdd?: (parameterId: string) => void;
  onLockToggle?: (parameterId: string) => void;
  onReset?: (parameterId: string) => void;
}

const MotionTab: React.FC<MotionTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onParameterChange,
  onKeyframeAdd,
  onLockToggle,
  onReset
}) => {
  const [motion, setMotion] = useState<MotionParameter[]>([
    { id: 'position-x', name: 'X', value: 960, min: -1920, max: 3840, step: 1, unit: 'px' },
    { id: 'position-y', name: 'Y', value: 540, min: -1080, max: 2160, step: 1, unit: 'px' },
    { id: 'scale-x', name: 'Width', value: 100, min: 0, max: 500, step: 0.1, unit: '%', isLocked: true },
    { id: 'scale-y', name: 'Height', value: 100, min: 0, max: 500, step: 0.1, unit: '%', isLocked: true },
    { id: 'rotation', name: 'Rotation', value: 0, min: -3600, max: 3600, step: 0.1, unit: '°' },
    { id: 'anchor-x', name: 'X', value: 960, min: 0, max: 1920, step: 1, unit: 'px' },
    { id: 'anchor-y', name: 'Y', value: 540, min: 0, max: 1080, step: 1, unit: 'px' },
    { id: 'opacity', name: 'Opacity', value: 100, min: 0, max: 100, step: 1, unit: '%' },
  ]);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['position', 'scale', 'rotation', 'anchor', 'opacity'])
  );

  const [uniformScale, setUniformScale] = useState(true);

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragParamId = useRef<string>('');
  const dragParamStep = useRef(0);
  const dragParamMin = useRef(0);
  const dragParamMax = useRef(0);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleParameterChange = (paramId: string, value: number) => {
    setMotion(prev => prev.map(p =>
      p.id === paramId ? { ...p, value } : p
    ));
    onParameterChange?.(paramId, value);

    if (uniformScale && (paramId === 'scale-x' || paramId === 'scale-y')) {
      const otherId = paramId === 'scale-x' ? 'scale-y' : 'scale-x';
      setMotion(prev => prev.map(p =>
        p.id === otherId ? { ...p, value } : p
      ));
      onParameterChange?.(otherId, value);
    }
  };

  const handleReset = (paramId: string) => {
    const param = motion.find(p => p.id === paramId);
    if (!param) return;

    let defaultValue = 0;
    if (paramId === 'position-x') defaultValue = 960;
    if (paramId === 'position-y') defaultValue = 540;
    if (paramId.startsWith('scale')) defaultValue = 100;
    if (paramId === 'anchor-x') defaultValue = 960;
    if (paramId === 'anchor-y') defaultValue = 540;
    if (paramId === 'opacity') defaultValue = 100;

    handleParameterChange(paramId, defaultValue);
    onReset?.(paramId);
  };

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, param: MotionParameter) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = param.value;
    dragParamId.current = param.id;
    dragParamStep.current = param.step;
    dragParamMin.current = param.min;
    dragParamMax.current = param.max;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      const sensitivity = dragParamStep.current * 0.5;
      let newValue = dragStartValue.current + (deltaX * sensitivity);

      // Apply constraints
      newValue = Math.max(dragParamMin.current, Math.min(dragParamMax.current, newValue));

      handleParameterChange(dragParamId.current, newValue);
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

  const renderPropertyRow = (param: MotionParameter, showKeyframe = true) => {
    return (
      <div
        key={param.id}
        className="group flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors"
      >
        {/* Parameter Label */}
        <label className="text-[11px] font-normal text-white/70 w-12 flex-shrink-0 cursor-ew-resize select-none">
          {param.name}
        </label>

        {/* Value Input */}
        <div className="flex items-center gap-1 flex-1">
          <input
            type="number"
            value={param.value.toFixed(param.step < 1 ? 1 : 0)}
            onChange={(e) => handleParameterChange(param.id, parseFloat(e.target.value) || 0)}
            onMouseDown={(e) => handleInputMouseDown(e, param)}
            className="w-full h-[20px] px-1.5 text-[11px] font-mono bg-white/5 border border-white/10 rounded text-white text-right
                     focus:outline-none focus:border-blue-400 focus:bg-white/10 transition-colors
                     hover:border-white/20 cursor-ew-resize
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            step={param.step}
          />
          {param.unit && (
            <span className="text-[10px] text-white/40 w-[18px] text-left flex-shrink-0">
              {param.unit}
            </span>
          )}
        </div>

        {/* Control Icons */}
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {showKeyframe && (
            <button
              onClick={() => {
                setMotion(prev => prev.map(p =>
                  p.id === param.id ? { ...p, isAnimated: !p.isAnimated } : p
                ));
                onKeyframeAdd?.(param.id);
              }}
              className={`p-1 rounded transition-all ${
                param.isAnimated
                  ? 'text-blue-400 bg-blue-500/20'
                  : 'text-white/60 hover:text-white'
              }`}
              title="Toggle Animation"
            >
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M6 2L8 6L6 10L4 6Z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => handleReset(param.id)}
            className="p-1 rounded text-white/60 hover:text-white transition-colors"
            title="Reset Value"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  const renderSection = (title: string, sectionId: string, children: React.ReactNode) => {
    const isExpanded = expandedSections.has(sectionId);

    return (
      <div className="border-t border-white/10">
        <button
          onClick={() => toggleSection(sectionId)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-black/50 hover:bg-white/10 transition-all"
        >
          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <ChevronDown className="w-3 h-3 text-white/60" />
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
            {title}
          </span>
        </button>
        {isExpanded && (
          <div className="bg-black/40">
            {children}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white truncate">{clipName}</div>
        <div className="text-[10px] text-white/60 mt-0.5">Effect Controls</div>
      </div>

      {/* Motion Controls */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Position */}
        {renderSection('POSITION', 'position', (
          <div className="py-1">
            {renderPropertyRow(motion.find(p => p.id === 'position-x')!)}
            {renderPropertyRow(motion.find(p => p.id === 'position-y')!)}
          </div>
        ))}

        {/* Scale */}
        {renderSection('SCALE', 'scale', (
          <div className="py-1">
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/5">
              <span className="text-[10px] text-white/60">Uniform Scale</span>
              <button
                onClick={() => setUniformScale(!uniformScale)}
                className={`p-1 rounded transition-all ${
                  uniformScale
                    ? 'text-blue-400 bg-blue-500/20'
                    : 'text-white/40 hover:text-white/60'
                }`}
                title={uniformScale ? 'Linked' : 'Unlinked'}
              >
                {uniformScale ? <Link2 className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
              </button>
            </div>
            {renderPropertyRow(motion.find(p => p.id === 'scale-x')!)}
            {renderPropertyRow(motion.find(p => p.id === 'scale-y')!)}
          </div>
        ))}

        {/* Rotation */}
        {renderSection('ROTATION', 'rotation', (
          <div className="py-1">
            {renderPropertyRow(motion.find(p => p.id === 'rotation')!)}
            <div className="px-3 py-2">
              <div className="h-[60px] bg-white/5 rounded border border-white/10 flex items-center justify-center">
                <svg className="w-12 h-12 text-blue-500/20" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2" fill="none" />
                  <path d="M24 4 L28 8 L20 8 Z" fill="currentColor" />
                </svg>
              </div>
            </div>
          </div>
        ))}

        {/* Anchor Point */}
        {renderSection('ANCHOR POINT', 'anchor', (
          <div className="py-1">
            {renderPropertyRow(motion.find(p => p.id === 'anchor-x')!)}
            {renderPropertyRow(motion.find(p => p.id === 'anchor-y')!)}
          </div>
        ))}

        {/* Opacity */}
        {renderSection('OPACITY', 'opacity', (
          <div className="py-1">
            {renderPropertyRow(motion.find(p => p.id === 'opacity')!)}
            <div className="px-3 py-2">
              <div className="relative h-2 bg-white/5 rounded border border-white/10">
                <div
                  className="absolute inset-y-0 left-0 bg-white/20 rounded transition-all"
                  style={{ width: `${motion.find(p => p.id === 'opacity')?.value || 0}%` }}
                />
              </div>
            </div>
          </div>
        ))}

        {/* Blend Mode */}
        {renderSection('BLEND MODE', 'blend', (
          <div className="p-3">
            <select
              className="w-full h-[22px] px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white
                       focus:outline-none focus:border-blue-400 cursor-pointer hover:border-white/20 transition-colors"
              defaultValue="normal"
            >
              <option value="normal">Normal</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="overlay">Overlay</option>
              <option value="darken">Darken</option>
              <option value="lighten">Lighten</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="color-burn">Color Burn</option>
              <option value="hard-light">Hard Light</option>
              <option value="soft-light">Soft Light</option>
              <option value="difference">Difference</option>
              <option value="exclusion">Exclusion</option>
            </select>
          </div>
        ))}
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

export default MotionTab;
