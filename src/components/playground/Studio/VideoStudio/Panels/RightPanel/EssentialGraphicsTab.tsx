import React, { useState, useRef, useEffect } from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

interface EssentialGraphicsTabProps {
  selectedClipId?: string;
  clipName?: string;
  onParameterChange?: (parameterId: string, value: any) => void;
}

const EssentialGraphicsTab: React.FC<EssentialGraphicsTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onParameterChange
}) => {
  const [text, setText] = useState('Your Title Here');
  const [font, setFont] = useState('Inter');
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>('center');
  const [fontSize, setFontSize] = useState(72);
  const [fillColor, setFillColor] = useState('#ffffff');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(0);
  const [opacity, setOpacity] = useState(100);
  const [tracking, setTracking] = useState(0);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  // Drag state for numeric inputs
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragOnChange = useRef<(value: number) => void>(() => {});
  const dragMin = useRef(0);
  const dragMax = useRef(100);
  const dragSensitivity = useRef(0.5);

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
    // Adjust sensitivity based on range
    const range = max - min;
    dragSensitivity.current = range > 100 ? 1 : 0.5;
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
    unit?: string
  ) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-white/60">{label}</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            onMouseDown={(e) => handleInputMouseDown(e, value, min, max, onChange)}
            className="w-12 h-[20px] px-1.5 text-[11px] font-mono text-right bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-ew-resize
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          {unit && <span className="text-[9px] text-white/60">{unit}</span>}
        </div>
      </div>
      <div className="relative h-[4px] bg-black/20 rounded-full overflow-hidden">
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

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2 bg-black/50 border-b border-white/10">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
          Essential Graphics
        </h3>
        <div className="text-[9px] text-white/60 mt-0.5 truncate">{clipName}</div>
      </div>

      {/* Scrollable Content */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-3"
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

        {/* Source Text */}
        <div className="space-y-1">
          <label className="text-[10px] text-white/60">Source Text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white resize-none focus:outline-none focus:border-blue-400 transition-colors"
            rows={3}
            placeholder="Enter text..."
          />
        </div>

        {/* Font Family */}
        <div className="space-y-1">
          <label className="text-[10px] text-white/60">Font Family</label>
          <select
            value={font}
            onChange={(e) => setFont(e.target.value)}
            className="w-full h-[22px] px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-pointer"
          >
            <option value="Inter">Inter</option>
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Georgia">Georgia</option>
            <option value="Verdana">Verdana</option>
            <option value="Impact">Impact</option>
            <option value="Comic Sans MS">Comic Sans MS</option>
            <option value="Trebuchet MS">Trebuchet MS</option>
          </select>
        </div>

        {/* Text Alignment */}
        <div className="space-y-1">
          <label className="text-[10px] text-white/60">Text Alignment</label>
          <div className="flex gap-1">
            <button
              onClick={() => setAlignment('left')}
              className={`flex-1 flex items-center justify-center h-[26px] rounded border transition-all ${
                alignment === 'left'
                  ? 'bg-blue-400 border-blue-400 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:border-blue-400 hover:text-white'
              }`}
            >
              <AlignLeft size={14} />
            </button>
            <button
              onClick={() => setAlignment('center')}
              className={`flex-1 flex items-center justify-center h-[26px] rounded border transition-all ${
                alignment === 'center'
                  ? 'bg-blue-400 border-blue-400 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:border-blue-400 hover:text-white'
              }`}
            >
              <AlignCenter size={14} />
            </button>
            <button
              onClick={() => setAlignment('right')}
              className={`flex-1 flex items-center justify-center h-[26px] rounded border transition-all ${
                alignment === 'right'
                  ? 'bg-blue-400 border-blue-400 text-white'
                  : 'bg-white/5 border-white/10 text-white/60 hover:border-blue-400 hover:text-white'
              }`}
            >
              <AlignRight size={14} />
            </button>
          </div>
        </div>

        {/* Font Size */}
        {renderSlider('Font Size', fontSize, 8, 200, setFontSize, 'px')}

        {/* Fill Color & Stroke Color */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-white/60">Fill Color</label>
            <div className="relative h-[48px] rounded border border-white/10 overflow-hidden cursor-pointer hover:border-blue-400 transition-colors">
              <input
                type="color"
                value={fillColor}
                onChange={(e) => setFillColor(e.target.value)}
                className="absolute inset-0 w-full h-full cursor-pointer"
                style={{ border: 'none' }}
              />
            </div>
            <input
              type="text"
              value={fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              className="w-full h-[20px] px-1.5 text-[10px] font-mono text-center bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors uppercase"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-white/60">Stroke Color</label>
            <div className="relative h-[48px] rounded border border-white/10 overflow-hidden cursor-pointer hover:border-blue-400 transition-colors">
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="absolute inset-0 w-full h-full cursor-pointer"
                style={{ border: 'none' }}
              />
            </div>
            <input
              type="text"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              className="w-full h-[20px] px-1.5 text-[10px] font-mono text-center bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors uppercase"
            />
          </div>
        </div>

        {/* Stroke Width */}
        {renderSlider('Stroke Width', strokeWidth, 0, 20, setStrokeWidth, 'px')}

        {/* Opacity */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-white/60">Opacity</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                onMouseDown={(e) => handleInputMouseDown(e, opacity, 0, 100, setOpacity)}
                className="w-12 h-[20px] px-1.5 text-[11px] font-mono text-right bg-white/5 border border-white/10 rounded text-white focus:outline-none focus:border-blue-400 transition-colors cursor-ew-resize
                         [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[9px] text-white/60">%</span>
            </div>
          </div>
          <div className="relative h-[4px] bg-black/20 rounded-full overflow-hidden">
            {/* Gradient preview showing opacity */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to right, transparent, rgba(255, 255, 255, 0.2))`,
                opacity: 0.3,
              }}
            />
            <div
              className="absolute left-0 top-0 h-full bg-white/30 transition-all"
              style={{ width: `${opacity}%` }}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
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

        {/* Tracking */}
        {renderSlider('Tracking', tracking, -100, 100, setTracking)}

        {/* Bold & Italic */}
        <div className="space-y-1.5">
          <label className="flex items-center justify-between h-[26px] px-2 rounded hover:bg-white/5 cursor-pointer transition-colors group">
            <span className="text-[10px] text-white/60 group-hover:text-white transition-colors">
              Bold
            </span>
            <input
              type="checkbox"
              checked={bold}
              onChange={(e) => setBold(e.target.checked)}
              className="w-4 h-4 rounded border-2 border-white/10 bg-white/5 cursor-pointer checked:bg-blue-400 checked:border-blue-400 transition-colors"
            />
          </label>

          <label className="flex items-center justify-between h-[26px] px-2 rounded hover:bg-white/5 cursor-pointer transition-colors group">
            <span className="text-[10px] text-white/60 group-hover:text-white transition-colors">
              Italic
            </span>
            <input
              type="checkbox"
              checked={italic}
              onChange={(e) => setItalic(e.target.checked)}
              className="w-4 h-4 rounded border-2 border-white/10 bg-white/5 cursor-pointer checked:bg-blue-400 checked:border-blue-400 transition-colors"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default EssentialGraphicsTab;
