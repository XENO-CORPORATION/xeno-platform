import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, VolumeX, Volume2, RotateCcw } from 'lucide-react';

interface AudioParameter {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  isAnimated?: boolean;
}

interface AudioTabProps {
  selectedClipId?: string;
  clipName?: string;
  onParameterChange?: (parameterId: string, value: number) => void;
  onKeyframeAdd?: (parameterId: string) => void;
  onReset?: (parameterId: string) => void;
}

const AudioTab: React.FC<AudioTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onParameterChange,
  onKeyframeAdd,
  onReset
}) => {
  const [isMuted, setIsMuted] = useState(false);

  const [audioParams, setAudioParams] = useState<AudioParameter[]>([
    { id: 'volume-percent', name: 'Volume', value: 100, min: 0, max: 200, step: 1, unit: '%' },
    { id: 'volume-db', name: 'Volume', value: 0, min: -60, max: 6, step: 0.1, unit: 'dB' },
    { id: 'pan', name: 'Pan', value: 0, min: -100, max: 100, step: 1, unit: '' },
    { id: 'bass', name: 'Bass', value: 0, min: -20, max: 20, step: 0.5, unit: 'dB' },
    { id: 'mid', name: 'Mid', value: 0, min: -20, max: 20, step: 0.5, unit: 'dB' },
    { id: 'treble', name: 'Treble', value: 0, min: -20, max: 20, step: 0.5, unit: 'dB' },
  ]);

  const [audioType, setAudioType] = useState('dialogue');

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['volume', 'pan', 'eq', 'type', 'effects'])
  );

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
    // Update the parameter
    setAudioParams(prev => prev.map(p =>
      p.id === paramId ? { ...p, value } : p
    ));
    onParameterChange?.(paramId, value);

    // Sync Volume % and dB
    if (paramId === 'volume-percent') {
      const dbValue = value > 0 ? 20 * Math.log10(value / 100) : -60;
      setAudioParams(prev => prev.map(p =>
        p.id === 'volume-db' ? { ...p, value: dbValue } : p
      ));
      onParameterChange?.('volume-db', dbValue);
    } else if (paramId === 'volume-db') {
      const percentValue = Math.pow(10, value / 20) * 100;
      setAudioParams(prev => prev.map(p =>
        p.id === 'volume-percent' ? { ...p, value: percentValue } : p
      ));
      onParameterChange?.('volume-percent', percentValue);
    }
  };

  const handleReset = (paramId: string) => {
    const param = audioParams.find(p => p.id === paramId);
    if (!param) return;

    let defaultValue = 0;
    if (paramId === 'volume-percent') defaultValue = 100;
    if (paramId === 'volume-db') defaultValue = 0;
    if (paramId === 'pan') defaultValue = 0;

    handleParameterChange(paramId, defaultValue);
    onReset?.(paramId);
  };

  const handleQuickEffect = (effect: string) => {
    console.log(`Applying quick effect: ${effect}`);
    // Quick effect logic would go here
  };

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, param: AudioParameter) => {
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

  const renderPropertyRow = (param: AudioParameter, showKeyframe = true) => {
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
                setAudioParams(prev => prev.map(p =>
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

  const renderSlider = (param: AudioParameter) => {
    const percentage = ((param.value - param.min) / (param.max - param.min)) * 100;

    return (
      <div className="px-3 py-2">
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={param.value}
          onChange={(e) => handleParameterChange(param.id, parseFloat(e.target.value))}
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
            background: `linear-gradient(to right, rgba(255,255,255,0.3) ${percentage}%, rgba(255,255,255,0.05) ${percentage}%)`
          }}
        />
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
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-white truncate">{clipName}</div>
            <div className="text-[10px] text-white/60 mt-0.5">Audio Controls</div>
          </div>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1.5 rounded transition-all flex-shrink-0 ml-2 ${
              isMuted
                ? 'text-red-400 bg-red-500/20'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Audio Controls */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Volume */}
        {renderSection('VOLUME', 'volume', (
          <div className="py-1">
            {renderPropertyRow(audioParams.find(p => p.id === 'volume-percent')!)}
            {renderSlider(audioParams.find(p => p.id === 'volume-percent')!)}
            {renderPropertyRow(audioParams.find(p => p.id === 'volume-db')!)}
            {renderSlider(audioParams.find(p => p.id === 'volume-db')!)}
          </div>
        ))}

        {/* Pan */}
        {renderSection('PAN', 'pan', (
          <div className="py-1">
            {renderPropertyRow(audioParams.find(p => p.id === 'pan')!)}
            {renderSlider(audioParams.find(p => p.id === 'pan')!)}
            <div className="px-3 py-2">
              <div className="flex justify-between text-[10px] text-white/40">
                <span>L</span>
                <span>C</span>
                <span>R</span>
              </div>
            </div>
          </div>
        ))}

        {/* EQ */}
        {renderSection('EQ', 'eq', (
          <div className="py-1">
            {renderPropertyRow(audioParams.find(p => p.id === 'bass')!)}
            {renderSlider(audioParams.find(p => p.id === 'bass')!)}
            {renderPropertyRow(audioParams.find(p => p.id === 'mid')!)}
            {renderSlider(audioParams.find(p => p.id === 'mid')!)}
            {renderPropertyRow(audioParams.find(p => p.id === 'treble')!)}
            {renderSlider(audioParams.find(p => p.id === 'treble')!)}
          </div>
        ))}

        {/* Audio Type */}
        {renderSection('AUDIO TYPE', 'type', (
          <div className="p-3">
            <select
              value={audioType}
              onChange={(e) => setAudioType(e.target.value)}
              className="w-full h-[22px] px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white
                       focus:outline-none focus:border-blue-400 cursor-pointer hover:border-white/20 transition-colors"
            >
              <option value="dialogue">Dialogue</option>
              <option value="music">Music</option>
              <option value="sfx">SFX</option>
              <option value="ambience">Ambience</option>
              <option value="other">Other</option>
            </select>
          </div>
        ))}

        {/* Quick Effects */}
        {renderSection('QUICK EFFECTS', 'effects', (
          <div className="p-3">
            <div className="grid grid-cols-2 gap-2">
              {['Normalize', 'Compress', 'Gate', 'Limiter', 'EQ', 'Reverb'].map((effect) => (
                <button
                  key={effect}
                  onClick={() => handleQuickEffect(effect)}
                  className="h-[24px] px-2 text-[10px] font-medium bg-white/5 border border-white/10 rounded text-white
                           hover:bg-black/60 hover:border-blue-400 transition-all focus:outline-none focus:border-blue-400"
                >
                  {effect}
                </button>
              ))}
            </div>
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

export default AudioTab;
