import React, { useRef, useEffect, useState } from 'react';
import { Square, Circle, Triangle, Star, ArrowRight, Minus, Save, RefreshCw, X, Palette } from 'lucide-react';
import { ShapeStyle, Shape } from './types';

interface ShapeModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  shapeStyle: ShapeStyle;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onShapeStyleChange: (style: ShapeStyle) => void;
  onShapeSelect: (shapeType: Shape['type']) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover?: (isHovering: boolean) => void;
}

const ShapeModal: React.FC<ShapeModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  shapeStyle,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onShapeStyleChange,
  onShapeSelect,
  onSave,
  onReset,
  onClose,
  onBringToFront,
  isOnTop,
  onHover
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [localStyle, setLocalStyle] = useState<ShapeStyle>(shapeStyle);
  const [selectedShape, setSelectedShape] = useState<Shape['type']>('rectangle');
  const [showFillColorPicker, setShowFillColorPicker] = useState(false);
  const [showStrokeColorPicker, setShowStrokeColorPicker] = useState(false);

  // Shape definitions
  const shapes = [
    { type: 'rectangle' as const, name: 'Rectangle', icon: Square },
    { type: 'ellipse' as const, name: 'Ellipse', icon: Circle },
    { type: 'polygon' as const, name: 'Polygon', icon: Triangle },
    { type: 'star' as const, name: 'Star', icon: Star },
    { type: 'line' as const, name: 'Line', icon: Minus },
    { type: 'arrow' as const, name: 'Arrow', icon: ArrowRight }
  ];

  // Stroke dash patterns
  const dashPatterns = [
    { name: 'Solid', pattern: undefined },
    { name: 'Dashed', pattern: [10, 5] },
    { name: 'Dotted', pattern: [2, 3] },
    { name: 'Dash-Dot', pattern: [10, 5, 2, 5] },
    { name: 'Long Dash', pattern: [20, 10] }
  ];

  useEffect(() => {
    setLocalStyle(shapeStyle);
  }, [shapeStyle]);

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
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 320;
      const panelHeight = 600;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      onPositionChange({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      onDragEnd();
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, onPositionChange, onDragEnd]);

  const updateStyle = (updates: Partial<ShapeStyle>) => {
    const newStyle = { ...localStyle, ...updates };
    setLocalStyle(newStyle);
    onShapeStyleChange(newStyle);
  };

  const handleShapeSelect = (shapeType: Shape['type']) => {
    setSelectedShape(shapeType);
    onShapeSelect(shapeType);
  };

  if (!isVisible) return null;

  return (
    <div 
      className="absolute"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: position.y === 0 ? 'translateY(50vh) translateY(-50%)' : 'none',
        zIndex: zIndex
      }}
    >
      <div 
        className={`bg-black/90 border rounded-lg w-80 max-h-[70vh] overflow-hidden shadow-2xl transition-all duration-200 ${
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
            <h3 className="text-white text-sm font-medium">Shape Tools</h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Save Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Save shape settings"
            >
              <Save size={14} />
            </button>
            
            {/* Reset Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Reset to defaults"
            >
              <RefreshCw size={14} />
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close shape tools"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Shape Controls - Scrollable Content */}
        <div 
          className="p-4 space-y-4 overflow-y-auto max-h-[calc(70vh-80px)] scrollbar-hide" 
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {/* Shape Selection */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Shape Type</label>
            <div className="grid grid-cols-3 gap-2">
              {shapes.map((shape) => {
                const IconComponent = shape.icon;
                return (
                  <button
                    key={shape.type}
                    onClick={() => handleShapeSelect(shape.type)}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-md text-xs transition-all ${
                      selectedShape === shape.type
                        ? 'bg-white/20 text-white border border-white/40'
                        : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <IconComponent size={16} />
                    <span>{shape.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fill Settings */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Fill</label>
            
            {/* Fill Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-xs">Enable Fill</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localStyle.fill}
                  onChange={(e) => updateStyle({ fill: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-black/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/30"></div>
              </label>
            </div>

            {localStyle.fill && (
              <>
                {/* Fill Color */}
                <div className="space-y-2">
                  <span className="text-white/70 text-xs">Fill Color</span>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-lg border-2 border-white/20 cursor-pointer hover:border-white/40 transition-colors"
                      style={{ backgroundColor: localStyle.fillColor }}
                      onClick={() => setShowFillColorPicker(!showFillColorPicker)}
                    />
                    <input
                      type="text"
                      value={localStyle.fillColor}
                      onChange={(e) => updateStyle({ fillColor: e.target.value })}
                      className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      placeholder="#ffffff"
                    />
                  </div>
                </div>

                {/* Fill Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-xs">Fill Opacity</span>
                    <span className="text-white/50 text-xs">{localStyle.fillOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={localStyle.fillOpacity}
                    onChange={(e) => updateStyle({ fillOpacity: parseInt(e.target.value) })}
                    className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>
              </>
            )}
          </div>

          {/* Stroke Settings */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Stroke</label>
            
            {/* Stroke Enable Toggle */}
            <div className="flex items-center justify-between">
              <span className="text-white/70 text-xs">Enable Stroke</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localStyle.stroke}
                  onChange={(e) => updateStyle({ stroke: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-black/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/30"></div>
              </label>
            </div>

            {localStyle.stroke && (
              <>
                {/* Stroke Color */}
                <div className="space-y-2">
                  <span className="text-white/70 text-xs">Stroke Color</span>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-lg border-2 border-white/20 cursor-pointer hover:border-white/40 transition-colors"
                      style={{ backgroundColor: localStyle.strokeColor }}
                      onClick={() => setShowStrokeColorPicker(!showStrokeColorPicker)}
                    />
                    <input
                      type="text"
                      value={localStyle.strokeColor}
                      onChange={(e) => updateStyle({ strokeColor: e.target.value })}
                      className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                      placeholder="#000000"
                    />
                  </div>
                </div>

                {/* Stroke Width */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-xs">Stroke Width</span>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={localStyle.strokeWidth}
                      onChange={(e) => updateStyle({ strokeWidth: parseInt(e.target.value) || 1 })}
                      className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={localStyle.strokeWidth}
                    onChange={(e) => updateStyle({ strokeWidth: parseInt(e.target.value) })}
                    className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>

                {/* Stroke Opacity */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 text-xs">Stroke Opacity</span>
                    <span className="text-white/50 text-xs">{localStyle.strokeOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={localStyle.strokeOpacity}
                    onChange={(e) => updateStyle({ strokeOpacity: parseInt(e.target.value) })}
                    className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                  />
                </div>

                {/* Stroke Style */}
                <div className="space-y-2">
                  <span className="text-white/70 text-xs">Stroke Style</span>
                  <select
                    value={localStyle.strokeDashArray ? JSON.stringify(localStyle.strokeDashArray) : 'solid'}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'solid') {
                        updateStyle({ strokeDashArray: undefined });
                      } else {
                        updateStyle({ strokeDashArray: JSON.parse(value) });
                      }
                    }}
                    className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
                  >
                    {dashPatterns.map((pattern) => (
                      <option 
                        key={pattern.name} 
                        value={pattern.pattern ? JSON.stringify(pattern.pattern) : 'solid'}
                      >
                        {pattern.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>

          {/* Corner Radius (for rectangles) */}
          {selectedShape === 'rectangle' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-white/70 text-xs">Corner Radius</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={localStyle.cornerRadius || 0}
                  onChange={(e) => updateStyle({ cornerRadius: parseInt(e.target.value) || 0 })}
                  className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-white/20"
                />
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={localStyle.cornerRadius || 0}
                onChange={(e) => updateStyle({ cornerRadius: parseInt(e.target.value) })}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
              />
            </div>
          )}

          {/* Shape Preview */}
          <div className="bg-black/30 border border-white/10 rounded-lg p-4">
            <div className="text-white/70 text-xs mb-2">Preview</div>
            <div className="w-full h-20 flex items-center justify-center">
              <svg width="60" height="60" viewBox="0 0 60 60">
                {selectedShape === 'rectangle' && (
                  <rect
                    x="10"
                    y="15"
                    width="40"
                    height="30"
                    rx={localStyle.cornerRadius || 0}
                    fill={localStyle.fill ? localStyle.fillColor : 'none'}
                    fillOpacity={localStyle.fill ? localStyle.fillOpacity / 100 : 0}
                    stroke={localStyle.stroke ? localStyle.strokeColor : 'none'}
                    strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 0}
                    strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 0}
                    strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                  />
                )}
                {selectedShape === 'ellipse' && (
                  <ellipse
                    cx="30"
                    cy="30"
                    rx="20"
                    ry="15"
                    fill={localStyle.fill ? localStyle.fillColor : 'none'}
                    fillOpacity={localStyle.fill ? localStyle.fillOpacity / 100 : 0}
                    stroke={localStyle.stroke ? localStyle.strokeColor : 'none'}
                    strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 0}
                    strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 0}
                    strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                  />
                )}
                {selectedShape === 'polygon' && (
                  <polygon
                    points="30,10 50,40 10,40"
                    fill={localStyle.fill ? localStyle.fillColor : 'none'}
                    fillOpacity={localStyle.fill ? localStyle.fillOpacity / 100 : 0}
                    stroke={localStyle.stroke ? localStyle.strokeColor : 'none'}
                    strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 0}
                    strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 0}
                    strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                  />
                )}
                {selectedShape === 'star' && (
                  <polygon
                    points="30,5 35,20 50,20 38,30 43,45 30,35 17,45 22,30 10,20 25,20"
                    fill={localStyle.fill ? localStyle.fillColor : 'none'}
                    fillOpacity={localStyle.fill ? localStyle.fillOpacity / 100 : 0}
                    stroke={localStyle.stroke ? localStyle.strokeColor : 'none'}
                    strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 0}
                    strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 0}
                    strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                  />
                )}
                {selectedShape === 'line' && (
                  <line
                    x1="10"
                    y1="30"
                    x2="50"
                    y2="30"
                    stroke={localStyle.stroke ? localStyle.strokeColor : '#ffffff'}
                    strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 2}
                    strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 1}
                    strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                  />
                )}
                {selectedShape === 'arrow' && (
                  <g>
                    <line
                      x1="10"
                      y1="30"
                      x2="45"
                      y2="30"
                      stroke={localStyle.stroke ? localStyle.strokeColor : '#ffffff'}
                      strokeWidth={localStyle.stroke ? localStyle.strokeWidth : 2}
                      strokeOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 1}
                      strokeDasharray={localStyle.strokeDashArray?.join(' ')}
                    />
                    <polygon
                      points="45,25 55,30 45,35"
                      fill={localStyle.stroke ? localStyle.strokeColor : '#ffffff'}
                      fillOpacity={localStyle.stroke ? localStyle.strokeOpacity / 100 : 1}
                    />
                  </g>
                )}
              </svg>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <div className="text-blue-200 text-xs mb-1 font-medium">Quick Tips</div>
            <div className="space-y-1 text-xs text-blue-200/70">
              <div>• Hold Shift to maintain aspect ratio</div>
              <div>• Hold Alt to draw from center</div>
              <div>• Use arrow keys for precise movement</div>
              <div>• Double-click to edit properties</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShapeModal; 