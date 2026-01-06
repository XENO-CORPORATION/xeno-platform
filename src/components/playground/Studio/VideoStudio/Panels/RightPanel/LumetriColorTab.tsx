import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';

interface LumetriColorTabProps {
  selectedClipId?: string;
  clipName?: string;
  onParameterChange?: (parameterId: string, value: number) => void;
  onReset?: (section: string) => void;
}

const LumetriColorTab: React.FC<LumetriColorTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onParameterChange,
  onReset
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    creative: false,
    wheels: false,
    curves: false,
    hsl: false,
    vignette: false,
  });

  // Basic Correction
  const [basicParams, setBasicParams] = useState({
    temperature: 0,
    tint: 0,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    saturation: 100,
  });

  // Creative
  const [creativeParams, setCreativeParams] = useState({
    look: 'None',
    intensity: 100,
    sharpening: 0,
    vibrance: 0,
  });

  // Color Wheels
  const [wheelParams, setWheelParams] = useState({
    shadows: { lift: 0, gamma: 0, gain: 0 },
    midtones: { lift: 0, gamma: 0, gain: 0 },
    highlights: { lift: 0, gamma: 0, gain: 0 },
  });

  // HSL Secondary
  const [hslParams, setHslParams] = useState({
    hue: 0,
    saturation: 0,
    luminance: 0,
  });

  // Vignette
  const [vignetteParams, setVignetteParams] = useState({
    amount: 0,
    midpoint: 50,
    roundness: 50,
    feather: 50,
  });

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragOnChange = useRef<(value: number) => void>(() => {});
  const dragMin = useRef(0);
  const dragMax = useRef(100);
  const dragSensitivity = useRef(0.5);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const resetSection = (section: string) => {
    switch (section) {
      case 'basic':
        setBasicParams({
          temperature: 0,
          tint: 0,
          exposure: 0,
          contrast: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          saturation: 100,
        });
        break;
      case 'creative':
        setCreativeParams({ look: 'None', intensity: 100, sharpening: 0, vibrance: 0 });
        break;
      case 'wheels':
        setWheelParams({
          shadows: { lift: 0, gamma: 0, gain: 0 },
          midtones: { lift: 0, gamma: 0, gain: 0 },
          highlights: { lift: 0, gamma: 0, gain: 0 },
        });
        break;
      case 'hsl':
        setHslParams({ hue: 0, saturation: 0, luminance: 0 });
        break;
      case 'vignette':
        setVignetteParams({ amount: 0, midpoint: 50, roundness: 50, feather: 50 });
        break;
    }
    onReset?.(section);
  };

  // Handle drag-to-adjust for numeric inputs
  const handleInputMouseDown = (e: React.MouseEvent, value: number, min: number, max: number, onChange: (value: number) => void) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = value;
    dragOnChange.current = onChange;
    dragMin.current = min;
    dragMax.current = max;
    dragSensitivity.current = 0.5;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      let newValue = dragStartValue.current + (deltaX * dragSensitivity.current);

      // Apply constraints
      newValue = Math.max(dragMin.current, Math.min(dragMax.current, newValue));

      dragOnChange.current(newValue);
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

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    gradient?: string
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-white/60">{label}</label>
        <input
          type="number"
          value={value.toFixed(0)}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onMouseDown={(e) => handleInputMouseDown(e, value, min, max, onChange)}
          className="w-12 h-[20px] px-1.5 text-[11px] font-mono text-right bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-ew-resize
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
      <div className="relative h-[4px] bg-black/20 rounded-full overflow-hidden">
        {gradient && (
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: gradient }}
          />
        )}
        <div
          className="absolute left-0 top-0 h-full bg-white/30 transition-all"
          style={{ width: `${((value - min) / (max - min)) * 100}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent
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
        />
      </div>
    </div>
  );

  const renderColorWheel = (label: string, params: { lift: number; gamma: number; gain: number }) => (
    <div className="space-y-2">
      <label className="text-[10px] text-white/60 uppercase tracking-wider font-semibold block text-center">
        {label}
      </label>
      <div className="flex items-center justify-center p-3 bg-black/40 rounded border border-white/10">
        <svg width="64" height="64" viewBox="0 0 64 64" className="filter drop-shadow-lg">
          <defs>
            <radialGradient id={`${label}-gradient`}>
              <stop offset="0%" stopColor="#808080" />
              <stop offset="100%" stopColor="#4a9eff" />
            </radialGradient>
            <linearGradient id="hue-ring" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ff0000" />
              <stop offset="16.6%" stopColor="#ffff00" />
              <stop offset="33.3%" stopColor="#00ff00" />
              <stop offset="50%" stopColor="#00ffff" />
              <stop offset="66.6%" stopColor="#0000ff" />
              <stop offset="83.3%" stopColor="#ff00ff" />
              <stop offset="100%" stopColor="#ff0000" />
            </linearGradient>
          </defs>
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke="url(#hue-ring)"
            strokeWidth="6"
            opacity="0.3"
          />
          <circle cx="32" cy="32" r="20" fill={`url(#${label}-gradient)`} opacity="0.2" />
          <circle
            cx="32"
            cy="32"
            r="3"
            fill="#4a9eff"
            className="cursor-move"
          />
        </svg>
      </div>
    </div>
  );

  const renderCurveGraph = (label: string, color: string) => (
    <div className="space-y-2">
      <label className="text-[10px] text-white/60">{label}</label>
      <div className="relative h-[100px] bg-black/40 rounded border border-white/10 overflow-hidden">
        {/* Grid background */}
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
          <defs>
            <pattern id={`grid-${label}`} width="16" height="16" patternUnits="userSpaceOnUse">
              <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#grid-${label})`} />
          <line x1="0" y1="100%" x2="100%" y2="0" stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
        </svg>

        {/* Curve line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
          <path
            d="M 0 100 Q 40 80, 80 40 T 160 0"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Control points */}
        <div className="absolute" style={{ left: '25%', top: '60%', transform: 'translate(-50%, -50%)' }}>
          <div className="w-2 h-2 rounded-full cursor-move" style={{ backgroundColor: color }} />
        </div>
        <div className="absolute" style={{ left: '50%', top: '30%', transform: 'translate(-50%, -50%)' }}>
          <div className="w-2 h-2 rounded-full cursor-move" style={{ backgroundColor: color }} />
        </div>
        <div className="absolute" style={{ left: '75%', top: '10%', transform: 'translate(-50%, -50%)' }}>
          <div className="w-2 h-2 rounded-full cursor-move" style={{ backgroundColor: color }} />
        </div>
      </div>
    </div>
  );

  const renderSection = (
    key: string,
    title: string,
    content: React.ReactNode
  ) => (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        onClick={() => toggleSection(key)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-black/50 hover:bg-white/10 transition-all"
      >
        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          {title}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              resetSection(key);
            }}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Reset"
          >
            <RotateCcw size={12} className="text-white/60 hover:text-blue-400 transition-colors" />
          </button>
          <ChevronDown
            size={14}
            className={`text-white/60 transition-transform ${
              expandedSections[key] ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>
      {expandedSections[key] && (
        <div className="p-3 space-y-3 bg-white/5">{content}</div>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2 bg-black/50 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          Lumetri Color
        </h3>
        <div className="text-[9px] text-white/60 mt-0.5 truncate">{clipName}</div>
      </div>

      {/* Scrollable Content */}
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

        {/* Basic Correction */}
        {renderSection(
          'basic',
          'Basic Correction',
          <>
            {renderSlider('Temperature', basicParams.temperature, -100, 100, (v) => setBasicParams(p => ({ ...p, temperature: v })), 'linear-gradient(to right, #4a9eff, #ffffff, #ff8c42)')}
            {renderSlider('Tint', basicParams.tint, -100, 100, (v) => setBasicParams(p => ({ ...p, tint: v })), 'linear-gradient(to right, #00ff00, #ffffff, #ff00ff)')}
            {renderSlider('Exposure', basicParams.exposure, -100, 100, (v) => setBasicParams(p => ({ ...p, exposure: v })))}
            {renderSlider('Contrast', basicParams.contrast, -100, 100, (v) => setBasicParams(p => ({ ...p, contrast: v })))}
            {renderSlider('Highlights', basicParams.highlights, -100, 100, (v) => setBasicParams(p => ({ ...p, highlights: v })))}
            {renderSlider('Shadows', basicParams.shadows, -100, 100, (v) => setBasicParams(p => ({ ...p, shadows: v })))}
            {renderSlider('Whites', basicParams.whites, -100, 100, (v) => setBasicParams(p => ({ ...p, whites: v })))}
            {renderSlider('Blacks', basicParams.blacks, -100, 100, (v) => setBasicParams(p => ({ ...p, blacks: v })))}
            {renderSlider('Saturation', basicParams.saturation, 0, 200, (v) => setBasicParams(p => ({ ...p, saturation: v })))}
          </>
        )}

        {/* Creative */}
        {renderSection(
          'creative',
          'Creative',
          <>
            <div className="space-y-1">
              <label className="text-[10px] text-white/60">Look</label>
              <select
                value={creativeParams.look}
                onChange={(e) => setCreativeParams(p => ({ ...p, look: e.target.value }))}
                className="w-full h-[22px] px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-pointer"
              >
                <option>None</option>
                <option>Cinematic</option>
                <option>Warm</option>
                <option>Cool</option>
                <option>Vintage</option>
                <option>Bleach Bypass</option>
                <option>Film Stock</option>
              </select>
            </div>
            {renderSlider('Intensity', creativeParams.intensity, 0, 100, (v) => setCreativeParams(p => ({ ...p, intensity: v })))}
            {renderSlider('Sharpening', creativeParams.sharpening, 0, 100, (v) => setCreativeParams(p => ({ ...p, sharpening: v })))}
            {renderSlider('Vibrance', creativeParams.vibrance, -100, 100, (v) => setCreativeParams(p => ({ ...p, vibrance: v })))}
          </>
        )}

        {/* Color Wheels */}
        {renderSection(
          'wheels',
          'Color Wheels',
          <div className="grid grid-cols-3 gap-2">
            {renderColorWheel('Shadows', wheelParams.shadows)}
            {renderColorWheel('Midtones', wheelParams.midtones)}
            {renderColorWheel('Highlights', wheelParams.highlights)}
          </div>
        )}

        {/* Curves */}
        {renderSection(
          'curves',
          'Curves',
          <div className="space-y-3">
            {renderCurveGraph('Master', '#ffffff')}
            {renderCurveGraph('Red', '#ff4444')}
            {renderCurveGraph('Green', '#44ff44')}
            {renderCurveGraph('Blue', '#4444ff')}
          </div>
        )}

        {/* HSL Secondary */}
        {renderSection(
          'hsl',
          'HSL Secondary',
          <>
            {renderSlider('Hue', hslParams.hue, 0, 360, (v) => setHslParams(p => ({ ...p, hue: v })), 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)')}
            {renderSlider('Saturation', hslParams.saturation, -100, 100, (v) => setHslParams(p => ({ ...p, saturation: v })))}
            {renderSlider('Luminance', hslParams.luminance, -100, 100, (v) => setHslParams(p => ({ ...p, luminance: v })))}
          </>
        )}

        {/* Vignette */}
        {renderSection(
          'vignette',
          'Vignette',
          <>
            {renderSlider('Amount', vignetteParams.amount, -100, 100, (v) => setVignetteParams(p => ({ ...p, amount: v })))}
            {renderSlider('Midpoint', vignetteParams.midpoint, 0, 100, (v) => setVignetteParams(p => ({ ...p, midpoint: v })))}
            {renderSlider('Roundness', vignetteParams.roundness, 0, 100, (v) => setVignetteParams(p => ({ ...p, roundness: v })))}
            {renderSlider('Feather', vignetteParams.feather, 0, 100, (v) => setVignetteParams(p => ({ ...p, feather: v })))}
          </>
        )}
      </div>
    </div>
  );
};

export default LumetriColorTab;
