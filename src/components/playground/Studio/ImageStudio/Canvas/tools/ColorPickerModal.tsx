import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Pipette, Palette, Copy, Check, Save } from 'lucide-react';

interface ColorPickerModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  currentColor: string;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onColorChange: (color: string) => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover?: (isHovering: boolean) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  colorType: 'primary' | 'secondary';
}

interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

interface CMYK {
  c: number; // 0-100
  m: number; // 0-100
  y: number; // 0-100
  k: number; // 0-100
}

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  currentColor,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onColorChange,
  onClose,
  onBringToFront,
  isOnTop,
  onHover,
  canvasRef,
  colorType
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const colorFieldRef = useRef<HTMLCanvasElement>(null);
  const hueSliderRef = useRef<HTMLCanvasElement>(null);
  const [isDraggingField, setIsDraggingField] = useState(false);
  const [isDraggingHue, setIsDraggingHue] = useState(false);
  const [isEyedropperActive, setIsEyedropperActive] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [colorSaved, setColorSaved] = useState(false);
  const [activeColorModel, setActiveColorModel] = useState<'hex' | 'rgb' | 'hsv' | 'cmyk'>('hex');

  // Color state
  const [hsv, setHsv] = useState<HSV>({ h: 0, s: 100, v: 100 });
  const [rgb, setRgb] = useState<RGB>({ r: 255, g: 0, b: 0 });
  const [cmyk, setCmyk] = useState<CMYK>({ c: 0, m: 100, y: 100, k: 0 });
  const [hex, setHex] = useState('#ff0000');

  // Color conversion utilities
  const hexToRgb = (hex: string): RGB | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const rgbToHex = (r: number, g: number, b: number): string => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  const rgbToHsv = (r: number, g: number, b: number): HSV => {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    
    let h = 0;
    let s = max === 0 ? 0 : diff / max;
    let v = max;
    
    if (diff !== 0) {
      switch (max) {
        case r: h = (g - b) / diff + (g < b ? 6 : 0); break;
        case g: h = (b - r) / diff + 2; break;
        case b: h = (r - g) / diff + 4; break;
      }
      h /= 6;
    }
    
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      v: Math.round(v * 100)
    };
  };

  const hsvToRgb = (h: number, s: number, v: number): RGB => {
    h = h / 360;
    s = s / 100;
    v = v / 100;
    
    const c = v * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = v - c;
    
    let r = 0, g = 0, b = 0;
    
    if (h < 1/6) {
      r = c; g = x; b = 0;
    } else if (h < 2/6) {
      r = x; g = c; b = 0;
    } else if (h < 3/6) {
      r = 0; g = c; b = x;
    } else if (h < 4/6) {
      r = 0; g = x; b = c;
    } else if (h < 5/6) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  };

  const rgbToCmyk = (r: number, g: number, b: number): CMYK => {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const k = 1 - Math.max(r, g, b);
    const c = k === 1 ? 0 : (1 - r - k) / (1 - k);
    const m = k === 1 ? 0 : (1 - g - k) / (1 - k);
    const y = k === 1 ? 0 : (1 - b - k) / (1 - k);
    
    return {
      c: Math.round(c * 100),
      m: Math.round(m * 100),
      y: Math.round(y * 100),
      k: Math.round(k * 100)
    };
  };

  const cmykToRgb = (c: number, m: number, y: number, k: number): RGB => {
    c /= 100;
    m /= 100;
    y /= 100;
    k /= 100;
    
    const r = 255 * (1 - c) * (1 - k);
    const g = 255 * (1 - m) * (1 - k);
    const b = 255 * (1 - y) * (1 - k);
    
    return {
      r: Math.round(r),
      g: Math.round(g),
      b: Math.round(b)
    };
  };

  // Initialize color from prop
  useEffect(() => {
    if (currentColor) {
      const rgbColor = hexToRgb(currentColor);
      if (rgbColor) {
        setRgb(rgbColor);
        setHsv(rgbToHsv(rgbColor.r, rgbColor.g, rgbColor.b));
        setCmyk(rgbToCmyk(rgbColor.r, rgbColor.g, rgbColor.b));
        setHex(currentColor);
      }
    }
  }, [currentColor]);

  // Update all color formats when HSV changes
  const updateFromHsv = useCallback((newHsv: HSV) => {
    setHsv(newHsv);
    const newRgb = hsvToRgb(newHsv.h, newHsv.s, newHsv.v);
    setRgb(newRgb);
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    setHex(newHex);
    setCmyk(rgbToCmyk(newRgb.r, newRgb.g, newRgb.b));
    onColorChange(newHex);
  }, [onColorChange]);

  // Update all color formats when RGB changes
  const updateFromRgb = useCallback((newRgb: RGB) => {
    setRgb(newRgb);
    setHsv(rgbToHsv(newRgb.r, newRgb.g, newRgb.b));
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    setHex(newHex);
    setCmyk(rgbToCmyk(newRgb.r, newRgb.g, newRgb.b));
    onColorChange(newHex);
  }, [onColorChange]);

  // Draw color field (saturation/value)
  const drawColorField = useCallback(() => {
    const canvas = colorFieldRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas first
    ctx.clearRect(0, 0, width, height);

    // Create base hue color
    const baseColor = hsvToRgb(hsv.h, 100, 100);
    
    // Create horizontal gradient (saturation)
    const saturationGradient = ctx.createLinearGradient(0, 0, width, 0);
    saturationGradient.addColorStop(0, '#ffffff');
    saturationGradient.addColorStop(1, `rgb(${baseColor.r}, ${baseColor.g}, ${baseColor.b})`);
    
    ctx.fillStyle = saturationGradient;
    ctx.fillRect(0, 0, width, height);
    
    // Create vertical gradient (value/brightness)
    const valueGradient = ctx.createLinearGradient(0, 0, 0, height);
    valueGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    valueGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    
    ctx.fillStyle = valueGradient;
    ctx.fillRect(0, 0, width, height);
  }, [hsv.h]);

  // Draw hue slider
  const drawHueSlider = useCallback(() => {
    const canvas = hueSliderRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas first
    ctx.clearRect(0, 0, width, height);

    // Create horizontal hue gradient
    const hueGradient = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i <= 6; i++) {
      const hue = (i / 6) * 360;
      const color = hsvToRgb(hue, 100, 100);
      hueGradient.addColorStop(i / 6, `rgb(${color.r}, ${color.g}, ${color.b})`);
    }
    
    ctx.fillStyle = hueGradient;
    ctx.fillRect(0, 0, width, height);
  }, []);

  // Redraw canvases when needed
  useEffect(() => {
    if (isVisible) {
      // Multiple attempts with increasing delays to ensure canvas is ready
      const timers = [
        setTimeout(() => {
          drawColorField();
          drawHueSlider();
        }, 50),
        setTimeout(() => {
          drawColorField();
          drawHueSlider();
        }, 150),
        setTimeout(() => {
          drawColorField();
          drawHueSlider();
        }, 300)
      ];
      return () => timers.forEach(timer => clearTimeout(timer));
    }
  }, [isVisible, drawColorField, drawHueSlider]);

  // Also redraw when HSV changes
  useEffect(() => {
    if (isVisible) {
      drawColorField();
    }
  }, [isVisible, hsv.h, drawColorField]);

  // Handle color field interaction
  const handleColorFieldInteraction = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = colorFieldRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const s = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const v = Math.max(0, Math.min(100, 100 - (y / rect.height) * 100));
    
    updateFromHsv({ ...hsv, s, v });
  }, [hsv, updateFromHsv]);

  // Handle hue slider interaction
  const handleHueSliderInteraction = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = hueSliderRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    const h = Math.max(0, Math.min(360, (x / rect.width) * 360));
    
    updateFromHsv({ ...hsv, h });
  }, [hsv, updateFromHsv]);

  // Eyedropper functionality
  const handleEyedropper = useCallback(async () => {
    if (!('EyeDropper' in window)) {
      alert('Eyedropper not supported in this browser');
      return;
    }

    try {
      setIsEyedropperActive(true);
      // @ts-ignore - EyeDropper is not in TypeScript types yet
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();
      
      if (result.sRGBHex) {
        const rgbColor = hexToRgb(result.sRGBHex);
        if (rgbColor) {
          updateFromRgb(rgbColor);
        }
      }
    } catch (error) {
      console.log('Eyedropper cancelled or failed');
    } finally {
      setIsEyedropperActive(false);
    }
  }, [updateFromRgb]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  }, []);

  // Save color
  const handleSaveColor = useCallback(() => {
    console.log('🎨 Saving color:', hex, 'for', colorType);
    onColorChange(hex);
    setColorSaved(true);
    setTimeout(() => setColorSaved(false), 2000);
  }, [hex, colorType, onColorChange]);

  // Panel dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    onDragStart();
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) return;
    
    const rect = panelElement.getBoundingClientRect();
    
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // Global mouse events for dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragOffsetRef.current.x;
        const newY = e.clientY - dragOffsetRef.current.y;
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const panelWidth = 320;
        const panelHeight = 500;
        
        const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
        const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
        
        onPositionChange({ x: constrainedX, y: constrainedY });
      } else if (isDraggingField) {
        handleColorFieldInteraction(e);
      } else if (isDraggingHue) {
        handleHueSliderInteraction(e);
      }
    };

    const handleGlobalMouseUp = () => {
      onDragEnd();
      setIsDraggingField(false);
      setIsDraggingHue(false);
    };

    if (isDragging || isDraggingField || isDraggingHue) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, isDraggingField, isDraggingHue, onPositionChange, onDragEnd, handleColorFieldInteraction, handleHueSliderInteraction]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPositionChange({ x: 0, y: 0 });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-auto select-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: position.y === 0 ? 'translateY(50vh) translateY(-50%)' : 'none',
        zIndex: zIndex
      }}
    >
      <div 
        className={`bg-black/95 border rounded-lg w-80 shadow-2xl transition-all duration-200 ${
          isDragging ? 'cursor-grabbing' : ''
        } ${
          isOnTop 
            ? 'border-white/40' 
            : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onBringToFront();
        }}
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
      >
        {/* Header - Draggable */}
        <div 
          className={`px-4 py-3 border-b border-white/10 flex items-center justify-between ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-colors duration-200 ${
            isDragging ? 'bg-white/5' : 'hover:bg-white/5'
          }`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          title="Drag to move panel • Double-click to reset position"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
            </div>
            <Palette size={16} className="text-white/80" />
            <h3 className="text-white text-sm font-medium">
              {colorType === 'primary' ? 'Primary' : 'Secondary'} Color
            </h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Eyedropper */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleEyedropper();
              }}
              className={`p-1.5 rounded transition-colors ${
                isEyedropperActive
                  ? 'text-blue-400 bg-blue-400/20'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
              title="Pick color from screen"
              disabled={!('EyeDropper' in window)}
            >
              <Pipette size={14} />
            </button>

            {/* Save Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleSaveColor();
              }}
              className={`p-1.5 rounded transition-colors ${
                colorSaved
                  ? 'text-green-400 bg-green-400/20'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
              title="Save color"
            >
              {colorSaved ? <Check size={14} /> : <Save size={14} />}
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Close color picker"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="p-4 space-y-4">
          {/* Current Color Preview */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="bg-white/10 rounded-lg p-3 border border-white/10">
                <div className="flex items-center gap-3">
                  <div 
                    className="w-12 h-12 rounded-lg border-2 border-white/20 shadow-lg"
                    style={{ backgroundColor: hex }}
                  />
                  <div>
                    <div className="text-white text-sm font-medium">{colorType === 'primary' ? 'Primary' : 'Secondary'}</div>
                    <div className="text-white/60 text-xs font-mono">{hex.toUpperCase()}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Color Field (Saturation/Value) */}
          <div className="space-y-2">
            <label className="text-white/80 text-xs font-medium">Color Field</label>
            <div className="relative">
              <canvas
                ref={colorFieldRef}
                width={256}
                height={128}
                className="w-full h-32 rounded-lg border border-white/20 cursor-crosshair bg-white/5"
                style={{ imageRendering: 'pixelated' }}
                onMouseDown={(e) => {
                  setIsDraggingField(true);
                  handleColorFieldInteraction(e);
                }}
              />
              {/* Color field marker */}
              <div
                className="absolute w-3 h-3 border-2 border-white rounded-full pointer-events-none shadow-lg"
                style={{
                  left: `${(hsv.s / 100) * 100}%`,
                  top: `${((100 - hsv.v) / 100) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)'
                }}
              />
            </div>
          </div>

          {/* Hue Slider */}
          <div className="space-y-2">
            <label className="text-white/80 text-xs font-medium">Hue</label>
            <div className="relative">
              <canvas
                ref={hueSliderRef}
                width={256}
                height={32}
                className="w-full h-8 rounded-lg border border-white/20 cursor-crosshair bg-white/5"
                style={{ imageRendering: 'pixelated' }}
                onMouseDown={(e) => {
                  setIsDraggingHue(true);
                  handleHueSliderInteraction(e);
                }}
              />
              {/* Hue marker */}
              <div
                className="absolute w-0.5 pointer-events-none"
                style={{
                  left: `${(hsv.h / 360) * 100}%`,
                  top: '0',
                  bottom: '0',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'white',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.4)',
                  borderRadius: '1px'
                }}
              />
            </div>
          </div>

          {/* Color Model Tabs */}
          <div className="space-y-2">
            <div className="flex border border-white/20 rounded-lg overflow-hidden">
              {(['hex', 'rgb', 'hsv', 'cmyk'] as const).map((model) => (
                <button
                  key={model}
                  onClick={() => setActiveColorModel(model)}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    activeColorModel === model
                      ? 'bg-white/20 text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {model.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Color Inputs */}
            <div className="space-y-2">
              {activeColorModel === 'hex' && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={hex}
                    onChange={(e) => {
                      const value = e.target.value;
                      setHex(value);
                      if (/^#[0-9A-F]{6}$/i.test(value)) {
                        const rgbColor = hexToRgb(value);
                        if (rgbColor) {
                          updateFromRgb(rgbColor);
                        }
                      }
                    }}
                    className="flex-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-white/40"
                    placeholder="#000000"
                  />
                  <button
                    onClick={() => copyToClipboard(hex)}
                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedToClipboard ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              )}

              {activeColorModel === 'rgb' && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-white/60 text-xs">R</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.r}
                      onChange={(e) => {
                        const r = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                        updateFromRgb({ ...rgb, r });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">G</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.g}
                      onChange={(e) => {
                        const g = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                        updateFromRgb({ ...rgb, g });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">B</label>
                    <input
                      type="number"
                      min="0"
                      max="255"
                      value={rgb.b}
                      onChange={(e) => {
                        const b = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                        updateFromRgb({ ...rgb, b });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              )}

              {activeColorModel === 'hsv' && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-white/60 text-xs">H</label>
                    <input
                      type="number"
                      min="0"
                      max="360"
                      value={hsv.h}
                      onChange={(e) => {
                        const h = Math.max(0, Math.min(360, parseInt(e.target.value) || 0));
                        updateFromHsv({ ...hsv, h });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">S</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={hsv.s}
                      onChange={(e) => {
                        const s = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        updateFromHsv({ ...hsv, s });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">V</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={hsv.v}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        updateFromHsv({ ...hsv, v });
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              )}

              {activeColorModel === 'cmyk' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-white/60 text-xs">C</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={cmyk.c}
                      onChange={(e) => {
                        const c = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        const newCmyk = { ...cmyk, c };
                        setCmyk(newCmyk);
                        updateFromRgb(cmykToRgb(newCmyk.c, newCmyk.m, newCmyk.y, newCmyk.k));
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">M</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={cmyk.m}
                      onChange={(e) => {
                        const m = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        const newCmyk = { ...cmyk, m };
                        setCmyk(newCmyk);
                        updateFromRgb(cmykToRgb(newCmyk.c, newCmyk.m, newCmyk.y, newCmyk.k));
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">Y</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={cmyk.y}
                      onChange={(e) => {
                        const y = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        const newCmyk = { ...cmyk, y };
                        setCmyk(newCmyk);
                        updateFromRgb(cmykToRgb(newCmyk.c, newCmyk.m, newCmyk.y, newCmyk.k));
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div>
                    <label className="text-white/60 text-xs">K</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={cmyk.k}
                      onChange={(e) => {
                        const k = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                        const newCmyk = { ...cmyk, k };
                        setCmyk(newCmyk);
                        updateFromRgb(cmykToRgb(newCmyk.c, newCmyk.m, newCmyk.y, newCmyk.k));
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/40"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Common Colors */}
          <div className="space-y-2">
            <label className="text-white/80 text-xs font-medium">Common Colors</label>
            <div className="grid grid-cols-8 gap-1">
              {[
                '#000000', '#333333', '#666666', '#999999',
                '#cccccc', '#ffffff', '#ff0000', '#00ff00',
                '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
                '#ff8000', '#8000ff', '#0080ff', '#80ff00'
              ].map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    const rgbColor = hexToRgb(color);
                    if (rgbColor) {
                      updateFromRgb(rgbColor);
                    }
                  }}
                  className="w-8 h-8 rounded border border-white/20 hover:border-white/40 transition-colors"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal; 